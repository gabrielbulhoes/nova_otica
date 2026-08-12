import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLANNING_CONFIG,
  estoqueIdealDaLoja,
} from '../src/modules/planning/planning.math.js';
import { resolveThreshold } from '../src/modules/alerts/alerts.service.js';

/**
 * O ESTOQUE IDEAL POR LOJA — feedback 6.0 · item 08.
 *
 * "Falta uma definição de qual é o estoque ideal de cada peça em cada loja."
 *
 * O schema já tinha onde guardar e o alerta já sabia usar. O que nunca existiu
 * foi quem calculasse — o campo ficou nulo em toda posição, e o alerta por loja
 * nunca disparou por outro critério que não o padrão da rede.
 *
 * O QUE ESTES TESTES PRENDEM é a separação entre os dois números. Gravar o ALVO
 * como limiar de alerta poria quase toda posição em "abaixo do mínimo" no
 * primeiro dia — alvo é onde se quer chegar, não onde se está — e um painel que
 * apita para tudo é um painel que ninguém lê.
 */

const cfg = DEFAULT_PLANNING_CONFIG;

describe('estoque ideal · os dois números', () => {
  it('o ALVO cobre a janela de cobertura da rede', () => {
    // 30 un. em 90 dias = 1/3 por dia. Alvo = 60 dias × 1/3 = 20.
    const r = estoqueIdealDaLoja({ unitsSold: 30, days: 90 }, cfg);
    expect(r.demandaDiaria).toBeCloseTo(1 / 3);
    expect(r.ideal).toBe(20);
  });

  it('o GATILHO cobre só o prazo de entrega mais a segurança', () => {
    // 21 dias × 1/3 = 7. É bem menor que o alvo, e tem de ser.
    const r = estoqueIdealDaLoja({ unitsSold: 30, days: 90 }, cfg);
    expect(r.minimo).toBe(7);
    expect(r.minimo).toBeLessThan(r.ideal);
  });

  it('o alvo NUNCA é usado como limiar — a distância entre eles é o ponto', () => {
    // Se alguém "simplificar" igualando os dois, este teste cai. Com alvo de
    // 60 dias como gatilho, uma loja com 8 unidades de um item que ela vende
    // bem entraria em alerta todo dia, para sempre.
    const r = estoqueIdealDaLoja({ unitsSold: 90, days: 90 }, cfg);
    expect(r.ideal).toBe(60);
    expect(r.minimo).toBe(21);
    expect(r.ideal / r.minimo).toBeGreaterThan(2);
  });
});

describe('estoque ideal · os pisos', () => {
  it('loja que vende pouquíssimo ainda tem o mostruário', () => {
    // 1 un. em 365 dias. Sem o piso, alvo e gatilho arredondariam para 0 e a
    // loja perderia a peça de vitrine — sem a qual não vende nem sob encomenda.
    const r = estoqueIdealDaLoja({ unitsSold: 1, days: 365 }, cfg);
    expect(r.ideal).toBe(1);
    expect(r.minimo).toBe(1);
  });

  it('loja que NÃO vende a peça fica em zero, não no piso', () => {
    // Forçar mostruário em toda loja para todo SKU imobilizaria a cauda longa
    // inteira do catálogo — são dezenas de milhares de referências.
    const r = estoqueIdealDaLoja({ unitsSold: 0, days: 90 }, cfg);
    expect(r).toEqual({ ideal: 0, minimo: 0, demandaDiaria: 0 });
  });

  it('janela inválida não vira divisão por zero', () => {
    expect(estoqueIdealDaLoja({ unitsSold: 10, days: 0 }, cfg).ideal).toBe(0);
  });

  it('venda negativa (devolução líquida) não vira alvo negativo', () => {
    expect(estoqueIdealDaLoja({ unitsSold: -5, days: 90 }, cfg)).toEqual({
      ideal: 0,
      minimo: 0,
      demandaDiaria: 0,
    });
  });
});

describe('estoque ideal · encaixa na cascata de limiar que já existe', () => {
  it('o mínimo da loja vence o do produto e o da rede', () => {
    // `resolveThreshold` é de `alerts.service` e já estava lá: mínimo da loja >
    // do produto > padrão da rede. O que faltava era alguém preencher o
    // primeiro. Este teste amarra as duas pontas.
    const { minimo } = estoqueIdealDaLoja({ unitsSold: 30, days: 90 }, cfg);
    expect(resolveThreshold(minimo, 99, 3)).toBe(7);
    // E quando a loja não tem número próprio, a cascata segue como antes.
    expect(resolveThreshold(null, 99, 3)).toBe(99);
    expect(resolveThreshold(null, null, 3)).toBe(3);
  });

  it('zero da loja é um valor, não uma ausência', () => {
    // A distinção importa: `0` significa "esta loja não trabalha esta peça" e
    // precisa vencer o mínimo do produto. Com `||` no lugar de `??` na cascata,
    // o zero cairia para o padrão da rede e a loja voltaria a receber alerta de
    // reposição de algo que ela não vende.
    expect(resolveThreshold(0, 99, 3)).toBe(0);
  });
});
