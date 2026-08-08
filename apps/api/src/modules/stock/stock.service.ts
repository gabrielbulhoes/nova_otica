import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { productWhereForGroup, scopeCategories } from '../products/product.scope.js';
import type { ProductGroup } from '../planning/planning.math.js';
import { toNumber } from '../../http/helpers.js';

/**
 * Cálculo puro do saldo ao vivo de um item:
 * - onHand = base sincronizada + ajuste de movimentações confirmadas;
 * - availableNow = onHand − reservado (nunca negativo).
 */
export function computeLiveStock(quantity: number, reserved: number, pendingDelta: number) {
  const onHand = quantity + pendingDelta;
  const availableNow = Math.max(onHand - reserved, 0);
  return { onHand, availableNow };
}

export interface StockFilter {
  /** Uma ou mais lojas (multi-seleção do filtro). */
  storeIds?: string[];
  productId?: string;
  search?: string;
  /** Uma ou mais categorias (multi-seleção do filtro). */
  categories?: string[];
  /** Recorte de produto do console: 'principal' tira lente e tratamento. */
  group?: ProductGroup;
  onlyAvailable?: boolean;
  limit: number;
  skip: number;
}

export interface StockRow {
  storeId: string;
  storeName: string;
  productId: string;
  productExternalId: string;
  description: string;
  brand: string | null;
  category: string | null;
  price: number | null;
  /** Estoque mínimo do produto (nulo = usa o padrão da rede). */
  minStock: number | null;
  /** Mínimo específico desta loja (sobrepõe o do produto quando definido). */
  storeMinStock: number | null;
  /** Quantidade da última sincronização da fonte. */
  synced: number;
  /** Reservado por movimentações internas pendentes. */
  reserved: number;
  /** Ajuste por movimentações internas confirmadas e ainda não reconciliadas. */
  pendingDelta: number;
  /** Saldo "ao vivo" = synced + pendingDelta. */
  onHand: number;
  /** Disponível para venda = onHand - reserved. */
  availableNow: number;
  syncedAt: string | null;
}

/**
 * Delta por (storeId, productId) gerado pelas movimentações internas
 * confirmadas e ainda não reconciliadas: entradas somam, saídas subtraem.
 *
 * Exportada porque o planejamento precisa do MESMO saldo que esta tela e que a
 * validação de saldo de `createMovement`. Uma segunda conta de estoque ao vivo,
 * escrita em outro módulo e obrigada a concordar com esta por disciplina, é a
 * próxima divergência silenciosa — foi assim que o remanejamento passou a
 * sugerir de novo uma transferência que o operador já tinha confirmado.
 *
 * `productIds` é recorte opcional: o planejamento trabalha sobre um conjunto
 * conhecido de produtos e não precisa varrer o histórico inteiro da rede.
 */
export async function liveDeltas(productIds?: string[]): Promise<Map<string, number>> {
  const deltas = new Map<string, number>();
  const add = (storeId: string | null, productId: string, qty: number) => {
    if (!storeId) return;
    const key = `${storeId}:${productId}`;
    deltas.set(key, (deltas.get(key) ?? 0) + qty);
  };
  const doRecorte = productIds ? { productId: { in: productIds } } : {};

  const inbound = await prisma.inventoryMovement.groupBy({
    by: ['toStoreId', 'productId'],
    where: { status: 'CONFIRMED', toStoreId: { not: null }, ...doRecorte },
    _sum: { quantity: true },
  });
  for (const r of inbound) add(r.toStoreId, r.productId, r._sum.quantity ?? 0);

  const outbound = await prisma.inventoryMovement.groupBy({
    by: ['fromStoreId', 'productId'],
    where: { status: 'CONFIRMED', fromStoreId: { not: null }, ...doRecorte },
    _sum: { quantity: true },
  });
  for (const r of outbound) add(r.fromStoreId, r.productId, -(r._sum.quantity ?? 0));

  return deltas;
}

/** Lista o estoque consolidado com saldo ao vivo. */
export async function listStock(filter: StockFilter): Promise<{ total: number; rows: StockRow[] }> {
  const where: Prisma.StockItemWhereInput = {};
  if (filter.storeIds?.length) where.storeId = { in: filter.storeIds };
  if (filter.productId) where.productId = filter.productId;
  // "Só com saldo" precisa entrar na CONSULTA, não só na página devolvida.
  //
  // Era um filtro aplicado depois da paginação: o `total` continuava sendo o
  // da rede inteira — 1.108.423 posições em produção, quase todas zeradas —
  // e a página de 50 linhas voltava com 5. Marcar a caixa fazia a lista
  // encolher e o contador não mudar, o que parece defeito de dados e é
  // defeito de consulta.
  //
  // `quantity > 0` é o que o banco sabe. O ajuste fino por movimentação
  // pendente continua abaixo, sobre um conjunto já muito menor.
  if (filter.onlyAvailable) where.quantity = { gt: 0 };
  // Recorte de produto do console: lente e tratamento saem por padrão das
  // telas de operação (são do laboratório), mas seguem consultáveis.
  // O filtro de categoria do usuário se COMBINA com o recorte, não o
  // substitui — do contrário escolher uma categoria traria lente de volta.
  const scope = await productWhereForGroup(filter.group ?? 'todos');
  const scoped = scopeCategories(scope, filter.categories);
  if (scoped || filter.search) {
    where.product = {
      ...(scoped ?? {}),
      ...(filter.search
        ? {
            OR: [
              { description: { contains: filter.search, mode: 'insensitive' } },
              { sku: { contains: filter.search, mode: 'insensitive' } },
              { externalId: { contains: filter.search, mode: 'insensitive' } },
              { brand: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  const [total, items, deltas] = await Promise.all([
    prisma.stockItem.count({ where }),
    prisma.stockItem.findMany({
      where,
      include: { store: true, product: true },
      orderBy: [{ product: { description: 'asc' } }, { store: { name: 'asc' } }],
      take: filter.limit,
      skip: filter.skip,
    }),
    liveDeltas(),
  ]);

  let rows: StockRow[] = items.map((it) => {
    const pendingDelta = deltas.get(`${it.storeId}:${it.productId}`) ?? 0;
    const { onHand, availableNow } = computeLiveStock(it.quantity, it.reserved, pendingDelta);
    return {
      storeId: it.storeId,
      storeName: it.store.name,
      productId: it.productId,
      productExternalId: it.product.externalId,
      description: it.product.description,
      brand: it.product.brand,
      category: it.product.category,
      price: toNumber(it.product.price),
      minStock: it.product.minStock,
      storeMinStock: it.minStock,
      synced: it.quantity,
      reserved: it.reserved,
      pendingDelta,
      onHand,
      availableNow,
      syncedAt: it.syncedAt ? it.syncedAt.toISOString() : null,
    };
  });

  if (filter.onlyAvailable) rows = rows.filter((r) => r.availableNow > 0);

  return { total, rows };
}

/** Resumo do estoque por produto somando todas as lojas (visão de rede). */
export async function stockByProduct(search?: string, categories?: string[], group?: ProductGroup) {
  const { rows } = await listStock({
    search,
    categories,
    group,
    limit: 100_000,
    skip: 0,
  });
  const byProduct = new Map<string, {
    productId: string;
    productExternalId: string;
    description: string;
    brand: string | null;
    category: string | null;
    price: number | null;
    totalOnHand: number;
    totalAvailable: number;
    stores: number;
  }>();
  for (const r of rows) {
    const cur = byProduct.get(r.productId) ?? {
      productId: r.productId,
      productExternalId: r.productExternalId,
      description: r.description,
      brand: r.brand,
      category: r.category,
      price: r.price,
      totalOnHand: 0,
      totalAvailable: 0,
      stores: 0,
    };
    cur.totalOnHand += r.onHand;
    cur.totalAvailable += r.availableNow;
    if (r.onHand > 0) cur.stores += 1;
    byProduct.set(r.productId, cur);
  }
  return Array.from(byProduct.values()).sort((a, b) => b.totalAvailable - a.totalAvailable);
}
