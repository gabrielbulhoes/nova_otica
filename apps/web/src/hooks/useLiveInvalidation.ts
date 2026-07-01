import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DEMO, getToken } from '../api/client';

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
];

/**
 * Abre um EventSource para /api/stream e invalida as queries ao vivo quando
 * chegam eventos (movimentações, sync). O EventSource reconecta sozinho.
 */
export function useLiveInvalidation(): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (DEMO) return; // sem backend/SSE no modo demonstração
    const token = getToken();
    if (!token) return;

    const es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
    es.onmessage = () => {
      for (const key of LIVE_KEYS) qc.invalidateQueries({ queryKey: [key] });
    };
    // Em erro, o próprio EventSource tenta reconectar; nada a fazer aqui.

    return () => es.close();
  }, [qc]);
}
