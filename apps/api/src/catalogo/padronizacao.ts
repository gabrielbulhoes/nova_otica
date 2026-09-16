import {
  familiaDePeca,
  NAO_IDENTIFICADO,
  normFormatoLente,
  normMaterialArmacao,
  type FormatoLenteChave,
  type MaterialArmacaoChave,
} from '../modules/planning/planning.math.js';

/**
 * A PADRONIZAÇÃO DE FORMATO E MATERIAL — rodada final · item 03.
 *
 * "Formato da lente e material da armação devem ser listas fechadas (…), nunca
 *  texto livre, 'Não identificado' quando incerto."
 *
 * O enum e as funções de normalização moram no motor (`planning.math.ts`, sem
 * imports, compartilhado com a interface). O que mora aqui é a REGRA DE
 * PROCEDÊNCIA: três fontes escrevem os mesmos dois campos, e sem uma ordem
 * declarada a última a rodar vence — o que faz o resultado depender da hora do
 * cron, não da qualidade do dado.
 *
 *     ficha (planilha do fornecedor) > erp (cadastro do CDS) > descricao
 *
 * A ficha é o cadastro do fabricante, conferido por gente. O ERP tem cobertura
 * alta e preenchimento irregular. A descrição é leitura de texto solto — vale
 * quando não há mais nada, e só quando a palavra é inequívoca.
 *
 * `NAO_IDENTIFICADO` CONTA COMO NÃO CLASSIFICADO para efeito de precedência: se
 * a ficha olhou e não soube dizer, uma fonte mais fraca que SAIBA pode
 * preencher, e a procedência passa a ser a dela. O contrário — deixar um "não
 * sei" de fonte forte bloquear um "aviador" escrito na descrição — guardaria a
 * hierarquia e jogaria fora a informação, que é o oposto do que ela serve.
 */

export type FonteDeAtributo = 'ficha' | 'erp' | 'descricao';

const PESO: Record<FonteDeAtributo, number> = { ficha: 3, erp: 2, descricao: 1 };

/** Fonte desconhecida (gravada por versão anterior) vale o mínimo, nunca zero. */
export const pesoDaFonte = (f: string | null | undefined): number =>
  f && f in PESO ? PESO[f as FonteDeAtributo] : f ? 1 : 0;

/** Um valor classificado de verdade — `NAO_IDENTIFICADO` não é. */
const classificado = (v: string | null | undefined): boolean => !!v && v !== NAO_IDENTIFICADO;

/** O que já está gravado num dos dois campos padronizados. */
export interface CampoPadronizado<T> {
  valor: T | null;
  fonte: string | null;
}

/**
 * Decide se o candidato substitui o que está gravado.
 *
 * Substitui quando:
 *  · não há nada classificado gravado e o candidato classifica; ou
 *  · o candidato vem de fonte de peso MAIOR OU IGUAL e classifica (reimportar
 *    a mesma ficha corrigida precisa valer — igual não pode empatar para o
 *    lado do que já está lá, senão a correção do fornecedor nunca entra);
 *  · o gravado é `NAO_IDENTIFICADO` e o candidato classifica, qualquer fonte.
 *
 * NÃO substitui quando o candidato é `NAO_IDENTIFICADO` e há coisa
 * classificada: "não sei" nunca apaga um "sei".
 */
export function devoGravar<T extends string>(
  atual: CampoPadronizado<T>,
  candidato: { valor: T | null; fonte: FonteDeAtributo },
): boolean {
  if (!candidato.valor) return false;
  if (!classificado(candidato.valor)) {
    // Um "não identificado" só entra onde não há nada — para registrar que
    // alguém olhou. Nunca por cima de um valor classificado.
    return atual.valor === null;
  }
  if (!classificado(atual.valor)) return true;
  if (pesoDaFonte(candidato.fonte) < pesoDaFonte(atual.fonte)) return false;
  // Mesma força ou mais forte: só vale escrever se MUDAR alguma coisa. Sem
  // esta linha, rodar o padronizador duas vezes reescreveria o catálogo
  // inteiro com valores idênticos — 61 mil escritas que não mudam nada, e um
  // relatório dizendo que classificou 61 mil peças que já estavam prontas.
  return candidato.valor !== atual.valor || candidato.fonte !== atual.fonte;
}

// ─── Leitura da DESCRIÇÃO ────────────────────────────────────────────────────

/**
 * A descrição do CDS é montada ("RB3548NL 001 54 OCULOS RAY BAN") e quase nunca
 * traz formato ou material. Quando traz, traz como palavra inteira — e é só
 * isso que esta leitura aceita.
 *
 * AUSÊNCIA DE PALAVRA NÃO É EVIDÊNCIA DE INCERTEZA. Se o texto não diz,
 * devolvemos `null`, e não `NAO_IDENTIFICADO`: marcar "não identificado" a
 * partir de uma descrição que nunca teve essa informação encheria o catálogo de
 * um veredito que ninguém deu, e esconderia as peças que de fato precisam de
 * ficha do fornecedor.
 */
const PALAVRAS_DE_FORMATO: [RegExp, FormatoLenteChave][] = [
  [/\bwayfarer\b/i, 'WAYFARER'],
  [/\baviador\b|\baviator\b|\bpiloto\b/i, 'AVIADOR'],
  [/\bcat\s?-?\s?eye\b|\bgatinho\b/i, 'GATINHO'],
  [/\bmascara\b|\bmáscara\b|\bshield\b/i, 'MASCARA'],
  [/\bretangular\b/i, 'RETANGULAR'],
  [/\bquadrad[ao]\b/i, 'QUADRADA'],
  [/\bredond[ao]\b|\bround\b/i, 'REDONDA'],
  [/\boval\b/i, 'OVAL'],
  [/\bhexagonal\b|\bgeometric[ao]\b/i, 'GEOMETRICA'],
];

const PALAVRAS_DE_MATERIAL: [RegExp, MaterialArmacaoChave][] = [
  [/\btr\s?-?\s?90\b/i, 'TR90'],
  [/\btit[âa]nio\b|\btitanium\b/i, 'TITANIO'],
  [/\bacetato\b/i, 'ACETATO'],
  [/\bnylon\b/i, 'NYLON'],
  [/\balum[íi]nio\b/i, 'ALUMINIO'],
  [/\bmadeira\b/i, 'MADEIRA'],
  [/\bmetal\b/i, 'METAL'],
];

export function formatoDaDescricao(descricao: string): FormatoLenteChave | null {
  for (const [re, chave] of PALAVRAS_DE_FORMATO) if (re.test(descricao)) return chave;
  return null;
}

export function materialDaDescricao(descricao: string): MaterialArmacaoChave | null {
  const achados = new Set<MaterialArmacaoChave>();
  for (const [re, chave] of PALAVRAS_DE_MATERIAL) if (re.test(descricao)) achados.add(chave);
  if (achados.size === 0) return null;
  if (achados.size > 1) {
    // "ACETATO METAL" na mesma descrição é combinação declarada; mas titânio e
    // alumínio SÃO metais, e a palavra "metal" ao lado deles é redundância.
    for (const m of ['TITANIO', 'ALUMINIO'] as const) {
      if (achados.has(m)) achados.delete('METAL');
    }
  }
  return achados.size > 1 ? 'COMBINADO' : [...achados][0];
}

// ─── O que uma peça ganha numa passada de padronização ──────────────────────

export interface PecaParaPadronizar {
  productId: string;
  description: string;
  category: string | null;
  /** O texto de formato já gravado (ficha ou ERP), se houver. */
  formatoTexto: string | null;
  materialTexto: string | null;
  formatoAtual: CampoPadronizado<FormatoLenteChave>;
  materialAtual: CampoPadronizado<MaterialArmacaoChave>;
  /** A fonte do texto gravado: `ficha` quando veio de planilha, `erp` do CDS. */
  fonteDoTexto: FonteDeAtributo | null;
}

export interface MudancaDePadronizacao {
  productId: string;
  formatoLente?: FormatoLenteChave;
  fonteFormato?: FonteDeAtributo;
  materialArmacao?: MaterialArmacaoChave;
  fonteMaterial?: FonteDeAtributo;
}

/** Só peças de moda entram: relógio, lente e acessório não têm aro nem lente. */
export const ehPecaDeModa = (category: string | null): boolean => {
  const f = familiaDePeca(category);
  return f === 'solar' || f === 'armacao';
};

/**
 * Decide o que gravar numa peça. Devolve `null` quando não há nada a fazer —
 * que é o caso da maioria numa segunda rodada, e é o que torna o comando
 * idempotente.
 */
export function padronizarPeca(p: PecaParaPadronizar): MudancaDePadronizacao | null {
  if (!ehPecaDeModa(p.category)) return null;
  const mudanca: MudancaDePadronizacao = { productId: p.productId };

  // 1. O texto que já existe no cadastro, classificado. É a fonte mais forte
  //    disponível sem pedir nada a ninguém.
  const doTexto = p.fonteDoTexto ?? 'ficha';
  const formatoDoTexto = normFormatoLente(p.formatoTexto);
  if (formatoDoTexto && devoGravar(p.formatoAtual, { valor: formatoDoTexto, fonte: doTexto })) {
    mudanca.formatoLente = formatoDoTexto;
    mudanca.fonteFormato = doTexto;
  }
  const materialDoTexto = normMaterialArmacao(p.materialTexto);
  if (materialDoTexto && devoGravar(p.materialAtual, { valor: materialDoTexto, fonte: doTexto })) {
    mudanca.materialArmacao = materialDoTexto;
    mudanca.fonteMaterial = doTexto;
  }

  // 2. A descrição, só onde ainda não há classificação — e só palavra inteira.
  if (!mudanca.formatoLente && !classificado(p.formatoAtual.valor)) {
    const f = formatoDaDescricao(p.description);
    if (f && devoGravar(p.formatoAtual, { valor: f, fonte: 'descricao' })) {
      mudanca.formatoLente = f;
      mudanca.fonteFormato = 'descricao';
    }
  }
  if (!mudanca.materialArmacao && !classificado(p.materialAtual.valor)) {
    const m = materialDaDescricao(p.description);
    if (m && devoGravar(p.materialAtual, { valor: m, fonte: 'descricao' })) {
      mudanca.materialArmacao = m;
      mudanca.fonteMaterial = 'descricao';
    }
  }

  return mudanca.formatoLente || mudanca.materialArmacao ? mudanca : null;
}

/**
 * O que a padronização escreveria a partir de um texto — usado pelo importador
 * e pela sincronização, que já sabem a fonte e ainda não leram o que existe.
 */
export function classificarTextos(
  formatoTexto: string | null,
  materialTexto: string | null,
): { formatoLente: FormatoLenteChave | null; materialArmacao: MaterialArmacaoChave | null } {
  return {
    formatoLente: normFormatoLente(formatoTexto),
    materialArmacao: normMaterialArmacao(materialTexto),
  };
}
