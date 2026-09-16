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
  it('cada item traz SKU, preço, estoque, vendido, giro e a sugestão do motor', () => {
    const r = pedidos();
    const it = itens(r)[0];
    expect(it).toBeTruthy();
    expect(it.quantity).toBe(it.suggestedQty);
    // A faixa de R$ 500 saiu da linha em 16/09/2026, a pedido do cliente.
    expect('faixa' in it).toBe(false);
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
    const so = pedidos({ categoria: alvo.category });
    expect(so.filtros).toBeTruthy();
    expect(so.antesDoFiltro.items).toBe(todos.summary.items);
    expect(so.summary.items).toBeLessThanOrEqual(todos.summary.items);
    for (const o of so.orders) {
      expect(o.items.every((x: any) => x.category === alvo.category)).toBe(true);
      // Totais refeitos: um pedido filtrado com o total antigo diria
      // "R$ 82 mil" sobre três linhas.
      expect(o.units).toBe(o.items.reduce((a: number, x: any) => a + x.quantity, 0));
    }
  });

  it('dois filtros combinam em E', () => {
    const alvo = itens(pedidos()).find((x: any) => x.brand);
    if (!alvo) return;
    const umSo = pedidos({ marca: alvo.brand });
    const dois = pedidos({ marca: alvo.brand, categoria: alvo.category });
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
      expect('faixa' in l.perfil).toBe(false);
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

// ─── O que a revisão adversarial encontrou, do lado da tela ─────────────────

describe('revisão · a quantidade efetiva e o arquivo que vai ao fornecedor', () => {
  it('o CSV segue a quantidade EDITADA, não a sugestão', async () => {
    const { orderCsv } = await import('../lib/rateio');
    const pedido = pedidos().orders[0];
    const item = pedido.items[0];

    const semEdicao = orderCsv(pedido);
    expect(semEdicao).toContain(String(item.suggestedQty));

    // Zerar é a forma de tirar a peça do pedido — e o arquivo precisa dizer
    // isso, senão a tela mostra um total e o fornecedor recebe outro.
    const zerado = orderCsv(pedido, { [item.productId]: 0 });
    const linhas = zerado.split('\n');
    const total = linhas.find((l) => l.includes('TOTAL DO PEDIDO'))!;
    const totalEsperado = pedido.items
      .filter((x: any) => x.productId !== item.productId)
      .reduce((a: number, x: any) => a + x.quantity, 0);
    expect(total).toContain(String(totalEsperado));
    // A sugestão original continua no arquivo, para a diferença ser auditável.
    expect(zerado).toContain('Sugerida (un.)');
  });

  it('o item do pedido traz a cor — a "variante" do item 04', () => {
    const comFicha = itens(pedidos()).find((x: any) => x.atributos);
    expect(comFicha, 'a demonstração precisa ter item com ficha').toBeTruthy();
    expect(comFicha.atributos).toHaveProperty('cor');
  });
});

describe('revisão · o login devolve a preferência de menu', () => {
  it('quem gravou "horizontal" não entra no layout padrão', () => {
    const antes = demoHandle({
      method: 'patch',
      url: '/auth/preferences',
      params: {},
      body: { menu: 'horizontal' },
    }) as any;
    expect(antes.preferences.menu).toBe('horizontal');
    const login = demoHandle({
      method: 'post',
      url: '/auth/login',
      params: {},
      body: { email: 'a@a.com', password: 'x' },
    }) as any;
    // Era aqui que a preferência se perdia: o contexto da interface é montado
    // a partir DESTA resposta, e ela não trazia `preferences`.
    expect(login.user.preferences.menu).toBe('horizontal');
  });
});
