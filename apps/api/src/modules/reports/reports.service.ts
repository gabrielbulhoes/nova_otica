import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { toNumber } from '../../http/helpers.js';
import {
  abcFromItems,
  buildBrandMix,
  computeCoverage,
  extractBrand,
  isMadeToOrderLens,
  type AbcDimension,
  type AbcResult,
  type BrandBannerInput,
  type CoverageRow,
} from '../planning/planning.math.js';

// A matemática pura da curva ABC vive em planning.math.ts (compartilhada com
// a demo via @planning); reexportada aqui para rotas e testes.
export {
  abcFromItems,
  classifyABC,
  type AbcDimension,
  type AbcItem,
  type AbcResult,
  type AbcRow,
} from '../planning/planning.math.js';

function periodStart(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Curva ABC por receita no período — por SKU ou por MARCA (opcionalmente por loja). */
export async function abcCurve(
  days: number,
  storeId?: string,
  dimension: AbcDimension = 'product',
): Promise<AbcResult> {
  const saleFilter: Prisma.SaleWhereInput = { saleDate: { gte: periodStart(days) } };
  if (storeId) saleFilter.storeId = storeId;

  if (dimension === 'brand') {
    // Marca REAL do produto, extraída da descrição (o campo p.brand carrega o
    // fornecedor). Receita/unidades são reagrupadas por marca extraída.
    const grouped = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: saleFilter, productId: { not: null } },
      _sum: { total: true, quantity: true },
    });
    const products = await prisma.product.findMany({
      where: { id: { in: grouped.map((g) => g.productId as string) } },
      select: { id: true, description: true },
    });
    const descById = new Map(products.map((p) => [p.id, p.description]));
    const byBrand = new Map<string, { revenue: number; units: number }>();
    for (const g of grouped) {
      const brand = extractBrand(descById.get(g.productId as string)) ?? 'Sem marca';
      const cur = byBrand.get(brand) ?? { revenue: 0, units: 0 };
      cur.revenue += toNumber(g._sum.total) ?? 0;
      cur.units += g._sum.quantity ?? 0;
      byBrand.set(brand, cur);
    }
    return abcFromItems(
      [...byBrand.entries()].map(([brand, v]) => ({
        key: brand,
        label: brand,
        brand: null,
        category: null,
        revenue: v.revenue,
        units: v.units,
      })),
      days,
      dimension,
    );
  }

  const grouped = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: { sale: saleFilter, productId: { not: null } },
    _sum: { total: true, quantity: true },
  });
  const products = await prisma.product.findMany({
    where: { id: { in: grouped.map((g) => g.productId as string) } },
    select: { id: true, description: true, brand: true, category: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  return abcFromItems(
    grouped.map((g) => {
      const p = byId.get(g.productId as string);
      return {
        key: g.productId as string,
        label: p?.description ?? '—',
        brand: p?.brand ?? null,
        category: p?.category ?? null,
        revenue: toNumber(g._sum.total) ?? 0,
        units: g._sum.quantity ?? 0,
      };
    }),
    days,
    dimension,
  );
}

// ─── Cobertura de estoque geral e por marca (feedback 06) ────────────────────

export interface BrandCoverageResult {
  days: number;
  /** Linha "GERAL": rede/loja inteira somada. */
  total: CoverageRow;
  rows: CoverageRow[];
}

/**
 * Cobertura por marca: unidades em estoque ÷ média mensal vendida, agregadas
 * pela marca do produto. Produtos sem marca caem no balde "Sem marca" (a
 * grade do CDS não traz fornecedor; o backfill do sistema vivo preenche).
 */
export async function coverageByBrand(days: number, storeId?: string): Promise<BrandCoverageResult> {
  const stockWhere: Prisma.StockItemWhereInput = storeId ? { storeId } : {};
  const [displayStock, sold, netStock] = await Promise.all([
    // Estoque exibido (respeita o filtro de loja).
    prisma.stockItem.groupBy({ by: ['productId'], where: stockWhere, _sum: { quantity: true } }),
    // Vendas do período (respeita o filtro de loja).
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { saleDate: { gte: periodStart(days) }, ...(storeId ? { storeId } : {}) }, productId: { not: null } },
      _sum: { quantity: true },
    }),
    // Estoque da REDE inteira (sem filtro) — decide "lente por encomenda".
    prisma.stockItem.groupBy({ by: ['productId'], _sum: { quantity: true } }),
  ]);

  const netById = new Map(netStock.map((r) => [r.productId, r._sum.quantity ?? 0]));
  const ids = Array.from(new Set([...displayStock.map((r) => r.productId), ...sold.map((r) => r.productId as string)]));
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, description: true, category: true },
  });
  const metaById = new Map(products.map((p) => [p.id, p]));
  const displayById = new Map(displayStock.map((r) => [r.productId, r._sum.quantity ?? 0]));
  const soldById = new Map(sold.map((r) => [r.productId as string, r._sum.quantity ?? 0]));

  const byBrand = new Map<string, { stockUnits: number; unitsSold: number }>();
  for (const id of ids) {
    const meta = metaById.get(id);
    if (!meta) continue;
    // Lente por encomenda (grade da rede = 0) sai da cobertura de estoque.
    if (isMadeToOrderLens(meta.category, netById.get(id) ?? 0)) continue;
    const brand = extractBrand(meta.description) ?? 'Sem marca';
    const cur = byBrand.get(brand) ?? { stockUnits: 0, unitsSold: 0 };
    cur.stockUnits += displayById.get(id) ?? 0;
    cur.unitsSold += soldById.get(id) ?? 0;
    byBrand.set(brand, cur);
  }

  const rows = computeCoverage(
    [...byBrand.entries()].map(([label, v]) => ({ key: label, label, ...v })),
    days,
  );
  const [total] = computeCoverage(
    [
      {
        key: '__total__',
        label: 'GERAL',
        stockUnits: rows.reduce((a, r) => a + r.stockUnits, 0),
        unitsSold: rows.reduce((a, r) => a + r.unitsSold, 0),
      },
    ],
    days,
  );
  return { days, total, rows };
}

// ─── Análise de vendas por dimensão (feedback 10) ────────────────────────────

export type AnalysisDimension = 'brand' | 'category' | 'product' | 'store' | 'seller';

export interface AnalysisRow {
  key: string;
  label: string;
  units: number;
  revenue: number;
}

/** Maior nº de linhas devolvidas (SKUs passam de mil; o front mostra o topo). */
const ANALYSIS_LIMIT = 500;

/**
 * Vendas do período agregadas por marca, grupo (categoria), SKU, loja ou
 * vendedor — SEMPRE com unidades e receita juntas (o front alterna a métrica
 * sem nova consulta). Base = itens de venda (mesma régua em toda dimensão).
 */
export async function salesAnalysis(
  days: number,
  by: AnalysisDimension,
  storeId?: string,
): Promise<{ days: number; by: AnalysisDimension; rows: AnalysisRow[] }> {
  const since = periodStart(days);
  const storeCond = storeId ? Prisma.sql`AND s."storeId" = ${storeId}` : Prisma.empty;

  // SKU agrupa pelo ID do produto (descrições colidem entre modelos).
  if (by === 'product') {
    const grouped = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { saleDate: { gte: since }, ...(storeId ? { storeId } : {}) }, productId: { not: null } },
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: ANALYSIS_LIMIT,
    });
    const products = await prisma.product.findMany({
      where: { id: { in: grouped.map((g) => g.productId as string) } },
      select: { id: true, description: true, sku: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    return {
      days,
      by,
      rows: grouped.map((g) => {
        const p = byId.get(g.productId as string);
        return {
          key: g.productId as string,
          label: p ? `${p.description}${p.sku ? ` (${p.sku})` : ''}` : '—',
          units: g._sum.quantity ?? 0,
          revenue: round2(toNumber(g._sum.total) ?? 0),
        };
      }),
    };
  }

  // Marca: agrupa pela marca REAL extraída da descrição (p.brand = fornecedor).
  if (by === 'brand') {
    const grouped = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { saleDate: { gte: since }, ...(storeId ? { storeId } : {}) }, productId: { not: null } },
      _sum: { quantity: true, total: true },
    });
    const products = await prisma.product.findMany({
      where: { id: { in: grouped.map((g) => g.productId as string) } },
      select: { id: true, description: true },
    });
    const descById = new Map(products.map((p) => [p.id, p.description]));
    const byBrand = new Map<string, { units: number; revenue: number }>();
    for (const g of grouped) {
      const brand = extractBrand(descById.get(g.productId as string)) ?? 'Sem marca';
      const cur = byBrand.get(brand) ?? { units: 0, revenue: 0 };
      cur.units += g._sum.quantity ?? 0;
      cur.revenue += toNumber(g._sum.total) ?? 0;
      byBrand.set(brand, cur);
    }
    const rows = [...byBrand.entries()]
      .map(([brand, v]) => ({ key: brand, label: brand, units: v.units, revenue: round2(v.revenue) }))
      .sort((a, b) => b.units - a.units)
      .slice(0, ANALYSIS_LIMIT);
    return { days, by, rows };
  }

  const select = {
    category: Prisma.sql`p.category`,
    store: Prisma.sql`lo.name`,
    seller: Prisma.sql`se.name`,
  }[by];
  // LEFT JOIN em todas: item sem produto/loja/vendedor vira "Não informado"
  // em vez de sumir — a MESMA base de itens em toda dimensão (totais fecham).
  const join = {
    brand: Prisma.sql`LEFT JOIN "Product" p ON p.id = si."productId"`,
    category: Prisma.sql`LEFT JOIN "Product" p ON p.id = si."productId"`,
    store: Prisma.sql`LEFT JOIN "Store" lo ON lo.id = s."storeId"`,
    seller: Prisma.sql`LEFT JOIN "Seller" se ON se.id = s."sellerId"`,
  }[by];

  const grouped = await prisma.$queryRaw<{ label: string | null; units: bigint; revenue: number }[]>(
    Prisma.sql`
      SELECT ${select} AS label,
             COALESCE(SUM(si.quantity), 0)::bigint AS units,
             COALESCE(SUM(si.total), 0)::float AS revenue
      FROM "SaleItem" si
      JOIN "Sale" s ON s.id = si."saleId"
      ${join}
      WHERE s."saleDate" >= ${since}
      ${storeCond}
      GROUP BY ${select}
      ORDER BY units DESC
      LIMIT ${ANALYSIS_LIMIT}
    `,
  );

  return {
    days,
    by,
    rows: grouped.map((g) => ({
      key: g.label ?? '—',
      label: g.label ?? 'Não informado',
      units: Number(g.units),
      revenue: round2(g.revenue),
    })),
  };
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

  // Estoque da rede (sem filtro) — exclui lentes por encomenda do giro.
  const netStock = await prisma.stockItem.groupBy({ by: ['productId'], _sum: { quantity: true } });
  const netById = new Map(netStock.map((n) => [n.productId, n._sum.quantity ?? 0]));

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
    .filter((r) => !isMadeToOrderLens(r.category, netById.get(r.productId) ?? 0))
    .sort((a, b) => b.turnover - a.turnover);

  return { days, rows };
}

// ─── Mix de marcas por bandeira (feedback 04 fase 2) ─────────────────────────

/**
 * Estoque e vendas de cada marca por LOJA (o buildBrandMix agrega em
 * bandeiras a partir do nome). LEFT JOIN: produto sem marca vira "Sem marca".
 */
export async function brandMix(days: number) {
  const [stockRows, soldRows, stores] = await Promise.all([
    prisma.$queryRaw<{ storeId: string; brand: string | null; units: bigint }[]>(Prisma.sql`
      SELECT st."storeId" AS "storeId", p.brand AS brand, COALESCE(SUM(st.quantity), 0)::bigint AS units
      FROM "StockItem" st
      LEFT JOIN "Product" p ON p.id = st."productId"
      GROUP BY st."storeId", p.brand
    `),
    prisma.$queryRaw<{ storeId: string | null; brand: string | null; units: bigint }[]>(Prisma.sql`
      SELECT s."storeId" AS "storeId", p.brand AS brand, COALESCE(SUM(si.quantity), 0)::bigint AS units
      FROM "SaleItem" si
      JOIN "Sale" s ON s.id = si."saleId"
      LEFT JOIN "Product" p ON p.id = si."productId"
      WHERE s."saleDate" >= ${periodStart(days)}
      GROUP BY s."storeId", p.brand
    `),
    prisma.store.findMany({ select: { id: true, name: true } }),
  ]);
  const nameById = new Map(stores.map((s) => [s.id, s.name]));

  const acc = new Map<string, BrandBannerInput>();
  const bump = (storeId: string | null, brand: string | null, field: 'stockUnits' | 'unitsSold', units: number) => {
    const storeName = storeId ? nameById.get(storeId) ?? 'Sem loja' : 'Sem loja';
    const key = `${storeName}|${brand ?? ''}`;
    const cur = acc.get(key) ?? { storeName, brand: brand ?? '', stockUnits: 0, unitsSold: 0 };
    cur[field] += units;
    acc.set(key, cur);
  };
  for (const r of stockRows) bump(r.storeId, r.brand, 'stockUnits', Number(r.units));
  for (const r of soldRows) bump(r.storeId, r.brand, 'unitsSold', Number(r.units));

  return { days, ...buildBrandMix([...acc.values()]) };
}
