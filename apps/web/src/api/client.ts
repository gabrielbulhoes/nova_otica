import axios from 'axios';
import { demoHandle } from './demo';

/** Modo demonstração: o app roda sem backend, com dados fictícios no navegador. */
export const DEMO = import.meta.env.VITE_DEMO === '1';

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
  customers: number;
  stockUnits: number;
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

export const getSummary = () => api.get<DashboardSummary>('/dashboard/summary').then((r) => r.data);
export const getStoreCoverage = (params?: Record<string, string | undefined>) =>
  api.get<{ days: number; rows: StoreCoverageRow[] }>('/dashboard/coverage', { params }).then((r) => r.data);

// Arrays viram parâmetro repetido (?storeId=a&storeId=b) — cada valor segue
// literal, então categorias com vírgula não quebram o filtro multi-seleção.
export const getStock = (params: Record<string, string | string[] | boolean | undefined>) =>
  api.get<Paged<StockRow>>('/stock', { params }).then((r) => r.data);

export const getStores = () => api.get<Paged<Store>>('/stores').then((r) => r.data);
export const getProducts = (params: Record<string, string | number | undefined>) =>
  api.get<Paged<Product>>('/products', { params }).then((r) => r.data);
export const getCategories = () => api.get<string[]>('/products/categories').then((r) => r.data);

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
      summary: Record<'A' | 'B' | 'C', { items: number; revenue: number }>;
      rows: AbcRow[];
    }>('/reports/abc', { params })
    .then((r) => r.data);
export const getTurnover = (params: Record<string, string | number | undefined>) =>
  api.get<{ days: number; rows: TurnoverRow[] }>('/reports/turnover', { params }).then((r) => r.data);
export const getBrandCoverage = (params: Record<string, string | number | undefined>) =>
  api
    .get<{ days: number; total: CoverageReportRow; rows: CoverageReportRow[] }>('/reports/coverage', { params })
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
    .get<{ total: number; out: number; low: number; rows: StockAlert[] }>('/alerts', { params })
    .then((r) => r.data);
export const setMinStock = (productId: string, minStock: number | null, storeId?: string) =>
  api.put('/alerts/min-stock', { productId, minStock, storeId }).then((r) => r.data);

// ─── Planejamento & Compras (análise preditiva) ──────────────────────────────

export type MovementClass = 'DEAD' | 'SLOW' | 'HEALTHY' | 'FAST';
export type Recommendation = 'BUY' | 'HOLD' | 'DONT_BUY' | 'LIQUIDATE';
/** Recorte de cobertura: principal (óculos+grau+relógio), lentes ou tudo. */
export type ProductGroup = 'principal' | 'lentes' | 'todos';

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
  summary: { buy: number; hold: number; dontBuy: number; liquidate: number; buyCapital: number; avoidedCapital: number };
  rows: ProductPlan[];
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
}

export interface SupplierSetting {
  brand: string;
  leadTimeDays: number | null;
  products: number;
  isDefault: boolean;
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
}

export interface PurchaseOrdersPlan {
  days: number;
  summary: { suppliers: number; items: number; units: number; total: number };
  orders: PurchaseOrder[];
}

type PlanParams = Record<string, string | number | undefined>;

export const getPlanningOverview = (params: PlanParams) =>
  api.get<PlanningOverview>('/planning/overview', { params }).then((r) => r.data);
export const getPurchaseSuggestions = (params: PlanParams) =>
  api.get<PurchaseSuggestions>('/planning/purchase-suggestions', { params }).then((r) => r.data);
export const getRebalancePlan = (params: PlanParams) =>
  api.get<RebalancePlan>('/planning/rebalance', { params }).then((r) => r.data);
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
export const getSupplierSettings = () =>
  api.get<{ defaultLeadTimeDays: number; rows: SupplierSetting[] }>('/planning/suppliers').then((r) => r.data);
export const setSupplierLeadTime = (brand: string, leadTimeDays: number | null) =>
  api.put('/planning/suppliers', { brand, leadTimeDays }).then((r) => r.data);

// ─── BI ──────────────────────────────────────────────────────────────────────

export interface BiKpis {
  days: number;
  revenue: number;
  salesCount: number;
  avgTicket: number;
  turnover: number;
  rupturaRate: number;
  lowStockRate: number;
  stockUnits: number;
  unitsSold: number;
  stockPositions: number;
  outOfStock: number;
  lowStock: number;
  pendingTransfers: number;
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
}

type BiParams = Record<string, string | number | undefined>;

export const getBiKpis = (params: BiParams) =>
  api.get<BiKpis>('/bi/kpis', { params }).then((r) => r.data);
export const getBiTimeseries = (params: BiParams) =>
  api
    .get<{ days: number; granularity: string; points: TimeseriesPoint[] }>('/bi/sales-timeseries', { params })
    .then((r) => r.data);
export const getBiDimension = (by: string, params: BiParams) =>
  api
    .get<{ by: string; rows: DimensionRow[] }>('/bi/sales-by-dimension', { params: { ...params, by } })
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
