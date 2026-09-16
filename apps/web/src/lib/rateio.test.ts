import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLANNING_CONFIG,
  analyzeProduct,
  buildPurchaseOrders,
  type FairSplitInput,
} from '@planning';
import type { PurchaseOrder } from '../api/client';
import { orderCsv, rotuloDoPeso , reescalarRateio } from './rateio';

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

  it('com um item sem rateio, a linha do TOTAL também fica vazia', () => {
    // O cuidado das linhas de item — vazio, não zero — era desmentido uma
    // linha abaixo: o TOTAL somava só os itens que TINHAM rateio e publicava o
    // resultado como número. Uma soma de subconjunto apresentada como total é
    // pior que célula vazia, porque parece conferível: quem abrisse o arquivo
    // encontraria colunas vazias que "somam" 5.
    const pedido: PurchaseOrder = buildPurchaseOrders(
      [plano('p1', 90, 3), plano('p2', 90, 3)],
      90,
      undefined,
      posicoes('p1'),
    ).orders[0];
    const linhas = lerCsv(orderCsv(pedido));
    const total = linhas.find((l) => l.Produto === 'TOTAL DO PEDIDO')!;
    expect(total.MIDWAY).toBe('');
    expect(total.GUARABIRA).toBe('');
    // A quantidade total do pedido continua sendo número: essa não depende de
    // rateio nenhum.
    expect(Number(total.Quantidade)).toBeGreaterThan(0);
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

/**
 * A REESCALA DO RATEIO — item de 16/09/2026.
 *
 * "Eu preciso saber, da compra, que a sugestão acompanhe a distribuição por
 *  loja: cada quantidade de cada SKU para cada loja em cada compra."
 *
 * O motor reparte a QUANTIDADE SUGERIDA entre as lojas. O comprador edita o
 * total antes de enviar, e é o total EDITADO que vai ao fornecedor — então o
 * rateio gravado precisa somar o editado, não o sugerido. Uma tabela cujo
 * rodapé não bate com o cabeçalho é lida como defeito, com razão.
 */
describe('reescalarRateio', () => {
  const rows = [
    { storeId: 'a', storeName: 'Natal', suggestedQty: 40 },
    { storeId: 'b', storeName: 'Mossoró', suggestedQty: 25 },
    { storeId: 'c', storeName: 'Guarabira', suggestedQty: 12 },
  ];

  it('sem edição, o rateio original passa intacto', () => {
    // Nada de recalcular o que já estava certo e arriscar mexer num número
    // por arredondamento.
    const r = reescalarRateio(rows, 77, 77);
    expect(r.lojas.map((l) => l.quantidade)).toEqual([40, 25, 12]);
    expect(r.semLoja).toBe(0);
  });

  it('a soma fecha EXATO no que o comprador levou, para cima e para baixo', () => {
    for (const efetiva of [1, 7, 30, 60, 76, 78, 100, 250]) {
      const r = reescalarRateio(rows, 77, efetiva);
      const soma = r.lojas.reduce((a, l) => a + l.quantidade, 0) + r.semLoja;
      expect(soma, `efetiva ${efetiva}`).toBe(efetiva);
    }
  });

  it('a proporção entre as lojas é preservada', () => {
    // 77 → 154 é o dobro exato; nenhuma loja pode ficar para trás.
    const r = reescalarRateio(rows, 77, 154);
    expect(r.lojas.map((l) => l.quantidade)).toEqual([80, 50, 24]);
  });

  it('o resto da divisão vai para quem tem o maior resto, não para o primeiro', () => {
    // 10 un. entre 40/25/12 (77): 5,19 · 3,25 · 1,56. Inteiros 5+3+1 = 9; a
    // sobra é 1 e cai em Guarabira, que tem o maior resto (0,56).
    const r = reescalarRateio(rows, 77, 10);
    expect(r.lojas.map((l) => l.quantidade)).toEqual([5, 3, 2]);
  });

  it('sem rateio nenhum, tudo fica declarado como "sem loja"', () => {
    // É o caso da visão de uma loja só, e de peça que nenhuma filial reclamou.
    // Sumir com as unidades seria pior: o pedido teria menos peças do que o
    // comprador enviou, sem nada na tela dizendo por quê.
    expect(reescalarRateio([], 0, 30)).toEqual({ lojas: [], semLoja: 30 });
    expect(reescalarRateio([{ storeId: 'a', storeName: 'Natal', suggestedQty: 0 }], 0, 5)).toEqual({
      lojas: [],
      semLoja: 5,
    });
  });
});
