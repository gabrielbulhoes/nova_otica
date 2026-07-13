import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { publish } from '../lib/eventBus.js';
import { HttpError } from '../http/helpers.js';
import { getSellbieClient } from '../integrations/sellbie/index.js';
import { checkWindow } from '../integrations/sellbie/window.js';
import * as map from '../integrations/sellbie/mappers.js';

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
    fn: () => Promise<{ read: number; written: number }>,
  ): Promise<void> => {
    try {
      const r = await fn();
      entities[name] = r;
      totalRead += r.read;
      totalWritten += r.written;
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

  return { ok: !hadError, window: win.window, durationMs, entities };
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

async function syncStores(client: Client) {
  const rows = await client.getLojas();
  let written = 0;
  for (const raw of rows) {
    const d = map.mapLoja(raw);
    if (!d.externalId) continue;
    await prisma.store.upsert({
      where: { externalId: d.externalId },
      create: { ...d, syncedAt: new Date() },
      update: { ...d, syncedAt: new Date() },
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

async function syncProducts(client: Client) {
  const rows = await client.getProdutos();
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

async function syncStock(client: Client) {
  const stores = await prisma.store.findMany({ select: { id: true, externalId: true } });
  const products = await productIdMap();
  let read = 0;
  let written = 0;
  for (const store of stores) {
    // A rota de estoque exige cod_loja (idFilial) — uma chamada por loja.
    const rows = await client.getEstoque({ cod_loja: store.externalId, only_disp: 0 });
    read += rows.length;
    for (const raw of rows) {
      const d = map.mapEstoque(raw);
      const productId = products.get(d.externalProductId);
      if (!productId) continue; // produto ainda não cadastrado
      await prisma.stockItem.upsert({
        where: { storeId_productId: { storeId: store.id, productId } },
        create: {
          storeId: store.id,
          productId,
          quantity: d.quantity,
          available: d.available,
          syncedAt: new Date(),
        },
        update: { quantity: d.quantity, available: d.available, syncedAt: new Date() },
      });
      written += 1;
    }
  }
  return { read, written };
}

async function syncSales(client: Client) {
  const rows = await client.getVendas();
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

async function syncSaleItems(client: Client) {
  const rows = await client.getDetalhesVendas();
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

async function syncPayments(client: Client) {
  const rows = await client.getPagamentosVendas();
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
