import type { Request, RequestHandler } from 'express';
import { HttpError } from './helpers.js';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Limitador de taxa simples em memória (janela fixa). Suficiente para conter
 * força-bruta de login numa instância única. Em produção com múltiplas
 * instâncias, troque o store por algo compartilhado (ex.: Redis).
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  key?: (req: Request) => string;
  message?: string;
}): RequestHandler {
  const buckets = new Map<string, Bucket>();

  return (req, _res, next) => {
    const now = Date.now();

    // Limpeza oportunista para não crescer sem limite.
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }

    const key = opts.key ? opts.key(req) : req.ip ?? 'unknown';
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > opts.max) {
      const retry = Math.ceil((bucket.resetAt - now) / 1000);
      return next(new HttpError(429, opts.message ?? `Muitas tentativas. Tente novamente em ${retry}s.`));
    }
    return next();
  };
}
