import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parsePaging } from '../../http/helpers.js';
import { scopedStoreId } from '../auth/auth.middleware.js';
import { checkout, confirmPayment, getOrderView, listOrders } from './checkout.service.js';

export const ordersRouter = Router();

const checkoutSchema = z.object({
  method: z.enum(['PIX', 'CARD', 'BOLETO']).optional(),
  customerName: z.string().max(120).optional(),
});

/** POST /api/orders — finaliza o carrinho (checkout) e abre o pagamento. */
ordersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = checkoutSchema.parse(req.body ?? {});
    res.status(201).json(await checkout(req.user!.id, input));
  }),
);

/** GET /api/orders — lista pedidos (escopo por papel). */
ordersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, page, skip } = parsePaging(req.query);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    const { total, rows } = await listOrders({ storeId, limit, skip });
    res.json({ total, page, limit, rows });
  }),
);

/** GET /api/orders/:id — detalhe do pedido. */
ordersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await getOrderView(req.params.id));
  }),
);

/** POST /api/orders/:id/pay — confirma o pagamento (simula webhook do gateway). */
ordersRouter.post(
  '/:id/pay',
  asyncHandler(async (req, res) => {
    res.json(await confirmPayment(req.params.id));
  }),
);
