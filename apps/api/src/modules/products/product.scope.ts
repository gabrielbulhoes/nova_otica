import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { matchesProductGroup, type ProductGroup } from '../planning/planning.math.js';

/**
 * Recorte de produto para as telas de operação (feedback do Galbe, 29/07:
 * "ainda continua puxando lentes").
 *
 * A regra de o que é óculos já existe e é pura: `matchesProductGroup`. Em vez
 * de reescrevê-la em SQL — e passar a ter duas definições que divergem no
 * primeiro caso estranho — resolvemos a lista de CATEGORIAS que casam com o
 * grupo e filtramos por ela. A rede tem poucas dezenas de categorias, então
 * isto é uma consulta barata e um cache curto resolve.
 */

let cache: { at: number; categories: string[] } | null = null;
const TTL_MS = 60_000;

async function allCategories(): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.categories;
  const rows = await prisma.product.findMany({
    where: { category: { not: null } },
    select: { category: true },
    distinct: ['category'],
  });
  const categories = rows.map((r) => r.category).filter((c): c is string => !!c);
  cache = { at: Date.now(), categories };
  return categories;
}

/** Esquece a lista — usado nos testes e após uma sincronização. */
export function resetProductScopeCache(): void {
  cache = null;
}

/**
 * Filtro de Product para o grupo pedido, ou `undefined` em 'todos' (nenhum
 * filtro). Produto sem categoria fica de fora dos recortes específicos: sem
 * categoria não dá para afirmar que é óculos.
 */
export async function productWhereForGroup(
  group: ProductGroup,
): Promise<Prisma.ProductWhereInput | undefined> {
  if (group === 'todos') return undefined;
  const categories = (await allCategories()).filter((c) => matchesProductGroup(c, group));
  return { category: { in: categories } };
}

/** Mesma coisa, para quem filtra StockItem/SaleItem pelo produto relacionado. */
export async function productFilterForGroup(
  group: ProductGroup,
): Promise<{ product: Prisma.ProductWhereInput } | Record<string, never>> {
  const where = await productWhereForGroup(group);
  return where ? { product: where } : {};
}

/** Lê o parâmetro `group` da query, com 'todos' como padrão (compatível). */
export function parseGroup(v: unknown): ProductGroup {
  return v === 'principal' || v === 'lentes' ? v : 'todos';
}

/**
 * Combina o recorte com as categorias que o usuário escolheu no filtro —
 * INTERSEÇÃO, não substituição. Sem isso, escolher uma categoria no filtro
 * apagaria o recorte e traria lente de volta pela porta dos fundos.
 * Devolve `undefined` quando não há restrição nenhuma.
 */
export function scopeCategories(
  scope: Prisma.ProductWhereInput | undefined,
  picked: string[] | undefined,
): Prisma.ProductWhereInput | undefined {
  const allowed = (scope?.category as { in?: string[] } | undefined)?.in;
  if (!allowed) return picked?.length ? { category: { in: picked } } : undefined;
  if (!picked?.length) return { category: { in: allowed } };
  return { category: { in: picked.filter((c) => allowed.includes(c)) } };
}

/** Categorias do grupo, ou `null` em 'todos' (sem restrição). */
export async function categoriesInGroup(group: ProductGroup): Promise<string[] | null> {
  const where = await productWhereForGroup(group);
  const list = (where?.category as { in?: string[] } | undefined)?.in;
  return list && list.length > 0 ? list : null;
}
