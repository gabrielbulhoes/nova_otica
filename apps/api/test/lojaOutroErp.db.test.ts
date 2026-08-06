import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { getKpis, getSalesByDimension } from '../src/modules/bi/bi.service.js';
import {
  PLANNED_STORE_WHERE,
  plannedStoreIds,
  stockPlannedWhere,
} from '../src/modules/stores/store.scope.js';
import { planningInputs } from '../src/modules/planning/planning.service.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * Feedback 6.0 · item 01 — "tirar todas as lojas da ZEISS VISION CENTER da
 * solução. Ela roda em outro ERP, os dados não são atualizados em tempo real
 * dentro do CDS."
 *
 * O ponto delicado não é excluir: é excluir SEM mentir sobre o motivo. Já
 * existe um campo de exclusão (`excludeFromPlanning`), e ele significa
 * "retaguarda da rede" — o painel soma essas unidades num indicador com esse
 * rótulo. Reaproveitá-lo faria três lojas de varejo aparecerem como centro de
 * distribuição: trocaria um erro por outro, que foi exatamente a armadilha da
 * rodada em que quase escondemos 77 mil unidades.
 *
 * Daí os dois campos, e daí estes testes.
 */
const JANELA = 3650;

d('lojas em outro ERP · fora das contas, sem virar retaguarda', () => {
  let zeissId = '';
  let zeissNome = '';

  beforeAll(async () => {
    // Elege a loja com MAIS estoque como a "em outro ERP": o teste tem que
    // medir uma exclusão que muda número, não uma que não muda nada.
    const comEstoque = await prisma.stockItem.groupBy({
      by: ['storeId'],
      where: { quantity: { gt: 0 }, store: PLANNED_STORE_WHERE },
      _sum: { quantity: true },
    });
    if (comEstoque.length < 2) throw new Error('sem lojas com estoque (rode o seed)');
    const alvo = comEstoque.sort((a, b) => (b._sum.quantity ?? 0) - (a._sum.quantity ?? 0))[0];
    zeissId = alvo.storeId;
    zeissNome = (await prisma.store.findUniqueOrThrow({ where: { id: zeissId } })).name;
    await prisma.store.update({ where: { id: zeissId }, data: { externalErp: true } });
  });

  afterAll(async () => {
    if (zeissId) await prisma.store.update({ where: { id: zeissId }, data: { externalErp: false } });
  });

  it('sai do escopo planejável', async () => {
    expect(await plannedStoreIds()).not.toContain(zeissId);
  });

  it('sai do estoque do painel e do BI', async () => {
    const kpis = await getKpis(JANELA);
    const planejadas = await prisma.stockItem.aggregate({
      where: stockPlannedWhere,
      _sum: { quantity: true },
    });
    const dela = await prisma.stockItem.aggregate({
      where: { storeId: zeissId },
      _sum: { quantity: true },
    });
    expect(dela._sum.quantity ?? 0).toBeGreaterThan(0);
    expect(kpis.stockUnits).toBe(planejadas._sum.quantity ?? 0);
  });

  it('sai do ranking de lojas', async () => {
    const r = await getSalesByDimension(JANELA, 'store');
    expect(r.rows.map((x) => x.label)).not.toContain(zeissNome);
  });

  it('sai da matemática de planejamento', async () => {
    // O SQL cru do planejamento tinha a condição escrita à mão em seis lugares;
    // este teste é o que garante que o campo novo chegou lá também.
    const semZeiss = await planningInputs(JANELA);
    await prisma.store.update({ where: { id: zeissId }, data: { externalErp: false } });
    const comZeiss = await planningInputs(JANELA);
    await prisma.store.update({ where: { id: zeissId }, data: { externalErp: true } });

    const soma = (xs: { currentStock: number }[]) => xs.reduce((a, x) => a + x.currentStock, 0);
    expect(soma(comZeiss)).toBeGreaterThan(soma(semZeiss));
  });

  it('NÃO é contada como retaguarda — o erro que o campo separado evita', async () => {
    // Se `externalErp` tivesse virado só mais um caso de `excludeFromPlanning`,
    // as unidades da ZEISS apareceriam no painel sob o rótulo "retaguarda". A
    // loja continua sendo varejo; o que mudou é a confiança no dado dela.
    const retaguarda = await prisma.stockItem.aggregate({
      where: { store: { excludeFromPlanning: true, externalErp: false } },
      _sum: { quantity: true },
    });
    const dela = await prisma.stockItem.aggregate({
      where: { storeId: zeissId },
      _sum: { quantity: true },
    });
    const tudoRetaguarda = await prisma.stockItem.aggregate({
      where: { store: { excludeFromPlanning: true } },
      _sum: { quantity: true },
    });
    // A loja eleita não é retaguarda, então o agregado com e sem o segundo
    // filtro é o mesmo — e o estoque dela não está em nenhum dos dois.
    expect(retaguarda._sum.quantity ?? 0).toBe(tudoRetaguarda._sum.quantity ?? 0);
    expect(dela._sum.quantity ?? 0).toBeGreaterThan(0);
    const store = await prisma.store.findUniqueOrThrow({ where: { id: zeissId } });
    expect(store.excludeFromPlanning).toBe(false);
  });
});
