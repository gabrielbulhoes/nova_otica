import { describe, it, expect, beforeAll, afterEach } from 'vitest';

/**
 * O `AbortSignal` das consultas que fazem o motor rodar inteiro.
 *
 * O React Query entrega um sinal a cada `queryFn` e o aborta quando a chave da
 * consulta muda. Enquanto ele não chegava ao axios, trocar de filtro NÃO
 * cancelava nada: quatro cliques dentro da janela de ~1,6 s de uma resposta
 * deixavam quatro execuções concorrentes do motor de pé no servidor. O pico
 * medido com TRÊS concorrentes é 769 MB e o processo roda com heap de 768 MB —
 * a quarta reinicia o contêiner. Estas rotas não têm limite de taxa.
 *
 * O teste prende o elo que faltava: o sinal chega ao pedido HTTP. Cancelar de
 * fato é trabalho do axios, e não é isto que se está testando aqui.
 */

// `client.ts` lê o token do armazenamento do navegador no interceptador de
// requisição; no ambiente de teste (node) não existe `localStorage`.
beforeAll(() => {
  const memoria = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => memoria.get(k) ?? null,
      setItem: (k: string, v: string) => void memoria.set(k, v),
      removeItem: (k: string) => void memoria.delete(k),
    },
  });
});

const { api, getDecisionBoard, getPurchaseSuggestions } = await import('./client');

const adapterOriginal = api.defaults.adapter;
afterEach(() => {
  api.defaults.adapter = adapterOriginal;
});

/** Troca o adapter por um espião e devolve o que cada requisição carregou. */
function espiar() {
  const pedidos: { url?: string; signal?: AbortSignal }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api.defaults.adapter = (async (config: any) => {
    pedidos.push({ url: config.url, signal: config.signal });
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  }) as never;
  return pedidos;
}

describe('client: o sinal de cancelamento chega ao axios', () => {
  it('o quadro de decisões leva o AbortSignal recebido', async () => {
    const pedidos = espiar();
    const ac = new AbortController();
    await getDecisionBoard({ days: 90, page: 1, pageSize: 60 }, ac.signal);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].url).toBe('/planning/decisions');
    expect(pedidos[0].signal).toBe(ac.signal);
  });

  it('as sugestões de compra levam o AbortSignal recebido', async () => {
    const pedidos = espiar();
    const ac = new AbortController();
    await getPurchaseSuggestions({ days: 90, page: 1, pageSize: 100 }, ac.signal);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].url).toBe('/planning/purchase-suggestions');
    expect(pedidos[0].signal).toBe(ac.signal);
  });

  it('sem sinal, a requisição sai sem sinal — nada é inventado', () => {
    const pedidos = espiar();
    return getDecisionBoard({ days: 90 }).then(() => {
      expect(pedidos[0].signal).toBeUndefined();
    });
  });
});
