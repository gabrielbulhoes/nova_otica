import { describe, it, expect } from 'vitest';
import { abcFromItems, classifyABC, type AbcItem } from '../src/modules/reports/reports.service.js';

describe('classifyABC', () => {
  it('classe A até 80% acumulado', () => {
    expect(classifyABC(10)).toBe('A');
    expect(classifyABC(80)).toBe('A');
  });

  it('classe B entre 80% e 95%', () => {
    expect(classifyABC(80.1)).toBe('B');
    expect(classifyABC(95)).toBe('B');
  });

  it('classe C acima de 95%', () => {
    expect(classifyABC(95.1)).toBe('C');
    expect(classifyABC(100)).toBe('C');
  });
});

describe('abcFromItems (curva ABC genérica: SKU ou marca)', () => {
  const item = (key: string, revenue: number, units = 1): AbcItem => ({
    key, label: key, brand: null, category: null, revenue, units,
  });

  it('ordena por receita, acumula % e resume por classe (ponto médio da faixa)', () => {
    // 80/15/5: pontos médios 40 / 87,5 / 97,5 → A, B, C.
    const r = abcFromItems([item('c', 5), item('a', 80), item('b', 15)], 30, 'brand');
    expect(r.rows.map((x) => x.key)).toEqual(['a', 'b', 'c']);
    expect(r.rows.map((x) => x.class)).toEqual(['A', 'B', 'C']);
    expect(r.totalRevenue).toBe(100);
    expect(r.summary.A).toEqual({ items: 1, revenue: 80 });
    expect(r.summary.B).toEqual({ items: 1, revenue: 15 });
    expect(r.summary.C).toEqual({ items: 1, revenue: 5 });
    expect(r.rows[2].cumulativePct).toBe(100);
    expect(r.dimension).toBe('brand');
  });

  it('descarta itens sem receita e aguenta lista vazia', () => {
    const r = abcFromItems([item('zerado', 0)], 30, 'product');
    expect(r.rows).toEqual([]);
    expect(r.totalRevenue).toBe(0);
    expect(r.summary.A.items).toBe(0);
  });

  it('item dominante (>80% sozinho) é classe A — nunca uma curva sem classe A', () => {
    const r = abcFromItems([item('dominante', 85), item('resto', 15)], 30, 'brand');
    expect(r.rows[0].class).toBe('A');
    expect(r.summary.A.items).toBe(1);
  });

  it('item único é 100% classe A (ponto médio em 50%)', () => {
    const r = abcFromItems([item('unico', 42, 7)], 30, 'product');
    expect(r.rows[0]).toMatchObject({ class: 'A', revenuePct: 100, cumulativePct: 100, units: 7 });
  });
});
