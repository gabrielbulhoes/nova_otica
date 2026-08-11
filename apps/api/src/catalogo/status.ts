import { prisma } from '../lib/prisma.js';

/**
 * Quanto do catálogo tem atributo, e de qual arquivo veio.
 *
 * EXISTE PELO MESMO MOTIVO QUE `statusDoCatalogo` DA REGRA DE MIX.
 *
 * Aquela regra ficou meses permissiva em produção porque o arquivo não estava
 * lá e a ausência virava `null` em silêncio — duas entregas declaradas prontas
 * ao cliente não faziam nada. O importador destes atributos roda À MÃO, contra
 * um banco que muda, e falha do mesmo jeito: ninguém roda, ou roda contra o
 * banco errado, e o motor passa a decidir sem o dado achando que decidiu com.
 *
 * Um `curl /health` responde. E responde as duas perguntas que importam, porque
 * as fontes falham separado: o cadastro do fornecedor pode estar carregado e o
 * teto de desconto não, e aí a liquidação continua sugerindo desconto de
 * cabeça enquanto a tela mostra gênero e formato como se tudo estivesse lá.
 */
export interface StatusDosAtributos {
  /** Produtos com atributo de cadastro de fornecedor. */
  cadastro: number;
  /** Produtos com teto de desconto do CDS. */
  desconto: number;
  /** Arquivos de onde cada bloco veio, e quando. */
  fontes: { cadastro: string[]; desconto: string[] };
  /** Import mais recente de cada bloco. */
  em: { cadastro: string | null; desconto: string | null };
}

// A contagem varre uma tabela que só o importador escreve — e `/health` é
// chamado pela verificação do deploy em laço. Um minuto de memória basta: o que
// a torna obsoleta é alguém rodar o importador, e isso não acontece durante um
// health check.
const MEMORIA_MS = 60_000;
let memoria: { em: number; valor: StatusDosAtributos } | null = null;

/** Descarta a memória — chamado por quem escreve atributos. */
export function esquecerStatusDosAtributos(): void {
  memoria = null;
}

export async function statusDosAtributos(): Promise<StatusDosAtributos> {
  const agora = Date.now();
  if (memoria && agora - memoria.em < MEMORIA_MS) return memoria.valor;

  const [cadastro, desconto, porCadastro, porDesconto] = await Promise.all([
    prisma.productAttribute.count({ where: { cadastroEm: { not: null } } }),
    prisma.productAttribute.count({ where: { maxDiscountPct: { not: null } } }),
    prisma.productAttribute.groupBy({
      by: ['fonteCadastro'],
      where: { fonteCadastro: { not: null } },
      _max: { cadastroEm: true },
    }),
    prisma.productAttribute.groupBy({
      by: ['fonteDesconto'],
      where: { fonteDesconto: { not: null } },
      _max: { descontoEm: true },
    }),
  ]);

  const maisRecente = (linhas: { _max: { cadastroEm?: Date | null; descontoEm?: Date | null } }[]): string | null => {
    let melhor: Date | null = null;
    for (const l of linhas) {
      const d = l._max.cadastroEm ?? l._max.descontoEm ?? null;
      if (d && (!melhor || d > melhor)) melhor = d;
    }
    return melhor ? melhor.toISOString() : null;
  };

  const valor: StatusDosAtributos = {
    cadastro,
    desconto,
    fontes: {
      cadastro: porCadastro.map((l) => l.fonteCadastro!).sort(),
      desconto: porDesconto.map((l) => l.fonteDesconto!).sort(),
    },
    em: { cadastro: maisRecente(porCadastro), desconto: maisRecente(porDesconto) },
  };
  memoria = { em: agora, valor };
  return valor;
}
