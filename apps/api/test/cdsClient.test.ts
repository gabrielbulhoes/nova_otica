import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Garante que o cliente HTTP fala com a API CDS do jeito documentado:
 * rotas sob /cds/* e autenticação pelos três cabeçalhos (x_api_key,
 * x_api_token, x_cliente_id). Usa um adapter falso do axios — nenhuma
 * chamada de rede real acontece.
 */

// Config de ambiente para o modo live antes de importar o cliente.
process.env.DATABASE_URL ??= 'postgresql://ci:ci@localhost:5432/ci?schema=public';
process.env.SELLBIE_MODE = 'live';
process.env.SELLBIE_BASE_URL = 'http://cds.local:800/conectorCDS';
process.env.SELLBIE_API_KEY = 'key-abc';
process.env.SELLBIE_API_TOKEN = 'token-def';
process.env.SELLBIE_CLIENT_ID = 'cli-ghi';
process.env.SELLBIE_IGNORE_WINDOW = 'true';

const { SellbieHttpClient } = await import('../src/integrations/sellbie/httpClient.js');

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  params?: Record<string, unknown>;
}

const requests: CapturedRequest[] = [];

/** Instala um adapter falso que registra a requisição e responde com `data`. */
function stub(client: InstanceType<typeof SellbieHttpClient>, data: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const http = (client as any).http;
  http.defaults.adapter = async (config: Record<string, unknown>) => {
    requests.push({
      url: String(config.url),
      headers: Object.fromEntries(
        Object.entries((config.headers ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
      ),
      params: config.params as Record<string, unknown> | undefined,
    });
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
}

describe('SellbieHttpClient (API CDS)', () => {
  beforeEach(() => {
    requests.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('chama /cds/lojas com os três cabeçalhos de autenticação', async () => {
    const client = new SellbieHttpClient();
    stub(client, [{ idFilial: 1, nome: 'Matriz' }]);
    const rows = await client.getLojas();

    expect(rows).toHaveLength(1);
    const req = requests[0];
    expect(req.url).toBe('cds/lojas');
    expect(req.headers.x_api_key).toBe('key-abc');
    expect(req.headers.x_api_token).toBe('token-def');
    expect(req.headers.x_cliente_id).toBe('cli-ghi');
    // A CDS não usa Bearer nem basic — não deve haver Authorization.
    expect(req.headers.Authorization).toBeUndefined();
  });

  it('usa o prefixo /cds em todas as rotas e repassa os filtros de data', async () => {
    const client = new SellbieHttpClient();
    stub(client, []);
    await client.getProdutos({ date_start: '2026-01-01', date_end: '2026-01-31' });
    await client.getVendas({ date_start: '2026-02-01' });

    expect(requests[0].url).toBe('cds/produtos');
    expect(requests[0].params).toEqual({ date_start: '2026-01-01', date_end: '2026-01-31' });
    expect(requests[1].url).toBe('cds/vendas');
    expect(requests[1].params).toEqual({ date_start: '2026-02-01' });
  });

  it('estoque exige cod_loja e envia only_disp padrão 0', async () => {
    const client = new SellbieHttpClient();
    stub(client, []);
    await client.getEstoque({ cod_loja: 7 });

    expect(requests[0].url).toBe('cds/estoque');
    expect(requests[0].params).toMatchObject({ cod_loja: 7, only_disp: 0 });
  });

  it('estoque sem cod_loja é rejeitado (parâmetro obrigatório)', () => {
    const client = new SellbieHttpClient();
    stub(client, []);
    expect(() => client.getEstoque({ cod_loja: '' })).toThrow(/cod_loja/);
  });

  it('desembrulha o envelope { data: [...] } da resposta', async () => {
    const client = new SellbieHttpClient();
    stub(client, { data: [{ prodCodigo: 10 }, { prodCodigo: 11 }] });
    const rows = await client.getProdutos();
    expect(rows).toHaveLength(2);
  });
});
