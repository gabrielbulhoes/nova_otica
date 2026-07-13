import { env } from '../../config/env.js';
import { listStock } from '../stock/stock.service.js';

export type AlertLevel = 'OUT' | 'LOW';

export interface StockAlert {
  level: AlertLevel;
  storeId: string;
  storeName: string;
  productId: string;
  description: string;
  brand: string | null;
  category: string | null;
  availableNow: number;
  threshold: number;
}

/**
 * Resolve o limiar de estoque mínimo de uma posição (loja × produto):
 * mínimo da loja > mínimo do produto > padrão da rede. Puro, testável.
 */
export function resolveThreshold(
  storeMin: number | null | undefined,
  productMin: number | null | undefined,
  networkDefault: number,
): number {
  return storeMin ?? productMin ?? networkDefault;
}

/**
 * Gera alertas de ruptura (OUT, saldo <= 0) e estoque baixo (LOW, saldo <=
 * mínimo). O mínimo é o da loja, senão o do produto, senão o padrão da rede.
 */
export async function stockAlerts(storeId?: string): Promise<{
  total: number;
  out: number;
  low: number;
  rows: StockAlert[];
}> {
  const { rows } = await listStock({ storeId, limit: 100_000, skip: 0 });
  const def = env.DEFAULT_MIN_STOCK;

  const alerts: StockAlert[] = [];
  for (const r of rows) {
    const threshold = resolveThreshold(r.storeMinStock, r.minStock, def);
    if (r.availableNow > threshold) continue;
    alerts.push({
      level: r.availableNow <= 0 ? 'OUT' : 'LOW',
      storeId: r.storeId,
      storeName: r.storeName,
      productId: r.productId,
      description: r.description,
      brand: r.brand,
      category: r.category,
      availableNow: r.availableNow,
      threshold,
    });
  }

  alerts.sort((a, b) => a.availableNow - b.availableNow);
  return {
    total: alerts.length,
    out: alerts.filter((a) => a.level === 'OUT').length,
    low: alerts.filter((a) => a.level === 'LOW').length,
    rows: alerts,
  };
}
