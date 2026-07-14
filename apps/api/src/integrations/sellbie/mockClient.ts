import type {
  CdsInserirVendaPayload,
  CdsInserirVendaResult,
  ContasPagarQuery,
  EstoqueGradeQuery,
  EstoqueQuery,
  SellbieClient,
  SellbieCliente,
  SellbieContaPagar,
  SellbieCor,
  SellbieDateRange,
  SellbieDetalheVenda,
  SellbieEstoque,
  SellbieEstoqueGrade,
  SellbieLoja,
  SellbiePagamentoVenda,
  SellbieProduto,
  SellbieTamanho,
  SellbieVenda,
  SellbieVendedor,
} from './types.js';

/**
 * Cliente mock com o MESMO contrato observado no conector CDS real
 * (amostras de 13/07/2026), incluindo as idiossincrasias que os mappers
 * precisam tratar: padding à direita, "1900-01-01" como data-nula, "naotem"
 * como e-mail, codigo_venda repetido entre lojas, estoquegrade em MAIÚSCULAS
 * com estoque aninhado por filial e `categora` (typo real) em produtos.
 */

/** PRNG determinístico (mulberry32) — dados estáveis entre execuções. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rand: () => number, arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const intBetween = (rand: () => number, min: number, max: number) =>
  Math.floor(rand() * (max - min + 1)) + min;
const money = (rand: () => number, min: number, max: number) =>
  Math.round((rand() * (max - min) + min) * 100) / 100;

/** aaaa-mm-dd, n dias atrás. */
const isoDaysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/** Padding à direita, como o conector envia os textos. */
const pad = (s: string, width = 20): string => s.padEnd(width, ' ');

const CIDADES = [
  ['São Paulo', 'SP'],
  ['Campinas', 'SP'],
  ['Rio de Janeiro', 'RJ'],
  ['Belo Horizonte', 'MG'],
  ['Curitiba', 'PR'],
];
const FORNECEDORES = ['Ray-Ban', 'Oakley', 'Chilli Beans', 'Hoya', 'Essilor', 'Bulget', 'Atitude'];
const GRUPOS = ['ARMACOES', 'LENTES', 'OCULOS DE SOL', 'ACESSORIOS', 'ESTOJOS'];
const FORMAS_PAGTO = ['DINHEIRO', 'VISA POS', 'MASTER DEBITO', 'PIX', 'CREDIARIO'];
const NOMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Hugo', 'Isabela', 'João'];
const SOBRENOMES = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Lima', 'Costa', 'Pereira', 'Almeida'];

const STORE_COUNT = 5;
const PRODUCT_COUNT = 60;
const CUSTOMER_COUNT = 40;
const SALES_PER_STORE = 24;

interface MockDataset {
  lojas: SellbieLoja[];
  vendedores: SellbieVendedor[];
  cores: SellbieCor[];
  tamanhos: SellbieTamanho[];
  produtos: SellbieProduto[];
  clientes: SellbieCliente[];
  vendas: SellbieVenda[];
  detalhes: SellbieDetalheVenda[];
  pagamentos: SellbiePagamentoVenda[];
  grade: SellbieEstoqueGrade[];
  contasPagar: SellbieContaPagar[];
}

function cpfFake(rand: () => number): string {
  const n = () => intBetween(rand, 0, 9);
  return `${n()}${n()}${n()}.${n()}${n()}${n()}.${n()}${n()}${n()}-${n()}${n()}`;
}

/** Constrói o dataset completo de demonstração uma única vez. */
function buildDataset(): MockDataset {
  const rand = rng(20240601);

  const lojas: SellbieLoja[] = Array.from({ length: STORE_COUNT }, (_, i) => {
    const [cidade] = CIDADES[i % CIDADES.length];
    return {
      codigo_loja: i + 1,
      nome_fantasia: `NOVA OTICA ${cidade.toUpperCase()}`,
      cnpj: `31.777.50${i}/0001-3${i}`,
      cep: `5902020${i}`,
    };
  });

  // Nesta instalação do CDS as dimensões cores/tamanhos vêm vazias — o mock
  // reproduz o registro-lixo único observado (codigo "0", nome "").
  const cores: SellbieCor[] = [{ codigo: '0', nome: '' }];
  const tamanhos: SellbieTamanho[] = [{ codigo: '0', nome: '' }];

  const vendedores: SellbieVendedor[] = Array.from({ length: STORE_COUNT * 3 }, (_, i) => {
    const nome = `${pick(rand, NOMES)} ${pick(rand, SOBRENOMES)}`.toUpperCase();
    const desativado = rand() < 0.15;
    return {
      codigo_vendedor: nome, // a chave real é o próprio nome
      nome,
      cpf: rand() < 0.5 ? cpfFake(rand) : '',
      codigo_loja: (i % STORE_COUNT) + 1,
      carga: 'VENDEDOR',
      data_admissao: '1900-01-01', // placeholder real de "não informado"
      data_demissao: '1900-01-01',
      data_cadastro: '2025-03-28',
      estado: desativado ? 'Desativado' : 'Ativado',
    };
  });

  const produtos: SellbieProduto[] = Array.from({ length: PRODUCT_COUNT }, (_, i) => {
    const grupo = pick(rand, GRUPOS);
    const fornecedor = pick(rand, FORNECEDORES);
    const venda = money(rand, 80, 1200);
    return {
      codigo_base: String(1000 + i),
      sku: String(1000 + i),
      nome: `${grupo} ${fornecedor} MODELO ${1000 + i}`.toUpperCase(),
      classificacao: pad(grupo, 40), // padding como no conector
      valor_compra: Math.round(venda * 0.55 * 100) / 100,
      valor_venda: venda,
      ncm: '90031100',
      data_cadastro: `${isoDaysAgo(intBetween(rand, 30, 700))} 00:00:00.000`,
      data_atualizacao: `${isoDaysAgo(intBetween(rand, 0, 30))} 00:00:00.000`,
      status: 'Ativo',
      foto1: '',
      foto2: '',
      foto3: '',
      foto4: '',
      foto5: '',
      nome_fornecedor: pad(fornecedor.toUpperCase(), 50),
      altura_lente: null,
      comprimento_hast: null,
      cor_armacao: null,
      formato_armacao: null,
      genero: null,
      material_armacao: null,
      material_hastes: null,
      tamanho_lente: null,
      tamanho_ponte: null,
      tempo_garantia: null,
      codigo_cor: null,
      categora: null, // typo real do conector
    };
  });

  const clientes: SellbieCliente[] = Array.from({ length: CUSTOMER_COUNT }, (_, i) => {
    const [cidade, uf] = pick(rand, CIDADES);
    return {
      cpf: cpfFake(rand),
      nome: `${pick(rand, NOMES)} ${pick(rand, SOBRENOMES)}`.toUpperCase(),
      sexo: '',
      celular: `9${intBetween(rand, 10000000, 99999999)}`,
      ddd_celular: '88',
      telefone: '',
      ddd_telefone: '',
      email: rand() < 0.3 ? 'naotem' : `cliente${i + 1}@exemplo.com`,
      data_nascimento: '1984-05-04 00:00:00.000',
      data_inclusao: isoDaysAgo(intBetween(rand, 0, 600)),
      tipo_cliente: rand() < 0.1 ? 'PJ' : 'PF',
      data_ultima_compra: `${isoDaysAgo(intBetween(rand, 0, 60))} 00:00:00.000`,
      logradouro: 'RUA DAS FLORES',
      numero: String(intBetween(rand, 1, 2000)),
      complemento: '',
      cep: '63031-015',
      bairro: 'CENTRO',
      cidade: cidade.toUpperCase(),
      estado: uf,
    };
  });

  // Grade de estoque: uma linha por produto×variante, com o estoque aninhado
  // por filial (chave = nome-fantasia), exatamente como o conector real.
  const grade: SellbieEstoqueGrade[] = [];
  for (const prod of produtos) {
    const variantes = rand() < 0.2 ? 2 : 1;
    for (let g = 1; g <= variantes; g += 1) {
      const estoque: Record<string, { ID_FILIAL: string; ESTOQUE: string }> = {};
      for (const loja of lojas) {
        if (rand() < 0.1) continue; // nem toda filial tem toda posição
        estoque[String(loja.nome_fantasia)] = {
          ID_FILIAL: String(loja.codigo_loja),
          ESTOQUE: String(rand() < 0.15 ? 0 : intBetween(rand, 1, 25)),
        };
      }
      grade.push({
        CODIGO: String(prod.codigo_base),
        GRADE: String(g),
        DESCRICAO: String(prod.nome),
        COR: '0',
        TAMANHO: '0',
        GRUPO: String(prod.classificacao).trim(),
        PRECO_VENDA: String(prod.valor_venda),
        PRECO_VENDA_B: '0',
        PRECO_VENDA_C: '0',
        ESTOQUE: estoque,
      });
    }
  }

  // Vendas: codigo_venda REPETE entre lojas (como no conector real) — a
  // identidade global é (codigo_loja, codigo_venda).
  const vendas: SellbieVenda[] = [];
  const detalhes: SellbieDetalheVenda[] = [];
  const pagamentos: SellbiePagamentoVenda[] = [];
  for (const loja of lojas) {
    for (let v = 0; v < SALES_PER_STORE; v += 1) {
      const codigoVenda = 1000 + v; // mesmo número em todas as lojas
      const dia = isoDaysAgo(intBetween(rand, 0, 29));
      const vendedor = pick(
        rand,
        vendedores.filter((s) => s.codigo_loja === loja.codigo_loja),
      );
      const cliente = pick(rand, clientes);
      const itemCount = intBetween(rand, 1, 3);
      let total = 0;
      for (let i = 1; i <= itemCount; i += 1) {
        const prod = pick(rand, produtos);
        const quantidade = intBetween(rand, 1, 2);
        const liquido = Math.round(Number(prod.valor_venda) * quantidade * 100) / 100;
        total += liquido;
        detalhes.push({
          codigo_venda: codigoVenda,
          data: dia,
          codigo_loja: loja.codigo_loja,
          item: i,
          codigo_produto: String(prod.codigo_base),
          valor_liquido: liquido.toFixed(2), // string, como no conector
          quantidade,
          status_produto_vendido: 'Válido',
          cmv: Math.round(Number(prod.valor_compra) * quantidade * 100) / 100,
          icms_venda: 0,
          icms_compra: 0,
        });
      }
      total = Math.round(total * 100) / 100;
      vendas.push({
        codigo_venda: codigoVenda,
        data: dia,
        codigo_loja: loja.codigo_loja,
        codigo_vendedor: pad(String(vendedor.codigo_vendedor)),
        valor_pago: total,
        cpf_cliente: String(cliente.cpf),
        status: 'Válido',
      });
      const parcelas = intBetween(rand, 1, 6);
      for (let p = 1; p <= Math.min(parcelas, 2); p += 1) {
        pagamentos.push({
          codigo_venda: codigoVenda,
          data_venda: dia,
          codigo_loja: loja.codigo_loja,
          forma_pag: pad(pick(rand, FORMAS_PAGTO)),
          valor_forma_pag: Math.round((total / Math.min(parcelas, 2)) * 100) / 100,
          num: pad(String(intBetween(rand, 100, 999)), 20),
          lote: pad('', 10),
          qtd_parcelas: parcelas,
          parcela_atual: p,
          status_pag: p === 1 ? 'Baixado' : 'Aberto',
        });
      }
    }
  }

  // Contas a pagar dos últimos 30 dias (metade abertas, metade pagas).
  const contasPagar: SellbieContaPagar[] = Array.from({ length: 12 }, (_, i) => {
    const paga = i % 2 === 1;
    const dia = isoDaysAgo(intBetween(rand, 0, 29));
    return {
      conta: 900 + i,
      data_vencimento: dia,
      data_pagamento: paga ? dia : undefined,
      loja: (i % STORE_COUNT) + 1,
      centro_custo: 'COMPRAS',
      grupo_conta: 'FORNECEDORES',
      valor_conta: money(rand, 300, 8000),
      pagador_conta: pick(rand, FORNECEDORES).toUpperCase(),
    };
  });

  return { lojas, vendedores, cores, tamanhos, produtos, clientes, vendas, detalhes, pagamentos, grade, contasPagar };
}

const data = buildDataset();

/** Cliente CDS em modo mock — não acessa rede e ignora a janela de uso. */
export class SellbieMockClient implements SellbieClient {
  async getLojas(): Promise<SellbieLoja[]> {
    return data.lojas;
  }

  async getVendedores(): Promise<SellbieVendedor[]> {
    return data.vendedores;
  }

  async getCores(): Promise<SellbieCor[]> {
    return data.cores;
  }

  async getTamanhos(): Promise<SellbieTamanho[]> {
    return data.tamanhos;
  }

  async getProdutos(_params?: SellbieDateRange): Promise<SellbieProduto[]> {
    return data.produtos;
  }

  async getClientes(): Promise<SellbieCliente[]> {
    return data.clientes;
  }

  async getVendas(params?: SellbieDateRange): Promise<SellbieVenda[]> {
    return filterByDate(data.vendas, (v) => v.data, params);
  }

  async getDetalhesVendas(params?: SellbieDateRange): Promise<SellbieDetalheVenda[]> {
    return filterByDate(data.detalhes, (d) => d.data, params);
  }

  async getPagamentosVendas(params?: SellbieDateRange): Promise<SellbiePagamentoVenda[]> {
    return filterByDate(data.pagamentos, (p) => p.data_venda, params);
  }

  async getEstoque(query: EstoqueQuery): Promise<SellbieEstoque[]> {
    // A forma exata da rota /cds/estoque ainda não foi capturada; o mock
    // devolve uma projeção simples derivada da grade, suficiente p/ consultas.
    const loja = String(query.cod_loja);
    const rows: SellbieEstoque[] = [];
    for (const g of data.grade) {
      const filial = Object.values(g.ESTOQUE ?? {}).find((f) => String(f.ID_FILIAL) === loja);
      if (!filial) continue;
      if (query.cod_prod !== undefined && query.cod_prod !== '' && String(g.CODIGO) !== String(query.cod_prod)) continue;
      const qtd = Number(filial.ESTOQUE);
      if (query.only_disp === 1 && qtd <= 0) continue;
      rows.push({ codigo_loja: loja, codigo_produto: String(g.CODIGO), estoque: qtd });
    }
    return rows;
  }

  async getEstoqueGrade(query?: EstoqueGradeQuery): Promise<SellbieEstoqueGrade[]> {
    // Listas CSV, como a CDS documenta ("10066,10101" / "1,3,5").
    const csv = (v?: string) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const prods = csv(query?.cod_prod);
    const lojas = csv(query?.cod_loja);
    let rows = data.grade;
    if (prods.length > 0) rows = rows.filter((g) => prods.includes(String(g.CODIGO)));
    if (lojas.length > 0 || query?.only_disp === 1) {
      rows = rows
        .map((g) => {
          const estoque = Object.fromEntries(
            Object.entries(g.ESTOQUE ?? {}).filter(([, f]) => {
              if (lojas.length > 0 && !lojas.includes(String(f.ID_FILIAL))) return false;
              if (query?.only_disp === 1 && Number(f.ESTOQUE) <= 0) return false;
              return true;
            }),
          );
          return { ...g, ESTOQUE: estoque };
        })
        .filter((g) => Object.keys(g.ESTOQUE).length > 0);
    }
    return rows;
  }

  async getContasPagar(query: ContasPagarQuery): Promise<SellbieContaPagar[]> {
    // Paridade com o conector real: sem `situacao` a CDS responde 400
    // (mesmo com a doc dizendo que é opcional).
    if (!query?.situacao) {
      throw new Error('CDS: Verifique o envio dos parâmetros da requisição (situacao é obrigatória).');
    }
    let rows =
      query.situacao === 'pagos'
        ? data.contasPagar.filter((c) => c.data_pagamento)
        : data.contasPagar.filter((c) => !c.data_pagamento);
    if (query.dataFiltro) {
      rows = rows.filter((c) =>
        query.situacao === 'pagos' ? c.data_pagamento === query.dataFiltro : c.data_vencimento === query.dataFiltro,
      );
    }
    return rows;
  }

  /** Vendas inseridas via mock (inspeção em testes/demonstrações). */
  readonly vendasInseridas: CdsInserirVendaPayload[] = [];

  async inserirVenda(payload: CdsInserirVendaPayload): Promise<CdsInserirVendaResult> {
    this.vendasInseridas.push(payload);
    return { ok: true, pedidoSite: payload.pedidoSite };
  }
}

/** Filtro aaaa-mm-dd inclusivo, como o conector aplica date_start/date_end. */
function filterByDate<T>(rows: T[], get: (r: T) => string | undefined, params?: SellbieDateRange): T[] {
  if (!params?.date_start && !params?.date_end) return rows;
  return rows.filter((r) => {
    const d = get(r)?.slice(0, 10);
    if (!d) return false;
    if (params.date_start && d < params.date_start) return false;
    if (params.date_end && d > params.date_end) return false;
    return true;
  });
}
