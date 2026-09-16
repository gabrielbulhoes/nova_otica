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
  /** Produtos com atributo vindo da sincronização com o ERP. */
  erp: number;
  /** Produtos com teto de desconto do CDS. */
  desconto: number;
  /**
   * A COBERTURA DA PADRONIZAÇÃO (rodada final · item 03) — o número que diz se
   * a composição do mix por perfil tem base para funcionar.
   *
   * `classificado` e `naoIdentificado` são contados separados de propósito: o
   * primeiro entra nos perfis, o segundo não, e somá-los faria a cobertura
   * parecer completa justamente onde ela não é. `porFonte` mostra de onde veio
   * — uma base 90% classificada a partir da DESCRIÇÃO merece outra confiança
   * que uma base 90% vinda da ficha do fornecedor.
   */
  padronizacao: {
    formato: { classificado: number; naoIdentificado: number };
    material: { classificado: number; naoIdentificado: number };
    porFonte: { formato: Record<string, number>; material: Record<string, number> };
  };
  /** Arquivos de onde cada bloco veio, e quando. */
  fontes: { cadastro: string[]; desconto: string[] };
  /** Import mais recente de cada bloco. */
  em: { cadastro: string | null; desconto: string | null };
}

// A contagem varre uma tabela inteira nove vezes — e `/health` é chamado em
// laço pela verificação do deploy. Guardar a resposta por um minuto evita isso.
//
// MAS A MEMÓRIA É DE UM PROCESSO SÓ, E QUEM ESCREVE COSTUMA SER OUTRO.
//
// `esquecerStatusDosAtributos()` limpa a memória de quem o chama. O padronizador
// e o importador do catálogo rodam por `docker exec`, num processo separado do
// da API: eles limpavam a própria memória — recém-criada e vazia — enquanto a
// API continuava respondendo o número velho pelo resto do minuto.
//
// Isso aconteceu em 16/09/2026. Depois de o padronizador gravar 2.559 peças, o
// `/health` seguiu dizendo `formato.naoIdentificado: 989`, e a operação foi
// conferir no banco achando que a gravação tinha falhado. Não tinha: o número
// certo apareceu sozinho minutos depois. Um painel que mente por um minuto logo
// depois da única ação que o muda mente exatamente na hora em que é lido.
//
// A correção é perguntar ao BANCO se mudou alguma coisa, porque o banco é o
// único lugar que os dois processos enxergam. O carimbo é UMA agregação — nove
// viram uma quando nada mudou, e zero memória quando mudou.
const MEMORIA_MS = 60_000;
let memoria: { em: number; carimbo: string; valor: StatusDosAtributos } | null = null;

/**
 * Descarta a memória — chamado por quem escreve atributos NO MESMO PROCESSO.
 *
 * Continua valendo a pena (poupa até a agregação do carimbo na sincronização,
 * que roda dentro da API), mas não é mais a única defesa: o carimbo cobre o
 * escritor de fora, que esta função nunca alcançou.
 */
export function esquecerStatusDosAtributos(): void {
  memoria = null;
}

/**
 * O estado de escrita da tabela em uma linha: quantas peças existem e quando
 * cada uma das quatro fontes escreveu pela última vez.
 *
 * As quatro datas são as dos quatro únicos escritores — ficha do fornecedor
 * (`cadastroEm`), teto de desconto (`descontoEm`), sincronização com o ERP
 * (`erpEm`) e padronizador (`padronizadoEm`). Qualquer um deles move o seu
 * carimbo, e mover o carimbo é o que derruba a memória.
 *
 * A CONTAGEM entra junto das datas porque uma linha APAGADA — produto removido
 * leva o atributo por cascata — muda o total sem mover data nenhuma.
 */
async function carimboDaTabela(): Promise<string> {
  const a = await prisma.productAttribute.aggregate({
    _count: { _all: true },
    _max: { cadastroEm: true, descontoEm: true, erpEm: true, padronizadoEm: true },
  });
  const t = (d: Date | null | undefined) => (d ? d.getTime() : 0);
  return [
    a._count._all,
    t(a._max.cadastroEm),
    t(a._max.descontoEm),
    t(a._max.erpEm),
    t(a._max.padronizadoEm),
  ].join('|');
}

export async function statusDosAtributos(): Promise<StatusDosAtributos> {
  const agora = Date.now();
  const carimbo = await carimboDaTabela();
  // O tempo continua no teste como TETO, não como critério: o carimbo é quem
  // sabe se mudou. O minuto só garante que nenhuma memória sobreviva a um caso
  // que ninguém previu aqui.
  if (memoria && memoria.carimbo === carimbo && agora - memoria.em < MEMORIA_MS) return memoria.valor;

  const [cadastro, erp, desconto, porCadastro, porDesconto, porFonteFormato, porFonteMaterial, naoIdFormato, naoIdMaterial] =
    await Promise.all([
    prisma.productAttribute.count({ where: { cadastroEm: { not: null } } }),
    prisma.productAttribute.count({ where: { erpEm: { not: null } } }),
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
    prisma.productAttribute.groupBy({
      by: ['fonteFormato'],
      where: { formatoLente: { not: null } },
      _count: { _all: true },
    }),
    prisma.productAttribute.groupBy({
      by: ['fonteMaterial'],
      where: { materialArmacao: { not: null } },
      _count: { _all: true },
    }),
    prisma.productAttribute.count({ where: { formatoLente: 'NAO_IDENTIFICADO' } }),
    prisma.productAttribute.count({ where: { materialArmacao: 'NAO_IDENTIFICADO' } }),
  ]);

  // A chave do agrupamento muda entre os dois (fonteFormato/fonteMaterial), e
  // o tipo que o Prisma devolve carrega esse nome — ler por índice é o preço
  // de não duplicar a função.
  const porFonte = (
    linhas: readonly { _count: { _all: number } }[],
    chave: 'fonteFormato' | 'fonteMaterial',
  ): Record<string, number> => {
    const o: Record<string, number> = {};
    for (const l of linhas) {
      const k = (l as unknown as Record<string, string | null>)[chave] ?? 'sem fonte';
      o[k] = (o[k] ?? 0) + l._count._all;
    }
    return o;
  };
  const totalFormato = porFonteFormato.reduce((a, l) => a + l._count._all, 0);
  const totalMaterial = porFonteMaterial.reduce((a, l) => a + l._count._all, 0);

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
    erp,
    desconto,
    padronizacao: {
      formato: { classificado: totalFormato - naoIdFormato, naoIdentificado: naoIdFormato },
      material: { classificado: totalMaterial - naoIdMaterial, naoIdentificado: naoIdMaterial },
      porFonte: {
        formato: porFonte(porFonteFormato, 'fonteFormato'),
        material: porFonte(porFonteMaterial, 'fonteMaterial'),
      },
    },
    fontes: {
      cadastro: porCadastro.map((l) => l.fonteCadastro!).sort(),
      desconto: porDesconto.map((l) => l.fonteDesconto!).sort(),
    },
    em: { cadastro: maisRecente(porCadastro), desconto: maisRecente(porDesconto) },
  };
  memoria = { em: agora, carimbo, valor };
  return valor;
}
