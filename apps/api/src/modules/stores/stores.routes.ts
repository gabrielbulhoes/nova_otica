import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, notFound } from '../../http/helpers.js';

export const storesRouter = Router();

/** GET /api/stores — lista de lojas/filiais. */
storesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    // "SKUs em estoque" tem que ser SKU COM SALDO. `_count.stockItems` conta
    // toda linha de estoque, inclusive as zeradas — na rede real isso faz
    // filiais muito diferentes parecerem iguais, porque quase todo SKU tem
    // linha em quase toda loja (feedback do Galbe: "tá uniforme").
    const [stores, comSaldo] = await Promise.all([
      prisma.store.findMany({
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
    if (!store) throw notFound('Loja não encontrada');
    res.json(store);
  }),
);
