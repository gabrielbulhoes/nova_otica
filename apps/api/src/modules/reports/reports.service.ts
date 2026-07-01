import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { toNumber } from '../../http/helpers.js';

function periodStart(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/** Classificação ABC de um item a partir do % acumulado de receita. */
export function classifyABC(cumulativePct: number): 'A' | 'B' | 'C' {
  if (cumulativePct <= 80) return 'A';
  if (cumulativePct <= 95) return 'B';
  return 'C';
}

export interface AbcRow {
  productId: string;
  description: string;
  brand: string | null;
  category: string | null;
  revenue: number;
  units: number;
  revenuePct: number;
  cumulativePct: number;
  class: 'A' | 'B' | 'C';
}

/** Curva ABC por receita no período (opcionalmente por loja). */
export async function abcCurve(days: number, storeId?: string): Promise<{
  days: number;
  totalRevenue: number;
  summary: Record<'A' | 'B' | 'C', { products: number; revenue: number }>;
  rows: AbcRow[];
}> {
  const saleFilter: Prisma.SaleWhereInput = { saleDate: { gte: periodStart(days) } };
  if (storeId) saleFilter.storeId = storeId;

  const grouped = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: { sale: saleFilter, productId: { not: null } },
    _sum: { total: true, quantity: true },
  });

  const items = grouped
    .map((g) => ({
      productId: g.productId as string,
      revenue: toNumber(g._sum.total) ?? 0,
      units: g._sum.quantity ?? 0,
    }))
    .filter((i) => i.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = items.reduce((s, i) => s + i.revenue, 0);

  const products = await prisma.product.findMany({
    where: { id: { in: items.map((i) => i.productId) } },
    select: { id: true, description: true, brand: true, category: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const summary = {
    A: { products: 0, revenue: 0 },
    B: { products: 0, revenue: 0 },
    C: { products: 0, revenue: 0 },
  };

  let cumulative = 0;
  const rows: AbcRow[] = items.map((i) => {
    const revenuePct = totalRevenue > 0 ? (i.revenue / totalRevenue) * 100 : 0;
    cumulative += revenuePct;
    const klass = classifyABC(cumulative);
    summary[klass].products += 1;
    summary[klass].revenue += i.revenue;
    const p = byId.get(i.productId);
    return {
      productId: i.productId,
      description: p?.description ?? '—',
      brand: p?.brand ?? null,
      category: p?.category ?? null,
      revenue: Math.round(i.revenue * 100) / 100,
      units: i.units,
      revenuePct: Math.round(revenuePct * 100) / 100,
      cumulativePct: Math.round(cumulative * 100) / 100,
      class: klass,
    };
  });

  return { days, totalRevenue: Math.round(totalRevenue * 100) / 100, summary, rows };
}

export interface TurnoverRow {
  productId: string;
  description: string;
  brand: string | null;
  category: string | null;
  unitsSold: number;
  currentStock: number;
  turnover: number; // giro no período (unidades vendidas / estoque atual)
  daysOfInventory: number | null; // dias estimados de cobertura
}

/**
 * Giro de estoque no período. Como só há o snapshot atual da fonte, usa-se o
 * estoque atual como aproximação do estoque médio (limitação documentada).
 */
export async function inventoryTurnover(days: number, storeId?: string): Promise<{
  days: number;
  rows: TurnoverRow[];
}> {
  const saleFilter: Prisma.SaleWhereInput = { saleDate: { gte: periodStart(days) } };
  if (storeId) saleFilter.storeId = storeId;

  const sold = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: { sale: saleFilter, productId: { not: null } },
    _sum: { quantity: true },
  });
  const soldByProduct = new Map(sold.map((s) => [s.productId as string, s._sum.quantity ?? 0]));

  const stockWhere: Prisma.StockItemWhereInput = {};
  if (storeId) stockWhere.storeId = storeId;
  const stock = await prisma.stockItem.groupBy({
    by: ['productId'],
    where: stockWhere,
    _sum: { quantity: true },
  });
  const stockByProduct = new Map(stock.map((s) => [s.productId, s._sum.quantity ?? 0]));

  const productIds = Array.from(new Set([...soldByProduct.keys(), ...stockByProduct.keys()]));
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, description: true, brand: true, category: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const rows: TurnoverRow[] = productIds
    .map((id) => {
      const unitsSold = soldByProduct.get(id) ?? 0;
      const currentStock = stockByProduct.get(id) ?? 0;
      const avg = Math.max(currentStock, 1);
      const turnover = Math.round((unitsSold / avg) * 100) / 100;
      const daysOfInventory =
        unitsSold > 0 ? Math.round((currentStock / (unitsSold / days)) * 10) / 10 : null;
      const p = byId.get(id);
      return {
        productId: id,
        description: p?.description ?? '—',
        brand: p?.brand ?? null,
        category: p?.category ?? null,
        unitsSold,
        currentStock,
        turnover,
        daysOfInventory,
      };
    })
    .filter((r) => r.unitsSold > 0 || r.currentStock > 0)
    .sort((a, b) => b.turnover - a.turnover);

  return { days, rows };
}
