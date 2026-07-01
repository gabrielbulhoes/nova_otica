import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

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

export interface Movement {
  id: string;
  type: 'TRANSFER' | 'SALE' | 'ADJUSTMENT' | 'RETURN';
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'RECONCILED';
  quantity: number;
  reason: string | null;
  reference: string | null;
  createdAt: string;
  product: { id: string; description: string };
  fromStore: { id: string; name: string } | null;
  toStore: { id: string; name: string } | null;
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

export const getSyncStatus = () => api.get<SyncStatus>('/sync/status').then((r) => r.data);
export const runSync = () => api.post('/sync/run').then((r) => r.data);

export const formatBRL = (v: number | string | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
