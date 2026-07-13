import { z } from 'zod';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest, HttpError, notFound } from '../../http/helpers.js';
import { publish } from '../../lib/eventBus.js';

/** Cliente Prisma "normal" ou transacional — permite compor com $transaction. */
export type Db = Prisma.TransactionClient | typeof prisma;

/** Quem está executando a ação (vem de req.user). */
export interface Actor {
  id: string;
  role: Role;
  storeId: string | null;
}

export const createMovementSchema = z
  .object({
    type: z.enum(['TRANSFER', 'SALE', 'ADJUSTMENT', 'RETURN']),
    productId: z.string().min(1),
    fromStoreId: z.string().min(1).optional(),
    toStoreId: z.string().min(1).optional(),
    quantity: z.number().int().positive(),
    reason: z.string().max(280).optional(),
    reference: z.string().max(120).optional(),
    /** Confirma imediatamente (apenas quando permitido pelo papel). */
    confirm: z.boolean().optional().default(false),
  })
  .superRefine((v, ctx) => {
    const needsFrom = v.type === 'TRANSFER' || v.type === 'SALE';
    const needsTo = v.type === 'TRANSFER' || v.type === 'RETURN';
    if (needsFrom && !v.fromStoreId)
      ctx.addIssue({ code: 'custom', path: ['fromStoreId'], message: 'Origem é obrigatória.' });
    if (needsTo && !v.toStoreId)
      ctx.addIssue({ code: 'custom', path: ['toStoreId'], message: 'Destino é obrigatório.' });
    if (v.type === 'TRANSFER' && v.fromStoreId && v.fromStoreId === v.toStoreId)
      ctx.addIssue({ code: 'custom', path: ['toStoreId'], message: 'Origem e destino devem diferir.' });
    if (v.type === 'ADJUSTMENT' && !v.fromStoreId && !v.toStoreId)
      ctx.addIssue({ code: 'custom', path: ['fromStoreId'], message: 'Informe origem (baixa) ou destino (entrada).' });
  });

export type CreateMovementInput = z.infer<typeof createMovementSchema>;

async function ensureRefs(input: CreateMovementInput, db: Db = prisma) {
  const product = await db.product.findUnique({ where: { id: input.productId } });
  if (!product) throw notFound('Produto não encontrado');
  for (const storeId of [input.fromStoreId, input.toStoreId].filter(Boolean) as string[]) {
    const store = await db.store.findUnique({ where: { id: storeId } });
    if (!store) throw notFound(`Loja não encontrada: ${storeId}`);
  }
}

/** Saldo disponível ao vivo na loja de origem (synced + delta confirmado - reservado). */
export async function availableAt(storeId: string, productId: string, db: Db = prisma): Promise<number> {
  const item = await db.stockItem.findUnique({
    where: { storeId_productId: { storeId, productId } },
  });
  const synced = item?.quantity ?? 0;
  const reserved = item?.reserved ?? 0;

  const inbound = await db.inventoryMovement.aggregate({
    where: { status: 'CONFIRMED', toStoreId: storeId, productId },
    _sum: { quantity: true },
  });
  const outbound = await db.inventoryMovement.aggregate({
    where: { status: 'CONFIRMED', fromStoreId: storeId, productId },
    _sum: { quantity: true },
  });
  const delta = (inbound._sum.quantity ?? 0) - (outbound._sum.quantity ?? 0);
  return synced + delta - reserved;
}

/**
 * Regras de papel:
 * - STORE_MANAGER só opera na própria loja; TRANSFER que ele cria nasce como
 *   REQUESTED (precisa de aprovação da rede). ADJUSTMENT é exclusivo do ADMIN.
 * - ADMIN cria já efetivável (PENDING, ou CONFIRMED se `confirm`).
 */
function decideInitialStatus(input: CreateMovementInput, actor: Actor): 'REQUESTED' | 'PENDING' | 'CONFIRMED' {
  if (input.type === 'TRANSFER' && actor.role === 'STORE_MANAGER') return 'REQUESTED';
  return input.confirm ? 'CONFIRMED' : 'PENDING';
}

function assertActorMayCreate(input: CreateMovementInput, actor: Actor) {
  if (actor.role === 'ADMIN') return;
  // STORE_MANAGER
  if (input.type === 'ADJUSTMENT') {
    throw new HttpError(403, 'Ajuste de estoque é exclusivo da rede (ADMIN).');
  }
  const stores = [input.fromStoreId, input.toStoreId].filter(Boolean) as string[];
  const involvesOwnStore = stores.includes(actor.storeId ?? '__none__');
  if (!involvesOwnStore) {
    throw new HttpError(403, 'Você só pode movimentar envolvendo a sua própria loja.');
  }
}

/**
 * Serializa validações/gravações concorrentes na mesma posição de estoque
 * (loja × produto) via advisory lock transacional do Postgres: o lock vale
 * até o commit e faz o check-then-insert de saldo enxergar inserções
 * concorrentes, evitando over-reservation.
 */
async function lockStockPosition(db: Db, storeId: string, productId: string): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${storeId} || ':' || ${productId}))`;
}

export async function createMovement(input: CreateMovementInput, actor: Actor, db?: Db) {
  // A validação de saldo + criação precisam ser atômicas; sem transação
  // externa, abre uma própria para o advisory lock ter efeito.
  if (!db) return prisma.$transaction((tx) => createMovementIn(input, actor, tx));
  return createMovementIn(input, actor, db);
}

async function createMovementIn(input: CreateMovementInput, actor: Actor, db: Db) {
  await ensureRefs(input, db);
  assertActorMayCreate(input, actor);

  const status = decideInitialStatus(input, actor);

  // Só valida saldo quando a movimentação já vai reservar/efetivar agora.
  if (input.fromStoreId && status !== 'REQUESTED') {
    await lockStockPosition(db, input.fromStoreId, input.productId);
    const available = await availableAt(input.fromStoreId, input.productId, db);
    if (input.quantity > available) {
      throw badRequest(
        `Saldo insuficiente na origem (disponível: ${available}, solicitado: ${input.quantity}).`,
      );
    }
  }

  const movement = await db.inventoryMovement.create({
    data: {
      type: input.type,
      status,
      productId: input.productId,
      fromStoreId: input.fromStoreId ?? null,
      toStoreId: input.toStoreId ?? null,
      quantity: input.quantity,
      reason: input.reason ?? null,
      reference: input.reference ?? null,
      createdBy: actor.id,
      confirmedAt: status === 'CONFIRMED' ? new Date() : null,
    },
  });

  await recomputeReserved(input.fromStoreId, db);
  publish({ type: 'movement.changed', storeId: input.fromStoreId ?? input.toStoreId, movementId: movement.id });
  return movement;
}

/** ADMIN aprova uma solicitação (REQUESTED -> PENDING). Revalida o saldo. */
export async function approveMovement(id: string, actor: Actor, note?: string) {
  if (actor.role !== 'ADMIN') throw new HttpError(403, 'Apenas a rede (ADMIN) aprova transferências.');

  // Transação + lock da posição: a revalidação de saldo não pode correr em
  // paralelo com outras reservas/aprovações do mesmo (loja, produto).
  const { updated, fromStoreId } = await prisma.$transaction(async (tx) => {
    const mov = await tx.inventoryMovement.findUnique({ where: { id } });
    if (!mov) throw notFound('Movimentação não encontrada');
    if (mov.status !== 'REQUESTED') throw badRequest(`Movimentação não está em solicitação (${mov.status}).`);

    if (mov.fromStoreId) {
      await lockStockPosition(tx, mov.fromStoreId, mov.productId);
      const available = await availableAt(mov.fromStoreId, mov.productId, tx);
      if (mov.quantity > available) {
        throw badRequest(`Saldo insuficiente na origem para aprovar (disponível: ${available}).`);
      }
    }

    const row = await tx.inventoryMovement.update({
      where: { id },
      data: { status: 'PENDING', approvedBy: actor.id, approvedAt: new Date(), decisionNote: note ?? null },
    });
    await recomputeReserved(mov.fromStoreId, tx);
    return { updated: row, fromStoreId: mov.fromStoreId };
  });

  publish({ type: 'movement.changed', storeId: fromStoreId, movementId: id });
  return updated;
}

/** ADMIN rejeita uma solicitação (REQUESTED -> REJECTED). */
export async function rejectMovement(id: string, actor: Actor, note?: string) {
  if (actor.role !== 'ADMIN') throw new HttpError(403, 'Apenas a rede (ADMIN) rejeita transferências.');
  const mov = await prisma.inventoryMovement.findUnique({ where: { id } });
  if (!mov) throw notFound('Movimentação não encontrada');
  if (mov.status !== 'REQUESTED') throw badRequest(`Movimentação não está em solicitação (${mov.status}).`);

  const updated = await prisma.inventoryMovement.update({
    where: { id },
    data: { status: 'REJECTED', approvedBy: actor.id, approvedAt: new Date(), decisionNote: note ?? null },
  });
  publish({ type: 'movement.changed', storeId: mov.fromStoreId, movementId: id });
  return updated;
}

/** Efetiva uma movimentação aprovada (PENDING -> CONFIRMED). */
export async function confirmMovement(id: string, actor: Actor, db: Db = prisma) {
  const mov = await db.inventoryMovement.findUnique({ where: { id } });
  if (!mov) throw notFound('Movimentação não encontrada');
  if (mov.status !== 'PENDING') throw badRequest(`Movimentação não está pendente (${mov.status}).`);
  assertActorControls(mov.fromStoreId, mov.toStoreId, actor);

  // Guarda de status atômica (updateMany condicional): duas confirmações
  // concorrentes — ou confirmar × cancelar — não passam as duas.
  const res = await db.inventoryMovement.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
  });
  if (res.count === 0) throw badRequest('Movimentação não está mais pendente (concorrência).');

  await recomputeReserved(mov.fromStoreId, db);
  publish({ type: 'movement.changed', storeId: mov.fromStoreId ?? mov.toStoreId, movementId: id });
  return db.inventoryMovement.findUnique({ where: { id } });
}

/** Cancela uma movimentação ainda não efetivada/reconciliada. */
export async function cancelMovement(id: string, actor: Actor, db: Db = prisma) {
  const mov = await db.inventoryMovement.findUnique({ where: { id } });
  if (!mov) throw notFound('Movimentação não encontrada');
  if (mov.status === 'RECONCILED' || mov.status === 'CONFIRMED')
    throw badRequest('Movimentação já efetivada/reconciliada não pode ser cancelada.');
  assertActorControls(mov.fromStoreId, mov.toStoreId, actor);

  // Guarda de status atômica: não cancela o que acabou de ser efetivado.
  const res = await db.inventoryMovement.updateMany({
    where: { id, status: { notIn: ['CONFIRMED', 'RECONCILED', 'CANCELLED'] } },
    data: { status: 'CANCELLED' },
  });
  if (res.count === 0) throw badRequest('Movimentação não pode mais ser cancelada (concorrência).');

  await recomputeReserved(mov.fromStoreId, db);
  publish({ type: 'movement.changed', storeId: mov.fromStoreId ?? mov.toStoreId, movementId: id });
  return db.inventoryMovement.findUnique({ where: { id } });
}

/** STORE_MANAGER só controla movimentações que envolvem a sua loja. */
function assertActorControls(fromStoreId: string | null, toStoreId: string | null, actor: Actor) {
  if (actor.role === 'ADMIN') return;
  const own = actor.storeId ?? '__none__';
  if (fromStoreId !== own && toStoreId !== own) {
    throw new HttpError(403, 'Ação restrita à sua própria loja.');
  }
}

/** Recalcula a reserva (saídas PENDING) de uma loja específica. */
async function recomputeReserved(storeId?: string | null, db: Db = prisma) {
  if (!storeId) return;
  const grouped = await db.inventoryMovement.groupBy({
    by: ['productId'],
    where: { status: 'PENDING', fromStoreId: storeId },
    _sum: { quantity: true },
  });
  const reservedByProduct = new Map(grouped.map((g) => [g.productId, g._sum.quantity ?? 0]));

  const items = await db.stockItem.findMany({ where: { storeId } });
  const seen = new Set<string>();
  for (const item of items) {
    seen.add(item.productId);
    const reserved = reservedByProduct.get(item.productId) ?? 0;
    if (reserved !== item.reserved) {
      await db.stockItem.update({ where: { id: item.id }, data: { reserved } });
    }
  }
  // Reservas de posições sem linha em StockItem (produto ainda não veio no
  // sync desta loja) também precisam persistir, senão availableAt() as ignora.
  for (const [productId, reserved] of reservedByProduct) {
    if (seen.has(productId) || reserved === 0) continue;
    await db.stockItem.create({ data: { storeId, productId, reserved } });
  }
}

export async function listMovements(params: {
  status?: string;
  storeId?: string;
  productId?: string;
  limit: number;
  skip: number;
}) {
  const where: Record<string, unknown> = {};
  if (params.status) where.status = params.status;
  if (params.productId) where.productId = params.productId;
  if (params.storeId) where.OR = [{ fromStoreId: params.storeId }, { toStoreId: params.storeId }];

  const [total, rows] = await Promise.all([
    prisma.inventoryMovement.count({ where }),
    prisma.inventoryMovement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { product: true, fromStore: true, toStore: true },
      take: params.limit,
      skip: params.skip,
    }),
  ]);
  return { total, rows };
}
