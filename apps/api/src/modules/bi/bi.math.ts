/**
 * Funções puras de agregação do BI — sem I/O, para serem testadas
 * diretamente (metodologia Qodo: testes de 1ª classe).
 */

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** aaaa-mm-dd a partir de um Date (fuso local). */
export function toDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface KpiInputs {
  revenue: number;
  salesCount: number;
  stockUnits: number;
  unitsSold: number;
  stockPositions: number;
  outOfStock: number;
  lowStock: number;
  pendingTransfers: number;
}

export interface Kpis extends KpiInputs {
  /** ticket médio = receita / nº de vendas. */
  avgTicket: number;
  /** giro proxy da rede = unidades vendidas / unidades em estoque. */
  turnover: number;
  /** % de posições em ruptura (saldo ≤ 0). */
  rupturaRate: number;
  /** % de posições com estoque baixo (≤ mínimo, mas > 0). */
  lowStockRate: number;
}

/** Deriva os indicadores compostos a partir dos números crus. */
export function deriveKpis(i: KpiInputs): Kpis {
  return {
    ...i,
    avgTicket: i.salesCount > 0 ? round2(i.revenue / i.salesCount) : 0,
    turnover: i.stockUnits > 0 ? round2(i.unitsSold / i.stockUnits) : 0,
    rupturaRate: i.stockPositions > 0 ? round2((i.outOfStock / i.stockPositions) * 100) : 0,
    lowStockRate: i.stockPositions > 0 ? round2((i.lowStock / i.stockPositions) * 100) : 0,
  };
}

export interface DayBucket {
  date: string;
  total: number;
  count: number;
}

/**
 * Agrupa vendas por dia e preenche com zero os dias sem venda, cobrindo a
 * janela [now - (days-1), now]. Determinística: `now` é injetado.
 */
export function bucketSalesByDay(
  sales: { saleDate: Date | string; total: number }[],
  days: number,
  now: Date,
): DayBucket[] {
  const buckets = new Map<string, { total: number; count: number }>();

  // Semeia todos os dias da janela com zero (ordem cronológica).
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets.set(toDayKey(d), { total: 0, count: 0 });
  }

  for (const s of sales) {
    const key = toDayKey(s.saleDate instanceof Date ? s.saleDate : new Date(s.saleDate));
    const b = buckets.get(key);
    if (!b) continue; // fora da janela
    b.total = round2(b.total + s.total);
    b.count += 1;
  }

  return Array.from(buckets.entries()).map(([date, v]) => ({ date, total: v.total, count: v.count }));
}
