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

/** Params em uma linha curta, para caber no log sem escondê-lo. */
function resumirParams(params?: object): string {
  if (!params) return '';
  return Object.entries(params)
    .map(([k, v]) => {
      const s = String(v ?? '');
      return `${k}=${s.length > 40 ? `${s.slice(0, 37)}…(${s.length})` : s}`;
    })
    .join(' ');
}

/**
 * A causa, em texto legível.
 *
 * `String(causa)` devolve `[object Object]` para o que não é `Error` — e o
 * axios rejeita com objeto simples em alguns caminhos de rede, justamente os
 * de timeout. A mensagem que chega ao Telegram do cliente é a única pista que
 * ele tem; perdê-la ali é perder o incidente.
 */
function detalharCausa(causa: unknown): string {
  if (causa instanceof Error) return causa.message;
  if (causa && typeof causa === 'object') {
    try {
      return JSON.stringify(causa);
    } catch {
      // Referência circular: melhor as chaves que `[object Object]`.
      return Object.keys(causa).join(', ') || 'objeto sem detalhe';
    }
  }
  return String(causa);
}

/**
 * A CDS não está ao alcance — timeout, DNS ou pacote descartado.
 *
 * Distinta de um erro da CDS (4xx/5xx com resposta): aquilo é a CDS falando,
 * isto é a CDS calada. A diferença decide se vale continuar o ciclo.
 *
 * Nasceu do incidente de 16/08/2026: as dez entidades falharam com o MESMO
 * `timeout of 30000ms exceeded`, cada uma gastando cinco tentativas de 30 s. O
 * ciclo levou 39 minutos para concluir o que a primeira rota já tinha provado
 * em três, e comeu quase inteira a janela de uma hora em que a CDS aceita ser
 * consultada — janela que era a única chance de tentar de novo no mesmo dia.
 */
export class SellbieUnreachableError extends Error {
  readonly route: string;
  readonly causa: unknown;
  constructor(route: string, causa: unknown) {
    super(`CDS inalcançável em "${route}": ${detalharCausa(causa)}`);
    this.name = 'SellbieUnreachableError';
    this.route = route;
    this.causa = causa;
  }
}

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
        const rows = unwrap<T>(res.data);
        // O conector corta a resposta num teto que não documenta e não sinaliza
        // — nem status diferente, nem campo de total, nem cursor. Sem este
        // aviso, uma rota truncada só aparece semanas depois como "o número do
        // painel está estranho". Aqui ela aparece no log da própria chamada.
        if (rows.length >= env.SELLBIE_PAGE_LIMIT) {
          log.warn('Resposta possivelmente truncada pelo conector', {
            route,
            linhas: rows.length,
            teto: env.SELLBIE_PAGE_LIMIT,
            // Resumido: `cod_prod` chega com 250 códigos e despejar a lista
            // inteira a cada aviso deixaria o log ilegível justo na hora em
            // que ele é a única pista.
            params: resumirParams(params),
          });
        }
        return rows;
      } catch (err) {
        attempt += 1;
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        const retryable = !status || status >= 500 || status === 429;
        if (!retryable || attempt > this.maxRetries) {
          log.error('Falha ao consultar Sellbie', { route, status, attempt });
          // ESGOTOU AS TENTATIVAS SEM NUNCA TER RESPOSTA HTTP → a CDS não está
          // ao alcance. `status` indefinido depois de 5 idas é timeout, DNS ou
          // pacote descartado — nunca um erro de aplicação, que viria com
          // código. O tipo existe para o sync poder PARAR em vez de provar a
          // mesma indisponibilidade em mais nove rotas: ver `runFullSyncLocked`.
          if (status === undefined) throw new SellbieUnreachableError(route, err);
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

  getContasPagar(query: ContasPagarQuery): Promise<SellbieContaPagar[]> {
    // situacao é obrigatória NA PRÁTICA (o conector responde 400 sem ela,
    // apesar de a doc dizer opcional) — o tipo já força o chamador.
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
