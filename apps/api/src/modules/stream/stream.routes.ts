import { Router } from 'express';
import { subscribe } from '../../lib/eventBus.js';
import { verifyToken } from '../auth/auth.service.js';

export const streamRouter = Router();

/**
 * GET /api/stream — canal SSE de eventos em tempo real.
 *
 * O EventSource do navegador não envia cabeçalhos customizados, então o token
 * é validado via query string (`?token=`). Mantido fora do guard global de
 * auth por esse motivo. (Obs.: token em URL pode aparecer em logs — para
 * produção, avaliar cookie httpOnly ou WebSocket com handshake autenticado.)
 */
streamRouter.get('/', (req, res) => {
  const token = req.query.token as string | undefined;
  try {
    if (!token) throw new Error('sem token');
    verifyToken(token);
  } catch {
    res.status(401).json({ error: 'Token inválido ou ausente' });
    return;
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // evita buffering em proxies (nginx)
  });
  res.flushHeaders?.();
  res.write('event: ready\ndata: {}\n\n');

  const unsubscribe = subscribe((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  // Heartbeat para manter a conexão viva através de proxies.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
