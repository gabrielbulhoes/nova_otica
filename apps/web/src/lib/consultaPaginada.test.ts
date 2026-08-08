import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import {
  CHAVES_PAGINADAS,
  atualizarChave,
  recarregarDoTopo,
  recortarPrimeiraPagina,
} from './consultaPaginada';

describe('recortarPrimeiraPagina', () => {
  it('corta para a primeira página, preservando o formato', () => {
    const antes = { pages: ['a', 'b', 'c'], pageParams: [1, 2, 3] };
    expect(recortarPrimeiraPagina(antes)).toEqual({ pages: ['a'], pageParams: [1] });
  });

  it('devolve o MESMO objeto quando não há o que cortar', () => {
    // Referência nova onde não houve mudança de conteúdo faz o React Query
    // enxergar atualização e re-renderizar a tela à toa.
    const uma = { pages: ['a'], pageParams: [1] };
    expect(recortarPrimeiraPagina(uma)).toBe(uma);
    expect(recortarPrimeiraPagina(undefined)).toBe(undefined);
    expect(recortarPrimeiraPagina({ qualquer: 1 })).toEqual({ qualquer: 1 });
  });
});

/**
 * O custo e o piscar, medidos como o revisor mediu: com um observador de
 * consulta paginada de verdade, contando execuções da `queryFn`.
 *
 * Estes dois testes FALHAM nas duas implementações que o conserto substituiu —
 * é o que os torna prova e não decoração:
 *
 *   · com `invalidateQueries`, o primeiro conta 20 execuções em vez de 1;
 *   · com `resetQueries`, o segundo vê `data` indefinido no instante seguinte,
 *     que é o que troca a tela inteira por "Carregando…".
 */
describe('recarregarDoTopo · custo e continuidade', () => {
  const montar = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let execucoes = 0;
    const obs = new InfiniteQueryObserver(qc, {
      queryKey: ['decisions', {}],
      queryFn: ({ pageParam }) => {
        execucoes += 1;
        const p = pageParam as number;
        return Promise.resolve({ pagina: { page: p, pageSize: 60, total: 1200 } });
      },
      initialPageParam: 1,
      getNextPageParam: (ultima: { pagina: { page: number } }) => ultima.pagina.page + 1,
    });
    const parar = obs.subscribe(() => {});
    return { qc, obs, parar, execucoes: () => execucoes };
  };

  const esperar = () => new Promise((r) => setTimeout(r, 0));

  it('uma execução do motor, não uma por página acumulada', async () => {
    const { qc, obs, parar, execucoes } = montar();
    await obs.refetch();
    for (let i = 0; i < 19; i++) await obs.fetchNextPage();
    expect(obs.getCurrentResult().data?.pages.length).toBe(20);

    const antes = execucoes();
    recarregarDoTopo(qc, 'decisions');
    await esperar();
    await esperar();

    // 20 páginas abertas custavam 20 recálculos completos no servidor por um
    // clique corriqueiro — ~32 s de tela inerte na base de carga.
    expect(execucoes() - antes).toBe(1);
    expect(obs.getCurrentResult().data?.pages.length).toBe(1);
    parar();
  });

  it('o dado nunca fica indefinido — a tela não pisca', async () => {
    const { qc, obs, parar } = montar();
    await obs.refetch();
    for (let i = 0; i < 4; i++) await obs.fetchNextPage();
    expect(obs.getCurrentResult().data?.pages.length).toBe(5);

    recarregarDoTopo(qc, 'decisions');
    // NO MESMO INSTANTE, que é quando a tela decide entre conteúdo e
    // "Carregando…": com `resetQueries` aqui já era `undefined`.
    const logoDepois = obs.getCurrentResult();
    expect(logoDepois.data).toBeDefined();
    expect(logoDepois.data?.pages.length).toBeGreaterThan(0);
    parar();
  });

  it('chave comum é invalidada; chave paginada volta ao topo', async () => {
    const { qc, obs, parar, execucoes } = montar();
    await obs.refetch();
    for (let i = 0; i < 5; i++) await obs.fetchNextPage();
    const antes = execucoes();
    atualizarChave(qc, 'decisions');
    await esperar();
    await esperar();
    expect(execucoes() - antes).toBe(1);
    parar();
  });
});

/**
 * A FIAÇÃO — que é o que a suíte não pegava.
 *
 * O revisor mostrou o buraco de forma incontestável: restaurou as duas telas na
 * versão defeituosa e a suíte inteira ficou verde. Os testes exercitavam a
 * biblioteca; nenhum encostava em `Decisions.tsx` ou `Planning.tsx`.
 *
 * O conserto de verdade seria um harness de componente (jsdom +
 * testing-library), que este workspace não tem — as suítes do web são todas de
 * módulos puros. Enquanto ele não existe, isto aqui é uma REGRA DE LINT escrita
 * como teste: lê o código das telas e recusa o padrão que já custou caro duas
 * vezes. Não prova que a tela funciona; prova que ela não voltou a errar assim.
 *
 * Se um dia entrar o harness, este bloco sai.
 */
describe('fiação: nenhuma tela invalida consulta paginada direto', () => {
  const ARQUIVOS = [
    'src/pages/Decisions.tsx',
    'src/pages/Planning.tsx',
    'src/hooks/useLiveInvalidation.ts',
  ];

  it('as chaves paginadas nunca aparecem em invalidateQueries nem resetQueries', () => {
    for (const arq of ARQUIVOS) {
      const src = readFileSync(new URL(`../../${arq}`, import.meta.url), 'utf8');
      for (const chave of CHAVES_PAGINADAS) {
        for (const metodo of ['invalidateQueries', 'resetQueries']) {
          const padrao = new RegExp(`${metodo}\\(\\{[^}]*queryKey:\\s*\\['${chave}'`);
          expect(
            padrao.test(src),
            `${arq} chama ${metodo} em '${chave}' — use recarregarDoTopo(qc, '${chave}'). ` +
              'Invalidar refaz TODAS as páginas acumuladas (uma execução do motor por ' +
              'página); resetar apaga o dado e troca a tela por "Carregando…".',
          ).toBe(false);
        }
      }
    }
  });

  it('as telas paginadas de fato usam o recarregarDoTopo', () => {
    // Sem isto, apagar a chamada passaria pelo teste acima: "não invalida" é
    // verdade também para quem não faz nada.
    for (const arq of ['src/pages/Decisions.tsx', 'src/pages/Planning.tsx']) {
      const src = readFileSync(new URL(`../../${arq}`, import.meta.url), 'utf8');
      expect(src, `${arq} deveria recarregar do topo após mutação`).toContain('recarregarDoTopo(qc,');
    }
  });

  it('as telas paginadas pedem a próxima página COM âncora', () => {
    // `proximaPagina` sozinha volta a pedir por deslocamento, e o deslocamento
    // pula item quando a lista encolhe entre um clique e o seguinte — que é o
    // que acontece toda vez que um card é decidido. O defeito é invisível na
    // tela (o card some, não aparece erro), então a guarda tem de ser aqui.
    for (const arq of ['src/pages/Decisions.tsx', 'src/pages/Planning.tsx']) {
      const src = readFileSync(new URL(`../../${arq}`, import.meta.url), 'utf8');
      expect(src, `${arq} deveria usar proximoPedido(pagina, ancora)`).toContain('proximoPedido(');
      expect(
        /getNextPageParam:\s*\(ultima\)\s*=>\s*proximaPagina\(/.test(src),
        `${arq} voltou a paginar só por deslocamento`,
      ).toBe(false);
    }
  });
});
