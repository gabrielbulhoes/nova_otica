import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { periodoDeDias } from '../src/http/periodo.js';
import { getKpis, getSalesByDimension } from '../src/modules/bi/bi.service.js';
import { stockPlannedWhere } from '../src/modules/stores/store.scope.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * "Os dados não estão confiáveis."
 *
 * A causa era esta: planejamento, relatórios, alertas e a cobertura do painel
 * já ignoravam as unidades de retaguarda (`excludeFromPlanning` — GMAIS,
 * ASSISTENCIA, ESTOQUE COMPRAS), e o BI e os indicadores do painel não. A
 * MESMA grandeza aparecia com números DIFERENTES em telas diferentes, e quem
 * confere duas telas e vê divergência para de confiar nas duas.
 *
 * Estes testes existem para que não volte a divergir. Janela larga de
 * propósito: o que está sob teste é o universo de lojas, não o período.
 */
const JANELA = 3650;

d('escopo de loja · o mesmo universo em todas as telas', () => {
  let cdId = '';
  let cdNome = '';

  beforeAll(async () => {
    const lojas = await prisma.store.findMany({ orderBy: { name: 'asc' } });
    if (lojas.length < 2) throw new Error('sem lojas suficientes no banco (rode o seed)');
    // Elege uma loja como retaguarda e garante que ela TEM movimento — senão
    // o teste passaria por não haver o que excluir.
    const comEstoque = await prisma.stockItem.groupBy({
      by: ['storeId'],
      where: { quantity: { gt: 0 } },
      _sum: { quantity: true },
    });
    const alvo = comEstoque.sort((a, b) => (b._sum.quantity ?? 0) - (a._sum.quantity ?? 0))[0];
    cdId = alvo.storeId;
    cdNome = lojas.find((l) => l.id === cdId)!.name;
    await prisma.store.update({ where: { id: cdId }, data: { excludeFromPlanning: true } });
  });

  afterAll(async () => {
    if (cdId) await prisma.store.update({ where: { id: cdId }, data: { excludeFromPlanning: false } });
  });

  it('KPI de estoque ignora a retaguarda', async () => {
    const kpis = await getKpis(periodoDeDias(JANELA));
    const rede = await prisma.stockItem.aggregate({ _sum: { quantity: true } });
    const retaguarda = await prisma.stockItem.aggregate({
      where: { storeId: cdId },
      _sum: { quantity: true },
    });

    expect(retaguarda._sum.quantity ?? 0).toBeGreaterThan(0);
    expect(kpis.stockUnits).toBe((rede._sum.quantity ?? 0) - (retaguarda._sum.quantity ?? 0));
  });

  it('KPI de estoque usa o MESMO filtro que planejamento e relatórios', async () => {
    // `stockPlannedWhere` é o contrato compartilhado. Enquanto o BI não o
    // usava, o painel e o relatório respondiam números diferentes para a
    // mesma pergunta — e é isso que o usuário confere olhando duas telas.
    const kpis = await getKpis(periodoDeDias(JANELA));
    const planejadas = await prisma.stockItem.aggregate({
      where: stockPlannedWhere,
      _sum: { quantity: true },
    });
    expect(kpis.stockUnits).toBe(planejadas._sum.quantity ?? 0);
  });

  it('a retaguarda não aparece no ranking de lojas', async () => {
    const r = await getSalesByDimension(periodoDeDias(JANELA), 'store');
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.map((x) => x.label)).not.toContain(cdNome);
  });

  it('faturamento cai ao excluir a retaguarda, e volta ao reincluí-la', async () => {
    const semCd = await getKpis(periodoDeDias(JANELA));
    await prisma.store.update({ where: { id: cdId }, data: { excludeFromPlanning: false } });
    const comCd = await getKpis(periodoDeDias(JANELA));
    await prisma.store.update({ where: { id: cdId }, data: { excludeFromPlanning: true } });

    expect(comCd.stockUnits).toBeGreaterThan(semCd.stockUnits);
  });
});
