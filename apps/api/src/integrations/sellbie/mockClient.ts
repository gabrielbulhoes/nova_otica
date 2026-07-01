import type {
  EstoqueQuery,
  SellbieClient,
  SellbieCliente,
  SellbieCor,
  SellbieDateRange,
  SellbieDetalheVenda,
  SellbieEstoque,
  SellbieLoja,
  SellbiePagamentoVenda,
  SellbieProduto,
  SellbieTamanho,
  SellbieVenda,
  SellbieVendedor,
} from './types.js';

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

/** Data no formato aaaa-mm-dd, `n` dias atrás (para dados recentes na demo). */
const isoDaysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const CIDADES = [
  ['São Paulo', 'SP'],
  ['Campinas', 'SP'],
  ['Rio de Janeiro', 'RJ'],
  ['Belo Horizonte', 'MG'],
  ['Curitiba', 'PR'],
];
const MARCAS = ['Ray-Ban', 'Oakley', 'Chilli Beans', 'Hoya', 'Essilor', 'Bulget', 'Atitude'];
const CATEGORIAS = ['Armação', 'Lente', 'Óculos de Sol', 'Acessório', 'Estojo'];
const CORES = ['Preto', 'Marrom', 'Azul', 'Dourado', 'Prata', 'Tartaruga', 'Vermelho'];
const TAMANHOS = ['PP', 'P', 'M', 'G', 'GG', 'Único'];
const FORMAS_PAGTO = ['Dinheiro', 'Cartão de Crédito', 'Cartão de Débito', 'PIX', 'Crediário'];
const NOMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Hugo', 'Isabela', 'João'];
const SOBRENOMES = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Lima', 'Costa', 'Pereira', 'Almeida'];

const STORE_COUNT = 5;
const PRODUCT_COUNT = 60;
const CUSTOMER_COUNT = 40;
const SALE_COUNT = 120;

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
  estoque: SellbieEstoque[];
}

/** Constrói o dataset completo de demonstração uma única vez. */
function buildDataset(): MockDataset {
  const rand = rng(20240601);

  const lojas: SellbieLoja[] = Array.from({ length: STORE_COUNT }, (_, i) => {
    const [cidade, uf] = CIDADES[i % CIDADES.length];
    return {
      idFilial: i + 1,
      codigo: `F${String(i + 1).padStart(2, '0')}`,
      nome: `Nova Ótica — ${cidade}`,
      cidade,
      uf,
      telefone: `(11) 9${intBetween(rand, 1000, 9999)}-${intBetween(rand, 1000, 9999)}`,
      ativo: 1,
    };
  });

  const cores: SellbieCor[] = CORES.map((nome, i) => ({ codigo: i + 1, nome }));
  const tamanhos: SellbieTamanho[] = TAMANHOS.map((nome, i) => ({ codigo: i + 1, nome }));

  const vendedores: SellbieVendedor[] = Array.from({ length: STORE_COUNT * 3 }, (_, i) => ({
    funcionario: i + 1,
    nome: `${pick(rand, NOMES)} ${pick(rand, SOBRENOMES)}`,
    idFilial: (i % STORE_COUNT) + 1,
    ativo: 1,
    dataInclusao: '2024-01-15',
  }));

  const produtos: SellbieProduto[] = Array.from({ length: PRODUCT_COUNT }, (_, i) => {
    const categoria = pick(rand, CATEGORIAS);
    const marca = pick(rand, MARCAS);
    const preco = money(rand, 80, 1200);
    return {
      prodCodigo: 1000 + i,
      sku: `${marca.slice(0, 3).toUpperCase()}-${1000 + i}`,
      descricao: `${categoria} ${marca} ${pick(rand, CORES)}`,
      marca,
      categoria,
      corCodigo: intBetween(rand, 1, CORES.length),
      tamanhoCodigo: intBetween(rand, 1, TAMANHOS.length),
      precoVenda: preco,
      precoCusto: Math.round(preco * 0.55 * 100) / 100,
      ativo: 1,
      dataInclusao: '2024-03-01',
    };
  });

  const clientes: SellbieCliente[] = Array.from({ length: CUSTOMER_COUNT }, (_, i) => {
    const [cidade, uf] = pick(rand, CIDADES);
    return {
      id: i + 1,
      cpfCnpj: String(intBetween(rand, 10_000_000_000, 99_999_999_999)),
      nome: `${pick(rand, NOMES)} ${pick(rand, SOBRENOMES)}`,
      email: `cliente${i + 1}@exemplo.com`,
      telefone: `(11) 9${intBetween(rand, 1000, 9999)}-${intBetween(rand, 1000, 9999)}`,
      cidade,
      uf,
      dataInclusao: '2024-04-10',
    };
  });

  // Estoque: cada produto presente em cada loja com saldo variável.
  const estoque: SellbieEstoque[] = [];
  for (const loja of lojas) {
    for (const prod of produtos) {
      const qtd = rand() < 0.15 ? 0 : intBetween(rand, 1, 25);
      estoque.push({
        idFilial: loja.idFilial,
        prodCodigo: prod.prodCodigo,
        quantidade: qtd,
        disponivel: qtd,
      });
    }
  }

  // Vendas + detalhes + pagamentos no último mês.
  const vendas: SellbieVenda[] = [];
  const detalhes: SellbieDetalheVenda[] = [];
  const pagamentos: SellbiePagamentoVenda[] = [];
  for (let i = 0; i < SALE_COUNT; i += 1) {
    const idVenda = 5000 + i;
    const saleIso = isoDaysAgo(intBetween(rand, 0, 29));
    const itemCount = intBetween(rand, 1, 4);
    let total = 0;
    for (let j = 0; j < itemCount; j += 1) {
      const prod = pick(rand, produtos);
      const quantidade = intBetween(rand, 1, 2);
      const valorUnitario = Number(prod.precoVenda);
      const valorTotal = Math.round(valorUnitario * quantidade * 100) / 100;
      total += valorTotal;
      detalhes.push({
        id: `${idVenda}-${j}`,
        idVenda,
        prodCodigo: prod.prodCodigo,
        quantidade,
        valorUnitario,
        desconto: 0,
        valorTotal,
      });
    }
    total = Math.round(total * 100) / 100;
    vendas.push({
      id: idVenda,
      idVenda,
      idFilial: pick(rand, lojas).idFilial,
      funcionario: pick(rand, vendedores).funcionario,
      cpfCnpj: pick(rand, clientes).cpfCnpj,
      dataVenda: saleIso,
      valorTotal: total,
      desconto: 0,
      situacao: 'Finalizada',
    });
    pagamentos.push({
      id: idVenda,
      idVenda,
      formaPagamento: pick(rand, FORMAS_PAGTO),
      valor: total,
      parcelas: intBetween(rand, 1, 12),
      dataPagamento: saleIso,
    });
  }

  return { lojas, vendedores, cores, tamanhos, produtos, clientes, vendas, detalhes, pagamentos, estoque };
}

const data = buildDataset();

/** Cliente Sellbie em modo mock — não acessa rede e ignora a janela de uso. */
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

  async getVendas(_params?: SellbieDateRange): Promise<SellbieVenda[]> {
    return data.vendas;
  }

  async getDetalhesVendas(_params?: SellbieDateRange): Promise<SellbieDetalheVenda[]> {
    return data.detalhes;
  }

  async getPagamentosVendas(_params?: SellbieDateRange): Promise<SellbiePagamentoVenda[]> {
    return data.pagamentos;
  }

  async getEstoque(query: EstoqueQuery): Promise<SellbieEstoque[]> {
    const loja = String(query.cod_loja);
    let rows = data.estoque.filter((e) => String(e.idFilial) === loja);
    if (query.cod_prod !== undefined && query.cod_prod !== '') {
      rows = rows.filter((e) => String(e.prodCodigo) === String(query.cod_prod));
    }
    if (query.only_disp === 1) {
      rows = rows.filter((e) => Number(e.quantidade ?? 0) > 0);
    }
    return rows;
  }
}
