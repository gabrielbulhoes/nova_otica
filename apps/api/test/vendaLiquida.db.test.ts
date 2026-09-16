import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { plans } from '../src/modules/planning/planning.service.js';
import { itensDevolvidos } from '../src/modules/reports/reports.service.js';
import { fichaTecnica } from '../src/modules/products/ficha.service.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * A REGRA DA VENDA LÍQUIDA CONTRA O BANCO — rodada final final.
 *
 * O classificador é provado em `vendaLiquida.test.ts`, puro. O que este
 * arquivo prova é a outra metade, que é onde o defeito de verdade morava: se o
 * filtro CHEGA às consultas. Eram mais de vinte — giro, cobertura, curva ABC,
 * ficha da peça, sugestão de compra —, e uma que esquecesse o filtro não
 * quebraria: devolveria um número um pouco maior, que é o defeito mais caro
 * que existe.
 *
 * O cenário é o do cliente, montado com dados fictícios: a mesma peça vendida
 * três vezes, duas devolvidas. A resposta certa é UMA venda.
 */
const PREFIXO = `vliq_${Date.now()}`;

let productId = '';
let storeId = '';

d('venda líquida (integração com Postgres)', () => {
  beforeAll(async () => {
    const loja = await prisma.store.create({
      data: { externalId: `${PREFIXO}_loja`, name: 'Loja da devolução', city: 'Natal' },
    });
    storeId = loja.id;

    const p = await prisma.product.create({
      data: {
        externalId: `${PREFIXO}_p1`,
        sku: 'DEV001',
        description: 'OCULOS RAY BAN DEVOLVIDO E REVENDIDO',
        brand: 'LUXOTTICA BRASIL LTDA',
        category: 'OCULOS',
        price: 500,
        cost: 200,
        includedAt: new Date(Date.now() - 400 * 86_400_000),
      },
    });
    productId = p.id;

    // Três vendas da MESMA peça, em dias diferentes: a 1ª e a 2ª voltaram.
    const vendas: { dias: number; status: string; statusItem: string; devolvido: boolean }[] = [
      { dias: 20, status: 'Válido', statusItem: 'Devolvido', devolvido: true },
      { dias: 12, status: 'Válido', statusItem: 'Devolvido', devolvido: true },
      { dias: 4, status: 'Válido', statusItem: 'Válido', devolvido: false },
    ];
    for (const [i, v] of vendas.entries()) {
      const venda = await prisma.sale.create({
        data: {
          externalId: `${PREFIXO}_v${i}`,
          storeId,
          saleDate: new Date(Date.now() - v.dias * 86_400_000),
          total: 500,
          status: v.status,
        },
      });
      await prisma.saleItem.create({
        data: {
          externalId: `${PREFIXO}_i${i}`,
          saleId: venda.id,
          productId,
          quantity: 1,
          unitPrice: 500,
          total: 500,
          statusItem: v.statusItem,
          devolvido: v.devolvido,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.sale.deleteMany({ where: { externalId: { startsWith: PREFIXO } } });
    await prisma.product.deleteMany({ where: { externalId: { startsWith: PREFIXO } } });
    await prisma.store.deleteMany({ where: { externalId: { startsWith: PREFIXO } } });
  });

  it('o motor de compra conta UMA venda, não três', async () => {
    // Era o defeito: as três linhas entravam, e a peça aparecia com giro de
    // três unidades em trinta dias tendo vendido uma.
    const todos = await plans(30, undefined, 'todos');
    const p = todos.find((x) => x.productId === productId);
    expect(p, 'a peça precisa estar no plano para o teste dizer alguma coisa').toBeDefined();
    expect(p!.unitsSold).toBe(1);
  });

  it('a ficha da peça conta o mesmo que o motor — as duas telas não podem discordar', async () => {
    const f = await fichaTecnica(productId);
    expect(f).not.toBeNull();
    const janela = f!.vendas.periodos.find((j) => j.dias === 30)!;
    expect(janela.unidades).toBe(1);
    expect(janela.receita).toBe(500);
  });

  it('o relatório de devoluções é o ÚNICO lugar onde as duas aparecem', async () => {
    const r = await itensDevolvidos(30, storeId);
    const minhas = r.itens.filter((i) => i.productId === productId);
    expect(minhas).toHaveLength(2);
    expect(minhas.every((i) => i.status === 'Devolvido')).toBe(true);
    expect(minhas.reduce((a, i) => a + i.quantidade, 0)).toBe(2);
  });

  it('o relatório lista TODOS os status vistos, inclusive os que contam como venda', async () => {
    // É a metade que permite conferir o dicionário contra o dado real: um
    // status que o dicionário não conhece aparece aqui com `devolucao: false`
    // e a contagem dele, em vez de sumir dentro de um total que ninguém sabe
    // que está errado.
    const r = await itensDevolvidos(30, storeId);
    const vistos = new Map(r.statusVistos.map((s) => [s.status, s]));
    expect(vistos.get('Devolvido')).toMatchObject({ devolucao: true, itens: 2 });
    expect(vistos.get('Válido')).toMatchObject({ devolucao: false, itens: 1 });
  });
});
