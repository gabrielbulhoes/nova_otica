/**
 * Formatos brutos REAIS da API CDS, confirmados por amostras capturadas em
 * produção pela sonda (cds:probe) em 13/07/2026 — 10 rotas GET + contasPagar.
 *
 * Convenções observadas no conector:
 * - envelope: sempre array puro na raiz;
 * - snake_case minúsculo em todas as rotas, EXCETO /cds/estoquegrade
 *   (MAIÚSCULAS) — inconsistência do próprio conector;
 * - números ora como number, ora como string ("5", "1092.00");
 * - datas em dois formatos: "aaaa-mm-dd" e "aaaa-mm-dd hh:mm:ss.mmm";
 * - "1900-01-01" é usado como data-nula (placeholder);
 * - strings com padding de espaços à direita ("VISA POS            ");
 * - typo real no conector: campo `categora` em /cds/produtos.
 *
 * Campos opcionais/toleranets de propósito: registros antigos podem vir
 * incompletos. A normalização (coerções, trims, placeholders) vive nos
 * mappers — aqui é só o espelho fiel do que chega.
 */

export interface SellbieDateRange {
  /** aaaa-mm-dd */
  date_start?: string;
  /** aaaa-mm-dd */
  date_end?: string;
}

/** GET /cds/lojas — 22 registros na rede. */
export interface SellbieLoja {
  codigo_loja: number | string;
  nome_fantasia?: string;
  cnpj?: string;
  cep?: string;
}

/** GET /cds/vendedores — codigo_vendedor é o NOME (chave textual, com padding). */
export interface SellbieVendedor {
  codigo_vendedor: string;
  nome?: string;
  cpf?: string;
  codigo_loja?: number | string;
  carga?: string; // função (ex.: VENDEDOR)
  data_admissao?: string; // "1900-01-01" = não informado
  data_demissao?: string;
  data_cadastro?: string;
  estado?: string; // "Ativado" | "Desativado"
}

/** GET /cds/cores e /cds/tamanhos — nesta instalação vêm praticamente vazios. */
export interface SellbieCor {
  codigo?: number | string;
  nome?: string;
}

export interface SellbieTamanho {
  codigo?: number | string;
  nome?: string;
}

/** GET /cds/produtos — sem filtros retorna só os últimos 30 dias. */
export interface SellbieProduto {
  codigo_base: number | string;
  sku?: string;
  nome?: string;
  classificacao?: string; // grupo (LENTES, ARMAÇÕES...) — com padding
  valor_compra?: number | string; // custo real
  valor_venda?: number | string;
  ncm?: string;
  data_cadastro?: string;
  data_atualizacao?: string;
  status?: string; // "Ativo" | ...
  foto1?: string;
  foto2?: string;
  foto3?: string;
  foto4?: string;
  foto5?: string;
  nome_fornecedor?: string;
  altura_lente?: string | number | null;
  comprimento_hast?: string | number | null;
  cor_armacao?: string | null;
  formato_armacao?: string | null;
  genero?: string | null;
  material_armacao?: string | null;
  material_hastes?: string | null;
  tamanho_lente?: string | number | null;
  tamanho_ponte?: string | number | null;
  tempo_garantia?: string | number | null;
  codigo_cor?: string | number | null;
  /** Typo REAL do conector (falta o "i") — mapeado como categoria. */
  categora?: string | null;
}

/** GET /cds/clientes — sem filtros retorna todos. */
export interface SellbieCliente {
  cpf?: string; // formatado: "000.754.433-25"
  nome?: string;
  sexo?: string;
  celular?: string;
  ddd_celular?: string;
  telefone?: string;
  ddd_telefone?: string;
  email?: string; // "naotem" é usado como placeholder de vazio
  data_nascimento?: string;
  data_inclusao?: string;
  tipo_cliente?: string; // "PF" | "PJ"
  data_ultima_compra?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  cep?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
}

/**
 * GET /cds/vendas — codigo_venda NÃO é único na rede: repete entre lojas.
 * A identidade estável é (codigo_loja, codigo_venda) — os mappers montam o
 * externalId composto "loja-venda".
 */
export interface SellbieVenda {
  codigo_venda: number | string;
  data?: string;
  codigo_loja?: number | string;
  codigo_vendedor?: string; // nome do vendedor, com padding
  valor_pago?: number | string;
  cpf_cliente?: string; // formatado, casa com clientes.cpf
  status?: string; // "Válido" | ...
}

/** GET /cds/detalhesVendas — valor_liquido é o TOTAL da linha (não unitário). */
export interface SellbieDetalheVenda {
  codigo_venda: number | string;
  data?: string;
  codigo_loja?: number | string;
  item?: number | string; // número do item dentro da venda
  codigo_produto?: string; // casa com produtos.codigo_base
  valor_liquido?: number | string;
  quantidade?: number | string;
  status_produto_vendido?: string;
  cmv?: number | string; // custo da mercadoria vendida (ainda não persistido)
  icms_venda?: number | string;
  icms_compra?: number | string;
}

/** GET /cds/pagamentosVendas */
export interface SellbiePagamentoVenda {
  codigo_venda: number | string;
  data_venda?: string;
  codigo_loja?: number | string;
  forma_pag?: string; // com padding ("VISA POS            ")
  valor_forma_pag?: number | string;
  num?: string;
  lote?: string;
  qtd_parcelas?: number | string;
  parcela_atual?: number | string;
  status_pag?: string; // "Aberto" | "Baixado" | ...
}

/**
 * GET /cds/estoque — ainda SEM amostra capturada (a sonda original derivava
 * o cod_loja de um campo que não existia). Formato tolerante até a próxima
 * sonda; o sync de estoque usa /cds/estoquegrade, que tem amostra real.
 */
export interface SellbieEstoque {
  [key: string]: unknown;
}

export interface EstoqueQuery {
  /** codigo_loja — obrigatório. */
  cod_loja: string | number;
  cod_prod?: string | number;
  /** 0 = todos, 1 = apenas com saldo. */
  only_disp?: 0 | 1;
}

/**
 * GET /cds/estoquegrade — MAIÚSCULAS (inconsistência real do conector) e
 * estoque ANINHADO por loja: a chave do objeto é o nome-fantasia da filial e
 * o valor traz ID_FILIAL + ESTOQUE. Uma única chamada cobre a rede inteira.
 */
export interface SellbieEstoqueGradeFilial {
  ID_FILIAL: string;
  ESTOQUE: string | number;
}

export interface SellbieEstoqueGrade {
  CODIGO: string | number; // casa com produtos.codigo_base
  GRADE?: string | number; // variante (cor/tamanho) do produto
  DESCRICAO?: string;
  COR?: string | number;
  TAMANHO?: string | number;
  GRUPO?: string;
  PRECO_VENDA?: string | number;
  PRECO_VENDA_B?: string | number;
  PRECO_VENDA_C?: string | number;
  ESTOQUE?: Record<string, SellbieEstoqueGradeFilial>;
}

export interface EstoqueGradeQuery {
  /** Lista de codigo_base separada por vírgula. */
  cod_prod?: string;
  /** Lista de codigo_loja separada por vírgula. */
  cod_loja?: string;
  /** 1 = somente produtos com saldo. */
  only_disp?: 1;
}

/**
 * GET /cds/contasPagar — a doc oficial diz que situacao é opcional, mas NA
 * PRÁTICA o conector responde 400 sem ela (verificado ao vivo). Por isso o
 * tipo a torna obrigatória.
 */
export interface ContasPagarQuery {
  situacao: 'abertos' | 'pagos';
  /** aaaa-mm-dd; sem ela, últimos 30 dias. */
  dataFiltro?: string;
}

/** Conta a pagar — amostra real capturada com situacao=abertos. */
export interface SellbieContaPagar {
  conta?: string | number;
  data_vencimento?: string;
  data_pagamento?: string;
  loja?: string | number;
  centro_custo?: string;
  grupo_conta?: string;
  valor_conta?: number | string;
  pagador_conta?: string;
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
  getContasPagar(query: ContasPagarQuery): Promise<SellbieContaPagar[]>;
  /**
   * Insere uma venda no ERP. ATENÇÃO: escrita sem idempotência documentada —
   * o chamador é responsável por não repetir o envio do mesmo pedido
   * (usamos pedidoSite como referência de deduplicação).
   */
  inserirVenda(payload: CdsInserirVendaPayload): Promise<CdsInserirVendaResult>;
}
