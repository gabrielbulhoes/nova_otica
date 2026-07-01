import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, notFound } from '../../http/helpers.js';
import { requireRole, scopedStoreId } from '../auth/auth.middleware.js';
import { stockAlerts } from './alerts.service.js';

export const alertsRouter = Router();

/** GET /api/alerts — alertas de ruptura e estoque baixo (escopo por loja). */
alertsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await stockAlerts(storeId));
  }),
);

const minStockSchema = z.object({
  productId: z.string().min(1),
  minStock: z.number().int().nonnegative().nullable(),
});

/** PUT /api/alerts/min-stock — define o estoque mínimo de um produto (ADMIN). */
alertsRouter.put(
  '/min-stock',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { productId, minStock } = minStockSchema.parse(req.body);
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw notFound('Produto não encontrado');
    const updated = await prisma.product.update({
      where: { id: productId },
      data: { minStock },
      select: { id: true, description: true, minStock: true },
    });
    res.json(updated);
  }),
);
