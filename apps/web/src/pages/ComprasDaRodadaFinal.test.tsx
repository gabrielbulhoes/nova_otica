import { describe, expect, it } from 'vitest';
import { demoHandle } from '../api/demo';

/**
 * O MÓDULO DE COMPRAS DA RODADA FINAL — itens 04, 05, 07 e 08.
 *
 * As provas rodam contra o DISPATCHER da demonstração, que é o mesmo motor da
 * API (as duas chamam `buildPurchaseOrders`, `filtrarPedidos` e
 * `comporMixPorPerfil` de `@planning`). Um objeto escrito à mão aqui teria os
 * campos que o teste imaginou — e foi assim que uma coluna saiu vazia numa
 * entrega inteira com typecheck verde.
 */
/*
 * A JANELA VAI EXPLÍCITA. O dataset fictício da demonstração tem poucos dias
 * de venda: numa janela longa a demanda diária cai tanto que nada chega ao
 * ponto de reposição, e a lista de compras fica vazia — verdadeira, e inútil
 * como prova. 30 dias é a janela em que o dataset tem o que comprar.
 */
const pedir = (url: string, params: Record<string, unknown> = {}) =>
  demoHandle({ method: 'get', url, params: { days: '30', ...params } as Record<string, string>, body: {} }) as Record<
    string,
    any
  >;

const pedidos = (params: Record<string, unknown> = {}) => pedir('/planning/purchase-orders', params);
const itens = (r: Record<string, any>) => r.orders.flatMap((o: any) => o.items);

describe('item 04 · pedido por SKU, com sugerida e efetiva', () => {
  it('cada item traz SKU, faixa de preço, estoque, vendido, giro e a sugestão do motor', () => {
    const r = pedidos();
    const it = itens(r)[0];
    expect(it).toBeTruthy();
    expect(it.quantity).toBe(it.suggestedQty);
    expect(it.faixa.rotulo).toMatch(/^R\$ /);
    expect(typeof it.currentStock).toBe('number');
    expect(typeof it.unitsSold).toBe('number');
    expect(typeof it.giro).toBe('number');
    expect(it.unitPrice).toBeGreaterThan(0);
  });

  it('item 07 · toda linha traz a justificativa com estoque, vendas e giro', () => {
    for (const it of itens(pedidos())) {
      expect(it.justificativa).toContain('Estoque');
      expect(it.justificativa).toMatch(/vendeu \d/);
    }
  });
});

describe('item 08 · filtros combináveis', () => {
  it('sem filtro, nada é declarado e o total bate com o plano', () => {
    const r = pedidos();
    expect(r.filtros).toBeNull();
    expect(r.antesDoFiltro.items).toBe(r.summary.items);
  });

  it('o filtro corta, refaz os totais do pedido e preserva o total anterior', () => {
    const todos = pedidos();
    const alvo = itens(todos)[0];
    const so = pedidos({ faixa: String(alvo.faixa.indice) });
    expect(so.filtros).toBeTruthy();
    expect(so.antesDoFiltro.items).toBe(todos.summary.items);
    expect(so.summary.items).toBeLessThanOrEqual(todos.summary.items);
    for (const o of so.orders) {
      expect(o.items.every((x: any) => x.faixa.indice === alvo.faixa.indice)).toBe(true);
      // Totais refeitos: um pedido filtrado com o total antigo diria
      // "R$ 82 mil" sobre três linhas.
      expect(o.units).toBe(o.items.reduce((a: number, x: any) => a + x.quantity, 0));
    }
  });

  it('dois filtros combinam em E', () => {
    const alvo = itens(pedidos()).find((x: any) => x.brand);
    if (!alvo) return;
    const umSo = pedidos({ marca: alvo.brand });
    const dois = pedidos({ marca: alvo.brand, faixa: String(alvo.faixa.indice) });
    expect(dois.summary.items).toBeLessThanOrEqual(umSo.summary.items);
  });

  it('filtro sem correspondência devolve vazio — e diz quantos itens escondeu', () => {
    const r = pedidos({ sku: 'sku-que-nao-existe' });
    expect(r.orders).toHaveLength(0);
    expect(r.summary.items).toBe(0);
    expect(r.antesDoFiltro.items).toBeGreaterThan(0);
  });

  it('as opções de filtro trazem só o que existe no recorte', () => {
    const o = pedir('/planning/filtros');
    expect(o.itens).toBeGreaterThan(0);
    const marcasDoPlano = new Set(itens(pedidos()).map((x: any) => x.brand).filter(Boolean));
    for (const m of o.marcas) expect(marcasDoPlano.has(m)).toBe(true);
    for (const f of o.formatos) expect(f.rotulo).toBeTruthy();
  });
});

describe('item 05 · composição do mix por perfil', () => {
  it('declara a cobertura da ficha antes de recomendar', () => {
    const m = pedir('/planning/mix-por-perfil');
    expect(['confiavel', 'parcial', 'sem-base']).toContain(m.cobertura.leitura);
    expect(m.cobertura.aviso).toContain('Leitura feita sobre');
    // A demonstração tem peça sem ficha de propósito: sem isso a tela nunca
    // mostraria o aviso de leitura parcial.
    expect(m.cobertura.semFicha).toBeGreaterThan(0);
  });

  it('cruza participação nas vendas com participação no estoque, por perfil', () => {
    const m = pedir('/planning/mix-por-perfil');
    for (const l of m.linhas) {
      expect(l.perfil.genero).toBeTruthy();
      expect(l.perfil.formato).toBeTruthy();
      expect(l.perfil.material).toBeTruthy();
      expect(l.perfil.faixa.rotulo).toMatch(/^R\$ /);
      expect(l.vendasPct).toBeGreaterThanOrEqual(0);
      expect(l.estoquePct).toBeGreaterThanOrEqual(0);
      // Item 07 aqui também: nenhuma linha sem os números que a sustentam.
      expect(l.justificativa.length).toBeGreaterThan(0);
      if (l.situacao !== 'abaixo') expect(l.units).toBe(0);
    }
  });

  it('com meta declarada, a soma fecha exatamente na meta', () => {
    const m = pedir('/planning/mix-por-perfil', { meta: '25' });
    expect(m.modo).toBe('meta');
    expect(m.alocado + m.naoAlocado).toBe(25);
  });

  it('sem meta, o modo é diagnóstico e a soma é a falta reconhecida', () => {
    const m = pedir('/planning/mix-por-perfil');
    expect(m.modo).toBe('diagnostico');
    expect(m.alocado + m.naoAlocado).toBe(m.meta);
  });
});
