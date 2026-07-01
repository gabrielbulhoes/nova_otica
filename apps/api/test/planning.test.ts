import { describe, it, expect } from 'vitest';
import {
  analyzeProduct,
  buildOverview,
  buildSuggestions,
  paretoSummary,
  type ProductMetricsInput,
} from '../src/modules/planning/planning.math.js';

const base: ProductMetricsInput = {
  productId: 'p',
  description: 'Produto',
  brand: null,
  category: 'Armação',
  unitsSold: 0,
  currentStock: 0,
  unitCost: 100,
  unitPrice: 200,
};

describe('analyzeProduct', () => {
  it('marca item sem vendas e com estoque como LIQUIDATE (capital parado)', () => {
    const p = analyzeProduct({ ...base, unitsSold: 0, currentStock: 10 }, 90);
    expect(p.movementClass).toBe('DEAD');
    expect(p.recommendation).toBe('LIQUIDATE');
    expect(p.coverageDays).toBeNull();
    expect(p.stockValue).toBe(1000);
    expect(p.excessValue).toBe(1000); // alvo é 0 → todo o estoque é excesso
    expect(p.suggestedQty).toBe(0);
  });

  it('recomenda COMPRAR quando abaixo do ponto de reposição', () => {
    // 90 vendas em 90 dias = 1/dia; ROP = 1*(14+7)=21; estoque 5 < 21
    const p = analyzeProduct({ ...base, unitsSold: 90, currentStock: 5 }, 90);
    expect(p.dailyDemand).toBe(1);
    expect(p.recommendation).toBe('BUY');
    expect(p.reorderPoint).toBe(21);
    expect(p.targetStock).toBe(60);
    expect(p.suggestedQty).toBe(55); // 60 - 5
    expect(p.capital).toBe(5500); // 55 * 100
    expect(p.stockoutInDays).toBe(5);
    expect(p.movementClass).toBe('FAST');
  });

  it('recomenda NÃO COMPRAR quando há excesso de cobertura', () => {
    // 9 vendas em 90 dias = 0,1/dia; estoque 20 → 200 dias de cobertura (> 120)
    const p = analyzeProduct({ ...base, unitsSold: 9, currentStock: 20 }, 90);
    expect(p.recommendation).toBe('DONT_BUY');
    expect(p.movementClass).toBe('SLOW');
    expect(p.coverageDays).toBe(200);
  });

  it('mantém (HOLD) quando a cobertura é adequada', () => {
    // 90 vendas em 90 dias = 1/dia; estoque 45 → 45 dias (entre ROP 21 e overstock 120)
    const p = analyzeProduct({ ...base, unitsSold: 90, currentStock: 45 }, 90);
    expect(p.recommendation).toBe('HOLD');
    expect(p.movementClass).toBe('HEALTHY');
  });
});

describe('paretoSummary', () => {
  it('identifica os poucos SKUs que concentram ~80% da receita', () => {
    const plans = [
      analyzeProduct({ ...base, productId: 'a', unitsSold: 400, currentStock: 50, unitPrice: 200 }, 90),
      analyzeProduct({ ...base, productId: 'b', unitsSold: 40, currentStock: 50, unitPrice: 200 }, 90),
      analyzeProduct({ ...base, productId: 'c', unitsSold: 30, currentStock: 50, unitPrice: 200 }, 90),
      analyzeProduct({ ...base, productId: 'd', unitsSold: 30, currentStock: 50, unitPrice: 200 }, 90),
    ];
    const pareto = paretoSummary(plans);
    expect(pareto.totalProducts).toBe(4);
    // 'a' sozinho já passa de 80% da receita
    expect(pareto.classAProducts).toBe(1);
    expect(pareto.classARevenueShare).toBeGreaterThanOrEqual(80);
  });
});

describe('buildOverview', () => {
  it('separa capital saudável, parado e em excesso', () => {
    const plans = [
      analyzeProduct({ ...base, productId: 'dead', unitsSold: 0, currentStock: 10, unitCost: 100 }, 90),
      analyzeProduct({ ...base, productId: 'ok', unitsSold: 90, currentStock: 45, unitCost: 100 }, 90),
    ];
    const ov = buildOverview(plans, 90);
    expect(ov.capital.total).toBe(1000 + 4500);
    expect(ov.capital.parked).toBe(1000);
    expect(ov.capital.healthy).toBeGreaterThan(0);
    expect(ov.movement.dead).toBe(1);
    expect(ov.movement.healthy).toBe(1);
    expect(ov.topIdle[0].productId).toBe('dead');
  });
});

describe('buildSuggestions', () => {
  it('conta recomendações e capital envolvido, ordenando compras primeiro', () => {
    const plans = [
      analyzeProduct({ ...base, productId: 'buy', unitsSold: 90, currentStock: 5, unitCost: 100 }, 90),
      analyzeProduct({ ...base, productId: 'dead', unitsSold: 0, currentStock: 10, unitCost: 100 }, 90),
    ];
    const s = buildSuggestions(plans, 90);
    expect(s.summary.buy).toBe(1);
    expect(s.summary.liquidate).toBe(1);
    expect(s.summary.buyCapital).toBe(5500);
    expect(s.summary.avoidedCapital).toBe(1000);
    expect(s.rows[0].recommendation).toBe('BUY'); // compras vêm primeiro
  });
});
