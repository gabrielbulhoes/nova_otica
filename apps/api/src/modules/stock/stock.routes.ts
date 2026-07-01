import { Router } from 'express';
import { asyncHandler, parsePaging } from '../../http/helpers.js';
import { listStock, stockByProduct } from './stock.service.js';

export const stockRouter = Router();

/** GET /api/stock — estoque consolidado por loja/produto (saldo ao vivo). */
stockRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, page, skip } = parsePaging(req.query);
    const { total, rows } = await listStock({
      storeId: req.query.storeId as string | undefined,
      productId: req.query.productId as string | undefined,
      search: req.query.search as string | undefined,
      category: req.query.category as string | undefined,
      onlyAvailable: req.query.onlyAvailable === 'true' || req.query.only_disp === '1',
      limit,
      skip,
    });
    res.json({ total, page, limit, rows });
  }),
);

/** GET /api/stock/by-product — saldo somado por produto em toda a rede. */
stockRouter.get(
  '/by-product',
  asyncHandler(async (req, res) => {
    const rows = await stockByProduct(
      req.query.search as string | undefined,
      req.query.category as string | undefined,
    );
    res.json({ total: rows.length, rows });
  }),
);
