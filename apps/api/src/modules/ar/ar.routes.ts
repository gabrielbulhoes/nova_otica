import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/helpers.js';
import { requireRole } from '../auth/auth.middleware.js';
import { createAsset, getAsset, listArProducts, recordTryOn, tryOnStats } from './ar.service.js';

export const arRouter = Router();

/** GET /api/ar/products — produtos elegíveis ao provador (asset + estoque). */
arRouter.get(
  '/products',
  asyncHandler(async (_req, res) => {
    const rows = await listArProducts();
    res.json({ total: rows.length, rows });
  }),
);

/** GET /api/ar/products/:id/asset — modelo + metadados de encaixe. */
arRouter.get(
  '/products/:id/asset',
  asyncHandler(async (req, res) => {
    res.json(await getAsset(req.params.id));
  }),
);

const assetSchema = z.object({
  type: z.enum(['GLB_3D', 'OVERLAY_2D']),
  url: z.string().url(),
  fit: z.record(z.unknown()).optional(),
});

/** POST /api/ar/products/:id/asset — publica uma nova versão do asset (ADMIN). */
arRouter.post(
  '/products/:id/asset',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const input = assetSchema.parse(req.body);
    res.status(201).json(await createAsset(req.params.id, input));
  }),
);

const tryOnSchema = z.object({
  productId: z.string().min(1),
  storeId: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  converted: z.boolean().optional(),
});

/** POST /api/ar/tryon-events — telemetria de prova (sem biometria). */
arRouter.post(
  '/tryon-events',
  asyncHandler(async (req, res) => {
    const input = tryOnSchema.parse(req.body);
    const event = await recordTryOn({ ...input, userId: req.user!.id });
    res.status(201).json({ id: event.id });
  }),
);

/** GET /api/ar/stats — funil de provas/conversão (para o BI). */
arRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const days = Number(req.query.days) || 30;
    res.json(await tryOnStats(days));
  }),
);
