import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { assertWindow } from './window.js';
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

const log = logger.child({ mod: 'sellbie:http' });

/** Extrai o array de dados independentemente do envelope da resposta. */
function unwrap<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['data', 'results', 'items', 'rows', 'registros']) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
  }
  return [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cliente HTTP da API CDS (modo "live").
 * - Autentica com os três cabeçalhos da CDS: x_api_key, x_api_token e
 *   x_cliente_id.
 * - Rotas sob `/cds/*` (a base já inclui `/conectorCDS`).
 * - Respeita a janela de uso, quando configurada, antes de cada chamada.
 * - Faz retry com backoff exponencial em erros de rede / 5xx / 429.
 */
export class SellbieHttpClient implements SellbieClient {
  private readonly http: AxiosInstance;
  private readonly maxRetries = 4;

  constructor() {
    // A CDS autentica por três cabeçalhos fixos (nomes com underscore,
    // conforme a documentação do conector).
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (env.SELLBIE_API_KEY) headers.x_api_key = env.SELLBIE_API_KEY;
    if (env.SELLBIE_API_TOKEN) headers.x_api_token = env.SELLBIE_API_TOKEN;
    if (env.SELLBIE_CLIENT_ID) headers.x_cliente_id = env.SELLBIE_CLIENT_ID;

    this.http = axios.create({
      baseURL: env.SELLBIE_BASE_URL,
      timeout: 30_000,
      headers,
      // Basic auth legado: só é enviado se explicitamente configurado; a CDS
      // não usa. Mantido para não quebrar integrações antigas.
      auth:
        env.SELLBIE_USERNAME || env.SELLBIE_PASSWORD
          ? { username: env.SELLBIE_USERNAME, password: env.SELLBIE_PASSWORD }
          : undefined,
    });
  }

  private async get<T>(route: string, params?: object): Promise<T[]> {
    const cfg: AxiosRequestConfig = { params };

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Revalida a janela a cada tentativa: o backoff pode atravessar o fim
      // dela (ex.: 06:59:50 + 2s/4s/8s). WindowClosedError não é retryable.
      assertWindow();
      try {
        const res = await this.http.get(route, cfg);
        return unwrap<T>(res.data);
      } catch (err) {
        attempt += 1;
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        const retryable = !status || status >= 500 || status === 429;
        if (!retryable || attempt > this.maxRetries) {
          log.error('Falha ao consultar Sellbie', { route, status, attempt });
          throw err;
        }
        const backoff = 2 ** attempt * 1000;
        log.warn('Retry Sellbie', { route, status, attempt, backoff });
        await sleep(backoff);
      }
    }
  }

  getLojas(): Promise<SellbieLoja[]> {
    return this.get<SellbieLoja>('cds/lojas');
  }

  getVendedores(params?: SellbieDateRange & { seller?: string }): Promise<SellbieVendedor[]> {
    return this.get<SellbieVendedor>('cds/vendedores', params);
  }

  getCores(): Promise<SellbieCor[]> {
    return this.get<SellbieCor>('cds/cores');
  }

  getTamanhos(): Promise<SellbieTamanho[]> {
    return this.get<SellbieTamanho>('cds/tamanhos');
  }

  getProdutos(params?: SellbieDateRange): Promise<SellbieProduto[]> {
    return this.get<SellbieProduto>('cds/produtos', params);
  }

  getClientes(params?: SellbieDateRange & { cod_client?: string }): Promise<SellbieCliente[]> {
    return this.get<SellbieCliente>('cds/clientes', params);
  }

  getVendas(params?: SellbieDateRange): Promise<SellbieVenda[]> {
    return this.get<SellbieVenda>('cds/vendas', params);
  }

  getDetalhesVendas(params?: SellbieDateRange): Promise<SellbieDetalheVenda[]> {
    return this.get<SellbieDetalheVenda>('cds/detalhesVendas', params);
  }

  getPagamentosVendas(params?: SellbieDateRange): Promise<SellbiePagamentoVenda[]> {
    return this.get<SellbiePagamentoVenda>('cds/pagamentosVendas', params);
  }

  getEstoque(query: EstoqueQuery): Promise<SellbieEstoque[]> {
    if (query.cod_loja === undefined || query.cod_loja === null || query.cod_loja === '') {
      throw new Error('getEstoque: cod_loja (idFilial) é obrigatório.');
    }
    return this.get<SellbieEstoque>('cds/estoque', {
      cod_loja: query.cod_loja,
      cod_prod: query.cod_prod,
      only_disp: query.only_disp ?? 0,
    });
  }

  getEstoqueGrade(query?: EstoqueGradeQuery): Promise<SellbieEstoqueGrade[]> {
    return this.get<SellbieEstoqueGrade>('cds/estoquegrade', query);
  }

  getContasPagar(query?: ContasPagarQuery): Promise<SellbieContaPagar[]> {
    return this.get<SellbieContaPagar>('cds/contasPagar', query);
  }

  /**
   * POST /cds/inserirvenda — SEM retry deliberadamente: a rota grava uma
   * venda e a CDS não documenta idempotência. Reenviar num timeout ambíguo
   * poderia duplicar a venda no ERP; em caso de falha o chamador registra o
   * erro e a nova tentativa acontece num próximo ciclo, rastreada por
   * pedidoSite.
   */
  async inserirVenda(payload: CdsInserirVendaPayload): Promise<CdsInserirVendaResult> {
    assertWindow();
    try {
      const res = await this.http.post('cds/inserirvenda', payload);
      return res.data;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      log.error('Falha ao inserir venda na CDS', { pedidoSite: payload.pedidoSite, status });
      throw err;
    }
  }
}
