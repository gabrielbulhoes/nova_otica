import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import {
  DEFAULT_PLANNING_CONFIG,
  analyzeProduct,
  buildPurchaseOrders,
  type FairSplitInput,
} from '@planning';
import { RateioPorLoja } from './Planning';

/**
 * O PRIMEIRO TESTE DE TELA DESTE REPOSITÓRIO.
 *
 * Até aqui as suítes do web eram todas de módulo puro — nenhuma abria a tela —
 * e o buraco cobrou duas vezes:
 *
 *   · a coluna "Mandar" saiu VAZIA numa entrega inteira, com typecheck verde:
 *     a tela lia `quantity` e a API mandava `suggestedQty`, porque o tipo do
 *     web era declarado à mão. A linha de A GRACIOSA AFONSO PENA vinha com 18
 *     unidades e a tela mostrava nada; no arquivo exportado, a coluna de MIDWAY
 *     saía 0 onde o número era 38;
 *   · as duas telas paginadas ficaram desprotegidas — a conferência restaurou a
 *     versão defeituosa e 125 de 125 asserções passaram.
 *
 * O que este arquivo faz de diferente de tudo que veio antes: os dados vêm do
 * MOTOR DE VERDADE (`buildPurchaseOrders`, o mesmo que a API e a demo chamam),
 * atravessam a fronteira de tipos, e a tabela é MONTADA. É a única forma de o
 * teste ver o que o gestor vê.
 *
 * Um objeto escrito à mão aqui devolveria a suíte ao estado anterior: ele teria
 * os campos que o teste inventou, e é exatamente por isso que a divergência
 * passou.
 */

/** Um plano de compra real, do mesmo jeito que `rateio.test.ts` monta. */
const plano = (productId: string, unitsSold: number, currentStock: number) =>
  analyzeProduct(
    {
      productId,
      description: `ARMACAO RAY-BAN ${productId}`,
      brand: 'Ray-Ban',
      category: 'Armação',
      unitsSold,
      currentStock,
      unitCost: 100,
      unitPrice: 200,
    },
    90,
    DEFAULT_PLANNING_CONFIG,
  );

const posicoes = (id: string): Map<string, FairSplitInput[]> =>
  new Map([
    [
      id,
      [
        { storeId: 's1', storeName: 'A GRACIOSA MIDWAY', unitsSold: 60, stockUnits: 0 },
        { storeId: 's2', storeName: 'A GRACIOSA GUARABIRA', unitsSold: 30, stockUnits: 0 },
      ],
    ],
  ]);

/** O rateio como a tela o recebe, vindo do motor — e quanto o item manda comprar. */
const rateioDoMotor = () => {
  const pedido = buildPurchaseOrders([plano('p1', 90, 3)], 90, undefined, posicoes('p1')).orders[0];
  const item = pedido.items[0];
  expect(item.distribution, 'o motor precisa produzir rateio para este item').toBeDefined();
  return { ...item.distribution!, comprar: item.quantity };
};

describe('tela · a coluna "Mandar" traz o número que o motor calculou', () => {
  it('cada loja aparece com as unidades rateadas, e não com zero nem vazio', () => {
    const rateio = rateioDoMotor();
    expect(rateio.rows.length).toBe(2);

    render(
      <RateioPorLoja
        rows={rateio.rows}
        pesoLabel="Vendeu (90 dias)"
        porNecessidade={rateio.basis === 'necessidade'}
      />,
    );

    for (const r of rateio.rows) {
      // A linha da loja, e dentro dela a última célula — a "Mandar".
      const linha = screen.getByText(r.storeName).closest('tr');
      expect(linha, `linha de ${r.storeName}`).not.toBeNull();
      const celulas = within(linha as HTMLElement).getAllByRole('cell');
      const mandar = celulas[celulas.length - 1].textContent?.trim();

      expect(mandar, `"Mandar" de ${r.storeName}`).toBe(String(r.suggestedQty));
      // O defeito histórico em uma asserção: vazio e zero são os dois jeitos de
      // a coluna mentir, e os dois passavam pelo typecheck.
      expect(mandar).not.toBe('');
      expect(Number(mandar)).toBeGreaterThan(0);
    }
  });

  it('a soma da coluna fecha com o que o item manda comprar', () => {
    // A tela não pode contar história diferente do pedido. Se a soma não fechar,
    // ou o rateio está errado ou a tela está lendo o campo errado — e o gestor
    // não tem como saber qual dos dois.
    const rateio = rateioDoMotor();
    render(
      <RateioPorLoja
        rows={rateio.rows}
        pesoLabel="Vendeu (90 dias)"
        porNecessidade={rateio.basis === 'necessidade'}
      />,
    );
    const somaNaTela = rateio.rows.reduce((a, r) => {
      const linha = screen.getByText(r.storeName).closest('tr') as HTMLElement;
      const celulas = within(linha).getAllByRole('cell');
      return a + Number(celulas[celulas.length - 1].textContent);
    }, 0);
    expect(somaNaTela + rateio.unassigned).toBe(rateio.comprar);
  });
});

describe('tela · o que a tabela precisa DECLARAR', () => {
  it('lojas fora por não trabalharem a grife aparecem nomeadas', () => {
    // Loja que some da lista sem motivo visível é o silêncio que faz alguém
    // desconfiar do resto da tela. E era invisível de outro jeito: a regra de
    // mix esteve permissiva em produção desde sempre, então esta lista nunca
    // chegou a ser preenchida.
    const rateio = rateioDoMotor();
    render(
      <RateioPorLoja
        rows={rateio.rows}
        pesoLabel="Vendeu (90 dias)"
        porNecessidade
        excludedByMix={['A GRACIOSA PARTAGE', 'A GRACIOSA NATAL SHOPPING']}
      />,
    );
    const aviso = screen.getByText(/Fora do rateio por não trabalharem a grife/);
    expect(aviso.textContent).toContain('A GRACIOSA PARTAGE');
    expect(aviso.textContent).toContain('A GRACIOSA NATAL SHOPPING');
  });

  it('na reserva, a tabela diz que a divisão NÃO saiu da falta', () => {
    // Quando ninguém está abaixo do alvo, o percentual vem do peso da escada
    // (grife, categoria, rede). A tela mostrando "Participação 75%" ao lado de
    // colunas zeradas convidava o gestor a conferir uma conta que não fecha.
    const rateio = rateioDoMotor();
    render(<RateioPorLoja rows={rateio.rows} pesoLabel="Vendeu da grife (12 m)" porNecessidade={false} />);

    expect(screen.getByText(/a divisão saiu da coluna/)).toBeTruthy();
    // E a coluna de falta some, porque ali ela seria zero por definição.
    expect(screen.queryByText('Falta p/ o alvo')).toBeNull();
  });

  it('sem loja nenhuma, diz que a divisão é manual em vez de mostrar tabela vazia', () => {
    render(<RateioPorLoja rows={[]} pesoLabel="Vendeu (90 dias)" porNecessidade />);
    expect(screen.getByText(/divisão manual/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
