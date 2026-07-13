import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Role } from '@prisma/client';
import { subscribe, type AppEvent } from '../../lib/eventBus.js';
import { requireAuth } from '../auth/auth.middleware.js';

export const streamRouter = Router();

/**
 * O EventSource do navegador não envia cabeçalhos customizados, então a
 * conexão SSE é autorizada por um *ticket* efêmero de uso único: o cliente
 * autenticado pede o ticket via POST (com Bearer no cabeçalho) e o consome
 * na query string. O JWT nunca aparece em URL (histórico, logs, referrer).
 * O ticket carrega a identidade (papel/loja) para escopar os eventos.
 */
interface TicketInfo {
  expiresAt: number; // epoch ms
  role: Role;
  storeId: string | null;
}

const TICKET_TTL_MS = 60_000;
const MAX_TICKETS = 1_000; // teto de segurança contra emissão em massa
const tickets = new Map<string, TicketInfo>();

function purgeExpiredTickets(): void {
  const now = Date.now();
  for (const [ticket, info] of tickets) {
    if (info.expiresAt <= now) tickets.delete(ticket);
  }
}

/**
 * Escopo dos eventos: ADMIN vê tudo; STORE_MANAGER só eventos da própria
 * loja. Eventos sem loja (ex.: sync.completed) são globais por definição.
 */
export function canReceive(event: AppEvent, viewer: Pick<TicketInfo, 'role' | 'storeId'>): boolean {
  if (viewer.role === 'ADMIN') return true;
  const storeId = 'storeId' in event ? event.storeId : undefined;
  if (storeId === undefined || storeId === null) return true;
  return viewer.storeId !== null && storeId === viewer.storeId;
}

/** POST /api/stream/ticket — emite um ticket de conexão (autenticado). */
streamRouter.post('/ticket', requireAuth, (req, res) => {
  purgeExpiredTickets();
  if (tickets.size >= MAX_TICKETS) {
    // Descarta o mais antigo para manter o mapa limitado.
    const oldest = tickets.keys().next().value;
    if (oldest) tickets.delete(oldest);
  }
  const ticket = randomUUID();
  tickets.set(ticket, {
    expiresAt: Date.now() + TICKET_TTL_MS,
    role: req.user!.role,
    storeId: req.user!.storeId,
  });
  res.status(201).json({ ticket, expiresInSeconds: TICKET_TTL_MS / 1000 });
});

/** GET /api/stream — canal SSE de eventos em tempo real (via ?ticket=). */
streamRouter.get('/', (req, res) => {
  const ticket = req.query.ticket as string | undefined;
  purgeExpiredTickets();
  const info = ticket ? tickets.get(ticket) : undefined;
  if (!ticket || !info) {
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
    if (!canReceive(event, info)) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  // Heartbeat para manter a conexão viva através de proxies.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
