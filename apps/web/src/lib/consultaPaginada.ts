import type { QueryClient } from '@tanstack/react-query';

/**
 * As consultas PAGINADAS da aplicação — as que acumulam páginas com "Ver mais".
 *
 * Elas precisam de tratamento próprio quando algo muda no banco, e a lista
 * existe para que esse tratamento não dependa de alguém lembrar caso a caso.
 * Ver `recarregarDoTopo` para o porquê.
 */
export const CHAVES_PAGINADAS = new Set(['decisions', 'purchase-suggestions']);

/** O formato com que o React Query guarda uma consulta paginada no cache. */
export interface PaginasNoCache<T = unknown> {
  pages: T[];
  pageParams: unknown[];
}

/**
 * Corta o cache para a PRIMEIRA página, preservando o formato.
 *
 * Devolve o próprio objeto quando não há nada a cortar, para o React Query não
 * enxergar mudança de referência onde não houve mudança de conteúdo.
 */
export function recortarPrimeiraPagina<T>(antigo: unknown): unknown {
  if (!antigo || typeof antigo !== 'object') return antigo;
  const d = antigo as Partial<PaginasNoCache<T>>;
  if (!Array.isArray(d.pages) || !Array.isArray(d.pageParams)) return antigo;
  if (d.pages.length <= 1) return antigo;
  return { pages: d.pages.slice(0, 1), pageParams: d.pageParams.slice(0, 1) };
}

/**
 * Recarrega uma consulta paginada a partir do topo, com UMA execução do motor
 * e sem apagar a tela.
 *
 * Três caminhos possíveis, e os dois óbvios estão errados:
 *
 * `invalidateQueries` rebusca TODAS as páginas acumuladas, uma a uma. Cada
 * página de sugestões ou do quadro é um recálculo completo do motor no
 * servidor. Medido com vinte páginas abertas: uma única invalidação disparou
 * vinte execuções, em fila, ~32 s de tela inerte. Numa lista cheia passaria de
 * três minutos. Era o que acontecia antes desta função existir, e é o oposto
 * do que a paginação veio fazer.
 *
 * `resetQueries` custa uma execução só — mas APAGA o dado antes de rebuscar.
 * Como as telas decidem entre `<Loading />` e conteúdo por "tenho dado?", a
 * tela inteira — indicadores, filtros e grade — pisca a cada decisão
 * registrada. Trocamos N recálculos por uma tela que some na cara do operador.
 *
 * O que esta função faz: corta o cache para a primeira página e SÓ ENTÃO
 * invalida. O dado nunca fica indefinido, então nada pisca; e como sobrou uma
 * página só, a invalidação custa uma execução. Voltar ao topo é a leitura
 * honesta de qualquer forma — o registro mudou a lista inteira, e as páginas
 * seguintes descreviam uma ordem que não existe mais.
 */
export function recarregarDoTopo(qc: QueryClient, chave: string): void {
  qc.setQueriesData({ queryKey: [chave] }, recortarPrimeiraPagina);
  void qc.invalidateQueries({ queryKey: [chave] });
}

/**
 * Atualiza uma chave qualquer: paginada volta ao topo, comum é invalidada.
 * É o que os pontos que não sabem (nem deveriam saber) se a chave é paginada
 * devem chamar — o hook de eventos ao vivo, por exemplo.
 */
export function atualizarChave(qc: QueryClient, chave: string): void {
  if (CHAVES_PAGINADAS.has(chave)) recarregarDoTopo(qc, chave);
  else void qc.invalidateQueries({ queryKey: [chave] });
}
