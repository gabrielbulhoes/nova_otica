import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../http/helpers.js';
import { requireRole } from '../auth/auth.middleware.js';
import { getSellbieClient } from '../../integrations/sellbie/index.js';
import { checkWindow } from '../../integrations/sellbie/window.js';
import { runFullSync } from '../../sync/syncService.js';
import { exportPaidOrdersToErp } from '../commerce/erpExport.service.js';

export const syncRouter = Router();

// Alçada única do módulo: sincronização e write-back movimentam o ERP real e
// disparam alertas — só a rede (ADMIN) opera. Mesmo padrão de users/fiscal.
// (As telas que consomem estas rotas já são exclusivas de ADMIN no painel.)
syncRouter.use(requireRole('ADMIN'));

/** GET /api/sync/status — estado da integração e da janela de uso. */
syncRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const win = checkWindow();
    const lastRuns = await prisma.syncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
    });
    res.json({
      mode: env.SELLBIE_MODE,
      window: win.window,
      windowOpen: win.allowed,
      now: win.now,
      cron: env.SYNC_CRON,
      timezone: env.SYNC_TIMEZONE,
      lastRuns,
    });
  }),
);

/** POST /api/sync/run — dispara uma sincronização manual. */
syncRouter.post(
  '/run',
  asyncHandler(async (_req, res) => {
    // Concorrência (scheduler × manual × outros processos) é tratada pela
    // trava do runFullSync, que responde 409 via SyncInProgressError.
    const result = await runFullSync('manual');
    return res.status(result.ok ? 200 : 207).json(result);
  }),
);

/**
 * POST /api/sync/export-orders — write-back manual: envia ao ERP os pedidos
 * online PAGOS ainda não exportados (POST /cds/inserirvenda), sem esperar o
 * próximo ciclo do sync. Idempotente por pedido (claim atômico + carimbo).
 * Corpo opcional: { "retryStuck": true } reprocessa envios interrompidos —
 * use SOMENTE após conferir no ERP (pelo pedidoSite) que a venda não entrou.
 */
syncRouter.post(
  '/export-orders',
  asyncHandler(async (req, res) => {
    // Fora do modo live não existe ERP real: carimbar erpExportedAt aqui
    // excluiria os pedidos do write-back para sempre após a virada.
    if (env.SELLBIE_MODE !== 'live') {
      return res.status(400).json({
        error: 'Write-back exige SELLBIE_MODE=live — em modo demonstração nada é exportado.',
      });
    }
    const retryStuck = Boolean((req.body as { retryStuck?: boolean } | undefined)?.retryStuck);
    const result = await exportPaidOrdersToErp(getSellbieClient(), { retryStuck });
    return res.json(result);
  }),
);
