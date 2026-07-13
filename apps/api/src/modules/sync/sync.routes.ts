import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../http/helpers.js';
import { checkWindow } from '../../integrations/sellbie/window.js';
import { runFullSync } from '../../sync/syncService.js';

export const syncRouter = Router();

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
