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
  analysisBrand,
  normBrandKey,
  abcFromItems,
  analyzeProduct,
  buildCommercialStrategy,
  annotateCardAges,
  buildDecisionCards,
  extractBrand,
  isBrandAnalysable,
  matchesProductGroup,
  PRODUCT_GROUPS,
  buildBrandMix,
  buildFairSplit,
  buildOverview,
  buildPurchaseOrders,
  buildRebalance,
  buildSuggestions,
  computeCoverage,
  computeStoreCoverage,
  contarIdades,
  filtrarVista,
  grifesDoQuadro,
  paginar,
  recortePedido,
  DECISION_PRIORITIES,
  DECISION_TYPES,
  DEFAULT_PLANNING_CONFIG,
  RECOMENDACOES,
  CARDS_POR_PAGINA,
  LINHAS_POR_PAGINA,
  TETO_DE_CARDS,
  TETO_DE_LINHAS,
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
  /** Valor de compra do ERP; null quando o catálogo não trouxe. */
  cost?: number | null;
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
// Feedback 6.0 · item 01 — as lojas ZEISS VISION CENTER rodam em outro ERP e o
// CDS não as atualiza em tempo real. Mesma marcação do backend
// (Store.externalErp / EXTERNAL_ERP_STORE_PATTERN): a demonstração precisa
// mostrar a mesma rede que a produção, senão volta a ser uma segunda verdade.
const EXTERNAL_ERP_STORE_PATTERN = /zeiss/i;
const stores: Store[] = allStores.filter(
  (s) => !PLANNING_EXCLUDED_STORE_PATTERN.test(s.name) && !EXTERNAL_ERP_STORE_PATTERN.test(s.name),
);

const products: Product[] = real
  ? real.products.map((p) => ({
      id: `pr_${p.externalId}`,
      externalId: p.externalId,
      sku: p.sku,
      description: p.description,
      brand: p.brand || '—',
      category: p.category || 'OUTROS',
      price: p.price,
      cost: p.cost,
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
  // Estoque morto de armação (products[10] é 'Armação', 10 % 5 === 0): parado
  // em toda a rede, com uma loja concentrando o saldo. É o que faz a demo
  // fictícia exercitar o card de LIQUIDAÇÃO e a regra de desconto da rede —
  // sem ele o caminho só existia no dataset real, que é gitignorado, e a
  // suíte passava aqui e quebrava no CI.
  for (const st of stores) {
    soldQty.set(key(st.id, products[10].id), 0);
    stockQty.set(key(st.id, products[10].id), 4);
  }
  stockQty.set(key(stores[2].id, products[10].id), 40);
}

// Prazos por fornecedor (marca) editáveis na demo
const demoLeadTimes = new Map<string, number>([
  [MARCAS[0], 30],
  [MARCAS[1], 7],
]);

// Grifes fora do mix atual da rede (feedback 6.0 · item 03). Começa vazia de
// propósito: é uma declaração comercial, e inventar uma na demonstração seria
// mostrar ao cliente uma decisão que ele não tomou.
/**
 * Grifes marcadas como fora do mix na demonstração, pela CHAVE NORMALIZADA — a
 * mesma régua da API (`normBrandKey`). Guardar a string literal da tela repetia
 * aqui o defeito que a produção acabou de corrigir: marcar por uma forma e
 * desmarcar por outra deixava a marcação presa, sem erro nenhum.
 */
const demoForaDoMix = new Set<string>();

/** A grife está fora do mix? Aceita qualquer forma do nome. */
const foraDoMixDemo = (grife: string | null) =>
  grife != null && demoForaDoMix.has(normBrandKey(grife));

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

// Produtos com provador (AR) — armações e óculos COM saldo na rede.
//
// A comparação era `p.category === 'Armação' || p.category === 'Óculos de Sol'`,
// que são os rótulos do catálogo FICTÍCIO (a constante CATEGORIAS, no topo deste
// arquivo). Quando a demo passou a carregar o dataset real da rede, a categoria
// passou a vir crua do ERP — 'ARMACAO' e 'OCULOS', caixa alta e sem acento — e
// nenhum produto casou: `/ar/products` devolvia zero linha e a vitrine abria
// vazia dizendo "cadastre assets de AR", como se fosse falta de conteúdo.
// Comparar rótulo de ERP por igualdade literal é a armadilha; normalizar (sem
// acento, caixa alta) e testar o PREFIXO atende os dois catálogos de uma vez e
// mantém 'PORTA OCULOS' (acessório, não é óculos) de fora.
// \p{Diacritic} em vez da faixa U+0300–U+036F escrita à mão: acento combinante
// solto no código-fonte é invisível no editor e some em diff mal configurado.
const semAcento = (s: string) => (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
const temProvador = (categoria: string) => {
  const c = semAcento(categoria);
  return c.startsWith('ARMACAO') || c.startsWith('OCULOS');
};
// Saldo > 0 espelha a regra do backend (seed.ts exige `stockItems some quantity
// gt 0`): sem isso a vitrine ofereceria "Adicionar" em produto que o carrinho
// recusa com "saldo insuficiente".
const arProductIds = products
  .filter((p) => temProvador(p.category) && stores.some((s) => (stockQty.get(key(s.id, p.id)) ?? 0) > 0))
  .map((p) => p.id);

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
  const g = one(v) as ProductGroup;
  return PRODUCT_GROUPS.includes(g) ? g : 'todos';
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

function alerts(group: ProductGroup = 'todos', category?: string | string[], storeId?: string) {
  const rows = stockRows({ group, category, storeId }).filter((x) => {
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

function timeseries(days: number, fatia = 1, aproximado = false) {
  if (real) {
    // Série diária REAL (30 dias da sonda), recortada ao período pedido.
    // A sonda traz o dia a dia em AGREGADO DE REDE, sem quebra por categoria:
    // com recorte ativo a série é projetada pela fatia que o recorte ocupa no
    // período, e vai marcada como aproximada. Melhor uma curva declaradamente
    // proporcional do que a curva da rede inteira fingindo ser a do recorte.
    const points = real.dailySales.slice(-effectiveDays(days)).map((d) => ({
      date: d.date,
      total: round2(d.total * fatia),
      count: Math.round(d.count * fatia),
    }));
    // `days` é o que a série COBRE, não o que foi pedido: quem lê a resposta
    // monta rótulo com ele, e um 30 em cima de 7 pontos é o rótulo mentindo.
    return { days: points.length, granularity: 'day', points, ...(aproximado ? { aproximado: true } : {}) };
  }
  // Fictício: a MESMA série que o KPI e o recorte por data leem. Era aqui que
  // ela nascia sorteada a cada chamada, e por isso o KPI e o gráfico ao lado
  // nunca fechavam.
  const points = serieDiaria().slice(-effectiveDays(days)).map((d) => ({
    date: d.date,
    total: round2(d.total * fatia),
    count: Math.max(1, Math.round(d.count * fatia)),
  }));
  return { days: points.length, granularity: 'day', points, ...(aproximado ? { aproximado: true } : {}) };
}

/**
 * ── BI · O RECORTE ────────────────────────────────────────────────────────────
 *
 * O módulo inteiro era cego ao recorte: nenhuma das seis rotas lia `group` ou
 * `category`, e trocar "Óculos" por "Lentes" no topo do console não mexia um
 * pixel de gráfico nenhum. Pior: metade dos números era sorteada
 * (`unitsSold: int(400, 700)`) ou era o agregado da REDE mesmo quando havia
 * uma loja escolhida.
 *
 * Agora tudo sai da MESMA base dos relatórios — `soldItemsScoped` ∩
 * `noRecorte` —, que é o que faz os números baterem entre as telas.
 *
 * O que NÃO dá para recortar com a extração atual está marcado como
 * `aproximado` e a tela diz isso em texto: a forma de pagamento cobre a venda
 * inteira (uma venda de armação + lente tem um cartão só), e a série diária e
 * o mapa de calor vêm da sonda em agregado de rede, sem quebra por categoria.
 */
function biBase(group: ProductGroup, category: string | string[] | undefined, storeId?: string) {
  const dentro = noRecorte(group, category);
  const itens = soldItemsScoped(storeId).filter((x) => dentro(x.p));
  const receita = round2(itens.reduce((a, x) => a + x.revenue, 0));
  const unidades = itens.reduce((a, x) => a + x.units, 0);
  // Quanto o recorte pesa no período — é este fator que projeta o que a sonda
  // só traz agregado (dia a dia, dia da semana, forma de pagamento).
  const totalPeriodo = round2(soldItemsScoped(storeId).reduce((a, x) => a + x.revenue, 0));
  const fatia = totalPeriodo > 0 ? receita / totalPeriodo : 0;
  const recortando = group !== 'todos' || Boolean(asSet(category)) || Boolean(storeId);
  return { itens, receita, unidades, fatia, recortando };
}

function byDimension(
  by: string,
  group: ProductGroup = 'todos',
  category?: string | string[],
  storeId?: string,
  days = 0,
) {
  const base = biBase(group, category, storeId);
  let rows: { key: string; label: string; total: number; count: number }[] = [];
  let aproximado = false;
  /** A dimensão foi recortada por DATA de verdade (só o caso loja sem recorte). */
  let porDataExata = false;

  if (by === 'store') {
    /*
       Duas réguas, e a escolha entre elas é a diferença entre medir e estimar:

       · SEM recorte de produto, o faturamento por loja tem DATA na amostra
         (weekdayStore), então o recorte de dias é exato e é ele que vale — é o
         que faz a barra por loja acompanhar o filtro em vez de ficar parada.
       · COM recorte de produto, a sonda não quebra loja × dia × produto. Aí
         vale a régua do item vendido, que respeita o recorte de produto e
         cobre a amostra inteira.
    */
    const porData = real && !base.recortando && days > 0 ? salesByStoreNaJanela(days) : null;
    porDataExata = porData !== null;
    if (porData) {
      rows = porData
        .map((s) => ({ key: s.storeId, label: s.storeName, total: s.total, count: s.count }))
        .filter((r) => r.total > 0);
    } else {
      // Por loja, o valor é a soma dos itens DAQUELA loja dentro do recorte —
      // não o faturamento inteiro que passou por ela.
      const escopo = storeId ? stores.filter((s) => s.id === storeId) : stores;
      const dentro = noRecorte(group, category);
      rows = escopo
        .map((st) => {
          const itens = soldItemsScoped(st.id).filter((x) => dentro(x.p));
          return {
            key: st.id,
            label: st.name,
            total: round2(itens.reduce((a, x) => a + x.revenue, 0)),
            count: itens.reduce((a, x) => a + x.units, 0),
          };
        })
        .filter((r) => r.total > 0);
    }
  } else if (by === 'payment') {
    // Não se reparte por produto. Com recorte ativo, o que existe é a fatia do
    // recorte no período — declarada como aproximação, nunca como medida.
    const src = real
      ? real.byPayment.map((m) => ({ key: m.label, label: m.label, total: m.total, count: m.count }))
      : PAG.map((m) => ({ key: m, label: m, total: money(20000, 70000), count: int(10, 40) }));
    aproximado = base.recortando;
    rows = aproximado
      ? src.map((r) => ({ ...r, total: round2(r.total * base.fatia), count: Math.round(r.count * base.fatia) }))
      : src;
  } else {
    // Categoria e marca saem do item vendido: aqui o recorte é exato.
    const acc = new Map<string, { total: number; count: number }>();
    for (const x of base.itens) {
      const k = by === 'brand' ? brandLabel(x.p) : x.p.category || 'Não classificado';
      const cur = acc.get(k) ?? { total: 0, count: 0 };
      cur.total += x.revenue;
      cur.count += x.units;
      acc.set(k, cur);
    }
    rows = [...acc.entries()].map(([k, v]) => ({ key: k, label: k, total: round2(v.total), count: v.count }));
  }

  /*
     RECORTE DE DATA NAS QUEBRAS QUE NÃO TÊM DIA.

     Só o caminho `porData` acima é medido dia a dia. Todos os outros saem do
     item vendido ou do agregado da sonda, que cobrem a AMOSTRA INTEIRA — e sem
     este passo eles ficavam parados enquanto o KPI ao lado encolhia com a
     janela. O sintoma era grosseiro: em "Óculos · 1 dia" o total da rede
     marcava R$ 55.069,69 enquanto A GRACIOSA MIDWAY sozinha mostrava
     R$ 78.829,04 — uma loja maior que a rede.

     A escala é a fatia MEDIDA que a janela ocupa no faturamento da amostra, a
     mesma que o KPI usa. Com isso a soma das quebras volta a fechar com o total
     em qualquer recorte. É projeção, e sai marcada como tal.
  */
  const escalaDeData = porDataExata ? 1 : fatiaDaJanela(days);
  if (escalaDeData !== 1) {
    aproximado = true;
    rows = rows.map((r) => ({
      ...r,
      total: round2(r.total * escalaDeData),
      count: Math.round(r.count * escalaDeData),
    }));
  }

  rows.sort((a, b) => b.total - a.total);
  return aproximado ? { by, rows, aproximado } : { by, rows };
}

const realSalesByProduct = new Map((real?.productSales ?? []).map((x) => [`pr_${x.externalId}`, x]));

/**
 * Itens vendidos no período: base única do ABC e da análise por dimensão.
 * Memoizado para o sabor fictício não sortear números novos a cada chamada
 * (ABC, análise e giro contam a mesma história).
 */
let soldItemsCache: { p: Product; revenue: number; units: number }[] | null = null;
/**
 * Recorte de produto dos relatórios: grupo do console ∩ tipo escolhido na
 * tela. Mesma regra pura da API (matchesProductGroup) — e a MESMA para SKU e
 * para marca, que era o pedido: o filtro não pode sumir ao trocar a dimensão.
 */
function noRecorte(group: ProductGroup, category?: string | string[]) {
  const sel = asSet(category);
  return (p: { category: string }) => matchesProductGroup(p.category, group) && (!sel || sel.has(p.category));
}

/**
 * Itens vendidos, opcionalmente recortados a UMA loja. As unidades saem exatas
 * do mapa por (loja × produto); a receita é rateada pela participação da loja
 * nas unidades daquele produto, porque o dataset não traz receita por loja ×
 * produto. Ratear o que ele traz é melhor que deixar o filtro de loja sem
 * efeito — e a régua está declarada aqui.
 */
function soldItemsScoped(storeId?: string) {
  if (!storeId) return soldItems();
  return soldItems()
    .map((x) => {
      const un = soldQty.get(key(storeId, x.p.id)) ?? 0;
      const rede = stores.reduce((a, s) => a + (soldQty.get(key(s.id, x.p.id)) ?? 0), 0);
      return { p: x.p, units: un, revenue: round2(x.revenue * (rede > 0 ? un / rede : 0)) };
    })
    .filter((x) => x.units > 0);
}

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
function brandSales(itens: { p: { description: string; brand: string; category: string; id: string }; revenue: number; units: number }[] = soldItems()) {
  const acc = new Map<string, { revenue: number; units: number }>();
  for (const x of itens) {
    if (!isBrandAnalysable(x.p.category)) continue;
    const k = brandLabel(x.p);
    const cur = acc.get(k) ?? { revenue: 0, units: 0 };
    cur.revenue = round2(cur.revenue + x.revenue);
    cur.units += x.units;
    acc.set(k, cur);
  }
  return acc;
}

function abc(
  days: number,
  dimension: 'product' | 'brand',
  group: ProductGroup = 'todos',
  category?: string | string[],
  storeId?: string,
) {
  // Um único recorte para as duas dimensões — trocar SKU por marca não mexe
  // em filtro nenhum.
  /*
     O item vendido não tem dia — cobre a amostra inteira. Sem esta escala a
     curva mostrava a receita dos 7 dias sob um rótulo de 1 dia, e o total da
     tela discordava do BI para o mesmo recorte. A fatia é a mesma que o BI usa,
     medida na série diária; as CLASSES não se movem, porque a classificação
     ABC é feita sobre participação relativa e escala não muda proporção.
  */
  const escalaDeData = fatiaDaJanela(days);
  const vendidos = soldItemsScoped(storeId)
    .filter((x) => noRecorte(group, category)(x.p))
    .map((x) =>
      escalaDeData === 1
        ? x
        : { ...x, revenue: round2(x.revenue * escalaDeData), units: Math.round(x.units * escalaDeData) },
    );
  let items: AbcItem[];
  if (dimension === 'brand') {
    // Mesmo cálculo nos dois sabores da demo (fictício e real) e igual ao da
    // API: marca extraída da descrição e recorte de produto de moda.
    const acc = brandSales(vendidos);
    items = [...acc.entries()].map(([label, v]) => ({
      key: label, label: label || 'Sem marca', brand: null, category: null, ...v,
    }));
  } else {
    items = vendidos.map((x) => ({
      key: x.p.id, label: x.p.description, brand: x.p.brand, category: x.p.category,
      revenue: x.revenue, units: x.units,
    }));
  }
  // Receita do período sem recorte: é o denominador que faltava na tela.
  // Da rede quando o dataset traz o agregado; da amostra quando não traz.
  const periodRevenue = storeId
    ? round2(soldItemsScoped(storeId).reduce((a, x) => a + x.revenue, 0) * escalaDeData)
    : real
      ? // Da série diária, e não de `totals.revenue30d`: o total gravado é o da
        // amostra inteira, e este número é o denominador DO RECORTE PEDIDO.
        vendasNaJanela(days).total
      : round2(soldItems().reduce((a, x) => a + x.revenue, 0));
  // Feedbacks 5.0, item 05 ("a curva ABC ainda traz pouco produto"): não é
  // filtro comendo linha — é a janela. A extração do CDS que alimenta a demo
  // cobre 7 dias, e só entra na curva quem VENDEU no período. O catálogo tem
  // 21.683 SKUs e 727 tiveram movimento. A tela precisa desses dois números
  // para dizer isso ao operador em vez de parecer quebrada.
  const skusComVenda = new Set(vendidos.map((x) => x.p.id)).size;
  // A classificação (ponto médio, resumo por classe) é a MESMA do backend.
  return {
    ...abcFromItems(items, days, dimension),
    periodRevenue,
    skusComVenda,
    skusNoCatalogo: real?.totals?.productCountNetwork ?? products.length,
    janelaRealDias: real ? realWindowDays : days,
  };
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

/** Janela do sabor FICTÍCIO — ver `serieFicticia`, mais abaixo. */
const JANELA_FICTICIA = 180;

/**
 * Dias que a amostra em uso realmente cobre: 7 na fotografia do CDS, 180 no
 * sabor fictício. Ter UM número para os dois é o que permite ao recorte por
 * data funcionar igual nos dois lados — e o CI roda só o fictício.
 */
const janelaDaAmostra = real ? realWindowDays : JANELA_FICTICIA;

/** Janela que a amostra estática realmente responde. */
export interface CoberturaDaAmostra {
  /** Dias de venda medidos na série diária. */
  dias: number;
  /** Primeiro dia com venda (ISO). */
  de: string;
  /** Último dia com venda (ISO). */
  ate: string;
  /**
   * O desempenho por loja é recortável DIA A DIA (amostra de até 7 dias, em que
   * o dia da semana identifica a data) ou só proporcionalmente? A interface usa
   * isto para não prometer medição onde há projeção.
   */
  lojaPorDataExata: boolean;
}

/**
 * Cobertura da amostra, para a INTERFACE — o contrário de esconder o limite.
 *
 * A matemática já respeitava a janela medida (`effectiveDays`), mas o filtro
 * continuava oferecendo 30, 90 e 180 dias e devolvendo sempre os mesmos sete:
 * quem escolhia 30 via o número de 7 com o rótulo de 30 e concluía, com razão,
 * que o filtro não funcionava. Expondo a cobertura, a tela passa a oferecer só
 * o que a fotografia responde.
 *
 * Devolve `null` quando não há amostra real embarcada (dataset fictício, que é
 * gerado para a janela inteira) — nesse caso não existe limite a declarar.
 */
export function coberturaDoDataset(): CoberturaDaAmostra | null {
  if (!real) return null;
  const dias = (real.dailySales ?? []).map((d) => d.date).filter(Boolean).sort();
  if (dias.length === 0) return null;
  return {
    dias: realWindowDays,
    de: dias[0],
    ate: dias[dias.length - 1],
    lojaPorDataExata: lojaPorDataEhExata(),
  };
}

/**
 * Janela que a resposta REALMENTE cobre.
 *
 * Pedir mais do que a fotografia tem devolve o que ela tem (senão a cobertura
 * infla); pedir MENOS é um recorte legítimo, e agora ele é respeitado — era o
 * que fazia o filtro não mover número nenhum dentro da amostra.
 */
const effectiveDays = (days: number) => Math.max(1, Math.min(days, janelaDaAmostra));


/* ───────────────────────────────────────────────────────────────────────────
   RECORTE POR DATA DENTRO DA AMOSTRA

   O que a fotografia mede com data, e portanto responde ao filtro:
     · dailySales   — faturamento e nº de vendas por DIA;
     · weekdayStore — faturamento por loja × dia da semana. Como a amostra tem
       exatamente 7 dias, cada dia da semana aparece uma única vez: o dia da
       semana é um proxy EXATO da data. Conferido dia a dia contra a série
       diária — bate ao centavo nos sete.

   O que não tem data e por isso não pode ser recortado: as quebras por marca,
   categoria, produto, vendedor e forma de pagamento vêm da sonda como total do
   período. Elas continuam mostrando a amostra inteira, e a interface diz isso
   (ver LegendaDaAmostra) em vez de deixar o rótulo do filtro mentir.
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Janela do sabor FICTÍCIO. O comentário de `coberturaDoDataset` sempre disse
 * que o dataset fictício "é gerado para a janela inteira" — e não era: o ramo
 * sem dados reais de `timeseries()` sorteava `money(3000, 14000)` A CADA
 * CHAMADA, com um RNG que avança de estado, e `vendasNaJanela`/`fatiaDaJanela`
 * devolviam o total do período inteiro para qualquer janela.
 *
 * O efeito era invisível aqui (o desenvolvimento roda com o JSON real) e fatal
 * no CI, que roda só o fictício: o KPI mostrava R$ 241.644 ao lado de uma série
 * que somava R$ 3.243, a soma por loja estourava a rede em 8,6% e a análise de
 * vendas de 1 dia era idêntica à de 7. Três testes vermelhos, uma causa.
 *
 * Agora o fictício tem série diária DE VERDADE: 180 dias, gerada uma vez na
 * carga do módulo e memoizada. Como todo o resto já lê a janela por
 * `diasNaJanela`/`vendasNaJanela`/`fatiaDaJanela`, os dois sabores passam a
 * responder ao filtro pelo mesmo caminho.
 */
type PontoDiario = { date: string; total: number; count: number };
let serieCache: PontoDiario[] | null = null;

/**
 * A série diária do sabor em uso — é ela que define a janela dos dois lados.
 *
 * No fictício ela é gerada uma vez e ESCALADA para somar exatamente o
 * faturamento do catálogo (`soldItems`). Sem isso, série e itens vendidos são
 * dois universos aleatórios independentes: a fatia de 1 dia calculada na série
 * multiplicava um total de outra ordem de grandeza, e a soma por loja saía 83%
 * fora da rede. É a mesma propriedade que a fotografia do CDS tem de graça —
 * lá o dia a dia e o item vendido vêm da mesma extração.
 *
 * Preguiçosa de propósito: `soldItems()` só existe depois deste ponto do módulo.
 */
function serieDiaria(): PontoDiario[] {
  if (real) return (serieCache ??= real.dailySales.map((d) => ({ date: d.date, total: d.total, count: d.count })));
  if (serieCache) return serieCache;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const bruta = Array.from({ length: JANELA_FICTICIA }, (_, i) => {
    const d = new Date(hoje);
    d.setDate(d.getDate() - (JANELA_FICTICIA - 1 - i));
    return { date: d.toISOString().slice(0, 10), peso: money(3000, 14000), count: int(2, 9) };
  });
  const somaPesos = bruta.reduce((a, x) => a + x.peso, 0) || 1;
  const alvo = round2(soldItems().reduce((a, x) => a + x.revenue, 0));
  const somaContagens = bruta.reduce((a, x) => a + x.count, 0) || 1;
  serieCache = bruta.map((x) => ({
    date: x.date,
    total: round2((x.peso / somaPesos) * alvo),
    count: Math.max(1, Math.round((x.count / somaContagens) * salesCount)),
  }));
  return serieCache;
}

/** Datas medidas, em ordem crescente. */
const datasDaAmostra = () => serieDiaria().map((d) => d.date).sort();

/** Dia da semana (domingo = 0) de uma data ISO, sem depender do fuso local. */
const diaDaSemana = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** Os N últimos dias medidos — o recorte que o filtro pediu. */
function diasNaJanela(days: number): string[] {
  return datasDaAmostra().slice(-effectiveDays(days));
}

/** Faturamento e nº de vendas da rede no recorte, somados da série diária. */
function vendasNaJanela(days: number): { total: number; count: number } {
  const dias = new Set(diasNaJanela(days));
  let total = 0;
  let count = 0;
  for (const d of serieDiaria()) {
    if (!dias.has(d.date)) continue;
    total += d.total;
    count += d.count;
  }
  return { total: round2(total), count };
}

/**
 * Quanto o recorte de datas pesa na amostra inteira.
 *
 * É o fator que leva um número medido no período todo para dentro da janela,
 * quando o dado não tem dia (unidades vendidas do recorte de produto, por
 * exemplo). Fora da amostra real vale 1 — nada é projetado.
 */
function fatiaDaJanela(days: number): number {
  const total = vendasNaJanela(janelaDaAmostra).total;
  return total > 0 ? vendasNaJanela(days).total / total : 1;
}

/** Quantas vezes cada dia da semana aparece numa lista de datas. */
function ocorrenciasPorDiaDaSemana(datas: string[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const d of datas) {
    const wd = diaDaSemana(d);
    m.set(wd, (m.get(wd) ?? 0) + 1);
  }
  return m;
}

/**
 * A reconstrução por loja é EXATA?
 *
 * Só quando cada dia da semana aparece no máximo uma vez na amostra — ou seja,
 * até 7 dias. Aí "quinta-feira" identifica UMA data e o balde de `weekdayStore`
 * é o faturamento daquele dia.
 *
 * Numa amostra de 30 dias, "quinta" acumula ~4 datas no mesmo balde e não há
 * como separá-las: a reconstrução vira proporcional (ver abaixo). Sem esta
 * distinção o recorte de 7 dias numa amostra de 30 devolvia o faturamento dos
 * 30 — medido, R$ 4,53 mi no lugar de R$ 1,08 mi, com o KPI ao lado mostrando o
 * número certo. Duas respostas para a mesma pergunta, na mesma tela.
 */
const lojaPorDataEhExata = () =>
  real ? [...ocorrenciasPorDiaDaSemana(datasDaAmostra()).values()].every((n) => n <= 1) : false;

/**
 * Faturamento por loja no recorte, a partir de `weekdayStore`.
 *
 * Cada balde entra na proporção das suas ocorrências DENTRO da janela sobre as
 * ocorrências na amostra inteira. Numa amostra de até 7 dias essa razão é 1 ou
 * 0, e o resultado é a medição exata; em amostras maiores ela reparte o balde
 * entre as datas que ele agrega, que é a melhor resposta possível sem uma
 * quebra por dia que a sonda não traz.
 *
 * O nº de VENDAS por loja não tem quebra diária; é rateado pela fatia de
 * faturamento da loja no recorte e só alimenta rótulos secundários.
 */
function salesByStoreNaJanela(days: number): typeof salesByStore {
  if (!real) return salesByStore;
  const naJanela = ocorrenciasPorDiaDaSemana(diasNaJanela(days));
  const naAmostra = ocorrenciasPorDiaDaSemana(datasDaAmostra());
  const porLoja = new Map<string, number>();
  for (const w of real.weekdayStore) {
    const dentro = naJanela.get(w.weekday) ?? 0;
    const total = naAmostra.get(w.weekday) ?? 0;
    if (dentro === 0 || total === 0) continue;
    porLoja.set(w.storeExt, (porLoja.get(w.storeExt) ?? 0) + w.total * (dentro / total));
  }
  return real.salesByStore.map((s) => {
    const total = round2(porLoja.get(s.externalId) ?? 0);
    const fatia = s.total > 0 ? total / s.total : 0;
    return {
      storeId: `st_${s.externalId}`,
      storeName: s.name,
      count: Math.round(s.count * fatia),
      total,
    };
  });
}

/** Cobertura geral e por marca (feedback 06). */
/**
 * Estoque e venda da REDE no recorte, da MESMA fonte que a cobertura por loja
 * do dashboard (`storeCategory`). Existe porque as duas telas mostravam
 * coberturas diferentes: o dashboard lê a rede, e a tabela por marca só
 * consegue ler a amostra de catálogo da demonstração — 2.144 un. contra
 * 40.563. Galbe viu 1,5 mês aqui e ~26 meses lá. Agora a linha GERAL sai da
 * mesma fonte, e as linhas por marca declaram que são a amostra.
 */
/**
 * Estoque da rede no recorte — a MESMA conta no painel e no BI.
 *
 * As duas telas respondiam a pergunta "quantas unidades a rede tem neste
 * recorte" por caminhos diferentes: o painel somava o agregado da sonda
 * inteiro, o BI somava o catálogo amostrado, e no recorte "Tudo" isso dava
 * 211.026 contra 112.515 no mesmo instante. Uma função só, para não voltarem a
 * divergir.
 *
 * Sem loja escolhida o número é o da REDE — inclui centro de distribuição e
 * assistência, que têm estoque de verdade. Com loja escolhida, só aquela loja.
 */
function estoqueDaRedeNoRecorte(
  group: ProductGroup,
  category?: string | string[],
  storeId?: string,
): number | null {
  const porCategoria = real?.storeCategory;
  if (!porCategoria || porCategoria.length === 0) return null;
  const sel = asSet(category);
  const alvo = storeId ? stores.find((s) => s.id === storeId)?.externalId : null;
  let unidades = 0;
  for (const r of porCategoria) {
    if (!matchesProductGroup(r.label, group)) continue;
    if (sel && !sel.has(r.label)) continue;
    if (alvo && r.storeExt !== alvo) continue;
    unidades += r.stockUnits;
  }
  return unidades;
}

function redeNoRecorte(group: ProductGroup, category?: string | string[], storeId?: string) {
  const porCategoria = real?.storeCategory;
  if (!porCategoria || porCategoria.length === 0) return null;
  const sel = asSet(category);
  let stockUnits = 0;
  let unitsSold = 0;
  for (const r of porCategoria) {
    if (!matchesProductGroup(r.label, group)) continue;
    if (sel && !sel.has(r.label)) continue;
    const s = stores.find((x) => x.externalId === r.storeExt);
    if (!s || (storeId && s.id !== storeId)) continue;
    stockUnits += r.stockUnits;
    unitsSold += r.soldUnits;
  }
  return { stockUnits, unitsSold };
}

function brandCoverageReport(rawDays: number, group: ProductGroup = 'todos', category?: string | string[], storeId?: string) {
  const days = effectiveDays(rawDays);
  const dentro = noRecorte(group, category);
  const escopo = storeId ? stores.filter((s) => s.id === storeId) : stores;
  // Do catálogo, não do agregado pronto do dataset: o agregado é por
  // FORNECEDOR e inclui lente. Aqui vale o recorte da análise de marca — o
  // mesmo da API e o mesmo nos dois sabores da demo.
  const acc = new Map<string, { stockUnits: number; unitsSold: number }>();
  for (const p of products) {
    if (!isBrandAnalysable(p.category) || !dentro(p)) continue;
    const k = brandLabel(p);
    const cur = acc.get(k) ?? { stockUnits: 0, unitsSold: 0 };
    for (const st of escopo) {
      cur.stockUnits += stockQty.get(key(st.id, p.id)) ?? 0;
      cur.unitsSold += soldQty.get(key(st.id, p.id)) ?? 0;
    }
    acc.set(k, cur);
  }
  const inputs = [...acc.entries()].map(([label, v]) => ({ key: label, label, ...v }));
  const rows = computeCoverage(inputs, days);
  const naAmostra = {
    stockUnits: rows.reduce((a, r) => a + r.stockUnits, 0),
    unitsSold: rows.reduce((a, r) => a + r.unitsSold, 0),
  };
  // A linha GERAL vem da REDE, para bater com a cobertura do dashboard.
  const rede = redeNoRecorte(group, category, storeId);
  const [total] = computeCoverage(
    [{ key: '__total__', label: 'GERAL', ...(rede ?? naAmostra) }],
    days,
  );
  return {
    days,
    total,
    rows,
    // Quando as linhas cobrem menos que o total, a tela precisa dizer.
    ...(rede && rede.stockUnits > naAmostra.stockUnits
      ? { sampled: { stockUnits: naAmostra.stockUnits, networkStockUnits: rede.stockUnits } }
      : {}),
  };
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

  // Mesma escala do BI e do ABC: nenhuma destas dimensões tem dia na amostra, e
  // sem ela a tabela ficava com o total da amostra sob o rótulo do recorte.
  const escalaDeData = fatiaDaJanela(days);
  if (escalaDeData !== 1) {
    rows = rows.map((r) => ({
      ...r,
      units: Math.round(r.units * escalaDeData),
      revenue: round2(r.revenue * escalaDeData),
    }));
  }

  rows.sort((a, b) => b.units - a.units);
  return { days, by, rows: rows.slice(0, 500) };
}

function turnover(days: number, group: ProductGroup = 'todos', category?: string | string[], storeId?: string) {
  const dentro = noRecorte(group, category);
  const escopo = storeId ? stores.filter((s) => s.id === storeId) : stores;
  return {
    days,
    rows: products.filter(dentro).map((p) => {
      const unitsSold = storeId
        ? soldQty.get(key(storeId, p.id)) ?? 0
        : real
          ? realSalesByProduct.get(p.id)?.units ?? 0
          : int(0, 60);
      const currentStock = escopo.reduce((a, s) => a + (stockQty.get(key(s.id, p.id)) ?? 0), 0);
      return {
        productId: p.id, description: p.description, brand: p.brand, category: p.category,
        unitsSold, currentStock, turnover: round2(unitsSold / Math.max(currentStock, 1)),
        // `effectiveDays` e não `days`: a venda deste bloco é a MEDIDA na
        // amostra (7 dias). Dividindo por 30 a demanda diária saía 4,3x menor e
        // a cobertura em dias, 4,3x maior — o mesmo erro que `medirJanela`
        // existe para evitar, e que aqui tinha escapado.
        daysOfInventory:
          unitsSold > 0 ? round2(currentStock / (unitsSold / effectiveDays(days))) : null,
      };
    }).sort((a, b) => b.turnover - a.turnover),
  };
}

function salesFlow(group: ProductGroup = 'todos', category?: string | string[], storeId?: string) {
  const links: { source: string; target: string; value: number }[] = [];
  const names = new Set<string>();
  if (real) {
    // Alocação proporcional: total real da categoria × participação real da
    // loja no faturamento (top 6 × top 8 para o sankey respirar). As duas
    // pontas agora saem do recorte: a categoria vem do item vendido dentro
    // dele, e a loja, quando escolhida, é a única do fluxo.
    const porCategoria = byDimension('category', group, category, storeId).rows;
    const cats = porCategoria.slice(0, 6);
    const lojas = byDimension('store', group, category, storeId).rows;
    const tops = lojas.slice(0, 8).map((r) => ({ storeName: r.label, total: r.total }));
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
  // Catálogo fictício: o mesmo recorte, senão o sabor sem dados reais fica
  // com um sankey da rede inteira enquanto o resto da tela já obedece.
  const dentro = noRecorte(group, category);
  const escopo = storeId ? stores.filter((s) => s.id === storeId) : stores;
  for (const cat of CATEGORIAS.filter((c) => dentro({ category: c })))
    for (const st of escopo) {
      const v = money(2000, 25000);
      links.push({ source: cat, target: st.name, value: v });
      names.add(cat);
      names.add(st.name);
    }
  return { nodes: [...names].map((name) => ({ name })), links };
}

/**
 * Sankey de transferências. Era um par de setas fixo, escrito à mão, que
 * ignorava período, loja e recorte — o único gráfico da tela que não respondia
 * a nada. Agora sai das movimentações que a demo realmente tem (a semente e
 * tudo que o operador criar na sessão), com o mesmo recorte dos outros.
 */
function transferFlow(group: ProductGroup = 'todos', category?: string | string[], storeId?: string) {
  const dentro = noRecorte(group, category);
  const links: { source: string; target: string; value: number }[] = [];
  const names = new Set<string>();
  for (const m of movements) {
    if (m.type !== 'TRANSFER') continue;
    const de = (m.fromStore as { id: string; name: string } | null)?.name;
    const para = (m.toStore as { id: string; name: string } | null)?.name;
    const deId = (m.fromStore as { id: string } | null)?.id;
    const paraId = (m.toStore as { id: string } | null)?.id;
    if (!de || !para) continue;
    if (storeId && deId !== storeId && paraId !== storeId) continue;
    const prod = prodById((m.product as { id: string }).id);
    if (prod && !dentro(prod)) continue;
    // Prefixo evita ciclo no sankey (A→B e B→A viram nós distintos).
    const origem = `Origem: ${de}`;
    const destino = `Destino: ${para}`;
    const existente = links.find((l) => l.source === origem && l.target === destino);
    if (existente) existente.value += Number(m.quantity) || 0;
    else links.push({ source: origem, target: destino, value: Number(m.quantity) || 0 });
    names.add(origem);
    names.add(destino);
  }
  return { nodes: [...names].map((name) => ({ name })), links };
}

function heatmap(fatia = 1, aproximado = false, storeId?: string, days = 0) {
  // A sonda traz loja × dia da semana sem quebra por categoria: mesma regra da
  // série diária — projeta pela fatia do recorte de PRODUTO e declara a
  // aproximação. Já o recorte de DATA é exato: o dia da semana fora da janela
  // sai do mapa em vez de aparecer como se tivesse sido medido nela.
  const escopo = storeId ? stores.filter((s) => s.id === storeId) : stores;
  const yLabels = escopo.map((s) => s.name);
  const cells: [number, number, number][] = [];
  if (real) {
    const naJanela = days > 0 ? new Set(diasNaJanela(days).map(diaDaSemana)) : null;
    const byKey = new Map(real.weekdayStore.map((w) => [`${w.storeExt}|${w.weekday}`, w.total]));
    escopo.forEach((s, yi) =>
      WEEK.forEach((_, wd) =>
        cells.push([
          wd,
          yi,
          naJanela && !naJanela.has(wd)
            ? 0
            : Math.round((byKey.get(`${s.externalId}|${wd}`) ?? 0) * fatia),
        ]),
      ),
    );
  } else {
    yLabels.forEach((_, yi) => WEEK.forEach((__, wd) => cells.push([wd, yi, Math.round(money(500, 9000) * fatia)])));
  }
  return { xLabels: WEEK, yLabels, cells, ...(aproximado ? { aproximado: true } : {}) };
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

/** Semente estável por produto, para a idade não mudar entre recargas. */
function cardIdParaProduto(productId: string): string {
  return `LIQUIDACAO|${productId}`;
}

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

/**
 * Idade simulada da peça NAQUELA loja, em dias.
 *
 * A tela de Planejamento declara, a partir de `plan.guards`, que peça com
 * menos de 45 dias na loja não é remanejada. A demonstração alimentava o motor
 * sem idade nenhuma, caía no fail-open e remanejava peça de qualquer idade: a
 * nota anunciava uma trava que o motor da demo não aplicava — o pior defeito
 * possível numa tela feita justamente para mostrar COMO o sistema decide.
 *
 * Hash estável por (loja, produto), como em `demoCardAge`, para a idade não
 * mudar entre recargas. Cerca de 1 em cada 8 posições cai dentro da carência:
 * o bastante para a trava aparecer em tela, pouco o bastante para a
 * demonstração continuar tendo o que sugerir.
 */
export function demoIdadeNaLoja(storeId: string, productId: string): number {
  const s = cardSeed(`IDADE|${storeId}|${productId}`);
  return s < 12 ? 4 + s : 90 + s * 3;
}

/** Transferências ainda não efetivadas, somadas por (loja, produto). */
function transferenciasEmAberto() {
  const saindo = new Map<string, number>();
  const chegando = new Map<string, number>();
  for (const mv of movements) {
    if (mv.type !== 'TRANSFER') continue;
    if (!['REQUESTED', 'PENDING'].includes(mv.status as string)) continue;
    const qtd = Number(mv.quantity) || 0;
    const productId = (mv.product as { id: string } | undefined)?.id;
    if (!productId) continue;
    const de = (mv.fromStore as { id: string } | null)?.id;
    const para = (mv.toStore as { id: string } | null)?.id;
    if (de) saindo.set(key(de, productId), (saindo.get(key(de, productId)) ?? 0) + qtd);
    if (para) chegando.set(key(para, productId), (chegando.get(key(para, productId)) ?? 0) + qtd);
  }
  return { saindo, chegando };
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

/** Valor de query só é aceito quando está no conjunto conhecido (como na API). */
const umDe = <T extends string>(v: unknown, aceitos: readonly T[]): T | undefined =>
  aceitos.includes(v as T) ? (v as T) : undefined;

/**
 * `page` e `pageSize` da query, saneados pela MESMA função da rota — teto
 * incluído. Devolve na ordem em que `paginar` os recebe, para o chamador não
 * poder trocar os dois de lugar.
 *
 * A demo tinha um saneamento próprio, e ele não tinha teto: `?pageSize=100000`
 * devolvia os 1.260 cards aqui e 1.000 contra a API. Um espelho cego no eixo
 * que a mudança introduziu deixa os testes verdes justamente onde o contrato
 * aperta — e ainda faz o "Ver mais" da demonstração chegar a um fim que a tela
 * de produção não alcança.
 */
const recorte = (
  params: Record<string, string | string[] | undefined>,
  padrao: number,
  teto: number,
): [number, number] => {
  const { page, pageSize } = recortePedido(
    { page: one(params.page), pageSize: one(params.pageSize) },
    padrao,
    teto,
  );
  return [page, pageSize];
};

export function demoHandle({ method, url, params = {}, body = {} }: DemoRequest): unknown {
  const m = method.toUpperCase();
  const p = (re: RegExp) => re.exec(url);
  // Período: `?days=N` ou `?de=&ate=` (o intervalo à mão do BI). A demo mede
  // sobre uma FOTOGRAFIA de dias contados, não sobre datas — então o intervalo
  // é convertido no seu TAMANHO e recortado pela cobertura da amostra, que é o
  // mesmo tratamento que `effectiveDays` já dá a qualquer recorte grande.
  // Traduzir em vez de ignorar é o que impede a demo de responder um mês
  // inteiro quando o usuário pediu três dias.
  const diasEntre = (de?: string, ate?: string): number | null => {
    if (!de || !ate) return null;
    const a = Date.parse(`${de}T00:00:00Z`);
    const b = Date.parse(`${ate}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
    return Math.round((b - a) / 86_400_000) + 1;
  };
  const days = diasEntre(one(params.de), one(params.ate)) ?? (Number(one(params.days)) || 30);

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
  if (url === '/dashboard/summary') {
    // Feedback 01 do Galbe: "mostram 211.026 unidades, sendo que temos algo em
    // torno de 35k". Os 211 mil são a rede INTEIRA: tratamento (55k), lentes
    // (48k) e outros (28k) respondem por 170 mil deles. O KPI passa a respeitar
    // o recorte, como as demais telas — no recorte de óculos dá 40.563.
    const g = productGroup(params.group);
    const unidades =
      estoqueDaRedeNoRecorte(g) ??
      // Sem o agregado da rede, soma o catálogo local — e soma do MESMO jeito
        // em todo recorte. O atalho que 'todos' tinha aqui lia `stockQty`
      // inteiro, incluindo CD e assistência, que `stores` exclui: os quatro
      // recortes não fechavam com o total por causa de loja, não de produto.
      products.reduce(
        (a, p) =>
          a +
          (matchesProductGroup(p.category, g)
            ? stores.reduce((b, st) => b + (stockQty.get(key(st.id, p.id)) ?? 0), 0)
            : 0),
        0,
      );
    // SKUs: o número da REDE, não o do catálogo amostrado que a demo carrega.
    // "Não temos só 1631 SKU's" — correto: a rede tem 21.683.
    //
    // Feedbacks 5.0, item 01: "a quantidade total de produtos permanece 21683
    // independente da categoria que escolho em cima". Era verdade, e a culpa
    // era desta linha — o total da rede entrava cru, sem passar pelo recorte.
    // A rede só nos manda a CONTAGEM de SKUs, não o catálogo inteiro, então o
    // recorte é aplicado pela fatia que o grupo ocupa na amostra e o número
    // vai à tela marcado como estimado. Estimar e dizer que estimou é honesto;
    // repetir o total da rede em todo recorte não é.
    const skusNaRede = real?.totals?.productCountNetwork;
    const skusNoRecorte = products.filter((p) => matchesProductGroup(p.category, g)).length;
    const fatia = products.length > 0 ? skusNoRecorte / products.length : 0;
    const skus =
      skusNaRede == null
        ? skusNoRecorte
        : g === 'todos'
          ? skusNaRede
          : Math.round(skusNaRede * fatia);
    return {
      stores: stores.length,
      products: skus,
      productsEstimated: skusNaRede != null && g !== 'todos',
      productsNetwork: skusNaRede,
      productsSampled: real ? skusNoRecorte : undefined,
      customers: 40,
      stockUnits: unidades,
      pendingMovements: movements.filter((x) => ['REQUESTED', 'PENDING'].includes(x.status as string)).length,
      sales30d: { count: salesCount, total: revenue },
      lastSync: { status: 'SUCCESS', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), recordsWritten: 982, window: '06:00-07:00' },
    };
  }
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
          : // Sem agregado da rede, soma o catálogo local — DENTRO DO RECORTE.
            // O recorte faltava só aqui, e era por isso que a cobertura do
            // dashboard e a do relatório divergiam no dataset fictício: uma
            // contava lente e acessório, a outra não.
            (() => {
              const noGrupo = products.filter((prod) => matchesProductGroup(prod.category, grupo));
              return stores.map((s) => ({
                storeId: s.id,
                storeName: s.name,
                stockUnits: noGrupo.reduce((a, prod) => a + (stockQty.get(key(s.id, prod.id)) ?? 0), 0),
                unitsSold: noGrupo.reduce((a, prod) => a + (soldQty.get(key(s.id, prod.id)) ?? 0), 0),
              }));
            })();
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
  if (url === '/products/categories') {
    // Feedback 02: categoria de lente continuava na lista e devolvia 0 linhas.
    // Oferecer um filtro que não filtra nada é pior que não oferecer.
    const g = productGroup(params.group);
    return [...new Set(products.filter((x) => matchesProductGroup(x.category, g)).map((x) => x.category))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }
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

  // ── BI ────────────────────────────────────────────────────────────────────
  // O recorte do console (group) e o tipo de produto (category) valem aqui como
  // valem em Alertas e Relatórios. Antes desta linha o BI inteiro os ignorava.
  const grupoBi = productGroup(params.group);
  const tipoBi = params.category;
  const lojaBi = one(params.storeId);
  if (url.startsWith('/bi/')) {
    const base = biBase(grupoBi, tipoBi, lojaBi);
    if (url === '/bi/kpis') {
      const al = alerts(grupoBi, tipoBi, lojaBi);
      const escopo = lojaBi ? stores.filter((s) => s.id === lojaBi) : stores;
      const dentro = noRecorte(grupoBi, tipoBi);
      const noGrupo = products.filter((p) => dentro(p));
      const positions = escopo.length * Math.max(1, noGrupo.length);
      // MESMA base do painel: quando o dataset traz o agregado da rede, o
      // estoque vem dele. Somar só o catálogo amostrado daria 112.515 no BI
      // contra 211.026 no painel, para o mesmo recorte e no mesmo instante —
      // e duas telas com números diferentes destroem as duas.
      const unidadesEmEstoque =
        estoqueDaRedeNoRecorte(grupoBi, tipoBi, lojaBi) ??
        escopo.reduce(
          (a, st) => a + noGrupo.reduce((b, p) => b + (stockQty.get(key(st.id, p.id)) ?? 0), 0),
          0,
        );
      // Faturamento e nº de vendas do RECORTE DE DATA, somados da série diária
      // — é a parte da amostra que tem dia, e portanto responde ao filtro.
      const janela = vendasNaJanela(days);
      // `salesCount` proporcional e declarado: uma venda mistura armação e
      // lente, então "quantas vendas do recorte de produto" não existe no dado
      // da sonda. A proporção incide sobre o nº de vendas DA JANELA.
      const vendas = Math.max(1, Math.round(janela.count * base.fatia));
      /*
         Faturamento do recorte DENTRO da janela.

         Sem recorte de produto o número é medido: soma da série diária no
         período. Com recorte, a sonda não quebra produto × dia, então vale a
         mesma regra que a série, o mapa de calor e a forma de pagamento já
         usam — o total MEDIDO da janela vezes a fatia MEDIDA que o recorte
         ocupa no período. É projeção, e a tela declara isso em
         `vendasAproximadas`. O que não podia continuar é o que havia antes:
         o total dos 7 dias parado embaixo de um rótulo de 1 dia.
      */
      const receitaDaJanela = base.recortando ? round2(janela.total * base.fatia) : janela.total;
      return {
        days,
        revenue: receitaDaJanela,
        salesCount: base.recortando ? vendas : janela.count,
        avgTicket: round2(receitaDaJanela / (base.recortando ? vendas : janela.count)),
        // O que o recorte de fato move: R$/peça. Ver o comentário em bi.math.
        avgUnitPrice: base.unidades > 0 ? round2(base.receita / base.unidades) : 0,
        // Giro MENSAL, e não "unidades do período ÷ estoque": a janela real da
        // sonda é de 7 dias, e a razão crua dava 0,01 em todo recorte — o
        // medidor ficava parado enquanto o resto da tela reagia. Normalizado
        // para 30 dias, ele é o inverso da cobertura em meses que o painel
        // mostra, e as duas telas passam a contar a mesma história.
        turnover: round2(((base.unidades / Math.max(1, effectiveDays(days))) * 30) / Math.max(1, unidadesEmEstoque)),
        rupturaRate: round2((al.out / Math.max(1, positions)) * 100),
        lowStockRate: round2((al.low / Math.max(1, positions)) * 100),
        stockUnits: unidadesEmEstoque,
        // "Unidades vendidas no período" ficava parado ao lado de um
        // faturamento que se movia — dois números vizinhos contando histórias
        // diferentes sobre a mesma janela. A unidade não tem dia na sonda, então
        // acompanha pela mesma fatia declarada em `vendasAproximadas`.
        unitsSold: Math.round(base.unidades * fatiaDaJanela(days)),
        stockPositions: positions,
        outOfStock: al.out,
        lowStock: al.low,
        pendingTransfers: movements.filter((x) => ['REQUESTED', 'PENDING'].includes(x.status as string)).length,
        vendasAproximadas: base.recortando,
      };
    }
    if (url === '/bi/sales-timeseries') return timeseries(days, base.recortando ? base.fatia : 1, base.recortando);
    if (url === '/bi/sales-by-dimension')
      return byDimension(one(params.by) ?? 'store', grupoBi, tipoBi, lojaBi, days);
    if (url === '/bi/sales-flow') return salesFlow(grupoBi, tipoBi, lojaBi);
    if (url === '/bi/transfer-flow') return transferFlow(grupoBi, tipoBi, lojaBi);
    if (url === '/bi/heatmap')
      return heatmap(base.recortando ? base.fatia : 1, base.recortando, lojaBi, days);
  }

  // Relatórios
  const grupoRel = productGroup(params.group);
  const tipoRel = params.category;
  const lojaRel = one(params.storeId) || undefined;
  if (url === '/reports/abc')
    return abc(days, one(params.dimension) === 'brand' ? 'brand' : 'product', grupoRel, tipoRel, lojaRel);
  if (url === '/reports/turnover') return turnover(days, grupoRel, tipoRel, lojaRel);
  if (url === '/reports/coverage') return brandCoverageReport(days, grupoRel, tipoRel, lojaRel);
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
          // Mesmo critério da API: custo do ERP quando existe, estimado quando
          // falta — e o card diz qual dos dois é, porque o teto depende disso.
          unitCost: prod.cost ?? round2(prod.price * 0.55),
          unitPrice: prod.price,
          costEstimated: prod.cost == null,
          onOrderQty: onOrderQty(prod.id),
          // A marcação de "fora do mix" chega ao MOTOR, e não só à tabela da
          // tela. Sem isto a demonstração era write-only: o gestor marcava a
          // grife, a linha ficava marcada, e a aba de compras seguia sugerindo
          // comprá-la — o oposto do que a plataforma promete, e justamente no
          // ambiente em que a promessa é apresentada.
          brandDiscontinued: foraDoMixDemo(analysisBrand(prod.description, prod.category, prod.brand)),
          demandHistory: demoDemandHistory(prod, scope, period),
        },
        period,
        cfgForBrand(prod.brand),
      ),
    );
  };
  // Feedbacks 5.0, item 04 ("poucas sugestões de reposição"): a tela pede 90
  // dias, mas a fotografia do CDS cobre 7 — dividir a venda de 7 dias por 90
  // achatava a demanda diária ~13× e quase nada cruzava o ponto de pedido. A
  // cobertura já corrigia isso com `effectiveDays`; o planejamento, não.
  const planDays = effectiveDays(Number(one(params.days)) || 90);
  const rawGroup = one(params.group);
  // Padrão operacional: 'principal' (óculos de grau e sol). Os demais recortes
  // entram quando pedidos explicitamente.
  const planGroup: ProductGroup = PRODUCT_GROUPS.includes(rawGroup as ProductGroup)
    ? (rawGroup as ProductGroup)
    : 'principal';
  if (url === '/planning/overview')
    return buildOverview(planningPlans(planDays, one(params.storeId), planGroup), planDays);
  if (url === '/planning/purchase-suggestions') {
    const r = buildSuggestions(planningPlans(planDays, one(params.storeId), planGroup), planDays);
    // Feedbacks 6.0, item 02: a demo carrega uma AMOSTRA do catálogo (1.631 de
    // 21.683 SKUs). O motor analisa o que existe aqui; o universo do recorte na
    // rede é maior, e a tela precisa dizer os dois para a contagem de sugestões
    // ter referência.
    const naRede = real?.totals?.productCountNetwork;
    if (naRede != null && products.length > 0) {
      const noRecorte = products.filter((p) => matchesProductGroup(p.category, planGroup)).length;
      r.summary.universo = Math.round(naRede * (noRecorte / products.length));
    }
    // Mesmo recorte da API: `recomendacao` é filtro de vista, `page`/`pageSize`
    // cortam as linhas, e o `summary` continua sendo do conjunto analisado.
    const rec = umDe(one(params.recomendacao), RECOMENDACOES);
    const vista = rec ? r.rows.filter((x) => x.recommendation === rec) : r.rows;
    const { itens, pagina } = paginar(vista, ...recorte(params, LINHAS_POR_PAGINA, TETO_DE_LINHAS));
    return { ...r, rows: itens, pagina };
  }
  if (url === '/planning/purchase-orders' && m === 'GET') {
    const lojaFiltrada = one(params.storeId);
    const planos = planningPlans(planDays, lojaFiltrada, planGroup);
    // Com filtro de loja NÃO há rateio, igual à API: `planningPlans` escopa
    // venda e estoque àquela loja, então a quantidade já é dela. Repartir esse
    // número entre a rede endereça mercadoria a lojas cuja demanda nem entrou
    // na conta da compra.
    //
    // Posições por loja só das peças que viram item de pedido — o mesmo recorte
    // que a API faz antes de consultar o banco, para a demo não montar 1.631
    // vetores de loja para jogar fora 1.600 deles.
    const posicoes = new Map<string, FairSplitInput[]>();
    if (!lojaFiltrada) {
      for (const p of planos) {
        if (p.recommendation !== 'BUY' || p.suggestedQty <= 0) continue;
        posicoes.set(
          p.productId,
          stores.map((s) => ({
            storeId: s.id,
            storeName: s.name,
            unitsSold: soldQty.get(key(s.id, p.productId)) ?? 0,
            stockUnits: stockQty.get(key(s.id, p.productId)) ?? 0,
          })),
        );
      }
    }
    return buildPurchaseOrders(planos, planDays, undefined, lojaFiltrada ? undefined : posicoes);
  }
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
    // Idade, reserva e unidades a caminho: sem os três o motor da demo cai no
    // fail-open e remaneja o que a nota da tela promete não remanejar — a
    // demonstração passa a mostrar uma regra que ela não tem.
    const { saindo, chegando } = transferenciasEmAberto();
    for (const s of stores)
      for (const prod of products.filter(
        // As DUAS condições, e a segunda não é redundante.
        //
        // O comentário que estava aqui dizia que o recorte já era uma partição
        // — que quem está em `planGroup` não está em lentes — e por isso tinha
        // apagado a exclusão explícita. Vale para 'principal' e 'relogios'.
        // NÃO vale para `group=todos`, que é justamente o que a Central usa no
        // consolidado: 'todos' aceita tudo, lente inclusive.
        //
        // Produção nunca dependeu dessa partição: `rebalancePlan` tem a regra
        // absoluta escrita à parte ("lentes não se transferem entre lojas —
        // só óculos e relógio"), aplicada depois do recorte de grupo. A demo
        // se declara espelho da API e estava sem ela.
        //
        // Ficou latente até a demonstração passar a informar idade: com a
        // demanda medida pelos dias reais de presença, uma lente com poucos
        // dias na loja e uma venda passou a ter cobertura baixa o bastante
        // para virar destino. O defeito não nasceu daí — só ficou visível.
        (x) => matchesProductGroup(x.category, planGroup) && !matchesProductGroup(x.category, 'lentes'),
      )) {
        const k = key(s.id, prod.id);
        inputs.push({
          storeId: s.id,
          storeName: s.name,
          productId: prod.id,
          description: prod.description,
          brand: prod.brand,
          unitsSold: soldQty.get(k) ?? 0,
          currentStock: stockQty.get(k) ?? 0,
          // Carrinho aberto e transferência ainda não efetivada saindo daqui:
          // as duas estão na prateleira e as duas já têm dono.
          reserved: (reserved.get(k) ?? 0) + (saindo.get(k) ?? 0),
          inboundUnits: chegando.get(k) ?? 0,
          ageDays: demoIdadeNaLoja(s.id, prod.id),
        });
      }
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
    // Posições por loja de cada produto: alimentam o destino de escoamento dos
    // cards de liquidação ("remanejar para onde?" — feedback 05).
    const posicoes = new Map<
      string,
      { storeId: string; storeName: string; unitsSold: number; currentStock: number }[]
    >();
    for (const prod of products) {
      const lista = stores
        .map((st) => ({
          storeId: st.id,
          storeName: st.name,
          unitsSold: soldQty.get(key(st.id, prod.id)) ?? 0,
          currentStock: stockQty.get(key(st.id, prod.id)) ?? 0,
        }))
        .filter((x) => x.unitsSold > 0 || x.currentStock > 0);
      if (lista.length > 0) posicoes.set(prod.id, lista);
    }
    // Reserva por MARCA: a maioria dos cards de liquidação é estoque morto,
    // sem venda própria em loja nenhuma. A rede não sabe onde ESTA peça sai,
    // mas sabe onde a marca sai.
    const porMarca = new Map<
      string,
      { storeId: string; storeName: string; unitsSold: number; currentStock: number }[]
    >();
    for (const prod of products) {
      // MESMA regra do backend: agrupa pela marca de ANÁLISE (grife extraída da
      // descrição), não pelo campo de fornecedor — que vem vazio na maior parte
      // do catálogo real e jogaria produtos de marcas diferentes num só balde.
      const marca = analysisBrand(prod.description, prod.category, prod.brand);
      if (!marca) continue;
      const lista = porMarca.get(marca) ?? stores.map((st) => ({
        storeId: st.id, storeName: st.name, unitsSold: 0, currentStock: 0,
      }));
      lista.forEach((x, i) => {
        x.unitsSold += soldQty.get(key(stores[i].id, prod.id)) ?? 0;
        x.currentStock += stockQty.get(key(stores[i].id, prod.id)) ?? 0;
      });
      porMarca.set(marca, lista);
    }
    // Dias parados por produto: a MESMA base que dá idade ao card no lote de
    // geração. É o sinal de tempo que faz o desconto variar por peça.
    const paradoPor = new Map<string, number>();
    for (const prod of products) {
      const idade = demoCardAge(cardIdParaProduto(prod.id));
      paradoPor.set(prod.id, Math.round((demoBatchAt.getTime() - idade.firstSeenAt.getTime()) / 86_400_000));
    }
    const board = buildDecisionCards(
      planningPlans(planDays, one(params.storeId), planGroup),
      rebalanceRows().rows,
      new Set(demoDecisions.map((r) => r.cardId)),
      posicoes,
      porMarca,
      paradoPor,
    );
    const history = new Map(
      board.cards.map((c) => [c.id, { cardId: c.id, ...demoCardAge(c.id) }]),
    );
    const lote = {
      id: 'demo-batch',
      generatedAt: demoBatchAt.toISOString(),
      source: 'CRON' as const,
      cardsTotal: board.cards.length + demoDecisions.length,
      cardsNew: [...history.values()].filter((h) => h.timesSeen <= 1).length,
      simulated: true,
    };
    // Daqui para baixo é a MESMA sequência da API (planning.service.ts): a
    // contagem de idades e a lista de grifes saem do quadro inteiro, os filtros
    // de vista recortam, e só então a página é cortada. A demo é o espelho
    // offline da API — se ela paginasse de outro jeito, o teste da demo
    // deixaria de provar qualquer coisa sobre a rota.
    // Um `agora` só para contar e para anotar, como na API.
    const agora = new Date();
    const contagem = contarIdades(board.cards, history, 30, agora);
    const grifes = grifesDoQuadro(board.cards);
    const vista = filtrarVista(board.cards, {
      tipo: umDe(one(params.tipo), DECISION_TYPES),
      prioridade: umDe(one(params.prioridade), DECISION_PRIORITIES),
      loja: one(params.loja) || undefined,
      grife: one(params.grife) || undefined,
    });
    const { itens, pagina } = paginar(vista, ...recorte(params, CARDS_POR_PAGINA, TETO_DE_CARDS));
    return annotateCardAges(
      { summary: board.summary, cards: itens, grifes, pagina },
      history,
      lote,
      30,
      agora,
      contagem,
    );
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

  // Mix de grifes (feedback 6.0 · item 03). Chave diferente da de
  // fornecedores: aqui é `analysisBrand`, a grife da descrição, que é o que o
  // motor consulta. É a mesma agregação que o backend faz — em memória,
  // porque a grife é derivada e não existe coluna para agrupar.
  if (url === '/planning/brand-mix' && m === 'GET') {
    const contagem = new Map<string, { brand: string; products: number }>();
    for (const p of products) {
      const grife = analysisBrand(p.description, p.category, p.brand);
      if (!grife) continue;
      const k = normBrandKey(grife);
      const atual = contagem.get(k);
      if (atual) atual.products += 1;
      else contagem.set(k, { brand: grife, products: 1 });
    }
    const rows = [...contagem.values()].map((c) => ({
      brand: c.brand,
      products: c.products,
      discontinued: foraDoMixDemo(c.brand),
    }));
    for (const b of demoForaDoMix) {
      if (!contagem.has(b)) rows.push({ brand: b, products: 0, discontinued: true });
    }
    rows.sort((a, b) => b.products - a.products || a.brand.localeCompare(b.brand, 'pt-BR'));
    return { rows };
  }
  if (url === '/planning/brand-mix' && m === 'PUT') {
    const chave = normBrandKey(String(body.brand ?? ''));
    if (body.discontinued === true) demoForaDoMix.add(chave);
    else demoForaDoMix.delete(chave);
    return { brand: chave, discontinued: demoForaDoMix.has(chave) };
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
  if (url === '/alerts')
    return alerts(productGroup(params.group), params.category, one(params.storeId) || undefined);
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
