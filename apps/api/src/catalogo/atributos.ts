import type { Planilha } from '../lib/xlsx.js';

/**
 * Os atributos de peça que o ERP não entrega — e como casá-los com o catálogo.
 *
 * Este arquivo é só conta e texto: não toca banco, não lê arquivo. É o que
 * permite provar a regra de casamento contra as planilhas de verdade sem
 * precisar de Postgres.
 */

/** O que uma linha de cadastro de fornecedor traz sobre uma peça. */
export interface AtributosDeCatalogo {
  barraCds: string;
  referencia: string | null;
  gtin: string | null;
  marcaCatalogo: string | null;
  genero: string | null;
  formato: string | null;
  material: string | null;
  cor: string | null;
  codigoCor: string | null;
  tamanhoLente: number | null;
  alturaLente: number | null;
  tamanhoPonte: number | null;
  tamanhoHaste: number | null;
  bestSeller: boolean;
  imagemUrl: string | null;
}

/** As partes que a descrição do CDS carrega grudadas. */
export interface DescricaoDecomposta {
  referencia: string;
  codigoCor: string;
  tamanho: string;
  grupo: 'ARMACAO' | 'OCULOS';
  marca: string;
}

/**
 * A descrição de uma peça de moda no CDS é montada, não escrita:
 *
 *     "RB3548NL 001 54 OCULOS RAY BAN"
 *        │      │   │    │       └── marca
 *        │      │   │    └── grupo
 *        │      │   └── tamanho da lente
 *        │      └── código da cor
 *        └── referência do fabricante
 *
 * Lente, acessório e serviço não seguem este formato — para eles a função
 * devolve `null`, e isso não é falha: é a resposta certa.
 */
const PADRAO = /^(\S+)\s+(\S+)\s+(\d{2})\s+(ARMACAO|OCULOS)\s+(.+)$/i;

export function decomporDescricao(descricao: string): DescricaoDecomposta | null {
  const m = PADRAO.exec(descricao.trim());
  if (!m) return null;
  return {
    referencia: m[1].toUpperCase(),
    codigoCor: m[2].toUpperCase(),
    tamanho: m[3],
    grupo: m[4].toUpperCase() as 'ARMACAO' | 'OCULOS',
    marca: m[5].trim().toUpperCase(),
  };
}

/**
 * A chave de casamento — a "Barra CDS" do fornecedor.
 *
 * MEDIDO, não suposto: `Referência + Código da Cor + Tamanho da lente`
 * reconstrói a `Barra CDS` em 95% das 16.535 linhas do cadastro Luxottica. Os
 * outros dois candidatos óbvios foram testados e descartados — `GTIN` e a
 * própria `Barra CDS` contra `externalId` dão ZERO casamentos, porque
 * `externalId` é o `codigo_base` numérico do CDS e não tem relação com o
 * código do fabricante.
 */
export function chaveDeCatalogo(partes: {
  referencia: string;
  codigoCor: string;
  tamanho: string | number;
}): string {
  return normalizarChave(`${partes.referencia}${partes.codigoCor}${partes.tamanho}`);
}

/** Maiúscula, só alfanumérico — o cadastro e a descrição pontuam diferente. */
export function normalizarChave(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const inteiro = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};
const texto = (s: string | undefined): string | null => {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
};

/**
 * Lê um cadastro de fornecedor, indexado pela chave de casamento.
 *
 * Os cadastros não têm colunas idênticas — o da Luxottica traz `Referência`,
 * `Best Seller` e `Altura da Lente`; o da Marchon traz URLs de imagem e não traz
 * referência. A leitura é POR NOME DE COLUNA, não por posição, e o que faltar
 * vira `null` em vez de deslocar o resto da linha.
 */
export function lerCadastroFornecedor(
  planilha: Planilha,
  aba = 0,
): { linhas: Map<string, AtributosDeCatalogo>; marcas: Set<string>; ignoradas: number; repetidas: number } {
  const dados = planilha.linhas(aba);
  if (dados.length === 0) return { linhas: new Map(), marcas: new Set(), ignoradas: 0, repetidas: 0 };

  const cab = dados[0].map((c) => c.trim().toLowerCase());
  const col = (...nomes: string[]): number => {
    for (const n of nomes) {
      const i = cab.indexOf(n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  const iBarra = col('barra cds');
  if (iBarra < 0) {
    throw new Error('cadastro de fornecedor sem a coluna "Barra CDS" — não dá para casar com o catálogo');
  }
  const idx = {
    referencia: col('referência', 'referencia'),
    gtin: col('gtin'),
    marca: col('marca'),
    genero: col('gênero', 'genero'),
    formato: col('formato da armação', 'formato da armacao'),
    material: col('material da armação', 'material da armacao'),
    cor: col('cor da armação', 'cor da armacao'),
    codigoCor: col('código da cor', 'codigo da cor'),
    tamanhoLente: col('tamanho da lente'),
    alturaLente: col('altura da lente'),
    tamanhoPonte: col('tamanho da ponte'),
    tamanhoHaste: col('tamanho da haste', 'comprimento da haste'),
    bestSeller: col('best seller'),
    imagem: col('parceiros_imagem_original_png', 'parceiros_imagem_original_jpg', 'parceiros_imagem_grande'),
  };
  const em = (linha: string[], i: number) => (i >= 0 ? linha[i] : undefined);

  const linhas = new Map<string, AtributosDeCatalogo>();
  const marcas = new Set<string>();
  let ignoradas = 0;
  let repetidas = 0;
  for (let i = 1; i < dados.length; i++) {
    const l = dados[i];
    const barra = (l[iBarra] ?? '').trim();
    if (!barra) {
      ignoradas += 1;
      continue;
    }
    const marca = texto(em(l, idx.marca));
    if (marca) marcas.add(marca.toUpperCase());
    // A ÚLTIMA linha vence quando a mesma barra repete. Cadastro de fornecedor
    // chega com a peça repetida por variação que não nos interessa (embalagem,
    // lote), e a de baixo costuma ser a mais recente. Mas a repetição é
    // CONTADA: 252 linhas colapsando em silêncio num arquivo de 4.859 é o tipo
    // de coisa que se descobre tarde, quando o número não fecha com o do
    // fornecedor.
    if (linhas.has(normalizarChave(barra))) repetidas += 1;
    linhas.set(normalizarChave(barra), {
      barraCds: barra,
      referencia: texto(em(l, idx.referencia)),
      gtin: texto(em(l, idx.gtin)),
      marcaCatalogo: texto(em(l, idx.marca)),
      genero: texto(em(l, idx.genero)),
      formato: texto(em(l, idx.formato)),
      material: texto(em(l, idx.material)),
      cor: texto(em(l, idx.cor)),
      codigoCor: texto(em(l, idx.codigoCor)),
      tamanhoLente: inteiro(em(l, idx.tamanhoLente)),
      alturaLente: inteiro(em(l, idx.alturaLente)),
      tamanhoPonte: inteiro(em(l, idx.tamanhoPonte)),
      tamanhoHaste: inteiro(em(l, idx.tamanhoHaste)),
      // A planilha marca com "Sim" e deixa vazio o resto — qualquer texto
      // preenchido vale como marcação, para não depender do idioma da coluna.
      bestSeller: (em(l, idx.bestSeller) ?? '').trim() !== '',
      imagemUrl: texto(em(l, idx.imagem)),
    });
  }
  return { linhas, marcas, ignoradas, repetidas };
}

/**
 * Lê a planilha de promoção do CDS: `código do produto → teto de desconto (%)`.
 *
 * Esta casa por `externalId` (o `codigo_base`), direto, sem heurística. A
 * planilha vem de tabela dinâmica e traz linha de rótulo no fim ("ROBERTO",
 * totais); só código estritamente numérico entra, e o resto é contado e
 * relatado em vez de descartado em silêncio.
 */
export function lerTetoDeDesconto(
  planilha: Planilha,
  aba = 0,
): { tetos: Map<string, number>; ignoradas: number } {
  const dados = planilha.linhas(aba);
  const tetos = new Map<string, number>();
  let ignoradas = 0;
  for (let i = 1; i < dados.length; i++) {
    const codigo = (dados[i][0] ?? '').trim();
    const pct = Number((dados[i][1] ?? '').trim());
    if (!/^\d+$/.test(codigo) || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
      ignoradas += 1;
      continue;
    }
    tetos.set(codigo, Math.round(pct * 100) / 100);
  }
  return { tetos, ignoradas };
}

/** Formato reconhecido de uma planilha, decidido pelo cabeçalho. */
export type TipoDePlanilha = 'cadastro' | 'desconto';

export function reconhecerPlanilha(planilha: Planilha, aba = 0): TipoDePlanilha | null {
  const cab = (planilha.linhas(aba)[0] ?? []).map((c) => c.trim().toLowerCase());
  if (cab.includes('barra cds')) return 'cadastro';
  if (cab.some((c) => c.startsWith('rótulos de linha') || c.startsWith('rotulos de linha'))) return 'desconto';
  return null;
}

// ─── O relatório do import ───────────────────────────────────────────────────

export interface RelatorioDeCasamento {
  produtos: number;
  /** Descrição fora do formato de peça de moda — lente, serviço, acessório. */
  semFormato: number;
  /** Formato reconhecido e chave encontrada no cadastro. */
  casados: number;
  /** Formato reconhecido e chave AUSENTE do cadastro. */
  semCadastro: number;
  /**
   * Dos não casados, os de marca que este cadastro NEM TRABALHA. Esperado — o
   * arquivo da Marchon não tem por que conter uma Ray-Ban. Resolve-se pedindo o
   * cadastro do outro fornecedor, não mexendo em código.
   */
  marcaForaDoCadastro: number;
  /**
   * Dos não casados, os de marca que o cadastro TEM. Este é o número que
   * acusa problema de CHAVE, e é o único que justifica mexer no casamento.
   *
   * Sem esta separação o relatório mente por omissão: importar a planilha da
   * Marchon contra um catálogo de Ray-Ban mostrava "0% de casamento" e uma
   * lista de marcas faltantes que dava a entender defeito onde não havia.
   */
  marcaNoCadastroSemCasar: number;
  /** Marcas que mais aparecem entre os não casados — é o que se pede a seguir. */
  marcasFaltantes: { marca: string; produtos: number; noCadastro: boolean }[];
}

/**
 * Cruza catálogo e cadastro SEM tocar no banco, para o importador poder
 * relatar antes de gravar.
 *
 * O relatório existe por uma razão específica e cara: a regra de mix ficou
 * meses desligada em produção porque o catálogo de grifes não estava lá e a
 * ausência virava `null` silencioso. Import que não diz quanto casou é a mesma
 * armadilha com outro nome.
 */
export function cruzar(
  produtos: { productId: string; description: string }[],
  cadastro: Map<string, AtributosDeCatalogo>,
  marcasDoCadastro: ReadonlySet<string> = new Set(),
): { encontrados: Map<string, AtributosDeCatalogo>; relatorio: RelatorioDeCasamento } {
  const encontrados = new Map<string, AtributosDeCatalogo>();
  const faltantes = new Map<string, number>();
  let semFormato = 0;
  let semCadastro = 0;
  let marcaForaDoCadastro = 0;

  for (const p of produtos) {
    const partes = decomporDescricao(p.description);
    if (!partes) {
      semFormato += 1;
      continue;
    }
    const achado = cadastro.get(chaveDeCatalogo(partes));
    if (achado) encontrados.set(p.productId, achado);
    else {
      semCadastro += 1;
      // A marca da descrição contra as marcas do arquivo. A comparação é por
      // prefixo nos dois sentidos porque a descrição diz "RAY BAN JR" onde o
      // cadastro diz "RAY BAN JUNIOR" — e tratar isso como marca desconhecida
      // inflaria o número que serve para pedir cadastro ao fornecedor.
      if (!temAMarca(marcasDoCadastro, partes.marca)) marcaForaDoCadastro += 1;
      faltantes.set(partes.marca, (faltantes.get(partes.marca) ?? 0) + 1);
    }
  }

  return {
    encontrados,
    relatorio: {
      produtos: produtos.length,
      semFormato,
      casados: encontrados.size,
      semCadastro,
      marcaForaDoCadastro,
      marcaNoCadastroSemCasar: semCadastro - marcaForaDoCadastro,
      marcasFaltantes: [...faltantes.entries()]
        .map(([marca, produtos]) => ({ marca, produtos, noCadastro: temAMarca(marcasDoCadastro, marca) }))
        .sort((a, b) => b.produtos - a.produtos)
        .slice(0, 10),
    },
  };
}

/**
 * A marca da descrição está entre as do cadastro?
 *
 * A comparação é pela PRIMEIRA PALAVRA, e não por igualdade, porque as duas
 * pontas escrevem a mesma casa de jeitos diferentes: a descrição diz
 * "RAY BAN JR" onde o cadastro diz "RAY BAN JUNIOR"; "DOLCE GABBANA KIDS"
 * convive com "DOLCE GABBANA".
 *
 * O ERRO QUE ESTA ESCOLHA PREFERE COMETER. Casar por palavra inicial classifica
 * demais como "marca coberta", inflando o número de "não casou e a marca está
 * aqui" — o número que manda alguém investigar a chave. O erro contrário
 * (classificar um defeito de chave como "é de outro fornecedor") esconderia o
 * problema, e esconder é o que não se pode fazer aqui.
 */
function temAMarca(marcas: ReadonlySet<string>, marca: string): boolean {
  if (marcas.has(marca)) return true;
  const casa = (s: string) => s.split(/\s+/)[0] ?? '';
  const primeira = casa(marca);
  if (primeira.length < 3) return false;
  for (const m of marcas) {
    if (casa(m) === primeira) return true;
  }
  return false;
}
