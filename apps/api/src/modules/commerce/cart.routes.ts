import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/helpers.js';
import { addItem, clearCart, getCartView, removeItem, setItemQuantity } from './cart.service.js';

export const cartRouter = Router();

const addSchema = z.object({
  productId: z.string().min(1),
  storeId: z.string().min(1),
  quantity: z.number().int().positive().default(1),
});

/** GET /api/cart — carrinho aberto do usuário. */
cartRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await getCartView(req.user!.id));
  }),
);

/** POST /api/cart/items — adiciona item. */
cartRouter.post(
  '/items',
  asyncHandler(async (req, res) => {
    const input = addSchema.parse(req.body);
    res.status(201).json(await addItem(req.user!.id, input));
  }),
);

/** PATCH /api/cart/items/:productId — altera a quantidade. */
cartRouter.patch(
  '/items/:productId',
  asyncHandler(async (req, res) => {
    const { quantity } = z.object({ quantity: z.number().int() }).parse(req.body);
    res.json(await setItemQuantity(req.user!.id, req.params.productId, quantity));
  }),
);

/** DELETE /api/cart/items/:productId — remove item. */
cartRouter.delete(
  '/items/:productId',
  asyncHandler(async (req, res) => {
    res.json(await removeItem(req.user!.id, req.params.productId));
  }),
);

/** DELETE /api/cart — esvazia o carrinho. */
cartRouter.delete(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await clearCart(req.user!.id));
  }),
);
