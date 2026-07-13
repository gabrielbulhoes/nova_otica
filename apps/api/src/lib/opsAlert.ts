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

/**
 * Notifica a falha do sync via webhook genérico (ALERT_WEBHOOK_URL): um POST
 * JSON que funciona com Slack/Discord (via integração), n8n, Zapier etc.
 * Best-effort: erro no envio é logado e nunca derruba o sync.
 */
export async function notifySyncFailure(input: SyncAlertInput): Promise<void> {
  if (!env.ALERT_WEBHOOK_URL) return;
  const payload = buildSyncFailurePayload(input);
  try {
    const res = await fetch(env.ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) log.warn('Webhook de alerta respondeu erro', { status: res.status });
  } catch (err) {
    log.warn('Falha ao enviar alerta de sync', { error: err instanceof Error ? err.message : String(err) });
  }
}
