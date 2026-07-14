import { Router } from 'express';
import { asyncHandler, badRequest, parseDays } from '../../http/helpers.js';
import { scopedStoreId } from '../auth/auth.middleware.js';
import {
  abcCurve,
  coverageByBrand,
  inventoryTurnover,
  salesAnalysis,
  type AbcDimension,
  type AnalysisDimension,
} from './reports.service.js';

export const reportsRouter = Router();

/** GET /api/reports/abc — curva ABC por receita (dimension=product|brand). */
reportsRouter.get(
  '/abc',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    const dimension = (req.query.dimension as string | undefined) ?? 'product';
    if (dimension !== 'product' && dimension !== 'brand') {
      throw badRequest('dimension deve ser "product" ou "brand"');
    }
    res.json(await abcCurve(days, storeId, dimension as AbcDimension));
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

/** GET /api/reports/coverage — cobertura de estoque geral e por marca. */
reportsRouter.get(
  '/coverage',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await coverageByBrand(days, storeId));
  }),
);

const ANALYSIS_DIMENSIONS: AnalysisDimension[] = ['brand', 'category', 'product', 'store', 'seller'];

/** GET /api/reports/sales-analysis — vendas por dimensão, em unidades E receita. */
reportsRouter.get(
  '/sales-analysis',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    const by = (req.query.by as AnalysisDimension | undefined) ?? 'brand';
    if (!ANALYSIS_DIMENSIONS.includes(by)) {
      throw badRequest(`by deve ser um de: ${ANALYSIS_DIMENSIONS.join(', ')}`);
    }
    res.json(await salesAnalysis(days, by, storeId));
  }),
);
