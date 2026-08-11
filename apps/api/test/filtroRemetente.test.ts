import { describe, expect, it } from 'vitest';
import {
  filtrarVista,
  lojasDoCard,
  remetentesDoCard,
  type DecisionCard,
} from '../src/modules/planning/planning.math.js';

/**
 * FILTRO DE REMETENTE — feedback 6.0 · item 02: "ter filtro pra remetente
 * também".
 *
 * O filtro que existia (`loja`) casa com QUALQUER loja que o card toca, e por
 * isso não responde à pergunta que o gerente faz: "o que estão querendo tirar
 * de mim?". Numa rota MIDWAY → MOSSORO, filtrar por MIDWAY trazia junto tudo
 * que MIDWAY vai RECEBER — e receber e ceder exigem ações opostas.
 */

const card = (p: Partial<DecisionCard>): DecisionCard =>
  ({
    id: 'c',
    type: 'REMANEJAMENTO',
    title: 't',
    priority: 'MEDIA',
    productId: 'p',
    description: 'd',
    brand: null,
    brandLabel: null,
    target: 'x',
    quantity: 1,
    reason: 'r',
    confidence: 0.5,
    impact: 0,
    impactLabel: 'i',
    urgencyDays: null,
    ...p,
  }) as DecisionCard;

describe('remetentesDoCard', () => {
  it('remanejamento: só a ORIGEM, nunca o destino', () => {
    const c = card({ fromStoreId: 'midway', toStoreId: 'mossoro' });
    expect(remetentesDoCard(c)).toEqual(['midway']);
    // O contraste com o filtro antigo, na mesma asserção: ele pegava as duas.
    expect(lojasDoCard(c)).toEqual(['midway', 'mossoro']);
  });

  it('liquidação: a loja que CEDE a peça, não a que escoa', () => {
    const c = card({
      type: 'LIQUIDACAO',
      outletFromStoreId: 'guarabira',
      outletStoreId: 'midway',
    });
    expect(remetentesDoCard(c)).toEqual(['guarabira']);
  });

  it('compra não tem remetente — nasce no fornecedor', () => {
    expect(remetentesDoCard(card({ type: 'COMPRA' }))).toEqual([]);
  });
});

describe('filtrarVista · remetente', () => {
  const saiDeMidway = card({ id: 'a', fromStoreId: 'midway', toStoreId: 'mossoro' });
  const chegaEmMidway = card({ id: 'b', fromStoreId: 'mossoro', toStoreId: 'midway' });
  const compra = card({ id: 'c', type: 'COMPRA' });

  it('traz só o que SAI da loja escolhida', () => {
    const r = filtrarVista([saiDeMidway, chegaEmMidway, compra], { remetente: 'midway' });
    expect(r.map((c) => c.id)).toEqual(['a']);
  });

  it('o filtro antigo continua trazendo as duas pontas', () => {
    // `loja` não muda de semântica: quem quer ver tudo que toca a loja
    // continua tendo como. São perguntas diferentes, e agora são dois campos.
    const r = filtrarVista([saiDeMidway, chegaEmMidway, compra], { loja: 'midway' });
    expect(r.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('combina com os outros critérios', () => {
    const r = filtrarVista([saiDeMidway, chegaEmMidway, compra], {
      remetente: 'midway',
      tipo: 'COMPRA',
    });
    expect(r).toEqual([]);
  });

  it('sem critério nenhum devolve a MESMA lista, sem copiar', () => {
    // O caminho rápido existe porque o quadro tem milhares de cards e a vista
    // sem filtro é a mais comum. Uma cópia aqui seria alocação à toa.
    const todos = [saiDeMidway, chegaEmMidway, compra];
    expect(filtrarVista(todos, {})).toBe(todos);
  });
});
