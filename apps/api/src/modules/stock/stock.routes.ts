import { Router } from 'express';
import type { Request } from 'express';
import { asyncHandler, parseList, parsePaging } from '../../http/helpers.js';
import { scopedStoreId } from '../auth/auth.middleware.js';
import { listStock, stockByProduct } from './stock.service.js';

export const stockRouter = Router();

/**
 * Lojas do filtro (?storeId=a,b,c — multi-seleção). O gestor de loja segue
 * travado na própria loja, ignorando a lista pedida.
 */
function requestedStoreIds(req: Request): string[] | undefined {
  const scoped = scopedStoreId(req, undefined);
  if (scoped) return [scoped];
  return parseList(req.query.storeId);
}

/** GET /api/stock — estoque consolidado por loja/produto (saldo ao vivo). */
stockRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, page, skip } = parsePaging(req.query);
    const { total, rows } = await listStock({
      storeIds: requestedStoreIds(req),
      productId: req.query.productId as string | undefined,
      search: req.query.search as string | undefined,
      categories: parseList(req.query.category),
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
      parseList(req.query.category),
    );
    res.json({ total: rows.length, rows });
  }),
);
