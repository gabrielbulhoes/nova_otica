import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import type { BrandCatalog } from './planning.math.js';

/**
 * Carrega o catálogo de marcas (fornecedor canônico + mix premium por loja),
 * gerado por scripts/build-brand-catalog.mjs a partir da planilha de grifes.
 * É gitignorado (dado comercial). Em memória após a 1ª leitura; recarrega com
 * resetBrandCatalog().
 *
 * AUSENTE → tudo segue PERMISSIVO: nenhuma restrição de mix, e o fornecedor cai
 * no campo do ERP. Isso é decisão deliberada — travar a rede inteira por falta
 * de um arquivo de configuração comercial seria pior que a regra não valer.
 *
 * MAS A AUSÊNCIA PRECISA GRITAR, e é aqui que este módulo estava errado.
 *
 * Como estava, o arquivo faltando caía direto em `cached = null` sem UMA LINHA
 * de log: o `logger.info` só disparava no sucesso, e o `catch` só pegava JSON
 * quebrado. Ausente e presente eram indistinguíveis por fora.
 *
 * O resultado, medido no repositório em 10/08/2026: o `Dockerfile` não copia
 * `apps/api/data`, o serviço `app` não tem `volumes:`, `BRAND_CATALOG_PATH` não
 * está no `.env.production.example`, e nenhum teste encosta no carregamento
 * real. Ou seja, o catálogo NUNCA chegou ao contêiner — e a regra de mix, que
 * o remanejamento e a distribuição do recebimento aplicam e que foi declarada
 * entregue ao cliente, esteve permissiva em produção o tempo todo. A lista de
 * "lojas excluídas por mix" que a tela mostra vinha sempre vazia, e ninguém
 * podia saber.
 *
 * É a terceira vez que esta plataforma entrega um recurso inerte em silêncio.
 * Daí as três mudanças: a ausência vira `error` no log, o estado vira campo do
 * `/health`, e o conteúdo ganha impressão digital — para que "a regra está
 * valendo?" e "valendo com qual catálogo?" sejam duas perguntas com resposta.
 */
let cached: BrandCatalog | null | undefined;
let estado: StatusDoCatalogo | undefined;

/** O que o `/health` publica sobre o catálogo. */
export interface StatusDoCatalogo {
  /** A regra de mix está valendo? `false` = tudo permissivo. */
  ativo: boolean;
  /** De onde veio, quando veio. `null` quando não veio. */
  fonte: string | null;
  /** Grifes com fornecedor canônico conhecido. */
  grifes: number;
  /** Lojas com mix premium declarado. */
  lojas: number;
  /**
   * Impressão digital do CONTEÚDO (sha256 curto), ou `null` sem catálogo.
   *
   * Existe porque o caminho de atualização previsto é trocar o arquivo no
   * servidor e reiniciar o contêiner — o que não muda a imagem nem a versão.
   * Sem a impressão, "atualizei o catálogo" não é verificável, e qualquer
   * coisa que venha a guardar resultado calculado (o quadro materializado, na
   * fila) não teria como saber que o insumo mudou.
   */
  impressao: string | null;
}

const CANDIDATOS = [
  env.BRAND_CATALOG_PATH,
  'apps/api/data/brand-catalog.json',
  'data/brand-catalog.json',
].filter(Boolean) as string[];

function carregar(): { catalogo: BrandCatalog | null; estado: StatusDoCatalogo } {
  const tentados: string[] = [];
  for (const rel of CANDIDATOS) {
    const p = path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);
    tentados.push(p);
    try {
      if (!existsSync(p)) continue;
      const bruto = readFileSync(p, 'utf8');
      const cat = JSON.parse(bruto) as BrandCatalog;
      const grifes = Object.keys(cat.supplierByBrand ?? {}).length;
      const lojas = Object.keys(cat.premiumStores ?? {}).length;
      const impressao = createHash('sha256').update(bruto).digest('hex').slice(0, 12);
      logger.info('catálogo de marcas carregado — regra de mix ATIVA', {
        path: p,
        grifes,
        lojas,
        impressao,
      });
      return { catalogo: cat, estado: { ativo: true, fonte: p, grifes, lojas, impressao } };
    } catch (err) {
      // JSON quebrado é PIOR que ausente: alguém quis configurar e não
      // conseguiu. Continua tentando os outros caminhos, mas o log precisa
      // separar os dois casos.
      logger.error('catálogo de marcas ilegível — arquivo existe e não pôde ser lido', {
        path: p,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // `error` e não `warn`: sem catálogo, duas regras que o cliente considera
  // entregues param de valer, e o único sinal disponível é esta linha.
  logger.error(
    'CATÁLOGO DE MARCAS AUSENTE — a regra de mix está PERMISSIVA: nenhuma grife é barrada por loja, ' +
      'nem no remanejamento nem na distribuição do recebimento. Monte o arquivo no servidor e ' +
      'aponte BRAND_CATALOG_PATH para ele.',
    { tentados },
  );
  return { catalogo: null, estado: { ativo: false, fonte: null, grifes: 0, lojas: 0, impressao: null } };
}

export function loadBrandCatalog(): BrandCatalog | null {
  if (cached !== undefined) return cached;
  const r = carregar();
  cached = r.catalogo;
  estado = r.estado;
  return cached;
}

/**
 * Estado do catálogo, para o `/health` e para quem precisar saber se a regra
 * de mix está valendo. Carrega na primeira chamada, como `loadBrandCatalog`.
 */
export function statusDoCatalogo(): StatusDoCatalogo {
  if (estado === undefined) loadBrandCatalog();
  return estado as StatusDoCatalogo;
}

/** Limpa o cache (testes / após regenerar o catálogo). */
export function resetBrandCatalog(): void {
  cached = undefined;
  estado = undefined;
}
