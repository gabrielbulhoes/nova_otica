import { z } from 'zod';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest, HttpError, notFound } from '../../http/helpers.js';
import { publish } from '../../lib/eventBus.js';

/** Cliente Prisma ou cliente de transação — permite reuso dentro de $transaction. */
type Db = Prisma.TransactionClient | typeof prisma;

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

async function ensureRefs(input: CreateMovementInput) {
  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product) throw notFound('Produto não encontrado');
  for (const storeId of [input.fromStoreId, input.toStoreId].filter(Boolean) as string[]) {
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw notFound(`Loja não encontrada: ${storeId}`);
  }
}

/**
 * Saldo disponível ao vivo na loja de origem:
 *   synced + (entradas confirmadas − saídas confirmadas) − reservas PENDENTES.
 * Usa a agregação AO VIVO das reservas PENDING (não o campo denormalizado
 * `reserved`), para que a validação enxergue reservas concorrentes já gravadas
 * e o controle de concorrência (advisory lock) funcione de fato.
 */
export async function availableAt(storeId: string, productId: string, db: Db = prisma): Promise<number> {
  const item = await db.stockItem.findUnique({
    where: { storeId_productId: { storeId, productId } },
  });
  const synced = item?.quantity ?? 0;

  const [inbound, outbound, pending] = await Promise.all([
    db.inventoryMovement.aggregate({
      where: { status: 'CONFIRMED', toStoreId: storeId, productId },
      _sum: { quantity: true },
    }),
    db.inventoryMovement.aggregate({
      where: { status: 'CONFIRMED', fromStoreId: storeId, productId },
      _sum: { quantity: true },
    }),
    db.inventoryMovement.aggregate({
      where: { status: 'PENDING', fromStoreId: storeId, productId },
      _sum: { quantity: true },
    }),
  ]);
  const confirmedDelta = (inbound._sum.quantity ?? 0) - (outbound._sum.quantity ?? 0);
  const reserved = pending._sum.quantity ?? 0;
  return synced + confirmedDelta - reserved;
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
 * Trava concorrente as reservas do mesmo (loja, produto) por meio de um advisory
 * lock transacional do Postgres — auto-liberado no commit/rollback. Duas reservas
 * simultâneas do último item passam a ser serializadas (evita oversell).
 */
async function lockStockRow(db: Db, storeId: string, productId: string): Promise<void> {
  const key = `${storeId}:${productId}`;
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/**
 * Cria a movimentação DENTRO de uma transação, validando o saldo sob lock.
 * Reutilizável pelo checkout (que abre a própria transação).
 */
export async function createMovementTx(
  db: Db,
  input: CreateMovementInput,
  status: 'REQUESTED' | 'PENDING' | 'CONFIRMED',
  createdBy: string,
) {
  // Só valida saldo quando a movimentação já vai reservar/efetivar agora.
  if (input.fromStoreId && status !== 'REQUESTED') {
    await lockStockRow(db, input.fromStoreId, input.productId);
    const available = await availableAt(input.fromStoreId, input.productId, db);
    if (input.quantity > available) {
      throw badRequest(
        `Saldo insuficiente na origem (disponível: ${available}, solicitado: ${input.quantity}).`,
      );
    }
  }

  return db.inventoryMovement.create({
    data: {
      type: input.type,
      status,
      productId: input.productId,
      fromStoreId: input.fromStoreId ?? null,
      toStoreId: input.toStoreId ?? null,
      quantity: input.quantity,
      reason: input.reason ?? null,
      reference: input.reference ?? null,
      createdBy,
      confirmedAt: status === 'CONFIRMED' ? new Date() : null,
    },
  });
}

export async function createMovement(input: CreateMovementInput, actor: Actor) {
  await ensureRefs(input);
  assertActorMayCreate(input, actor);

  const status = decideInitialStatus(input, actor);

  const movement = await prisma.$transaction((tx) => createMovementTx(tx, input, status, actor.id));

  await recomputeReserved(input.fromStoreId);
  publish({ type: 'movement.changed', storeId: input.fromStoreId ?? input.toStoreId, movementId: movement.id });
  return movement;
}

/** ADMIN aprova uma solicitação (REQUESTED -> PENDING). Revalida o saldo. */
export async function approveMovement(id: string, actor: Actor, note?: string) {
  if (actor.role !== 'ADMIN') throw new HttpError(403, 'Apenas a rede (ADMIN) aprova transferências.');
  const mov = await prisma.inventoryMovement.findUnique({ where: { id } });
  if (!mov) throw notFound('Movimentação não encontrada');
  if (mov.status !== 'REQUESTED') throw badRequest(`Movimentação não está em solicitação (${mov.status}).`);

  if (mov.fromStoreId) {
    const available = await availableAt(mov.fromStoreId, mov.productId);
    if (mov.quantity > available) {
      throw badRequest(`Saldo insuficiente na origem para aprovar (disponível: ${available}).`);
    }
  }

  const updated = await prisma.inventoryMovement.update({
    where: { id },
    data: { status: 'PENDING', approvedBy: actor.id, approvedAt: new Date(), decisionNote: note ?? null },
  });
  await recomputeReserved(mov.fromStoreId);
  publish({ type: 'movement.changed', storeId: mov.fromStoreId, movementId: id });
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

/**
 * Efetiva PENDING -> CONFIRMED com guarda de status atômica (updateMany
 * condicional): impede confirmar duas vezes ou confirmar algo já cancelado.
 * Reutilizável pelo checkout dentro da sua transação.
 */
export async function confirmMovementTx(db: Db, id: string): Promise<void> {
  const res = await db.inventoryMovement.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
  });
  if (res.count === 0) throw badRequest('Movimentação não está mais pendente (concorrência).');
}

/** Efetiva uma movimentação aprovada (PENDING -> CONFIRMED). */
export async function confirmMovement(id: string, actor: Actor) {
  const mov = await prisma.inventoryMovement.findUnique({ where: { id } });
  if (!mov) throw notFound('Movimentação não encontrada');
  if (mov.status !== 'PENDING') throw badRequest(`Movimentação não está pendente (${mov.status}).`);
  assertActorControls(mov.fromStoreId, mov.toStoreId, actor);

  await confirmMovementTx(prisma, id);
  await recomputeReserved(mov.fromStoreId);
  publish({ type: 'movement.changed', storeId: mov.fromStoreId ?? mov.toStoreId, movementId: id });
  return prisma.inventoryMovement.findUnique({ where: { id } });
}

/** Cancela uma movimentação ainda não efetivada/reconciliada. */
export async function cancelMovement(id: string, actor: Actor) {
  const mov = await prisma.inventoryMovement.findUnique({ where: { id } });
  if (!mov) throw notFound('Movimentação não encontrada');
  if (mov.status === 'RECONCILED' || mov.status === 'CONFIRMED')
    throw badRequest('Movimentação já efetivada/reconciliada não pode ser cancelada.');
  assertActorControls(mov.fromStoreId, mov.toStoreId, actor);

  // Guarda de status: só cancela o que ainda não foi efetivado/reconciliado.
  const res = await prisma.inventoryMovement.updateMany({
    where: { id, status: { notIn: ['CONFIRMED', 'RECONCILED', 'CANCELLED'] } },
    data: { status: 'CANCELLED' },
  });
  if (res.count === 0) throw badRequest('Movimentação não pode mais ser cancelada (concorrência).');

  await recomputeReserved(mov.fromStoreId);
  publish({ type: 'movement.changed', storeId: mov.fromStoreId ?? mov.toStoreId, movementId: id });
  return prisma.inventoryMovement.findUnique({ where: { id } });
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
export async function recomputeReserved(storeId?: string | null) {
  if (!storeId) return;
  const grouped = await prisma.inventoryMovement.groupBy({
    by: ['productId'],
    where: { status: 'PENDING', fromStoreId: storeId },
    _sum: { quantity: true },
  });
  const reservedByProduct = new Map(grouped.map((g) => [g.productId, g._sum.quantity ?? 0]));

  const items = await prisma.stockItem.findMany({ where: { storeId } });
  for (const item of items) {
    const reserved = reservedByProduct.get(item.productId) ?? 0;
    if (reserved !== item.reserved) {
      await prisma.stockItem.update({ where: { id: item.id }, data: { reserved } });
    }
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
