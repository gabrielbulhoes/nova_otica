/**
 * Formatos brutos retornados pela API Sellbie/CDS.
 *
 * As rotas e filtros estão documentados em apiCDS. Como os payloads exatos
 * ainda não foram fornecidos, os campos são modelados de forma tolerante
 * (a maioria opcional) e normalizados pelos mappers. Ao receber exemplos
 * reais de resposta, ajuste apenas estes tipos e os mappers.
 */

export interface SellbieDateRange {
  /** aaaa-mm-dd */
  date_start?: string;
  /** aaaa-mm-dd */
  date_end?: string;
}

export interface SellbieLoja {
  idFilial: number | string;
  codigo?: string;
  nome?: string;
  razaoSocial?: string;
  cidade?: string;
  uf?: string;
  telefone?: string;
  ativo?: boolean | number;
}

export interface SellbieVendedor {
  funcionario: number | string;
  nome?: string;
  idFilial?: number | string;
  ativo?: boolean | number;
  dataInclusao?: string;
}

export interface SellbieCor {
  id?: number | string;
  codigo?: number | string;
  nome?: string;
  descricao?: string;
  hex?: string;
}

export interface SellbieTamanho {
  id?: number | string;
  codigo?: number | string;
  nome?: string;
  descricao?: string;
}

export interface SellbieProduto {
  prodCodigo: number | string;
  sku?: string;
  descricao?: string;
  marca?: string;
  categoria?: string;
  tipo?: string;
  corCodigo?: number | string;
  tamanhoCodigo?: number | string;
  precoVenda?: number | string;
  precoCusto?: number | string;
  ativo?: boolean | number;
  dataInclusao?: string;
}

export interface SellbieCliente {
  id?: number | string;
  cpfCnpj?: string;
  nome?: string;
  email?: string;
  telefone?: string;
  cidade?: string;
  uf?: string;
  dataInclusao?: string;
}

export interface SellbieVenda {
  id?: number | string;
  idVenda?: number | string;
  idFilial?: number | string;
  funcionario?: number | string;
  cpfCnpj?: string;
  dataVenda?: string;
  valorTotal?: number | string;
  desconto?: number | string;
  situacao?: string;
}

export interface SellbieDetalheVenda {
  id?: number | string;
  idVenda?: number | string;
  prodCodigo?: number | string;
  quantidade?: number | string;
  valorUnitario?: number | string;
  desconto?: number | string;
  valorTotal?: number | string;
}

export interface SellbiePagamentoVenda {
  id?: number | string;
  idVenda?: number | string;
  formaPagamento?: string;
  valor?: number | string;
  parcelas?: number | string;
  dataPagamento?: string;
}

export interface SellbieEstoque {
  idFilial: number | string;
  prodCodigo: number | string;
  quantidade?: number | string;
  disponivel?: number | string;
}

export interface EstoqueQuery {
  /** idFilial — obrigatório. */
  cod_loja: string | number;
  cod_prod?: string | number;
  /** 0 = todos, 1 = apenas com saldo. */
  only_disp?: 0 | 1;
}

export interface SellbieClient {
  getLojas(): Promise<SellbieLoja[]>;
  getVendedores(params?: SellbieDateRange & { seller?: string }): Promise<SellbieVendedor[]>;
  getCores(): Promise<SellbieCor[]>;
  getTamanhos(): Promise<SellbieTamanho[]>;
  getProdutos(params?: SellbieDateRange): Promise<SellbieProduto[]>;
  getClientes(params?: SellbieDateRange & { cod_client?: string }): Promise<SellbieCliente[]>;
  getVendas(params?: SellbieDateRange): Promise<SellbieVenda[]>;
  getDetalhesVendas(params?: SellbieDateRange): Promise<SellbieDetalheVenda[]>;
  getPagamentosVendas(params?: SellbieDateRange): Promise<SellbiePagamentoVenda[]>;
  getEstoque(query: EstoqueQuery): Promise<SellbieEstoque[]>;
}
