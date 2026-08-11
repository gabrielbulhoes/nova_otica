import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLANNING_CONFIG,
  analyzeProduct,
  buildDecisionCards,
  type OutletPosition,
  type ProductPlan,
  type RebalanceSuggestion,
} from '../src/modules/planning/planning.math.js';

/**
 * "ANTES DE COMPRAR, VEJA SE A REDE JÁ TEM" — feedback 6.0 · item 06.
 *
 * O cliente: "antes de adicionar um pedido de compra/reposição de qualquer
 * produto, certifique-se se existe esse mesmo produto em outras lojas antes de
 * incluir o card de recomendação de compra."
 *
 * O card nascia cego a isso. Dizia "comprar 25" sem dizer que 7 unidades já
 * estão na rede, paradas numa loja que não as vende.
 *
 * A DECISÃO DE PROJETO QUE ESTES TESTES PRENDEM: o card DECLARA, não ABATE.
 *
 * A conta da compra é `targetStock - position`, e `position` é o estoque da
 * REDE — as unidades paradas já estão contadas ali. Abatê-las de novo seria
 * contá-las duas vezes e comprar de menos, que é o lado do erro que gera
 * ruptura. O que faltava nunca foi a aritmética: era o gestor enxergar que
 * parte da falta já está paga e só precisa de uma transferência.
 *
 * Se alguém um dia "consertar" isto subtraindo, o último teste quebra.
 */

const plano = (opts: {
  productId: string;
  unitsSold: number;
  currentStock: number;
}): ProductPlan =>
  analyzeProduct(
    {
      productId: opts.productId,
      description: `RB3548NL 001 54 OCULOS RAY BAN`,
      brand: 'Ray-Ban',
      category: 'OCULOS',
      unitsSold: opts.unitsSold,
      currentStock: opts.currentStock,
      unitCost: 100,
      unitPrice: 250,
      annualUnitsSold: opts.unitsSold * 4,
    },
    90,
    DEFAULT_PLANNING_CONFIG,
  );

const pos = (storeName: string, unitsSold: number, currentStock: number): OutletPosition => ({
  storeId: storeName.toLowerCase().replace(/\s/g, '-'),
  storeName,
  unitsSold,
  currentStock,
});

/** Um plano que o motor de fato classifica como compra. */
const compraDe = (p: ProductPlan) => {
  expect(p.recommendation, 'o cenário precisa produzir uma COMPRA').toBe('BUY');
  return p;
};

describe('card de compra · declara o que a rede já tem parado', () => {
  const p = compraDe(plano({ productId: 'p1', unitsSold: 90, currentStock: 4 }));

  it('conta as unidades em lojas que NÃO venderam a peça na janela', () => {
    const board = buildDecisionCards([p], [], {
      positionsByProduct: new Map([
        [
          'p1',
          [
            pos('A GRACIOSA MIDWAY', 90, 1), // vende — não está parada
            pos('A GRACIOSA GUARABIRA', 0, 2), // parada
            pos('A GRACIOSA JUAZEIRO', 0, 1), // parada
          ],
        ],
      ]),
    });
    const card = board.cards.find((c) => c.type === 'COMPRA')!;
    expect(card.redeParadaQty).toBe(3);
    expect(card.redeParadaLojas).toEqual(['A GRACIOSA GUARABIRA', 'A GRACIOSA JUAZEIRO']);
  });

  it('lista as lojas com mais unidades primeiro, e no máximo quatro', () => {
    // O card é uma tela, não um relatório. Cinco nomes de loja numa linha
    // viram ruído, e o gestor precisa saber ONDE está o grosso.
    const board = buildDecisionCards([p], [], {
      positionsByProduct: new Map([
        [
          'p1',
          [
            pos('LOJA A', 0, 1),
            pos('LOJA B', 0, 9),
            pos('LOJA C', 0, 5),
            pos('LOJA D', 0, 3),
            pos('LOJA E', 0, 7),
          ],
        ],
      ]),
    });
    const card = board.cards.find((c) => c.type === 'COMPRA')!;
    expect(card.redeParadaQty).toBe(25);
    expect(card.redeParadaLojas).toEqual(['LOJA B', 'LOJA E', 'LOJA C', 'LOJA D']);
  });

  it('cala quando não há nada parado — sem campo vazio na tela', () => {
    const board = buildDecisionCards([p], [], {
      positionsByProduct: new Map([['p1', [pos('A GRACIOSA MIDWAY', 90, 4)]]]),
    });
    const card = board.cards.find((c) => c.type === 'COMPRA')!;
    expect(card.redeParadaQty).toBeUndefined();
    expect(card.redeParadaLojas).toBeUndefined();
  });

  it('cala quando não recebeu posições — ausência de dado não é zero', () => {
    const board = buildDecisionCards([p], []);
    const card = board.cards.find((c) => c.type === 'COMPRA')!;
    expect(card.redeParadaQty).toBeUndefined();
  });
});

describe('card de compra · declara o remanejamento já sugerido', () => {
  const p = compraDe(plano({ productId: 'p1', unitsSold: 90, currentStock: 4 }));

  const transferencia = (quantity: number, to: string): RebalanceSuggestion =>
    ({
      productId: 'p1',
      description: 'RB3548NL 001 54 OCULOS RAY BAN',
      brand: 'Ray-Ban',
      category: 'OCULOS',
      fromStoreId: 'guarabira',
      fromStoreName: 'A GRACIOSA GUARABIRA',
      toStoreId: to,
      toStoreName: to,
      quantity,
      confidence: 0.7,
      friendlyReason: 'x',
      stockoutInDays: null,
    }) as unknown as RebalanceSuggestion;

  it('soma TODAS as linhas de remanejamento da mesma peça', () => {
    // Uma peça pode ter várias rotas no mesmo dia. O gestor da compra precisa
    // do total que já está a caminho por transferência, não de uma delas.
    const board = buildDecisionCards([p], [transferencia(2, 'MIDWAY'), transferencia(3, 'NATAL SHOP')], {});
    const card = board.cards.find((c) => c.type === 'COMPRA')!;
    expect(card.remanejamentoSugeridoQty).toBe(5);
  });

  it('cala quando não há remanejamento para a peça', () => {
    const board = buildDecisionCards([p], []);
    expect(board.cards.find((c) => c.type === 'COMPRA')!.remanejamentoSugeridoQty).toBeUndefined();
  });
});

describe('a quantidade a comprar NÃO muda — e isso é deliberado', () => {
  it('comprar 25 com 7 paradas continua sendo comprar 25', () => {
    /*
     * O TESTE QUE PROTEGE A ARITMÉTICA.
     *
     * A leitura ingênua do pedido do cliente é "então desconte as 7 da
     * compra". Seria errado: `suggestedQty = targetStock - position`, e
     * `position` É o estoque da rede inteira — as 7 unidades paradas já foram
     * subtraídas ali. Descontá-las de novo compraria 7 a menos do que a rede
     * precisa, e o erro sairia sempre para o lado da ruptura.
     *
     * Transferir NÃO cria unidade nova: move a mesma peça de lugar. A rede
     * continua precisando das 25.
     */
    const p = compraDe(plano({ productId: 'p1', unitsSold: 90, currentStock: 10 }));
    const semParadas = buildDecisionCards([p], []).cards.find((c) => c.type === 'COMPRA')!;

    const comParadas = buildDecisionCards([p], [], {
      positionsByProduct: new Map([
        [
          'p1',
          [pos('A GRACIOSA MIDWAY', 90, 3), pos('A GRACIOSA GUARABIRA', 0, 7)],
        ],
      ]),
    }).cards.find((c) => c.type === 'COMPRA')!;

    expect(comParadas.redeParadaQty).toBe(7);
    expect(comParadas.quantity).toBe(semParadas.quantity);
    expect(comParadas.impact).toBe(semParadas.impact);
  });
});
