import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { toNumber } from '../../http/helpers.js';
import { bucketSalesByDay, deriveKpis, round2, type DayBucket, type Kpis } from './bi.math.js';

function periodStart(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

/** Indicadores agregados da rede/loja no período. */
export async function getKpis(days: number, storeId?: string): Promise<Kpis> {
  const start = periodStart(days);
  const saleWhere: Prisma.SaleWhereInput = { saleDate: { gte: start } };
  if (storeId) saleWhere.storeId = storeId;

  const stockWhere: Prisma.StockItemWhereInput = {};
  if (storeId) stockWhere.storeId = storeId;

  const movementWhere: Prisma.InventoryMovementWhereInput = {
    status: { in: ['REQUESTED', 'PENDING'] },
  };
  if (storeId) movementWhere.OR = [{ fromStoreId: storeId }, { toStoreId: storeId }];

  const [salesAgg, soldAgg, stockAgg, items, pendingTransfers] = await Promise.all([
    prisma.sale.aggregate({ where: saleWhere, _sum: { total: true }, _count: true }),
    prisma.saleItem.aggregate({ where: { sale: saleWhere }, _sum: { quantity: true } }),
    prisma.stockItem.aggregate({ where: stockWhere, _sum: { quantity: true } }),
    prisma.stockItem.findMany({
      where: stockWhere,
      select: { quantity: true, product: { select: { minStock: true } } },
    }),
    prisma.inventoryMovement.count({ where: movementWhere }),
  ]);

  let outOfStock = 0;
  let lowStock = 0;
  for (const it of items) {
    const threshold = it.product.minStock ?? env.DEFAULT_MIN_STOCK;
    if (it.quantity <= 0) outOfStock += 1;
    else if (it.quantity <= threshold) lowStock += 1;
  }

  return deriveKpis({
    revenue: round2(toNumber(salesAgg._sum.total) ?? 0),
    salesCount: salesAgg._count,
    stockUnits: stockAgg._sum.quantity ?? 0,
    unitsSold: soldAgg._sum.quantity ?? 0,
    stockPositions: items.length,
    outOfStock,
    lowStock,
    pendingTransfers,
  });
}

/** Série temporal diária de vendas (com dias sem venda preenchidos com zero). */
export async function getSalesTimeseries(
  days: number,
  storeId?: string,
): Promise<{ days: number; granularity: 'day'; points: DayBucket[] }> {
  const start = periodStart(days);
  const where: Prisma.SaleWhereInput = { saleDate: { gte: start } };
  if (storeId) where.storeId = storeId;

  const sales = await prisma.sale.findMany({ where, select: { saleDate: true, total: true } });
  const points = bucketSalesByDay(
    sales.map((s) => ({ saleDate: s.saleDate, total: toNumber(s.total) ?? 0 })),
    days,
    new Date(),
  );
  return { days, granularity: 'day', points };
}

export type Dimension = 'store' | 'category' | 'brand' | 'payment';

export interface DimensionRow {
  key: string;
  label: string;
  total: number;
  count: number;
}

/** Vendas agregadas por dimensão (loja, categoria, marca ou pagamento). */
export async function getSalesByDimension(
  days: number,
  by: Dimension,
  storeId?: string,
): Promise<{ by: Dimension; rows: DimensionRow[] }> {
  const start = periodStart(days);
  const saleWhere: Prisma.SaleWhereInput = { saleDate: { gte: start } };
  if (storeId) saleWhere.storeId = storeId;

  let rows: DimensionRow[] = [];

  if (by === 'store') {
    const grouped = await prisma.sale.groupBy({
      by: ['storeId'],
      where: saleWhere,
      _sum: { total: true },
      _count: true,
    });
    const stores = await prisma.store.findMany({ select: { id: true, name: true } });
    const nameById = new Map(stores.map((s) => [s.id, s.name]));
    rows = grouped.map((g) => ({
      key: g.storeId ?? 'none',
      label: g.storeId ? nameById.get(g.storeId) ?? 'Sem loja' : 'Sem loja',
      total: round2(toNumber(g._sum.total) ?? 0),
      count: g._count,
    }));
  } else if (by === 'payment') {
    const grouped = await prisma.payment.groupBy({
      by: ['method'],
      where: { sale: saleWhere },
      _sum: { amount: true },
      _count: true,
    });
    rows = grouped.map((g) => ({
      key: g.method ?? 'none',
      label: g.method ?? 'Não informado',
      total: round2(toNumber(g._sum.amount) ?? 0),
      count: g._count,
    }));
  } else {
    // category | brand — agrega via item de venda + produto (relação).
    const itemsSold = await prisma.saleItem.findMany({
      where: { sale: saleWhere },
      select: { total: true, product: { select: { category: true, brand: true } } },
    });
    const acc = new Map<string, { total: number; count: number }>();
    for (const it of itemsSold) {
      const raw = by === 'category' ? it.product?.category : it.product?.brand;
      const key = raw ?? 'none';
      const cur = acc.get(key) ?? { total: 0, count: 0 };
      cur.total = round2(cur.total + (toNumber(it.total) ?? 0));
      cur.count += 1;
      acc.set(key, cur);
    }
    rows = Array.from(acc.entries()).map(([key, v]) => ({
      key,
      label: key === 'none' ? 'Não classificado' : key,
      total: v.total,
      count: v.count,
    }));
  }

  rows.sort((a, b) => b.total - a.total);
  return { by, rows };
}
