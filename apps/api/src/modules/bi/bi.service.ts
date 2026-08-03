import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { toNumber } from '../../http/helpers.js';
import { productWhereForGroup, scopeCategories } from '../products/product.scope.js';
import type { ProductGroup } from '../planning/planning.math.js';
import {
  buildSankey,
  bucketSalesByDay,
  deriveKpis,
  round2,
  type DayBucket,
  type Kpis,
  type SankeyLink,
  type SankeyNode,
} from './bi.math.js';

/**
 * Teto de linhas para as agregações feitas em memória: limita o uso de
 * memória/tempo em bases grandes. Se o teto for atingido em produção,
 * migrar a agregação para SQL (groupBy/materialized view).
 */
const MAX_AGG_ROWS = 50_000;

/**
 * Recorte de produto do BI.
 *
 * O módulo inteiro era CEGO ao recorte: nem `group`, nem `category`, em nenhuma
 * das seis rotas. Trocar "Óculos" por "Lentes" no topo do console não mexia um
 * pixel de gráfico nenhum — e é exatamente o que o cliente relatou.
 *
 * A semântica adotada: o recorte filtra o ITEM DE VENDA. Vale para tudo que se
 * agrega a partir de item (categoria, marca, loja, fluxo, mapa de calor,
 * unidades, receita). O que NÃO se deixa recortar por produto é o pagamento —
 * uma forma de pagamento cobre a venda inteira, e uma venda mistura armação e
 * lente. Lá o recorte vira "vendas que CONTÊM item do recorte", e a tela diz
 * isso em texto em vez de fingir precisão.
 */
export interface BiScope {
  group?: ProductGroup;
  categories?: string[];
}

/** `undefined` quando não há recorte nenhum — evita filtro inútil no Prisma. */
async function produtoNoRecorte(scope?: BiScope): Promise<Prisma.ProductWhereInput | undefined> {
  if (!scope?.group && !scope?.categories?.length) return undefined;
  const base = await productWhereForGroup(scope.group ?? 'todos');
  return scopeCategories(base, scope.categories);
}

/** Filtro de item de venda dentro do recorte (vazio quando não há recorte). */
function itemNoRecorte(
  saleWhere: Prisma.SaleWhereInput,
  produto: Prisma.ProductWhereInput | undefined,
): Prisma.SaleItemWhereInput {
  return produto ? { sale: saleWhere, product: produto } : { sale: saleWhere };
}

/**
 * Venda que TOCA o recorte. Só para o que não se reparte por produto (forma de
 * pagamento) — o valor devolvido é o da venda inteira, não o da parte recortada.
 */
function vendaQueTocaORecorte(
  saleWhere: Prisma.SaleWhereInput,
  produto: Prisma.ProductWhereInput | undefined,
): Prisma.SaleWhereInput {
  return produto ? { ...saleWhere, items: { some: { product: produto } } } : saleWhere;
}

function periodStart(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

/** Indicadores agregados da rede/loja no período. */
export async function getKpis(days: number, storeId?: string, scope?: BiScope): Promise<Kpis> {
  const start = periodStart(days);
  const saleWhere: Prisma.SaleWhereInput = { saleDate: { gte: start } };
  if (storeId) saleWhere.storeId = storeId;
  const produto = await produtoNoRecorte(scope);

  const stockWhere: Prisma.StockItemWhereInput = {};
  if (storeId) stockWhere.storeId = storeId;
  if (produto) stockWhere.product = produto;

  const movementWhere: Prisma.InventoryMovementWhereInput = {
    status: { in: ['REQUESTED', 'PENDING'] },
  };
  if (storeId) movementWhere.OR = [{ fromStoreId: storeId }, { toStoreId: storeId }];
  if (produto) movementWhere.product = produto;

  const itemWhere = itemNoRecorte(saleWhere, produto);

  const [receitaAgg, soldAgg, vendas, stockAgg, items, pendingTransfers] = await Promise.all([
    // Com recorte, o faturamento sai da SOMA DOS ITENS, não do total da venda:
    // é o mesmo critério da curva ABC e dos relatórios, e é o que faz os
    // números baterem entre as telas em vez de cada uma contar do seu jeito.
    prisma.saleItem.aggregate({ where: itemWhere, _sum: { total: true } }),
    prisma.saleItem.aggregate({ where: itemWhere, _sum: { quantity: true } }),
    prisma.sale.count({ where: vendaQueTocaORecorte(saleWhere, produto) }),
    prisma.stockItem.aggregate({ where: stockWhere, _sum: { quantity: true } }),
    prisma.stockItem.findMany({
      where: stockWhere,
      select: { quantity: true, product: { select: { minStock: true } } },
      take: MAX_AGG_ROWS,
    }),
    prisma.inventoryMovement.count({ where: movementWhere }),
  ]);
  const salesAgg = { _sum: { total: receitaAgg._sum.total }, _count: vendas };

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
  scope?: BiScope,
): Promise<{ days: number; granularity: 'day'; points: DayBucket[] }> {
  const start = periodStart(days);
  const where: Prisma.SaleWhereInput = { saleDate: { gte: start } };
  if (storeId) where.storeId = storeId;
  const produto = await produtoNoRecorte(scope);

  // Sem recorte a série sai da venda (uma linha por venda, mais barato). Com
  // recorte ela sai do ITEM, senão um dia com uma venda mista apareceria
  // inteiro na série de "óculos".
  const linhas = produto
    ? (
        await prisma.saleItem.findMany({
          where: itemNoRecorte(where, produto),
          select: { total: true, sale: { select: { saleDate: true } } },
          take: MAX_AGG_ROWS,
        })
      ).map((it) => ({ saleDate: it.sale.saleDate, total: toNumber(it.total) ?? 0 }))
    : (
        await prisma.sale.findMany({
          where,
          select: { saleDate: true, total: true },
          take: MAX_AGG_ROWS,
        })
      ).map((s) => ({ saleDate: s.saleDate, total: toNumber(s.total) ?? 0 }));

  const points = bucketSalesByDay(linhas, days, new Date());
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
  scope?: BiScope,
): Promise<{ by: Dimension; rows: DimensionRow[]; aproximado?: boolean }> {
  const start = periodStart(days);
  const saleWhere: Prisma.SaleWhereInput = { saleDate: { gte: start } };
  if (storeId) saleWhere.storeId = storeId;
  const produto = await produtoNoRecorte(scope);

  let rows: DimensionRow[] = [];
  let aproximado = false;

  if (by === 'store') {
    const stores = await prisma.store.findMany({ select: { id: true, name: true } });
    const nameById = new Map(stores.map((s) => [s.id, s.name]));
    if (produto) {
      // Com recorte, a receita da loja é a soma dos ITENS daquela loja dentro
      // do recorte — não o total das vendas que passaram por lá.
      const itens = await prisma.saleItem.findMany({
        where: itemNoRecorte(saleWhere, produto),
        select: { total: true, sale: { select: { storeId: true } } },
        take: MAX_AGG_ROWS,
      });
      const acc = new Map<string, { total: number; count: number }>();
      for (const it of itens) {
        const k = it.sale.storeId ?? 'none';
        const cur = acc.get(k) ?? { total: 0, count: 0 };
        cur.total += toNumber(it.total) ?? 0;
        cur.count += 1;
        acc.set(k, cur);
      }
      rows = [...acc.entries()].map(([k, v]) => ({
        key: k,
        label: k === 'none' ? 'Sem loja' : nameById.get(k) ?? 'Sem loja',
        total: round2(v.total),
        count: v.count,
      }));
    } else {
      const grouped = await prisma.sale.groupBy({
        by: ['storeId'],
        where: saleWhere,
        _sum: { total: true },
        _count: true,
      });
      rows = grouped.map((g) => ({
        key: g.storeId ?? 'none',
        label: g.storeId ? nameById.get(g.storeId) ?? 'Sem loja' : 'Sem loja',
        total: round2(toNumber(g._sum.total) ?? 0),
        count: g._count,
      }));
    }
  } else if (by === 'payment') {
    // A forma de pagamento cobre a VENDA inteira e não se reparte por produto:
    // uma venda de armação + lente tem um cartão só. Com recorte ativo, o que
    // dá para dizer com honestidade é "as vendas que contêm item do recorte",
    // e o valor é o da venda inteira. `aproximado` avisa a tela.
    const grouped = await prisma.payment.groupBy({
      by: ['method'],
      where: { sale: vendaQueTocaORecorte(saleWhere, produto) },
      _sum: { amount: true },
      _count: true,
    });
    aproximado = Boolean(produto);
    rows = grouped.map((g) => ({
      key: g.method ?? 'none',
      label: g.method ?? 'Não informado',
      total: round2(toNumber(g._sum.amount) ?? 0),
      count: g._count,
    }));
  } else {
    // category | brand — agrega via item de venda + produto (relação).
    const itemsSold = await prisma.saleItem.findMany({
      where: itemNoRecorte(saleWhere, produto),
      select: { total: true, product: { select: { category: true, brand: true } } },
      take: MAX_AGG_ROWS,
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
  return aproximado ? { by, rows, aproximado } : { by, rows };
}

/** Sankey do fluxo de vendas: Categoria → Loja (receita por item). */
export async function getSalesFlow(
  days: number,
  storeId?: string,
  scope?: BiScope,
): Promise<{ nodes: SankeyNode[]; links: SankeyLink[] }> {
  const start = periodStart(days);
  const saleWhere: Prisma.SaleWhereInput = { saleDate: { gte: start } };
  if (storeId) saleWhere.storeId = storeId;
  const produto = await produtoNoRecorte(scope);

  const items = await prisma.saleItem.findMany({
    where: itemNoRecorte(saleWhere, produto),
    select: {
      total: true,
      product: { select: { category: true } },
      sale: { select: { store: { select: { name: true } } } },
    },
    take: MAX_AGG_ROWS,
  });

  const pairs = items.map((it) => ({
    source: it.product?.category ?? 'Não classificado',
    target: it.sale.store?.name ?? 'Sem loja',
    value: toNumber(it.total) ?? 0,
  }));
  return buildSankey(pairs);
}

/** Sankey do fluxo de transferências entre lojas (Origem → Destino). */
export async function getTransferFlow(
  days: number,
  storeId?: string,
  scope?: BiScope,
): Promise<{ nodes: SankeyNode[]; links: SankeyLink[] }> {
  const start = periodStart(days);
  const where: Prisma.InventoryMovementWhereInput = {
    type: 'TRANSFER',
    status: { in: ['PENDING', 'CONFIRMED', 'RECONCILED'] },
    createdAt: { gte: start },
    fromStoreId: { not: null },
    toStoreId: { not: null },
  };
  if (storeId) where.OR = [{ fromStoreId: storeId }, { toStoreId: storeId }];
  // A movimentação aponta para UM produto: aqui o recorte é exato.
  const produtoTransf = await produtoNoRecorte(scope);
  if (produtoTransf) where.product = produtoTransf;

  const movements = await prisma.inventoryMovement.findMany({
    where,
    select: {
      quantity: true,
      fromStore: { select: { name: true } },
      toStore: { select: { name: true } },
    },
    take: MAX_AGG_ROWS,
  });

  // Prefixos evitam ciclos no Sankey (A→B e B→A viram nós distintos).
  const pairs = movements.map((m) => ({
    source: `Origem: ${m.fromStore?.name ?? '—'}`,
    target: `Destino: ${m.toStore?.name ?? '—'}`,
    value: m.quantity,
  }));
  return buildSankey(pairs);
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Heatmap de receita: Loja (linhas) × dia da semana (colunas). */
export async function getHeatmap(
  days: number,
  storeId?: string,
  scope?: BiScope,
): Promise<{ xLabels: string[]; yLabels: string[]; cells: [number, number, number][] }> {
  const start = periodStart(days);
  const where: Prisma.SaleWhereInput = { saleDate: { gte: start } };
  if (storeId) where.storeId = storeId;
  const produto = await produtoNoRecorte(scope);

  // Mesma regra da série: com recorte, cada célula é a soma dos ITENS do
  // recorte naquele dia da semana e naquela loja.
  const sales = produto
    ? (
        await prisma.saleItem.findMany({
          where: itemNoRecorte(where, produto),
          select: {
            total: true,
            sale: { select: { saleDate: true, store: { select: { name: true } } } },
          },
          take: MAX_AGG_ROWS,
        })
      ).map((it) => ({ saleDate: it.sale.saleDate, total: it.total, store: it.sale.store }))
    : await prisma.sale.findMany({
        where,
        select: { saleDate: true, total: true, store: { select: { name: true } } },
        take: MAX_AGG_ROWS,
      });

  const yLabels = Array.from(new Set(sales.map((s) => s.store?.name ?? 'Sem loja'))).sort();
  const yIndex = new Map(yLabels.map((name, i) => [name, i]));
  const acc = new Map<string, number>(); // `${weekday}:${storeIdx}`

  for (const s of sales) {
    const store = s.store?.name ?? 'Sem loja';
    const wd = new Date(s.saleDate).getDay();
    const yi = yIndex.get(store)!;
    const key = `${wd}:${yi}`;
    acc.set(key, round2((acc.get(key) ?? 0) + (toNumber(s.total) ?? 0)));
  }

  const cells: [number, number, number][] = [];
  for (let yi = 0; yi < yLabels.length; yi += 1) {
    for (let wd = 0; wd < WEEKDAYS.length; wd += 1) {
      cells.push([wd, yi, acc.get(`${wd}:${yi}`) ?? 0]);
    }
  }
  return { xLabels: WEEKDAYS, yLabels, cells };
}
