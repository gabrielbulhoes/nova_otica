import axios from 'axios';
import { coberturaDoDataset, demoHandle } from './demo';
import type { CoberturaDaAmostra } from './demo';

/** Modo demonstração: o app roda sem backend, com dados fictícios no navegador. */
export const DEMO = import.meta.env.VITE_DEMO === '1';

export type { CoberturaDaAmostra };

/**
 * Janela que a amostra estática responde de verdade, ou `null` quando não há
 * limite a declarar (backend ao vivo, ou demonstração com dados fictícios).
 *
 * A porta é aqui, e não em `demo.ts`, por causa do gate: o dataset real é
 * embarcado por `import.meta.glob` sempre que o arquivo existe na árvore, mesmo
 * num build ligado ao backend. Sem checar DEMO, um build ao vivo herdaria o
 * limite de uma fotografia que ele nem usa.
 */
export function coberturaDaAmostra(): CoberturaDaAmostra | null {
  return DEMO ? coberturaDoDataset() : null;
}

export const api = axios.create({ baseURL: '/api' });

if (DEMO) {
  // Adapter que responde localmente a partir do handler de demonstração.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api.defaults.adapter = (async (config: any) => {
    const url: string = config.url ?? '';
    const method: string = config.method ?? 'get';
    const params = config.params ?? {};
    const body = config.data ? (typeof config.data === 'string' ? JSON.parse(config.data) : config.data) : {};
    const result = demoHandle({ method, url, params, body }) as Record<string, unknown>;
    const status = result && typeof result === 'object' && '__status' in result ? (result.__status as number) : 200;
    const base = { statusText: 'OK', headers: {}, config };
    if (status >= 400) {
      const error: any = new Error('demo error');
      error.response = { ...base, status, data: result };
      throw error;
    }
    return { ...base, status: 200, data: result };
  }) as any;
}

// ─── Autenticação ────────────────────────────────────────────────────────────

const TOKEN_KEY = 'nova_otica_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status === 401 && getToken()) {
      clearToken();
      if (!location.pathname.startsWith('/login')) location.assign('/login');
    }
    return Promise.reject(error);
  },
);

export type Role = 'ADMIN' | 'STORE_MANAGER';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  storeId: string | null;
  storeName?: string | null;
}

export const login = (email: string, password: string) =>
  api.post<{ token: string; user: AuthUser }>('/auth/login', { email, password }).then((r) => r.data);
export const getMe = () => api.get<AuthUser>('/auth/me').then((r) => r.data);

// ─── Tipos compartilhados com a API ──────────────────────────────────────────

export interface Paged<T> {
  total: number;
  page?: number;
  limit?: number;
  rows: T[];
}

export interface DashboardSummary {
  stores: number;
  products: number;
  /** Na demo, quantos SKUs a amostra carrega (o total é da rede). */
  productsSampled?: number;
  /** `products` é uma projeção do total da rede sobre o recorte, não uma contagem. */
  productsEstimated?: boolean;
  /** O total de SKUs da rede, sem recorte — o denominador da projeção. */
  productsNetwork?: number;
  customers: number;
  stockUnits: number;
  /**
   * Unidades nas unidades de RETAGUARDA (centro de distribuição, assistência,
   * estoque de compras). Nunca somadas a `stockUnits`: não estão em prateleira
   * e não entram em giro nem reposição. Exibidas à parte para não sumirem da
   * tela sem explicação. Ausente na demo.
   */
  backofficeUnits?: number;
  /**
   * Unidades nas filiais que rodam em OUTRO ERP (ZEISS VISION CENTER). O CDS
   * responde por elas com dado atrasado, então elas ficam fora de todas as
   * contas — mas o número vem para a tela poder dizer isso. Feedback 6.0/01.
   */
  externalErpUnits?: number;
  externalErpStores?: number;
  pendingMovements: number;
  sales30d: { count: number; total: number };
  lastSync: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
    recordsWritten: number;
    window: string | null;
  } | null;
}

export type CoverageLevel = 'CRITICAL' | 'HEALTHY' | 'HIGH' | 'EXCESS';

export interface StoreCoverageRow {
  storeId: string;
  storeName: string;
  stockUnits: number;
  unitsSold: number;
  monthlyUnits: number;
  /** Estoque para quantos meses no ritmo atual (null = sem venda no período). */
  coverageMonths: number | null;
  level: CoverageLevel;
}

export interface StockRow {
  storeId: string;
  storeName: string;
  productId: string;
  productExternalId: string;
  description: string;
  brand: string | null;
  category: string | null;
  price: number | null;
  synced: number;
  reserved: number;
  pendingDelta: number;
  onHand: number;
  availableNow: number;
  syncedAt: string | null;
}

export interface Store {
  id: string;
  externalId: string;
  name: string;
  city: string | null;
  state: string | null;
  active: boolean;
  /**
   * Retaguarda: GMAIS (centro de distribuição), assistência, estoque de
   * compras. Tem estoque real, não vende ao cliente. Fora do planejamento.
   */
  excludeFromPlanning?: boolean;
  /**
   * Opera em OUTRO ERP (ZEISS). O CDS devolve dados, desatualizados. Fora de
   * todo número. Campo separado do de cima de propósito — juntar os dois faria
   * uma loja de varejo aparecer como centro de distribuição.
   */
  externalErp?: boolean;
  _count?: { stockItems: number; sales: number };
}

export interface Product {
  id: string;
  externalId: string;
  sku: string | null;
  description: string;
  brand: string | null;
  category: string | null;
  price: string | number | null;
  color?: { name: string } | null;
  size?: { name: string } | null;
}

export type MovementStatus =
  | 'REQUESTED'
  | 'REJECTED'
  | 'PENDING'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'RECONCILED';

export interface Movement {
  id: string;
  type: 'TRANSFER' | 'SALE' | 'ADJUSTMENT' | 'RETURN';
  status: MovementStatus;
  quantity: number;
  reason: string | null;
  reference: string | null;
  decisionNote: string | null;
  createdAt: string;
  product: { id: string; description: string };
  fromStore: { id: string; name: string } | null;
  toStore: { id: string; name: string } | null;
}

export type AbcDimension = 'product' | 'brand';

export interface AbcRow {
  key: string;
  label: string;
  brand: string | null;
  category: string | null;
  revenue: number;
  units: number;
  revenuePct: number;
  cumulativePct: number;
  class: 'A' | 'B' | 'C';
}

/** Cobertura por recorte genérico (marca, geral…) — mesma régua da por loja. */
export interface CoverageReportRow {
  key: string;
  label: string;
  stockUnits: number;
  unitsSold: number;
  monthlyUnits: number;
  coverageMonths: number | null;
  level: CoverageLevel;
}

export type AnalysisDimension = 'brand' | 'category' | 'product' | 'store' | 'seller';

export interface AnalysisRow {
  key: string;
  label: string;
  units: number;
  revenue: number;
}

export interface TurnoverRow {
  productId: string;
  description: string;
  brand: string | null;
  category: string | null;
  unitsSold: number;
  currentStock: number;
  turnover: number;
  daysOfInventory: number | null;
}

export interface StockAlert {
  level: 'OUT' | 'LOW';
  storeId: string;
  storeName: string;
  productId: string;
  description: string;
  brand: string | null;
  category: string | null;
  availableNow: number;
  threshold: number;
}

export interface SyncStatus {
  mode: 'mock' | 'live';
  window: string;
  windowOpen: boolean;
  now: string;
  cron: string;
  timezone: string;
  lastRuns: Array<{
    id: string;
    entity: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    recordsWritten: number;
    error: string | null;
  }>;
}

export interface Sale {
  id: string;
  externalId: string;
  saleDate: string;
  total: string | number;
  status: string | null;
  store: { name: string } | null;
  seller: { name: string } | null;
  customer: { name: string } | null;
  _count?: { items: number };
}

// ─── Chamadas ────────────────────────────────────────────────────────────────

export const getSummary = (params?: Record<string, string | undefined>) =>
  api.get<DashboardSummary>('/dashboard/summary', { params }).then((r) => r.data);
export const getStoreCoverage = (params?: Record<string, string | undefined>) =>
  api
    .get<{
      days: number;
      /** Janela REAL medida nos dados; pode ser menor que `days`. */
      windowDays?: number;
      rows: StoreCoverageRow[];
    }>('/dashboard/coverage', { params })
    .then((r) => r.data);

// Arrays viram parâmetro repetido (?storeId=a&storeId=b) — cada valor segue
// literal, então categorias com vírgula não quebram o filtro multi-seleção.
export const getStock = (params: Record<string, string | string[] | boolean | undefined>) =>
  api.get<Paged<StockRow>>('/stock', { params }).then((r) => r.data);

/**
 * Lista de lojas. Na demo estática o catálogo vem amostrado, e a resposta
 * marca isso para a tela poder avisar em vez de exibir um número menor sem
 * explicação.
 */
export interface StoresResponse extends Paged<Store> {
  sampled?: boolean;
  catalogSampled?: number;
  productCountNetwork?: number;
  escopo?: EscopoDeLojas;
}

/**
 * Qual recorte do cadastro a tela quer.
 *
 * · `planejaveis` (PADRÃO) — as 16 lojas de varejo. Assistência, estoque de
 *   compras, GMAIS e ZEISS ficam de fora, como já ficavam de toda conta.
 * · `operacionais` — inclui a retaguarda, exclui ZEISS. Só para o lançamento
 *   de movimentação, onde o CD é origem legítima da distribuição.
 * · `todas` — o cadastro inteiro. Só para as telas que o administram.
 *
 * O padrão é o restritivo de propósito: a tela que não pensou no assunto
 * acerta, e foi justamente o contrário disso que fez as quatro filiais
 * continuarem aparecendo em dez seletores depois de saírem de toda a
 * matemática.
 */
export type EscopoDeLojas = 'planejaveis' | 'operacionais' | 'todas';
export const getStores = (escopo?: EscopoDeLojas) =>
  api.get<StoresResponse>('/stores', { params: escopo ? { escopo } : undefined }).then((r) => r.data);
export const getProducts = (params: Record<string, string | number | undefined>) =>
  api.get<Paged<Product>>('/products', { params }).then((r) => r.data);
export const getCategories = (params?: Record<string, string | undefined>) =>
  api.get<string[]>('/products/categories', { params }).then((r) => r.data);

export const getSales = (params: Record<string, string | number | undefined>) =>
  api.get<Paged<Sale>>('/sales', { params }).then((r) => r.data);

export const getMovements = (params: Record<string, string | undefined>) =>
  api.get<Paged<Movement>>('/movements', { params }).then((r) => r.data);
export const createMovement = (body: Record<string, unknown>) =>
  api.post<Movement>('/movements', body).then((r) => r.data);
export const confirmMovement = (id: string) =>
  api.post<Movement>(`/movements/${id}/confirm`).then((r) => r.data);
export const cancelMovement = (id: string) =>
  api.post<Movement>(`/movements/${id}/cancel`).then((r) => r.data);
export const approveMovement = (id: string, note?: string) =>
  api.post<Movement>(`/movements/${id}/approve`, { note }).then((r) => r.data);
export const rejectMovement = (id: string, note?: string) =>
  api.post<Movement>(`/movements/${id}/reject`, { note }).then((r) => r.data);

// ─── Usuários (gestão, ADMIN) ────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  storeId: string | null;
  active: boolean;
  lastLoginAt: string | null;
  store?: { name: string } | null;
}

export const getUsers = () => api.get<{ total: number; rows: AdminUser[] }>('/users').then((r) => r.data);
export const createUser = (body: { email: string; name: string; password: string; role: Role; storeId?: string }) =>
  api.post<AdminUser>('/users', body).then((r) => r.data);
export const updateUser = (id: string, body: Partial<{ name: string; role: Role; storeId: string | null; active: boolean }>) =>
  api.patch<AdminUser>(`/users/${id}`, body).then((r) => r.data);
export const resetUserPassword = (id: string, password: string) =>
  api.post(`/users/${id}/reset-password`, { password }).then((r) => r.data);

// ─── Relatórios e alertas ────────────────────────────────────────────────────

export const getAbc = (params: Record<string, string | number | undefined>) =>
  api
    .get<{
      days: number;
      dimension: AbcDimension;
      totalRevenue: number;
      /** Receita do período sem o recorte de produto — para reconciliar. */
      periodRevenue?: number;
      /** Quantos SKUs tiveram VENDA na janela (só eles entram na curva). */
      skusComVenda?: number;
      /** Quantos SKUs o catálogo tem — o contraste que explica a curva curta. */
      skusNoCatalogo?: number;
      /** Dias que a extração realmente cobre, que podem ser menos que `days`. */
      janelaRealDias?: number;
      summary: Record<'A' | 'B' | 'C', { items: number; revenue: number }>;
      rows: AbcRow[];
    }>('/reports/abc', { params })
    .then((r) => r.data);
export const getTurnover = (params: Record<string, string | number | undefined>) =>
  api.get<{ days: number; rows: TurnoverRow[] }>('/reports/turnover', { params }).then((r) => r.data);
export const getBrandCoverage = (params: Record<string, string | number | undefined>) =>
  api
    .get<{
      days: number;
      total: CoverageReportRow;
      rows: CoverageReportRow[];
      /** Só na demo: as linhas por marca cobrem menos que o total da rede. */
      sampled?: { stockUnits: number; networkStockUnits: number };
    }>('/reports/coverage', { params })
    .then((r) => r.data);
export const getSalesAnalysis = (params: Record<string, string | number | undefined>) =>
  api
    .get<{ days: number; by: AnalysisDimension; rows: AnalysisRow[] }>('/reports/sales-analysis', { params })
    .then((r) => r.data);

// ─── Mix de marcas por bandeira + Modo Feira (Onda 3) ────────────────────────

export interface BrandMixCell {
  stockUnits: number;
  unitsSold: number;
}

export interface BrandMixRow {
  brand: string;
  total: BrandMixCell;
  byBanner: Record<string, BrandMixCell>;
  sellsIn: string[];
  /** Bandeiras com estoque parado da marca enquanto ela vende em outra. */
  moveFrom: string[];
}

export const getBrandMix = (params?: Record<string, string | undefined>) =>
  api
    .get<{ days: number; banners: string[]; rows: BrandMixRow[] }>('/reports/brand-mix', { params })
    .then((r) => r.data);

export interface FairSplitRow {
  storeId: string;
  storeName: string;
  unitsSold: number;
  stockUnits: number;
  sharePct: number;
  suggestedQty: number;
}

export const getFairSplit = (params: Record<string, string | number | undefined>) =>
  api
    .get<{ days: number; filter: { brand?: string; category?: string }; totalQty: number; totalSold: number; rows: FairSplitRow[] }>(
      '/planning/fair-split',
      { params },
    )
    .then((r) => r.data);

export const getAlerts = (params: Record<string, string | undefined>) =>
  api
    .get<{
      total: number;
      out: number;
      low: number;
      rows: StockAlert[];
      /** Posições examinadas — o universo depois da guarda "a loja trabalha". */
      examinadas?: number;
      /**
       * A LISTA foi cortada (os contadores nunca são). Existe porque o corte
       * era silencioso: a tela contava sobre uma fatia alfabética do catálogo
       * e apresentava o número como se fosse da rede inteira.
       */
      truncado?: boolean;
      /** Teto da lista, para a tela dizer "as N mais críticas". */
      limite?: number;
    }>('/alerts', { params })
    .then((r) => r.data);
export const setMinStock = (productId: string, minStock: number | null, storeId?: string) =>
  api.put('/alerts/min-stock', { productId, minStock, storeId }).then((r) => r.data);

// ─── Planejamento & Compras (análise preditiva) ──────────────────────────────

export type MovementClass = 'DEAD' | 'SLOW' | 'HEALTHY' | 'FAST';
export type Recommendation = 'BUY' | 'HOLD' | 'DONT_BUY' | 'LIQUIDATE';
/** Recorte de cobertura: principal (óculos+grau+relógio), lentes ou tudo. */
export type ProductGroup = 'principal' | 'relogios' | 'lentes' | 'outros' | 'todos';

export interface ProductPlan {
  productId: string;
  description: string;
  brand: string | null;
  category: string | null;
  currentStock: number;
  unitsSold: number;
  dailyDemand: number;
  coverageDays: number | null;
  reorderPoint: number;
  targetStock: number;
  unitCost: number;
  stockValue: number;
  excessValue: number;
  revenue: number;
  movementClass: MovementClass;
  recommendation: Recommendation;
  suggestedQty: number;
  capital: number;
  stockoutInDays: number | null;
  reason: string;
  /** Explicação curta e amigável do porquê da decisão. */
  friendlyReason: string;
  /** Confiabilidade da decisão (0–100). */
  confidence: number;
  /** Unidades a caminho (pedidos enviados e não recebidos). */
  onOrderQty: number;
  /** Prazo de ressuprimento aplicado (do fornecedor/marca ou padrão). */
  leadTimeDays: number;
  /** Dias restantes para fazer o pedido sem romper (null = sem urgência). */
  orderByInDays: number | null;
  /** Detalhe da previsão de demanda usada (ausente = média simples). */
  forecast?: { baseDaily: number; seasonalIndex: number; targetMonth: number; method: 'media' | 'tendencia' | 'sazonal' };
}

export interface PlanningOverview {
  days: number;
  currency: 'BRL';
  capital: { total: number; idle: number; parked: number; excess: number; healthy: number; idlePct: number };
  movement: { dead: number; slow: number; healthy: number; fast: number };
  pareto: {
    totalRevenue: number;
    totalProducts: number;
    classAProducts: number;
    classAShareOfSkus: number;
    classARevenueShare: number;
  };
  topIdle: Array<{
    productId: string;
    description: string;
    category: string | null;
    currentStock: number;
    unitCost: number;
    idleValue: number;
    coverageDays: number | null;
    movementClass: MovementClass;
  }>;
  byCategory: Array<{ category: string; capital: number; idle: number; units: number }>;
}

export interface PurchaseSuggestions {
  days: number;
  summary: {
    buy: number;
    hold: number;
    dontBuy: number;
    liquidate: number;
    buyCapital: number;
    avoidedCapital: number;
    /** Quantos SKUs o motor analisou — o denominador de `buy`. */
    analisados?: number;
    /**
     * Itens com risco de ruptura, contados no servidor sobre o conjunto todo.
     * A tela somava isso percorrendo as linhas — o que a obrigava a baixar as
     * 13 mil linhas inteiras só para exibir um inteiro.
     */
    emRisco?: number;
    /** Quantos SKUs o recorte tem na rede, quando a base carregada é amostra. */
    universo?: number;
  };
  rows: ProductPlan[];
  /** Recorte desta resposta: as linhas vêm paginadas. */
  pagina?: PaginaDaResposta;
}

export interface RebalanceSuggestion {
  productId: string;
  description: string;
  brand: string | null;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  quantity: number;
  /**
   * PISO de unidades vendáveis que ficam na origem: o que sobra se TODAS as
   * linhas desta peça saindo dela forem aprovadas, não só esta. Nunca zero, e
   * a tela precisa dizer a condição — cada linha é aprovada isolada.
   */
  fromRemainingUnits: number;
  /** Cobertura (dias) na origem e no destino antes da transferência. */
  fromCoverageDays: number | null;
  toCoverageDays: number | null;
  /** Previsão de ruptura no destino (dias), quando houver. */
  stockoutInDays: number | null;
  reason: string;
  /** Explicação curta e amigável do porquê transferir. */
  friendlyReason: string;
  /** Confiabilidade da sugestão (0–100). */
  confidence: number;
}

export interface RebalancePlan {
  days: number;
  summary: { suggestions: number; units: number; storesInvolved: number };
  rows: RebalanceSuggestion[];
  /** As guardas que o motor aplicou ao escolher doadoras — a tela as declara. */
  guards: { newProductDays: number; donorFloorUnits: number };
}

export interface SupplierSetting {
  brand: string;
  leadTimeDays: number | null;
  products: number;
  isDefault: boolean;
}

/**
 * Uma grife do catálogo com a marcação de mix. Chave DIFERENTE da de
 * `SupplierSetting`: ali é o fornecedor do ERP, aqui é a grife extraída da
 * descrição — a mesma que o motor usa para decidir compra e liquidação.
 *
 * Nome distinto de `BrandMixRow` (linha 407) de propósito: aquele é o mix de
 * marcas POR BANDEIRA do relatório, outra pergunta inteiramente.
 */
export interface GrifeDoMix {
  brand: string;
  /** Produtos do catálogo cuja grife de análise é esta. 0 = marcação inerte. */
  products: number;
  /** Fora do mix atual da rede — corta a sugestão de compra. */
  discontinued: boolean;
}

/**
 * Uma linha de rateio por loja. É o MESMO formato na aba de compras e no plano
 * de recebimento de propósito: as duas telas respondem a mesma pergunta —
 * quanto vai para cada loja e por quê — e uma tabela só serve às duas.
 *
 * `suggestedQty` e não `quantity`: é o nome que o domínio já usa em
 * `ProductPlan` e em `NeedSplitRow`, do outro lado da rede. Enquanto o web
 * chamava de `quantity` e uma das duas rotas mandava `suggestedQty`, a coluna
 * "Mandar" — o único número que esta tela existe para produzir — saía VAZIA na
 * tela e ZERO no CSV, com o typecheck verde: um tipo declarado à mão não
 * verifica nada, só documenta uma esperança. Um nome só, ponta a ponta.
 */
export interface RateioLoja {
  storeId: string;
  storeName: string;
  /** Unidades para esta loja. A soma bate exatamente com a quantidade. */
  suggestedQty: number;
  /** Participação da loja na base usada (%). */
  sharePct: number;
  /** Unidades que a loja vendeu DESTA peça no período. */
  unitsSold: number;
  /** Estoque atual da loja nesta peça. */
  stockUnits: number;
  /** Falta até a cobertura-alvo (un.) — o peso do rateio por necessidade. */
  needUnits: number;
  /**
   * O peso que gerou `sharePct`. Igual à falta quando a base é a necessidade;
   * na reserva é a venda da grife/categoria/rede, que é o número que explica o
   * percentual quando a peça é nova e a venda do próprio SKU é zero.
   */
  weightUnits: number;
}

/** De qual peso saiu o rateio da aba de compras. */
export type NeedBasis = 'necessidade' | 'participacao';

export interface ItemDistribution {
  basis: NeedBasis;
  basisLabel: string;
  /** Necessidade CRUA da rede (un.): a compra cobre a falta ou não. */
  totalNeed: number;
  rows: RateioLoja[];
  /** Unidades sem loja — declaradas, nunca evaporadas. */
  unassigned: number;
  /**
   * Lojas fora do rateio por não trabalharem a grife (mix por loja). Ausente
   * quando não há mix valendo — nunca presente e vazia, para a tela poder ler
   * a presença como "houve exclusão".
   */
  excludedByMix?: string[];
}

export interface PurchaseOrderItem {
  productId: string;
  description: string;
  /** Marca real do produto (extraída da descrição). */
  brand: string | null;
  category: string | null;
  quantity: number;
  unitCost: number;
  total: number;
  orderByInDays: number | null;
  stockoutInDays: number | null;
  confidence: number;
  /**
   * Como dividir esta compra entre as lojas. AUSENTE não é "dividir igual": é
   * "não calculado" — a rota omite o campo para quem não é ADMIN, porque o
   * rateio expõe venda e estoque da rede inteira.
   */
  distribution?: ItemDistribution;
  /**
   * A ficha do fornecedor: tipo de armação, gênero, material. AUSENTE quando a
   * peça não casou com o catálogo importado — e a tela precisa dizer isso, não
   * escondê-lo: hoje só o catálogo da Luxottica entrou, então a maior parte do
   * pedido de outros fornecedores vem sem ficha até Marcolin e Thélios
   * chegarem.
   */
  atributos?: AtributosDaPeca;
}

export interface AtributosDaPeca {
  /** Feminino · Masculino · Unisex · Menina · Menino */
  genero: string | null;
  /** Retangular, Quadrado, Gatinho, Phantos… — o "tipo de óculos" do feedback. */
  formato: string | null;
  material: string | null;
  /** Em milímetros, como o fornecedor publica. */
  tamanhoLente: number | null;
  /** Marcação do FORNECEDOR. Contexto de compra, nunca decisão do motor. */
  bestSeller: boolean;
}

export interface PurchaseOrder {
  supplier: string;
  /** Marcas de produto presentes neste pedido (resumo do fornecedor). */
  brands: string[];
  leadTimeDays: number;
  items: PurchaseOrderItem[];
  units: number;
  total: number;
  orderByInDays: number | null;
  stockoutInDays: number | null;
  /**
   * Confiança do pedido (0–100): média das confianças dos itens ponderada pelo
   * capital. É a régua que ORDENA a lista de compras — da mais alta para a
   * mais baixa, como o cliente pediu. A urgência virou desempate.
   */
  confidence: number;
  /** Quanto deste pedido é de cada grife, por valor. */
  porGrife: { brand: string; items: number; units: number; total: number }[];
  /** Tipos de armação do pedido. Só as peças com ficha do fornecedor. */
  porFormato: { formato: string; units: number }[];
  /** Itens com ficha — o numerador da cobertura que a tela declara. */
  itensComFicha: number;
}

export interface PurchaseOrdersPlan {
  days: number;
  summary: { suppliers: number; items: number; units: number; total: number };
  orders: PurchaseOrder[];
}

export type DecisionType = 'COMPRA' | 'REMANEJAMENTO' | 'LIQUIDACAO';
export type DecisionPriority = 'ALTA' | 'MEDIA' | 'BAIXA';

export interface DecisionCard {
  id: string;
  type: DecisionType;
  title: string;
  priority: DecisionPriority;
  /** De onde veio a prioridade: urgência, confiança ou valor em jogo. */
  priorityReason?: string;
  productId: string;
  description: string;
  brand: string | null;
  /** Grife de análise (extraída da descrição) — é por ela que a tela filtra. */
  brandLabel?: string | null;
  target: string;
  fromStoreId?: string;
  toStoreId?: string;
  quantity: number | null;
  reason: string;
  confidence: number;
  impact: number;
  impactLabel: string;
  urgencyDays: number | null;
  /** Primeira aparição do card, vinda do lote de geração. */
  firstSeenAt?: string;
  ageDays?: number;
  isNew?: boolean;
  isOverdue?: boolean;
  /** Liquidação: desconto sugerido, teto e o porquê. */
  discountPct?: number;
  discountMaxPct?: number;
  discountReason?: string;
  discountParams?: {
    basePct: number;
    priceBand: 'abaixo de R$ 1.000' | 'R$ 1.000 ou mais';
    stepPct: number;
    stepDays: number;
    steps: number;
    stuckDays: number | null;
    marginPct: number;
    ceilingEstimated: boolean;
    brandUnitsSold: number | null;
  };
  /** Liquidação: loja com maior chance de escoar. */
  outletStoreId?: string;
  outletStoreName?: string;
  outletBasis?: 'sku' | 'marca';
  /** Liquidação: de onde sai e quantas — a transferência já resolvida. */
  outletFromStoreId?: string;
  outletFromStoreName?: string;
  outletQuantity?: number;

  /**
   * Compra (feedback 6.0 · item 06): o que a rede JÁ TEM parado desta peça.
   *
   * O número NÃO é abatido da compra — as unidades paradas já entram no
   * estoque da rede que gerou a sugestão, e descontá-las de novo compraria de
   * menos, que é o lado do erro que gera ruptura. A justificativa completa
   * está em `DecisionCard`, em planning.math.ts.
   */
  redeParadaQty?: number;
  redeParadaLojas?: string[];
  remanejamentoSugeridoQty?: number;

  /** Remanejamento (item 12): o malote. Ausente quando a rota é desconhecida. */
  maloteEmbarque?: string;
  maloteChegada?: string;
  maloteDias?: number;
  maloteTexto?: string;
}

/** Lote de geração: a execução do motor que produziu estes cards. */
export interface BatchInfo {
  id: string;
  generatedAt: string;
  source: 'CRON' | 'MANUAL';
  cardsTotal: number;
  cardsNew: number;
  /** Só a demo marca: as idades dos cards ali são derivadas, não medidas. */
  simulated?: boolean;
}

/**
 * Recorte de uma resposta paginada. `total` é o tamanho da VISTA (o que sobrou
 * dos filtros), enquanto o resumo continua falando do conjunto inteiro.
 */
export interface PaginaDaResposta {
  page: number;
  pageSize: number;
  total: number;
}

export interface DecisionBoard {
  /**
   * SEMPRE do quadro inteiro, mesmo quando `cards` traz só uma página e mesmo
   * sob filtro de vista. É o que os indicadores da tela leem.
   */
  summary: {
    total: number;
    byType: { compra: number; remanejamento: number; liquidacao: number };
    byPriority: { alta: number; media: number; baixa: number };
    impactTotal: number;
    criticos: number;
    /** Cards que o motor gerou mas já têm decisão registrada (saíram do board). */
    decididos: number;
    novos?: number;
    atrasados?: number;
  };
  cards: DecisionCard[];
  batch?: BatchInfo;
  /** Grifes do quadro inteiro — a origem do seletor de grife da tela. */
  grifes?: string[];
  /** Recorte desta resposta: os cards vêm paginados. */
  pagina?: PaginaDaResposta;
}

export interface BatchRow extends BatchInfo {
  trigger: string;
  days: number;
  compra: number;
  remanejamento: number;
  liquidacao: number;
  impactTotal: number;
}

export const fetchBatches = (limit = 30) =>
  api.get<{ rows: BatchRow[] }>('/planning/batches', { params: { limit } }).then((r) => r.data);

// ─── Governança da decisão (Onda 1 · TB) ─────────────────────────────────────

export type DecisionOutcome = 'APPROVED' | 'REJECTED';

export interface DecisionHistoryRow {
  id: string;
  cardId: string;
  cardType: string;
  outcome: DecisionOutcome;
  note: string | null;
  impact: number;
  decidedAt: string;
  decidedByName: string;
  daysToDecide: number | null;
}

export interface DecisionStats {
  slaDays: number;
  approved: number;
  rejected: number;
  approvedImpact: number;
  rejectedImpact: number;
  avgDaysToDecide: number | null;
  series: { date: string; approved: number; rejected: number }[];
  byUser: { userId: string; name: string; approved: number; rejected: number; impact: number }[];
}

/** Registra a decisão sobre um card. Recusar exige justificativa. */
export async function recordDecision(input: {
  cardId: string;
  cardType: string;
  outcome: DecisionOutcome;
  impact: number;
  note?: string;
  productId?: string;
  storeId?: string;
}): Promise<{ id: string }> {
  const { data } = await api.post('/planning/decisions', input);
  return data;
}

export async function getDecisionHistory(limit = 200): Promise<DecisionHistoryRow[]> {
  const { data } = await api.get('/planning/decisions/history', { params: { limit } });
  return data;
}

export async function getDecisionStats(days = 30): Promise<DecisionStats> {
  const { data } = await api.get('/planning/decisions/stats', { params: { days } });
  return data;
}

export type RiskProfile = 'conservador' | 'equilibrado' | 'agressivo';

export interface StrategySegment {
  key: 'best-seller' | 'lancamento' | 'aposta';
  label: string;
  rationale: string;
  units: number;
  pct: number;
}

export interface CommercialStrategy {
  floorUnits: number;
  windowMonths: number;
  risk: RiskProfile;
  capacity: number;
  capacityUsedPct: number;
  viable: boolean;
  withoutBacking: number;
  backedPct: number;
  segments: StrategySegment[];
  verdict: string;
  /** O plano DETALHADO — o que comprar, e para onde. Ver `PlanoDetalhado`. */
  detalhe: PlanoDetalhado;
}

/** Uma peça candidata, com o que se sabe dela. */
export interface CandidatoDoPlano {
  id: string;
  sku: string;
  description: string;
  /** A GRIFE (Ray-Ban, Dior), nunca o fornecedor. */
  brand: string;
  /** SOLAR · ARMACAO — o "tipo" da hierarquia. */
  tipo: string | null;
  genero: string | null;
  formato: string | null;
  cor: string | null;
  unitCost: number;
  unitPrice: number;
  unitsSold: number;
  currentStock: number;
  coberturaDaGrifeMeses: number | null;
  /** Quanto ESTA peça escoa na janela. `null` = sem teto próprio. */
  absorcao?: number | null;
}

export interface LinhaDoPlano {
  candidato: CandidatoDoPlano;
  segmento: StrategySegment['key'];
  units: number;
  margemPct: number;
  /**
   * O porquê em PORTUGUÊS. O concorrente publica
   * `low_cover_21mo_abs_weighted+sinal_tendencia_verificado` numa coluna que o
   * comprador lê enquanto decide — log de máquina numa tela de decisão não é
   * transparência, é a aparência dela.
   */
  porque: string;
  /** Quanto vai para cada loja. */
  lojas?: RateioLoja[];
  /** Unidades que nenhuma loja elegível reclamou — declaradas, nunca sumidas. */
  semLoja?: number;
  /** Lojas fora da divisão por não trabalharem a grife. */
  excludedByMix?: string[];
}

export interface PlanoDetalhado {
  segmentos: {
    segmento: StrategySegment['key'];
    meta: number;
    alocado: number;
    linhas: LinhaDoPlano[];
  }[];
  /** O total que cada filial recebe — a leitura de quem monta o malote. */
  porLoja: { storeId: string; storeName: string; units: number }[];
  /** Unidades do piso que o plano não conseguiu alocar. */
  naoAlocado: number;
  total: number;
  days: number;
  candidatosExaminados: number;
  universo: number;
  truncado: boolean;
  /** Por que o piso não fechou. Vazio quando fechou. */
  motivo: string;
}

type PlanParams = Record<string, string | number | undefined>;

/**
 * As duas consultas que fazem o servidor rodar o motor inteiro aceitam o
 * `AbortSignal` que o React Query entrega à `queryFn`.
 *
 * Não é refinamento. Sem repassar o sinal, trocar de filtro não cancela a
 * requisição em voo: quatro cliques dentro da janela de ~1,6 s de uma resposta
 * empilham quatro execuções concorrentes, cada uma materializando planos,
 * posições e rebalance inteiros. A medição dá 769 MB de pico com TRÊS
 * concorrentes e o processo roda com `--max-old-space-size=768` — a quarta
 * estoura o heap e reinicia o contêiner, que é justamente o modo de falha que
 * esta frente existe para remover. Estas rotas não têm limite de taxa; só o
 * login tem.
 */
export const getPlanningOverview = (params: PlanParams) =>
  api.get<PlanningOverview>('/planning/overview', { params }).then((r) => r.data);
export const getPurchaseSuggestions = (params: PlanParams, signal?: AbortSignal) =>
  api
    .get<PurchaseSuggestions>('/planning/purchase-suggestions', { params, signal })
    .then((r) => r.data);
export const getRebalancePlan = (params: PlanParams) =>
  api.get<RebalancePlan>('/planning/rebalance', { params }).then((r) => r.data);
export const getDecisionBoard = (params: PlanParams, signal?: AbortSignal) =>
  api.get<DecisionBoard>('/planning/decisions', { params, signal }).then((r) => r.data);
export const getCommercialStrategy = (params: PlanParams) =>
  api.get<CommercialStrategy>('/planning/strategy', { params }).then((r) => r.data);
export const getPurchaseOrders = (params: PlanParams) =>
  api.get<PurchaseOrdersPlan>('/planning/purchase-orders', { params }).then((r) => r.data);

export type PurchaseOrderRecordStatus = 'SENT' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrderRecord {
  id: string;
  supplier: string;
  leadTimeDays: number;
  status: PurchaseOrderRecordStatus;
  items: { productId: string; description: string; quantity: number; unitCost: number; total: number }[];
  units: number;
  total: string | number;
  sentAt: string;
  expectedAt: string | null;
  receivedAt: string | null;
}

export const registerPurchaseOrder = (body: {
  supplier: string;
  leadTimeDays: number;
  items: { productId: string; description: string; quantity: number; unitCost: number; total: number }[];
}) => api.post<PurchaseOrderRecord>('/planning/purchase-orders', body).then((r) => r.data);
export const getPurchaseOrderHistory = () =>
  api.get<{ total: number; rows: PurchaseOrderRecord[] }>('/planning/purchase-orders/history').then((r) => r.data);
export const settlePurchaseOrder = (id: string, action: 'receive' | 'cancel') =>
  api.post<PurchaseOrderRecord>(`/planning/purchase-orders/${id}/${action}`).then((r) => r.data);

// ─── Distribuição do recebimento (feedback 6.0 · item 06) ────────────────────

/**
 * De qual base saiu o rateio de um item. `necessidade` é a régua; os quatro
 * degraus abaixo dela são a RESERVA, e quanto mais abaixo, mais grossa.
 */
export type DistributionBasis = 'necessidade' | 'sku' | 'marca' | 'categoria' | 'rede';

export interface DistributionItem {
  productId: string;
  description: string;
  quantity: number;
  basis: DistributionBasis;
  basisLabel: string;
  /** Necessidade CRUA da rede nesta peça (un.). 0 = rateio caiu na reserva. */
  totalNeed: number;
  /* Aqui morava `export type DistributionRow = RateioLoja`. O apelido não
     traduzia nada: só dava um segundo nome ao mesmo formato, e foi ele que fez
     o typecheck aceitar duas rotas mandando campos diferentes sob o mesmo
     tipo. Um formato, um nome. */
  rows: RateioLoja[];
  /** Lojas fora do rateio por não trabalharem a grife (catálogo de mix). */
  excludedByMix?: string[];
}

export interface DistributionPlan {
  orderId: string;
  supplier: string;
  status: string;
  units: number;
  items: DistributionItem[];
  /** Unidades sem rateio possível — declaradas, nunca evaporadas. */
  unassigned: number;
  /** Quando esta carga já foi repartida. `null` = ainda por distribuir. */
  distributedAt: string | null;
}

/** Uma carga esperando para ser repartida entre as lojas. */
export interface CargaParaDistribuir {
  orderId: string;
  supplier: string;
  units: number;
  items: number;
  receivedAt: string | null;
  distributedAt: string | null;
  /** Dias parada desde o recebimento. É o que ordena a fila. */
  paradaHaDias: number | null;
}

export const getFilaDeDistribuicao = () =>
  api
    .get<{ pendentes: CargaParaDistribuir[]; distribuidos: CargaParaDistribuir[] }>(
      '/planning/fila-de-distribuicao',
    )
    .then((r) => r.data);

export const getDistributionPlan = (id: string) =>
  api.get<DistributionPlan>(`/planning/purchase-orders/${id}/distribution`).then((r) => r.data);
export const getReceivingUnits = () =>
  api
    .get<{ rows: { id: string; name: string }[] }>('/planning/receiving-units')
    .then((r) => r.data);
export const distributeOrder = (id: string, fromStoreId: string) =>
  api
    .post<{ created: number; units: number; movementIds: string[] }>(
      `/planning/purchase-orders/${id}/distribute`,
      { fromStoreId },
    )
    .then((r) => r.data);
export const getSupplierSettings = () =>
  api.get<{ defaultLeadTimeDays: number; rows: SupplierSetting[] }>('/planning/suppliers').then((r) => r.data);
export const setSupplierLeadTime = (brand: string, leadTimeDays: number | null) =>
  api.put('/planning/suppliers', { brand, leadTimeDays }).then((r) => r.data);
export const getMixDeGrifes = () =>
  api.get<{ rows: GrifeDoMix[] }>('/planning/brand-mix').then((r) => r.data);
export const setGrifeForaDoMix = (brand: string, discontinued: boolean) =>
  api.put('/planning/brand-mix', { brand, discontinued }).then((r) => r.data);

/**
 * O mix POR LOJA: quais lojas trabalham cada grife.
 *
 * Pergunta diferente da de `GrifeDoMix`, e as duas precisam continuar
 * separadas: lá é "a REDE parou de trabalhar esta grife" (corta a compra em
 * toda parte), aqui é "estas LOJAS trabalham esta grife" (corta o destino).
 * Chanel está viva na rede e proibida em catorze lojas.
 */
export interface GrifeComLojas {
  brand: string;
  storeIds: string[];
  /** `name: null` = loja saiu do escopo planejável, mas a linha existe. */
  stores: { id: string; name: string | null }[];
}
export const getMixPorLoja = () =>
  api
    .get<{ rows: GrifeComLojas[]; lojas: { id: string; name: string }[] }>('/planning/mix-por-loja')
    .then((r) => r.data);
/** A seleção INTEIRA, não um delta. Lista vazia = grife volta a ser corrente. */
export const declararMixDaGrife = (brand: string, storeIds: string[]) =>
  api.put('/planning/mix-por-loja', { brand, storeIds }).then((r) => r.data);

// ─── BI ──────────────────────────────────────────────────────────────────────

export interface BiKpis {
  days: number;
  /** Pontas do recorte de fato aplicado (AAAA-MM-DD). */
  de?: string;
  ate?: string;
  /** O recorte veio de datas escolhidas à mão, não de um "últimos N dias". */
  personalizado?: boolean;
  revenue: number;
  salesCount: number;
  avgTicket: number;
  /** Receita ÷ unidades vendidas. É o que responde ao recorte; o ticket não. */
  avgUnitPrice?: number;
  turnover: number;
  rupturaRate: number;
  lowStockRate: number;
  stockUnits: number;
  unitsSold: number;
  stockPositions: number;
  outOfStock: number;
  lowStock: number;
  pendingTransfers: number;
  /** No recorte, a contagem de vendas é proporcional (uma venda mistura tipos). */
  vendasAproximadas?: boolean;
}

export interface TimeseriesPoint {
  date: string;
  total: number;
  count: number;
}

export interface DimensionRow {
  key: string;
  label: string;
  total: number;
  count: number;
}

export interface SalesFlow {
  nodes: { name: string }[];
  links: { source: string; target: string; value: number }[];
}

export interface HeatmapData {
  xLabels: string[];
  yLabels: string[];
  cells: [number, number, number][];
  /** Projetado pela fatia do recorte: o CDS não traz dia da semana por tipo. */
  aproximado?: boolean;
}

type BiParams = Record<string, string | number | undefined>;

export const getBiKpis = (params: BiParams) =>
  api.get<BiKpis>('/bi/kpis', { params }).then((r) => r.data);
export const getBiTimeseries = (params: BiParams) =>
  api
    .get<{
      days: number;
      granularity: string;
      points: TimeseriesPoint[];
      /** A série é projetada pela fatia do recorte (o CDS não a traz por tipo). */
      aproximado?: boolean;
    }>('/bi/sales-timeseries', { params })
    .then((r) => r.data);
export const getBiDimension = (by: string, params: BiParams) =>
  api
    .get<{ by: string; rows: DimensionRow[]; aproximado?: boolean }>('/bi/sales-by-dimension', {
      params: { ...params, by },
    })
    .then((r) => r.data);
export const getBiSalesFlow = (params: BiParams) =>
  api.get<SalesFlow>('/bi/sales-flow', { params }).then((r) => r.data);
export const getBiTransferFlow = (params: BiParams) =>
  api.get<SalesFlow>('/bi/transfer-flow', { params }).then((r) => r.data);
export const getBiHeatmap = (params: BiParams) =>
  api.get<HeatmapData>('/bi/heatmap', { params }).then((r) => r.data);

// ─── AR (provador virtual) ───────────────────────────────────────────────────

export interface ArProduct {
  productId: string;
  description: string;
  brand: string | null;
  category: string | null;
  price: number | null;
  assetType: 'GLB_3D' | 'OVERLAY_2D';
  assetUrl: string;
  available: number;
}

export interface ArAsset {
  productId: string;
  type: 'GLB_3D' | 'OVERLAY_2D';
  url: string;
  fit: Record<string, number> | null;
  version: number;
  product: { description: string; brand: string | null };
}

export const getArProducts = () =>
  api.get<{ total: number; rows: ArProduct[] }>('/ar/products').then((r) => r.data);

export interface ProductDetail {
  id: string;
  externalId: string;
  description: string;
  brand: string | null;
  category: string | null;
  price: string | number | null;
  color?: { name: string } | null;
  size?: { name: string } | null;
  stockItems: { quantity: number; store: { id: string; name: string } }[];
}
export const getProduct = (id: string) =>
  api.get<ProductDetail>(`/products/${id}`).then((r) => r.data);
export const getArAsset = (productId: string) =>
  api.get<ArAsset>(`/ar/products/${productId}/asset`).then((r) => r.data);
export const recordTryOn = (body: { productId: string; storeId?: string; durationMs?: number; converted?: boolean }) =>
  api.post<{ id: string }>('/ar/tryon-events', body).then((r) => r.data);
export const getArStats = (days: number) =>
  api
    .get<{ days: number; total: number; converted: number; conversionRate: number; topProducts: { productId: string; description: string; tryOns: number }[] }>(
      '/ar/stats',
      { params: { days } },
    )
    .then((r) => r.data);

// ─── Carrinho e pedidos ──────────────────────────────────────────────────────

export interface CartItemView {
  productId: string;
  description: string;
  unitPrice: number;
  quantity: number;
  total: number;
  available: number;
}
export interface CartView {
  cartId: string | null;
  storeId: string | null;
  storeName: string | null;
  items: CartItemView[];
  subtotal: number;
  total: number;
}
export interface OrderView {
  id: string;
  number: string;
  status: 'CREATED' | 'PAID' | 'FULFILLED' | 'CANCELLED' | 'REFUNDED';
  subtotal: string | number;
  total: string | number;
  customerName: string | null;
  createdAt: string;
  paidAt: string | null;
  store: { name: string } | null;
  payment: { status: string; method: string | null; qrCode: string | null } | null;
  items: { id: string; quantity: number; unitPrice: string | number; total: string | number; product: { description: string } }[];
}

export const getCart = () => api.get<CartView>('/cart').then((r) => r.data);
export const addToCart = (body: { productId: string; storeId: string; quantity?: number }) =>
  api.post<CartView>('/cart/items', body).then((r) => r.data);
export const setCartQty = (productId: string, quantity: number) =>
  api.patch<CartView>(`/cart/items/${productId}`, { quantity }).then((r) => r.data);
export const removeFromCart = (productId: string) =>
  api.delete<CartView>(`/cart/items/${productId}`).then((r) => r.data);
export const clearCart = () => api.delete<CartView>('/cart').then((r) => r.data);

export const checkout = (body: { method?: 'PIX' | 'CARD' | 'BOLETO'; customerName?: string }) =>
  api.post<OrderView>('/orders', body).then((r) => r.data);
export const payOrder = (id: string) => api.post<OrderView>(`/orders/${id}/pay`).then((r) => r.data);
export const getOrders = () =>
  api.get<Paged<OrderView>>('/orders').then((r) => r.data);

export const getSyncStatus = () => api.get<SyncStatus>('/sync/status').then((r) => r.data);
export const runSync = () => api.post('/sync/run').then((r) => r.data);

export const formatBRL = (v: number | string | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
