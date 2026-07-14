import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Envolve um handler async encaminhando erros ao middleware de erro. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Erro de aplicação com status HTTP. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const notFound = (msg = 'Recurso não encontrado') => new HttpError(404, msg);

/** Converte Decimals do Prisma e demais valores para JSON amigável. */
export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Janela de dias (?days=) limitada a [1, max] — evita períodos desmedidos. */
export function parseDays(v: unknown, def = 30, max = 365): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= max ? Math.trunc(n) : def;
}

/**
 * Filtro de múltiplos valores em query string → array sem vazios (undefined
 * se nada sobrar). Aceita o parâmetro repetido (?storeId=a&storeId=b — como o
 * axios/qs serializam arrays), em que cada elemento vale LITERALMENTE (pode
 * conter vírgula), e também o atalho "a,b,c" num valor único.
 */
export function parseList(v: unknown): string[] | undefined {
  const parts = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const items = parts
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/** Paginação simples a partir de query string. */
export function parsePaging(query: Record<string, unknown>, defLimit = 50, maxLimit = 200) {
  const limit = Math.min(Math.max(Number(query.limit) || defLimit, 1), maxLimit);
  const page = Math.max(Number(query.page) || 1, 1);
  return { limit, page, skip: (page - 1) * limit };
}
