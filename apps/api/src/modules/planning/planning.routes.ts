import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseDays } from '../../http/helpers.js';
import { requireRole, scopedStoreId } from '../auth/auth.middleware.js';
import {
  listSupplierSettings,
  planningOverview,
  purchaseSuggestions,
  rebalancePlan,
  setSupplierLeadTime,
} from './planning.service.js';

export const planningRouter = Router();

// Janela padrão do planejamento: 90 dias de histórico de vendas.
const days = (v: unknown) => parseDays(v, 90);

/** GET /api/planning/overview — capital imobilizado + Pareto + giro. */
planningRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await planningOverview(days(req.query.days), storeId));
  }),
);

/** GET /api/planning/purchase-suggestions — o que comprar e o que não comprar. */
planningRouter.get(
  '/purchase-suggestions',
  asyncHandler(async (req, res) => {
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await purchaseSuggestions(days(req.query.days), storeId));
  }),
);

/**
 * GET /api/planning/rebalance — transferências sugeridas entre lojas
 * (visão da rede: excesso/parado numa loja × falta na outra).
 */
planningRouter.get(
  '/rebalance',
  asyncHandler(async (req, res) => {
    res.json(await rebalancePlan(days(req.query.days)));
  }),
);

/** GET /api/planning/suppliers — fornecedores (marcas) e seus prazos. */
planningRouter.get(
  '/suppliers',
  asyncHandler(async (_req, res) => {
    res.json(await listSupplierSettings());
  }),
);

const supplierSchema = z.object({
  brand: z.string().min(1).max(120),
  leadTimeDays: z.number().int().min(1).max(365).nullable(),
});

/** PUT /api/planning/suppliers — define o prazo de um fornecedor (ADMIN). */
planningRouter.put(
  '/suppliers',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const input = supplierSchema.parse(req.body);
    res.json(await setSupplierLeadTime(input.brand, input.leadTimeDays));
  }),
);
