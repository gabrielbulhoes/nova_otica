import { Router } from 'express';
import { asyncHandler } from '../../http/helpers.js';
import { requireRole } from '../auth/auth.middleware.js';
import { emitOrderNfce, emitTransferNfe, listFiscalDocuments } from './fiscal.service.js';

export const fiscalRouter = Router();

// Emissão fiscal é ato da rede (ADMIN) — por filial fica para o RBAC ampliado.
fiscalRouter.use(requireRole('ADMIN'));

/** GET /api/fiscal/documents — documentos fiscais emitidos. */
fiscalRouter.get(
  '/documents',
  asyncHandler(async (_req, res) => {
    res.json({ rows: await listFiscalDocuments() });
  }),
);

/** POST /api/fiscal/orders/:id/nfce — emite a NFC-e de um pedido pago. */
fiscalRouter.post(
  '/orders/:id/nfce',
  asyncHandler(async (req, res) => {
    res.json(await emitOrderNfce(req.params.id));
  }),
);

/** POST /api/fiscal/movements/:id/nfe — NF-e de transferência efetivada. */
fiscalRouter.post(
  '/movements/:id/nfe',
  asyncHandler(async (req, res) => {
    res.json(await emitTransferNfe(req.params.id));
  }),
);
