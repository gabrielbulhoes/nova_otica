import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { abrirPlanilha, type Planilha } from '../src/lib/xlsx.js';
import {
  chaveDeCatalogo,
  cruzar,
  decomporDescricao,
  lerCadastroFornecedor,
  lerTetoDeDesconto,
  reconhecerPlanilha,
} from '../src/catalogo/atributos.js';

/**
 * OS ATRIBUTOS DE CATÁLOGO — a chave, o leitor e o relatório.
 *
 * As planilhas de verdade não podem entrar no repositório: são cadastro
 * comercial de fornecedor, e este repositório é público. Então o que este
 * arquivo prende são as três coisas que quebram sem barulho:
 *
 *   · a DECOMPOSIÇÃO da descrição, que é a chave inteira do casamento;
 *   · o LEITOR de xlsx escrito à mão, provado contra um arquivo montado aqui;
 *   · o RELATÓRIO, que é a única defesa contra o import mudo.
 *
 * Os números medidos contra o catálogo real, para referência de quem for mexer:
 * 1.631 produtos, 1.313 fora do formato de moda (lente e serviço), 217 casados
 * com o cadastro Luxottica e 36 de marca coberta que não casaram — 85,8%.
 */

// ─── Um .xlsx de verdade, montado aqui ───────────────────────────────────────

/**
 * Escreve um ZIP mínimo com as entradas dadas. É o suficiente para provar o
 * leitor sem depender de arquivo binário no repositório — e sem depender de
 * biblioteca, que é justamente o que o leitor veio evitar.
 */
function montarZip(entradas: { nome: string; conteudo: string }[]): Buffer {
  const locais: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entradas) {
    const nome = Buffer.from(e.nome, 'utf8');
    const cru = Buffer.from(e.conteudo, 'utf8');
    const comp = deflateRawSync(cru);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 14); // crc — o leitor não confere, e o Excel também não exige aqui
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(cru.length, 22);
    local.writeUInt16LE(nome.length, 26);
    locais.push(local, nome, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(cru.length, 24);
    cd.writeUInt16LE(nome.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nome);

    offset += 30 + nome.length + comp.length;
  }

  const corpoCentral = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(corpoCentral.length, 12);
  fim.writeUInt32LE(offset, 16);

  return Buffer.concat([Buffer.concat(locais), corpoCentral, fim]);
}

const celula = (ref: string, valor: string, tipo?: string) =>
  `<c r="${ref}"${tipo ? ` t="${tipo}"` : ''}><v>${valor}</v></c>`;

function planilhaDeTeste(): Buffer {
  const compartilhado = ['Barra CDS', 'Referência', 'Marca', 'Gênero', 'Best Seller', 'RB3548NL00154', 'RB3548NL', 'RAY BAN', 'Unisex', 'Sim'];
  return montarZip([
    { nome: 'xl/workbook.xml', conteudo: '<workbook><sheets><sheet name="produtos" sheetId="1"/></sheets></workbook>' },
    {
      nome: 'xl/sharedStrings.xml',
      conteudo: `<sst>${compartilhado.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`,
    },
    {
      nome: 'xl/worksheets/sheet1.xml',
      conteudo:
        '<worksheet><sheetData>' +
        `<row r="1">${['A1', 'B1', 'C1', 'D1', 'E1'].map((r, i) => celula(r, String(i), 's')).join('')}</row>` +
        `<row r="2">${celula('A2', '5', 's')}${celula('B2', '6', 's')}${celula('C2', '7', 's')}${celula('D2', '8', 's')}${celula('E2', '9', 's')}</row>` +
        // Linha com buraco: a coluna B some. O leitor precisa manter o
        // alinhamento pela referência da célula, não pela ordem de chegada —
        // senão "Marca" cai na coluna da referência e tudo desloca.
        `<row r="3">${celula('A3', 'ZZ99900142')}${celula('C3', '7', 's')}</row>` +
        '</sheetData></worksheet>',
    },
  ]);
}

describe('leitor de xlsx escrito à mão', () => {
  it('abre o arquivo, nomeia a aba e resolve o texto compartilhado', () => {
    const p = abrirPlanilha(planilhaDeTeste());
    expect(p.abas).toEqual(['produtos']);
    const linhas = p.linhas(0);
    expect(linhas[0]).toEqual(['Barra CDS', 'Referência', 'Marca', 'Gênero', 'Best Seller']);
    expect(linhas[1]).toEqual(['RB3548NL00154', 'RB3548NL', 'RAY BAN', 'Unisex', 'Sim']);
  });

  it('célula ausente vira vazio na POSIÇÃO certa, e não desloca a linha', () => {
    const linhas = abrirPlanilha(planilhaDeTeste()).linhas(0);
    expect(linhas[2]).toEqual(['ZZ99900142', '', 'RAY BAN']);
  });

  it('recusa arquivo que não é planilha, em vez de devolver vazio', () => {
    expect(() => abrirPlanilha(Buffer.from('não sou um zip'))).toThrow(/ZIP/);
    const semWorkbook = montarZip([{ nome: 'qualquer.txt', conteudo: 'oi' }]);
    expect(() => abrirPlanilha(semWorkbook)).toThrow(/workbook/);
  });
});

// ─── A chave ─────────────────────────────────────────────────────────────────

describe('decomposição da descrição do CDS', () => {
  it('separa referência, cor, tamanho, grupo e marca', () => {
    expect(decomporDescricao('RB3548NL 001 54 OCULOS RAY BAN')).toEqual({
      referencia: 'RB3548NL',
      codigoCor: '001',
      tamanho: '54',
      grupo: 'OCULOS',
      marca: 'RAY BAN',
    });
    expect(decomporDescricao('MU05VV 11Q1O1 55 ARMACAO MIU MIU')?.marca).toBe('MIU MIU');
  });

  it('devolve null para o que não é peça de moda — e isso não é falha', () => {
    // 1.313 dos 1.631 produtos do catálogo real caem aqui. Tratar isso como
    // erro afogaria o relatório e esconderia o que importa.
    expect(decomporDescricao('HILUX LENTES PRONTAS ESFERICAS 1.53 AQUA')).toBeNull();
    expect(decomporDescricao('SERVICO DE MONTAGEM')).toBeNull();
    expect(decomporDescricao('')).toBeNull();
  });

  it('a chave reconstrói a Barra CDS do fornecedor', () => {
    // Medido: `Referência + Cor + Tamanho` reproduz a Barra CDS em 95% das
    // 16.535 linhas do cadastro Luxottica. GTIN e Barra CDS contra externalId
    // dão ZERO — foram testados e descartados.
    const partes = decomporDescricao('RB3548NL 001 54 OCULOS RAY BAN')!;
    expect(chaveDeCatalogo(partes)).toBe('RB3548NL00154');
  });

  it('a chave ignora pontuação e caixa dos dois lados', () => {
    expect(chaveDeCatalogo({ referencia: 'rb-3548nl', codigoCor: '001', tamanho: 54 })).toBe('RB3548NL00154');
  });
});

// ─── Leitura das duas planilhas ──────────────────────────────────────────────

/** Uma planilha falsa: a interface existe para o teste não precisar de arquivo. */
const fake = (abas: string[], linhas: string[][]): Planilha => ({ abas, linhas: () => linhas });

describe('leitura do cadastro de fornecedor', () => {
  const cab = ['Barra CDS', 'Referência', 'Marca', 'Gênero', 'Formato da Armação', 'Best Seller', 'Tamanho da Lente'];

  it('lê por NOME de coluna, não por posição', () => {
    // Os dois cadastros que chegaram têm colunas diferentes e em ordens
    // diferentes: o da Marchon não tem "Referência" nem "Best Seller".
    const { linhas } = lerCadastroFornecedor(
      fake(['x'], [
        ['Gênero', 'Marca', 'Barra CDS'],
        ['Feminino', 'LACOSTE', 'L683S424'],
      ]),
    );
    const a = linhas.get('L683S424')!;
    expect(a.genero).toBe('Feminino');
    expect(a.marcaCatalogo).toBe('LACOSTE');
    expect(a.referencia).toBeNull();
    expect(a.bestSeller).toBe(false);
  });

  it('conta as barras repetidas em vez de colapsá-las em silêncio', () => {
    // 252 das 4.859 linhas do cadastro Marchon repetem a barra. A última vence,
    // mas o número aparece no relatório — descobrir isso pelo total que não
    // fecha com o do fornecedor sai caro.
    const { linhas, repetidas } = lerCadastroFornecedor(
      fake(['x'], [cab, ['L683S424', 'L683S', 'LACOSTE', 'Unisex', 'Quadrado', '', '55'],
        ['L683S424', 'L683S', 'LACOSTE', 'Unisex', 'Redondo', 'Sim', '55']]),
    );
    expect(repetidas).toBe(1);
    expect(linhas.size).toBe(1);
    expect(linhas.get('L683S424')!.formato).toBe('Redondo');
  });

  it('recusa planilha sem a coluna da chave', () => {
    expect(() => lerCadastroFornecedor(fake(['x'], [['Marca', 'Gênero'], ['RAY BAN', 'Unisex']]))).toThrow(/Barra CDS/);
  });

  it('reconhece os dois formatos pelo cabeçalho', () => {
    expect(reconhecerPlanilha(fake(['x'], [cab]))).toBe('cadastro');
    expect(reconhecerPlanilha(fake(['x'], [['Rótulos de Linha', 'Máx. de Desconto (%)']]))).toBe('desconto');
    expect(reconhecerPlanilha(fake(['x'], [['qualquer', 'outra']]))).toBeNull();
  });
});

describe('leitura do teto de desconto do CDS', () => {
  it('aceita só código numérico, e conta o que descartou', () => {
    // A planilha vem de tabela dinâmica: a última linha do arquivo real é
    // ("ROBERTO", 50). Aceitá-la gravaria teto em produto nenhum e o import
    // pareceria ter ido bem.
    const { tetos, ignoradas } = lerTetoDeDesconto(
      fake(['x'], [
        ['Rótulos de Linha', 'Máx. de Desconto (%)'],
        ['10089', '60'],
        ['48660', '30.5'],
        ['ROBERTO', '50'],
        ['12345', '0'],
        ['12346', '140'],
      ]),
    );
    expect([...tetos]).toEqual([
      ['10089', 60],
      ['48660', 30.5],
    ]);
    expect(ignoradas).toBe(3);
  });
});

// ─── O relatório ─────────────────────────────────────────────────────────────

describe('relatório de casamento', () => {
  const cadastro = new Map([
    ['RB3548NL00154', { barraCds: 'RB3548NL00154', marcaCatalogo: 'RAY BAN' } as never],
  ]);
  const marcas = new Set(['RAY BAN', 'VOGUE']);
  const produtos = [
    { productId: 'p1', description: 'RB3548NL 001 54 OCULOS RAY BAN' },
    { productId: 'p2', description: 'VO4286S 28013 56 OCULOS VOGUE' }, // marca coberta, chave ausente
    { productId: 'p3', description: 'FT5678 002 52 ARMACAO TOM FORD' }, // outro fornecedor
    { productId: 'p4', description: 'HILUX LENTES PRONTAS ESFERICAS' }, // nem é moda
  ];

  it('separa "marca de outro fornecedor" de "marca daqui que não casou"', () => {
    // Sem esta separação o relatório mente por omissão: importar o cadastro da
    // Marchon contra um catálogo de Ray-Ban mostrava "0% de casamento" e uma
    // lista de faltantes que dava a entender defeito onde não havia.
    const { encontrados, relatorio } = cruzar(produtos, cadastro, marcas);
    expect([...encontrados.keys()]).toEqual(['p1']);
    expect(relatorio.semFormato).toBe(1);
    expect(relatorio.casados).toBe(1);
    expect(relatorio.marcaForaDoCadastro).toBe(1); // TOM FORD
    expect(relatorio.marcaNoCadastroSemCasar).toBe(1); // VOGUE — este é o que acusa
  });

  it('a marca com sufixo de linha conta como coberta', () => {
    // A descrição diz "RAY BAN JR" onde o cadastro diz "RAY BAN JUNIOR".
    // Tratar como marca desconhecida inflaria o número que serve para pedir
    // cadastro a um fornecedor que já mandou o dele.
    const { relatorio } = cruzar(
      [{ productId: 'p', description: 'RY1603L 3857 49 ARMACAO RAY BAN JR' }],
      new Map(),
      new Set(['RAY BAN JUNIOR']),
    );
    expect(relatorio.marcaForaDoCadastro).toBe(0);
    expect(relatorio.marcaNoCadastroSemCasar).toBe(1);
  });

  it('ordena as faltantes pelo que mais dói, e marca quais são daqui', () => {
    const { relatorio } = cruzar(
      [...produtos, { productId: 'p5', description: 'FT9999 003 50 ARMACAO TOM FORD' }],
      cadastro,
      marcas,
    );
    expect(relatorio.marcasFaltantes[0]).toEqual({ marca: 'TOM FORD', produtos: 2, noCadastro: false });
    expect(relatorio.marcasFaltantes.find((m) => m.marca === 'VOGUE')?.noCadastro).toBe(true);
  });
});
