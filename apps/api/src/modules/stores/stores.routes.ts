import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, notFound } from '../../http/helpers.js';

export const storesRouter = Router();

/**
 * O ESCOPO DA LISTA — e por que ela precisou de um.
 *
 * "Lojas: assistência, estoque compras, GMais e Zeiss continuam gerando
 *  informações para o Nova Ótica. Idealmente, devemos desativar todos eles."
 *
 * O escopo de `store.scope.ts` já tirava as quatro de toda MATEMÁTICA —
 * planejamento, BI, relatórios, painel. O que ninguém tinha olhado é que esta
 * rota devolvia TODAS, e dez telas montam seus seletores com ela. As quatro
 * sumiram da conta e continuaram na interface: escolher ZEISS no Planejamento
 * abria uma tela vazia, e nada explicava por quê.
 *
 * Três escopos, e a diferença entre os dois primeiros é o que impede esta
 * correção de quebrar uma entrega da rodada passada:
 *
 *  · `planejaveis` (PADRÃO) — as 16 lojas de varejo. É o que quase toda tela
 *    quer, e ser o padrão é o ponto: a tela que não pensou no assunto acerta.
 *  · `operacionais` — inclui a RETAGUARDA (GMAIS, assistência, estoque de
 *    compras), exclui ZEISS. Existe para o lançamento de movimentação: o CD é
 *    a ORIGEM legítima da distribuição do recebimento, e tirá-lo da lista
 *    deixaria sem origem o fluxo entregue no feedback 6.0 · item 06. ZEISS
 *    fica fora aqui também — mexer em saldo de uma filial cujo número vem
 *    desatualizado de outro ERP é escrever ficção.
 *  · `todas` — a retaguarda de volta, para as telas que administram o próprio
 *    cadastro (lista de lojas, vínculo de usuário). **NÃO é o cadastro
 *    literal**: a filial em outro ERP não entra nem aqui — ver a nota no
 *    próprio campo, que registra a decisão do cliente que a tirou.
 */
export const ESCOPOS = {
  planejaveis: { excludeFromPlanning: false, externalErp: false },
  operacionais: { externalErp: false },
  /**
   * TODAS AS FILIAIS QUE A PLATAFORMA RECONHECE — e a ZEISS não é uma delas.
   *
   * Este escopo já foi `{}` (o cadastro literal), com a ZEISS aparecendo na
   * tela de Lojas sob um selo "outro ERP". A intenção era boa — esconder a
   * filial esconderia a linha que precisa ser conferida — e o cliente
   * discordou, pela segunda rodada seguida: *"Zeiss continua aparecendo.
   * Tirar totalmente do campo de visão."*
   *
   * Ele tem razão, e o argumento é dele: não há nada a conferir numa filial
   * cujos números a plataforma não usa e não atualiza. O selo transformava uma
   * exclusão limpa numa exceção que o operador precisa lembrar toda vez que lê
   * a lista.
   *
   * A RETAGUARDA CONTINUA. Ela é da rede, tem estoque de verdade e é a origem
   * da distribuição do recebimento — só não vende ao cliente.
   */
  todas: { externalErp: false },
} as const;

const escopoSchema = z.enum(['planejaveis', 'operacionais', 'todas']).default('planejaveis');

/** GET /api/stores — lista de lojas/filiais, escopada (ver `ESCOPOS`). */
storesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const escopo = escopoSchema.parse(req.query.escopo ?? undefined);

    // "SKUs em estoque" tem que ser SKU COM SALDO. `_count.stockItems` conta
    // toda linha de estoque, inclusive as zeradas — na rede real isso faz
    // filiais muito diferentes parecerem iguais, porque quase todo SKU tem
    // linha em quase toda loja (feedback do Galbe: "tá uniforme").
    const [stores, comSaldo] = await Promise.all([
      prisma.store.findMany({
        where: ESCOPOS[escopo],
        orderBy: { name: 'asc' },
        include: { _count: { select: { stockItems: true, sales: true } } },
      }),
      prisma.stockItem.groupBy({
        by: ['storeId'],
        where: { quantity: { gt: 0 } },
        _count: { productId: true },
      }),
    ]);
    const skusComSaldo = new Map(comSaldo.map((r) => [r.storeId, r._count.productId]));
    res.json({
      total: stores.length,
      // O escopo volta na resposta porque a tela precisa poder DIZER o que
      // está mostrando. Uma lista de 16 lojas numa rede de 20 é correta e
      // parece incompleta; sem o rótulo, quem olha conta e desconfia.
      escopo,
      rows: stores.map((s) => ({
        ...s,
        _count: { ...s._count, stockItems: skusComSaldo.get(s.id) ?? 0 },
      })),
    });
  }),
);

/** GET /api/stores/:id — detalhe de uma loja. */
storesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { stockItems: true, sales: true, sellers: true } } },
    });
    // Não basta sumir da lista: o id de uma filial em outro ERP continuava
    // resolvendo aqui, e um link antigo ou uma URL colada trazia a tela de
    // volta. "Fora do campo de visão" vale para a porta dos fundos também.
    if (!store || store.externalErp) throw notFound('Loja não encontrada');
    res.json(store);
  }),
);
