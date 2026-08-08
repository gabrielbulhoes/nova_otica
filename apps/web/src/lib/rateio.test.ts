import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLANNING_CONFIG,
  analyzeProduct,
  buildPurchaseOrders,
  type FairSplitInput,
} from '@planning';
import type { PurchaseOrder } from '../api/client';
import { orderCsv, rotuloDoPeso } from './rateio';

/**
 * O CSV do pedido é montado a partir do pedido REAL — o mesmo
 * `buildPurchaseOrders` que a API e a demo chamam —, e não de um objeto
 * escrito à mão neste arquivo.
 *
 * É a diferença entre um teste e um espelho: com um objeto de mentira, a tela
 * podia ler `quantity` enquanto a API mandava `suggestedQty` e o arquivo saía
 * com todas as colunas de loja em ZERO sem que nada acusasse. Aqui o pedido
 * atravessa a mesma fronteira que atravessa em produção, e a atribuição a
 * `PurchaseOrder` (o tipo que a TELA declara) prende as duas pontas no
 * typecheck.
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

/** Cabeçalho + linhas do CSV como mapas rótulo → célula. */
const lerCsv = (csv: string) => {
  const [cabecalho, ...corpo] = csv.split('\n');
  const colunas = cabecalho.split(';');
  return corpo.map((linha) => {
    const celulas = linha.split(';');
    return Object.fromEntries(colunas.map((c, i) => [c, celulas[i]])) as Record<string, string>;
  });
};

const posicoes = (id: string): Map<string, FairSplitInput[]> =>
  new Map([
    [
      id,
      [
        { storeId: 's1', storeName: 'MIDWAY', unitsSold: 60, stockUnits: 0 },
        { storeId: 's2', storeName: 'GUARABIRA', unitsSold: 30, stockUnits: 0 },
      ],
    ],
  ]);

describe('orderCsv (CSV do pedido de compra)', () => {
  it('a coluna de cada loja leva as unidades rateadas, não zero', () => {
    // Zero é pior que vazio aqui: afirma que a loja não recebe nada. Foi
    // exatamente o que o arquivo exportado disse enquanto a tela lia um campo
    // que a API nunca mandou.
    const pedido: PurchaseOrder = buildPurchaseOrders([plano('p1', 90, 3)], 90, undefined, posicoes('p1'))
      .orders[0];
    const rateio = pedido.items[0].distribution!;
    expect(rateio.rows.length).toBe(2);

    const [item, total] = lerCsv(orderCsv(pedido));
    for (const r of rateio.rows) {
      expect(Number(item[r.storeName]), `coluna de ${r.storeName}`).toBe(r.suggestedQty);
      expect(Number(total[r.storeName]), `total de ${r.storeName}`).toBe(r.suggestedQty);
    }
    // E a soma das colunas de loja fecha com a quantidade do item: o CSV não
    // pode contar uma história diferente da tela.
    const somado = rateio.rows.reduce((a, r) => a + Number(item[r.storeName]), 0);
    expect(somado).toBe(Number(item.Quantidade) - rateio.unassigned);
  });

  it('sem rateio calculado, a coluna da loja fica VAZIA e não zero', () => {
    // Um item sem rateio ao lado de outro com rateio: as colunas de loja
    // existem por causa do primeiro, e o segundo não pode herdar zeros.
    const pedido: PurchaseOrder = buildPurchaseOrders(
      [plano('p1', 90, 3), plano('p2', 90, 3)],
      90,
      undefined,
      posicoes('p1'),
    ).orders[0];
    const linhas = lerCsv(orderCsv(pedido));
    const semRateio = linhas.find((l) => l.Produto.includes('p2'))!;
    expect(semRateio['Base do rateio']).toBe('não calculado');
    expect(semRateio.MIDWAY).toBe('');
    expect(semRateio.GUARABIRA).toBe('');
  });
});

describe('rotuloDoPeso (a coluna que explica a participação)', () => {
  it('na reserva, o rótulo diz de qual base veio o peso', () => {
    // Sem isso a tela mostra "Vendeu (12 m): 300" numa peça que a rede nunca
    // vendeu — o número é o da grife, e o rótulo mente sobre ele.
    expect(rotuloDoPeso('marca', '12 m')).toBe('Vendeu da grife (12 m)');
    expect(rotuloDoPeso('categoria', '12 m')).toBe('Vendeu da categoria (12 m)');
    expect(rotuloDoPeso('rede', '12 m')).toBe('Vendeu no total (12 m)');
  });

  it('quando o peso é a venda desta peça, o rótulo é o simples', () => {
    expect(rotuloDoPeso('necessidade', '90 dias')).toBe('Vendeu (90 dias)');
    expect(rotuloDoPeso('participacao', '90 dias')).toBe('Vendeu (90 dias)');
    expect(rotuloDoPeso('sku', '12 m')).toBe('Vendeu (12 m)');
  });
});
