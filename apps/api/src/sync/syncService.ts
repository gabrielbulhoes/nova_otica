import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { publish } from '../lib/eventBus.js';
import { notifySyncFailure } from '../lib/opsAlert.js';
import { HttpError } from '../http/helpers.js';
import { getSellbieClient } from '../integrations/sellbie/index.js';
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
  const track = async (
    name: string,
    fn: () => Promise<{ read: number; written: number; error?: string }>,
    opts: { countTotals?: boolean } = {},
  ): Promise<void> => {
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
export async function backfillSalesHistory(months: number): Promise<SyncResult['entities']> {
  const client = getSellbieClient();
  const entities: SyncResult['entities'] = {};
  const now = new Date();
  for (let i = months; i >= 0; i -= 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const range = {
      date_start: start.toISOString().slice(0, 10),
      date_end: end.toISOString().slice(0, 10),
    };
    const label = range.date_start.slice(0, 7);
    try {
      const sales = await syncSales(client, range);
      const items = await syncSaleItems(client, range);
      const payments = await syncPayments(client, range);
      entities[label] = {
        read: sales.read + items.read + payments.read,
        written: sales.written + items.written + payments.written,
      };
      log.info('Backfill de vendas: mês concluído', { mes: label, ...entities[label] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      entities[label] = { read: 0, written: 0, error: message };
      log.error('Backfill de vendas: mês falhou', { mes: label, error: message });
    }
  }
  return entities;
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

async function syncStores(client: Client) {
  const rows = await client.getLojas();
  let written = 0;
  for (const raw of rows) {
    const d = map.mapLoja(raw);
    if (!d.externalId) continue;
    const excludeFromPlanning = cdPattern ? cdPattern.test(d.name ?? '') : false;
    await prisma.store.upsert({
      where: { externalId: d.externalId },
      create: { ...d, excludeFromPlanning, syncedAt: new Date() },
      update: { ...d, excludeFromPlanning, syncedAt: new Date() },
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

async function syncCustomers(client: Client) {
  const rows = await client.getClientes();
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

/**
 * Lê /cds/estoquegrade em lotes de produtos.
 *
 * A rota devolve o estoque da rede inteira aninhado por filial, mas está
 * sujeita ao mesmo teto silencioso das outras: uma chamada única traria só o
 * começo. Ela não aceita filtro de data — o que ela aceita é `cod_prod` como
 * lista CSV, e é esse o pedaço com que se fatia.
 *
 * O catálogo local é a lista de códigos a pedir. Sem catálogo (primeira carga,
 * ordem invertida), cai na chamada única de antes: melhor um estoque parcial
 * que nenhum.
 */
async function lerEstoqueGrade(codigos: string[], client: Client) {
  if (codigos.length === 0) {
    log.warn('Estoque: catálogo local vazio, lendo a grade em chamada única');
    return client.getEstoqueGrade();
  }

  const lotes = emLotes(codigos, env.SELLBIE_STOCK_CHUNK);
  const porLinha = new Map<string, SellbieEstoqueGrade>();
  let chamadas = 0;

  for (const lote of lotes) {
    const parte = await client.getEstoqueGrade({ cod_prod: lote.join(',') });
    chamadas += 1;

    // Guarda contra filtro ignorado: se o conector devolver majoritariamente
    // códigos que não foram pedidos, `cod_prod` não está sendo aplicado e
    // repetir isso 87 vezes seria puxar a mesma resposta truncada 87 vezes.
    // A verificação roda só no primeiro lote — é onde ela decide alguma coisa.
    if (chamadas === 1 && parte.length > 0) {
      const pedidos = new Set(lote);
      const forasteiros = parte.filter((g) => !pedidos.has(map.idStr(g.CODIGO))).length;
      if (forasteiros > parte.length / 2) {
        log.warn('Estoque: o conector ignorou cod_prod; voltando à chamada única', {
          pedidos: lote.length,
          recebidos: parte.length,
          forasteiros,
        });
        return client.getEstoqueGrade();
      }
    }

    // Identidade da linha é produto×variante (GRADE) — o mesmo produto tem
    // uma linha por cor/tamanho e todas somam no mesmo saldo por loja.
    for (const g of parte) porLinha.set(`${map.idStr(g.CODIGO)}|${map.idStr(g.GRADE)}`, g);
  }

  log.info('Estoque: grade lida em lotes', {
    lotes: lotes.length,
    chamadas,
    produtosPedidos: codigos.length,
    linhas: porLinha.size,
  });
  return [...porLinha.values()];
}

async function syncStock(client: Client) {
  // Fonte: /cds/estoquegrade — cada linha é produto×variante com o estoque
  // aninhado por filial. As variantes (GRADE) do mesmo produto são somadas
  // por loja.
  const stores = await storeIdMap();
  const products = await productIdMap();
  const rows = await lerEstoqueGrade([...products.keys()], client);

  // Produtos que a grade conhece e o catálogo não. Antes eles viravam posição
  // descartada; agora viram um cadastro magro derivado da própria grade, e a
  // unidade que existe na prateleira passa a existir no painel. Se o catálogo
  // vier completo, este laço não faz nada — é fallback, não caminho normal.
  const orfaos = new Map<string, SellbieEstoqueGrade>();
  for (const raw of rows) {
    const codigo = map.idStr(raw.CODIGO);
    if (codigo && !products.has(codigo) && !orfaos.has(codigo)) orfaos.set(codigo, raw);
  }
  if (orfaos.size > 0) {
    for (const raw of orfaos.values()) {
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
      criados: orfaos.size,
    });
  }

  const byStoreProduct = new Map<string, number>(); // "loja|produto" -> qtd
  for (const raw of rows) {
    for (const pos of map.mapEstoqueGrade(raw)) {
      const key = `${pos.externalStoreId}|${pos.externalProductId}`;
      byStoreProduct.set(key, (byStoreProduct.get(key) ?? 0) + pos.quantity);
    }
  }

  let written = 0;
  let skipped = 0;
  for (const [key, quantity] of byStoreProduct) {
    const [externalStoreId, externalProductId] = key.split('|');
    const storeId = stores.get(externalStoreId);
    const productId = products.get(externalProductId);
    if (!storeId || !productId) {
      skipped += 1; // loja ainda não cadastrada (ex.: registro de teste do ERP)
      continue;
    }
    await prisma.stockItem.upsert({
      where: { storeId_productId: { storeId, productId } },
      create: { storeId, productId, quantity, available: quantity, syncedAt: new Date() },
      update: { quantity, available: quantity, syncedAt: new Date() },
    });
    written += 1;
  }
  if (skipped > 0) log.warn('Posições de estoque ignoradas (loja desconhecida)', { skipped });
  return { read: rows.length, written };
}

async function syncSales(client: Client, range?: { date_start: string; date_end: string }) {
  const rows = await client.getVendas(range);
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
  const rows = await client.getDetalhesVendas(range);
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
  const rows = await client.getPagamentosVendas(range);
  const sales = await prisma.sale.findMany({ select: { id: true, externalId: true } });
  const saleMap = new Map(sales.map((s) => [s.externalId, s.id]));
  let written = 0;
  for (const raw of rows) {
    const d = map.mapPagamento(raw);
    const saleId = saleMap.get(d.externalSaleId);
    if (!saleId) continue;
    const data = {
      saleId,
      method: d.method,
      amount: d.amount,
      installments: d.installments,
      paidAt: d.paidAt,
    };
    if (d.externalId) {
      await prisma.payment.upsert({
        where: { externalId: d.externalId },
        create: { externalId: d.externalId, ...data },
        update: data,
      });
    } else {
      await prisma.payment.create({ data });
    }
    written += 1;
  }
  return { read: rows.length, written };
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
