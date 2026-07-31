import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { toNumber } from '../../http/helpers.js';
import { PLANNED_STORE_WHERE, stockPlannedWhere } from '../stores/store.scope.js';
import { productWhereForGroup, scopeCategories } from '../products/product.scope.js';
import {
  abcFromItems,
  buildBrandMix,
  computeCoverage,
  extractBrand,
  isBrandAnalysable,
  isMadeToOrderLens,
  type AbcDimension,
  type AbcResult,
  type BrandBannerInput,
  type CoverageRow,
  type ProductGroup,
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

/**
 * Recorte de produto dos relatórios: o grupo do console (óculos/lente/tudo)
 * INTERSECTADO com o tipo de produto escolhido na tela. Sai daqui como um
 * `where` de Prisma para entrar no findMany dos metadados — quem não está no
 * recorte simplesmente não aparece no mapa e cai fora do relatório.
 */
async function productScopeWhere(
  group: ProductGroup,
  categories?: string[],
): Promise<Prisma.ProductWhereInput> {
  return scopeCategories(await productWhereForGroup(group), categories) ?? {};
}

/**
 * Marca de exibição de um produto, na ordem de confiança:
 *  1. marca REAL extraída da descrição (grifes de armação/óculos/relógio);
 *  2. fornecedor (p.brand) — é o dado bom em LENTE, onde a descrição é a
 *     linha do produto e extrair dali fragmenta o fabricante;
 *  3. "Sem marca".
 */
function brandOf(
  p?: { description: string | null; brand: string | null; category: string | null } | null,
): string {
  if (!p) return 'Sem marca';
  return extractBrand(p.description, p.category) ?? p.brand?.trim() ?? 'Sem marca';
}

/** Curva ABC por receita no período — por SKU ou por MARCA (opcionalmente por loja). */
export async function abcCurve(
  days: number,
  storeId?: string,
  dimension: AbcDimension = 'product',
  group: ProductGroup = 'todos',
  categories?: string[],
): Promise<AbcResult> {
  const saleFilter: Prisma.SaleWhereInput = { saleDate: { gte: periodStart(days) } };
  if (storeId) saleFilter.storeId = storeId;
  // O mesmo recorte vale para as DUAS dimensões: era esse o pedido — o filtro
  // não pode sumir quando se troca SKU por marca.
  const scoped = await productScopeWhere(group, categories);
  // Receita do período SEM recorte, para a tela reconciliar o total.
  const periodo = await prisma.saleItem.aggregate({
    where: { sale: saleFilter },
    _sum: { total: true },
  });
  const periodRevenue = round2(toNumber(periodo._sum.total) ?? 0);

  if (dimension === 'brand') {
    // Marca REAL do produto, extraída da descrição (o campo p.brand carrega o
    // fornecedor). Receita/unidades são reagrupadas por marca extraída.
    //
    // RECORTE DECLARADO: só óculos, armação e relógio. Lente e tratamento
    // saem da análise de marca por decisão do cliente (terão módulo próprio,
    // o do laboratório). Logo, o total desta dimensão é MENOR que o da
    // dimensão SKU — de propósito, e a tela diz isso.
    const grouped = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: saleFilter },
      _sum: { total: true, quantity: true },
    });
    const ids = grouped.map((g) => g.productId).filter((id): id is string => id !== null);
    const products = await prisma.product.findMany({
      where: { id: { in: ids }, ...scoped },
      select: { id: true, description: true, brand: true, category: true },
    });
    const metaById = new Map(products.map((p) => [p.id, p]));
    const byBrand = new Map<string, { revenue: number; units: number }>();
    for (const g of grouped) {
      const meta = g.productId === null ? undefined : metaById.get(g.productId);
      // Lente e tratamento ficam fora da análise de marca (módulo próprio).
      if (!meta || !isBrandAnalysable(meta.category)) continue;
      const brand = brandOf(meta);
      const cur = byBrand.get(brand) ?? { revenue: 0, units: 0 };
      cur.revenue += toNumber(g._sum.total) ?? 0;
      cur.units += g._sum.quantity ?? 0;
      byBrand.set(brand, cur);
    }
    return {
      ...abcFromItems(
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
      ),
      periodRevenue,
    };
  }

  const grouped = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: { sale: saleFilter, productId: { not: null } },
    _sum: { total: true, quantity: true },
  });
  const products = await prisma.product.findMany({
    where: { id: { in: grouped.map((g) => g.productId as string) }, ...scoped },
    select: { id: true, description: true, brand: true, category: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  return {
    ...abcFromItems(
    // Fora do recorte, fora do relatório (e fora do total).
    grouped.filter((g) => byId.has(g.productId as string)).map((g) => {
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
    ),
    periodRevenue,
  };
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
 *
 * RECORTE DECLARADO: só óculos, armação e relógio — lente e tratamento têm
 * módulo próprio. A linha GERAL soma apenas o que está no recorte.
 */
export async function coverageByBrand(
  days: number,
  storeId?: string,
  group: ProductGroup = 'todos',
  categories?: string[],
): Promise<BrandCoverageResult> {
  // GMAIS e outros CDs ficam fora da cobertura (matemática de lojas).
  const stockWhere: Prisma.StockItemWhereInput = storeId ? { storeId } : { ...stockPlannedWhere };
  const saleScope = storeId ? { storeId } : { store: PLANNED_STORE_WHERE };
  const [displayStock, sold, netStock] = await Promise.all([
    // Estoque exibido (respeita o filtro de loja).
    prisma.stockItem.groupBy({ by: ['productId'], where: stockWhere, _sum: { quantity: true } }),
    // Vendas do período (respeita o filtro de loja).
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { saleDate: { gte: periodStart(days) }, ...saleScope }, productId: { not: null } },
      _sum: { quantity: true },
    }),
    // Estoque da REDE planejável (sem CDs) — decide "lente por encomenda".
    prisma.stockItem.groupBy({ by: ['productId'], where: stockPlannedWhere, _sum: { quantity: true } }),
  ]);

  const netById = new Map(netStock.map((r) => [r.productId, r._sum.quantity ?? 0]));
  const ids = Array.from(new Set([...displayStock.map((r) => r.productId), ...sold.map((r) => r.productId as string)]));
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, ...(await productScopeWhere(group, categories)) },
    select: { id: true, description: true, brand: true, category: true },
  });
  const metaById = new Map(products.map((p) => [p.id, p]));
  const displayById = new Map(displayStock.map((r) => [r.productId, r._sum.quantity ?? 0]));
  const soldById = new Map(sold.map((r) => [r.productId as string, r._sum.quantity ?? 0]));

  const byBrand = new Map<string, { stockUnits: number; unitsSold: number }>();
  for (const id of ids) {
    const meta = metaById.get(id);
    if (!meta) continue;
    // Lente e tratamento não entram na cobertura POR MARCA (módulo próprio).
    if (!isBrandAnalysable(meta.category)) continue;
    // Lente por encomenda (grade da rede = 0) sai da cobertura de estoque.
    if (isMadeToOrderLens(meta.category, netById.get(id) ?? 0)) continue;
    const brand = brandOf(meta);
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
  // GMAIS/CDs fora da análise por loja; loja específica já delimita o escopo.
  const storeCond = storeId
    ? Prisma.sql`AND s."storeId" = ${storeId}`
    : Prisma.sql`AND s."storeId" IN (SELECT id FROM "Store" WHERE "excludeFromPlanning" = false)`;

  // SKU agrupa pelo ID do produto (descrições colidem entre modelos).
  if (by === 'product') {
    const grouped = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { saleDate: { gte: since }, ...(storeId ? { storeId } : { store: PLANNED_STORE_WHERE }) }, productId: { not: null } },
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
  // Itens SEM produto casado entram como "Sem marca" em vez de sumir — as
  // outras dimensões usam LEFT JOIN e os mantêm, então filtrá-los aqui
  // quebraria a reconciliação de totais entre as dimensões.
  if (by === 'brand') {
    const grouped = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { saleDate: { gte: since }, ...(storeId ? { storeId } : { store: PLANNED_STORE_WHERE }) } },
      _sum: { quantity: true, total: true },
    });
    const ids = grouped.map((g) => g.productId).filter((id): id is string => id !== null);
    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, description: true, brand: true, category: true },
    });
    const metaById = new Map(products.map((p) => [p.id, p]));
    const byBrand = new Map<string, { units: number; revenue: number }>();
    for (const g of grouped) {
      const meta = g.productId === null ? undefined : metaById.get(g.productId);
      // Lente e tratamento ficam fora da análise de marca (módulo próprio).
      if (!meta || !isBrandAnalysable(meta.category)) continue;
      const brand = brandOf(meta);
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
export async function inventoryTurnover(
  days: number,
  storeId?: string,
  group: ProductGroup = 'todos',
  categories?: string[],
): Promise<{
  days: number;
  rows: TurnoverRow[];
}> {
  // GMAIS e outros CDs ficam fora do giro (matemática de lojas).
  const saleFilter: Prisma.SaleWhereInput = { saleDate: { gte: periodStart(days) }, store: PLANNED_STORE_WHERE };
  if (storeId) saleFilter.storeId = storeId;

  const sold = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: { sale: saleFilter, productId: { not: null } },
    _sum: { quantity: true },
  });
  const soldByProduct = new Map(sold.map((s) => [s.productId as string, s._sum.quantity ?? 0]));

  const stockWhere: Prisma.StockItemWhereInput = { ...stockPlannedWhere };
  if (storeId) stockWhere.storeId = storeId;
  const stock = await prisma.stockItem.groupBy({
    by: ['productId'],
    where: stockWhere,
    _sum: { quantity: true },
  });
  const stockByProduct = new Map(stock.map((s) => [s.productId, s._sum.quantity ?? 0]));

  // Estoque da rede planejável (sem CDs) — exclui lentes por encomenda do giro.
  const netStock = await prisma.stockItem.groupBy({ by: ['productId'], where: stockPlannedWhere, _sum: { quantity: true } });
  const netById = new Map(netStock.map((n) => [n.productId, n._sum.quantity ?? 0]));

  const allIds = Array.from(new Set([...soldByProduct.keys(), ...stockByProduct.keys()]));
  const products = await prisma.product.findMany({
    where: { id: { in: allIds }, ...(await productScopeWhere(group, categories)) },
    select: { id: true, description: true, brand: true, category: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  // Fora do recorte, fora do giro (sem linha "—" órfã).
  const productIds = allIds.filter((id) => byId.has(id));

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
  // Agrupa pelos campos do produto (não só p.brand) para aplicar em JS a MESMA
  // regra de marca das outras visões: grife extraída da descrição, com o
  // recorte que deixa lente e tratamento de fora.
  type MixRow = {
    storeId: string | null;
    description: string | null;
    brand: string | null;
    category: string | null;
    units: bigint;
  };
  const [stockRows, soldRows, stores] = await Promise.all([
    prisma.$queryRaw<MixRow[]>(Prisma.sql`
      SELECT st."storeId" AS "storeId", p.description AS description, p.brand AS brand,
             p.category AS category, COALESCE(SUM(st.quantity), 0)::bigint AS units
      FROM "StockItem" st
      JOIN "Store" lo ON lo.id = st."storeId" AND lo."excludeFromPlanning" = false
      LEFT JOIN "Product" p ON p.id = st."productId"
      GROUP BY st."storeId", p.description, p.brand, p.category
    `),
    prisma.$queryRaw<MixRow[]>(Prisma.sql`
      SELECT s."storeId" AS "storeId", p.description AS description, p.brand AS brand,
             p.category AS category, COALESCE(SUM(si.quantity), 0)::bigint AS units
      FROM "SaleItem" si
      JOIN "Sale" s ON s.id = si."saleId"
      JOIN "Store" lo ON lo.id = s."storeId" AND lo."excludeFromPlanning" = false
      LEFT JOIN "Product" p ON p.id = si."productId"
      WHERE s."saleDate" >= ${periodStart(days)}
      GROUP BY s."storeId", p.description, p.brand, p.category
    `),
    prisma.store.findMany({ where: PLANNED_STORE_WHERE, select: { id: true, name: true } }),
  ]);
  const nameById = new Map(stores.map((s) => [s.id, s.name]));

  const acc = new Map<string, BrandBannerInput>();
  const bump = (r: MixRow, field: 'stockUnits' | 'unitsSold') => {
    // Mesmo recorte das outras visões por marca: lente e tratamento ficam
    // fora (módulo do laboratório). Sem isso, o Galbe veria ZEISS aqui
    // depois de não vê-la na aba ao lado.
    if (!isBrandAnalysable(r.category)) return;
    const storeName = r.storeId ? nameById.get(r.storeId) ?? 'Sem loja' : 'Sem loja';
    const brand = brandOf(r);
    const key = `${storeName}|${brand}`;
    const cur = acc.get(key) ?? { storeName, brand, stockUnits: 0, unitsSold: 0 };
    cur[field] += Number(r.units);
    acc.set(key, cur);
  };
  for (const r of stockRows) bump(r, 'stockUnits');
  for (const r of soldRows) bump(r, 'unitsSold');

  return { days, ...buildBrandMix([...acc.values()]) };
}
