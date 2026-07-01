import { Router } from 'express';
import { asyncHandler } from '../../http/helpers.js';
import { scopedStoreId } from '../auth/auth.middleware.js';
import { planningOverview, purchaseSuggestions } from './planning.service.js';

export const planningRouter = Router();

const parseDays = (v: unknown, def = 90) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 365 ? Math.trunc(n) : def;
};

/** GET /api/planning/overview — capital imobilizado + Pareto + giro. */
planningRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await planningOverview(days, storeId));
  }),
);

/** GET /api/planning/purchase-suggestions — o que comprar e o que não comprar. */
planningRouter.get(
  '/purchase-suggestions',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await purchaseSuggestions(days, storeId));
  }),
);
