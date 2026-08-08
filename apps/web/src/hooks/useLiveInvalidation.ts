import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, DEMO, getToken } from '../api/client';

// Prefixos das queries "ao vivo" que devem refazer fetch quando algo muda.
const LIVE_KEYS = [
  'bi-kpis',
  'bi-ts',
  'bi-store',
  'bi-pay',
  'bi-cat',
  'bi-flow',
  'bi-heat',
  'stock',
  'alerts',
  'movements',
  'summary',
  'sales-by-store',
  'sync-status',
  'planning-overview',
  'planning-rebalance',
  'planning-orders',
  'planning-history',
  'purchase-suggestions',
];

/**
 * Das chaves acima, as que são consultas PAGINADAS.
 *
 * Elas VOLTAM À PRIMEIRA página em vez de serem invalidadas. Invalidar uma
 * consulta paginada refaz todas as páginas já acumuladas, uma a uma — e cada
 * página de sugestões é um recálculo completo do motor. Com trinta páginas
 * abertas, um único evento de movimentação viraria trinta recálculos em fila,
 * o oposto do que esta frente veio fazer. Voltar à primeira custa um, e é a
 * leitura honesta: o evento mudou a lista inteira, não a página em que se está.
 */
const CHAVES_PAGINADAS = new Set(['purchase-suggestions']);

const RECONNECT_DELAY_MS = 5_000;

/**
 * Abre um EventSource para /api/stream e invalida as queries ao vivo quando
 * chegam eventos (movimentações, sync). A conexão é autorizada por um ticket
 * efêmero de uso único (o JWT vai só no cabeçalho do POST, nunca na URL);
 * como o ticket não é reutilizável, a reconexão é feita manualmente pedindo
 * um ticket novo a cada tentativa.
 */
export function useLiveInvalidation(): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (DEMO) return; // sem backend/SSE no modo demonstração
    if (!getToken()) return;

    let es: EventSource | null = null;
    let timer: number | undefined;
    let cancelled = false;

    const scheduleReconnect = () => {
      if (cancelled) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void connect(), RECONNECT_DELAY_MS);
    };

    const connect = async () => {
      try {
        const { ticket } = await api.post<{ ticket: string }>('/stream/ticket').then((r) => r.data);
        if (cancelled) return;
        es = new EventSource(`/api/stream?ticket=${encodeURIComponent(ticket)}`);
        es.onmessage = () => {
          for (const key of LIVE_KEYS) {
            if (CHAVES_PAGINADAS.has(key)) qc.resetQueries({ queryKey: [key] });
            else qc.invalidateQueries({ queryKey: [key] });
          }
        };
        es.onerror = () => {
          es?.close();
          scheduleReconnect();
        };
      } catch {
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      es?.close();
    };
  }, [qc]);
}
