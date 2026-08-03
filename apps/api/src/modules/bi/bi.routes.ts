import { Router } from 'express';
import { asyncHandler, badRequest, parseDays, parseList } from '../../http/helpers.js';
import { scopedStoreId } from '../auth/auth.middleware.js';
import { parseGroup } from '../products/product.scope.js';
import {
  getHeatmap,
  getKpis,
  getSalesByDimension,
  getSalesFlow,
  getSalesTimeseries,
  getTransferFlow,
  type Dimension,
} from './bi.service.js';

export const biRouter = Router();

const DIMENSIONS: Dimension[] = ['store', 'category', 'brand', 'payment'];

/**
 * Recorte de produto (?group= e ?category=), igual ao de Alertas e Relatórios.
 * O BI inteiro era cego a ele: trocar o recorte no topo do console não mexia um
 * gráfico sequer. `parseGroup` cai em 'todos' quando não vem nada, então a
 * rota continua compatível com quem chama sem o parâmetro.
 */
const recorte = (req: { query: Record<string, unknown> }) => ({
  group: parseGroup(req.query.group),
  categories: parseList(req.query.category),
});

/** GET /api/bi/kpis — indicadores agregados (gauges/cartões). */
biRouter.get(
  '/kpis',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json({ days, ...(await getKpis(days, storeId, recorte(req))) });
  }),
);

/** GET /api/bi/sales-timeseries — série temporal diária de vendas. */
biRouter.get(
  '/sales-timeseries',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await getSalesTimeseries(days, storeId, recorte(req)));
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
    res.json(await getSalesByDimension(days, by, storeId, recorte(req)));
  }),
);

/** GET /api/bi/sales-flow — Sankey Categoria → Loja. */
biRouter.get(
  '/sales-flow',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await getSalesFlow(days, storeId, recorte(req)));
  }),
);

/** GET /api/bi/transfer-flow — Sankey de transferências Origem → Destino. */
biRouter.get(
  '/transfer-flow',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await getTransferFlow(days, storeId, recorte(req)));
  }),
);

/** GET /api/bi/heatmap — receita por loja × dia da semana. */
biRouter.get(
  '/heatmap',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await getHeatmap(days, storeId, recorte(req)));
  }),
);
