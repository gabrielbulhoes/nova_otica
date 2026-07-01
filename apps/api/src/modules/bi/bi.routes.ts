import { Router } from 'express';
import { asyncHandler, badRequest } from '../../http/helpers.js';
import { scopedStoreId } from '../auth/auth.middleware.js';
import {
  getHeatmap,
  getKpis,
  getSalesByDimension,
  getSalesFlow,
  getSalesTimeseries,
  type Dimension,
} from './bi.service.js';

export const biRouter = Router();

const parseDays = (v: unknown, def = 30) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 365 ? Math.trunc(n) : def;
};

const DIMENSIONS: Dimension[] = ['store', 'category', 'brand', 'payment'];

/** GET /api/bi/kpis — indicadores agregados (gauges/cartões). */
biRouter.get(
  '/kpis',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json({ days, ...(await getKpis(days, storeId)) });
  }),
);

/** GET /api/bi/sales-timeseries — série temporal diária de vendas. */
biRouter.get(
  '/sales-timeseries',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await getSalesTimeseries(days, storeId));
  }),
);

/** GET /api/bi/sales-by-dimension?by=store|category|brand|payment */
biRouter.get(
  '/sales-by-dimension',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const by = (req.query.by as Dimension) ?? 'store';
    if (!DIMENSIONS.includes(by)) {
      throw badRequest(`Dimensão inválida. Use uma de: ${DIMENSIONS.join(', ')}.`);
    }
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await getSalesByDimension(days, by, storeId));
  }),
);

/** GET /api/bi/sales-flow — Sankey Categoria → Loja. */
biRouter.get(
  '/sales-flow',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await getSalesFlow(days, storeId));
  }),
);

/** GET /api/bi/heatmap — receita por loja × dia da semana. */
biRouter.get(
  '/heatmap',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await getHeatmap(days, storeId));
  }),
);
