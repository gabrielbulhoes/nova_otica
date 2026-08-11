import { inflateRawSync } from 'node:zlib';

/**
 * Leitor mínimo de `.xlsx` — o suficiente para importar planilha de catálogo.
 *
 * POR QUE ESCRITO À MÃO, E NÃO UMA DEPENDÊNCIA
 *
 * `apps/api` tem dez dependências de produção, escolhidas uma a uma, e roda
 * numa máquina de 2 GB dividida com o banco. As bibliotecas de xlsx do npm
 * trazem parser de fórmula, de estilo e de gráfico — nada disso é usado aqui, e
 * a mais popular tem histórico de CVE e distribuição fora do registro.
 *
 * Um `.xlsx` é um ZIP de XML. O que precisamos ler são células de texto e
 * número numa aba. São dois formatos estáveis desde 2007, e o código abaixo
 * cobre exatamente eles — falhando ALTO no que não cobre, em vez de devolver
 * planilha pela metade.
 *
 * O que NÃO é suportado, de propósito: ZIP64, entradas cifradas, compressão
 * fora de "armazenado" e "deflate", e fórmulas (lê-se o valor calculado, que é
 * o que o Excel grava junto). Cada um desses lança erro nomeado.
 */

interface EntradaZip {
  nome: string;
  metodo: number;
  inicioDados: number;
  tamanhoComprimido: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

/** Índice do ZIP, lido pelo diretório central (e não varrendo o arquivo). */
function abrirZip(buf: Buffer): Map<string, EntradaZip> {
  // O EOCD fica no fim, depois de um comentário de até 64 KiB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('xlsx: não é um arquivo ZIP válido (fim de diretório não encontrado)');

  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (p === 0xffffffff) throw new Error('xlsx: arquivo em formato ZIP64, não suportado');

  const entradas = new Map<string, EntradaZip>();
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== CENTRAL) throw new Error('xlsx: diretório central corrompido');
    const metodo = buf.readUInt16LE(p + 10);
    const tamanhoComprimido = buf.readUInt32LE(p + 20);
    const nomeLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const comentLen = buf.readUInt16LE(p + 32);
    const offsetLocal = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + nomeLen);

    // O cabeçalho local repete o tamanho dos campos variáveis, e é ELE que vale
    // para achar onde os dados começam — os do diretório central divergem.
    const nomeLenLocal = buf.readUInt16LE(offsetLocal + 26);
    const extraLenLocal = buf.readUInt16LE(offsetLocal + 28);
    entradas.set(nome, {
      nome,
      metodo,
      inicioDados: offsetLocal + 30 + nomeLenLocal + extraLenLocal,
      tamanhoComprimido,
    });
    p += 46 + nomeLen + extraLen + comentLen;
  }
  return entradas;
}

function extrair(buf: Buffer, e: EntradaZip): string {
  const dados = buf.subarray(e.inicioDados, e.inicioDados + e.tamanhoComprimido);
  if (e.metodo === 0) return dados.toString('utf8');
  if (e.metodo === 8) return inflateRawSync(dados).toString('utf8');
  throw new Error(`xlsx: compressão ${e.metodo} não suportada em "${e.nome}"`);
}

const ENTIDADES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function desescapar(s: string): string {
  if (!s.includes('&')) return s;
  return s
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTIDADES[m])
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
}

/** Concatena todo `<t>` de um trecho — cobre texto simples e texto com estilo. */
function textoDe(trecho: string): string {
  let saida = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trecho)) !== null) saida += desescapar(m[1] ?? '');
  return saida;
}

/** Índice de coluna a partir da referência da célula: "A"→0, "AB"→27. */
function coluna(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

export interface Planilha {
  /** Nome de cada aba, na ordem do arquivo. */
  abas: string[];
  /** Linhas de uma aba, já como matriz de texto. Índice base 0. */
  linhas(aba: number): string[][];
}

/**
 * Abre uma planilha. Devolve as abas sob demanda: os arquivos de catálogo têm
 * dezenas de milhares de linhas, e materializar as abas que ninguém vai ler é
 * desperdício num processo limitado a 768 MB.
 */
export function abrirPlanilha(buf: Buffer): Planilha {
  const zip = abrirZip(buf);

  const wb = zip.get('xl/workbook.xml');
  if (!wb) throw new Error('xlsx: sem xl/workbook.xml — o arquivo não é uma planilha do Excel');
  const abas = [...extrair(buf, wb).matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => desescapar(m[1]));

  // Texto compartilhado: o Excel guarda a maioria das strings aqui e deixa na
  // célula só o índice.
  let compartilhado: string[] = [];
  const ss = zip.get('xl/sharedStrings.xml');
  if (ss) {
    compartilhado = [...extrair(buf, ss).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g)].map((m) =>
      textoDe(m[1] ?? ''),
    );
  }

  return {
    abas,
    linhas(aba: number): string[][] {
      const entrada = zip.get(`xl/worksheets/sheet${aba + 1}.xml`);
      if (!entrada) throw new Error(`xlsx: aba ${aba + 1} não existe`);
      const xml = extrair(buf, entrada);
      const saida: string[][] = [];

      for (const mRow of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
        const corpo = mRow[1] ?? '';
        const linha: string[] = [];
        for (const mC of corpo.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)) {
          const attrs = mC[1] ?? mC[3] ?? '';
          const conteudo = mC[2] ?? '';
          const ref = /\br="([A-Z]+)/.exec(attrs);
          const idx = ref ? coluna(ref[1]) : linha.length;
          const tipo = /\bt="([^"]*)"/.exec(attrs)?.[1];

          let valor = '';
          if (tipo === 's') {
            const v = /<v>([\s\S]*?)<\/v>/.exec(conteudo);
            valor = v ? (compartilhado[Number(v[1])] ?? '') : '';
          } else if (tipo === 'inlineStr') {
            valor = textoDe(conteudo);
          } else {
            const v = /<v>([\s\S]*?)<\/v>/.exec(conteudo);
            valor = v ? desescapar(v[1]) : '';
          }

          while (linha.length < idx) linha.push('');
          linha[idx] = valor;
        }
        saida.push(linha);
      }
      return saida;
    },
  };
}
