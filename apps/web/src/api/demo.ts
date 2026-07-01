/**
 * Modo demonstração — dados fictícios servidos no próprio navegador.
 * Permite publicar o app como site estático (ex.: GitHub Pages) sem backend
 * nem banco. Ativado por VITE_DEMO=1; nenhum dado real é usado.
 */

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

const stores: Store[] = STORE_NAMES.map(([ext, city, state]) => ({
  id: `st_${ext}`,
  externalId: ext,
  name: `Nova Ótica — ${city}`,
  city,
  state,
  active: true,
}));

const products: Product[] = Array.from({ length: 16 }, (_, i) => {
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
for (const st of stores) for (const p of products) stockQty.set(`${st.id}:${p.id}`, r() < 0.12 ? int(0, 2) : int(3, 30));
const reserved = new Map<string, number>();
const key = (s: string, p: string) => `${s}:${p}`;

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

const stockUnits = [...stockQty.values()].reduce((a, b) => a + b, 0);
const salesByStore = stores.map((s) => ({
  storeId: s.id,
  storeName: s.name,
  count: int(15, 30),
  total: money(35000, 75000),
}));
const revenue = round2(salesByStore.reduce((a, b) => a + b.total, 0));
const salesCount = salesByStore.reduce((a, b) => a + b.count, 0);

function stockRows(params: Record<string, string | undefined>) {
  const rows: Record<string, unknown>[] = [];
  for (const st of stores) {
    if (params.storeId && params.storeId !== st.id) continue;
    for (const p of products) {
      if (params.productId && params.productId !== p.id) continue;
      if (params.category && params.category !== p.category) continue;
      if (params.search) {
        const q = params.search.toLowerCase();
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

function alerts() {
  const rows = stockRows({}).filter((x) => (x.availableNow as number) <= (x.minStock as number));
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
  else if (by === 'payment') rows = PAG.map((m) => ({ key: m, label: m, total: money(20000, 70000), count: int(10, 40) }));
  else {
    const dims = by === 'brand' ? MARCAS : CATEGORIAS;
    rows = dims.map((m) => ({ key: m, label: m, total: money(15000, 60000), count: int(20, 90) }));
  }
  return { by, rows: rows.sort((a, b) => b.total - a.total) };
}

function abc(days: number) {
  const rows = products
    .map((p) => ({ p, revenue: money(2000, 40000), units: int(5, 120) }))
    .sort((a, b) => b.revenue - a.revenue);
  const total = round2(rows.reduce((a, b) => a + b.revenue, 0));
  const summary = { A: { products: 0, revenue: 0 }, B: { products: 0, revenue: 0 }, C: { products: 0, revenue: 0 } };
  let cum = 0;
  const out = rows.map((x) => {
    const revenuePct = (x.revenue / total) * 100;
    cum += revenuePct;
    const cls = cum <= 80 ? 'A' : cum <= 95 ? 'B' : 'C';
    summary[cls].products += 1;
    summary[cls].revenue = round2(summary[cls].revenue + x.revenue);
    return {
      productId: x.p.id, description: x.p.description, brand: x.p.brand, category: x.p.category,
      revenue: round2(x.revenue), units: x.units, revenuePct: round2(revenuePct),
      cumulativePct: round2(cum), class: cls,
    };
  });
  return { days, totalRevenue: total, summary, rows: out };
}

function turnover(days: number) {
  return {
    days,
    rows: products.map((p) => {
      const unitsSold = int(0, 60);
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
  yLabels.forEach((_, yi) => WEEK.forEach((__, wd) => cells.push([wd, yi, Math.round(money(500, 9000))])));
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

// ─── Planejamento & Compras (análise preditiva) ───────────────────────────────
// Porta compacta e determinística de apps/api/src/modules/planning/planning.math.ts
// (mesmas constantes), para que a demo mostre os mesmos indicadores sem backend.

const PLAN = { leadTimeDays: 14, safetyDays: 7, targetCoverDays: 60, overstockDays: 120, fastCoverDays: 15, slowCoverDays: 90 };

/** Hash estável em [0,1) a partir de uma string (velocidade fictícia por SKU). */
function hash01(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Demanda diária fictícia, determinística e com boa variedade por produto.
 * Como o estoque é somado pelas 4 lojas (~12–120 un.), os perfis são calibrados
 * para gerar os quatro cenários de recomendação (comprar/manter/não comprar/
 * liquidar) e um mix realista de giro numa rede de óticas.
 */
function demoDailyDemand(p: Product) {
  const i = Number(p.externalId) - 1000;
  const v = hash01(`vel:${p.externalId}`); // variação intra-perfil
  switch (((i % 5) + 5) % 5) {
    case 0:
      return round2(4 + v * 2.5); // alto giro → COMPRAR
    case 1:
      return round2(1.0 + v * 0.7); // saudável → MANTER
    case 2:
      return round2(0.08 + v * 0.28); // baixo giro → NÃO COMPRAR (excesso)
    case 3:
      return 0; // parado → LIQUIDAR
    default:
      return round2(0.5 + v * 0.5); // saudável/limítrofe
  }
}

interface DemoPlan {
  productId: string; description: string; brand: string; category: string;
  currentStock: number; unitsSold: number; dailyDemand: number; coverageDays: number | null;
  reorderPoint: number; targetStock: number; unitCost: number; stockValue: number; excessValue: number;
  revenue: number; movementClass: 'DEAD' | 'SLOW' | 'HEALTHY' | 'FAST';
  recommendation: 'BUY' | 'HOLD' | 'DONT_BUY' | 'LIQUIDATE'; suggestedQty: number; capital: number;
  stockoutInDays: number | null; reason: string;
}

function demoPlans(days: number, storeId?: string): DemoPlan[] {
  const scope = storeId ? stores.filter((s) => s.id === storeId) : stores;
  return products.map((p) => {
    const currentStock = scope.reduce((a, s) => a + (stockQty.get(key(s.id, p.id)) ?? 0), 0);
    const dailyDemand = demoDailyDemand(p);
    const unitsSold = Math.round(dailyDemand * days);
    const unitCost = round2(p.price * 0.55);
    const coverageDays = dailyDemand > 0 ? currentStock / dailyDemand : null;
    const reorderPoint = dailyDemand * (PLAN.leadTimeDays + PLAN.safetyDays);
    const targetStock = dailyDemand * PLAN.targetCoverDays;
    const stockValue = round2(currentStock * unitCost);
    const excessValue = round2(Math.max(0, currentStock - targetStock) * unitCost);
    const revenue = round2(unitsSold * p.price);

    let movementClass: DemoPlan['movementClass'];
    if (dailyDemand === 0) movementClass = 'DEAD';
    else if ((coverageDays as number) < PLAN.fastCoverDays) movementClass = 'FAST';
    else if ((coverageDays as number) <= PLAN.slowCoverDays) movementClass = 'HEALTHY';
    else movementClass = 'SLOW';

    let recommendation: DemoPlan['recommendation'];
    let suggestedQty = 0;
    let reason: string;
    if (dailyDemand === 0) {
      if (currentStock > 0) { recommendation = 'LIQUIDATE'; reason = 'Sem vendas no período — capital parado; avaliar liquidação ou remanejamento.'; }
      else { recommendation = 'DONT_BUY'; reason = 'Sem giro e sem estoque — não repor.'; }
    } else if (currentStock <= reorderPoint) {
      recommendation = 'BUY';
      suggestedQty = Math.max(1, Math.ceil(targetStock - currentStock));
      reason = `Abaixo do ponto de reposição (${round2(reorderPoint)} un.); repor para ~${PLAN.targetCoverDays} dias de cobertura.`;
    } else if ((coverageDays as number) > PLAN.overstockDays) {
      recommendation = 'DONT_BUY';
      reason = `Excesso: ${Math.round(coverageDays as number)} dias de cobertura (acima de ${PLAN.overstockDays}). Não comprar.`;
    } else {
      recommendation = 'HOLD';
      reason = `Cobertura adequada (${Math.round(coverageDays as number)} dias).`;
    }

    return {
      productId: p.id, description: p.description, brand: p.brand, category: p.category,
      currentStock, unitsSold, dailyDemand, coverageDays: coverageDays === null ? null : Math.round(coverageDays * 10) / 10,
      reorderPoint: Math.round(reorderPoint * 10) / 10, targetStock: Math.round(targetStock), unitCost,
      stockValue, excessValue, revenue, movementClass, recommendation, suggestedQty,
      capital: round2(suggestedQty * unitCost),
      stockoutInDays: dailyDemand > 0 && currentStock <= reorderPoint ? Math.floor(coverageDays as number) : null,
      reason,
    };
  });
}

function planningOverviewDemo(days: number, storeId?: string) {
  const plans = demoPlans(days, storeId);
  const total = round2(plans.reduce((a, p) => a + p.stockValue, 0));
  const parked = round2(plans.filter((p) => p.movementClass === 'DEAD').reduce((a, p) => a + p.stockValue, 0));
  const excess = round2(plans.filter((p) => p.movementClass !== 'DEAD').reduce((a, p) => a + p.excessValue, 0));
  const idle = round2(parked + excess);
  const healthy = round2(Math.max(0, total - idle));

  const movement = { dead: 0, slow: 0, healthy: 0, fast: 0 } as Record<string, number>;
  for (const p of plans) movement[p.movementClass.toLowerCase()] += 1;

  const catMap = new Map<string, { category: string; capital: number; idle: number; units: number }>();
  for (const p of plans) {
    const cur = catMap.get(p.category) ?? { category: p.category, capital: 0, idle: 0, units: 0 };
    cur.capital = round2(cur.capital + p.stockValue);
    cur.idle = round2(cur.idle + (p.movementClass === 'DEAD' ? p.stockValue : p.excessValue));
    cur.units += p.currentStock;
    catMap.set(p.category, cur);
  }
  const byCategory = [...catMap.values()].sort((a, b) => b.capital - a.capital);

  const topIdle = plans
    .map((p) => ({ productId: p.productId, description: p.description, category: p.category, currentStock: p.currentStock, unitCost: p.unitCost, idleValue: p.movementClass === 'DEAD' ? p.stockValue : p.excessValue, coverageDays: p.coverageDays, movementClass: p.movementClass }))
    .filter((p) => p.idleValue > 0)
    .sort((a, b) => b.idleValue - a.idleValue)
    .slice(0, 8);

  // Pareto (80/20) por receita
  const ranked = plans.filter((p) => p.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = round2(ranked.reduce((a, p) => a + p.revenue, 0));
  let cum = 0, classAProducts = 0, classARevenue = 0;
  for (const p of ranked) {
    cum += p.revenue;
    if (totalRevenue > 0 && (cum / totalRevenue) * 100 <= 80) { classAProducts += 1; classARevenue += p.revenue; }
    else break;
  }
  if (classAProducts === 0 && ranked.length > 0) { classAProducts = 1; classARevenue = ranked[0].revenue; }

  return {
    days, currency: 'BRL',
    capital: { total, idle, parked, excess, healthy, idlePct: total > 0 ? Math.round((idle / total) * 1000) / 10 : 0 },
    movement,
    pareto: {
      totalRevenue, totalProducts: ranked.length, classAProducts,
      classAShareOfSkus: ranked.length > 0 ? Math.round((classAProducts / ranked.length) * 1000) / 10 : 0,
      classARevenueShare: totalRevenue > 0 ? Math.round((classARevenue / totalRevenue) * 1000) / 10 : 0,
    },
    topIdle, byCategory,
  };
}

function purchaseSuggestionsDemo(days: number, storeId?: string) {
  const plans = demoPlans(days, storeId);
  const summary = { buy: 0, hold: 0, dontBuy: 0, liquidate: 0, buyCapital: 0, avoidedCapital: 0 };
  for (const p of plans) {
    if (p.recommendation === 'BUY') { summary.buy += 1; summary.buyCapital += p.capital; }
    else if (p.recommendation === 'HOLD') summary.hold += 1;
    else if (p.recommendation === 'DONT_BUY') { summary.dontBuy += 1; summary.avoidedCapital += p.excessValue; }
    else { summary.liquidate += 1; summary.avoidedCapital += p.stockValue; }
  }
  summary.buyCapital = round2(summary.buyCapital);
  summary.avoidedCapital = round2(summary.avoidedCapital);
  const rank = { BUY: 0, LIQUIDATE: 1, DONT_BUY: 2, HOLD: 3 } as Record<string, number>;
  const rows = [...plans].sort((a, b) => {
    const r = rank[a.recommendation] - rank[b.recommendation];
    if (r !== 0) return r;
    if (a.recommendation === 'BUY') return (a.stockoutInDays ?? 1e9) - (b.stockoutInDays ?? 1e9);
    return b.stockValue - a.stockValue;
  });
  return { days, summary, rows };
}

const ADMIN_USER = { id: 'demo_admin', email: 'admin@novaotica.com', name: 'Administrador (Demo)', role: 'ADMIN', storeId: null, storeName: null };

// ─── Roteador ────────────────────────────────────────────────────────────────

export interface DemoRequest {
  method: string;
  url: string;
  params?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
}

export function demoHandle({ method, url, params = {}, body = {} }: DemoRequest): unknown {
  const m = method.toUpperCase();
  const p = (re: RegExp) => re.exec(url);
  const days = Number(params.days) || 30;

  // Auth
  if (url === '/auth/login') return { token: 'demo-token', user: ADMIN_USER };
  if (url === '/auth/me') return ADMIN_USER;

  // Dashboard
  if (url === '/dashboard/summary')
    return {
      stores: stores.length, products: products.length, customers: 40, stockUnits,
      pendingMovements: movements.filter((x) => ['REQUESTED', 'PENDING'].includes(x.status as string)).length,
      sales30d: { count: salesCount, total: revenue },
      lastSync: { status: 'SUCCESS', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), recordsWritten: 982, window: '06:00-07:00' },
    };
  if (url === '/dashboard/sales-by-store') return { rows: salesByStore };

  // Sync
  if (url === '/sync/status')
    return { mode: 'mock', window: '06:00-07:00', windowOpen: true, now: '06:30', cron: '0 6 * * *', timezone: 'America/Sao_Paulo', lastRuns: [] };

  // Estoque
  if (url === '/stock') { const rows = stockRows(params); return { total: rows.length, page: 1, limit: 200, rows: rows.slice(0, 200) }; }

  // Produtos
  if (url === '/products/categories') return CATEGORIAS;
  if (url === '/products') {
    let rows = products;
    if (params.category) rows = rows.filter((x) => x.category === params.category);
    if (params.search) { const q = params.search.toLowerCase(); rows = rows.filter((x) => x.description.toLowerCase().includes(q) || x.brand.toLowerCase().includes(q)); }
    return { total: rows.length, page: 1, limit: 200, rows: rows.map((x) => ({ ...x, color: { name: x.color }, size: { name: x.size } })) };
  }
  let mm = p(/^\/products\/(.+)$/);
  if (mm) {
    const prod = prodById(mm[1]);
    if (!prod) return { __status: 404, error: 'Produto não encontrado' };
    return {
      ...prod, color: { name: prod.color }, size: { name: prod.size },
      stockItems: stores.map((s) => ({ quantity: stockQty.get(key(s.id, prod.id)) ?? 0, store: { id: s.id, name: s.name } })),
    };
  }

  if (url === '/stores')
    return { total: stores.length, rows: stores.map((s) => ({ ...s, _count: { stockItems: products.length, sales: int(15, 30) } })) };

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
  if (url === '/bi/sales-by-dimension') return byDimension(params.by ?? 'store');
  if (url === '/bi/sales-flow') return salesFlow();
  if (url === '/bi/transfer-flow') return transferFlow();
  if (url === '/bi/heatmap') return heatmap();

  // Relatórios
  if (url === '/reports/abc') return abc(days);
  if (url === '/reports/turnover') return turnover(days);

  // Planejamento & Compras (análise preditiva)
  if (url === '/planning/overview') return planningOverviewDemo(days, params.storeId || undefined);
  if (url === '/planning/purchase-suggestions') return purchaseSuggestionsDemo(days, params.storeId || undefined);

  // Alertas
  if (url === '/alerts') return alerts();
  if (url === '/alerts/min-stock' && m === 'PUT') { const prod = prodById(body.productId as string); if (prod) prod.minStock = Number(body.minStock ?? 3); return { id: prod?.id, minStock: prod?.minStock }; }

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
