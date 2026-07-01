import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

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

export interface SalesByStore {
  storeId: string | null;
  storeName: string;
  count: number;
  total: number;
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

export interface AbcRow {
  productId: string;
  description: string;
  brand: string | null;
  category: string | null;
  revenue: number;
  units: number;
  revenuePct: number;
  cumulativePct: number;
  class: 'A' | 'B' | 'C';
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
export const getSalesByStore = () =>
  api.get<{ rows: SalesByStore[] }>('/dashboard/sales-by-store').then((r) => r.data.rows);

export const getStock = (params: Record<string, string | boolean | undefined>) =>
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

// ─── Relatórios e alertas ────────────────────────────────────────────────────

export const getAbc = (params: Record<string, string | number | undefined>) =>
  api
    .get<{ days: number; totalRevenue: number; summary: Record<'A' | 'B' | 'C', { products: number; revenue: number }>; rows: AbcRow[] }>(
      '/reports/abc',
      { params },
    )
    .then((r) => r.data);
export const getTurnover = (params: Record<string, string | number | undefined>) =>
  api.get<{ days: number; rows: TurnoverRow[] }>('/reports/turnover', { params }).then((r) => r.data);

export const getAlerts = (params: Record<string, string | undefined>) =>
  api
    .get<{ total: number; out: number; low: number; rows: StockAlert[] }>('/alerts', { params })
    .then((r) => r.data);
export const setMinStock = (productId: string, minStock: number | null) =>
  api.put('/alerts/min-stock', { productId, minStock }).then((r) => r.data);

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
export const getBiHeatmap = (params: BiParams) =>
  api.get<HeatmapData>('/bi/heatmap', { params }).then((r) => r.data);

export const getSyncStatus = () => api.get<SyncStatus>('/sync/status').then((r) => r.data);
export const runSync = () => api.post('/sync/run').then((r) => r.data);

export const formatBRL = (v: number | string | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
