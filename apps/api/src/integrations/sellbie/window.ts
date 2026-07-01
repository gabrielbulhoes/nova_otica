import { env } from '../../config/env.js';

/** Converte "HH:MM" em minutos desde a meia-noite. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export interface WindowCheck {
  allowed: boolean;
  now: string;
  window: string;
  reason?: string;
}

/**
 * A API Sellbie só pode ser consumida entre SELLBIE_WINDOW_START e
 * SELLBIE_WINDOW_END (padrão 06:00–07:00). Esta função decide se uma chamada
 * à API real é permitida agora. Em modo mock, ou com SELLBIE_IGNORE_WINDOW,
 * a trava é desativada.
 */
export function checkWindow(now = new Date()): WindowCheck {
  const window = `${env.SELLBIE_WINDOW_START}-${env.SELLBIE_WINDOW_END}`;
  const nowStr = now.toTimeString().slice(0, 5);

  if (env.SELLBIE_MODE === 'mock' || env.SELLBIE_IGNORE_WINDOW) {
    return { allowed: true, now: nowStr, window };
  }

  const cur = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(env.SELLBIE_WINDOW_START);
  const end = toMinutes(env.SELLBIE_WINDOW_END);

  // Suporta janelas que cruzam a meia-noite (start > end).
  const allowed = start <= end ? cur >= start && cur < end : cur >= start || cur < end;

  return {
    allowed,
    now: nowStr,
    window,
    reason: allowed
      ? undefined
      : `Fora da janela permitida pela API (${window}). Horário atual: ${nowStr}.`,
  };
}

/** Lança erro se a chamada não for permitida na janela atual. */
export function assertWindow(now = new Date()): void {
  const check = checkWindow(now);
  if (!check.allowed) {
    throw new WindowClosedError(check.reason ?? 'Fora da janela permitida.');
  }
}

export class WindowClosedError extends Error {
  readonly code = 'SELLBIE_WINDOW_CLOSED';
  constructor(message: string) {
    super(message);
    this.name = 'WindowClosedError';
  }
}
