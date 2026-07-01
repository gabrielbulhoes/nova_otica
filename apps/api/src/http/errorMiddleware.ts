import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from './helpers.js';
import { WindowClosedError } from '../integrations/sellbie/window.js';
import { logger } from '../lib/logger.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Dados inválidos', details: err.issues });
  }
  if (err instanceof WindowClosedError) {
    return res.status(409).json({ error: err.message, code: err.code });
  }
  const message = err instanceof Error ? err.message : 'Erro interno';
  logger.error('Erro não tratado na API', { error: message });
  return res.status(500).json({ error: 'Erro interno do servidor' });
}
