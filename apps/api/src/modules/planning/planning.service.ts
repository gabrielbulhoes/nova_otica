import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { toNumber } from '../../http/helpers.js';
import {
  analyzeProduct,
  buildOverview,
  buildSuggestions,
  type ProductMetricsInput,
  type ProductPlan,
} from './planning.math.js';

function periodStart(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Coleta, por produto, os insumos de planejamento no escopo (rede ou loja):
 * unidades vendidas no período, estoque atual, custo e preço.
 * Quando o custo não está preenchido, estima-se 55% do preço (margem típica).
 */
export async function planningInputs(days: number, storeId?: string): Promise<ProductMetricsInput[]> {
  const saleFilter: Prisma.SaleWhereInput = { saleDate: { gte: periodStart(days) } };
  if (storeId) saleFilter.storeId = storeId;

  const sold = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: { sale: saleFilter, productId: { not: null } },
    _sum: { quantity: true },
  });
  const soldBy = new Map(sold.map((s) => [s.productId as string, s._sum.quantity ?? 0]));

  const stockWhere: Prisma.StockItemWhereInput = {};
  if (storeId) stockWhere.storeId = storeId;
  const stock = await prisma.stockItem.groupBy({
    by: ['productId'],
    where: stockWhere,
    _sum: { quantity: true },
  });
  const stockBy = new Map(stock.map((s) => [s.productId, s._sum.quantity ?? 0]));

  const ids = Array.from(new Set([...soldBy.keys(), ...stockBy.keys()]));
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, description: true, brand: true, category: true, price: true, cost: true },
  });

  return products.map((p) => {
    const price = toNumber(p.price) ?? 0;
    const cost = toNumber(p.cost) ?? round2(price * 0.55);
    return {
      productId: p.id,
      description: p.description,
      brand: p.brand,
      category: p.category,
      unitsSold: soldBy.get(p.id) ?? 0,
      currentStock: stockBy.get(p.id) ?? 0,
      unitCost: cost,
      unitPrice: price,
    };
  });
}

async function plans(days: number, storeId?: string): Promise<ProductPlan[]> {
  const inputs = await planningInputs(days, storeId);
  return inputs.map((i) => analyzeProduct(i, days));
}

/** Panorama de capital imobilizado + Pareto (80/20) da receita. */
export async function planningOverview(days: number, storeId?: string) {
  return buildOverview(await plans(days, storeId), days);
}

/** Recomendações de compra (comprar / manter / não comprar / liquidar). */
export async function purchaseSuggestions(days: number, storeId?: string) {
  return buildSuggestions(await plans(days, storeId), days);
}
