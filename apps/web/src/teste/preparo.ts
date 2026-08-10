/**
 * Preparo do ambiente de teste de TELA.
 *
 * SEM `@testing-library/jest-dom`. Ele traz matchers de conveniência
 * (`toBeInTheDocument` e afins) e mais uma dependência para manter; as
 * asserções deste repositório são sobre TEXTO E CONTAGEM — "aparece o número
 * 38", "some a linha" — e para isso `expect(x).toBe(...)` sobre o que a busca
 * devolve já basta e diz mais.
 *
 * Roda antes de cada arquivo de teste. Em `.test.ts` (módulo puro, ambiente
 * `node`) quase tudo aqui é inofensivo e não faz nada; em `.test.tsx` é o que
 * torna a montagem possível.
 */
import { afterEach } from 'vitest';

// Só existe em jsdom. Nos testes de módulo puro não há `window`, e tentar
// preparar o DOM ali quebraria a suíte inteira por um motivo alheio ao teste.
const noNavegador = typeof window !== 'undefined';

if (noNavegador) {
  const { cleanup } = await import('@testing-library/react');

  /*
   * Desmonta a árvore entre testes.
   *
   * Sem isto, o segundo teste de um arquivo encontra o DOM do primeiro ainda
   * montado — e uma busca por texto acha DOIS elementos e falha com uma
   * mensagem que não tem nada a ver com a causa.
   */
  afterEach(() => cleanup());

  /*
   * `matchMedia` não existe no jsdom, e o React Router e o tema o consultam na
   * montagem. Sem este remendo o erro é `window.matchMedia is not a function`,
   * estourado dentro de uma biblioteca — barulho que esconde o teste real.
   */
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  /*
   * `IntersectionObserver` e `ResizeObserver` também faltam. O ECharts usa o
   * segundo; o primeiro aparece em rolagem infinita.
   */
  const vazio = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  if (!('IntersectionObserver' in window)) {
    (window as unknown as Record<string, unknown>).IntersectionObserver = vazio;
  }
  if (!('ResizeObserver' in window)) {
    (window as unknown as Record<string, unknown>).ResizeObserver = vazio;
  }
}
