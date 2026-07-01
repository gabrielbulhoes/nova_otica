import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parsePaging } from '../../http/helpers.js';
import { scopedStoreId } from '../auth/auth.middleware.js';
import {
  approveMovement,
  cancelMovement,
  confirmMovement,
  createMovement,
  createMovementSchema,
  listMovements,
  rejectMovement,
  type Actor,
} from './movements.service.js';

export const movementsRouter = Router();

const actorOf = (req: import('express').Request): Actor => ({
  id: req.user!.id,
  role: req.user!.role,
  storeId: req.user!.storeId,
});

const noteSchema = z.object({ note: z.string().max(280).optional() });

/** GET /api/movements — lista movimentações (escopo por loja p/ gestor de loja). */
movementsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, page, skip } = parsePaging(req.query);
    const { total, rows } = await listMovements({
      status: req.query.status as string | undefined,
      storeId: scopedStoreId(req, req.query.storeId as string | undefined),
      productId: req.query.productId as string | undefined,
      limit,
      skip,
    });
    res.json({ total, page, limit, rows });
  }),
);

/** POST /api/movements — cria transferência/baixa/entrada/ajuste. */
movementsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createMovementSchema.parse(req.body);
    const movement = await createMovement(input, actorOf(req));
    res.status(201).json(movement);
  }),
);

/** POST /api/movements/:id/approve — ADMIN aprova a solicitação. */
movementsRouter.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const { note } = noteSchema.parse(req.body ?? {});
    res.json(await approveMovement(req.params.id, actorOf(req), note));
  }),
);

/** POST /api/movements/:id/reject — ADMIN rejeita a solicitação. */
movementsRouter.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const { note } = noteSchema.parse(req.body ?? {});
    res.json(await rejectMovement(req.params.id, actorOf(req), note));
  }),
);

/** POST /api/movements/:id/confirm — efetiva a movimentação. */
movementsRouter.post(
  '/:id/confirm',
  asyncHandler(async (req, res) => {
    res.json(await confirmMovement(req.params.id, actorOf(req)));
  }),
);

/** POST /api/movements/:id/cancel — cancela a movimentação. */
movementsRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    res.json(await cancelMovement(req.params.id, actorOf(req)));
  }),
);
