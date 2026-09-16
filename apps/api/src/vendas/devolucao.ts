/**
 * A VENDA QUE VOLTOU NÃO É VENDA — rodada final final · contagem geral.
 *
 * "Verificar se os produtos devolvidos e revendidos estão sendo contabilizados
 *  como 2 vendas ou 1 venda. Um processo que segue com Venda → Devolução →
 *  Revenda → Devolução deve contar ZERO VENDAS desse SKU; caso seja vendido
 *  pela 3ª vez, se não for devolvido, conta 1 venda. Nunca contabiliza a venda
 *  devolvida, a não ser para esse dado específico: relatório de itens
 *  devolvidos."                                        — Galbe, 16/09/2026
 *
 * A RESPOSTA À PERGUNTA, medida no código antes de mexer em qualquer coisa:
 * contavam como DUAS. O conector já mandava `status_produto_vendido` em toda
 * linha de `detalhesVendas` e `status` em toda venda, e nenhum dos dois era
 * gravado ou consultado — nenhuma das ~25 consultas de venda da plataforma
 * filtrava por status. Uma peça vendida, devolvida e revendida entrava duas
 * vezes no giro, na curva ABC, na cobertura e na sugestão de compra; e uma
 * peça vendida e devolvida entrava uma vez, tendo vendido zero.
 *
 * ── A REGRA, e por que ela é exatamente a que o cliente descreveu ──────────
 *
 * Não é preciso casar devolução com venda nem manter um saldo por SKU: basta
 * NÃO CONTAR a linha que voltou. "Venda → devolução → revenda → devolução" são
 * duas linhas, as duas marcadas, as duas fora — zero. A terceira venda, não
 * devolvida, não está marcada e conta uma. É a regra do cliente, e cai
 * naturalmente porque o ERP marca a linha que voltou.
 *
 * ── O DICIONÁRIO É PROVISÓRIO, E ISSO ESTÁ DECLARADO ──────────────────────
 *
 * Não há amostra do CDS com uma devolução real — o que se conhece é
 * `"Válido"`, que é o status da venda boa. As grafias abaixo são as que o
 * vocabulário de ERP brasileiro usa, e a lista cresce como cresceu a da
 * padronização: com o que CHEGA, não com o que se imagina que chegue. Por isso
 * o comando `vendas:devolucoes` imprime os status distintos com a contagem de
 * cada um antes de qualquer gravação.
 *
 * A direção do erro é escolhida de propósito: status DESCONHECIDO conta como
 * venda. Assim, uma grafia que o dicionário ainda não conhece deixa o número
 * como está hoje — e o pior que acontece é a correção não ter efeito, que é
 * visível. O contrário (contar só o que é reconhecidamente válido) zeraria o
 * faturamento da rede inteira no dia em que o CDS escrevesse "Faturado" em vez
 * de "Válido".
 */

/** As grafias que significam "esta linha não é venda". */
const GRAFIAS_DE_DEVOLUCAO: RegExp[] = [
  // `devol`, e não `devolu`: "devolvido" não tem o "u" — a primeira versão
  // desta linha casava "devolução" e deixava passar "Devolvido", que é
  // justamente a grafia que o ERP usa no ITEM. Encontrado pelo teste, não em
  // produção, que é onde ele custaria a rodada inteira.
  /\bdevol\w*/, // Devolvido · Devolvida · Devolução · Devolver
  /\bcancel\w*/, // Cancelado · Cancelada
  /\bestorn\w*/, // Estornado · Estorno
  /\binvalid\w*/, // Inválido — o oposto explícito de "Válido"
  /\bnao\s*valid\w*/, // "Não válido"
];

/**
 * "TROCA" NÃO ESTÁ NA LISTA, e é uma omissão deliberada.
 *
 * Numa troca o cliente devolve a peça A e leva a peça B: a venda de A não
 * aconteceu, a de B aconteceu. Se o ERP marcar a linha DE A como "Troca",
 * excluí-la é o certo; se ele marcar as DUAS, excluir zeraria uma venda que
 * de fato ocorreu e o estoque de B saiu da loja.
 *
 * Não dá para decidir isso sem ver o dado. O comando de ensaio mostra quantas
 * linhas têm cada status: se "Troca" aparecer, esta linha vira uma pergunta ao
 * balcão, não um palpite aqui.
 */
export const GRAFIAS_EM_DUVIDA = [/\btroca\w*/, /\bdevol.*parcial/];

/** Texto reduzido para casar: minúsculo, sem acento, só letras/dígitos/espaço. */
const paraCasar = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * A linha de venda voltou?
 *
 * `null`, vazio ou status que o dicionário não conhece → `false` (conta como
 * venda). Ver o texto do cabeçalho sobre a direção do erro.
 *
 * Recebe os DOIS status porque o ERP tem os dois: a venda inteira pode ser
 * cancelada (`Sale.status`) sem que cada item diga isso, e um item pode voltar
 * sozinho (`status_produto_vendido`) numa venda que segue válida. Qualquer um
 * dos dois marcando é o bastante — uma venda cancelada não tem item válido
 * dentro.
 */
export function ehDevolucao(statusDoItem?: string | null, statusDaVenda?: string | null): boolean {
  // A DÚVIDA GANHA DA REGRA. "Devolução parcial" casa com `\bdevol\w*`, e
  // excluir a linha inteira tiraria da conta uma venda que em parte aconteceu
  // — o oposto da direção de erro declarada no cabeçalho. Enquanto o balcão
  // não disser o que essas grafias significam, elas contam como venda e o
  // comando de ensaio as destaca.
  if (emDuvida(statusDoItem) || emDuvida(statusDaVenda)) return false;
  return marcado(statusDoItem) || marcado(statusDaVenda);
}

function marcado(status?: string | null): boolean {
  if (status == null) return false;
  const t = paraCasar(status);
  if (!t) return false;
  return GRAFIAS_DE_DEVOLUCAO.some((re) => re.test(t));
}

/** O status casa com algo que ainda precisa de decisão humana? */
export function emDuvida(status?: string | null): boolean {
  if (status == null) return false;
  const t = paraCasar(status);
  if (!t) return false;
  return GRAFIAS_EM_DUVIDA.some((re) => re.test(t));
}
