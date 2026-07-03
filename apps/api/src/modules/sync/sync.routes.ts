import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../http/helpers.js';
import { requireRole } from '../auth/auth.middleware.js';
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

/** POST /api/sync/run — dispara uma sincronização manual (somente ADMIN). */
syncRouter.post(
  '/run',
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    // O controle de concorrência (evitar sync manual e agendado simultâneos)
    // vive em runFullSync via um lock compartilhado; aqui apenas repassamos.
    const result = await runFullSync('manual');
    if (result.skipped) {
      return res.status(409).json({ error: 'Já existe uma sincronização em andamento.' });
    }
    return res.status(result.ok ? 200 : 207).json(result);
  }),
);
