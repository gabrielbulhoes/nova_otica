import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { subscribe } from '../../lib/eventBus.js';
import { requireAuth } from '../auth/auth.middleware.js';

export const streamRouter = Router();

/**
 * O EventSource do navegador não envia cabeçalhos customizados, então a
 * conexão SSE é autorizada por um *ticket* efêmero de uso único: o cliente
 * autenticado pede o ticket via POST (com Bearer no cabeçalho) e o consome
 * na query string. O JWT nunca aparece em URL (histórico, logs, referrer).
 */
const TICKET_TTL_MS = 60_000;
const MAX_TICKETS = 1_000; // teto de segurança contra emissão em massa
const tickets = new Map<string, number>(); // ticket -> expiresAt (epoch ms)

function purgeExpiredTickets(): void {
  const now = Date.now();
  for (const [ticket, expiresAt] of tickets) {
    if (expiresAt <= now) tickets.delete(ticket);
  }
}

/** POST /api/stream/ticket — emite um ticket de conexão (autenticado). */
streamRouter.post('/ticket', requireAuth, (_req, res) => {
  purgeExpiredTickets();
  if (tickets.size >= MAX_TICKETS) {
    // Descarta o mais antigo para manter o mapa limitado.
    const oldest = tickets.keys().next().value;
    if (oldest) tickets.delete(oldest);
  }
  const ticket = randomUUID();
  tickets.set(ticket, Date.now() + TICKET_TTL_MS);
  res.status(201).json({ ticket, expiresInSeconds: TICKET_TTL_MS / 1000 });
});

/** GET /api/stream — canal SSE de eventos em tempo real (via ?ticket=). */
streamRouter.get('/', (req, res) => {
  const ticket = req.query.ticket as string | undefined;
  purgeExpiredTickets();
  if (!ticket || !tickets.has(ticket)) {
    res.status(401).json({ error: 'Ticket inválido ou expirado' });
    return;
  }
  tickets.delete(ticket); // uso único

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
