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

/**
 * GET /cds/estoquegrade — consulta em lote: cod_prod/cod_loja aceitam lista
 * separada por vírgula (ex.: "10066,10101"). only_disp só documenta o valor 1.
 */
export interface EstoqueGradeQuery {
  /** Lista de prodCodigo separada por vírgula. */
  cod_prod?: string;
  /** Lista de idFilial separada por vírgula. */
  cod_loja?: string;
  /** 1 = somente produtos com saldo. */
  only_disp?: 1;
}

/** Linha da grade de estoque (formato tolerante — igual a SellbieEstoque). */
export interface SellbieEstoqueGrade extends SellbieEstoque {
  corCodigo?: number | string;
  tamanhoCodigo?: number | string;
}

/**
 * GET /cds/contasPagar — situacao abertos|pagos (vazio = ambas);
 * dataFiltro (aaaa-mm-dd) filtra por vencimento (abertos) ou pagamento
 * (pagos); sem dataFiltro retorna os últimos 30 dias.
 */
export interface ContasPagarQuery {
  situacao?: 'abertos' | 'pagos';
  /** aaaa-mm-dd */
  dataFiltro?: string;
}

/** Conta a pagar (payload exato ainda não documentado — modelo tolerante). */
export interface SellbieContaPagar {
  id?: number | string;
  fornecedor?: string;
  descricao?: string;
  valor?: number | string;
  situacao?: string;
  dataVencimento?: string;
  dataPagamento?: string;
}

// ─── POST /cds/inserirvenda ──────────────────────────────────────────────────
// Estrutura exatamente como na documentação oficial da CDS.

export interface CdsFormaPagamento {
  descricaoForma: string;
  valorForma: number;
  parcelasForma: number;
  dataVenctoForma: string | null;
  banco: string;
  agencia: string;
  numDoc: string;
  nsu: string;
  finalCartao: string;
  descBandeira: string;
  codCartao: string;
  autorizacao: string;
}

export interface CdsDadosProduto {
  codigoProduto: string;
  descricaoProduto: string;
  valorVendido: number;
  quantidadeVendida: number;
}

export interface CdsInserirVendaPayload {
  dadosCliente: {
    cpfCnpj: string;
    nomeCliente: string;
    razaoSocial: string;
    logradouro: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    UF: string;
    cep: string;
    celular: string;
    email: string;
    /** "1" = consumidor final. */
    consumoFinal: string;
  };
  /** Nome/identificação do vendedor responsável. */
  funcionario: string;
  /** Identificador do pedido no sistema externo (nosso Order.number). */
  pedidoSite: string;
  formasPagamento: CdsFormaPagamento[];
  dadosProdutos: CdsDadosProduto[];
  finalizarVenda: {
    descontoPerc: number;
    descontoValor: number;
    acrescimo: number;
    motivoDesconto: string | null;
  };
}

/** Resposta do inserirvenda (formato não documentado — devolvida crua). */
export type CdsInserirVendaResult = unknown;

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
  getEstoqueGrade(query?: EstoqueGradeQuery): Promise<SellbieEstoqueGrade[]>;
  getContasPagar(query?: ContasPagarQuery): Promise<SellbieContaPagar[]>;
  /**
   * Insere uma venda no ERP. ATENÇÃO: escrita sem idempotência documentada —
   * o chamador é responsável por não repetir o envio do mesmo pedido
   * (usamos pedidoSite como referência de deduplicação).
   */
  inserirVenda(payload: CdsInserirVendaPayload): Promise<CdsInserirVendaResult>;
}
