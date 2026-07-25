import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import type { BrandCatalog } from './planning.math.js';

/**
 * Carrega o catálogo de marcas (fornecedor canônico + mix premium por loja),
 * gerado por scripts/build-brand-catalog.mjs a partir da planilha de grifes.
 * É gitignorado (dado comercial). Ausente → devolve null e tudo segue
 * permissivo (nenhuma restrição de mix; fornecedor cai no campo do ERP).
 * Em memória após a 1ª leitura; recarrega com resetBrandCatalog().
 */
let cached: BrandCatalog | null | undefined;

const CANDIDATES = [
  env.BRAND_CATALOG_PATH,
  'apps/api/data/brand-catalog.json',
  'data/brand-catalog.json',
].filter(Boolean) as string[];

export function loadBrandCatalog(): BrandCatalog | null {
  if (cached !== undefined) return cached;
  for (const rel of CANDIDATES) {
    const p = path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);
    try {
      if (existsSync(p)) {
        const cat = JSON.parse(readFileSync(p, 'utf8')) as BrandCatalog;
        logger.info('catálogo de marcas carregado', {
          path: p,
          brands: Object.keys(cat.supplierByBrand ?? {}).length,
        });
        cached = cat;
        return cached;
      }
    } catch (err) {
      logger.warn('falha ao ler o catálogo de marcas — seguindo sem ele', { err, path: p });
    }
  }
  cached = null;
  return cached;
}

/** Limpa o cache (testes / após regenerar o catálogo). */
export function resetBrandCatalog(): void {
  cached = undefined;
}
