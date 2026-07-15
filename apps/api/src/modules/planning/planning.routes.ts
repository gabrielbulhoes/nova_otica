import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseDays } from '../../http/helpers.js';
import type { ProductGroup } from './planning.math.js';
import { requireRole, scopedStoreId } from '../auth/auth.middleware.js';
import { publish } from '../../lib/eventBus.js';
import {
  fairSplit,
  listSupplierSettings,
  planningOverview,
  purchaseOrderHistory,
  purchaseOrders,
  purchaseSuggestions,
  rebalancePlan,
  registerPurchaseOrder,
  setSupplierLeadTime,
  settlePurchaseOrder,
} from './planning.service.js';

export const planningRouter = Router();

// Janela padrão do planejamento: 90 dias de histórico de vendas.
const days = (v: unknown) => parseDays(v, 90);

// Recorte de cobertura (?group=): principal | lentes | todos (padrão).
const group = (v: unknown): ProductGroup =>
  v === 'principal' || v === 'lentes' ? v : 'todos';

/** GET /api/planning/overview — capital imobilizado + Pareto + giro. */
planningRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await planningOverview(days(req.query.days), storeId, group(req.query.group)));
  }),
);

/** GET /api/planning/purchase-suggestions — o que comprar e o que não comprar. */
planningRouter.get(
  '/purchase-suggestions',
  asyncHandler(async (req, res) => {
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await purchaseSuggestions(days(req.query.days), storeId, group(req.query.group)));
  }),
);

/**
 * GET /api/planning/purchase-orders — rascunhos de ordem de compra por
 * fornecedor (marca), com total e data-limite do pedido.
 */
planningRouter.get(
  '/purchase-orders',
  asyncHandler(async (req, res) => {
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await purchaseOrders(days(req.query.days), storeId, group(req.query.group)));
  }),
);

/**
 * GET /api/planning/rebalance — transferências sugeridas entre lojas
 * (visão da rede: excesso/parado numa loja × falta na outra). Só ADMIN:
 * o plano não tem recorte por loja e expõe estoque/vendas da rede inteira.
 */
planningRouter.get(
  '/rebalance',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await rebalancePlan(days(req.query.days), group(req.query.group)));
  }),
);

const orderItemSchema = z.object({
  productId: z.string().min(1),
  description: z.string().max(240).default(''),
  quantity: z.number().int().min(1).max(100_000),
  unitCost: z.number().nonnegative().default(0),
  total: z.number().nonnegative().default(0),
});

const registerOrderSchema = z.object({
  supplier: z.string().min(1).max(120),
  leadTimeDays: z.number().int().min(1).max(365),
  items: z.array(orderItemSchema).min(1).max(500),
});

/**
 * POST /api/planning/purchase-orders — registra o pedido como ENVIADO ao
 * fornecedor (1ª confirmação). Enquanto em trânsito, as quantidades são
 * abatidas das próximas sugestões (posição = físico + a caminho).
 */
planningRouter.post(
  '/purchase-orders',
  asyncHandler(async (req, res) => {
    const input = registerOrderSchema.parse(req.body);
    const rec = await registerPurchaseOrder(input, req.user!.id);
    publish({ type: 'purchase-order.changed', recordId: rec.id });
    res.status(201).json(rec);
  }),
);

/** GET /api/planning/purchase-orders/history — histórico enviado/recebido. */
planningRouter.get(
  '/purchase-orders/history',
  asyncHandler(async (_req, res) => {
    res.json(await purchaseOrderHistory());
  }),
);

/**
 * POST /api/planning/purchase-orders/:id/receive — confirma o recebimento
 * (2ª confirmação do ciclo). /:id/cancel cancela um pedido em trânsito.
 */
planningRouter.post(
  '/purchase-orders/:id/:action(receive|cancel)',
  asyncHandler(async (req, res) => {
    const action = req.params.action as 'receive' | 'cancel';
    const rec = await settlePurchaseOrder(req.params.id, action, req.user!.id);
    publish({ type: 'purchase-order.changed', recordId: rec.id });
    res.json(rec);
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

/**
 * GET /api/planning/fair-split — Modo Feira: rateio de uma compra entre as
 * lojas pela participação nas vendas da marca OU do grupo. Só ADMIN.
 */
planningRouter.get(
  '/fair-split',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const qty = Math.trunc(Number(req.query.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 100_000) {
      res.status(400).json({ error: 'qty deve ser um inteiro entre 1 e 100000.' });
      return;
    }
    const brand = (req.query.brand as string | undefined)?.trim() || undefined;
    const category = (req.query.category as string | undefined)?.trim() || undefined;
    res.json(await fairSplit(days(req.query.days), { brand, category }, qty));
  }),
);
