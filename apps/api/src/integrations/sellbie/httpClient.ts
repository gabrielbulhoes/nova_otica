import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { assertWindow } from './window.js';
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
 * Cliente HTTP da API Sellbie/CDS (modo "live").
 * - Respeita a janela de uso (06:00–07:00) antes de cada chamada.
 * - Faz retry com backoff exponencial em erros de rede / 5xx / 429.
 */
export class SellbieHttpClient implements SellbieClient {
  private readonly http: AxiosInstance;
  private readonly maxRetries = 4;

  constructor() {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (env.SELLBIE_API_KEY) headers.Authorization = `Bearer ${env.SELLBIE_API_KEY}`;

    this.http = axios.create({
      baseURL: env.SELLBIE_BASE_URL,
      timeout: 30_000,
      headers,
      auth:
        env.SELLBIE_USERNAME || env.SELLBIE_PASSWORD
          ? { username: env.SELLBIE_USERNAME, password: env.SELLBIE_PASSWORD }
          : undefined,
    });
  }

  private async get<T>(route: string, params?: object): Promise<T[]> {
    assertWindow();
    const cfg: AxiosRequestConfig = { params };

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
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
    return this.get<SellbieLoja>('sellbie/lojas');
  }

  getVendedores(params?: SellbieDateRange & { seller?: string }): Promise<SellbieVendedor[]> {
    return this.get<SellbieVendedor>('sellbie/vendedores', params);
  }

  getCores(): Promise<SellbieCor[]> {
    return this.get<SellbieCor>('sellbie/cores');
  }

  getTamanhos(): Promise<SellbieTamanho[]> {
    return this.get<SellbieTamanho>('sellbie/tamanhos');
  }

  getProdutos(params?: SellbieDateRange): Promise<SellbieProduto[]> {
    return this.get<SellbieProduto>('sellbie/produtos', params);
  }

  getClientes(params?: SellbieDateRange & { cod_client?: string }): Promise<SellbieCliente[]> {
    return this.get<SellbieCliente>('sellbie/clientes', params);
  }

  getVendas(params?: SellbieDateRange): Promise<SellbieVenda[]> {
    return this.get<SellbieVenda>('sellbie/vendas', params);
  }

  getDetalhesVendas(params?: SellbieDateRange): Promise<SellbieDetalheVenda[]> {
    return this.get<SellbieDetalheVenda>('sellbie/detalhesVendas', params);
  }

  getPagamentosVendas(params?: SellbieDateRange): Promise<SellbiePagamentoVenda[]> {
    return this.get<SellbiePagamentoVenda>('sellbie/pagamentosVendas', params);
  }

  getEstoque(query: EstoqueQuery): Promise<SellbieEstoque[]> {
    if (query.cod_loja === undefined || query.cod_loja === null || query.cod_loja === '') {
      throw new Error('getEstoque: cod_loja (idFilial) é obrigatório.');
    }
    return this.get<SellbieEstoque>('sellbie/estoque', {
      cod_loja: query.cod_loja,
      cod_prod: query.cod_prod,
      only_disp: query.only_disp ?? 0,
    });
  }
}
