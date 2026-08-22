import type { Planilha } from '../lib/xlsx.js';

/**
 * A PLANILHA DE OFERTA de um fornecedor para uma feira.
 *
 * É a entrada do modo feira: as peças que o fornecedor está oferecendo para a
 * coleção, com o que se precisa saber para planejar a compra — grife, tipo,
 * gênero, formato, cor, custo e preço.
 *
 * O PROBLEMA REAL não é ler XLSX; é que cada fornecedor manda um cabeçalho
 * diferente. A Luxottica escreve "Referência", a Safilo pode escrever "Código",
 * a Marcolin "SKU". Exigir um formato único transferiria ao cliente o trabalho
 * de reformatar planilha antes de cada feira — e planilha reformatada à mão é
 * planilha com erro de digitação.
 *
 * Então o reconhecimento é por SINÔNIMOS, normalizados. O que NÃO se aceita é
 * adivinhar: coluna que não casa com sinônimo nenhum é ignorada e DECLARADA no
 * relatório, para que o operador veja que ela ficou de fora em vez de descobrir
 * meses depois que o gênero nunca entrou.
 */

/** Normaliza um cabeçalho: minúscula, sem acento, sem pontuação, colapsado. */
export function normalizarCabecalho(s: string): string {
  return s
    .normalize('NFD')
    // Escape explícito, e não os caracteres combinantes literais: eles são
    // invisíveis no editor e sobrevivem mal a copiar-e-colar entre arquivos.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Os sinônimos aceitos de cada campo, em ordem de preferência.
 *
 * A ordem importa quando uma planilha traz duas colunas plausíveis: "preço de
 * custo" e "preço sugerido" casariam ambas com "preco" se a busca fosse por
 * substring solta. Por isso o casamento é EXATO contra a lista, e a lista
 * carrega as formas completas que os fornecedores usam.
 */
export const SINONIMOS: Record<CampoDaOferta, string[]> = {
  sku: ['sku', 'referencia', 'ref', 'codigo', 'cod', 'codigo do produto', 'modelo', 'material'],
  description: ['descricao', 'produto', 'nome', 'descricao do produto', 'item'],
  brand: ['marca', 'grife', 'brand', 'colecao', 'linha'],
  tipo: ['tipo', 'categoria', 'grupo', 'segmento', 'familia'],
  genero: ['genero', 'sexo', 'publico', 'gender'],
  formato: ['formato', 'formato do aro', 'shape', 'modelo do aro', 'tipo de aro'],
  cor: ['cor', 'cor da armacao', 'color', 'colorido', 'descricao da cor'],
  unitCost: ['custo', 'preco de custo', 'custo unitario', 'valor de custo', 'preco de compra', 'atacado'],
  unitPrice: ['preco', 'preco de venda', 'preco sugerido', 'venda', 'varejo', 'pvp', 'preco final'],
};

export type CampoDaOferta =
  | 'sku'
  | 'description'
  | 'brand'
  | 'tipo'
  | 'genero'
  | 'formato'
  | 'cor'
  | 'unitCost'
  | 'unitPrice';

/** Sem estes quatro o plano não roda: não há peça, nem grife, nem economia. */
export const OBRIGATORIOS: CampoDaOferta[] = ['sku', 'description', 'brand', 'unitPrice'];

export interface LinhaDaOferta {
  sku: string;
  description: string;
  brand: string;
  tipo: string | null;
  genero: string | null;
  formato: string | null;
  cor: string | null;
  unitCost: number;
  unitPrice: number;
}

export interface RelatorioDaOferta {
  linhas: LinhaDaOferta[];
  /** Cabeçalho → campo reconhecido. O operador confere o que casou. */
  colunas: Record<string, CampoDaOferta>;
  /** Colunas que a planilha trouxe e ninguém reconheceu — declaradas. */
  ignoradas: string[];
  /** Campos que não vieram na planilha. Os obrigatórios impedem o import. */
  ausentes: CampoDaOferta[];
  /** Linhas descartadas por faltar SKU ou preço, com o motivo. */
  descartadas: { linha: number; motivo: string }[];
  /** SKUs repetidos: a última ocorrência vence, e o operador precisa saber. */
  repetidos: number;
}

/**
 * Converte "1.234,56" e "1234.56" no mesmo número.
 *
 * As duas formas chegam do mesmo fornecedor em arquivos diferentes, e tratar
 * a vírgula como separador de milhar transformaria R$ 1.234,56 em R$ 123.456.
 * O critério é o ÚLTIMO separador: ele é o decimal.
 */
export function lerNumero(v: string): number | null {
  const limpo = (v ?? '').replace(/[^\d,.-]/g, '').trim();
  if (!limpo) return null;
  const ultimaVirgula = limpo.lastIndexOf(',');
  const ultimoPonto = limpo.lastIndexOf('.');
  let normal = limpo;

  if (ultimaVirgula >= 0 && ultimoPonto >= 0) {
    // Os dois presentes: o ÚLTIMO é o decimal, o outro é milhar.
    normal =
      ultimaVirgula > ultimoPonto
        ? limpo.replace(/\./g, '').replace(',', '.')
        : limpo.replace(/,/g, '');
  } else {
    /*
     * UM SEPARADOR SÓ — e é aqui que o leitor erra por 1000 se for ingênuo.
     *
     * "1.234" pode ser mil duzentos e trinta e quatro (milhar, planilha
     * brasileira) ou um inteiro com três decimais. Lido como decimal, um
     * preço de R$ 1.234 vira R$ 1,23 — e a peça sobe ao topo do plano por ser
     * "barata".
     *
     * Estes arquivos são de PREÇO, e preço tem duas casas. Então separador
     * único seguido de EXATAMENTE três dígitos é milhar; qualquer outra
     * contagem (uma ou duas casas) é decimal. Vale para os dois símbolos,
     * porque as duas leituras apontam para o mesmo número.
     */
    const único = ultimaVirgula >= 0 ? ultimaVirgula : ultimoPonto;
    if (único >= 0) {
      const decimais = limpo.length - único - 1;
      normal =
        decimais === 3
          ? limpo.slice(0, único) + limpo.slice(único + 1)
          : limpo.replace(',', '.');
    }
  }

  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** Lê a planilha de oferta, declarando tudo que não coube. */
export function lerOfertaDeFeira(planilha: Planilha, aba = 0): RelatorioDaOferta {
  const linhas = planilha.linhas(aba);
  const cabecalho = (linhas[0] ?? []).map((c) => normalizarCabecalho(c));

  const colunas: Record<string, CampoDaOferta> = {};
  const indice = {} as Record<CampoDaOferta, number>;
  const ignoradas: string[] = [];

  cabecalho.forEach((titulo, i) => {
    if (!titulo) return;
    const campo = (Object.keys(SINONIMOS) as CampoDaOferta[]).find(
      (k) => SINONIMOS[k].includes(titulo) && indice[k] === undefined,
    );
    if (campo) {
      indice[campo] = i;
      colunas[(linhas[0] ?? [])[i] ?? titulo] = campo;
    } else {
      ignoradas.push((linhas[0] ?? [])[i] ?? titulo);
    }
  });

  const ausentes = (Object.keys(SINONIMOS) as CampoDaOferta[]).filter((k) => indice[k] === undefined);
  const descartadas: { linha: number; motivo: string }[] = [];
  const porSku = new Map<string, LinhaDaOferta>();
  let repetidos = 0;

  // Sem os obrigatórios não se lê linha nenhuma: devolver zero linha com o
  // motivo é melhor que devolver mil linhas erradas.
  if (OBRIGATORIOS.some((k) => indice[k] === undefined)) {
    return { linhas: [], colunas, ignoradas, ausentes, descartadas, repetidos: 0 };
  }

  const texto = (l: string[], c: number | undefined) =>
    c === undefined ? null : (l[c] ?? '').trim() || null;

  for (let i = 1; i < linhas.length; i += 1) {
    const l = linhas[i];
    const sku = texto(l, indice.sku);
    const description = texto(l, indice.description);
    const brand = texto(l, indice.brand);
    const preco = lerNumero(l[indice.unitPrice] ?? '');

    if (!sku) {
      // Linha em branco no fim da planilha é o caso comum e não merece ruído.
      if (l.some((c) => c.trim())) descartadas.push({ linha: i + 1, motivo: 'sem SKU' });
      continue;
    }
    if (!description || !brand) {
      descartadas.push({ linha: i + 1, motivo: !description ? 'sem descrição' : 'sem grife' });
      continue;
    }
    if (preco === null || preco <= 0) {
      descartadas.push({ linha: i + 1, motivo: 'sem preço de venda' });
      continue;
    }

    if (porSku.has(sku)) repetidos += 1;
    porSku.set(sku, {
      sku,
      description,
      brand,
      tipo: texto(l, indice.tipo),
      genero: texto(l, indice.genero),
      formato: texto(l, indice.formato),
      cor: texto(l, indice.cor),
      // Custo ausente NÃO é zero: zero daria margem de 100% e faria a peça
      // parecer a melhor da feira. Estima em 45% do preço — a mesma margem
      // típica que o resto do motor usa quando o ERP não traz o custo.
      unitCost: lerNumero(l[indice.unitCost] ?? '') ?? Math.round(preco * 0.55 * 100) / 100,
      unitPrice: preco,
    });
  }

  return { linhas: [...porSku.values()], colunas, ignoradas, ausentes, descartadas, repetidos };
}
