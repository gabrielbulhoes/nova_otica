import { describe, it, expect } from 'vitest';
import { bucketSalesByDay, deriveKpis, toDayKey } from '../src/modules/bi/bi.math.js';

describe('deriveKpis', () => {
  it('calcula ticket médio, giro e taxas', () => {
    const k = deriveKpis({
      revenue: 1000,
      salesCount: 4,
      stockUnits: 200,
      unitsSold: 50,
      stockPositions: 10,
      outOfStock: 2,
      lowStock: 3,
      pendingTransfers: 1,
    });
    expect(k.avgTicket).toBe(250);
    expect(k.turnover).toBe(0.25);
    expect(k.rupturaRate).toBe(20);
    expect(k.lowStockRate).toBe(30);
  });

  it('evita divisão por zero', () => {
    const k = deriveKpis({
      revenue: 0,
      salesCount: 0,
      stockUnits: 0,
      unitsSold: 0,
      stockPositions: 0,
      outOfStock: 0,
      lowStock: 0,
      pendingTransfers: 0,
    });
    expect(k.avgTicket).toBe(0);
    expect(k.turnover).toBe(0);
    expect(k.rupturaRate).toBe(0);
    expect(k.lowStockRate).toBe(0);
  });
});

describe('bucketSalesByDay', () => {
  const now = new Date(2024, 5, 15, 10, 0, 0); // 2024-06-15

  it('preenche todos os dias da janela, inclusive os sem venda', () => {
    const points = bucketSalesByDay([], 7, now);
    expect(points).toHaveLength(7);
    expect(points[0].date).toBe('2024-06-09');
    expect(points[6].date).toBe('2024-06-15');
    expect(points.every((p) => p.total === 0 && p.count === 0)).toBe(true);
  });

  it('soma vendas no dia correto e ignora fora da janela', () => {
    const sales = [
      { saleDate: new Date(2024, 5, 15), total: 100 },
      { saleDate: new Date(2024, 5, 15), total: 50.5 },
      { saleDate: new Date(2024, 5, 14), total: 30 },
      { saleDate: new Date(2024, 5, 1), total: 999 }, // fora da janela de 7 dias
    ];
    const points = bucketSalesByDay(sales, 7, now);
    const byDate = Object.fromEntries(points.map((p) => [p.date, p]));
    expect(byDate['2024-06-15']).toEqual({ date: '2024-06-15', total: 150.5, count: 2 });
    expect(byDate['2024-06-14']).toEqual({ date: '2024-06-14', total: 30, count: 1 });
    expect(byDate['2024-06-01']).toBeUndefined();
  });

  it('toDayKey formata data local em aaaa-mm-dd', () => {
    expect(toDayKey(new Date(2024, 0, 5))).toBe('2024-01-05');
  });
});
