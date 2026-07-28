import { describe, it, expect } from 'vitest';
import {
  analyzeProduct,
  buildOverview,
  buildPurchaseOrders,
  buildRebalance,
  buildCommercialStrategy,
  supplierFor,
  storeCarriesBrand,
  buildDecisionCards,
  buildSuggestions,
  decisionConfidence,
  DEFAULT_PLANNING_CONFIG,
  extractBrand,
  forecastDemand,
  isMadeToOrderLens,
  matchesProductGroup,
  isBrandAnalysable,
  carryingCost,
  marginPct,
  expectedMargin,
  buildPriceBands,
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

describe('prazo por fornecedor (lead time)', () => {
  const base = {
    productId: 'p1',
    description: 'Armação X',
    brand: 'Ray-Ban',
    category: 'Armação',
    unitsSold: 90, // 1/dia em 90 dias
    currentStock: 20,
    unitCost: 100,
    unitPrice: 200,
  };

  it('fornecedor mais lento eleva o ponto de reposição e antecipa o pedido', () => {
    const rapido = analyzeProduct(base, 90, { ...DEFAULT_PLANNING_CONFIG, leadTimeDays: 7 });
    const lento = analyzeProduct(base, 90, { ...DEFAULT_PLANNING_CONFIG, leadTimeDays: 30 });
    expect(lento.reorderPoint).toBeGreaterThan(rapido.reorderPoint);
    expect(lento.leadTimeDays).toBe(30);
    // Com 20 un. e 1/dia: rápido (ponto 14) dá ~6 dias de folga; lento (ponto 37) já rompeu o ponto.
    expect(rapido.orderByInDays).toBe(6);
    expect(lento.orderByInDays).toBe(0);
    expect(lento.recommendation).toBe('BUY');
  });

  it('sem giro não tem prazo-limite de pedido', () => {
    const parado = analyzeProduct({ ...base, unitsSold: 0 }, 90);
    expect(parado.orderByInDays).toBeNull();
  });
});

describe('buildRebalance (redistribuição entre lojas)', () => {
  const cfg = { ...DEFAULT_PLANNING_CONFIG, leadTimeDays: 14, safetyDays: 7, targetCoverDays: 60 };
  const mk = (storeId: string, storeName: string, unitsSold: number, currentStock: number) => ({
    storeId,
    storeName,
    productId: 'p1',
    description: 'Armação X',
    brand: 'Ray-Ban',
    unitsSold,
    currentStock,
  });

  it('sugere transferir de onde está parado para onde vende e falta', () => {
    const plan = buildRebalance(
      [mk('a', 'Loja A', 90, 3), mk('b', 'Loja B', 0, 18)], // A vende 1/dia com 3 un.; B parada com 18
      90,
      () => cfg,
    );
    expect(plan.rows).toHaveLength(1);
    const s = plan.rows[0];
    expect(s.fromStoreId).toBe('b');
    expect(s.toStoreId).toBe('a');
    // necessidade de A: alvo 60 un. − 3 em estoque = 57; B só tem 18 → transfere 18.
    expect(s.quantity).toBe(18);
    expect(s.stockoutInDays).toBe(3);
    expect(plan.summary.storesInvolved).toBe(2);
  });

  it('doadora com giro preserva a própria cobertura-alvo', () => {
    // B vende 0,1/dia (alvo 6 un.) e tem 30 → pode doar 24.
    const plan = buildRebalance([mk('a', 'Loja A', 90, 3), mk('b', 'Loja B', 9, 30)], 90, () => cfg);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].quantity).toBe(24);
  });

  it('não sugere nada quando o estoque está equilibrado', () => {
    const plan = buildRebalance([mk('a', 'Loja A', 30, 25), mk('b', 'Loja B', 30, 25)], 90, () => cfg);
    expect(plan.rows).toHaveLength(0);
  });

  it('não transfere para loja sem vendas', () => {
    const plan = buildRebalance([mk('a', 'Loja A', 0, 0), mk('b', 'Loja B', 0, 18)], 90, () => cfg);
    expect(plan.rows).toHaveLength(0);
  });
});

describe('buildPurchaseOrders (pedidos por fornecedor)', () => {
  const mkPlan = (brand: string | null, leadTimeDays: number, unitsSold: number, currentStock: number, unitCost = 100) =>
    analyzeProduct(
      {
        productId: `p-${brand}-${unitsSold}-${currentStock}`,
        description: `Produto ${brand ?? 's/ marca'}`,
        brand,
        category: 'Armação',
        unitsSold,
        currentStock,
        unitCost,
        unitPrice: unitCost * 2,
      },
      90,
      { ...DEFAULT_PLANNING_CONFIG, leadTimeDays },
    );

  it('agrupa itens BUY por fornecedor com total e data-limite do mais urgente', () => {
    const plans = [
      mkPlan('Ray-Ban', 30, 90, 20), // 1/dia, ponto 37 → BUY, pedir hoje (0d)
      mkPlan('Ray-Ban', 30, 45, 25), // 0,5/dia, ponto 18,5 → HOLD? cobertura 50d ≤ alvo... currentStock 25 > 18.5 → HOLD
      mkPlan('Ray-Ban', 30, 90, 30), // 1/dia, ponto 37 → BUY, 0d
      mkPlan('Oakley', 7, 90, 20), // 1/dia, ponto 14 → folga 6d → BUY? 20 > 14 → HOLD
      mkPlan('Oakley', 7, 90, 10), // 1/dia, ponto 14 → BUY, 0d
    ];
    const po = buildPurchaseOrders(plans, 90);
    expect(po.summary.suppliers).toBe(2);
    const rayban = po.orders.find((o) => o.supplier === 'Ray-Ban')!;
    expect(rayban.items).toHaveLength(2);
    expect(rayban.leadTimeDays).toBe(30);
    expect(rayban.orderByInDays).toBe(0);
    // total = soma dos capitais dos itens
    expect(rayban.total).toBe(rayban.items.reduce((s, i) => s + i.total, 0));
    expect(po.summary.total).toBe(po.orders.reduce((s, o) => s + o.total, 0));
  });

  it('ignora itens que não são BUY e usa "Sem fornecedor" para brand null', () => {
    const plans = [
      mkPlan(null, 14, 90, 5), // BUY sem fornecedor
      mkPlan('Hoya', 14, 0, 10), // LIQUIDATE — fora do pedido
    ];
    const po = buildPurchaseOrders(plans, 90);
    expect(po.orders).toHaveLength(1);
    expect(po.orders[0].supplier).toBe('Sem fornecedor');
  });

  it('ordena fornecedores pela ruptura mais próxima (itens BUY já estão no ponto)', () => {
    const plans = [
      mkPlan('Oakley', 7, 90, 12), // 1/dia, ponto 14 → BUY, ruptura em ~12d
      mkPlan('Ray-Ban', 30, 90, 4), // 1/dia, ponto 37 → BUY, ruptura em ~4d — mais urgente
    ];
    const po = buildPurchaseOrders(plans, 90);
    expect(po.orders.map((o) => o.supplier)).toEqual(['Ray-Ban', 'Oakley']);
    expect(po.orders[0].stockoutInDays).toBe(4);
    // BUY implica estar no/abaixo do ponto de reposição → prazo-limite é hoje.
    expect(po.orders.every((o) => o.orderByInDays === 0)).toBe(true);
  });
});

describe('posição de estoque com pedidos a caminho (onOrderQty)', () => {
  const item = {
    productId: 'p1',
    description: 'Armação X',
    brand: 'Ray-Ban',
    category: 'Armação',
    unitsSold: 90, // 1/dia
    currentStock: 5, // abaixo do ponto (21)
    unitCost: 100,
    unitPrice: 200,
  };

  it('pedido em trânsito cobre a reposição e evita comprar duas vezes', () => {
    const sem = analyzeProduct(item, 90);
    expect(sem.recommendation).toBe('BUY');
    expect(sem.suggestedQty).toBe(55); // alvo 60 − 5

    const com = analyzeProduct({ ...item, onOrderQty: 55 }, 90);
    expect(com.recommendation).toBe('HOLD');
    expect(com.suggestedQty).toBe(0);
    expect(com.onOrderQty).toBe(55);
    expect(com.reason).toContain('a caminho');
  });

  it('pedido parcial reduz a quantidade sugerida', () => {
    const parcial = analyzeProduct({ ...item, onOrderQty: 10 }, 90); // posição 15 ≤ 21 → ainda BUY
    expect(parcial.recommendation).toBe('BUY');
    expect(parcial.suggestedQty).toBe(45); // alvo 60 − posição 15
  });
});

describe('forecastDemand (suavização + sazonalidade)', () => {
  const flat12 = (units: number) => Array.from({ length: 12 }, (_, i) => ({ month: i + 1, units }));

  it('sem janela anterior usa a taxa recente (média)', () => {
    const f = forecastDemand(
      { recentUnits: 30, recentDays: 30, priorUnits: 0, priorDays: 0, monthlyHistory: [], currentMonth: 6 },
      14,
    );
    expect(f.dailyDemand).toBe(1);
    expect(f.method).toBe('media');
    expect(f.seasonalIndex).toBe(1);
  });

  it('produto acelerando pesa mais a janela recente (tendência)', () => {
    // recente: 2/dia; anterior: 1/dia → base 0,65*2 + 0,35*1 = 1,65
    const f = forecastDemand(
      { recentUnits: 60, recentDays: 30, priorUnits: 60, priorDays: 60, monthlyHistory: [], currentMonth: 6 },
      14,
    );
    expect(f.baseDaily).toBe(1.65);
    expect(f.method).toBe('tendencia');
  });

  it('aplica índice sazonal do mês de CHEGADA do pedido (lead time)', () => {
    // histórico: dezembro vende 2x a média; hoje é novembro, lead 30d → alvo dezembro
    const history = flat12(10).map((b) => (b.month === 12 ? { ...b, units: 21 } : b));
    const f = forecastDemand(
      { recentUnits: 30, recentDays: 30, priorUnits: 60, priorDays: 60, monthlyHistory: history, currentMonth: 11 },
      30,
    );
    expect(f.targetMonth).toBe(12);
    expect(f.seasonalIndex).toBeGreaterThan(1.5);
    expect(f.method).toBe('sazonal');
    expect(f.dailyDemand).toBeGreaterThan(f.baseDaily);
  });

  it('degrada para índice 1 com histórico insuficiente (poucos meses ou pouco volume)', () => {
    const poucosMeses = flat12(10).slice(0, 4);
    const f1 = forecastDemand(
      { recentUnits: 30, recentDays: 30, priorUnits: 0, priorDays: 0, monthlyHistory: poucosMeses, currentMonth: 1 },
      14,
    );
    expect(f1.seasonalIndex).toBe(1);
    const poucoVolume = flat12(1); // 12 meses mas só 12 unidades
    const f2 = forecastDemand(
      { recentUnits: 30, recentDays: 30, priorUnits: 0, priorDays: 0, monthlyHistory: poucoVolume, currentMonth: 1 },
      14,
    );
    expect(f2.seasonalIndex).toBe(1);
  });

  it('índice sazonal é limitado (clamp) contra outliers', () => {
    const history = flat12(10).map((b) => (b.month === 7 ? { ...b, units: 500 } : b));
    const f = forecastDemand(
      { recentUnits: 90, recentDays: 30, priorUnits: 0, priorDays: 0, monthlyHistory: history, currentMonth: 6 },
      30,
    );
    expect(f.seasonalIndex).toBeLessThanOrEqual(2);
  });

  it('analyzeProduct usa a previsão no ponto de reposição', () => {
    // média simples seria 1/dia; previsão sazonal dobra → ROP dobra
    const history = {
      recentUnits: 30, recentDays: 30, priorUnits: 60, priorDays: 60,
      monthlyHistory: flat12(10).map((b) => (b.month === 12 ? { ...b, units: 20 } : b)),
      currentMonth: 11,
    };
    const semForecast = analyzeProduct({ ...base, unitsSold: 90, currentStock: 30 }, 90);
    const comForecast = analyzeProduct({ ...base, unitsSold: 90, currentStock: 30, demandHistory: history }, 90, {
      ...DEFAULT_PLANNING_CONFIG,
      leadTimeDays: 30,
    });
    expect(comForecast.forecast?.method).toBe('sazonal');
    expect(comForecast.reorderPoint).toBeGreaterThan(semForecast.reorderPoint);
  });
});

describe('matchesProductGroup (recortes de cobertura)', () => {
  it('cobertura principal = óculos + óculos de grau/armações + relógios', () => {
    for (const cat of ['Óculos de Sol', 'OCULOS SOLAR', 'Armação', 'ARMACAO RX', 'Óculos de Grau', 'Relógio', 'RELOGIO']) {
      expect(matchesProductGroup(cat, 'principal')).toBe(true);
    }
    for (const cat of ['Lente', 'LENTE PRONTA', 'Estojo', 'Acessório', null]) {
      expect(matchesProductGroup(cat, 'principal')).toBe(false);
    }
  });

  it('lentes isola qualquer categoria com "lente" — inclusive lente de grau', () => {
    for (const cat of ['Lente', 'LENTES PRONTAS', 'Lente de contato', 'LENTE DE GRAU']) {
      expect(matchesProductGroup(cat, 'lentes')).toBe(true);
    }
    expect(matchesProductGroup('Óculos de Grau', 'lentes')).toBe(false);
    expect(matchesProductGroup('Armação', 'lentes')).toBe(false);
  });

  it('"lente" nunca vaza para o principal, mesmo citando grau', () => {
    expect(matchesProductGroup('LENTE DE GRAU', 'principal')).toBe(false);
  });

  it('consolidado aceita tudo, inclusive sem categoria', () => {
    for (const cat of ['Estojo', 'Acessório', 'Lente', 'Relógio', null, undefined]) {
      expect(matchesProductGroup(cat, 'todos')).toBe(true);
    }
  });
});

describe('isBrandAnalysable (recorte da análise de marca)', () => {
  it('produto de moda entra na análise de marca', () => {
    expect(isBrandAnalysable('OCULOS')).toBe(true);
    expect(isBrandAnalysable('ARMACAO')).toBe(true);
    expect(isBrandAnalysable('RELOGIO')).toBe(true);
  });

  it('lente e tratamento NÃO entram — decisão do cliente (módulo próprio)', () => {
    // Zeiss é fornecedor de lente: não deve aparecer como marca na análise.
    expect(isBrandAnalysable('LENTES')).toBe(false);
    expect(isBrandAnalysable('LENTES PRONTAS')).toBe(false);
    expect(isBrandAnalysable('LENTES DE CONTATO PEDIDO')).toBe(false);
    expect(isBrandAnalysable('TRATAMENTO')).toBe(false);
  });

  it('acessório também fica fora', () => {
    expect(isBrandAnalysable('PORTA OCULOS')).toBe(false);
    expect(isBrandAnalysable('ACESSORIOS')).toBe(false);
    expect(isBrandAnalysable(null)).toBe(false);
  });
});

describe('economia da decisão (custo de carregar, margem e faixas)', () => {
  it('custo de carregamento: R$ 100k parados por 30 dias a 25%/ano', () => {
    expect(carryingCost(100_000, 30)).toBeCloseTo(2054.79, 1);
    // proporcional ao tempo: 90 dias custa 3x o de 30
    expect(carryingCost(100_000, 90)).toBeCloseTo(carryingCost(100_000, 30) * 3, 0);
  });

  it('custo de carregamento é 0 sem capital ou sem tempo', () => {
    expect(carryingCost(0, 30)).toBe(0);
    expect(carryingCost(-500, 30)).toBe(0);
    expect(carryingCost(100_000, 0)).toBe(0);
  });

  it('respeita a taxa configurada', () => {
    const caro = { ...DEFAULT_PLANNING_CONFIG, carryingCostAnnualPct: 50 };
    expect(carryingCost(100_000, 30, caro)).toBeCloseTo(carryingCost(100_000, 30) * 2, 0);
  });

  it('margem em % do preço e margem esperada em R$', () => {
    expect(marginPct(200, 80)).toBe(60);
    expect(marginPct(0, 80)).toBe(0); // preço inválido não quebra
    expect(expectedMargin(10, 200, 80)).toBe(1200);
    expect(expectedMargin(0, 200, 80)).toBe(0);
  });

  it('faixas de preço saem dos preços OBSERVADOS, por quartil', () => {
    const precos = [300, 400, 500, 700, 800, 1000, 1500, 2000, 2600, 3000, 4000, 4600];
    const bands = buildPriceBands(precos);
    expect(bands).toHaveLength(4);
    expect(bands.map((b) => b.key)).toEqual(['acessivel', 'premium_acessivel', 'premium', 'luxo']);
    expect(bands[0].min).toBe(300);
    expect(bands[3].max).toBe(4600);
    // as faixas cobrem todos os SKUs observados, sem sobreposição
    expect(bands.reduce((a, b) => a + b.count, 0)).toBe(precos.length);
    for (let i = 1; i < bands.length; i++) expect(bands[i].min).toBeGreaterThanOrEqual(bands[i - 1].max);
  });

  it('faixas ignoram preço inválido e devolvem vazio sem dado', () => {
    expect(buildPriceBands([])).toEqual([]);
    expect(buildPriceBands([0, -10, NaN])).toEqual([]);
  });

  it('cada plano carrega o custo de carregar e a margem', () => {
    // 90 vendidas/90d = 1/dia, estoque 5 -> compra sugerida; custo 100, preço 200
    const p = analyzeProduct({ ...base, unitsSold: 90, currentStock: 5 }, 90);
    expect(p.marginPct).toBe(50);
    expect(p.expectedMargin).toBe(p.suggestedQty * 100);
    expect(p.carryingCost30d).toBeCloseTo(carryingCost(p.stockValue, 30), 2);
    // item parado: o excesso é todo o estoque, logo os dois custos batem
    const parado = analyzeProduct({ ...base, unitsSold: 0, currentStock: 10 }, 90);
    expect(parado.excessCarryingCost30d).toBe(parado.carryingCost30d);
    expect(parado.expectedMargin).toBe(0); // não se compra o que está parado
  });
});

describe('matchesProductGroup · acessórios que citam "óculos"', () => {
  it('PORTA OCULOS é acessório, não entra no recorte principal', () => {
    expect(matchesProductGroup('PORTA OCULOS', 'principal')).toBe(false);
    expect(matchesProductGroup('PORTA OCULOS', 'lentes')).toBe(false);
    expect(matchesProductGroup('PORTA OCULOS', 'todos')).toBe(true);
    expect(matchesProductGroup('ESTOJO PARA OCULOS', 'principal')).toBe(false);
    expect(matchesProductGroup('CORDAO DE OCULOS', 'principal')).toBe(false);
  });

  it('produto de moda de verdade segue no principal', () => {
    expect(matchesProductGroup('OCULOS', 'principal')).toBe(true);
    expect(matchesProductGroup('ARMACAO', 'principal')).toBe(true);
    expect(matchesProductGroup('RELOGIO', 'principal')).toBe(true);
  });
});

describe('extractBrand (marca a partir da descrição)', () => {
  it('pula a categoria e pega a marca (1 palavra)', () => {
    expect(extractBrand('Armação Oakley Preto')).toBe('Oakley');
    expect(extractBrand('Óculos de Sol Bulget Azul')).toBe('Bulget');
  });

  it('reconhece marcas de 2 palavras', () => {
    expect(extractBrand('Armação Ray-Ban RB1234 Preto')).toBe('Ray-Ban');
    expect(extractBrand('Óculos Chilli Beans Vermelho')).toBe('Chilli Beans');
  });

  it('para no código de modelo e na cor', () => {
    expect(extractBrand('Lente Hoya 1.67')).toBe('Hoya');
    expect(extractBrand('Armação Atitude Dourado AT2020')).toBe('Atitude');
  });

  it('retorna null quando não há marca discernível', () => {
    expect(extractBrand('')).toBeNull();
    expect(extractBrand(null)).toBeNull();
    expect(extractBrand(undefined)).toBeNull();
    expect(extractBrand('Óculos de Sol')).toBeNull();
  });

  // ─── Regressão: grife só existe em produto de moda ────────────────────────
  it('em LENTE devolve null — a descrição é a linha, não a marca', () => {
    // Sem o recorte, estes viravam pseudo-marcas distintas do mesmo fabricante.
    expect(extractBrand('MULTIGRESSIV MONOFOCAIS B.I.G. NORM 1,50', 'LENTES')).toBeNull();
    expect(extractBrand('HILUX LENTES PRONTAS ESFERICAS 1.56', 'LENTES PRONTAS')).toBeNull();
    expect(extractBrand('IMPRESSION B.I.G. NORM 1,67 LAYR', 'LENTES VISAO SIMPLES')).toBeNull();
  });

  it('em tratamento/serviço também devolve null', () => {
    expect(extractBrand('ZEISS ANTIRREFLEXO X-TRA CLEAN', 'TRATAMENTO')).toBeNull();
    expect(extractBrand('ZEISS COLORACAO', 'TRATAMENTO')).toBeNull();
  });

  it('em óculos/armação/relógio segue extraindo a grife', () => {
    expect(extractBrand('RB3548NL 001 54 OCULOS RAY BAN', 'OCULOS')).toBe('RAY BAN');
    expect(extractBrand('MU05VV 11Q1O1 55 ARMACAO MIU MIU', 'ARMACAO')).toBe('MIU MIU');
    expect(extractBrand('2035NCO/0M RELOGIO TECHNOS', 'RELOGIO')).toBe('TECHNOS');
  });

  it('sem categoria informada mantém o comportamento antigo', () => {
    expect(extractBrand('RB3548NL 001 54 OCULOS RAY BAN')).toBe('RAY BAN');
    expect(extractBrand('MULTIGRESSIV MONOFOCAIS B.I.G.')).toBe('MULTIGRESSIV MONOFOCAIS');
  });
});

describe('isMadeToOrderLens (lente por encomenda)', () => {
  it('lente ambígua sem saldo e sem venda = por encomenda', () => {
    expect(isMadeToOrderLens('Lente', 0)).toBe(true);
    expect(isMadeToOrderLens('LENTE DE GRAU', -3)).toBe(true);
  });

  it('lente com saldo de rede NÃO é por encomenda', () => {
    expect(isMadeToOrderLens('Lente', 5)).toBe(false);
  });

  it('categoria que não é lente nunca é por encomenda, mesmo com saldo 0', () => {
    expect(isMadeToOrderLens('Armação', 0)).toBe(false);
    expect(isMadeToOrderLens('Óculos de Sol', 0)).toBe(false);
    expect(isMadeToOrderLens(null, 0)).toBe(false);
  });

  // ─── Regressão: o alerta de ruptura sumia quando mais importava ───────────
  it('a CATEGORIA manda: …PEDIDO é encomenda mesmo com saldo', () => {
    expect(isMadeToOrderLens('LENTES DE CONTATO PEDIDO', 40)).toBe(true);
    expect(isMadeToOrderLens('LENTES SOB ENCOMENDA', 10)).toBe(true);
  });

  it('lente PRONTA/ESTOQUE que zerou na rede é RUPTURA, não encomenda', () => {
    // Era o bug: saldo 0 numa lente de prateleira suprimia o alerta OUT.
    expect(isMadeToOrderLens('LENTES PRONTAS', 0)).toBe(false);
    expect(isMadeToOrderLens('LENTE PRONTA', 0)).toBe(false);
    expect(isMadeToOrderLens('LENTES PRONTAS ESTOQUE', 0)).toBe(false);
    expect(isMadeToOrderLens('LENTES DE CONTATO ESTOQUE', 0)).toBe(false);
  });

  it('categoria ambígua que JÁ VENDEU e zerou é ruptura, não encomenda', () => {
    expect(isMadeToOrderLens('LENTES GRIFES', 0, 12)).toBe(false);
    expect(isMadeToOrderLens('LENTES VISAO SIMPLES', 0, 1)).toBe(false);
    // sem venda nenhuma, segue como encomenda
    expect(isMadeToOrderLens('LENTES GRIFES', 0, 0)).toBe(true);
  });
});

describe('decisionConfidence (confiabilidade 0–100)', () => {
  it('fica sempre no intervalo [30, 97]', () => {
    expect(decisionConfidence(0, 0, false, null)).toBeGreaterThanOrEqual(30);
    expect(decisionConfidence(1000, 365, true, 'sazonal')).toBeLessThanOrEqual(97);
  });

  it('mais vendas e mais histórico = mais confiança', () => {
    const pouca = decisionConfidence(2, 30, true, 'media');
    const muita = decisionConfidence(60, 180, true, 'media');
    expect(muita).toBeGreaterThan(pouca);
  });

  it('previsão sazonal soma bônus sobre a média simples', () => {
    const media = decisionConfidence(20, 120, true, 'media');
    const sazonal = decisionConfidence(20, 120, true, 'sazonal');
    expect(sazonal).toBeGreaterThan(media);
  });

  it('sem giro, a certeza de "parado" cresce com o tempo observado', () => {
    const recente = decisionConfidence(0, 10, false, null);
    const antigo = decisionConfidence(0, 180, false, null);
    expect(antigo).toBeGreaterThan(recente);
  });
});

describe('analyzeProduct expõe explicação amigável e confiança', () => {
  it('todo plano traz friendlyReason e confidence', () => {
    const plan = analyzeProduct(
      { ...base, description: 'Armação Oakley Preto', unitsSold: 40, currentStock: 3 },
      90,
      DEFAULT_PLANNING_CONFIG,
    );
    expect(typeof plan.friendlyReason).toBe('string');
    expect(plan.friendlyReason.length).toBeGreaterThan(0);
    expect(plan.confidence).toBeGreaterThanOrEqual(30);
    expect(plan.confidence).toBeLessThanOrEqual(97);
  });
});

describe('buildDecisionCards (portal de decisões — cards)', () => {
  const buy = analyzeProduct(
    { ...base, productId: 'buy1', description: 'Armação Oakley Preto', brand: 'Oakley', unitsSold: 60, currentStock: 2 },
    90, DEFAULT_PLANNING_CONFIG,
  );
  const liq = analyzeProduct(
    { ...base, productId: 'liq1', description: 'Óculos Bulget Azul', brand: 'Bulget', unitsSold: 0, currentStock: 10 },
    90, DEFAULT_PLANNING_CONFIG,
  );
  const hold = analyzeProduct(
    { ...base, productId: 'hold1', description: 'Armação Atitude', brand: 'Atitude', unitsSold: 6, currentStock: 20 },
    90, DEFAULT_PLANNING_CONFIG,
  );
  const reb = buildRebalance(
    [
      { storeId: 'A', storeName: 'Nova Ótica — São Paulo', productId: 'x', description: 'Armação Ray-Ban', brand: 'Ray-Ban', unitsSold: 30, currentStock: 0 },
      { storeId: 'B', storeName: 'Nova Ótica — Campinas', productId: 'x', description: 'Armação Ray-Ban', brand: 'Ray-Ban', unitsSold: 0, currentStock: 20 },
    ],
    90, () => DEFAULT_PLANNING_CONFIG,
  );

  it('gera cards de compra, liquidação e remanejamento; ignora HOLD/DONT_BUY', () => {
    const { cards, summary } = buildDecisionCards([buy, liq, hold], reb.rows);
    const types = cards.map((c) => c.type);
    expect(types).toContain('COMPRA');
    expect(types).toContain('LIQUIDACAO');
    expect(types).toContain('REMANEJAMENTO');
    // HOLD não vira card
    expect(cards.some((c) => c.productId === 'hold1')).toBe(false);
    expect(summary.total).toBe(cards.length);
    expect(summary.byType.compra + summary.byType.remanejamento + summary.byType.liquidacao).toBe(summary.total);
  });

  it('todo card tem id "#", prioridade válida, confiança 0–100 e explicação', () => {
    const { cards } = buildDecisionCards([buy, liq], reb.rows);
    for (const c of cards) {
      expect(c.id.startsWith('#')).toBe(true);
      expect(['ALTA', 'MEDIA', 'BAIXA']).toContain(c.priority);
      expect(c.confidence).toBeGreaterThanOrEqual(0);
      expect(c.confidence).toBeLessThanOrEqual(100);
      expect(typeof c.reason).toBe('string');
      expect(c.reason.length).toBeGreaterThan(0);
    }
  });

  it('ordena por prioridade (ALTA antes de BAIXA)', () => {
    const { cards } = buildDecisionCards([buy, liq], reb.rows);
    const rank = { ALTA: 0, MEDIA: 1, BAIXA: 2 } as const;
    const ranks = cards.map((c) => rank[c.priority]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('compra traz custo do pedido; liquidação traz capital a liberar', () => {
    const { cards } = buildDecisionCards([buy, liq], []);
    const compra = cards.find((c) => c.type === 'COMPRA')!;
    const liquid = cards.find((c) => c.type === 'LIQUIDACAO')!;
    expect(compra.impact).toBeGreaterThan(0);
    expect(compra.impactLabel).toMatch(/pedido/i);
    expect(liquid.impact).toBeGreaterThan(0);
    expect(liquid.impactLabel).toMatch(/liberar/i);
  });
});

describe('buildCommercialStrategy (motor piso · risco · janela)', () => {
  // Rede vendendo ~2/dia no total (dois produtos a 90 un./90 dias).
  const plans = [
    analyzeProduct({ ...base, productId: 's1', unitsSold: 90, currentStock: 30 }, 90, DEFAULT_PLANNING_CONFIG),
    analyzeProduct({ ...base, productId: 's2', unitsSold: 90, currentStock: 30 }, 90, DEFAULT_PLANNING_CONFIG),
  ];

  it('capacidade = demanda diária da rede × janela (meses × 30)', () => {
    const st = buildCommercialStrategy(plans, { floorUnits: 300, windowMonths: 9, risk: 'equilibrado' });
    // 2/dia × 270 dias = 540
    expect(st.capacity).toBe(540);
    expect(st.viable).toBe(true); // 300 <= 540
    expect(st.capacityUsedPct).toBeCloseTo((300 / 540) * 100, 1);
    expect(st.withoutBacking).toBe(0);
  });

  it('segmentos somam exatamente o piso e variam com o risco', () => {
    for (const risk of ['conservador', 'equilibrado', 'agressivo'] as const) {
      const st = buildCommercialStrategy(plans, { floorUnits: 1000, windowMonths: 9, risk });
      const soma = st.segments.reduce((a, x) => a + x.units, 0);
      expect(soma).toBe(1000);
    }
    const cons = buildCommercialStrategy(plans, { floorUnits: 1000, windowMonths: 9, risk: 'conservador' });
    const agr = buildCommercialStrategy(plans, { floorUnits: 1000, windowMonths: 9, risk: 'agressivo' });
    const bs = (x: typeof cons) => x.segments.find((s) => s.key === 'best-seller')!.units;
    const ap = (x: typeof cons) => x.segments.find((s) => s.key === 'aposta')!.units;
    expect(bs(cons)).toBeGreaterThan(bs(agr)); // conservador reforça best-seller
    expect(ap(agr)).toBeGreaterThan(ap(cons)); // agressivo aposta mais
  });

  it('piso acima da capacidade fica sem lastro e não é viável', () => {
    const st = buildCommercialStrategy(plans, { floorUnits: 800, windowMonths: 9, risk: 'equilibrado' });
    expect(st.viable).toBe(false); // 800 > 540
    expect(st.withoutBacking).toBe(260); // 800 - 540
    expect(st.verdict).toMatch(/sem lastro|passa a capacidade/i);
  });

  it('com lastro = best-seller + lançamento (aposta é especulação)', () => {
    const st = buildCommercialStrategy(plans, { floorUnits: 1000, windowMonths: 9, risk: 'equilibrado' });
    const bs = st.segments.find((s) => s.key === 'best-seller')!.units;
    const lanc = st.segments.find((s) => s.key === 'lancamento')!.units;
    expect(st.backedPct).toBeCloseTo(((bs + lanc) / 1000) * 100, 1);
  });
});

describe('catálogo de marcas (fornecedor + mix por loja)', () => {
  const catalog = {
    supplierByBrand: { GUCCI: 'Kering', DIOR: 'Marcolin', 'RAY BAN': 'Luxottica' },
    premiumStores: {
      GUCCI: ['A GRACIOSA IGUATEMI', 'GRAND OPTICAL PETROPOLIS'],
      DIOR: ['A GRACIOSA NATAL SHOPPING'],
    },
  };

  it('supplierFor resolve fornecedor canônico (case/acentos)', () => {
    expect(supplierFor('Gucci', catalog)).toBe('Kering');
    expect(supplierFor('DIOR', catalog)).toBe('Marcolin');
    expect(supplierFor('Marca Inexistente', catalog)).toBeNull();
    expect(supplierFor('Gucci', null)).toBeNull();
  });

  it('grife premium só é trabalhada nas lojas listadas', () => {
    expect(storeCarriesBrand('Gucci', 'A Graciosa Iguatemi', catalog)).toBe(true);
    expect(storeCarriesBrand('Gucci', 'Oticalli Midway Mall', catalog)).toBe(false);
    // casamento tolerante ao nome vindo do ERP
    expect(storeCarriesBrand('Gucci', 'Grand Optical Petropolis - RJ', catalog)).toBe(true);
  });

  it('marca fora do catálogo (corrente) vale para todas as lojas', () => {
    expect(storeCarriesBrand('Chilli Beans', 'Qualquer Loja', catalog)).toBe(true);
    expect(storeCarriesBrand('Ray Ban', 'Qualquer Loja', catalog)).toBe(true); // tem fornecedor mas não é premium
  });

  it('sem catálogo, nada é restrito', () => {
    expect(storeCarriesBrand('Gucci', 'Oticalli Midway Mall', null)).toBe(true);
  });

  it('buildPurchaseOrders agrupa pelo fornecedor canônico quando há resolver', () => {
    const p1 = analyzeProduct({ ...base, productId: 'g1', description: 'Óculos Gucci GG0011 Preto', brand: 'Kering', unitsSold: 90, currentStock: 2 }, 90);
    const p2 = analyzeProduct({ ...base, productId: 'd1', description: 'Armação Dior CD1234', brand: 'Marcolin', unitsSold: 90, currentStock: 2 }, 90);
    const resolve = (p: typeof p1) => supplierFor(extractBrand(p.description), catalog);
    const po = buildPurchaseOrders([p1, p2], 90, resolve);
    expect(po.orders.map((o) => o.supplier).sort()).toEqual(['Kering', 'Marcolin']);
  });
});
