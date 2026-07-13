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
  /** Com storeId, define o mínimo SÓ daquela loja (sobrepõe o do produto). */
  storeId: z.string().min(1).optional(),
});

/**
 * PUT /api/alerts/min-stock — define o estoque mínimo (ADMIN). Sem storeId,
 * vale para o produto na rede toda; com storeId, só para aquela loja
 * (minStock nulo remove o override e volta ao padrão do produto/rede).
 */
alertsRouter.put(
  '/min-stock',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { productId, minStock, storeId } = minStockSchema.parse(req.body);
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw notFound('Produto não encontrado');

    if (storeId) {
      const store = await prisma.store.findUnique({ where: { id: storeId } });
      if (!store) throw notFound('Loja não encontrada');
      const item = await prisma.stockItem.upsert({
        where: { storeId_productId: { storeId, productId } },
        create: { storeId, productId, minStock },
        update: { minStock },
        select: { storeId: true, productId: true, minStock: true },
      });
      return res.json({ ...item, description: product.description, scope: 'store' });
    }

    const updated = await prisma.product.update({
      where: { id: productId },
      data: { minStock },
      select: { id: true, description: true, minStock: true },
    });
    res.json({ ...updated, scope: 'product' });
  }),
);
