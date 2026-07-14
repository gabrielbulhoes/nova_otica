import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { toNumber } from '../../http/helpers.js';

/**
 * Cálculo puro do saldo ao vivo de um item:
 * - onHand = base sincronizada + ajuste de movimentações confirmadas;
 * - availableNow = onHand − reservado (nunca negativo).
 */
export function computeLiveStock(quantity: number, reserved: number, pendingDelta: number) {
  const onHand = quantity + pendingDelta;
  const availableNow = Math.max(onHand - reserved, 0);
  return { onHand, availableNow };
}

export interface StockFilter {
  /** Uma ou mais lojas (multi-seleção do filtro). */
  storeIds?: string[];
  productId?: string;
  search?: string;
  /** Uma ou mais categorias (multi-seleção do filtro). */
  categories?: string[];
  onlyAvailable?: boolean;
  limit: number;
  skip: number;
}

export interface StockRow {
  storeId: string;
  storeName: string;
  productId: string;
  productExternalId: string;
  description: string;
  brand: string | null;
  category: string | null;
  price: number | null;
  /** Estoque mínimo do produto (nulo = usa o padrão da rede). */
  minStock: number | null;
  /** Mínimo específico desta loja (sobrepõe o do produto quando definido). */
  storeMinStock: number | null;
  /** Quantidade da última sincronização da fonte. */
  synced: number;
  /** Reservado por movimentações internas pendentes. */
  reserved: number;
  /** Ajuste por movimentações internas confirmadas e ainda não reconciliadas. */
  pendingDelta: number;
  /** Saldo "ao vivo" = synced + pendingDelta. */
  onHand: number;
  /** Disponível para venda = onHand - reserved. */
  availableNow: number;
  syncedAt: string | null;
}

/**
 * Delta por (storeId, productId) gerado pelas movimentações internas
 * confirmadas e ainda não reconciliadas: entradas somam, saídas subtraem.
 */
async function liveDeltas(): Promise<Map<string, number>> {
  const deltas = new Map<string, number>();
  const add = (storeId: string | null, productId: string, qty: number) => {
    if (!storeId) return;
    const key = `${storeId}:${productId}`;
    deltas.set(key, (deltas.get(key) ?? 0) + qty);
  };

  const inbound = await prisma.inventoryMovement.groupBy({
    by: ['toStoreId', 'productId'],
    where: { status: 'CONFIRMED', toStoreId: { not: null } },
    _sum: { quantity: true },
  });
  for (const r of inbound) add(r.toStoreId, r.productId, r._sum.quantity ?? 0);

  const outbound = await prisma.inventoryMovement.groupBy({
    by: ['fromStoreId', 'productId'],
    where: { status: 'CONFIRMED', fromStoreId: { not: null } },
    _sum: { quantity: true },
  });
  for (const r of outbound) add(r.fromStoreId, r.productId, -(r._sum.quantity ?? 0));

  return deltas;
}

/** Lista o estoque consolidado com saldo ao vivo. */
export async function listStock(filter: StockFilter): Promise<{ total: number; rows: StockRow[] }> {
  const where: Prisma.StockItemWhereInput = {};
  if (filter.storeIds?.length) where.storeId = { in: filter.storeIds };
  if (filter.productId) where.productId = filter.productId;
  if (filter.search || filter.categories?.length) {
    where.product = {
      ...(filter.categories?.length ? { category: { in: filter.categories } } : {}),
      ...(filter.search
        ? {
            OR: [
              { description: { contains: filter.search, mode: 'insensitive' } },
              { sku: { contains: filter.search, mode: 'insensitive' } },
              { externalId: { contains: filter.search, mode: 'insensitive' } },
              { brand: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  const [total, items, deltas] = await Promise.all([
    prisma.stockItem.count({ where }),
    prisma.stockItem.findMany({
      where,
      include: { store: true, product: true },
      orderBy: [{ product: { description: 'asc' } }, { store: { name: 'asc' } }],
      take: filter.limit,
      skip: filter.skip,
    }),
    liveDeltas(),
  ]);

  let rows: StockRow[] = items.map((it) => {
    const pendingDelta = deltas.get(`${it.storeId}:${it.productId}`) ?? 0;
    const { onHand, availableNow } = computeLiveStock(it.quantity, it.reserved, pendingDelta);
    return {
      storeId: it.storeId,
      storeName: it.store.name,
      productId: it.productId,
      productExternalId: it.product.externalId,
      description: it.product.description,
      brand: it.product.brand,
      category: it.product.category,
      price: toNumber(it.product.price),
      minStock: it.product.minStock,
      storeMinStock: it.minStock,
      synced: it.quantity,
      reserved: it.reserved,
      pendingDelta,
      onHand,
      availableNow,
      syncedAt: it.syncedAt ? it.syncedAt.toISOString() : null,
    };
  });

  if (filter.onlyAvailable) rows = rows.filter((r) => r.availableNow > 0);

  return { total, rows };
}

/** Resumo do estoque por produto somando todas as lojas (visão de rede). */
export async function stockByProduct(search?: string, categories?: string[]) {
  const { rows } = await listStock({
    search,
    categories,
    limit: 100_000,
    skip: 0,
  });
  const byProduct = new Map<string, {
    productId: string;
    productExternalId: string;
    description: string;
    brand: string | null;
    category: string | null;
    price: number | null;
    totalOnHand: number;
    totalAvailable: number;
    stores: number;
  }>();
  for (const r of rows) {
    const cur = byProduct.get(r.productId) ?? {
      productId: r.productId,
      productExternalId: r.productExternalId,
      description: r.description,
      brand: r.brand,
      category: r.category,
      price: r.price,
      totalOnHand: 0,
      totalAvailable: 0,
      stores: 0,
    };
    cur.totalOnHand += r.onHand;
    cur.totalAvailable += r.availableNow;
    if (r.onHand > 0) cur.stores += 1;
    byProduct.set(r.productId, cur);
  }
  return Array.from(byProduct.values()).sort((a, b) => b.totalAvailable - a.totalAvailable);
}
