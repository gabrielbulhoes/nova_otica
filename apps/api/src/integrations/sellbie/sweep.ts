/**
 * Varredura por janelas de data — o contorno para respostas truncadas do
 * conector CDS.
 *
 * O conector NÃO tem paginação: nenhuma rota aceita `page`, `limit` ou
 * `offset`, e a resposta é sempre um array puro na raiz. Ele tem, porém, um
 * teto de linhas por resposta que não está documentado. Na carga inicial de
 * 04/08/2026 uma única chamada a `cds/produtos` com a faixa
 * 2000-01-01 → hoje devolveu 5.318 dos ~21.683 produtos da rede — sem erro,
 * sem aviso, sem nada na resposta indicando que faltava o resto. É o pior
 * tipo de truncamento: silencioso e plausível.
 *
 * O que existe são os filtros `date_start`/`date_end`, que o sync já usa para
 * o histórico de vendas. Este módulo generaliza esse recurso: fatia a faixa em
 * janelas até que cada resposta caiba sob o teto.
 *
 * A fatia é ADAPTATIVA (bisseção), não fixa. Uma varredura mensal de 1900 a
 * hoje custaria 1.500 chamadas para trazer o mesmo catálogo; a bisseção só
 * desce onde há volume e devolve o intervalo vazio de 1900–1960 em uma
 * chamada só.
 *
 * Módulo puro de propósito: não conhece Prisma, nem axios, nem a forma dos
 * registros. Recebe uma função de busca e uma de chave, e é testável sem rede.
 */

export interface JanelaDeDatas {
  /** aaaa-mm-dd, inclusivo. */
  date_start: string;
  /** aaaa-mm-dd, inclusivo. */
  date_end: string;
}

export interface EventoVarredura {
  entidade: string;
  janela: JanelaDeDatas;
  /** Linhas devolvidas por esta janela. */
  lidos: number;
  /** A resposta bateu no teto — provavelmente incompleta. */
  truncada: boolean;
  /** A janela foi fatiada em duas por causa do truncamento. */
  fatiada: boolean;
}

export interface OpcoesVarredura<T> {
  /** Rótulo para log (ex.: 'produtos'). */
  entidade: string;
  /** aaaa-mm-dd — piso da varredura. */
  inicio: string;
  /** aaaa-mm-dd — teto da varredura. */
  fim: string;
  /** Linhas a partir das quais a resposta é considerada truncada. */
  limite: number;
  buscar: (janela: JanelaDeDatas) => Promise<T[]>;
  /** Identidade do registro, para deduplicar entre janelas. */
  chave: (item: T) => string;
  /** Piso da fatia, em dias. Abaixo disto a janela é aceita como está. */
  minimoDias?: number;
  /** Teto de chamadas — trava contra varredura descontrolada. */
  maxChamadas?: number;
  aoRegistrar?: (evento: EventoVarredura) => void;
}

export interface ResultadoVarredura<T> {
  itens: T[];
  chamadas: number;
  /** Soma das linhas lidas, com repetição — mede o custo, não o resultado. */
  lidosBrutos: number;
  /** Janelas que bateram no teto e foram fatiadas. */
  janelasTruncadas: number;
  /**
   * Janelas que bateram no teto e NÃO puderam ser fatiadas (já no piso de
   * dias). Maior que zero significa catálogo possivelmente incompleto: um
   * único dia tem mais registros que o teto do conector.
   */
  janelasIndivisiveis: number;
  /** O teto de chamadas interrompeu a varredura antes do fim. */
  tetoAtingido: boolean;
}

const DIA_MS = 86_400_000;

/**
 * 'aaaa-mm-dd' -> milissegundos UTC. Sem fuso de propósito: aqui a data é um
 * rótulo que vai na query string, não um instante. Usar o fuso local faria a
 * fronteira das janelas escorregar um dia conforme o servidor.
 */
function paraMs(iso: string): number {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(ano, mes - 1, dia);
}

function paraIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Varre `inicio`→`fim` fatiando por bisseção sempre que a resposta bater no
 * teto. Devolve a união deduplicada de todas as janelas.
 */
export async function varrerPorJanelas<T>(opts: OpcoesVarredura<T>): Promise<ResultadoVarredura<T>> {
  const minimoDias = Math.max(1, opts.minimoDias ?? 1);
  const maxChamadas = Math.max(1, opts.maxChamadas ?? 400);

  const pendentes: JanelaDeDatas[] = [{ date_start: opts.inicio, date_end: opts.fim }];
  const porChave = new Map<string, T>();

  let chamadas = 0;
  let lidosBrutos = 0;
  let janelasTruncadas = 0;
  let janelasIndivisiveis = 0;
  let tetoAtingido = false;

  while (pendentes.length > 0) {
    if (chamadas >= maxChamadas) {
      tetoAtingido = true;
      break;
    }

    const janela = pendentes.shift()!;
    const linhas = await opts.buscar(janela);
    chamadas += 1;
    lidosBrutos += linhas.length;

    // O que veio entra SEMPRE, mesmo de uma janela truncada. As duas metades
    // vão reler o intervalo e a deduplicação por chave absorve a repetição;
    // se o conector for inconsistente entre chamadas, a união só tem a
    // ganhar. Descartar seria trocar um resultado parcial garantido por uma
    // aposta na segunda leitura.
    for (const item of linhas) porChave.set(opts.chave(item), item);

    const inicioMs = paraMs(janela.date_start);
    const fimMs = paraMs(janela.date_end);
    const dias = Math.floor((fimMs - inicioMs) / DIA_MS) + 1;
    const truncada = linhas.length >= opts.limite;
    const fatiar = truncada && dias > minimoDias;

    opts.aoRegistrar?.({ entidade: opts.entidade, janela, lidos: linhas.length, truncada, fatiada: fatiar });

    if (fatiar) {
      janelasTruncadas += 1;
      const meioMs = inicioMs + Math.floor((fimMs - inicioMs) / DIA_MS / 2) * DIA_MS;
      // As metades entram na FRENTE da fila: refinar a janela suspeita antes
      // de seguir mantém o log em ordem cronológica, o que é o que torna
      // possível ler no `docker logs` onde está o volume do catálogo.
      pendentes.unshift(
        { date_start: janela.date_start, date_end: paraIso(meioMs) },
        { date_start: paraIso(meioMs + DIA_MS), date_end: janela.date_end },
      );
      continue;
    }

    if (truncada) janelasIndivisiveis += 1;
  }

  return {
    itens: [...porChave.values()],
    chamadas,
    lidosBrutos,
    janelasTruncadas,
    janelasIndivisiveis,
    tetoAtingido,
  };
}

/**
 * Divide uma lista em lotes de no máximo `tamanho`. Usado para montar as
 * listas CSV que `cds/estoquegrade` aceita em `cod_prod`: é o único filtro da
 * rota que permite pedir o estoque em pedaços, já que ela não tem data.
 */
export function emLotes<T>(itens: T[], tamanho: number): T[][] {
  const n = Math.max(1, Math.floor(tamanho));
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += n) lotes.push(itens.slice(i, i + n));
  return lotes;
}
