import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Escopo de "lojas planejáveis": tudo que faz conta — planejamento, BI,
 * relatórios e painel — deve ignorar duas classes de filial, por motivos
 * diferentes:
 *
 *  · `excludeFromPlanning` — RETAGUARDA. Centro de distribuição (GMAIS),
 *    assistência e estoque de compras. São da rede, têm estoque de verdade,
 *    mas não vendem ao cliente. O painel declara as unidades delas num
 *    indicador próprio, rotulado como retaguarda.
 *
 *  · `externalErp` — OUTRO ERP. As lojas ZEISS VISION CENTER (feedback 6.0,
 *    item 01). O conector CDS devolve dados delas, mas desatualizados, porque
 *    a operação roda em outro sistema. Número desatualizado apresentado como
 *    atual é pior do que número ausente.
 *
 * Os dois campos existem separados porque somar a ZEISS ao indicador de
 * retaguarda faria três lojas de varejo aparecerem como centro de
 * distribuição — trocaria um erro por outro.
 *
 * Centralizado aqui para não espalhar a regra: as consultas relacionam por
 * `store`/`sale.store`, e o SQL cru usa `PLANNED_STORE_SQL`.
 */

/** Filtro de relação para StockItem/Store (Prisma): só lojas planejáveis. */
export const PLANNED_STORE_WHERE = { excludeFromPlanning: false, externalErp: false } as const;

/** Filtro para StockItem: `{ store: { … } }`. */
export const stockPlannedWhere: Prisma.StockItemWhereInput = { store: PLANNED_STORE_WHERE };

/** Filtro para SaleItem via a venda: `{ sale: { store: { … } } }`. */
export const salePlannedWhere: Prisma.SaleWhereInput = { store: PLANNED_STORE_WHERE };

/**
 * Predicado para SQL cru, aplicado a um alias de `"Store"` já no JOIN.
 * Uso: `JOIN "Store" st ON st.id = s."storeId" AND ${plannedStoreSql('st')}`.
 *
 * Existe porque a condição estava escrita à mão em seis consultas — e quando
 * ela ganhou um segundo campo, seis lugares precisariam lembrar disso. O
 * alias é interpolado como identificador cru, então só chame com literais do
 * próprio código (nunca com entrada de usuário).
 */
export function plannedStoreSql(alias: string): Prisma.Sql {
  const a = Prisma.raw(`"${alias}"`);
  return Prisma.sql`${a}."excludeFromPlanning" = false AND ${a}."externalErp" = false`;
}

/** Subconsulta de ids: `WHERE s."storeId" IN (${PLANNED_STORE_IDS_SQL})`. */
export const PLANNED_STORE_IDS_SQL = Prisma.sql`
  SELECT id FROM "Store" WHERE "excludeFromPlanning" = false AND "externalErp" = false
`;

/** IDs das lojas planejáveis (para APIs que filtram por lista de storeIds). */
export async function plannedStoreIds(): Promise<string[]> {
  const rows = await prisma.store.findMany({
    where: PLANNED_STORE_WHERE,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
