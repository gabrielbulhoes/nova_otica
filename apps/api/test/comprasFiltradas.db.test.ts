import { describe, expect, it } from 'vitest';
import { mixPorPerfil, opcoesDeFiltro, purchaseOrders } from '../src/modules/planning/planning.service.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * FILTROS DE COMPRA E COMPOSIÇÃO DO MIX, contra o banco — rodada final, itens
 * 05 e 08.
 *
 * O que estas provas guardam é a parte que não dá para ver lendo o código: que
 * o filtro é aplicado sobre o PLANO INTEIRO (e não sobre a página), que os
 * totais do pedido são refeitos depois de filtrar, e que a composição do mix
 * declara a cobertura da ficha antes de recomendar qualquer coisa.
 *
 * A janela é larga porque o que está sob teste é o recorte, não o período.
 */
const JANELA = 3650;

d('compras filtradas e composição do mix (integração com Postgres)', () => {
  it('sem filtro, a resposta traz o plano inteiro e nenhum filtro declarado', async () => {
    const r = await purchaseOrders(JANELA, undefined, 'principal');
    expect(r.filtros).toBeNull();
    expect(r.antesDoFiltro.items).toBe(r.summary.items);
    expect(r.summary.suppliers).toBe(r.orders.length);
  });

  it('o item de pedido nasce com sugerida e efetiva iguais, e com o contexto da linha', async () => {
    const r = await purchaseOrders(JANELA, undefined, 'principal');
    const item = r.orders.flatMap((o) => o.items)[0];
    if (!item) return; // banco sem compra a fazer: nada a provar aqui
    expect(item.quantity).toBe(item.suggestedQty);
    expect(item.faixa.rotulo).toMatch(/^R\$ /);
    expect(item.justificativa).toContain('Estoque');
    expect(item.giro).toBeGreaterThanOrEqual(0);
  });

  it('o filtro corta no servidor, refaz os totais e declara o total anterior', async () => {
    const todos = await purchaseOrders(JANELA, undefined, 'principal');
    const alvo = todos.orders.flatMap((o) => o.items)[0];
    if (!alvo) return;

    const so = await purchaseOrders(JANELA, undefined, 'principal', false, false, {
      faixa: [alvo.faixa.indice],
    });
    expect(so.filtros).toEqual({ faixa: [alvo.faixa.indice] });
    // O total ANTES do filtro acompanha a resposta: é o que permite à tela
    // dizer "12 de 340 itens".
    expect(so.antesDoFiltro.items).toBe(todos.summary.items);
    expect(so.summary.items).toBeLessThanOrEqual(todos.summary.items);
    expect(so.summary.items).toBeGreaterThan(0);
    for (const o of so.orders) {
      expect(o.items.every((it) => it.faixa.indice === alvo.faixa.indice)).toBe(true);
      // Totais REFEITOS: um pedido filtrado com o total antigo diria
      // "R$ 82 mil" sobre três linhas.
      expect(o.units).toBe(o.items.reduce((a, it) => a + it.quantity, 0));
      expect(o.total).toBeCloseTo(
        Math.round(o.items.reduce((a, it) => a + it.total, 0) * 100) / 100,
        2,
      );
    }
    expect(so.summary.total).toBeCloseTo(
      Math.round(so.orders.reduce((a, o) => a + o.total, 0) * 100) / 100,
      2,
    );
  });

  it('filtros combinam em E — o segundo estreita o resultado do primeiro', async () => {
    const todos = await purchaseOrders(JANELA, undefined, 'principal');
    const alvo = todos.orders.flatMap((o) => o.items).find((it) => it.brand);
    if (!alvo?.brand) return;

    const porMarca = await purchaseOrders(JANELA, undefined, 'principal', false, false, {
      marca: [alvo.brand],
    });
    const comFaixa = await purchaseOrders(JANELA, undefined, 'principal', false, false, {
      marca: [alvo.brand],
      faixa: [alvo.faixa.indice],
    });
    expect(comFaixa.summary.items).toBeLessThanOrEqual(porMarca.summary.items);
    expect(comFaixa.summary.items).toBeGreaterThan(0);
  });

  it('filtro que não casa com nada devolve lista vazia — sem inventar pedido', async () => {
    const r = await purchaseOrders(JANELA, undefined, 'principal', false, false, {
      sku: 'nao-existe-este-sku-em-lugar-nenhum',
    });
    expect(r.orders).toHaveLength(0);
    expect(r.summary.items).toBe(0);
    expect(r.summary.total).toBe(0);
    // E o total anterior continua ali, para a tela explicar o vazio.
    expect(r.antesDoFiltro.items).toBeGreaterThanOrEqual(0);
  });

  it('as opções de filtro trazem só o que existe no escopo', async () => {
    const o = await opcoesDeFiltro(JANELA, undefined, 'principal');
    expect(Array.isArray(o.marcas)).toBe(true);
    expect(Array.isArray(o.faixas)).toBe(true);
    // As listas fechadas só oferecem o que aparece no recorte.
    for (const f of o.formatos) expect(typeof f.rotulo).toBe('string');
    expect(o.itens).toBeGreaterThanOrEqual(0);
  });

  it('a composição do mix declara a cobertura ANTES de recomendar', async () => {
    const m = await mixPorPerfil(JANELA, undefined, 'principal');
    expect(['confiavel', 'parcial', 'sem-base']).toContain(m.cobertura.leitura);
    expect(m.cobertura.aviso).toContain('Leitura feita sobre');
    // A soma fecha sempre, nos dois modos.
    expect(m.alocado + m.naoAlocado).toBe(m.meta);
    // Perfil que não está abaixo nunca recebe unidade.
    for (const l of m.linhas) {
      if (l.situacao !== 'abaixo') expect(l.units).toBe(0);
      expect(l.justificativa.length).toBeGreaterThan(0);
    }
    // Base fraca (é o caso do banco de teste, sem ficha) não recomenda nada.
    if (m.cobertura.leitura === 'sem-base') expect(m.alocado).toBe(0);
  });

  it('com meta declarada, a soma fecha exatamente na meta', async () => {
    const m = await mixPorPerfil(JANELA, undefined, 'principal', 40);
    expect(m.modo).toBe('meta');
    expect(m.meta).toBe(40);
    expect(m.alocado + m.naoAlocado).toBe(40);
  });
});
