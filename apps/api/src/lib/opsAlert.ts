import { env } from '../config/env.js';
import { logger } from './logger.js';

const log = logger.child({ mod: 'ops-alert' });

export interface SyncAlertInput {
  trigger: string;
  window: string;
  durationMs: number;
  entities: Record<string, { read: number; written: number; error?: string }>;
}

/**
 * Monta o payload do alerta de falha do sync (puro, testável). O campo `text`
 * torna a mensagem legível em Slack/Discord/Teams/n8n sem template extra.
 */
export function buildSyncFailurePayload(input: SyncAlertInput) {
  const failed = Object.entries(input.entities)
    .filter(([, v]) => v.error)
    .map(([name, v]) => ({ entity: name, error: v.error as string }));
  const lines = failed.map((f) => `• ${f.entity}: ${f.error}`).join('\n');
  return {
    source: 'nova-otica',
    event: 'sync.failed',
    severity: 'error' as const,
    trigger: input.trigger,
    window: input.window,
    durationMs: input.durationMs,
    failures: failed,
    text: `⚠️ Sincronização Sellbie com falha (janela ${input.window}, gatilho ${input.trigger}):\n${lines}`,
  };
}

/** Payload do alerta de base vencida — o sync que não aconteceu. */
export function buildSyncStalePayload(input: { ultimoSucesso: Date | null; horas: number | null; limiteHoras: number }) {
  const quando = input.ultimoSucesso
    ? `${input.ultimoSucesso.toISOString()} (há ${Math.round(input.horas ?? 0)}h)`
    : 'NUNCA';
  return {
    source: 'nova-otica',
    event: 'sync.stale' as const,
    severity: 'error' as const,
    ultimoSucesso: input.ultimoSucesso?.toISOString() ?? null,
    horas: input.horas,
    limiteHoras: input.limiteHoras,
    text:
      `⚠️ Base VENCIDA: o último sync bem-sucedido foi ${quando}, ` +
      `acima do limite de ${input.limiteHoras}h.\n` +
      `O console está servindo dados antigos como se fossem de hoje.`,
  };
}

/**
 * Envia o alerta pelos canais configurados. Best-effort: erro no envio é
 * logado e nunca derruba o sync.
 *
 * Quando NENHUM canal está configurado — que era a situação em produção — o
 * alerta ao menos vira uma linha de nível `error` no log, com o payload
 * inteiro. Um `return` silencioso transforma a ausência de configuração na
 * ausência do próprio incidente, e é o tipo de coisa que só se descobre no dia
 * em que ele acontece.
 */
async function despachar(payload: { text: string; event: string }): Promise<void> {
  const destinos: Promise<void>[] = [];

  if (env.ALERT_WEBHOOK_URL) {
    destinos.push(
      (async () => {
        const res = await fetch(env.ALERT_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) log.warn('Webhook de alerta respondeu erro', { status: res.status });
      })(),
    );
  }

  if (env.ALERT_TELEGRAM_BOT_TOKEN && env.ALERT_TELEGRAM_CHAT_ID) {
    destinos.push(
      (async () => {
        const url = `https://api.telegram.org/bot${env.ALERT_TELEGRAM_BOT_TOKEN}/sendMessage`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: env.ALERT_TELEGRAM_CHAT_ID, text: payload.text }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) log.warn('Telegram respondeu erro', { status: res.status });
      })(),
    );
  }

  if (destinos.length === 0) {
    log.error('ALERTA SEM CANAL CONFIGURADO — configure ALERT_WEBHOOK_URL ou ALERT_TELEGRAM_*', payload);
    return;
  }

  const r = await Promise.allSettled(destinos);
  for (const x of r) {
    if (x.status === 'rejected') {
      log.warn('Falha ao enviar alerta', { error: String(x.reason), evento: payload.event });
    }
  }
}

/** Alerta de sync que RODOU e falhou. */
export async function notifySyncFailure(input: SyncAlertInput): Promise<void> {
  await despachar(buildSyncFailurePayload(input));
}

/** Alerta de sync que NÃO ACONTECEU — a base ficou velha em silêncio. */
export async function notifySyncStale(input: {
  ultimoSucesso: Date | null;
  horas: number | null;
  limiteHoras: number;
}): Promise<void> {
  await despachar(buildSyncStalePayload(input));
}
