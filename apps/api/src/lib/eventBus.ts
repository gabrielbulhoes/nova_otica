import { EventEmitter } from 'node:events';

/** Eventos de domínio publicados para os clientes em tempo real (SSE). */
export type AppEvent =
  | { type: 'movement.changed'; storeId?: string | null; movementId?: string }
  | { type: 'sync.completed'; ok: boolean }
  | { type: 'order.changed'; storeId?: string | null; orderId?: string };

const CHANNEL = 'app';
const emitter = new EventEmitter();
// Muitos clientes SSE podem assinar simultaneamente.
emitter.setMaxListeners(0);

/** Publica um evento para todos os assinantes. */
export function publish(event: AppEvent): void {
  emitter.emit(CHANNEL, event);
}

/** Assina os eventos; retorna uma função para cancelar a assinatura. */
export function subscribe(listener: (event: AppEvent) => void): () => void {
  emitter.on(CHANNEL, listener);
  return () => emitter.off(CHANNEL, listener);
}

/** Nº de assinantes ativos (útil para testes/observabilidade). */
export function subscriberCount(): number {
  return emitter.listenerCount(CHANNEL);
}
