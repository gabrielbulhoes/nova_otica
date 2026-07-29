/**
 * Modo demonstração — dados servidos no próprio navegador, sem backend.
 * Ativado por VITE_DEMO=1. Dois sabores:
 * - padrão: dados FICTÍCIOS gerados aqui (site público);
 * - real:   se apps/web/src/api/demo-real-data.json existir no build
 *   (gerado por scripts/build-demo-real-data.mjs a partir dos fixtures da
 *   sonda CDS — gitignorado), os cadastros/estoque/vendas exibidos são os
 *   REAIS da rede, agregados e sem qualquer dado de cliente.
 */
import {
  abcFromItems,
  analyzeProduct,
  buildCommercialStrategy,
  annotateCardAges,
  buildDecisionCards,
  extractBrand,
  isBrandAnalysable,
  matchesProductGroup,
  buildBrandMix,
  buildFairSplit,
  buildOverview,
  buildPurchaseOrders,
  buildRebalance,
  buildSuggestions,
  computeCoverage,
  computeStoreCoverage,
  DEFAULT_PLANNING_CONFIG,
  type AbcItem,
  type BrandBannerInput,
  type FairSplitInput,
  type StoreCoverageInput,
  type ProductGroup,
  type StoreProductInput,
} from '@planning';

// Dataset real opcional: import.meta.glob devolve {} quando o arquivo não
// existe — o build público segue 100% fictício sem nenhuma outra mudança.
interface RealDataset {
  label: string;
  totals: {
    revenue30d: number; salesCount30d: number; stockUnitsNetwork: number;
    productCountNetwork: number; catalogSampled: number; storeCount: number;
  };
  stores: { externalId: string; name: string }[];
  products: { externalId: string; sku: string; description: string; brand: string; category: string; price: number; cost: number | null }[];
  stock: [string, string, number][];
  sold: [string, string, number][];
  salesByStore: { externalId: string; name: string; count: number; total: number }[];
  dailySales: { date: string; total: number; count: number }[];
  byPayment: { label: string; total: number; count: number }[];
  byBrand: { label: string; total: number; count: number }[];
  byCategory: { label: string; total: number; count: number }[];
  productSales: { externalId: string; units: number; revenue: number }[];
  weekdayStore: { storeExt: string; weekday: number; total: number }[];
  /** Cobertura por loja (rede inteira) — ausente em datasets antigos. */
  storeStats?: {
    externalId: string;
    stockUnits: number;
    /** SKUs distintos com saldo, da rede inteira. Ausente em datasets antigos. */
    skuCount?: number;
    soldUnits: number;
    soldRevenue?: number;
  }[];
  /** Top vendedores por receita (equipe própria; site protegido por senha). */
  bySeller?: { label: string; units: number; revenue: number; sales: number }[];
  /** Cobertura por marca (rede inteira; grade sem fornecedor = "Sem marca"). */
  brandCoverage?: { label: string; stockUnits: number; soldUnits: number }[];
  /** Estoque × vendas por loja × marca (rede inteira) — mix por bandeira. */
  storeBrand?: { storeExt: string; label: string; stockUnits: number; soldUnits: number }[];
  /** Estoque × vendas por loja × grupo (rede inteira) — Modo Feira. */
  storeCategory?: { storeExt: string; label: string; stockUnits: number; soldUnits: number }[];
}
const realModules = import.meta.glob('./demo-real-data.json', { eager: true }) as Record<string, { default: RealDataset }>;
const real: RealDataset | null = Object.values(realModules)[0]?.default ?? null;

const CATEGORIAS = ['Armação', 'Óculos de Sol', 'Lente', 'Acessório', 'Estojo'];
const MARCAS = ['Ray-Ban', 'Oakley', 'Chilli Beans', 'Hoya', 'Bulget', 'Atitude'];
const CORES = ['Preto', 'Dourado', 'Prata', 'Azul', 'Tartaruga'];
const TAMS = ['P', 'M', 'G', 'Único'];
const PAG = ['PIX', 'Cartão de Crédito', 'Cartão de Débito', 'Dinheiro', 'Crediário'];
const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20260701);
const money = (min: number, max: number) => Math.round((r() * (max - min) + min) * 100) / 100;
const int = (min: number, max: number) => Math.floor(r() * (max - min + 1)) + min;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Hash estável em [0,1) a partir de uma string (variação determinística). */
function hash01(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

interface Store { id: string; externalId: string; name: string; city: string; state: string; active: boolean }
interface Product {
  id: string; externalId: string; sku: string; description: string; brand: string;
  category: string; price: number; color: string; size: string; minStock: number;
}

const STORE_NAMES: [string, string, string][] = [
  ['1', 'São Paulo', 'SP'],
  ['2', 'Campinas', 'SP'],
  ['3', 'Rio de Janeiro', 'RJ'],
  ['4', 'Belo Horizonte', 'MG'],
];

const allStores: Store[] = real
  ? real.stores.map((s) => ({
      id: `st_${s.externalId}`,
      externalId: s.externalId,
      name: s.name,
      city: '',
      state: '',
      active: true,
    }))
  : STORE_NAMES.map(([ext, city, state]) => ({
      id: `st_${ext}`,
      externalId: ext,
      name: `Nova Ótica — ${city}`,
      city,
      state,
      active: true,
    }));

// GMAIS (centro de distribuição) e unidades não-varejo (assistência técnica,
// estoque de compras) ficam fora da matemática de lojas, igual ao backend
// real (Store.excludeFromPlanning / PLANNING_EXCLUDED_STORE_PATTERN).
const PLANNING_EXCLUDED_STORE_PATTERN = /gmais|assistencia|estoque compras/i;
const stores: Store[] = allStores.filter((s) => !PLANNING_EXCLUDED_STORE_PATTERN.test(s.name));

const products: Product[] = real
  ? real.products.map((p) => ({
      id: `pr_${p.externalId}`,
      externalId: p.externalId,
      sku: p.sku,
      description: p.description,
      brand: p.brand || '—',
      category: p.category || 'OUTROS',
      price: p.price,
      color: '',
      size: '',
      minStock: 3,
    }))
  : Array.from({ length: 16 }, (_, i) => {
      const category = CATEGORIAS[i % CATEGORIAS.length];
      const brand = MARCAS[i % MARCAS.length];
      return {
        id: `pr_${1000 + i}`,
        externalId: String(1000 + i),
        sku: `${brand.slice(0, 3).toUpperCase()}-${1000 + i}`,
        description: `${category} ${brand} ${CORES[i % CORES.length]}`,
        brand,
        category,
        price: money(120, 1200),
        color: CORES[i % CORES.length],
        size: TAMS[i % TAMS.length],
        minStock: 3,
      };
    });

// Matriz de estoque store×product
const stockQty = new Map<string, number>();
if (real) {
  for (const [stExt, prExt, qty] of real.stock) stockQty.set(`st_${stExt}:pr_${prExt}`, qty);
} else {
  for (const st of stores) for (const p of products) stockQty.set(`${st.id}:${p.id}`, r() < 0.12 ? int(0, 2) : int(3, 30));
}
const reserved = new Map<string, number>();
// Overrides de estoque mínimo por loja (paridade com StockItem.minStock)
const storeMinStock = new Map<string, number | null>();
const key = (s: string, p: string) => `${s}:${p}`;

// Vendas por loja×produto no período (base do planejamento/redistribuição)
const soldQty = new Map<string, number>();
if (real) {
  for (const [stExt, prExt, qty] of real.sold) soldQty.set(`st_${stExt}:pr_${prExt}`, qty);
} else {
  for (const st of stores) for (const p of products) soldQty.set(key(st.id, p.id), r() < 0.25 ? 0 : int(0, 24));
  // Posições-vitrine determinísticas (SÓ no dataset fictício): exemplos claros
  // de redistribuição em qualquer seed.
  soldQty.set(key(stores[0].id, products[0].id), 36);
  stockQty.set(key(stores[0].id, products[0].id), 3);
  soldQty.set(key(stores[3].id, products[0].id), 0);
  stockQty.set(key(stores[3].id, products[0].id), 18);
  soldQty.set(key(stores[1].id, products[5].id), 20);
  stockQty.set(key(stores[1].id, products[5].id), 2);
  soldQty.set(key(stores[2].id, products[5].id), 0);
  stockQty.set(key(stores[2].id, products[5].id), 14);
  // Falta na rede inteira (transferir não resolve): compra urgente com prazo.
  for (const st of stores) {
    soldQty.set(key(st.id, products[2].id), 15);
    stockQty.set(key(st.id, products[2].id), 2);
  }
}

// Prazos por fornecedor (marca) editáveis na demo
const demoLeadTimes = new Map<string, number>([
  [MARCAS[0], 30],
  [MARCAS[1], 7],
]);

// Histórico de pedidos de compra (enviado/recebido) da demo
interface DemoOrderRecord {
  id: string;
  supplier: string;
  leadTimeDays: number;
  status: 'SENT' | 'RECEIVED' | 'CANCELLED';
  items: { productId: string; description: string; quantity: number; unitCost: number; total: number }[];
  units: number;
  total: number;
  sentAt: string;
  expectedAt: string | null;
  receivedAt: string | null;
}
const purchaseRecords: DemoOrderRecord[] = [];
const onOrderQty = (productId: string) =>
  purchaseRecords
    .filter((r) => r.status === 'SENT')
    .reduce((s, r) => s + r.items.filter((i) => i.productId === productId).reduce((a, i) => a + i.quantity, 0), 0);

// Produtos com provador (AR) — os de Armação / Óculos de Sol
const arProductIds = products.filter((p) => p.category === 'Armação' || p.category === 'Óculos de Sol').map((p) => p.id);

// Estado mutável (carrinho, pedidos, movimentações, provas)
let cart: { storeId: string; items: { productId: string; quantity: number }[] } | null = null;
const orders: Record<string, unknown>[] = [];
let tryOns = 3;
let tryOnConverted = 1;
const movements: Record<string, unknown>[] = [
  {
    id: 'mv_seed', type: 'TRANSFER', status: 'REQUESTED', quantity: 2,
    reason: 'Solicitação de exemplo', reference: null, decisionNote: null,
    createdAt: new Date().toISOString(),
    product: { id: products[0].id, description: products[0].description },
    fromStore: { id: stores[3].id, name: stores[3].name },
    toStore: { id: stores[1].id, name: stores[1].name },
  },
];

const prodById = (id: string) => products.find((p) => p.id === id);
const storeById = (id: string) => stores.find((s) => s.id === id);
const availableAt = (storeId: string, productId: string) =>
  (stockQty.get(key(storeId, productId)) ?? 0) - (reserved.get(key(storeId, productId)) ?? 0);

// ─── Derivações de métricas ──────────────────────────────────────────────────

// Com dados reais os totais são da REDE INTEIRA (pré-amostragem do catálogo).
const stockUnits = real ? real.totals.stockUnitsNetwork : [...stockQty.values()].reduce((a, b) => a + b, 0);
const salesByStore = real
  ? real.salesByStore.map((s) => ({ storeId: `st_${s.externalId}`, storeName: s.name, count: s.count, total: s.total }))
  : stores.map((s) => ({
      storeId: s.id,
      storeName: s.name,
      count: int(15, 30),
      total: money(35000, 75000),
    }));
const revenue = real ? real.totals.revenue30d : round2(salesByStore.reduce((a, b) => a + b.total, 0));
const salesCount = real ? real.totals.salesCount30d : salesByStore.reduce((a, b) => a + b.count, 0);

/**
 * Filtro multi-seleção → Set (null = sem filtro). Espelha o parseList da API:
 * array (parâmetro repetido do axios) com valores literais, ou "a,b,c".
 */
function asSet(v?: string | string[]) {
  const parts = Array.isArray(v) ? v : (v ?? '').split(',');
  const items = parts.map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? new Set(items) : null;
}

/** Recorte pedido pela tela; 'todos' é o padrão (compatível com a API). */
function productGroup(v: string | string[] | undefined): ProductGroup {
  const g = one(v);
  return g === 'principal' || g === 'lentes' ? g : 'todos';
}

function stockRows(params: Record<string, string | string[] | undefined>) {
  const storeSel = asSet(params.storeId);
  const catSel = asSet(params.category);
  // Mesmo recorte da API: lente e tratamento saem por padrão das telas de
  // operação (feedback do Galbe: "ainda continua puxando lentes").
  const group = productGroup(params.group);
  const rows: Record<string, unknown>[] = [];
  for (const st of stores) {
    if (storeSel && !storeSel.has(st.id)) continue;
    for (const p of products) {
      if (params.productId && params.productId !== p.id) continue;
      if (!matchesProductGroup(p.category, group)) continue;
      if (catSel && !catSel.has(p.category)) continue;
      const search = one(params.search);
      if (search) {
        const q = search.toLowerCase();
        if (!p.description.toLowerCase().includes(q) && !(p.sku ?? '').toLowerCase().includes(q) && !p.brand.toLowerCase().includes(q))
          continue;
      }
      const synced = stockQty.get(key(st.id, p.id)) ?? 0;
      const res = reserved.get(key(st.id, p.id)) ?? 0;
      const availableNow = Math.max(synced - res, 0);
      if ((params.onlyAvailable === 'true' || params.only_disp === '1') && availableNow <= 0) continue;
      rows.push({
        storeId: st.id, storeName: st.name, productId: p.id, productExternalId: p.externalId,
        description: p.description, brand: p.brand, category: p.category, price: p.price,
        minStock: p.minStock, synced, reserved: res, pendingDelta: 0, onHand: synced,
        availableNow, syncedAt: new Date().toISOString(),
      });
    }
  }
  return rows;
}

function alerts(group: ProductGroup = 'todos') {
  const rows = stockRows({ group }).filter((x) => {
    // Com o dataset real (catálogo amostrado), só alerta posições que EXISTEM
    // na loja: linha de estoque presente ou venda no período. Sem isso, cada
    // produto ausente numa filial viraria "ruptura" fantasma.
    if (real) {
      const k = key(x.storeId as string, x.productId as string);
      const conhecido = stockQty.has(k) || (soldQty.get(k) ?? 0) > 0;
      if (!conhecido) return false;
    }
    const override = storeMinStock.get(key(x.storeId as string, x.productId as string));
    const threshold = override ?? (x.minStock as number);
    (x as Record<string, unknown>).minStock = threshold;
    return (x.availableNow as number) <= threshold;
  });
  return {
    total: rows.length,
    out: rows.filter((x) => (x.availableNow as number) <= 0).length,
    low: rows.filter((x) => (x.availableNow as number) > 0).length,
    rows: rows
      .map((x) => ({
        level: (x.availableNow as number) <= 0 ? 'OUT' : 'LOW',
        storeId: x.storeId, storeName: x.storeName, productId: x.productId,
        description: x.description, brand: x.brand, category: x.category,
        availableNow: x.availableNow, threshold: x.minStock,
      }))
      .sort((a, b) => (a.availableNow as number) - (b.availableNow as number)),
  };
}

function timeseries(days: number) {
  if (real) {
    // Série diária REAL (30 dias da sonda), recortada ao período pedido.
    const points = real.dailySales.slice(-days).map((d) => ({ date: d.date, total: d.total, count: d.count }));
    return { days, granularity: 'day', points };
  }
  const points = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    points.push({ date: d.toISOString().slice(0, 10), total: money(3000, 14000), count: int(2, 9) });
  }
  return { days, granularity: 'day', points };
}

function byDimension(by: string) {
  let rows: { key: string; label: string; total: number; count: number }[] = [];
  if (by === 'store') rows = salesByStore.map((s) => ({ key: s.storeId, label: s.storeName, total: s.total, count: s.count }));
  else if (real) {
    const src = by === 'payment' ? real.byPayment : by === 'brand' ? real.byBrand : real.byCategory;
    rows = src.map((m) => ({ key: m.label, label: m.label, total: m.total, count: m.count }));
  } else if (by === 'payment') rows = PAG.map((m) => ({ key: m, label: m, total: money(20000, 70000), count: int(10, 40) }));
  else {
    const dims = by === 'brand' ? MARCAS : CATEGORIAS;
    rows = dims.map((m) => ({ key: m, label: m, total: money(15000, 60000), count: int(20, 90) }));
  }
  return { by, rows: rows.sort((a, b) => b.total - a.total) };
}

const realSalesByProduct = new Map((real?.productSales ?? []).map((x) => [`pr_${x.externalId}`, x]));

/**
 * Itens vendidos no período: base única do ABC e da análise por dimensão.
 * Memoizado para o sabor fictício não sortear números novos a cada chamada
 * (ABC, análise e giro contam a mesma história).
 */
let soldItemsCache: { p: Product; revenue: number; units: number }[] | null = null;
function soldItems() {
  soldItemsCache ??= products
    .map((p) => {
      const rs = realSalesByProduct.get(p.id);
      return real
        ? { p, revenue: rs?.revenue ?? 0, units: rs?.units ?? 0 }
        : { p, revenue: money(2000, 40000), units: int(5, 120) };
    })
    .filter((x) => !real || x.revenue > 0);
  return soldItemsCache;
}

/**
 * Marca de exibição, na MESMA ordem do backend (reports.service.brandOf):
 * grife extraída da descrição → fornecedor → "Sem marca".
 */
function brandLabel(p: { description: string; brand: string; category: string }) {
  return extractBrand(p.description, p.category) ?? (p.brand && p.brand !== '—' ? p.brand : null) ?? 'Sem marca';
}

/**
 * Vendas agregadas por MARCA, com o recorte da análise de marca aplicado
 * (só óculos/armação/relógio — lente e tratamento têm módulo próprio).
 * Calculado do catálogo, e não dos agregados prontos do dataset, para bater
 * com o que a API faz — os agregados são por fornecedor e incluem lente.
 */
function brandSales() {
  const acc = new Map<string, { revenue: number; units: number }>();
  for (const x of soldItems()) {
    if (!isBrandAnalysable(x.p.category)) continue;
    const k = brandLabel(x.p);
    const cur = acc.get(k) ?? { revenue: 0, units: 0 };
    cur.revenue = round2(cur.revenue + x.revenue);
    cur.units += x.units;
    acc.set(k, cur);
  }
  return acc;
}

function abc(days: number, dimension: 'product' | 'brand') {
  let items: AbcItem[];
  if (dimension === 'brand') {
    // Mesmo cálculo nos dois sabores da demo (fictício e real) e igual ao da
    // API: marca extraída da descrição e recorte de produto de moda.
    const acc = brandSales();
    items = [...acc.entries()].map(([label, v]) => ({
      key: label, label: label || 'Sem marca', brand: null, category: null, ...v,
    }));
  } else {
    items = soldItems().map((x) => ({
      key: x.p.id, label: x.p.description, brand: x.p.brand, category: x.p.category,
      revenue: x.revenue, units: x.units,
    }));
  }
  // A classificação (ponto médio, resumo por classe) é a MESMA do backend.
  return abcFromItems(items, days, dimension);
}

/**
 * Janela real de vendas do dataset, MEDIDA na série diária.
 *
 * Não confie no rótulo: o arquivo atual se descreve como "30 dias de vendas"
 * e carrega 7 (07/07 a 13/07) — as fixtures saíram com a janela padrão da
 * sonda. Dividir 7 dias de venda por 30 faz toda demanda diária sair 4,3x
 * menor, o que inflou a cobertura para 60–150 meses e fez produto saudável
 * ser classificado como parado. Medir em vez de acreditar custa três linhas.
 */
function medirJanela(): number {
  const dias = real?.dailySales?.map((d) => d.date).filter(Boolean).sort() ?? [];
  if (dias.length === 0) return 30;
  const ini = Date.parse(dias[0]);
  const fim = Date.parse(dias[dias.length - 1]);
  if (!Number.isFinite(ini) || !Number.isFinite(fim)) return 30;
  return Math.max(1, Math.round((fim - ini) / 86_400_000) + 1);
}
const realWindowDays = real ? medirJanela() : 0;

/**
 * A fotografia real cobre `realWindowDays`: pedir um período maior usaria os
 * mesmos números como se fossem do período maior e inflaria a cobertura.
 */
const effectiveDays = (days: number) => (real ? realWindowDays : days);

/** Cobertura geral e por marca (feedback 06). */
function brandCoverageReport(rawDays: number) {
  const days = effectiveDays(rawDays);
  // Do catálogo, não do agregado pronto do dataset: o agregado é por
  // FORNECEDOR e inclui lente. Aqui vale o recorte da análise de marca — o
  // mesmo da API e o mesmo nos dois sabores da demo.
  const acc = new Map<string, { stockUnits: number; unitsSold: number }>();
  for (const p of products) {
    if (!isBrandAnalysable(p.category)) continue;
    const k = brandLabel(p);
    const cur = acc.get(k) ?? { stockUnits: 0, unitsSold: 0 };
    for (const st of stores) {
      cur.stockUnits += stockQty.get(key(st.id, p.id)) ?? 0;
      cur.unitsSold += soldQty.get(key(st.id, p.id)) ?? 0;
    }
    acc.set(k, cur);
  }
  const inputs = [...acc.entries()].map(([label, v]) => ({ key: label, label, ...v }));
  const rows = computeCoverage(inputs, days);
  const [total] = computeCoverage(
    [{
      key: '__total__',
      label: 'GERAL',
      stockUnits: rows.reduce((a, r) => a + r.stockUnits, 0),
      unitsSold: rows.reduce((a, r) => a + r.unitsSold, 0),
    }],
    days,
  );
  return { days, total, rows };
}

/** Vendas por dimensão em unidades E receita (feedback 10). */
function salesAnalysisReport(rawDays: number, by: string) {
  const days = effectiveDays(rawDays);
  let rows: { key: string; label: string; units: number; revenue: number }[] = [];
  if (by === 'store') {
    rows = stores.map((s) => {
      const st = real?.storeStats?.find((x) => x.externalId === s.externalId);
      const sales = salesByStore.find((x) => x.storeId === s.id);
      // Receita preferindo a régua de ITENS (soldRevenue), a mesma das outras
      // dimensões; datasets antigos caem no total da venda (valor_pago).
      const units = st
        ? st.soldUnits
        : products.reduce((a, p) => a + (soldQty.get(key(s.id, p.id)) ?? 0), 0);
      const revenue = st?.soldRevenue ?? sales?.total ?? 0;
      return { key: s.id, label: s.name, units, revenue: round2(revenue) };
    });
  } else if (by === 'seller') {
    rows = real?.bySeller
      ? real.bySeller.map((v) => ({ key: v.label, label: v.label, units: v.units, revenue: v.revenue }))
      : ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa'].map((nome, i) => ({
          key: nome, label: nome, units: int(20, 90), revenue: money(15000, 60000 - i * 5000),
        }));
  } else if (by === 'product') {
    rows = soldItems().map((x) => ({
      key: x.p.id,
      label: `${x.p.description}${x.p.sku ? ` (${x.p.sku})` : ''}`,
      units: x.units,
      revenue: round2(x.revenue),
    }));
  } else {
    // brand | category
    const acc = new Map<string, { units: number; revenue: number }>();
    if (by === 'brand') {
      // Mesmo recorte e mesma marca da API (lente/tratamento ficam fora).
      for (const [k, v] of brandSales()) acc.set(k, { units: v.units, revenue: v.revenue });
    } else if (real) {
      for (const b of real.byCategory) acc.set(b.label, { units: b.count, revenue: b.total });
    } else {
      for (const x of soldItems()) {
        const cur = acc.get(x.p.category) ?? { units: 0, revenue: 0 };
        cur.units += x.units;
        cur.revenue = round2(cur.revenue + x.revenue);
        acc.set(x.p.category, cur);
      }
    }
    rows = [...acc.entries()].map(([label, v]) => ({ key: label, label: label || '—', ...v }));
  }
  rows.sort((a, b) => b.units - a.units);
  return { days, by, rows: rows.slice(0, 500) };
}

function turnover(days: number) {
  return {
    days,
    rows: products.map((p) => {
      const unitsSold = real ? realSalesByProduct.get(p.id)?.units ?? 0 : int(0, 60);
      const currentStock = stores.reduce((a, s) => a + (stockQty.get(key(s.id, p.id)) ?? 0), 0);
      return {
        productId: p.id, description: p.description, brand: p.brand, category: p.category,
        unitsSold, currentStock, turnover: round2(unitsSold / Math.max(currentStock, 1)),
        daysOfInventory: unitsSold > 0 ? round2(currentStock / (unitsSold / days)) : null,
      };
    }).sort((a, b) => b.turnover - a.turnover),
  };
}

function salesFlow() {
  const links: { source: string; target: string; value: number }[] = [];
  const names = new Set<string>();
  if (real) {
    // Alocação proporcional: total real da categoria × participação real da
    // loja no faturamento (top 6 × top 8 para o sankey respirar).
    const cats = [...real.byCategory].sort((a, b) => b.total - a.total).slice(0, 6);
    const tops = [...salesByStore].sort((a, b) => b.total - a.total).slice(0, 8);
    const topTotal = tops.reduce((a, b) => a + b.total, 0) || 1;
    for (const cat of cats)
      for (const st of tops) {
        const v = round2((cat.total * st.total) / topTotal);
        if (v <= 0) continue;
        links.push({ source: cat.label, target: st.storeName, value: v });
        names.add(cat.label);
        names.add(st.storeName);
      }
    return { nodes: [...names].map((name) => ({ name })), links };
  }
  for (const cat of CATEGORIAS)
    for (const st of stores) {
      const v = money(2000, 25000);
      links.push({ source: cat, target: st.name, value: v });
      names.add(cat);
      names.add(st.name);
    }
  return { nodes: [...names].map((name) => ({ name })), links };
}

function transferFlow() {
  return {
    nodes: [
      { name: `Origem: ${stores[3].name}` },
      { name: `Destino: ${stores[1].name}` },
      { name: `Origem: ${stores[0].name}` },
      { name: `Destino: ${stores[2].name}` },
    ],
    links: [
      { source: `Origem: ${stores[3].name}`, target: `Destino: ${stores[1].name}`, value: 5 },
      { source: `Origem: ${stores[0].name}`, target: `Destino: ${stores[2].name}`, value: 3 },
    ],
  };
}

function heatmap() {
  const yLabels = stores.map((s) => s.name);
  const cells: [number, number, number][] = [];
  if (real) {
    const byKey = new Map(real.weekdayStore.map((w) => [`${w.storeExt}|${w.weekday}`, w.total]));
    stores.forEach((s, yi) =>
      WEEK.forEach((_, wd) => cells.push([wd, yi, Math.round(byKey.get(`${s.externalId}|${wd}`) ?? 0)])),
    );
  } else {
    yLabels.forEach((_, yi) => WEEK.forEach((__, wd) => cells.push([wd, yi, Math.round(money(500, 9000))])));
  }
  return { xLabels: WEEK, yLabels, cells };
}

function cartView() {
  if (!cart) return { cartId: null, storeId: null, storeName: null, items: [], subtotal: 0, total: 0 };
  const items = cart.items.map((it) => {
    const p = prodById(it.productId)!;
    return {
      productId: it.productId, description: p.description, unitPrice: p.price, quantity: it.quantity,
      total: round2(p.price * it.quantity), available: availableAt(cart!.storeId, it.productId),
    };
  });
  const subtotal = round2(items.reduce((a, b) => a + b.total, 0));
  return { cartId: 'cart_demo', storeId: cart.storeId, storeName: storeById(cart.storeId)?.name ?? null, items, subtotal, total: subtotal };
}

const ADMIN_USER = { id: 'demo_admin', email: 'admin@novaotica.com', name: 'Administrador (Demo)', role: 'ADMIN', storeId: null, storeName: null };

/**
 * Contas nomeadas do build (VITE_DEMO_USERS="Nome:senha,Nome:senha").
 * Quando definidas — caso da variante com DADOS REAIS — o login da demo passa
 * a VALIDAR e-mail e senha em vez de aceitar qualquer coisa. Atenção: é uma
 * trava de conveniência no navegador (site estático não tem servidor); a
 * proteção de verdade do conteúdo é a senha de diretório no hosting.
 */
const buildAccounts = ((import.meta.env.VITE_DEMO_USERS as string | undefined) ?? '')
  .split(',')
  .map((entry) => {
    const [name, ...rest] = entry.split(':');
    return { name: (name ?? '').trim(), password: rest.join(':') };
  })
  .filter((a) => a.name && a.password);
const accountUsers = buildAccounts.map((a, i) => ({
  id: `demo_acc_${i + 1}`,
  email: `${a.name.toLowerCase()}@novaotica.com`,
  name: a.name,
  role: 'ADMIN',
  storeId: null as string | null,
  storeName: null as string | null,
}));
// Sessão local: quem logou por último (o /auth/me devolve o usuário certo).
let currentUser = accountUsers[0] ?? ADMIN_USER;

// Usuários para a tela de gestão (mutáveis na sessão). Com contas nomeadas
// do build, são elas que aparecem; senão, o elenco fictício de sempre.
const demoUsers: Record<string, unknown>[] =
  accountUsers.length > 0
    ? accountUsers.map((u, i) => ({
        id: u.id, email: u.email, name: u.name, role: u.role, storeId: null,
        active: true, lastLoginAt: i === 0 ? new Date().toISOString() : null, store: null,
      }))
    : [
        { id: 'demo_admin', email: 'admin@novaotica.com', name: 'Administrador (Demo)', role: 'ADMIN', storeId: null, active: true, lastLoginAt: new Date().toISOString(), store: null },
        ...stores.slice(0, 3).map((s, i) => ({
          id: `demo_mgr_${i + 1}`, email: `loja${i + 1}@novaotica.com`, name: `Gestor ${s.city || s.name}`,
          role: 'STORE_MANAGER', storeId: s.id, active: i !== 2, lastLoginAt: i === 0 ? new Date().toISOString() : null,
          store: { name: s.name },
        })),
      ];

// Trilha de decisões da sessão (a demo não tem servidor; some ao recarregar).
const demoDecisions: {
  id: string; cardId: string; cardType: string; outcome: string; note: string | null;
  impact: number; decidedAt: string; decidedByName: string; daysToDecide: number | null;
}[] = [];

// ─── Lote de geração ────────────────────────────────────────────────────────
//
// Em produção o lote nasce da sincronização das 6h e a idade de cada card vem
// do banco. Aqui não há execuções passadas para consultar, então a demo ancora
// o lote na ÚLTIMA 6h real e deriva a idade de cada card de um hash do próprio
// id — determinístico, para o mesmo card não mudar de idade a cada recarga.

/** Última 6h — hoje se já passou das 6, senão ontem. */
function lastSixAm(): Date {
  const d = new Date();
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  d.setHours(6, 0, 0, 0);
  return d;
}

const demoBatchAt = lastSixAm();

/** Hash estável do id do card → 0..99. */
function cardSeed(cardId: string): number {
  let h = 2166136261;
  for (let i = 0; i < cardId.length; i++) {
    h ^= cardId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 100;
}

/**
 * Idade simulada: ~12% estreiam no lote de hoje, ~8% arrastam mais de 30 dias
 * (é justamente o que a tela precisa mostrar), o resto fica entre 1 e 29 dias.
 */
function demoCardAge(cardId: string): { firstSeenAt: Date; timesSeen: number } {
  const s = cardSeed(cardId);
  const ageDays = s < 12 ? 0 : s >= 92 ? 31 + (s - 92) * 9 : 1 + (s % 29);
  const d = new Date(demoBatchAt);
  d.setDate(d.getDate() - ageDays);
  return { firstSeenAt: d, timesSeen: ageDays === 0 ? 1 : 1 + ageDays };
}

// ─── Roteador ────────────────────────────────────────────────────────────────

export interface DemoRequest {
  method: string;
  url: string;
  /** Arrays chegam do axios como parâmetro repetido (multi-seleção). */
  params?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
}

/** Colapsa um param que deveria ser único (1º valor quando vier array). */
const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);

export function demoHandle({ method, url, params = {}, body = {} }: DemoRequest): unknown {
  const m = method.toUpperCase();
  const p = (re: RegExp) => re.exec(url);
  const days = Number(one(params.days)) || 30;

  // Auth — com contas nomeadas (build de dados reais) o login é validado;
  // sem elas, a demo pública continua aceitando qualquer credencial.
  if (url === '/auth/login') {
    if (buildAccounts.length > 0) {
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const idx = buildAccounts.findIndex(
        (a, i) => (email === accountUsers[i].email || email === a.name.toLowerCase()) && password === a.password,
      );
      if (idx === -1) return { __status: 401, error: 'E-mail ou senha inválidos.' };
      currentUser = accountUsers[idx];
      return { token: 'demo-token', user: currentUser };
    }
    currentUser = ADMIN_USER;
    return { token: 'demo-token', user: currentUser };
  }
  if (url === '/auth/me') return currentUser;

  // Usuários (gestão)
  if (url === '/users' && m === 'GET') return { total: demoUsers.length, rows: demoUsers };
  if (url === '/users' && m === 'POST') {
    const st = body.storeId ? storeById(body.storeId as string) : null;
    const u = {
      id: `demo_u_${demoUsers.length + 1}`, email: String(body.email ?? '').toLowerCase(), name: body.name,
      role: body.role, storeId: body.storeId ?? null, active: true, lastLoginAt: null,
      store: st ? { name: st.name } : null,
    };
    demoUsers.push(u);
    return u;
  }
  let mm = p(/^\/users\/(.+)\/reset-password$/);
  if (mm && m === 'POST') return { ok: true };
  mm = p(/^\/users\/(.+)$/);
  if (mm && m === 'PATCH') {
    const u = demoUsers.find((x) => x.id === mm![1]);
    if (!u) return { __status: 404, error: 'Usuário não encontrado' };
    if (u.id === ADMIN_USER.id && (body.role !== undefined || body.active !== undefined))
      return { __status: 400, error: 'Você não pode alterar o próprio papel ou status.' };
    for (const k of ['name', 'role', 'active'] as const) if (body[k] !== undefined) u[k] = body[k];
    if (body.storeId !== undefined) {
      u.storeId = body.storeId;
      const st = body.storeId ? storeById(body.storeId as string) : null;
      u.store = st ? { name: st.name } : null;
    }
    if (u.role === 'ADMIN') { u.storeId = null; u.store = null; }
    return u;
  }

  // Dashboard
  if (url === '/dashboard/summary')
    return {
      stores: stores.length, products: products.length, customers: 40, stockUnits,
      pendingMovements: movements.filter((x) => ['REQUESTED', 'PENDING'].includes(x.status as string)).length,
      sales30d: { count: salesCount, total: revenue },
      lastSync: { status: 'SUCCESS', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), recordsWritten: 982, window: '06:00-07:00' },
    };
  if (url === '/dashboard/sales-by-store') return { rows: salesByStore };
  if (url === '/dashboard/coverage') {
    // Com dados reais, usa os totais POR LOJA da rede inteira (storeStats);
    // sem eles (dataset antigo ou fictício), soma o catálogo local.
    const grupo = productGroup(params.group);
    // `storeCategory` traz estoque e venda por loja E por categoria, da rede
    // inteira — é o que permite aplicar o recorte sem subcontar pela amostra
    // do catálogo. `storeStats` é o total COM lente, e usá-lo aqui era metade
    // da cobertura defasada que o Galbe apontou: lente é estoque em volume e
    // venda sob encomenda, então empurra a cobertura para anos.
    const porCategoria = real?.storeCategory;
    const inputs: StoreCoverageInput[] =
      porCategoria && porCategoria.length > 0
        ? (() => {
            const acc = new Map<string, StoreCoverageInput>();
            for (const r of porCategoria) {
              if (!matchesProductGroup(r.label, grupo)) continue;
              // `stores` já exclui CD, assistência e estoque de compras — sem
              // isto elas voltavam pelo agregado, sem nome e sempre no topo.
              const s = stores.find((x) => x.externalId === r.storeExt);
              if (!s) continue;
              const cur = acc.get(s.id) ?? { storeId: s.id, storeName: s.name, stockUnits: 0, unitsSold: 0 };
              cur.stockUnits += r.stockUnits;
              cur.unitsSold += r.soldUnits;
              acc.set(s.id, cur);
            }
            return [...acc.values()];
          })()
        : real?.storeStats
          ? real.storeStats.flatMap((st) => {
              const s = stores.find((x) => x.externalId === st.externalId);
              if (!s) return [];
              return [{ storeId: s.id, storeName: s.name, stockUnits: st.stockUnits, unitsSold: st.soldUnits }];
            })
          : stores.map((s) => ({
              storeId: s.id,
              storeName: s.name,
              stockUnits: products.reduce((a, prod) => a + (stockQty.get(key(s.id, prod.id)) ?? 0), 0),
              unitsSold: products.reduce((a, prod) => a + (soldQty.get(key(s.id, prod.id)) ?? 0), 0),
            }));
    // A janela é a MEDIDA no dataset, não a pedida: dividir 7 dias de venda
    // por 30 é exatamente o que inflava a cobertura para 60–150 meses.
    const dias = effectiveDays(days);
    return { days: dias, windowDays: dias, rows: computeStoreCoverage(inputs, dias) };
  }

  // Sync
  if (url === '/sync/status')
    return { mode: 'mock', window: '06:00-07:00', windowOpen: true, now: '06:30', cron: '0 6 * * *', timezone: 'America/Sao_Paulo', lastRuns: [] };

  // Estoque
  if (url === '/stock') { const rows = stockRows(params); return { total: rows.length, page: 1, limit: 200, rows: rows.slice(0, 200) }; }

  // Produtos — categorias derivadas do catálogo carregado (com dados reais,
  // são os grupos do CDS; a lista fixa fictícia mostrava rótulos sem match).
  if (url === '/products/categories')
    return [...new Set(products.map((x) => x.category))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (url === '/products') {
    const g = productGroup(params.group);
    let rows = products.filter((x) => matchesProductGroup(x.category, g));
    const cat = one(params.category);
    if (cat) rows = rows.filter((x) => x.category === cat);
    const q0 = one(params.search);
    if (q0) { const q = q0.toLowerCase(); rows = rows.filter((x) => x.description.toLowerCase().includes(q) || x.brand.toLowerCase().includes(q)); }
    return { total: rows.length, page: 1, limit: 200, rows: rows.map((x) => ({ ...x, color: { name: x.color }, size: { name: x.size } })) };
  }
  mm = p(/^\/products\/(.+)$/);
  if (mm) {
    const prod = prodById(mm[1]);
    if (!prod) return { __status: 404, error: 'Produto não encontrado' };
    return {
      ...prod, color: { name: prod.color }, size: { name: prod.size },
      stockItems: stores.map((s) => ({ quantity: stockQty.get(key(s.id, prod.id)) ?? 0, store: { id: s.id, name: s.name } })),
    };
  }

  if (url === '/stores') {
    // ANTES: stockItems = products.length (o catálogo inteiro, igual para toda
    // loja) e sales = int(15,30), um número INVENTADO. O Galbe viu: "estoque
    // por SKU e loja tá uniforme". Agora os dois vêm do dataset.
    //
    // `skuCount` é da rede inteira; datasets antigos não o trazem, e aí
    // contamos os SKUs com saldo dentro da AMOSTRA do catálogo — número menor
    // que o real, por isso a tela avisa que é amostra.
    const amostrado = !real?.storeStats?.some((st) => typeof st.skuCount === 'number');
    const skusDaAmostra = (storeId: string) =>
      products.reduce((a, p) => a + ((stockQty.get(key(storeId, p.id)) ?? 0) > 0 ? 1 : 0), 0);

    return {
      total: stores.length,
      sampled: real ? amostrado : false,
      catalogSampled: real?.totals?.catalogSampled,
      productCountNetwork: real?.totals?.productCountNetwork,
      rows: stores.map((s) => {
        const st = real?.storeStats?.find((x) => x.externalId === s.externalId);
        const vendas = real?.salesByStore?.find((x) => x.externalId === s.externalId)?.count;
        return {
          ...s,
          _count: {
            stockItems: st?.skuCount ?? skusDaAmostra(s.id),
            sales: vendas ?? 0,
          },
        };
      }),
    };
  }

  if (url === '/sales') {
    const rows = Array.from({ length: 20 }, (_, i) => {
      const st = stores[i % stores.length];
      return {
        id: `sl_${i}`, externalId: String(5000 + i), saleDate: new Date(Date.now() - i * 86400000).toISOString(),
        total: money(150, 2500), status: 'Finalizada', store: { name: st.name }, seller: { name: 'Vendedor' },
        customer: { name: 'Cliente' }, _count: { items: int(1, 4) },
      };
    });
    return { total: rows.length, page: 1, limit: 100, rows };
  }

  // BI
  if (url === '/bi/kpis') {
    const positions = stores.length * products.length;
    const al = alerts();
    return {
      days, revenue, salesCount, avgTicket: round2(revenue / salesCount), turnover: 0.14,
      rupturaRate: round2((al.out / positions) * 100), lowStockRate: round2((al.low / positions) * 100),
      stockUnits, unitsSold: int(400, 700), stockPositions: positions, outOfStock: al.out, lowStock: al.low,
      pendingTransfers: movements.filter((x) => ['REQUESTED', 'PENDING'].includes(x.status as string)).length,
    };
  }
  if (url === '/bi/sales-timeseries') return timeseries(days);
  if (url === '/bi/sales-by-dimension') return byDimension(one(params.by) ?? 'store');
  if (url === '/bi/sales-flow') return salesFlow();
  if (url === '/bi/transfer-flow') return transferFlow();
  if (url === '/bi/heatmap') return heatmap();

  // Relatórios
  if (url === '/reports/abc') return abc(days, one(params.dimension) === 'brand' ? 'brand' : 'product');
  if (url === '/reports/turnover') return turnover(days);
  if (url === '/reports/coverage') return brandCoverageReport(days);
  if (url === '/reports/sales-analysis') return salesAnalysisReport(days, one(params.by) ?? 'brand');

  // Planejamento & Compras (reusa a matemática do backend via @planning)
  const cfgForBrand = (brand: string | null) =>
    brand !== null && demoLeadTimes.has(brand)
      ? { ...DEFAULT_PLANNING_CONFIG, leadTimeDays: demoLeadTimes.get(brand)! }
      : DEFAULT_PLANNING_CONFIG;
  /**
   * Histórico fictício p/ a previsão: 12 buckets mensais determinísticos com
   * sazonalidade — Óculos de Sol vendem mais no verão (dez–fev) e Armações
   * têm leve alta em janeiro. A janela recente ganha a tendência do produto.
   */
  const demoDemandHistory = (prod: Product, scope: Store[], period: number) => {
    const unitsSold = scope.reduce((a, s) => a + (soldQty.get(key(s.id, prod.id)) ?? 0), 0);
    const daily = period > 0 ? unitsSold / period : 0;
    const recentDays = Math.min(30, period);
    // tendência determinística: alguns produtos aquecendo, outros esfriando
    const trend = 0.8 + hash01(`trend:${prod.externalId}`) * 0.5; // 0.8–1.3
    const recentUnits = Math.min(unitsSold, Math.round(daily * recentDays * trend));
    const seasonalOf = (month: number) => {
      if (prod.category === 'Óculos de Sol') return month === 12 || month <= 2 ? 1.7 : 0.85;
      if (prod.category === 'Armação') return month === 1 ? 1.3 : 0.97;
      return 1;
    };
    const monthlyHistory = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const base = Math.max(4, daily * 30);
      return { month, units: Math.round(base * seasonalOf(month) * (0.9 + hash01(`m:${prod.externalId}:${month}`) * 0.2)) };
    });
    return {
      recentUnits,
      recentDays,
      priorUnits: unitsSold - recentUnits,
      priorDays: Math.max(0, period - recentDays),
      monthlyHistory,
      currentMonth: new Date().getMonth() + 1,
    };
  };

  const planningPlans = (period: number, storeId?: string, group: ProductGroup = 'todos') => {
    const scope = storeId ? stores.filter((s) => s.id === storeId) : stores;
    return products.filter((prod) => matchesProductGroup(prod.category, group)).map((prod) =>
      analyzeProduct(
        {
          productId: prod.id,
          description: prod.description,
          brand: prod.brand,
          category: prod.category,
          unitsSold: scope.reduce((a, s) => a + (soldQty.get(key(s.id, prod.id)) ?? 0), 0),
          currentStock: scope.reduce((a, s) => a + (stockQty.get(key(s.id, prod.id)) ?? 0), 0),
          unitCost: round2(prod.price * 0.55),
          unitPrice: prod.price,
          onOrderQty: onOrderQty(prod.id),
          demandHistory: demoDemandHistory(prod, scope, period),
        },
        period,
        cfgForBrand(prod.brand),
      ),
    );
  };
  const planDays = Number(one(params.days)) || 90;
  const rawGroup = one(params.group);
  // Padrão operacional: 'principal' (óculos de grau/sol + relógio). Lentes só
  // entram quando pedidas explicitamente (faturamento/consolidado).
  const planGroup: ProductGroup = rawGroup === 'lentes' || rawGroup === 'todos' ? rawGroup : 'principal';
  if (url === '/planning/overview')
    return buildOverview(planningPlans(planDays, one(params.storeId), planGroup), planDays);
  if (url === '/planning/purchase-suggestions')
    return buildSuggestions(planningPlans(planDays, one(params.storeId), planGroup), planDays);
  if (url === '/planning/purchase-orders' && m === 'GET')
    return buildPurchaseOrders(planningPlans(planDays, one(params.storeId), planGroup), planDays);
  if (url === '/planning/purchase-orders' && m === 'POST') {
    const items = (body.items ?? []) as DemoOrderRecord['items'];
    const leadTimeDays = Number(body.leadTimeDays) || 14;
    const rec: DemoOrderRecord = {
      id: `po_${purchaseRecords.length + 1}`,
      supplier: String(body.supplier ?? '—'),
      leadTimeDays,
      status: 'SENT',
      items,
      units: items.reduce((s, i) => s + i.quantity, 0),
      total: round2(items.reduce((s, i) => s + i.total, 0)),
      sentAt: new Date().toISOString(),
      expectedAt: new Date(Date.now() + leadTimeDays * 86400000).toISOString(),
      receivedAt: null,
    };
    purchaseRecords.unshift(rec);
    return rec;
  }
  if (url === '/planning/purchase-orders/history') {
    const rows = [...purchaseRecords].sort((a, b) => (a.status === 'SENT' ? -1 : 1) - (b.status === 'SENT' ? -1 : 1));
    return { total: rows.length, rows };
  }
  mm = p(/^\/planning\/purchase-orders\/(.+)\/(receive|cancel)$/);
  if (mm && m === 'POST') {
    const rec = purchaseRecords.find((x) => x.id === mm![1]);
    if (!rec) return { __status: 404, error: 'Pedido não encontrado' };
    if (rec.status !== 'SENT') return { __status: 400, error: 'Pedido não está em trânsito.' };
    if (mm[2] === 'receive') {
      rec.status = 'RECEIVED';
      rec.receivedAt = new Date().toISOString();
      // Recebimento entra no estoque da 1ª loja (simplificação da demo).
      for (const it of rec.items) {
        const k = key(stores[0].id, it.productId);
        stockQty.set(k, (stockQty.get(k) ?? 0) + it.quantity);
      }
    } else {
      rec.status = 'CANCELLED';
    }
    return rec;
  }
  const rebalanceRows = () => {
    const inputs: StoreProductInput[] = [];
    for (const s of stores)
      for (const prod of products.filter(
        (x) => matchesProductGroup(x.category, planGroup) && !matchesProductGroup(x.category, 'lentes'),
      ))
        inputs.push({
          storeId: s.id,
          storeName: s.name,
          productId: prod.id,
          description: prod.description,
          brand: prod.brand,
          unitsSold: soldQty.get(key(s.id, prod.id)) ?? 0,
          currentStock: stockQty.get(key(s.id, prod.id)) ?? 0,
        });
    return buildRebalance(inputs, planDays, cfgForBrand);
  };
  // ─── Governança da decisão: trilha em memória, na sessão do navegador ─────
  if (url === '/planning/decisions' && m === 'POST') {
    const outcome = String(body.outcome ?? '');
    const note = String(body.note ?? '').trim();
    // Mesma regra do backend: recusar exige justificativa.
    if (outcome === 'REJECTED' && !note) {
      throw Object.assign(new Error('Recusar um card exige justificativa.'), { status: 400 });
    }
    const rec = {
      id: `dec_${demoDecisions.length + 1}`,
      cardId: String(body.cardId ?? ''),
      cardType: String(body.cardType ?? ''),
      outcome,
      note: note || null,
      impact: Number(body.impact) || 0,
      decidedAt: new Date().toISOString(),
      decidedByName: currentUser.name,
      daysToDecide: null as number | null,
    };
    demoDecisions.unshift(rec);
    return { id: rec.id };
  }
  if (url === '/planning/decisions/history') return demoDecisions.slice(0, 200);
  if (url === '/planning/decisions/stats') {
    const days = Math.max(1, Math.trunc(Number(one(params.days))) || 30);
    const series: { date: string; approved: number; rejected: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const day = demoDecisions.filter((r) => r.decidedAt.slice(0, 10) === key);
      series.push({
        date: key,
        approved: day.filter((r) => r.outcome === 'APPROVED').length,
        rejected: day.filter((r) => r.outcome === 'REJECTED').length,
      });
    }
    const ap = demoDecisions.filter((r) => r.outcome === 'APPROVED');
    const re = demoDecisions.filter((r) => r.outcome === 'REJECTED');
    const sum = (xs: typeof demoDecisions) => Math.round(xs.reduce((a, r) => a + r.impact, 0) * 100) / 100;
    return {
      slaDays: 30,
      approved: ap.length,
      rejected: re.length,
      approvedImpact: sum(ap),
      rejectedImpact: sum(re),
      avgDaysToDecide: null,
      series,
      byUser:
        demoDecisions.length === 0
          ? []
          : [
              {
                userId: currentUser.id,
                name: currentUser.name,
                approved: ap.length,
                rejected: re.length,
                impact: sum(demoDecisions),
              },
            ],
    };
  }
  if (url === '/planning/decisions') {
    // Mesmo comportamento do backend: card decidido sai do board (e é contado
    // em summary.decididos), senão ele reaparece a cada recarga da página.
    const board = buildDecisionCards(
      planningPlans(planDays, one(params.storeId), planGroup),
      rebalanceRows().rows,
      new Set(demoDecisions.map((r) => r.cardId)),
    );
    const history = new Map(
      board.cards.map((c) => [c.id, { cardId: c.id, ...demoCardAge(c.id) }]),
    );
    return annotateCardAges(board, history, {
      id: 'demo-batch',
      generatedAt: demoBatchAt.toISOString(),
      source: 'CRON',
      cardsTotal: board.cards.length + demoDecisions.length,
      cardsNew: [...history.values()].filter((h) => h.timesSeen <= 1).length,
      simulated: true,
    });
  }
  if (url === '/planning/batches') {
    // Série curta de lotes: um por dia às 6h, como o cron produz.
    const rows = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(demoBatchAt);
      d.setDate(d.getDate() - i);
      const board = i === 0
        ? buildDecisionCards(planningPlans(planDays, undefined, planGroup), rebalanceRows().rows)
        : null;
      const total = board?.cards.length ?? 0;
      return {
        id: `demo-batch-${i}`,
        generatedAt: d.toISOString(),
        source: 'CRON' as const,
        trigger: 'schedule',
        days: planDays,
        cardsTotal: total,
        cardsNew: board ? board.cards.filter((c) => cardSeed(c.id) < 12).length : 0,
        compra: board?.summary.byType.compra ?? 0,
        remanejamento: board?.summary.byType.remanejamento ?? 0,
        liquidacao: board?.summary.byType.liquidacao ?? 0,
        impactTotal: board?.summary.impactTotal ?? 0,
      };
    }).filter((r) => r.cardsTotal > 0);
    return { rows };
  }
  if (url === '/planning/strategy') {
    const floorUnits = Math.max(0, Math.trunc(Number(one(params.floor))) || 0);
    const windowMonths = Math.trunc(Number(one(params.window))) || 9;
    const r = one(params.risk);
    const risk = r === 'conservador' || r === 'agressivo' ? r : 'equilibrado';
    return buildCommercialStrategy(
      planningPlans(planDays, one(params.storeId), 'principal'),
      { floorUnits, windowMonths, risk },
    );
  }
  if (url === '/planning/rebalance') {
    return rebalanceRows();
  }
  if (url === '/planning/suppliers' && m === 'GET') {
    // Com dados reais, as marcas são as do catálogo carregado (as fictícias
    // MARCAS não casariam com nada); ordenadas por nº de produtos.
    let brands = MARCAS as string[];
    if (real) {
      const count = new Map<string, number>();
      for (const p of products) if (p.brand && p.brand !== '—') count.set(p.brand, (count.get(p.brand) ?? 0) + 1);
      brands = [...count.keys()].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0));
    }
    return {
      defaultLeadTimeDays: DEFAULT_PLANNING_CONFIG.leadTimeDays,
      rows: brands.map((brand) => ({
        brand,
        leadTimeDays: demoLeadTimes.get(brand) ?? null,
        products: products.filter((x) => x.brand === brand).length,
        isDefault: !demoLeadTimes.has(brand),
      })),
    };
  }
  if (url === '/planning/suppliers' && m === 'PUT') {
    const brand = String(body.brand ?? '');
    const lt = body.leadTimeDays;
    if (lt === null) demoLeadTimes.delete(brand);
    else demoLeadTimes.set(brand, Number(lt));
    return { brand, leadTimeDays: lt };
  }

  // Mix de marcas por bandeira (feedback 04 fase 2)
  if (url === '/reports/brand-mix') {
    // Mesmo recorte das outras visões por marca: lente e tratamento ficam de
    // fora (módulo do laboratório). Do catálogo, e não do agregado pronto — o
    // agregado é por fornecedor e inclui lente, então o Galbe veria ZEISS aqui
    // depois de não vê-la na aba ao lado.
    const acc = new Map<string, BrandBannerInput>();
    for (const p of products) {
      if (!isBrandAnalysable(p.category)) continue;
      const brand = brandLabel(p);
      for (const s of stores) {
        const stockUnits = stockQty.get(key(s.id, p.id)) ?? 0;
        const unitsSold = soldQty.get(key(s.id, p.id)) ?? 0;
        if (stockUnits === 0 && unitsSold === 0) continue;
        const k = `${s.name}|${brand}`;
        const cur = acc.get(k) ?? { storeName: s.name, brand, stockUnits: 0, unitsSold: 0 };
        cur.stockUnits += stockUnits;
        cur.unitsSold += unitsSold;
        acc.set(k, cur);
      }
    }
    const inputs: BrandBannerInput[] = [...acc.values()];
    return { days: effectiveDays(days), ...buildBrandMix(inputs) };
  }

  // Modo Feira (feedback 08): rateio por participação nas vendas do recorte.
  if (url === '/planning/fair-split') {
    const qty = Math.trunc(Number(one(params.qty)) || 0);
    if (qty < 1 || qty > 100_000) return { __status: 400, error: 'qty deve ser um inteiro entre 1 e 100000.' };
    const brand = one(params.brand)?.trim();
    const category = one(params.category)?.trim();
    if (!brand === !category) return { __status: 400, error: 'Informe exatamente um recorte: brand OU category.' };

    let inputs: FairSplitInput[];
    const src = brand ? real?.storeBrand : real?.storeCategory;
    if (src) {
      const alvo = (brand ?? category)!;
      const byStore = new Map(src.filter((r) => r.label === alvo).map((r) => [r.storeExt, r]));
      inputs = stores.map((s) => ({
        storeId: s.id,
        storeName: s.name,
        unitsSold: byStore.get(s.externalId)?.soldUnits ?? 0,
        stockUnits: byStore.get(s.externalId)?.stockUnits ?? 0,
      }));
    } else {
      const match = (p: Product) => (brand ? p.brand === brand : p.category === category);
      const matched = products.filter(match); // invariante à loja: filtra 1x
      inputs = stores.map((s) => ({
        storeId: s.id,
        storeName: s.name,
        unitsSold: matched.reduce((a, p) => a + (soldQty.get(key(s.id, p.id)) ?? 0), 0),
        stockUnits: matched.reduce((a, p) => a + (stockQty.get(key(s.id, p.id)) ?? 0), 0),
      }));
    }
    return { days: effectiveDays(days), filter: { brand, category }, ...buildFairSplit(inputs, qty) };
  }

  // Alertas
  if (url === '/alerts') return alerts(productGroup(params.group));
  if (url === '/alerts/min-stock' && m === 'PUT') {
    const prod = prodById(body.productId as string);
    if (!prod) return { __status: 404, error: 'Produto não encontrado' };
    if (body.storeId) {
      storeMinStock.set(key(body.storeId as string, prod.id), body.minStock === null ? null : Number(body.minStock ?? 3));
      return { storeId: body.storeId, productId: prod.id, minStock: body.minStock, scope: 'store' };
    }
    prod.minStock = Number(body.minStock ?? 3);
    return { id: prod.id, minStock: prod.minStock, scope: 'product' };
  }

  // AR
  if (url === '/ar/products')
    return {
      total: arProductIds.length,
      rows: arProductIds.map((id) => {
        const prod = prodById(id)!;
        return {
          productId: id, description: prod.description, brand: prod.brand, category: prod.category,
          price: prod.price, assetType: 'GLB_3D', assetUrl: `demo://frames/${prod.externalId}.glb`,
          available: stores.reduce((a, s) => a + (stockQty.get(key(s.id, id)) ?? 0), 0),
        };
      }),
    };
  mm = p(/^\/ar\/products\/(.+)\/asset$/);
  if (mm) {
    const prod = prodById(mm[1]);
    if (!prod) return { __status: 404, error: 'Asset não encontrado' };
    return { productId: prod.id, type: 'GLB_3D', url: `demo://frames/${prod.externalId}.glb`, fit: { frameWidth: 138, bridgeWidth: 18, templeLength: 145, lensHeight: 42, scale: 1 }, version: 1, product: { description: prod.description, brand: prod.brand } };
  }
  if (url === '/ar/tryon-events' && m === 'POST') { tryOns += 1; if (body.converted) tryOnConverted += 1; return { id: `to_${tryOns}` }; }
  if (url === '/ar/stats')
    return {
      days, total: tryOns, converted: tryOnConverted,
      conversionRate: tryOns > 0 ? round2((tryOnConverted / tryOns) * 100) : 0,
      topProducts: arProductIds.slice(0, 5).map((id) => ({ productId: id, description: prodById(id)!.description, tryOns: int(1, 6) })),
    };

  // Carrinho
  if (url === '/cart' && m === 'GET') return cartView();
  if (url === '/cart' && m === 'DELETE') { cart = null; return cartView(); }
  if (url === '/cart/items' && m === 'POST') {
    const { productId, storeId, quantity } = body as { productId: string; storeId: string; quantity?: number };
    if (cart && cart.storeId !== storeId) return { __status: 400, error: 'Seu carrinho é de outra loja.' };
    if (!cart) cart = { storeId, items: [] };
    const ex = cart.items.find((i) => i.productId === productId);
    const desired = (ex?.quantity ?? 0) + (quantity ?? 1);
    if (desired > availableAt(storeId, productId)) return { __status: 400, error: `Saldo insuficiente (disponível: ${availableAt(storeId, productId)}).` };
    if (ex) ex.quantity = desired; else cart.items.push({ productId, quantity: quantity ?? 1 });
    return cartView();
  }
  mm = p(/^\/cart\/items\/(.+)$/);
  if (mm && cart) {
    const pid = mm[1];
    if (m === 'DELETE') cart.items = cart.items.filter((i) => i.productId !== pid);
    if (m === 'PATCH') {
      const q = Number(body.quantity ?? 0);
      if (q <= 0) cart.items = cart.items.filter((i) => i.productId !== pid);
      else { const it = cart.items.find((i) => i.productId === pid); if (it) it.quantity = q; }
    }
    return cartView();
  }

  // Pedidos
  if (url === '/orders' && m === 'POST') {
    const view = cartView();
    if (!cart || view.items.length === 0) return { __status: 400, error: 'Carrinho vazio.' };
    for (const it of cart.items) reserved.set(key(cart.storeId, it.productId), (reserved.get(key(cart.storeId, it.productId)) ?? 0) + it.quantity);
    const order = {
      id: `ord_${orders.length + 1}`, number: `NO-DEMO-${1000 + orders.length}`, status: 'CREATED',
      subtotal: view.subtotal, total: view.total, customerName: (body.customerName as string) ?? 'Cliente',
      createdAt: new Date().toISOString(), paidAt: null, store: { name: view.storeName },
      payment: { status: 'PENDING', method: (body.method as string) ?? 'PIX', qrCode: `00020126DEMO-${view.total.toFixed(2)}` },
      items: view.items.map((i, idx) => ({ id: `oi_${idx}`, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total, product: { description: i.description }, _storeId: cart!.storeId, _productId: i.productId })),
    };
    orders.unshift(order);
    cart = null;
    return order;
  }
  if (url === '/orders' && m === 'GET') return { total: orders.length, page: 1, limit: 50, rows: orders };
  mm = p(/^\/orders\/(.+)\/pay$/);
  if (mm && m === 'POST') {
    const order = orders.find((o) => o.id === mm![1]) as Record<string, unknown> | undefined;
    if (!order) return { __status: 404, error: 'Pedido não encontrado' };
    if (order.status !== 'PAID') {
      order.status = 'PAID'; order.paidAt = new Date().toISOString();
      (order.payment as Record<string, unknown>).status = 'APPROVED';
      for (const it of order.items as Record<string, unknown>[]) {
        const sid = it._storeId as string; const pid = it._productId as string;
        stockQty.set(key(sid, pid), Math.max((stockQty.get(key(sid, pid)) ?? 0) - (it.quantity as number), 0));
        reserved.set(key(sid, pid), Math.max((reserved.get(key(sid, pid)) ?? 0) - (it.quantity as number), 0));
      }
    }
    return order;
  }
  mm = p(/^\/orders\/(.+)$/);
  if (mm && m === 'GET') { const order = orders.find((o) => o.id === mm![1]); return order ?? { __status: 404, error: 'Pedido não encontrado' }; }

  // Movimentações
  if (url === '/movements' && m === 'GET') {
    let rows = movements;
    if (params.status) rows = rows.filter((x) => x.status === params.status);
    return { total: rows.length, page: 1, limit: 50, rows };
  }
  if (url === '/movements' && m === 'POST') {
    const mv = {
      id: `mv_${movements.length + 1}`, type: body.type, status: (body.type === 'TRANSFER' ? 'PENDING' : (body.confirm ? 'CONFIRMED' : 'PENDING')),
      quantity: body.quantity, reason: body.reason ?? null, reference: body.reference ?? null, decisionNote: null,
      createdAt: new Date().toISOString(), product: { id: body.productId, description: prodById(body.productId as string)?.description ?? '—' },
      fromStore: body.fromStoreId ? { id: body.fromStoreId, name: storeById(body.fromStoreId as string)?.name } : null,
      toStore: body.toStoreId ? { id: body.toStoreId, name: storeById(body.toStoreId as string)?.name } : null,
    };
    movements.unshift(mv);
    return mv;
  }
  mm = p(/^\/movements\/(.+)\/(approve|reject|confirm|cancel)$/);
  if (mm && m === 'POST') {
    const mv = movements.find((x) => x.id === mm![1]) as Record<string, unknown> | undefined;
    if (!mv) return { __status: 404, error: 'Movimentação não encontrada' };
    mv.status = { approve: 'PENDING', reject: 'REJECTED', confirm: 'CONFIRMED', cancel: 'CANCELLED' }[mm![2]];
    return mv;
  }

  return { __status: 404, error: `Rota demo não implementada: ${m} ${url}` };
}
