import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, notFound } from '../../http/helpers.js';

export const storesRouter = Router();

/** GET /api/stores — lista de lojas/filiais. */
storesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const stores = await prisma.store.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { stockItems: true, sales: true } } },
    });
    res.json({ total: stores.length, rows: stores });
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
