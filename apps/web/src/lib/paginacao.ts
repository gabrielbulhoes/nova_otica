import type { PaginaDaResposta } from '@planning';

/**
 * A aritmética do "Ver mais" das listas paginadas (quadro de decisões e tabela
 * de sugestões), fora das telas.
 *
 * Está aqui, e não dentro de cada componente, porque foi exatamente aqui que a
 * Central de Decisões errou: o botão crescia o `pageSize` e nunca mandava
 * `page`. Como a rota prende o `pageSize` num teto, a partir do 17º clique a
 * grade parava de crescer, o rótulo continuava prometendo "mais 60 de 11.737
 * restantes" e os cards além do teto ficavam INALCANÇÁVEIS — enquanto cada
 * clique inútil ainda pagava uma execução completa do motor. Duas telas
 * repetiam a mesma conta de cabeça; agora é uma função, e ela tem teste.
 *
 * A regra que sustenta tudo: quem pagina pede PÁGINA, com tamanho FIXO e
 * abaixo do teto, e acumula o que chega. Nenhum item fica fora de alcance, e o
 * "restantes" só promete o que a próxima ida ao servidor entrega de fato.
 */

/**
 * Quanto cada tela pede por ida ao servidor.
 *
 * FIXO, e de propósito abaixo do teto da rota (`TETO_DE_CARDS`,
 * `TETO_DE_LINHAS`) — um tamanho de página que cresce até bater no teto é
 * justamente o defeito que essas constantes existem para impedir. Há teste
 * prendendo os dois abaixo do teto: se alguém subir um deles sem olhar o outro,
 * a suíte avisa antes do usuário.
 */
export const CARDS_POR_CLIQUE = 60;
export const LINHAS_POR_CLIQUE = 100;

/**
 * A página seguinte, ou `undefined` quando a última já chegou.
 *
 * É o `undefined` que faz o botão sumir — e ele só aparece quando o servidor
 * declarou, no `pagina` da própria resposta, que ainda há o que buscar. Um
 * botão que decide isso por conta própria é o botão que mente.
 */
export function proximaPagina(pagina: PaginaDaResposta | undefined): number | undefined {
  if (!pagina) return undefined;
  const jaEntregues = pagina.page * pagina.pageSize;
  return jaEntregues < pagina.total ? pagina.page + 1 : undefined;
}

/** O que uma ida ao servidor pede: a página e o item em que o cliente parou. */
export interface PedidoDePagina {
  page: number;
  /** Chave do último item já recebido — ver `paginar` no motor. */
  apos?: string;
}

/**
 * O pedido da próxima ida, com a ÂNCORA junto.
 *
 * `proximaPagina` sozinha resolve metade do problema: ela faz o botão parar na
 * hora certa. A outra metade é que o deslocamento aritmético mente quando a
 * lista muda entre um clique e o seguinte — e ela muda o tempo todo, porque
 * decidir um card o remove do quadro e empurra os seguintes para trás. Com 60
 * por página, decidir um card da primeira página faz o antigo 60 virar 59, e
 * pedir a página 2 devolve o antigo 61: o card 60 PULA e some da tela até
 * alguém recarregar.
 *
 * A deduplicação de `juntarPaginas` cobre o caso oposto (item repetido quando
 * a lista cresce). Do item PULADO não havia defesa nenhuma — e é o pior dos
 * dois, porque some sem deixar rastro.
 */
export function proximoPedido(
  pagina: PaginaDaResposta | undefined,
  ancora: string | undefined,
): PedidoDePagina | undefined {
  const page = proximaPagina(pagina);
  return page === undefined ? undefined : { page, apos: ancora };
}

/**
 * Os itens de todas as páginas recebidas, na ordem em que chegaram e sem
 * repetir.
 *
 * A deduplicação não é zelo: entre um clique e outro o motor roda de novo, e um
 * card decidido no meio do caminho encurta o quadro e empurra os seguintes para
 * trás. Sem chave, a lista mostraria o mesmo card duas vezes — e o React ainda
 * reclamaria da chave repetida.
 */
export function juntarPaginas<T>(
  paginas: readonly (readonly T[])[] | undefined,
  chaveDe: (item: T) => string,
): T[] {
  const vistos = new Set<string>();
  const juntos: T[] = [];
  for (const pagina of paginas ?? []) {
    for (const item of pagina) {
      const chave = chaveDe(item);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      juntos.push(item);
    }
  }
  return juntos;
}

/**
 * Quantos itens da vista ainda dá para trazer.
 *
 * Sai do `total` declarado na resposta menos o que já está na tela, e nunca
 * abaixo de zero: com o quadro encolhendo entre execuções do motor, o
 * acumulado pode passar do total de uma resposta mais nova, e um "-3 restantes"
 * no botão é pior que nenhum número.
 */
export function restantes(pagina: PaginaDaResposta | undefined, carregados: number): number {
  return Math.max(0, (pagina?.total ?? carregados) - carregados);
}
