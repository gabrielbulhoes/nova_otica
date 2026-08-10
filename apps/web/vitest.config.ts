import { defineConfig, mergeConfig } from 'vitest/config';
// Herda o resolve.alias do app (@planning etc.) — fonte única de configuração.
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      /*
       * `.tsx` ENTRA no padrão.
       *
       * Era `src/**\/*.test.ts`, e as suítes daqui eram todas de módulo puro —
       * então um arquivo de teste de TELA, que precisa ser `.tsx` para escrever
       * JSX, simplesmente não seria coletado. Não falharia: sumiria. É a pior
       * forma de um teste não existir, porque a suíte continua verde.
       */
      include: ['src/**/*.test.{ts,tsx}'],
      /*
       * `jsdom` — a razão de este arquivo ter mudado.
       *
       * Até aqui NENHUM teste abria a tela, e o buraco cobrou duas vezes:
       *
       *   · a coluna "Mandar" saiu vazia numa entrega inteira, com typecheck
       *     verde, porque o tipo do web era declarado à mão e divergia do que a
       *     API mandava;
       *   · as duas telas paginadas ficaram desprotegidas — a conferência
       *     independente restaurou a versão defeituosa e 125 de 125 passaram.
       *
       * Enquanto isso não existia, o repositório se defendia com REGRAS DE LINT
       * escritas como teste: blocos que leem o código-fonte das telas e recusam
       * padrões conhecidos. Elas provam que a tela não voltou a errar assim;
       * não provam que ela funciona. Cada uma está declarada como provisória no
       * próprio arquivo, com a condição de saída — e esta é a condição.
       *
       * `jsdom` e não `happy-dom`: o React Query e o React Router mexem em
       * `history`, `matchMedia` e `IntersectionObserver`, e o jsdom é o que a
       * documentação dos dois usa. Velocidade não é o gargalo aqui — são
       * poucos testes de tela, de propósito.
       */
      environment: 'node',
      setupFiles: ['./src/teste/preparo.ts'],
      /*
       * O ambiente de nó continua valendo para o resto.
       *
       * As 151 asserções que já existem são de módulo puro e não precisam de
       * DOM. Rodá-las em jsdom custaria tempo em toda execução para não provar
       * nada a mais — e mascararia código que depende de `window` sem dizer.
       */
      environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
    },
  }),
);
