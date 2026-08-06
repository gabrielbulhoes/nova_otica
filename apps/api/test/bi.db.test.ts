import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { periodoDeDias } from '../src/http/periodo.js';
import {
  getHeatmap,
  getKpis,
  getSalesByDimension,
  getSalesFlow,
  getSalesTimeseries,
} from '../src/modules/bi/bi.service.js';
import { resetProductScopeCache } from '../src/modules/products/product.scope.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * "Os gráficos do BI não estão atualizando quando marcamos categorias
 * específicas": o módulo inteiro era cego a `group` e `category`. Estes testes
 * existem para que ele não volte a ser — e para que a API não divirja da demo,
 * que é onde o cliente enxerga.
 *
 * Janela larga: o que está sob teste é o recorte, não o período.
 */
const JANELA = 3650;

d('BI · o recorte de produto (integração com Postgres)', () => {
  let tipo = '';

  beforeAll(async () => {
    resetProductScopeCache();
    const cats = await prisma.product.groupBy({ by: ['category'], _count: { _all: true } });
    const armacao = cats.find((c) => (c.category ?? '').toLowerCase().startsWith('arma'));
    if (!armacao?.category) throw new Error('sem categoria de armação no banco (rode o seed)');
    tipo = armacao.category;
  });

  it('KPIs: o recorte muda faturamento, unidades vendidas e estoque', async () => {
    const tudo = await getKpis(periodoDeDias(JANELA), undefined, { group: 'todos' });
    const oculos = await getKpis(periodoDeDias(JANELA), undefined, { group: 'principal' });
    const lentes = await getKpis(periodoDeDias(JANELA), undefined, { group: 'lentes' });
    expect(oculos.revenue).toBeGreaterThan(0);
    expect(oculos.revenue).toBeLessThan(tudo.revenue);
    expect(oculos.revenue).not.toBe(lentes.revenue);
    expect(oculos.stockUnits).toBeLessThan(tudo.stockUnits);
    expect(oculos.unitsSold).toBeLessThan(tudo.unitsSold);
  });

  it('KPIs: com recorte, o faturamento é a soma dos ITENS — igual ao dos relatórios', async () => {
    const r = await getKpis(periodoDeDias(JANELA), undefined, { group: 'principal', categories: [tipo] });
    const itens = await prisma.saleItem.aggregate({
      where: { product: { category: tipo } },
      _sum: { total: true },
    });
    expect(r.revenue).toBeCloseTo(Number(itens._sum.total ?? 0), 1);
  });

  it('vendas por categoria: fora do recorte, fora do gráfico', async () => {
    const r = await getSalesByDimension(periodoDeDias(JANELA), 'category', undefined, { group: 'principal' });
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) expect(row.label.toLowerCase()).not.toContain('lente');
  });

  it('vendas por loja: com recorte, é a soma dos itens daquela loja', async () => {
    const cheio = await getSalesByDimension(periodoDeDias(JANELA), 'store', undefined, { group: 'todos' });
    const recorte = await getSalesByDimension(periodoDeDias(JANELA), 'store', undefined, { group: 'principal' });
    const soma = (x: { rows: { total: number }[] }) => x.rows.reduce((a, r) => a + r.total, 0);
    expect(soma(recorte)).toBeGreaterThan(0);
    expect(soma(recorte)).toBeLessThan(soma(cheio));
  });

  it('forma de pagamento vem MARCADA como aproximada — e só quando há recorte', async () => {
    // Um pagamento cobre a venda inteira: não se reparte por produto.
    const comRecorte = await getSalesByDimension(periodoDeDias(JANELA), 'payment', undefined, { group: 'principal' });
    expect(comRecorte.aproximado).toBe(true);
    const sem = await getSalesByDimension(periodoDeDias(JANELA), 'payment', undefined, { group: 'todos' });
    expect(sem.aproximado).toBeUndefined();
  });

  it('série diária e mapa de calor seguem o recorte', async () => {
    const tudo = await getSalesTimeseries(periodoDeDias(JANELA), undefined, { group: 'todos' });
    const recorte = await getSalesTimeseries(periodoDeDias(JANELA), undefined, { group: 'principal' });
    const soma = (p: { points: { total: number }[] }) => p.points.reduce((a, x) => a + x.total, 0);
    expect(soma(recorte)).toBeGreaterThan(0);
    expect(soma(recorte)).toBeLessThan(soma(tudo));

    const mapa = await getHeatmap(periodoDeDias(JANELA), undefined, { group: 'principal' });
    const mapaTudo = await getHeatmap(periodoDeDias(JANELA), undefined, { group: 'todos' });
    const total = (m: { cells: [number, number, number][] }) => m.cells.reduce((a, c) => a + c[2], 0);
    expect(total(mapa)).toBeLessThan(total(mapaTudo));
  });

  it('o sankey de vendas só traz categoria do recorte', async () => {
    const f = await getSalesFlow(periodoDeDias(JANELA), undefined, { group: 'principal', categories: [tipo] });
    const categorias = f.nodes.map((n) => n.name).filter((n) => n === tipo || n.toLowerCase().includes('lente'));
    expect(categorias.every((c) => c === tipo)).toBe(true);
  });
});
