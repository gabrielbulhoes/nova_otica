import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { runFullSync, SyncInProgressError } from './syncService.js';
import { getFrescor } from './syncHealth.js';
import { notifySyncHeartbeat, notifySyncStale } from '../lib/opsAlert.js';

const log = logger.child({ mod: 'scheduler' });

let task: cron.ScheduledTask | null = null;
let vigia: cron.ScheduledTask | null = null;

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

/**
 * Vigia do frescor: confere se houve sync bem-sucedido dentro do limite.
 *
 * O alerta de falha só dispara quando o sync ROda e falha. Container parado às
 * 6h, cron mal configurado, processo morto no meio — nesses casos o `SyncRun`
 * sequer é criado, e o console segue servindo os números da véspera com toda a
 * confiança do mundo. É o pior modo de falha de um sistema de tempo real,
 * porque se parece exatamente com o funcionamento normal.
 *
 * EXPORTADA para o teste poder chamá-la. A alternativa — testar
 * `notifySyncHeartbeat` direto — provaria a função e não a FIAÇÃO, que é
 * exatamente onde esta plataforma já se queimou: `stuckDaysByProduct` foi
 * escrita, testada e nunca chamada em produção. Um batimento que não é
 * disparado é pior que batimento nenhum, porque a ausência dele passa a
 * significar duas coisas em vez de uma.
 */
export async function conferirFrescor(): Promise<void> {
  try {
    const f = await getFrescor();
    if (!f.vencido) {
      log.info('Vigia: base em dia', { horas: f.horas === null ? null : Math.round(f.horas) });
      // BATIMENTO. Um canal que só fala quando há problema não distingue "tudo
      // bem" de "eu morri" — e este vigia roda DENTRO do processo que ele
      // vigia, então contêiner parado derruba os dois de uma vez e a ausência
      // de alerta fica idêntica à saúde.
      //
      // Foi exatamente a dúvida que a operação levantou: silêncio de dois dias
      // depois de um alerta de base vencida, sem como saber pelo Telegram se o
      // sync tinha voltado ou se o vigia tinha parado. Com o batimento, o
      // silêncio passa a ser o alarme.
      if (env.SYNC_HEARTBEAT) await notifySyncHeartbeat(f);
      return;
    }
    log.error('Vigia: BASE VENCIDA', {
      ultimoSucesso: f.ultimoSucesso?.toISOString() ?? null,
      horas: f.horas === null ? null : Math.round(f.horas),
      limiteHoras: f.limiteHoras,
    });
    await notifySyncStale(f);
  } catch (err) {
    log.error('Vigia: falha ao conferir frescor', {
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

  if (cron.validate(env.SYNC_WATCHDOG_CRON)) {
    vigia = cron.schedule(env.SYNC_WATCHDOG_CRON, () => void conferirFrescor(), {
      timezone: env.SYNC_TIMEZONE,
    });
    log.info('Vigia do frescor ativo', {
      cron: env.SYNC_WATCHDOG_CRON,
      limiteHoras: env.SYNC_STALE_HOURS,
      batimento: env.SYNC_HEARTBEAT,
    });
  } else {
    log.error('SYNC_WATCHDOG_CRON inválido; vigia não iniciado', { cron: env.SYNC_WATCHDOG_CRON });
  }

  if (env.SYNC_ON_BOOT) {
    log.info('SYNC_ON_BOOT habilitado; disparando sync inicial');
    void safeRun('boot');
  }
}

export function stopScheduler(): void {
  task?.stop();
  task = null;
  vigia?.stop();
  vigia = null;
}
