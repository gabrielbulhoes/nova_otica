import { describe, it, expect } from 'vitest';
import { computeOrderTotals, lineTotal } from '../src/modules/commerce/commerce.math.js';

describe('commerce math', () => {
  it('lineTotal multiplica e arredonda', () => {
    expect(lineTotal(199.9, 2)).toBe(399.8);
    expect(lineTotal(33.333, 3)).toBe(100);
  });

  it('computeOrderTotals soma as linhas', () => {
    const t = computeOrderTotals([
      { unitPrice: 100, quantity: 2 },
      { unitPrice: 50.5, quantity: 1 },
    ]);
    expect(t).toEqual({ subtotal: 250.5, total: 250.5 });
  });

  it('carrinho vazio soma zero', () => {
    expect(computeOrderTotals([])).toEqual({ subtotal: 0, total: 0 });
  });
});
