import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Escopo de "lojas planejáveis": tudo que faz conta de planejamento
 * (remanejamento, compra, ruptura, cobertura, giro) deve ignorar filiais
 * marcadas com `excludeFromPlanning` — centros de distribuição como a GMAIS,
 * que existem só pelo regime tributário e têm estoque irrelevante.
 *
 * Centralizado aqui para não espalhar a regra: as consultas relacionam por
 * `store`/`sale.store`, e o SQL cru usa a subconsulta `PLANNED_STORE_IDS_SQL`.
 */

/** Filtro de relação para StockItem/Store (Prisma): só lojas planejáveis. */
export const PLANNED_STORE_WHERE = { excludeFromPlanning: false } as const;

/** Filtro para StockItem: `{ store: { excludeFromPlanning: false } }`. */
export const stockPlannedWhere: Prisma.StockItemWhereInput = { store: PLANNED_STORE_WHERE };

/** Filtro para SaleItem via a venda: `{ sale: { store: { … } } }`. */
export const salePlannedWhere: Prisma.SaleWhereInput = { store: PLANNED_STORE_WHERE };

/** IDs das lojas planejáveis (para APIs que filtram por lista de storeIds). */
export async function plannedStoreIds(): Promise<string[]> {
  const rows = await prisma.store.findMany({
    where: PLANNED_STORE_WHERE,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
