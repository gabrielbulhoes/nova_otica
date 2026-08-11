import { EventEmitter } from 'node:events';

/** Eventos de domínio publicados para os clientes em tempo real (SSE). */
export type AppEvent =
  | { type: 'movement.changed'; storeId?: string | null; movementId?: string }
  | { type: 'sync.completed'; ok: boolean }
  | { type: 'order.changed'; storeId?: string | null; orderId?: string }
  /** Notificação proativa do planejamento: itens no ponto de reposição. */
  | { type: 'planning.urgent'; items: number; suppliers: number; total: number }
  | { type: 'purchase-order.changed'; recordId?: string }
  /** Decisão registrada sobre um card do Planejamento (aprovar/recusar). */
  | { type: 'decision.recorded'; recordId?: string }
  /**
   * Parâmetro comercial do planejamento mudou: grife entrou ou saiu do mix,
   * prazo de fornecedor alterado. Sem loja — a decisão vale para a rede.
   *
   * Estes dois são os únicos insumos do motor que a operação edita À MÃO, e
   * eram os únicos que não avisavam ninguém: marcar uma grife como fora do mix
   * mudava a compra sugerida de toda a rede e nenhuma tela ficava sabendo até
   * alguém recarregar a página.
   */
  | { type: 'planning.settings.changed'; setting: 'brand-mix' | 'supplier'; brand?: string };

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
