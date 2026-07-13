import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { runFullSync, SyncInProgressError } from './syncService.js';

const log = logger.child({ mod: 'scheduler' });

let task: cron.ScheduledTask | null = null;

/**
 * Executa um sync. A exclusão mútua (scheduler × boot × manual, inclusive
 * entre processos) é garantida pela trava dentro de runFullSync.
 */
async function safeRun(trigger: 'schedule' | 'boot'): Promise<void> {
  try {
    await runFullSync(trigger);
  } catch (err) {
    if (err instanceof SyncInProgressError) {
      log.warn('Sync já em execução; ignorando gatilho', { trigger });
      return;
    }
    log.error('Erro não tratado no sync agendado', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Inicia o agendador diário e, opcionalmente, dispara um sync no boot. */
export function startScheduler(): void {
  if (!cron.validate(env.SYNC_CRON)) {
    log.error('SYNC_CRON inválido; agendador não iniciado', { cron: env.SYNC_CRON });
    return;
  }

  task = cron.schedule(env.SYNC_CRON, () => void safeRun('schedule'), {
    timezone: env.SYNC_TIMEZONE,
  });

  log.info('Agendador de sincronização ativo', {
    cron: env.SYNC_CRON,
    timezone: env.SYNC_TIMEZONE,
    mode: env.SELLBIE_MODE,
  });

  if (env.SYNC_ON_BOOT) {
    log.info('SYNC_ON_BOOT habilitado; disparando sync inicial');
    void safeRun('boot');
  }
}

export function stopScheduler(): void {
  task?.stop();
  task = null;
}
