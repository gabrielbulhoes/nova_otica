import { Router } from 'express';
import { asyncHandler, parsePaging } from '../../http/helpers.js';
import {
  cancelMovement,
  confirmMovement,
  createMovement,
  createMovementSchema,
  listMovements,
} from './movements.service.js';

export const movementsRouter = Router();

/** GET /api/movements — lista movimentações internas. */
movementsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, page, skip } = parsePaging(req.query);
    const { total, rows } = await listMovements({
      status: req.query.status as string | undefined,
      storeId: req.query.storeId as string | undefined,
      productId: req.query.productId as string | undefined,
      limit,
      skip,
    });
    res.json({ total, page, limit, rows });
  }),
);

/** POST /api/movements — registra transferência/baixa/entrada/ajuste. */
movementsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createMovementSchema.parse(req.body);
    const movement = await createMovement(input);
    res.status(201).json(movement);
  }),
);

/** POST /api/movements/:id/confirm — efetiva a movimentação. */
movementsRouter.post(
  '/:id/confirm',
  asyncHandler(async (req, res) => {
    res.json(await confirmMovement(req.params.id));
  }),
);

/** POST /api/movements/:id/cancel — cancela a movimentação. */
movementsRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    res.json(await cancelMovement(req.params.id));
  }),
);
