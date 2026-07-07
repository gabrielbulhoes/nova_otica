import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest, toNumber } from '../../http/helpers.js';
import {
  analyzeProduct,
  buildOverview,
  buildRebalance,
  buildSuggestions,
  DEFAULT_PLANNING_CONFIG,
  type PlanningConfig,
  type ProductMetricsInput,
  type ProductPlan,
  type StoreProductInput,
} from './planning.math.js';

function periodStart(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Prazos por fornecedor (marca): devolve uma função brand → config, com o
 * padrão da rede como fallback. Cada fornecedor entrega num prazo próprio,
 * então o ponto de reposição e o "pedir até" variam por marca.
 */
async function supplierConfigResolver(): Promise<(brand: string | null) => PlanningConfig> {
  const settings = await prisma.supplierSetting.findMany();
  const byBrand = new Map(settings.map((s) => [s.brand, s.leadTimeDays]));
  return (brand) => {
    const leadTimeDays = brand !== null ? byBrand.get(brand) : undefined;
    return leadTimeDays === undefined
      ? DEFAULT_PLANNING_CONFIG
      : { ...DEFAULT_PLANNING_CONFIG, leadTimeDays };
  };
}

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
  const [inputs, cfgFor] = await Promise.all([planningInputs(days, storeId), supplierConfigResolver()]);
  return inputs.map((i) => analyzeProduct(i, days, cfgFor(i.brand)));
}

/** Panorama de capital imobilizado + Pareto (80/20) da receita. */
export async function planningOverview(days: number, storeId?: string) {
  return buildOverview(await plans(days, storeId), days);
}

/** Recomendações de compra (comprar / manter / não comprar / liquidar). */
export async function purchaseSuggestions(days: number, storeId?: string) {
  return buildSuggestions(await plans(days, storeId), days);
}

/**
 * Redistribuição entre lojas: cruza vendas do período × estoque atual por
 * loja e sugere transferências de onde sobra/está parado para onde vende.
 */
export async function rebalancePlan(days: number) {
  const [sold, stock, stores, cfgFor] = await Promise.all([
    prisma.saleItem.findMany({
      where: {
        productId: { not: null },
        sale: { saleDate: { gte: periodStart(days) }, storeId: { not: null } },
      },
      select: { productId: true, quantity: true, sale: { select: { storeId: true } } },
    }),
    prisma.stockItem.findMany({ select: { storeId: true, productId: true, quantity: true } }),
    prisma.store.findMany({ select: { id: true, name: true } }),
    supplierConfigResolver(),
  ]);

  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const key = (storeId: string, productId: string) => `${storeId}:${productId}`;

  const positions = new Map<string, { storeId: string; productId: string; stock: number; sold: number }>();
  for (const s of stock) {
    positions.set(key(s.storeId, s.productId), {
      storeId: s.storeId,
      productId: s.productId,
      stock: s.quantity,
      sold: 0,
    });
  }
  for (const it of sold) {
    const sid = it.sale.storeId;
    if (!sid || !it.productId) continue;
    const k = key(sid, it.productId);
    const cur = positions.get(k) ?? { storeId: sid, productId: it.productId, stock: 0, sold: 0 };
    cur.sold += it.quantity;
    positions.set(k, cur);
  }

  const productIds = Array.from(new Set(Array.from(positions.values()).map((p) => p.productId)));
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, description: true, brand: true },
  });
  const productBy = new Map(products.map((p) => [p.id, p]));

  const inputs: StoreProductInput[] = [];
  for (const pos of positions.values()) {
    const product = productBy.get(pos.productId);
    if (!product) continue;
    inputs.push({
      storeId: pos.storeId,
      storeName: storeName.get(pos.storeId) ?? '—',
      productId: pos.productId,
      description: product.description,
      brand: product.brand,
      unitsSold: pos.sold,
      currentStock: pos.stock,
    });
  }

  return buildRebalance(inputs, days, cfgFor);
}

/** Fornecedores (marcas) com seus prazos: cadastrados ou padrão da rede. */
export async function listSupplierSettings() {
  const [brands, settings] = await Promise.all([
    prisma.product.groupBy({ by: ['brand'], where: { brand: { not: null } }, _count: true }),
    prisma.supplierSetting.findMany(),
  ]);
  const byBrand = new Map(settings.map((s) => [s.brand, s.leadTimeDays]));
  const rows = brands
    .map((b) => ({
      brand: b.brand as string,
      leadTimeDays: byBrand.get(b.brand as string) ?? null,
      products: b._count,
      isDefault: !byBrand.has(b.brand as string),
    }))
    .sort((a, b) => a.brand.localeCompare(b.brand));
  return { defaultLeadTimeDays: DEFAULT_PLANNING_CONFIG.leadTimeDays, rows };
}

/** Define (ou remove, com null) o prazo de um fornecedor/marca. */
export async function setSupplierLeadTime(brand: string, leadTimeDays: number | null) {
  const clean = brand.trim();
  if (!clean) throw badRequest('Informe a marca/fornecedor.');
  if (leadTimeDays === null) {
    await prisma.supplierSetting.deleteMany({ where: { brand: clean } });
    return { brand: clean, leadTimeDays: null };
  }
  if (!Number.isInteger(leadTimeDays) || leadTimeDays < 1 || leadTimeDays > 365) {
    throw badRequest('Prazo do fornecedor deve ser um número inteiro entre 1 e 365 dias.');
  }
  const row = await prisma.supplierSetting.upsert({
    where: { brand: clean },
    create: { brand: clean, leadTimeDays },
    update: { leadTimeDays },
  });
  return { brand: row.brand, leadTimeDays: row.leadTimeDays };
}
