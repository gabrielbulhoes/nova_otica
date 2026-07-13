/**
 * Sonda da API CDS — captura amostras reais de cada endpoint GET.
 *
 * Rode ONDE a plataforma alcança a CDS (servidor do cliente):
 *   npm run cds:probe --workspace=@nova-otica/api
 *
 * Requer no .env: SELLBIE_BASE_URL, SELLBIE_API_KEY, SELLBIE_API_TOKEN e
 * SELLBIE_CLIENT_ID. NÃO grava nem imprime as credenciais.
 *
 * Para cada rota, salva a resposta bruta em apps/api/tmp/cds-fixtures/*.json
 * e imprime um resumo (status, nº de registros e as chaves do 1º registro).
 * Esse resumo/os arquivos permitem finalizar os normalizadores com certeza.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios, { type AxiosInstance } from 'axios';
import { env } from '../../config/env.js';

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tmp/cds-fixtures');

/** Data (aaaa-mm-dd) de N dias atrás — janela pequena para a sonda. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Extrai o array de dados independentemente do envelope da resposta. */
function unwrap(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['data', 'results', 'items', 'rows', 'registros']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

interface ProbeResult {
  route: string;
  ok: boolean;
  status?: number;
  count?: number;
  envelope: 'array' | 'objeto' | 'outro';
  firstKeys?: string[];
  error?: string;
}

async function probe(http: AxiosInstance, name: string, route: string, params?: object): Promise<ProbeResult> {
  try {
    const res = await http.get(route, { params });
    const rows = unwrap(res.data);
    const first = rows[0];
    await writeFile(path.join(OUT_DIR, `${name}.json`), JSON.stringify(res.data, null, 2), 'utf8');
    return {
      route,
      ok: true,
      status: res.status,
      count: rows.length,
      envelope: Array.isArray(res.data) ? 'array' : res.data && typeof res.data === 'object' ? 'objeto' : 'outro',
      firstKeys: first && typeof first === 'object' ? Object.keys(first as object) : undefined,
    };
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    return { route, ok: false, status, envelope: 'outro', error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  if (!env.SELLBIE_BASE_URL || !env.SELLBIE_API_KEY || !env.SELLBIE_API_TOKEN || !env.SELLBIE_CLIENT_ID) {
    // eslint-disable-next-line no-console
    console.error(
      'Configure SELLBIE_BASE_URL, SELLBIE_API_KEY, SELLBIE_API_TOKEN e SELLBIE_CLIENT_ID no .env antes de sondar.',
    );
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const http = axios.create({
    baseURL: env.SELLBIE_BASE_URL,
    timeout: 30_000,
    headers: {
      Accept: 'application/json',
      x_api_key: env.SELLBIE_API_KEY,
      x_api_token: env.SELLBIE_API_TOKEN,
      x_cliente_id: env.SELLBIE_CLIENT_ID,
    },
  });

  const range = { date_start: daysAgo(7), date_end: daysAgo(0) };
  const results: ProbeResult[] = [];

  results.push(await probe(http, 'lojas', 'cds/lojas'));
  results.push(await probe(http, 'vendedores', 'cds/vendedores'));
  results.push(await probe(http, 'cores', 'cds/cores'));
  results.push(await probe(http, 'tamanhos', 'cds/tamanhos'));
  results.push(await probe(http, 'produtos', 'cds/produtos', range));
  results.push(await probe(http, 'clientes', 'cds/clientes', range));
  results.push(await probe(http, 'vendas', 'cds/vendas', range));
  results.push(await probe(http, 'detalhesVendas', 'cds/detalhesVendas', range));
  results.push(await probe(http, 'pagamentosVendas', 'cds/pagamentosVendas', range));
  results.push(await probe(http, 'estoquegrade', 'cds/estoquegrade', { only_disp: 1 }));
  results.push(await probe(http, 'contasPagar', 'cds/contasPagar', {}));
  // POST /cds/inserirvenda NÃO é sondado de propósito: é escrita no ERP real.

  // Estoque exige cod_loja — usa a 1ª filial retornada em /lojas, se houver.
  const lojas = results.find((r) => r.route === 'cds/lojas');
  if (lojas?.ok) {
    try {
      const first = (await http.get('cds/lojas')).data;
      const arr = unwrap(first);
      const codLoja = (arr[0] as Record<string, unknown> | undefined)?.idFilial;
      if (codLoja !== undefined) {
        results.push(await probe(http, 'estoque', 'cds/estoque', { cod_loja: codLoja, only_disp: 0 }));
      }
    } catch {
      // ignora — o resumo de /lojas já indica o problema
    }
  }

  // eslint-disable-next-line no-console
  console.log('\n=== Resumo da sonda CDS ===');
  for (const r of results) {
    const head = `${r.ok ? '✅' : '❌'} ${r.route}  [HTTP ${r.status ?? '—'}]`;
    if (r.ok) {
      // eslint-disable-next-line no-console
      console.log(`${head}  envelope=${r.envelope}  registros=${r.count}`);
      if (r.firstKeys) console.log(`     campos do 1º registro: ${r.firstKeys.join(', ')}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`${head}  erro=${r.error}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`\nAmostras salvas em: ${OUT_DIR}`);
  console.log('Envie esses arquivos (ou o resumo acima) para finalizarmos os normalizadores.');
  process.exit(results.every((r) => r.ok) ? 0 : 2);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Falha na sonda CDS:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
