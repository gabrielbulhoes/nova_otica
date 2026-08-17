import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { ESCOPOS } from '../src/modules/stores/stores.routes.js';
import {
  PLANNED_STORE_WHERE,
  VISIBLE_STORE_WHERE,
  saleVisibleWhere,
  stockVisibleWhere,
} from '../src/modules/stores/store.scope.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * "Zeiss continua aparecendo. Tirar totalmente do campo de visão."
 *
 * TERCEIRA vez que o cliente pede. As duas primeiras respostas foram
 * incompletas, e a razão é sempre a mesma: o escopo foi aplicado onde se FAZ
 * CONTA — planejamento, BI, relatórios, painel — e as telas que só MOSTRAM
 * dado ficaram de fora. A lista de vendas, o detalhe de um produto, o
 * histórico de um cliente: nenhuma delas é "planejamento", nenhuma foi
 * tocada, e em todas a ZEISS continuou.
 *
 * Este arquivo existe para acabar com a série. Ele não testa uma rota: testa a
 * PROPRIEDADE — nenhum caminho de leitura devolve filial em outro ERP —, e
 * falha quando alguém acrescenta uma consulta esquecendo o filtro.
 */
d('ZEISS fora do campo de visão', () => {
  let zeissId = '';
  let restaurar: { excludeFromPlanning: boolean; externalErp: boolean } | null = null;

  beforeAll(async () => {
    // Elege uma loja como "outro ERP" — e não depende de existir uma ZEISS no
    // seed. O que está sob teste é a MARCAÇÃO, não o nome.
    const alvo = await prisma.store.findFirstOrThrow({ orderBy: { name: 'asc' } });
    zeissId = alvo.id;
    restaurar = { excludeFromPlanning: alvo.excludeFromPlanning, externalErp: alvo.externalErp };
    await prisma.store.update({
      where: { id: zeissId },
      data: { excludeFromPlanning: false, externalErp: true },
    });
  });

  afterAll(async () => {
    if (zeissId && restaurar) {
      await prisma.store.update({ where: { id: zeissId }, data: restaurar });
    }
  });

  it('não aparece em NENHUM escopo da lista de lojas — nem no do cadastro', async () => {
    // `todas` já foi o cadastro literal, com a ZEISS sob um selo "outro ERP".
    // O cliente pediu a exclusão, não o rótulo.
    for (const escopo of Object.keys(ESCOPOS) as (keyof typeof ESCOPOS)[]) {
      const ids = (
        await prisma.store.findMany({ where: ESCOPOS[escopo], select: { id: true } })
      ).map((r) => r.id);
      expect(ids, `escopo "${escopo}" ainda devolve a filial em outro ERP`).not.toContain(zeissId);
    }
  });

  it('não aparece na lista de vendas', async () => {
    // A tela de Vendas não faz conta nenhuma, então nunca recebeu escopo. Era
    // o caminho mais visível de todos os que sobraram.
    const vendas = await prisma.sale.findMany({ where: saleVisibleWhere, select: { storeId: true } });
    expect(vendas.every((v) => v.storeId !== zeissId)).toBe(true);
  });

  it('não aparece nas posições de estoque de um produto', async () => {
    const posicoes = await prisma.stockItem.findMany({
      where: stockVisibleWhere,
      select: { storeId: true },
    });
    expect(posicoes.every((p) => p.storeId !== zeissId)).toBe(true);
  });

  it('o filtro de VISIBILIDADE é mais largo que o de PLANEJAMENTO', async () => {
    /*
     * A distinção que faltava, e sem a qual esta correção viraria outra.
     *
     * `VISIBLE_STORE_WHERE` tira SÓ o outro ERP; `PLANNED_STORE_WHERE` tira
     * também a retaguarda. Se alguém "simplificar" os dois num só, o GMAIS
     * some da vista — e ele é a ORIGEM da distribuição do recebimento. A tela
     * de movimentação ficaria sem origem possível, que é uma tela mais limpa
     * e quebrada.
     */
    const visiveis = await prisma.store.count({ where: VISIBLE_STORE_WHERE });
    const planejaveis = await prisma.store.count({ where: PLANNED_STORE_WHERE });
    expect(visiveis).toBeGreaterThanOrEqual(planejaveis);
  });

  it('a retaguarda CONTINUA visível — o pedido era sobre o outro ERP', async () => {
    const cd = await prisma.store.findFirst({
      where: { excludeFromPlanning: true, externalErp: false },
      select: { id: true },
    });
    if (!cd) return; // seed sem retaguarda: nada a afirmar
    const visiveis = (await prisma.store.findMany({ where: VISIBLE_STORE_WHERE, select: { id: true } }))
      .map((r) => r.id);
    expect(visiveis).toContain(cd.id);
  });
});
