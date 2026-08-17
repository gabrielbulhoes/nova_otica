import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { ESCOPOS } from '../src/modules/stores/stores.routes.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * Nova rodada · item 06 — "Lojas: assistência, estoque compras, GMais e Zeiss
 * continuam gerando informações para o Nova Ótica."
 *
 * O escopo de `store.scope.ts` já tirava as quatro de toda a MATEMÁTICA, e há
 * dois arquivos de teste inteiros (`escopoLoja.db`, `lojaOutroErp.db`)
 * provando isso. O que nenhum deles olhava é a LISTA: `GET /api/stores`
 * devolvia o cadastro inteiro, e dez telas montam seus seletores com ela.
 *
 * É a distância entre "sai da conta" e "sai da tela", e ela custou uma rodada
 * de feedback. Este arquivo cobre a segunda metade.
 */
d('escopo da lista de lojas · sai da conta E sai da tela', () => {
  let retaguardaId = '';
  let zeissId = '';
  let varejoId = '';

  beforeAll(async () => {
    const lojas = await prisma.store.findMany({ orderBy: { name: 'asc' }, select: { id: true } });
    if (lojas.length < 3) throw new Error('sem lojas suficientes no banco (rode o seed)');
    [retaguardaId, zeissId, varejoId] = lojas.map((l) => l.id);

    await prisma.store.update({
      where: { id: retaguardaId },
      data: { excludeFromPlanning: true, externalErp: false },
    });
    await prisma.store.update({
      where: { id: zeissId },
      data: { excludeFromPlanning: false, externalErp: true },
    });
    await prisma.store.update({
      where: { id: varejoId },
      data: { excludeFromPlanning: false, externalErp: false },
    });
  });

  afterAll(async () => {
    for (const id of [retaguardaId, zeissId, varejoId]) {
      if (id) {
        await prisma.store.update({
          where: { id },
          data: { excludeFromPlanning: false, externalErp: false },
        });
      }
    }
  });

  const ids = async (escopo: keyof typeof ESCOPOS) =>
    (await prisma.store.findMany({ where: ESCOPOS[escopo], select: { id: true } })).map((r) => r.id);

  it('planejáveis (o PADRÃO) deixa retaguarda e ZEISS de fora', async () => {
    const r = await ids('planejaveis');
    expect(r).toContain(varejoId);
    expect(r).not.toContain(retaguardaId);
    expect(r).not.toContain(zeissId);
  });

  it('operacionais traz a retaguarda de volta — e só ela', async () => {
    // O GMAIS é a ORIGEM da distribuição do recebimento. Tirá-lo do seletor de
    // movimentação deixaria sem origem o fluxo entregue no feedback 6.0 · 06:
    // uma tela mais limpa e quebrada.
    const r = await ids('operacionais');
    expect(r).toContain(varejoId);
    expect(r).toContain(retaguardaId);
    // ZEISS NÃO volta nem aqui: mexer em saldo de uma filial cujo número chega
    // desatualizado de outro ERP é escrever ficção sobre estoque real.
    expect(r).not.toContain(zeissId);
  });

  it('todas é o cadastro inteiro — e existe só para quem o administra', async () => {
    const r = await ids('todas');
    expect(r).toContain(varejoId);
    expect(r).toContain(retaguardaId);
    expect(r).toContain(zeissId);
  });

  it('os três escopos são encaixados, nunca cruzados', async () => {
    // Invariante: planejáveis ⊆ operacionais ⊆ todas. Se algum dia um escopo
    // ganhar um filtro que o outro não tem, esta linha quebra antes de a tela
    // mostrar uma loja em um seletor e não no outro.
    const [p, o, t] = await Promise.all([ids('planejaveis'), ids('operacionais'), ids('todas')]);
    expect(p.every((id) => o.includes(id))).toBe(true);
    expect(o.every((id) => t.includes(id))).toBe(true);
  });
});
