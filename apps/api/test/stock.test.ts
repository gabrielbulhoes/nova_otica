import { describe, it, expect } from 'vitest';
import { computeLiveStock } from '../src/modules/stock/stock.service.js';

describe('computeLiveStock', () => {
  it('sem movimentações: disponível = sincronizado', () => {
    expect(computeLiveStock(10, 0, 0)).toEqual({ onHand: 10, availableNow: 10 });
  });

  it('reserva (saída pendente) reduz o disponível, não o onHand', () => {
    expect(computeLiveStock(10, 3, 0)).toEqual({ onHand: 10, availableNow: 7 });
  });

  it('saída confirmada reduz onHand e disponível', () => {
    expect(computeLiveStock(10, 0, -2)).toEqual({ onHand: 8, availableNow: 8 });
  });

  it('entrada confirmada aumenta onHand e disponível', () => {
    expect(computeLiveStock(10, 0, 2)).toEqual({ onHand: 12, availableNow: 12 });
  });

  it('disponível nunca fica negativo', () => {
    expect(computeLiveStock(1, 5, 0)).toEqual({ onHand: 1, availableNow: 0 });
    expect(computeLiveStock(2, 1, -5)).toEqual({ onHand: -3, availableNow: 0 });
  });
});
