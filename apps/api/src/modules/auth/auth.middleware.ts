import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Role } from '@prisma/client';
import { HttpError } from '../../http/helpers.js';
import { verifyToken } from './auth.service.js';

/** Exige um token JWT válido; popula req.user. */
export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new HttpError(401, 'Autenticação necessária'));
  }
  try {
    const payload = verifyToken(header.slice(7));
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      storeId: payload.storeId,
    };
    return next();
  } catch {
    return next(new HttpError(401, 'Token inválido ou expirado'));
  }
};

/** Exige que o usuário tenha um dos papéis informados. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Autenticação necessária'));
    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, 'Acesso negado para o seu perfil'));
    }
    return next();
  };

/**
 * Resolve o filtro de loja respeitando o escopo do usuário:
 * - ADMIN pode consultar qualquer loja (ou todas, se não filtrar);
 * - STORE_MANAGER é sempre restrito à própria loja, ignorando o que pedir.
 */
export function scopedStoreId(req: Request, requested?: string): string | undefined {
  if (req.user?.role === 'STORE_MANAGER') return req.user.storeId ?? '__none__';
  return requested;
}

/**
 * Garante que o STORE_MANAGER só opere na própria loja. Falha fechado:
 * gerente sem loja associada, ou recurso sem loja/de outra loja → negado.
 */
export function assertStoreAccess(req: Request, storeId?: string | null): void {
  if (req.user?.role !== 'STORE_MANAGER') return;
  if (!req.user.storeId || !storeId || storeId !== req.user.storeId) {
    throw new HttpError(403, 'Você só pode operar na sua própria loja');
  }
}
