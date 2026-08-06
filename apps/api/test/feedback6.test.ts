import { describe, expect, it } from 'vitest';
import {
  analyzeProduct,
  buildDecisionCards,
  decisionPriority,
  DEFAULT_PLANNING_CONFIG,
  DEFAULT_PRIORITY_CONFIG,
  type ProductMetricsInput,
  type ProductPlan,
  type RebalanceSuggestion,
} from '../src/modules/planning/planning.math.js';

/**
 * Feedback 6.0 — "Equipe na prática". Seis pontos vindos de quem opera a rede,
 * quatro deles sobre a mesma coisa: o motor julgava peças com uma janela de
 * análise e nada mais.
 *
 * Cada teste aqui nomeia o ponto do feedback que o originou. Não é decoração:
 * quando alguém for afrouxar um destes limites daqui a seis meses, precisa
 * saber que do outro lado tem uma pessoa que viu o defeito na tela.
 */

const JANELA = 90;

function peca(over: Partial<ProductMetricsInput> = {}): ProductMetricsInput {
  return {
    productId: 'p1',
    description: 'RB2140 901 54 OCULOS RAY BAN',
    brand: null,
    category: 'OCULOS DE SOL',
    unitsSold: 0,
    currentStock: 4,
    unitCost: 400,
    unitPrice: 800,
    onOrderQty: 0,
    ...over,
  };
}

describe('item 02 · liquidação de peça nova e de best-seller sazonal', () => {
  it('peça cadastrada há 10 dias NÃO entra em liquidação', () => {
    // O caso literal do feedback: "incluindo na sugestão de promoção peças que
    // chegaram a 10 dias nas lojas".
    const r = analyzeProduct(peca({ ageDays: 10, annualUnitsSold: 0 }), JANELA);
    expect(r.recommendation).not.toBe('LIQUIDATE');
    expect(r.recommendation).toBe('HOLD');
    expect(r.movementClass).toBe('NEW');
    expect(r.reason).toContain('10 dias');
  });

  it('e a classe de giro dela não é "parada" — é uma etiqueta de tela', () => {
    // `DEAD` pinta selo vermelho "Parado". Uma peça de dez dias recebendo a
    // etiqueta do encalhe de três anos é a mesma confusão, só que visual.
    const nova = analyzeProduct(peca({ ageDays: 10 }), JANELA);
    const velha = analyzeProduct(peca({ ageDays: 900 }), JANELA);
    expect(nova.movementClass).toBe('NEW');
    expect(velha.movementClass).toBe('DEAD');
  });

  it('best-seller sem venda na janela mas com giro no ano NÃO é liquidado', () => {
    // Este é o defeito de fundo: `forecastDemand` deriva a demanda de
    // recentUnits/priorUnits — ambos DENTRO da janela — e o índice sazonal
    // MULTIPLICA esse valor. Óculos de sol em julho tem base zero, e zero
    // vezes qualquer índice continua zero. Os 24 meses de histórico que fomos
    // buscar não eram consultados justamente onde decidiriam.
    const r = analyzeProduct(peca({ ageDays: 900, annualUnitsSold: 84 }), JANELA);
    expect(r.recommendation).toBe('HOLD');
    expect(r.reason).toContain('84');
    expect(r.friendlyReason).toContain('sazonal');
  });

  it('encalhe de verdade continua sendo liquidado', () => {
    // A guarda não pode virar anistia: peça velha, com estoque e sem giro no
    // ano é exatamente o que a liquidação existe para pegar.
    const r = analyzeProduct(peca({ ageDays: 900, annualUnitsSold: 0 }), JANELA);
    expect(r.recommendation).toBe('LIQUIDATE');
  });

  it('sem o dado de idade nem de giro anual, o comportamento é o anterior', () => {
    // Degradação segura: preferimos deixar passar um card de liquidação a
    // suprimir um encalhe real por falta de insumo.
    const r = analyzeProduct(peca(), JANELA);
    expect(r.recommendation).toBe('LIQUIDATE');
  });

  it('a fronteira dos 45 dias é fechada em cima e aberta embaixo', () => {
    const cfg = DEFAULT_PLANNING_CONFIG;
    expect(analyzeProduct(peca({ ageDays: cfg.newProductDays - 1 }), JANELA).recommendation).toBe('HOLD');
    expect(analyzeProduct(peca({ ageDays: cfg.newProductDays }), JANELA).recommendation).toBe('LIQUIDATE');
  });
});

describe('item 03 · compra de grife irrelevante ou fora do mix', () => {
  it('uma venda no ano inteiro não vira sugestão de compra', () => {
    // Sem piso, saldo zero satisfaz "posição <= ponto de reposição" e o motor
    // sugeria repor 1 unidade — o "vendemos pouquíssimo" do feedback.
    const r = analyzeProduct(
      peca({ unitsSold: 1, currentStock: 0, ageDays: 900, annualUnitsSold: 1 }),
      JANELA,
    );
    expect(r.recommendation).toBe('DONT_BUY');
    expect(r.suggestedQty).toBe(0);
    expect(r.reason).toContain('piso');
  });

  it('mas o piso não sufoca lançamento — peça nova está em carência', () => {
    // Uma peça de 10 dias tem, por definição, giro anual baixo. Aplicar o piso
    // a ela mataria a reposição de todo lançamento que vende bem na estreia.
    const r = analyzeProduct(
      peca({ unitsSold: 3, currentStock: 0, ageDays: 10, annualUnitsSold: 3 }),
      JANELA,
    );
    expect(r.recommendation).toBe('BUY');
  });

  it('grife fora do mix não é reposta, mesmo com giro', () => {
    const r = analyzeProduct(
      peca({ unitsSold: 40, currentStock: 0, ageDays: 900, annualUnitsSold: 160, brandDiscontinued: true }),
      JANELA,
    );
    expect(r.recommendation).toBe('DONT_BUY');
    expect(r.friendlyReason).toContain('não trabalha mais');
  });

  it('grife fora do mix COM saldo parado é liquidada — é o que se quer escoar', () => {
    const r = analyzeProduct(
      peca({ currentStock: 12, ageDays: 900, annualUnitsSold: 0, brandDiscontinued: true }),
      JANELA,
    );
    expect(r.recommendation).toBe('LIQUIDATE');
    expect(r.reason).toContain('fora do mix');
  });
});

describe('item 04 · prioridade composta', () => {
  const alta = { urgencyDays: 0, materialValue: 5000, confidence: 90 };

  it('confiança baixa impede prioridade alta — a reclamação literal', () => {
    // "Cards com confiança abaixo de 50% estão categorizados como prioridade
    // alta." Antes, prioridade e confiança eram duas colunas independentes.
    expect(decisionPriority(alta).priority).toBe('ALTA');
    expect(decisionPriority({ ...alta, confidence: 49 }).priority).toBe('MEDIA');
    expect(decisionPriority({ ...alta, confidence: 34 }).priority).toBe('BAIXA');
  });

  it('valor irrisório impede prioridade alta, por mais urgente que seja', () => {
    expect(decisionPriority({ ...alta, materialValue: 399 }).priority).toBe('BAIXA');
    expect(decisionPriority({ ...alta, materialValue: 400 }).priority).toBe('MEDIA');
    expect(decisionPriority({ ...alta, materialValue: 1500 }).priority).toBe('ALTA');
  });

  it('a prioridade é a PIOR das três leituras, não a média', () => {
    // Urgentíssimo e valioso, mas o motor não sabe: não é para furar a fila.
    expect(
      decisionPriority({ urgencyDays: 0, materialValue: 99_000, confidence: 30 }).priority,
    ).toBe('BAIXA');
  });

  it('o motivo nomeia a dimensão que rebaixou', () => {
    expect(decisionPriority({ ...alta, confidence: 40 }).reason).toContain('confiança');
    expect(decisionPriority({ ...alta, materialValue: 100 }).reason).toContain('valor');
    expect(decisionPriority({ ...alta, urgencyDays: 60 }).reason).toContain('ruptura');
  });

  it('quando as três concordam, o motivo fala da urgência', () => {
    expect(decisionPriority(alta).reason).toContain('em falta');
    expect(decisionPriority({ ...alta, urgencyDays: 2 }).reason).toContain('2 dias');
  });

  it('liquidação não tem prazo e por isso não pode ser alta pela urgência', () => {
    const v = decisionPriority({ urgencyDays: null, materialValue: 90_000, confidence: 95 });
    expect(v.priority).toBe('BAIXA');
    expect(v.reason).toContain('sem prazo');
  });

  it('nenhum card ALTA sai com confiança abaixo do piso — a garantia do board', () => {
    // O teste que fecha o item: seja qual for a combinação, a promessa é que
    // "Alta · 37%" deixou de ser um estado alcançável.
    const planos: ProductPlan[] = [];
    const reb: RebalanceSuggestion[] = [];
    for (let conf = 30; conf <= 97; conf += 1) {
      reb.push({
        productId: `p${conf}`,
        description: `PEÇA ${conf} OCULOS RAY BAN`,
        brand: null,
        category: 'OCULOS DE SOL',
        fromStoreId: 'a',
        fromStoreName: 'A',
        toStoreId: 'b',
        toStoreName: 'B',
        quantity: 9,
        fromCoverageDays: 300,
        toCoverageDays: 1,
        stockoutInDays: 0,
        reason: '',
        friendlyReason: '',
        confidence: conf,
      });
      planos.push({ ...(analyzeProduct(peca({ productId: `p${conf}` }), JANELA) as ProductPlan) });
    }
    const board = buildDecisionCards(planos, reb);
    const violacoes = board.cards.filter(
      (c) => c.priority === 'ALTA' && c.confidence < DEFAULT_PRIORITY_CONFIG.minConfidenceHigh,
    );
    expect(violacoes).toHaveLength(0);
  });

  it('todo card carrega o porquê da prioridade', () => {
    const planos = [analyzeProduct(peca({ unitsSold: 30, currentStock: 1, ageDays: 900, annualUnitsSold: 120 }), JANELA)];
    const board = buildDecisionCards(planos, []);
    expect(board.cards.length).toBeGreaterThan(0);
    for (const c of board.cards) expect(c.priorityReason).toBeTruthy();
  });
});

describe('item 05 · a grife pela qual a Central de Decisões filtra', () => {
  it('o card carrega a GRIFE, não o campo de fornecedor do ERP', () => {
    // `brand` é o fornecedor do CDS e vem vazio na maior parte do catálogo:
    // um seletor construído a partir dele teria um item só, chamado "—".
    const planos = [
      analyzeProduct(
        peca({ description: 'RB2140 901 54 OCULOS RAY BAN', unitsSold: 30, currentStock: 1 }),
        JANELA,
      ),
    ];
    const board = buildDecisionCards(planos, []);
    expect(board.cards[0].brand).toBeNull();
    expect(board.cards[0].brandLabel).toBe('RAY BAN');
  });
});
