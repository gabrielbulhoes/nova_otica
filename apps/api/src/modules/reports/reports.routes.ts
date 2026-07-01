import { Router } from 'express';
import { asyncHandler } from '../../http/helpers.js';
import { scopedStoreId } from '../auth/auth.middleware.js';
import { abcCurve, inventoryTurnover } from './reports.service.js';

export const reportsRouter = Router();

const parseDays = (v: unknown, def = 30) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 365 ? Math.trunc(n) : def;
};

/** GET /api/reports/abc — curva ABC por receita. */
reportsRouter.get(
  '/abc',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await abcCurve(days, storeId));
  }),
);

/** GET /api/reports/turnover — giro de estoque no período. */
reportsRouter.get(
  '/turnover',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await inventoryTurnover(days, storeId));
  }),
);
