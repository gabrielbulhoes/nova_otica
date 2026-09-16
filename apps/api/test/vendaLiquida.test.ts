import { describe, expect, it } from 'vitest';
import { ehDevolucao, emDuvida } from '../src/vendas/devolucao.js';

/**
 * A REGRA DA VENDA LÍQUIDA — rodada final final · contagem geral.
 *
 * "Venda → Devolução → Revenda → Devolução deve contar ZERO VENDAS desse SKU;
 *  caso seja vendido pela 3ª vez, se não for devolvido, conta 1 venda."
 *
 * O cenário do cliente está no último teste deste arquivo, escrito como ele o
 * descreveu, porque é o critério de aceite e não um detalhe de implementação.
 */
describe('ehDevolucao — o dicionário', () => {
  it('reconhece as grafias de devolução, sem depender de acento ou caixa', () => {
    for (const s of ['Devolvido', 'DEVOLUÇÃO', 'devolucao', 'Devolvida', 'Cancelado', 'CANCELADA', 'Estornado', 'Inválido', 'Não válido']) {
      expect(ehDevolucao(s), s).toBe(true);
    }
  });

  it('a venda boa continua sendo venda', () => {
    for (const s of ['Válido', 'VALIDO', 'Faturado', 'Ativo', 'Baixado']) {
      expect(ehDevolucao(s), s).toBe(false);
    }
  });

  /**
   * A DIREÇÃO DO ERRO, escolhida de propósito.
   *
   * Status desconhecido conta como VENDA. Assim, uma grafia que o dicionário
   * ainda não conhece deixa o número como está — e o pior que acontece é a
   * correção não ter efeito, que é visível no `/health`. O contrário (contar
   * só o que é reconhecidamente válido) zeraria o faturamento da rede inteira
   * no dia em que o CDS escrevesse "Concluída" em vez de "Válido".
   */
  it('status desconhecido, nulo ou vazio conta como venda', () => {
    expect(ehDevolucao(null)).toBe(false);
    expect(ehDevolucao(undefined)).toBe(false);
    expect(ehDevolucao('')).toBe(false);
    expect(ehDevolucao('   ')).toBe(false);
    expect(ehDevolucao('Status Que Ninguem Previu')).toBe(false);
  });

  it('a venda inteira cancelada marca o item, mesmo com o item sem status', () => {
    // O ERP nem sempre repete o cancelamento linha a linha.
    expect(ehDevolucao(null, 'Cancelada')).toBe(true);
    expect(ehDevolucao('Válido', 'Cancelada')).toBe(true);
    expect(ehDevolucao('Devolvido', 'Válido')).toBe(true);
    expect(ehDevolucao('Válido', 'Válido')).toBe(false);
  });

  it('"troca" NÃO é decidida aqui — fica marcada como dúvida', () => {
    /*
     * Numa troca o cliente devolve A e leva B: a venda de A não aconteceu, a
     * de B aconteceu. Se o ERP marcar as DUAS linhas como "Troca", excluí-las
     * zeraria uma venda que de fato ocorreu. Não dá para decidir sem ver o
     * dado, então "Troca" conta como venda e o comando de ensaio a destaca.
     */
    expect(ehDevolucao('Troca')).toBe(false);
    expect(emDuvida('Troca')).toBe(true);
    expect(emDuvida('Devolução parcial')).toBe(true);
    expect(emDuvida('Válido')).toBe(false);
  });
});

describe('o cenário que o cliente descreveu', () => {
  /** A regra aplicada a uma sequência de linhas de venda do mesmo SKU. */
  const contar = (linhas: (string | null)[]) => linhas.filter((s) => !ehDevolucao(s)).length;

  it('venda → devolução → revenda → devolução = ZERO vendas', () => {
    expect(contar(['Devolvido', 'Devolvido'])).toBe(0);
  });

  it('vendida pela 3ª vez e não devolvida = UMA venda', () => {
    expect(contar(['Devolvido', 'Devolvido', 'Válido'])).toBe(1);
  });

  it('vendida e não devolvida = UMA venda (a conta de sempre não muda)', () => {
    expect(contar(['Válido'])).toBe(1);
  });

  it('a base antiga, sem status nenhum, conta como contava', () => {
    expect(contar([null, null, null])).toBe(3);
  });
});
