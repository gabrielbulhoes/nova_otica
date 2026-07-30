import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { stockAlerts } from '../src/modules/alerts/alerts.service.js';
import { abcCurve, coverageByBrand, inventoryTurnover } from '../src/modules/reports/reports.service.js';
import { resetProductScopeCache } from '../src/modules/products/product.scope.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * Feedbacks 3.0, itens 03 e 04: filtro por loja e por tipo de produto em
 * Alertas e em Relatórios — e, principalmente, o filtro NÃO pode desaparecer
 * quando se troca a dimensão da curva ABC de SKU para marca.
 *
 * Janela larga de propósito: o que está sob teste é o recorte, não o período.
 */
const JANELA = 3650;

d('filtro por loja e por tipo de produto (integração com Postgres)', () => {
  let tipo = '';
  let lojaId = '';

  beforeAll(async () => {
    resetProductScopeCache();
    // O tipo do teste sai do próprio banco: o seed fictício e os dados reais
    // do CDS não usam os mesmos rótulos de categoria.
    const cats = await prisma.product.groupBy({ by: ['category'], _count: { _all: true } });
    const armacao = cats.find((c) => (c.category ?? '').toLowerCase().startsWith('arma'));
    if (!armacao?.category) throw new Error('sem categoria de armação no banco (rode o seed)');
    tipo = armacao.category;
    const loja = await prisma.store.findFirst({ orderBy: { name: 'asc' } });
    if (!loja) throw new Error('sem loja no banco (rode o seed)');
    lojaId = loja.id;
  });

  it('alertas: o tipo de produto recorta a lista, e só sobra aquele tipo', async () => {
    const todos = await stockAlerts(undefined, 'principal');
    const so = await stockAlerts(undefined, 'principal', [tipo]);
    expect(so.rows.length).toBeGreaterThan(0);
    expect(so.rows.every((r) => r.category === tipo)).toBe(true);
    expect(so.total).toBeLessThanOrEqual(todos.total);
    expect(so.total).toBe(so.out + so.low);
  });

  it('alertas: escolher lente dentro do recorte principal não traz lente de volta', async () => {
    const lente = (await prisma.product.findFirst({ where: { category: { contains: 'ente' } } }))?.category;
    if (!lente) return; // banco sem lente: nada a provar aqui
    const r = await stockAlerts(undefined, 'principal', [lente]);
    expect(r.total).toBe(0);
  });

  it('alertas: a loja recorta para uma filial só', async () => {
    const r = await stockAlerts(lojaId, 'principal');
    expect(r.rows.every((x) => x.storeId === lojaId)).toBe(true);
  });

  it('curva ABC: o MESMO tipo recorta por SKU e por marca', async () => {
    const skuTudo = await abcCurve(JANELA, undefined, 'product', 'principal');
    const skuTipo = await abcCurve(JANELA, undefined, 'product', 'principal', [tipo]);
    expect(skuTipo.totalRevenue).toBeGreaterThan(0);
    expect(skuTipo.totalRevenue).toBeLessThan(skuTudo.totalRevenue);
    expect(skuTipo.rows.every((r) => r.category === tipo)).toBe(true);
    // Sem linha órfã: quem saiu do recorte sai do relatório, não vira "—".
    expect(skuTipo.rows.some((r) => r.label === '—')).toBe(false);

    const marcaTudo = await abcCurve(JANELA, undefined, 'brand', 'principal');
    const marcaTipo = await abcCurve(JANELA, undefined, 'brand', 'principal', [tipo]);
    // É este o ponto do feedback 04: trocar a dimensão não desliga o filtro.
    expect(marcaTipo.totalRevenue).toBeLessThan(marcaTudo.totalRevenue);
    // Mesma receita recortada, outro agrupamento.
    expect(Math.abs(marcaTipo.totalRevenue - skuTipo.totalRevenue)).toBeLessThan(1);
  });

  it('giro: fora do recorte, fora do relatório', async () => {
    const r = await inventoryTurnover(JANELA, undefined, 'principal', [tipo]);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.category === tipo)).toBe(true);
    expect(r.rows.some((x) => x.description === '—')).toBe(false);
  });

  it('cobertura por marca segue o mesmo recorte', async () => {
    const tudo = await coverageByBrand(JANELA, undefined, 'principal');
    const soTipo = await coverageByBrand(JANELA, undefined, 'principal', [tipo]);
    expect(soTipo.total.stockUnits).toBeGreaterThan(0);
    expect(soTipo.total.stockUnits).toBeLessThanOrEqual(tudo.total.stockUnits);
  });
});
