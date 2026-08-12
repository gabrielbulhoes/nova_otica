import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DEFAULT_PLANNING_CONFIG,
  analyzeProduct,
  buildPurchaseOrders,
  type FairSplitInput,
} from '@planning';
import { DestinoDoPedido } from './Planning';

/**
 * "PARA ONDE VAI, E QUANTO PARA CADA LOJA" — feedback 6.0 · item 07.
 *
 * "No planejamento de compras só aparece o total de peças mas não indica
 * facilmente para onde vai, e qual a quantidade para cada loja."
 *
 * O rateio já era calculado e já aparecia — dentro de cada item, atrás de um
 * clique, um item por vez. Para saber o destino de um pedido de 40 itens era
 * preciso abrir 40 gavetas e somar de cabeça.
 *
 * COMO ANTES, OS DADOS VÊM DO MOTOR DE VERDADE. Um objeto escrito à mão aqui
 * teria os campos que o teste inventou — e foi exatamente assim que a coluna
 * "Mandar" saiu vazia numa entrega inteira com typecheck verde, porque a tela
 * lia `quantity` e a API mandava `suggestedQty`.
 */

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

const posicoes = (ids: string[]): Map<string, FairSplitInput[]> =>
  new Map(
    ids.map((id) => [
      id,
      [
        { storeId: 's1', storeName: 'A GRACIOSA MIDWAY', unitsSold: 60, stockUnits: 0 },
        { storeId: 's2', storeName: 'A GRACIOSA GUARABIRA', unitsSold: 30, stockUnits: 0 },
      ],
    ]),
  );

/** O pedido como a tela o recebe, vindo do motor. */
const pedidoDoMotor = (ids: string[]) =>
  buildPurchaseOrders(
    ids.map((id) => plano(id, 90, 3)),
    90,
    undefined,
    posicoes(ids),
  ).orders;

describe('destino do pedido · soma o rateio de TODOS os itens', () => {
  it('cada loja aparece uma vez, com a soma de todos os itens', () => {
    // Dois itens, as duas mesmas lojas. Se a soma estivesse errada, cada loja
    // apareceria duas vezes ou com o número de um item só — que é exatamente o
    // trabalho que o gestor fazia de cabeça.
    const orders = pedidoDoMotor(['p1', 'p2']);
    const esperado = new Map<string, number>();
    for (const o of orders) {
      for (const it of o.items) {
        for (const r of it.distribution?.rows ?? []) {
          esperado.set(r.storeName, (esperado.get(r.storeName) ?? 0) + r.suggestedQty);
        }
      }
    }
    expect(esperado.size, 'o cenário precisa produzir rateio para as duas lojas').toBe(2);

    render(<DestinoDoPedido orders={orders} />);

    for (const [loja, un] of esperado) {
      const linha = screen.getByText(loja).closest('span');
      expect(linha?.textContent, `destino de ${loja}`).toContain(String(un));
    }
  });

  it('o total endereçado fecha com a soma das lojas', () => {
    const orders = pedidoDoMotor(['p1', 'p2']);
    const soma = orders
      .flatMap((o) => o.items)
      .flatMap((it) => it.distribution?.rows ?? [])
      .reduce((a, r) => a + r.suggestedQty, 0);
    render(<DestinoDoPedido orders={orders} />);
    expect(screen.getByText(new RegExp(`${soma} un\\. endereçadas`))).toBeTruthy();
  });

  it('declara o que o rateio NÃO conseguiu endereçar', () => {
    // `unassigned` é o resto da divisão que o motor não atribuiu. Somir com ele
    // faria a soma por loja não fechar com o total do pedido, e o comprador
    // não teria como saber de quem é a diferença.
    const orders = pedidoDoMotor(['p1']);
    const sobra = orders[0].items.reduce((a, it) => a + (it.distribution?.unassigned ?? 0), 0);
    render(<DestinoDoPedido orders={orders} />);
    if (sobra > 0) {
      expect(screen.getByText(new RegExp(`${sobra} un\\. sem destino definido`))).toBeTruthy();
    } else {
      expect(screen.queryByText(/sem destino definido/)).toBeNull();
    }
  });
});

describe('destino do pedido · quando calar', () => {
  it('sem rateio nenhum, não desenha faixa vazia', () => {
    // Acontece com loja selecionada e com usuário sem visão de rede. A tela já
    // explica o motivo logo abaixo; uma faixa "Para onde vai" vazia sugeriria
    // que o cálculo falhou.
    const { container } = render(<DestinoDoPedido orders={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('itens sem distribuição não viram loja fantasma', () => {
    const orders = pedidoDoMotor(['p1']).map((o) => ({
      ...o,
      items: o.items.map((it) => ({ ...it, distribution: undefined })),
    }));
    const { container } = render(<DestinoDoPedido orders={orders} />);
    expect(container.firstChild).toBeNull();
  });
});
