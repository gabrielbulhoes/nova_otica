import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { publish } from '../lib/eventBus.js';
import { notifySyncFailure } from '../lib/opsAlert.js';
import { HttpError } from '../http/helpers.js';
import { getSellbieClient } from '../integrations/sellbie/index.js';
import { SellbieUnreachableError } from '../integrations/sellbie/httpClient.js';
import { checkWindow } from '../integrations/sellbie/window.js';
import * as map from '../integrations/sellbie/mappers.js';
import { emLotes, varrerPorJanelas } from '../integrations/sellbie/sweep.js';
import type { SellbieEstoqueGrade } from '../integrations/sellbie/types.js';
import { exportPaidOrdersToErp } from '../modules/commerce/erpExport.service.js';

const log = logger.child({ mod: 'sync' });

/** Erro lançado quando já existe uma sincronização em andamento. */
export class SyncInProgressError extends HttpError {
  constructor() {
    super(409, 'Já existe uma sincronização em andamento.');
  }
}

// Trava única para todos os gatilhos (schedule, boot, manual) no processo.
let syncInFlight = false;

// Um run RUNNING mais novo que isto bloqueia execuções em outros processos;
// mais velho é considerado abandonado (processo caiu) e não bloqueia.
const STALE_RUN_MS = 15 * 60_000;

export function isSyncRunning(): boolean {
  return syncInFlight;
}

/**
 * Fecha os runs que ficaram RUNNING para sempre — processo morto, container
 * reiniciado, `docker exec` interrompido.
 *
 * Eles nunca bloquearam nada: a trava só olha RUNNING mais novo que
 * STALE_RUN_MS, e um run de horas atrás não casa com isso. Mas ficavam na
 * tabela indefinidamente e, em 06/08/2026, levaram a operação a diagnosticar
 * um bug de trava que não existia — o que bloqueava eram as próprias
 * tentativas anteriores, ainda vivas dentro do container.
 *
 * Registro que mente sobre o próprio estado custa caro mesmo quando é inócuo.
 */
async function fecharRunsAbandonados(): Promise<number> {
  const r = await prisma.syncRun.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
    data: {
      status: 'FAILED',
      finishedAt: new Date(),
      error: 'abandonado: o processo terminou sem fechar o run',
    },
  });
  if (r.count > 0) log.warn('Runs abandonados fechados', { quantidade: r.count });
  return r.count;
}

export interface SyncResult {
  ok: boolean;
  window: string;
  durationMs: number;
  entities: Record<string, { read: number; written: number; error?: string }>;
}

type Trigger = 'schedule' | 'boot' | 'manual';

/**
 * Executa a sincronização completa com a fonte (Sellbie). Idempotente:
 * faz upsert por `externalId`. A ordem respeita as dependências de FK.
 * Ao final, reconcilia as movimentações internas pendentes.
 */
export async function runFullSync(trigger: Trigger = 'manual'): Promise<SyncResult> {
  if (syncInFlight) throw new SyncInProgressError();
  await fecharRunsAbandonados();
  // Trava entre processos: um run RUNNING recente indica sync ativo em outra
  // instância (scheduler × manual, ou múltiplas réplicas da API).
  const activeRun = await prisma.syncRun.findFirst({
    where: { status: 'RUNNING', startedAt: { gte: new Date(Date.now() - STALE_RUN_MS) } },
  });
  if (activeRun) throw new SyncInProgressError();

  syncInFlight = true;
  try {
    return await runFullSyncLocked(trigger);
  } finally {
    syncInFlight = false;
  }
}

async function runFullSyncLocked(trigger: Trigger): Promise<SyncResult> {
  const startedAt = Date.now();
  // Cutoff da reconciliação: movimentações confirmadas ANTES do início do
  // sync. As confirmadas durante o run ainda não estão refletidas na fonte.
  const reconcileCutoff = new Date(startedAt);
  const client = getSellbieClient();
  const win = checkWindow();
  const entities: SyncResult['entities'] = {};

  const run = await prisma.syncRun.create({
    data: { entity: 'all', status: 'RUNNING', window: win.window, trigger },
  });

  if (!win.allowed) {
    log.warn('Sincronização fora da janela permitida', { window: win.window, now: win.now });
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', finishedAt: new Date(), error: win.reason },
    });
    return { ok: false, window: win.window, durationMs: Date.now() - startedAt, entities };
  }

  log.info('Iniciando sincronização', { trigger, window: win.window });

  let totalRead = 0;
  let totalWritten = 0;

  /*
   * O DISJUNTOR — incidente de 16/08/2026.
   *
   * Naquela manhã as DEZ entidades falharam com o mesmo `timeout of 30000ms
   * exceeded`. Cada uma gastou cinco tentativas de 30 s antes de desistir, e o
   * ciclo levou 39 minutos para concluir o que a PRIMEIRA rota já havia
   * provado em três: a CDS não estava respondendo.
   *
   * O custo não é o tempo de máquina. É a JANELA. A CDS só aceita ser
   * consultada entre 06:00 e 07:00, e o cron dispara uma vez, às 06:00 — de
   * modo que aquela hora era a única chance do dia. Gastá-la inteira provando
   * dez vezes a mesma indisponibilidade eliminou qualquer possibilidade de uma
   * segunda tentativa, e a rede passou o dia servindo o dado da véspera.
   *
   * `SellbieUnreachableError` é lançado só quando as cinco tentativas terminam
   * SEM NENHUMA resposta HTTP — timeout, DNS, pacote descartado. Erro DA CDS
   * (4xx/5xx) não conta: aquilo é a CDS falando, e uma rota quebrada não diz
   * nada sobre as outras nove.
   */
  let cdsInalcancavel: SellbieUnreachableError | null = null;

  const track = async (
    name: string,
    fn: () => Promise<{ read: number; written: number; error?: string }>,
    opts: { countTotals?: boolean } = {},
  ): Promise<void> => {
    if (cdsInalcancavel) {
      entities[name] = { read: 0, written: 0, error: 'pulada: CDS inalcançável' };
      return;
    }
    try {
      const r = await fn();
      // Erro estruturado (ex.: write-back parcial) preserva os contadores de
      // sucesso e ainda marca a entidade como falha (status PARTIAL + alerta).
      entities[name] = { read: r.read, written: r.written, ...(r.error ? { error: r.error } : {}) };
      if (opts.countTotals !== false) {
        // recordsRead/recordsWritten do SyncRun contam apenas o fluxo
        // ERP -> local (é o que o painel mostra como "registros").
        totalRead += r.read;
        totalWritten += r.written;
      }
      log.info(`Entidade sincronizada: ${name}`, r);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      entities[name] = { read: 0, written: 0, error: message };
      log.error(`Falha ao sincronizar ${name}`, { error: message });
      if (err instanceof SellbieUnreachableError) {
        cdsInalcancavel = err;
        log.error('CDS inalcançável — interrompendo o ciclo para preservar a janela', {
          entidade: name,
          rota: err.route,
        });
      }
    }
  };

  // 1) Cadastros base (sem dependências)
  await track('stores', () => syncStores(client));
  await track('colors', () => syncColors(client));
  await track('sizes', () => syncSizes(client));

  // 2) Dependentes de cadastros base
  await track('sellers', () => syncSellers(client));
  await track('products', () => syncProducts(client));
  await track('customers', () => syncCustomers(client));

  // 3) Estoque (precisa de loja + produto)
  await track('stock', () => syncStock(client));

  // 4) Vendas e dependentes
  await track('sales', () => syncSales(client));
  await track('saleItems', () => syncSaleItems(client));
  await track('payments', () => syncPayments(client));

  // 5) Reconciliação das movimentações internas.
  // Só reconcilia se o estoque foi sincronizado com sucesso — do contrário os
  // deltas confirmados seriam descartados contra uma base de estoque velha,
  // corrompendo o saldo ao vivo.
  if (entities.stock && !entities.stock.error) {
    await track('reconcile', () => reconcileMovements(reconcileCutoff));
  } else {
    log.warn('Reconciliação pulada: sincronização de estoque falhou ou não ocorreu');
    entities.reconcile = { read: 0, written: 0, error: 'pulada: sync de estoque falhou' };
  }

  // 6) Write-back: exporta ao ERP os pedidos online pagos ainda não
  // enviados (POST /cds/inserirvenda). Só em modo live — no mock não há ERP
  // real e carimbar erpExportedAt sem envio real excluiria o pedido do
  // write-back para sempre. Falhas reais viram erro da entidade (alerta
  // operacional); os contadores não entram no total do painel, que mede o
  // fluxo ERP -> local.
  if (env.SELLBIE_MODE === 'live') {
    await track('erpExport', () => exportPaidOrdersToErp(client), { countTotals: false });
  }

  const hadError = Object.values(entities).some((e) => e.error);
  const durationMs = Date.now() - startedAt;

  await prisma.syncRun.update({
    where: { id: run.id },
    data: {
      status: hadError ? 'PARTIAL' : 'SUCCESS',
      finishedAt: new Date(),
      recordsRead: totalRead,
      recordsWritten: totalWritten,
      error: hadError
        ? Object.entries(entities)
            .filter(([, v]) => v.error)
            .map(([k, v]) => `${k}: ${v.error}`)
            .join('; ')
        : null,
    },
  });

  log.info('Sincronização concluída', { durationMs, totalRead, totalWritten, ok: !hadError });
  if (hadError) {
    // Falha do sync das 06h é o incidente mais crítico da operação: além do
    // registro em SyncRun, notifica ativamente (webhook), sem travar o fluxo.
    await notifySyncFailure({ trigger, window: win.window, durationMs, entities });
  }
  publish({ type: 'sync.completed', ok: !hadError });

  // Notificação proativa: com a base recém-sincronizada, avisa o painel se
  // há itens no ponto de reposição (sem depender de o lojista abrir a tela).
  try {
    const { publishPlanningAlert } = await import('../modules/planning/planning.service.js');
    await publishPlanningAlert();
  } catch (err) {
    log.warn('Falha ao publicar alerta de planejamento pós-sync', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Lote de geração: o motor acabou de rodar sobre a base nova, então esta é a
  // execução que o gestor vê às 06h. Registrar aqui é o que dá ao card uma
  // idade real — e ao SLA de decisão algo em que se apoiar.
  //
  // Não roda se a sincronização falhou: um lote calculado sobre base velha
  // marcaria cards como "novos" por defeito de dados, não por mudança real.
  if (!hadError) {
    try {
      const { recordPlanningBatch } = await import('../modules/planning/planning.service.js');
      await recordPlanningBatch(trigger);
    } catch (err) {
      log.warn('Falha ao registrar o lote de geração pós-sync', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ok: !hadError, window: win.window, durationMs, entities };
}

/** aaaa-mm-dd de hoje (fuso do processo). */
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Carga histórica de vendas por janelas mensais (alimenta giro/ABC e a
 * previsão sazonal, que usa 24 meses). Reaproveita os mesmos syncs com faixa
 * explícita; upserts por externalId tornam a repetição inofensiva.
 */
export interface BackfillOpts {
  /**
   * Quantos meses para trás, ou `'tudo'` para DESCOBRIR onde o histórico
   * termina em vez de adivinhar um número.
   */
  meses: number | 'tudo';
  /** Meses vazios seguidos que encerram a descoberta. Só em `'tudo'`. */
  pararApos?: number;
  /** Piso da descoberta, para não varrer o século inteiro. */
  tetoMeses?: number;
}

export async function backfillSalesHistory(
  opts: BackfillOpts | number,
): Promise<SyncResult['entities']> {
  const o: BackfillOpts = typeof opts === 'number' ? { meses: opts } : opts;
  // TRAVA — o backfill não tinha nenhuma, e o sync tem.
  //
  // Em 06/08/2026 duas execuções rodaram em paralelo por engano e disputaram
  // as mesmas linhas: dois deadlocks do Postgres. `syncPayments` REESCREVE a
  // janela (apaga e recria), então a corrida não é só lenta, é perigosa — se
  // o `delete` de uma execução cair depois do `create` da outra e o seu
  // próprio `create` falhar, a janela fica sem pagamento nenhum e nada acusa.
  //
  // A trava em memória não serve aqui: o backfill roda em processo próprio
  // (`docker exec`), separado da API. Quem protege entre processos é a linha
  // RUNNING no banco, a mesma que o sync usa.
  if (syncInFlight) throw new SyncInProgressError();
  await fecharRunsAbandonados();
  const emAndamento = await prisma.syncRun.findFirst({
    where: { status: 'RUNNING', startedAt: { gte: new Date(Date.now() - STALE_RUN_MS) } },
  });
  if (emAndamento) throw new SyncInProgressError();

  syncInFlight = true;
  const run = await prisma.syncRun.create({
    data: {
      entity: 'backfill',
      status: 'RUNNING',
      window: o.meses === 'tudo' ? 'tudo' : `${o.meses}m`,
      trigger: 'manual',
    },
  });
  try {
    // Cliente resolvido só aqui: a trava falha antes de tocar a rede.
    return await backfillLocked(getSellbieClient(), o, run.id);
  } finally {
    syncInFlight = false;
  }
}

async function backfillLocked(
  client: Client,
  opts: BackfillOpts,
  runId: string,
): Promise<SyncResult['entities']> {
  const entities: SyncResult['entities'] = {};
  const now = new Date();
  const descobrir = opts.meses === 'tudo';
  const teto: number = descobrir ? opts.tetoMeses ?? 240 : (opts.meses as number);
  const pararApos = opts.pararApos ?? 3;

  // Do mês corrente para trás. A ordem importa no modo 'tudo': é indo para o
  // passado que se encontra o fim do histórico.
  let vaziosSeguidos = 0;
  let ultimoComVenda: string | null = null;

  for (let i = 0; i <= teto; i += 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const range = {
      date_start: start.toISOString().slice(0, 10),
      date_end: end.toISOString().slice(0, 10),
    };
    const label = range.date_start.slice(0, 7);
    let vendasLidas = 0;
    try {
      const sales = await syncSales(client, range);
      const items = await syncSaleItems(client, range);
      const payments = await syncPayments(client, range);
      vendasLidas = sales.read;
      entities[label] = {
        read: sales.read + items.read + payments.read,
        written: sales.written + items.written + payments.written,
      };
      log.info('Backfill de vendas: mês concluído', { mes: label, vendas: sales.read, ...entities[label] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      entities[label] = { read: 0, written: 0, error: message };
      log.error('Backfill de vendas: mês falhou', { mes: label, error: message });
      // Mês que FALHOU não é mês vazio. Tratar erro como fim do histórico
      // encerraria a varredura no primeiro soluço do conector e deixaria anos
      // de fora, com a aparência de ter terminado direito.
      vaziosSeguidos = 0;
      await bater(runId, entities);
      continue;
    }

    if (vendasLidas > 0) {
      vaziosSeguidos = 0;
      ultimoComVenda = label;
    } else if (descobrir) {
      vaziosSeguidos += 1;
      if (vaziosSeguidos >= pararApos) {
        log.info('Backfill: fim do histórico', {
          mesesVazios: vaziosSeguidos,
          ultimoMesComVenda: ultimoComVenda,
          mesesVarridos: i + 1,
        });
        break;
      }
    }
    await bater(runId, entities);
  }

  if (descobrir && ultimoComVenda === null) {
    log.warn('Backfill: nenhum mês com venda encontrado', { tetoMeses: teto });
  }

  const comErro = Object.values(entities).filter((e) => e.error).length;
  await prisma.syncRun.update({
    where: { id: runId },
    data: {
      status: comErro > 0 ? 'PARTIAL' : 'SUCCESS',
      finishedAt: new Date(),
      recordsRead: Object.values(entities).reduce((a, e) => a + e.read, 0),
      recordsWritten: Object.values(entities).reduce((a, e) => a + e.written, 0),
      error: comErro > 0 ? `${comErro} mês(es) com erro` : null,
    },
  });
  return entities;
}

/**
 * Batimento da trava. Ela considera abandonado um RUNNING mais velho que 15
 * minutos, e uma varredura de anos passa muito disso — sem isto, a própria
 * execução envelheceria no meio do caminho e deixaria de proteger contra uma
 * segunda.
 */
async function bater(runId: string, entities: SyncResult['entities']): Promise<void> {
  // Além de renovar a trava, o batimento grava o PROGRESSO. A saída do
  // backfill vai para o terminal que chamou o `docker exec`, não para o log do
  // container — quando a conexão cai, some. A linha do SyncRun passa a ser a
  // fonte de acompanhamento que sobrevive à desconexão.
  await prisma.syncRun.update({
    where: { id: runId },
    data: {
      startedAt: new Date(),
      recordsRead: Object.values(entities).reduce((a, e) => a + e.read, 0),
      recordsWritten: Object.values(entities).reduce((a, e) => a + e.written, 0),
      error: `em andamento: ${Object.keys(entities).length} meses processados`,
    },
  });
}

// ─── Helpers de lookup externalId -> id interno ──────────────────────────────

async function storeIdMap(): Promise<Map<string, string>> {
  const rows = await prisma.store.findMany({ select: { id: true, externalId: true } });
  return new Map(rows.map((r) => [r.externalId, r.id]));
}
async function productIdMap(): Promise<Map<string, string>> {
  const rows = await prisma.product.findMany({ select: { id: true, externalId: true } });
  return new Map(rows.map((r) => [r.externalId, r.id]));
}

// ─── Sincronizadores por entidade ────────────────────────────────────────────

type Client = ReturnType<typeof getSellbieClient>;

// Centros de distribuição (ex.: GMAIS) são marcados por nome para ficarem fora
// da matemática de planejamento. Regex vazio desliga a marcação automática.
const cdPattern = env.PLANNING_EXCLUDED_STORE_PATTERN.trim()
  ? new RegExp(env.PLANNING_EXCLUDED_STORE_PATTERN, 'i')
  : null;

// Filiais em outro ERP (ZEISS): o CDS responde por elas, com dado atrasado.
// Marcação separada da de retaguarda — ver store.scope.ts.
const outroErpPattern = env.EXTERNAL_ERP_STORE_PATTERN.trim()
  ? new RegExp(env.EXTERNAL_ERP_STORE_PATTERN, 'i')
  : null;

async function syncStores(client: Client) {
  const rows = await client.getLojas();
  let written = 0;
  for (const raw of rows) {
    const d = map.mapLoja(raw);
    if (!d.externalId) continue;
    const excludeFromPlanning = cdPattern ? cdPattern.test(d.name ?? '') : false;
    const externalErp = outroErpPattern ? outroErpPattern.test(d.name ?? '') : false;
    await prisma.store.upsert({
      where: { externalId: d.externalId },
      create: { ...d, excludeFromPlanning, externalErp, syncedAt: new Date() },
      update: { ...d, excludeFromPlanning, externalErp, syncedAt: new Date() },
    });
    written += 1;
  }
  return { read: rows.length, written };
}

async function syncColors(client: Client) {
  const rows = await client.getCores();
  let written = 0;
  for (const raw of rows) {
    const d = map.mapCor(raw);
    if (!d.externalId) continue;
    await prisma.color.upsert({
      where: { externalId: d.externalId },
      create: { ...d, syncedAt: new Date() },
      update: { ...d, syncedAt: new Date() },
    });
    written += 1;
  }
  return { read: rows.length, written };
}

async function syncSizes(client: Client) {
  const rows = await client.getTamanhos();
  let written = 0;
  for (const raw of rows) {
    const d = map.mapTamanho(raw);
    if (!d.externalId) continue;
    await prisma.size.upsert({
      where: { externalId: d.externalId },
      create: { ...d, syncedAt: new Date() },
      update: { ...d, syncedAt: new Date() },
    });
    written += 1;
  }
  return { read: rows.length, written };
}

async function syncSellers(client: Client) {
  const rows = await client.getVendedores();
  const stores = await storeIdMap();
  let written = 0;
  for (const raw of rows) {
    const d = map.mapVendedor(raw);
    if (!d.externalId) continue;
    const storeId = d.externalStoreId ? stores.get(d.externalStoreId) ?? null : null;
    const data = {
      name: d.name,
      active: d.active,
      includedAt: d.includedAt,
      storeId,
      syncedAt: new Date(),
    };
    await prisma.seller.upsert({
      where: { externalId: d.externalId },
      create: { externalId: d.externalId, ...data },
      update: data,
    });
    written += 1;
  }
  return { read: rows.length, written };
}

async function syncProducts(client: Client, range?: { date_start: string; date_end: string }) {
  // Sem filtros o conector devolve só os últimos 30 dias — o catálogo
  // completo exige faixa explícita desde o início da base. E uma faixa larga
  // sozinha não basta: o conector corta a resposta num teto que não documenta
  // (5.318 de ~21.683 produtos na carga de 04/08/2026) e não avisa. Por isso a
  // faixa vai fatiada por bisseção, até cada janela caber sob o teto.
  const rows = range
    ? await client.getProdutos(range)
    : await varrerCatalogo(client);
  const colors = await prisma.color.findMany({ select: { id: true, externalId: true } });
  const sizes = await prisma.size.findMany({ select: { id: true, externalId: true } });
  const colorMap = new Map(colors.map((c) => [c.externalId, c.id]));
  const sizeMap = new Map(sizes.map((s) => [s.externalId, s.id]));
  let written = 0;
  for (const raw of rows) {
    const d = map.mapProduto(raw);
    if (!d.externalId) continue;
    const data = {
      sku: d.sku,
      description: d.description,
      brand: d.brand,
      category: d.category,
      colorId: d.externalColorId ? colorMap.get(d.externalColorId) ?? null : null,
      sizeId: d.externalSizeId ? sizeMap.get(d.externalSizeId) ?? null : null,
      price: d.price,
      cost: d.cost,
      active: d.active,
      includedAt: d.includedAt,
      syncedAt: new Date(),
    };
    await prisma.product.upsert({
      where: { externalId: d.externalId },
      create: { externalId: d.externalId, ...data },
      update: data,
    });
    written += 1;
  }
  return { read: rows.length, written };
}

/**
 * Lê o catálogo inteiro varrendo `data_cadastro` por janelas adaptativas.
 *
 * O piso é 1900-01-01 por padrão, não 2000-01-01: "1900-01-01" é o
 * placeholder de data-nula do próprio conector, e um piso em 2000 excluiria em
 * silêncio todo produto cadastrado sem data — que é exatamente o tipo de perda
 * que não aparece em erro nenhum.
 */
async function varrerCatalogo(client: Client) {
  const r = await varrerPorJanelas({
    entidade: 'produtos',
    inicio: env.SELLBIE_CATALOG_START,
    fim: isoToday(),
    limite: env.SELLBIE_PAGE_LIMIT,
    maxChamadas: env.SELLBIE_SWEEP_MAX_CALLS,
    buscar: (janela) => client.getProdutos(janela),
    chave: (p) => String(p.codigo_base),
    aoRegistrar: (e) => {
      if (e.lidos === 0) return; // janela vazia é o caso comum; não polui o log
      log.info('Catálogo: janela lida', {
        de: e.janela.date_start,
        ate: e.janela.date_end,
        lidos: e.lidos,
        ...(e.fatiada ? { acao: 'fatiada' } : {}),
      });
    },
  });

  log.info('Catálogo varrido', {
    produtos: r.itens.length,
    chamadas: r.chamadas,
    lidosBrutos: r.lidosBrutos,
    janelasFatiadas: r.janelasTruncadas,
  });
  if (r.janelasIndivisiveis > 0) {
    // Um único dia com mais registros que o teto: a bisseção chegou ao fim do
    // que o filtro de data permite e ainda assim a resposta veio cortada.
    log.warn('Catálogo possivelmente incompleto: dia único acima do teto', {
      janelas: r.janelasIndivisiveis,
      teto: env.SELLBIE_PAGE_LIMIT,
    });
  }
  if (r.tetoAtingido) {
    log.warn('Varredura do catálogo interrompida pelo teto de chamadas', {
      maxChamadas: env.SELLBIE_SWEEP_MAX_CALLS,
    });
  }
  return r.itens;
}

/**
 * Varredura genérica de uma rota do conector, com log padronizado.
 *
 * Existe porque o teto não é exclusividade de `produtos`: a carga de
 * 04/08/2026 mostrou `clientes` parando em 5.000 e `pagamentosVendas` em
 * 5.115. Números diferentes na mesma instalação — o corte não é por contagem
 * de linhas, é por tamanho de resposta. Por isso o teto configurado fica
 * abaixo de todos eles, e por isso toda rota com filtro de data é varrida em
 * vez de chamada uma vez.
 */
async function varrer<T>(
  entidade: string,
  inicio: string,
  fim: string,
  buscar: (janela: { date_start: string; date_end: string }) => Promise<T[]>,
  chave: (item: T) => string,
): Promise<T[]> {
  const r = await varrerPorJanelas({
    entidade,
    inicio,
    fim,
    limite: env.SELLBIE_PAGE_LIMIT,
    maxChamadas: env.SELLBIE_SWEEP_MAX_CALLS,
    buscar,
    chave,
    aoRegistrar: (e) => {
      if (e.lidos === 0) return; // janela vazia é o caso comum; não polui o log
      log.info(`${entidade}: janela lida`, {
        de: e.janela.date_start,
        ate: e.janela.date_end,
        lidos: e.lidos,
        ...(e.fatiada ? { acao: 'fatiada' } : {}),
      });
    },
  });

  log.info(`${entidade}: varredura concluída`, {
    registros: r.itens.length,
    chamadas: r.chamadas,
    janelasFatiadas: r.janelasTruncadas,
  });
  if (r.janelasIndivisiveis > 0) {
    log.warn(`${entidade}: possivelmente incompleto — dia único acima do teto`, {
      janelas: r.janelasIndivisiveis,
      teto: env.SELLBIE_PAGE_LIMIT,
    });
  }
  if (r.tetoAtingido) {
    log.warn(`${entidade}: varredura interrompida pelo teto de chamadas`, {
      maxChamadas: env.SELLBIE_SWEEP_MAX_CALLS,
    });
  }
  return r.itens;
}

/** Faixa padrão das vendas do lote diário: os últimos N dias, explícita. */
function janelaDeVendas(): { date_start: string; date_end: string } {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - env.SELLBIE_SALES_WINDOW_DAYS * 86_400_000);
  return { date_start: inicio.toISOString().slice(0, 10), date_end: isoToday() };
}

async function syncCustomers(client: Client) {
  // `clientes` parou em exatos 5.000 na carga de 04/08/2026 — truncada. Sem a
  // varredura, toda venda de cliente fora dos 5.000 primeiros fica órfã: o
  // join é por CPF, e sem o cliente cadastrado a venda perde a ligação.
  const rows = await varrer(
    'clientes',
    env.SELLBIE_CATALOG_START,
    isoToday(),
    (janela) => client.getClientes(janela),
    (c) => map.digits(c.cpf) ?? String(c.cpf ?? ''),
  );
  let written = 0;
  for (const raw of rows) {
    const d = map.mapCliente(raw);
    if (!d.externalId) continue;
    await prisma.customer.upsert({
      where: { externalId: d.externalId },
      create: { ...d, syncedAt: new Date() },
      update: { ...d, syncedAt: new Date() },
    });
    written += 1;
  }
  return { read: rows.length, written };
}

/** Acumulador do estoque: dobra cada lote na hora, em vez de guardar a grade. */
export interface AcumuladorDeEstoque {
  /** "loja|produto" -> quantidade somada entre as variantes (GRADE). */
  posicoes: Map<string, number>;
  /** Produtos que a grade conhece e o catálogo não. */
  orfaos: Map<string, SellbieEstoqueGrade>;
  /** "produto|variante" já contabilizados — a soma entre lotes não repete. */
  vistas: Set<string>;
  linhas: number;
  /**
   * Alguma resposta bateu no teto DURO do conector. Enquanto isto for true, o
   * que não veio na leitura não pode ser interpretado como "zerou": pode ter
   * sido apenas cortado.
   */
  truncou: boolean;
}

function novoAcumulador(): AcumuladorDeEstoque {
  return { posicoes: new Map(), orfaos: new Map(), vistas: new Set(), linhas: 0, truncou: false };
}

/**
 * Dobra um lote da grade no acumulador e o descarta.
 *
 * Dobrar na hora, em vez de juntar tudo e processar no fim, é o que mantém o
 * consumo de memória proporcional ao número de POSIÇÕES (produto × loja) e não
 * ao de linhas cruas — cada linha da grade carrega um objeto aninhado com as
 * 22 filiais, e a rede tem dezenas de milhares delas. Numa droplet que também
 * roda o Postgres, segurar a grade inteira é como o processo morre.
 */
function absorverGrade(
  acc: AcumuladorDeEstoque,
  parte: SellbieEstoqueGrade[],
  produtosConhecidos: Map<string, string>,
  pedidos?: Set<string>,
  escopo = '',
): void {
  for (const raw of parte) {
    const codigo = map.idStr(raw.CODIGO);
    // Só entra o que foi PEDIDO neste lote. As quantidades são somadas entre
    // variantes, então uma linha que aparece em dois lotes é contada duas
    // vezes — e estoque inflado é pior que estoque a menos, porque nada no
    // painel denuncia. Descartar o excedente aqui torna a soma dupla
    // impossível por construção, em vez de depender da guarda heurística
    // abaixo acertar sempre.
    if (pedidos && !pedidos.has(codigo)) continue;

    // A identidade da linha é produto×variante: variantes diferentes do mesmo
    // produto SOMAM no saldo da loja, a mesma variante repetida não.
    //
    // O `escopo` entra na chave por causa da leitura por LOJA: ali a mesma
    // linha produto×variante volta uma vez por filial, cada uma com o ESTOQUE
    // daquela filial. Sem o escopo, a segunda loja em diante seria descartada
    // como repetição e a rede inteira ficaria com o estoque de uma filial só.
    const identidade = `${escopo}|${codigo}|${map.idStr(raw.GRADE)}`;
    if (acc.vistas.has(identidade)) continue;
    acc.vistas.add(identidade);

    acc.linhas += 1;
    if (codigo && !produtosConhecidos.has(codigo) && !acc.orfaos.has(codigo)) {
      acc.orfaos.set(codigo, raw);
    }
    for (const pos of map.mapEstoqueGrade(raw)) {
      const key = `${pos.externalStoreId}|${pos.externalProductId}`;
      acc.posicoes.set(key, (acc.posicoes.get(key) ?? 0) + pos.quantity);
    }
  }
}

/**
 * Lê /cds/estoquegrade em lotes de produtos.
 *
 * A rota devolve o estoque da rede aninhado por filial, e está sujeita ao mesmo
 * teto silencioso das outras: uma chamada única traz só o começo. Ela não
 * aceita filtro de data — o que aceita é `cod_prod` como lista CSV, e é esse o
 * pedaço com que se fatia.
 *
 * O tamanho do lote é ADAPTATIVO. Não sabemos quantos códigos o conector
 * aceita numa lista, e o modo como ele recusa (400? URL longa demais? erro
 * genérico?) também não está documentado. Em vez de adivinhar um número que
 * pode estar errado para sempre, um lote que falha é partido ao meio e
 * recolocado na fila: se ele aceita 60 e não 250, a leitura converge sozinha
 * na primeira falha em vez de derrubar o estoque inteiro.
 */
// Exportada só para teste: é a lógica com mais chance de estar errada contra o
// conector real (tamanho de lote, recusa, filtro ignorado) e a única aqui que
// não depende do banco — deixá-la privada seria deixá-la sem cobertura.
export async function lerEstoqueEmLotes(
  client: Client,
  codigos: string[],
  produtosConhecidos: Map<string, string>,
  lojas: string[] = [],
): Promise<AcumuladorDeEstoque> {
  let acc = novoAcumulador();

  const chamadaUnica = async (motivo: string) => {
    log.warn(`Estoque: ${motivo}; lendo a grade em chamada única`);
    // Zera antes: o que veio dos lotes e o que vem da chamada única se
    // sobrepõem, e as quantidades são SOMADAS entre variantes — misturar as
    // duas leituras dobraria o saldo dos produtos já lidos.
    acc = novoAcumulador();
    absorverGrade(acc, await client.getEstoqueGrade(), produtosConhecidos);
    return acc;
  };

  /**
   * Segundo degrau da escada: uma chamada por FILIAL.
   *
   * Se `cod_prod` não funciona, ainda resta `cod_loja` — o outro filtro que a
   * rota aceita. São 22 chamadas em vez de 240, cada uma trazendo a grade de
   * uma filial só, o que já é pequeno o bastante para caber sob o teto. É
   * muito melhor que a chamada única, que volta truncada.
   */
  const porLoja = async (motivo: string) => {
    log.warn(`Estoque: ${motivo}; tentando ler a grade por filial`, { filiais: lojas.length });
    acc = novoAcumulador();

    // `only_disp: 1` = só produto COM saldo.
    //
    // Sem ele, a filial devolve uma linha para cada produto do catálogo, tenha
    // saldo ou não: com 60 mil produtos, a rede bateu no teto DURO do conector
    // — exatas 50.000 linhas em cada uma das 22 filiais, em 04/08/2026. O que
    // passava de 50 mil era descartado sem aviso, e o que vinha era, na maior
    // parte, zero.
    //
    // Com o filtro, a filial devolve só o que existe na prateleira: menos
    // linhas, longe do teto, e é exatamente o dado que interessa. O preço é que
    // o produto que ZEROU deixa de aparecer — tratado pela zeragem em
    // `syncStock`, que só roda quando a leitura veio inteira.
    let somenteComSaldo = true;
    for (const loja of lojas) {
      let parte: SellbieEstoqueGrade[];
      try {
        parte = await client.getEstoqueGrade(
          somenteComSaldo ? { cod_loja: loja, only_disp: 1 } : { cod_loja: loja },
        );
      } catch (err) {
        if (somenteComSaldo) {
          // O conector recusou `only_disp`. Recomeça sem ele, aceitando o
          // volume — e a zeragem fica desligada se o teto for atingido.
          log.warn('Estoque: only_disp recusado; relendo as filiais sem o filtro', {
            erro: err instanceof Error ? err.message : String(err),
          });
          somenteComSaldo = false;
          acc = novoAcumulador();
          return porLojaSemFiltro();
        }
        // Se `cod_loja` também é recusado, os dois filtros da rota estão fora
        // e só sobra pedir tudo. Truncado é ruim; nada é pior.
        return chamadaUnica(
          `cod_loja também recusado (${err instanceof Error ? err.message : String(err)})`,
        );
      }
      if (parte.length >= env.SELLBIE_STOCK_HARD_CAP) {
        acc.truncou = true;
        log.warn('Estoque: filial no teto duro do conector — leitura incompleta', {
          loja,
          linhas: parte.length,
          teto: env.SELLBIE_STOCK_HARD_CAP,
        });
      }
      // `escopo` = a filial: a mesma linha produto×variante volta uma vez por
      // loja, e sem isso só a primeira seria contada.
      absorverGrade(acc, parte, produtosConhecidos, undefined, loja);
    }
    log.info('Estoque: grade lida por filial', {
      filiais: lojas.length,
      somenteComSaldo,
      linhas: acc.linhas,
      posicoes: acc.posicoes.size,
      truncou: acc.truncou,
    });
    return acc;
  };

  /** Releitura por filial sem `only_disp`, quando o conector o recusa. */
  const porLojaSemFiltro = async () => {
    for (const loja of lojas) {
      let parte: SellbieEstoqueGrade[];
      try {
        parte = await client.getEstoqueGrade({ cod_loja: loja });
      } catch (err) {
        return chamadaUnica(`cod_loja recusado (${err instanceof Error ? err.message : String(err)})`);
      }
      if (parte.length >= env.SELLBIE_STOCK_HARD_CAP) acc.truncou = true;
      absorverGrade(acc, parte, produtosConhecidos, undefined, loja);
    }
    log.info('Estoque: grade lida por filial (sem only_disp)', {
      filiais: lojas.length,
      linhas: acc.linhas,
      posicoes: acc.posicoes.size,
      truncou: acc.truncou,
    });
    return acc;
  };

  if (codigos.length === 0) {
    return lojas.length > 0 ? porLoja('catálogo local vazio') : chamadaUnica('catálogo local vazio');
  }

  // SONDA DECISIVA, antes de qualquer bisseção.
  //
  // A bisseção existe para o caso "a lista ficou longa demais". Ela é péssima
  // para o caso "a rota não aceita este parâmetro": desceria de 250 a 1 em oito
  // divisões e, como o cliente HTTP repete erro 5xx quatro vezes com espera
  // exponencial (2s+4s+8s+16s), cada recusa custa mais de meio minuto. Foi o
  // que a rede mostrou em 04/08/2026 — dez minutos moendo, com HTTP 500 em
  // todos os tamanhos.
  //
  // Um código só responde a pergunta em uma chamada: se nem UM é aceito, o
  // problema é o parâmetro, e insistir é desperdício puro.
  try {
    await client.getEstoqueGrade({ cod_prod: codigos[0] });
  } catch (err) {
    return lojas.length > 0
      ? porLoja(`cod_prod recusado já com um único código (${err instanceof Error ? err.message : String(err)})`)
      : chamadaUnica('cod_prod recusado já com um único código');
  }

  const fila = emLotes(codigos, env.SELLBIE_STOCK_CHUNK);
  const totalDeLotes = fila.length;
  let chamadas = 0;
  let partidos = 0;
  let desistidos = 0;

  while (fila.length > 0) {
    const lote = fila.shift()!;
    let parte: SellbieEstoqueGrade[];
    try {
      parte = await client.getEstoqueGrade({ cod_prod: lote.join(',') });
      chamadas += 1;
    } catch (err) {
      if (lote.length === 1) {
        // Recusa de UM código isolado é a evidência decisiva: uma lista com um
        // item não é longa demais nem pesada demais. O que está sendo recusado
        // é o parâmetro `cod_prod`, não o tamanho do lote — foi o que a rede
        // mostrou em 04/08/2026, com HTTP 500 de 250 códigos até 2.
        //
        // Continuar bisseccionando 60 mil produtos aqui seria fazer 60 mil
        // chamadas para colher 60 mil erros. Desce um degrau na escada.
        desistidos += 1;
        if (desistidos >= 3) {
          return lojas.length > 0
            ? porLoja(`cod_prod recusado até em código isolado (${desistidos}x)`)
            : chamadaUnica(`cod_prod recusado até em código isolado (${desistidos}x)`);
        }
        continue;
      }
      const meio = Math.ceil(lote.length / 2);
      fila.unshift(lote.slice(0, meio), lote.slice(meio));
      partidos += 1;
      log.warn('Estoque: lote recusado, partindo ao meio', {
        tamanho: lote.length,
        erro: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const pedidos = new Set(lote);

    // Guarda contra filtro ignorado. Não é sobre correção — o descarte dentro
    // de `absorverGrade` já garante isso — é sobre custo: se `cod_prod` não
    // estiver sendo aplicado, cada um dos 240 lotes traz a rede inteira de
    // volta, e uma chamada só faz o mesmo trabalho. Um conector que filtra
    // direito devolve ZERO forasteiros; a tolerância de 10% existe só para
    // absorver normalização de código (padding, zero à esquerda).
    if (chamadas === 1 && parte.length > 0) {
      const forasteiros = parte.filter((g) => !pedidos.has(map.idStr(g.CODIGO))).length;
      if (forasteiros > parte.length / 10) {
        return chamadaUnica(`o conector ignorou cod_prod (${forasteiros}/${parte.length} forasteiros)`);
      }
    }

    absorverGrade(acc, parte, produtosConhecidos, pedidos);
  }

  log.info('Estoque: grade lida em lotes', {
    lotesPlanejados: totalDeLotes,
    chamadas,
    lotesPartidos: partidos,
    codigosDesistidos: desistidos,
    produtosPedidos: codigos.length,
    linhas: acc.linhas,
    posicoes: acc.posicoes.size,
  });
  if (desistidos > 0) {
    log.warn('Estoque: códigos que o conector recusou individualmente', { desistidos });
  }
  return acc;
}

async function syncStock(client: Client) {
  const stores = await storeIdMap();
  const products = await productIdMap();
  const acc = await lerEstoqueEmLotes(client, [...products.keys()], products, [...stores.keys()]);

  // Produtos que a grade conhece e o catálogo não. Antes eles viravam posição
  // descartada; agora viram um cadastro magro derivado da própria grade, e a
  // unidade que existe na prateleira passa a existir no painel. Se o catálogo
  // vier completo, este laço não faz nada — é fallback, não caminho normal.
  if (acc.orfaos.size > 0) {
    for (const raw of acc.orfaos.values()) {
      const d = map.mapProdutoDaGrade(raw);
      const criado = await prisma.product.upsert({
        where: { externalId: d.externalId },
        create: { ...d, syncedAt: new Date() },
        // Update vazio: se o produto apareceu entre a leitura e agora, o dado
        // do catálogo é melhor que o da grade e não deve ser sobrescrito.
        update: {},
        select: { id: true },
      });
      products.set(d.externalId, criado.id);
    }
    log.warn('Estoque: produtos criados a partir da grade (catálogo incompleto)', {
      criados: acc.orfaos.size,
    });
  }

  const resolvidas: { storeId: string; productId: string; quantity: number }[] = [];
  let skipped = 0;
  for (const [key, quantity] of acc.posicoes) {
    const [externalStoreId, externalProductId] = key.split('|');
    const storeId = stores.get(externalStoreId);
    const productId = products.get(externalProductId);
    if (!storeId || !productId) {
      skipped += 1; // loja ainda não cadastrada (ex.: registro de teste do ERP)
      continue;
    }
    resolvidas.push({ storeId, productId, quantity });
  }
  if (skipped > 0) log.warn('Posições de estoque ignoradas (loja desconhecida)', { skipped });

  const carimbo = new Date();
  const written = await gravarEstoque(resolvidas, carimbo);

  // ZERAGEM — o outro lado do `only_disp`.
  //
  // Pedindo só o que tem saldo, o produto que ZEROU simplesmente não vem na
  // resposta. Sem isto, ele ficaria no banco com o saldo da véspera para
  // sempre: o painel mostraria 6 unidades de uma armação que já saiu toda, e a
  // sugestão de remanejamento mandaria buscar o que não existe.
  //
  // Quem não foi tocado por esta leitura não tem saldo. Uma instrução, contra
  // o carimbo desta execução.
  //
  // Só roda com a leitura INTEIRA. Se alguma filial bateu no teto do conector,
  // "não veio" deixa de significar "zerou" e passa a significar "foi cortado"
  // — e zerar aí apagaria estoque real.
  if (acc.truncou) {
    log.warn('Estoque: zeragem pulada — alguma filial veio truncada', {
      teto: env.SELLBIE_STOCK_HARD_CAP,
    });
  } else {
    const zeradas = await prisma.$executeRawUnsafe(
      `UPDATE "StockItem"
          SET "quantity" = 0, "available" = 0, "syncedAt" = $1, "updatedAt" = NOW()
        WHERE ("syncedAt" IS NULL OR "syncedAt" < $1)
          AND ("quantity" <> 0 OR "available" <> 0)`,
      carimbo,
    );
    if (zeradas > 0) log.info('Estoque: posições sem saldo zeradas', { zeradas });

    // E as descarta. Posição com saldo zero, reserva zero e sem mínimo próprio
    // não carrega informação nenhuma — se o produto voltar à prateleira, a
    // linha é recriada pela próxima leitura.
    //
    // Sem isto a tabela só cresce: a leitura sem `only_disp` deixou 1.108.423
    // posições em produção, das quais a esmagadora maioria eram zeros. Isso
    // inflava a contagem da tela de estoque, o total da paginação e qualquer
    // indicador que conte POSIÇÕES em vez de somar unidades.
    //
    // `minStock` preservado: é ajuste manual do lojista para aquela posição, e
    // apagá-lo seria descartar uma decisão humana junto com o lixo.
    const removidas = await prisma.$executeRawUnsafe(
      `DELETE FROM "StockItem"
        WHERE "quantity" = 0 AND "available" = 0 AND "reserved" = 0 AND "minStock" IS NULL`,
    );
    if (removidas > 0) log.info('Estoque: posições vazias removidas', { removidas });
  }

  return { read: acc.linhas, written };
}

/**
 * Grava as posições de estoque em lote.
 *
 * Era um `upsert` do Prisma por posição, dentro de um laço. Com a leitura por
 * filial a rede devolveu 1,1 MILHÃO de posições — 22 filiais × ~50 mil linhas —
 * e um milhão de idas e voltas ao banco, a poucos milissegundos cada, é a
 * diferença entre o sync durar um minuto e durar uma hora. Todo dia.
 *
 * `INSERT ... ON CONFLICT` faz o mesmo trabalho em mil instruções em vez de um
 * milhão. `reserved` fica de FORA do UPDATE de propósito: ele é das
 * movimentações internas pendentes, não do ERP, e sobrescrevê-lo aqui apagaria
 * a reserva de toda transferência em andamento.
 */
async function gravarEstoque(
  posicoes: { storeId: string; productId: string; quantity: number }[],
  carimbo: Date,
): Promise<number> {
  // 4 parâmetros por linha (a quantidade serve a `quantity` e a `available`),
  // bem abaixo do teto de 65.535 parâmetros por instrução do Postgres.
  const POR_LOTE = 1_000;
  let written = 0;
  for (const lote of emLotes(posicoes, POR_LOTE)) {
    const valores: string[] = [];
    const params: unknown[] = [];
    for (const p of lote) {
      const i = params.length;
      valores.push(`($${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 4},0,$${i + 5},NOW(),NOW())`);
      params.push(randomUUID(), p.storeId, p.productId, p.quantity, carimbo);
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "StockItem"
         ("id","storeId","productId","quantity","available","reserved","syncedAt","createdAt","updatedAt")
       VALUES ${valores.join(',')}
       ON CONFLICT ("storeId","productId") DO UPDATE SET
         "quantity"  = EXCLUDED."quantity",
         "available" = EXCLUDED."available",
         "syncedAt"  = EXCLUDED."syncedAt",
         "updatedAt" = NOW()`,
      ...params,
    );
    written += lote.length;
  }
  return written;
}

async function syncSales(client: Client, range?: { date_start: string; date_end: string }) {
  // Sem faixa explícita o conector devolve "o último mês" — mas implícito, e o
  // que não tem faixa não pode ser fatiado quando vem truncado. A janela
  // explícita é o que torna a varredura possível.
  const janela = range ?? janelaDeVendas();
  const rows = await varrer('vendas', janela.date_start, janela.date_end, (j) => client.getVendas(j), (v) =>
    map.saleExternalId(v.codigo_loja, v.codigo_venda),
  );
  const stores = await storeIdMap();
  const sellers = await prisma.seller.findMany({ select: { id: true, externalId: true } });
  const sellerMap = new Map(sellers.map((s) => [s.externalId, s.id]));
  const customers = await prisma.customer.findMany({ select: { id: true, document: true } });
  const customerByDoc = new Map(customers.filter((c) => c.document).map((c) => [c.document!, c.id]));
  let written = 0;
  for (const raw of rows) {
    const d = map.mapVenda(raw);
    if (!d.externalId) continue;
    const data = {
      storeId: d.externalStoreId ? stores.get(d.externalStoreId) ?? null : null,
      sellerId: d.externalSellerId ? sellerMap.get(d.externalSellerId) ?? null : null,
      customerId: d.externalCustomerDoc ? customerByDoc.get(d.externalCustomerDoc) ?? null : null,
      saleDate: d.saleDate,
      total: d.total,
      discount: d.discount,
      status: d.status,
      syncedAt: new Date(),
    };
    await prisma.sale.upsert({
      where: { externalId: d.externalId },
      create: { externalId: d.externalId, ...data },
      update: data,
    });
    written += 1;
  }
  return { read: rows.length, written };
}

async function syncSaleItems(client: Client, range?: { date_start: string; date_end: string }) {
  // A rota mais perigosa das três: são vários itens por venda, então ela bate
  // no teto antes de `vendas`. Com 2.379 vendas em 30 dias a resposta já
  // chegava perto de 5.000 — e item de venda é a base de TODO o BI de produto
  // (curva ABC, giro, categoria). Truncar aqui erra tudo o que vem depois, com
  // o total de vendas parecendo certo.
  const janela = range ?? janelaDeVendas();
  const rows = await varrer(
    'detalhesVendas',
    janela.date_start,
    janela.date_end,
    (j) => client.getDetalhesVendas(j),
    (d) => map.mapDetalheVenda(d).externalId,
  );
  const sales = await prisma.sale.findMany({ select: { id: true, externalId: true } });
  const saleMap = new Map(sales.map((s) => [s.externalId, s.id]));
  const products = await productIdMap();
  let written = 0;
  for (const raw of rows) {
    const d = map.mapDetalheVenda(raw);
    const saleId = saleMap.get(d.externalSaleId);
    if (!saleId) continue;
    const productId = d.externalProductId ? products.get(d.externalProductId) ?? null : null;
    const data = {
      saleId,
      productId,
      quantity: d.quantity,
      unitPrice: d.unitPrice,
      discount: d.discount,
      total: d.total,
    };
    if (d.externalId) {
      await prisma.saleItem.upsert({
        where: { externalId: d.externalId },
        create: { externalId: d.externalId, ...data },
        update: data,
      });
    } else {
      await prisma.saleItem.create({ data });
    }
    written += 1;
  }
  return { read: rows.length, written };
}

async function syncPayments(client: Client, range?: { date_start: string; date_end: string }) {
  // Parou em 5.115 na carga de 04/08/2026 — truncada. É a fonte da dimensão
  // "forma de pagamento" do BI: truncada, ela não fica vazia, fica ENVIESADA
  // para o começo do período, que é pior porque parece um dado.
  const janela = range ?? janelaDeVendas();
  const rows = await varrer(
    'pagamentosVendas',
    janela.date_start,
    janela.date_end,
    (j) => client.getPagamentosVendas(j),
    (p) => map.mapPagamento(p).externalId,
  );
  const sales = await prisma.sale.findMany({ select: { id: true, externalId: true } });
  const saleMap = new Map(sales.map((s) => [s.externalId, s.id]));

  // Identidade montada, com sufixo de ordem para o empate residual (mesmo meio
  // e mesma parcela repetidos na mesma venda).
  const porId = new Map<string, { externalId: string; saleId: string; method?: string; amount: number; installments?: number; paidAt?: Date }>();
  const vendasTocadas = new Set<string>();
  for (const raw of rows) {
    const d = map.mapPagamento(raw);
    const saleId = saleMap.get(d.externalSaleId);
    if (!saleId) continue;
    // Sufixo de ordem só para pagamento REALMENTE distinto.
    //
    // A identidade já inclui a forma, então um empate aqui é "mesma venda,
    // mesma parcela, mesma forma". Se o VALOR também for igual, é a mesma
    // linha reportada duas vezes pelo conector — e criar `#2` para ela soma o
    // pagamento em dobro. Foi o que a rede mostrou: 3 vendas com a soma das
    // parcelas MAIOR que o total.
    //
    // Valor diferente é pagamento diferente (duas entradas em dinheiro na
    // mesma parcela, por exemplo) e aí o sufixo é o certo. A troca do
    // subcontado pelo sobrecontado seria um mau negócio: faltar dinheiro no
    // relatório levanta pergunta, sobrar dinheiro passa despercebido.
    const base = d.externalId;
    let externalId = base;
    let duplicado = false;
    for (let n = 2; porId.has(externalId); n += 1) {
      if (porId.get(externalId)!.amount === d.amount) {
        duplicado = true;
        break;
      }
      externalId = `${base}#${n}`;
    }
    if (duplicado) continue;
    porId.set(externalId, {
      externalId,
      saleId,
      method: d.method,
      amount: d.amount,
      installments: d.installments,
      paidAt: d.paidAt,
    });
    vendasTocadas.add(saleId);
  }

  // A janela é REESCRITA, não sobreposta. Duas razões, e as duas importam:
  //
  // 1. A chave de identidade mudou nesta versão. Um upsert deixaria as linhas
  //    do esquema antigo para trás, e elas somariam junto com as novas — o
  //    faturamento por forma de pagamento dobraria, em silêncio.
  // 2. Pagamento cancelado ou corrigido no ERP some da resposta, e upsert não
  //    tem como saber disso: a linha velha ficaria no banco para sempre.
  //
  // `Payment` não tem dependentes no schema, então apagar é seguro. Em lotes,
  // porque a janela de 35 dias já traz milhares de vendas.
  const ids = [...vendasTocadas];
  for (const lote of emLotes(ids, 5_000)) {
    await prisma.payment.deleteMany({ where: { saleId: { in: lote } } });
  }
  const novos = [...porId.values()];
  for (const lote of emLotes(novos, 5_000)) {
    await prisma.payment.createMany({ data: lote, skipDuplicates: true });
  }

  return { read: rows.length, written: novos.length };
}

/**
 * Marca como RECONCILED as movimentações internas confirmadas antes do início
 * desta sincronização (`cutoff` = startedAt do run): a partir de agora o saldo
 * da fonte já as reflete, então elas deixam de ser somadas ao estoque "ao
 * vivo". Confirmações ocorridas DURANTE o run ficam para o próximo ciclo.
 * Também recalcula as reservas.
 */
async function reconcileMovements(cutoff: Date) {
  const pending = await prisma.inventoryMovement.findMany({
    where: { status: 'CONFIRMED', confirmedAt: { lt: cutoff } },
    select: { id: true },
  });
  if (pending.length > 0) {
    await prisma.inventoryMovement.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { status: 'RECONCILED', reconciledAt: cutoff },
    });
    // A SEXTA TRANSIÇÃO — e a única que estava calada.
    //
    // As cinco de `movements.service.ts` anunciam; esta não anunciava. Passou
    // despercebida porque o próprio `runSync` publica `sync.completed` no fim
    // do ciclo, e a tela invalida tudo em qualquer evento — a conciliação
    // pegava carona. Carona não é contrato: no dia em que o quadro passar a ser
    // guardado e invalidado por `movement.changed`, a conciliação mudaria o
    // saldo ao vivo (CONFIRMED sai do delta) sem derrubar a foto.
    //
    // UM evento para o lote inteiro, sem loja nem id: são milhares de linhas em
    // todas as lojas, e o que o assinante precisa saber é "movimentação mudou",
    // não quais.
    publish({ type: 'movement.changed' });
  }
  // Recalcula reservas a partir das movimentações ainda pendentes. Upsert:
  // reservas de posições sem linha em StockItem também precisam persistir,
  // senão a disponibilidade fica superestimada.
  await prisma.stockItem.updateMany({ data: { reserved: 0 } });
  const reservations = await prisma.inventoryMovement.groupBy({
    by: ['fromStoreId', 'productId'],
    where: { status: 'PENDING', fromStoreId: { not: null } },
    _sum: { quantity: true },
  });
  for (const r of reservations) {
    if (!r.fromStoreId) continue;
    await prisma.stockItem.upsert({
      where: { storeId_productId: { storeId: r.fromStoreId, productId: r.productId } },
      create: {
        storeId: r.fromStoreId,
        productId: r.productId,
        reserved: r._sum.quantity ?? 0,
      },
      update: { reserved: r._sum.quantity ?? 0 },
    });
  }
  return { read: pending.length, written: pending.length + reservations.length };
}
