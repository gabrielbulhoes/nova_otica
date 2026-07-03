import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { asyncHandler, parsePaging } from '../../http/helpers.js';
import { scopedStoreId } from '../auth/auth.middleware.js';
import type { Actor } from '../movements/movements.service.js';
import { checkout, confirmPayment, getOrderView, listOrders } from './checkout.service.js';

export const ordersRouter = Router();

const actorOf = (req: Request): Actor => ({
  id: req.user!.id,
  role: req.user!.role,
  storeId: req.user!.storeId,
});

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

/** GET /api/orders/:id — detalhe do pedido (restrito ao dono/loja). */
ordersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await getOrderView(req.params.id, actorOf(req)));
  }),
);

/** POST /api/orders/:id/pay — confirma o pagamento (restrito ao dono/loja). */
ordersRouter.post(
  '/:id/pay',
  asyncHandler(async (req, res) => {
    res.json(await confirmPayment(req.params.id, actorOf(req)));
  }),
);
