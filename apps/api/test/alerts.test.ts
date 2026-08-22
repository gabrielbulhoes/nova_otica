import { describe, it, expect } from 'vitest';
import { lojaTrabalhaAPeca, resolveThreshold } from '../src/modules/alerts/alerts.service.js';

describe('resolveThreshold (mínimo por loja > produto > rede)', () => {
  it('usa o mínimo da loja quando definido', () => {
    expect(resolveThreshold(7, 3, 5)).toBe(7);
    expect(resolveThreshold(0, 3, 5)).toBe(0); // zero é valor válido, não "ausente"
  });

  it('cai para o mínimo do produto sem override da loja', () => {
    expect(resolveThreshold(null, 3, 5)).toBe(3);
    expect(resolveThreshold(undefined, 0, 5)).toBe(0);
  });

  it('cai para o padrão da rede sem loja nem produto', () => {
    expect(resolveThreshold(null, null, 5)).toBe(5);
    expect(resolveThreshold(undefined, undefined, 5)).toBe(5);
  });
});

/**
 * A GUARDA QUE FALTAVA — "a loja trabalha esta peça?".
 *
 * O CDS devolve posição de estoque para praticamente todo par (loja × peça):
 * 1.108.423 posições medidas em produção, quase todas zeradas. Sem esta
 * pergunta, o painel de ruptura alertava sobre o catálogo inteiro em toda
 * filial — e a tela apresentava isso como "produtos em falta".
 *
 * A regra tem duas pernas, e o teste que importa é o da SEGUNDA: filtrar só
 * por "tem saldo" apagaria exatamente a ruptura de verdade.
 */
describe('lojaTrabalhaAPeca (a guarda do painel de ruptura)', () => {
  it('com saldo, a loja trabalha a peça', () => {
    expect(lojaTrabalhaAPeca(5, false)).toBe(true);
    expect(lojaTrabalhaAPeca(1, false)).toBe(true);
  });

  it('SEM saldo mas com venda na janela, trabalha — é a RUPTURA DE VERDADE', () => {
    // A loja vendeu a última unidade e zerou. É o caso mais importante da tela
    // inteira, e o único que uma guarda ingênua ("só quem tem saldo") apagaria.
    expect(lojaTrabalhaAPeca(0, true)).toBe(true);
  });

  it('sem saldo e sem venda, NÃO trabalha — é peça que a loja não carrega', () => {
    expect(lojaTrabalhaAPeca(0, false)).toBe(false);
  });

  it('saldo negativo conta como sem saldo', () => {
    // O ERP às vezes devolve saldo negativo (baixa lançada antes da entrada).
    // Sem venda, isso não é ruptura da loja: é ruído de lançamento.
    expect(lojaTrabalhaAPeca(-2, false)).toBe(false);
    expect(lojaTrabalhaAPeca(-2, true)).toBe(true);
  });
});
