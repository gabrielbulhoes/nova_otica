import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { badRequest, notFound } from '../../http/helpers.js';

export const createMovementSchema = z
  .object({
    type: z.enum(['TRANSFER', 'SALE', 'ADJUSTMENT', 'RETURN']),
    productId: z.string().min(1),
    fromStoreId: z.string().min(1).optional(),
    toStoreId: z.string().min(1).optional(),
    quantity: z.number().int().positive(),
    reason: z.string().max(280).optional(),
    reference: z.string().max(120).optional(),
    createdBy: z.string().max(120).optional(),
    /** Confirma imediatamente (efetiva no estoque ao vivo). */
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

/** Saldo disponível ao vivo na loja de origem (synced + delta confirmado - reservado). */
async function availableAt(storeId: string, productId: string): Promise<number> {
  const item = await prisma.stockItem.findUnique({
    where: { storeId_productId: { storeId, productId } },
  });
  const synced = item?.quantity ?? 0;
  const reserved = item?.reserved ?? 0;

  const inbound = await prisma.inventoryMovement.aggregate({
    where: { status: 'CONFIRMED', toStoreId: storeId, productId },
    _sum: { quantity: true },
  });
  const outbound = await prisma.inventoryMovement.aggregate({
    where: { status: 'CONFIRMED', fromStoreId: storeId, productId },
    _sum: { quantity: true },
  });
  const delta = (inbound._sum.quantity ?? 0) - (outbound._sum.quantity ?? 0);
  return synced + delta - reserved;
}

export async function createMovement(input: CreateMovementInput) {
  await ensureRefs(input);

  if (input.fromStoreId) {
    const available = await availableAt(input.fromStoreId, input.productId);
    if (input.quantity > available) {
      throw badRequest(
        `Saldo insuficiente na origem (disponível: ${available}, solicitado: ${input.quantity}).`,
      );
    }
  }

  const movement = await prisma.inventoryMovement.create({
    data: {
      type: input.type,
      status: input.confirm ? 'CONFIRMED' : 'PENDING',
      productId: input.productId,
      fromStoreId: input.fromStoreId ?? null,
      toStoreId: input.toStoreId ?? null,
      quantity: input.quantity,
      reason: input.reason ?? null,
      reference: input.reference ?? null,
      createdBy: input.createdBy ?? null,
      confirmedAt: input.confirm ? new Date() : null,
    },
  });

  await recomputeReserved(input.fromStoreId);
  return movement;
}

export async function confirmMovement(id: string) {
  const mov = await prisma.inventoryMovement.findUnique({ where: { id } });
  if (!mov) throw notFound('Movimentação não encontrada');
  if (mov.status !== 'PENDING') throw badRequest(`Movimentação não está pendente (${mov.status}).`);

  const updated = await prisma.inventoryMovement.update({
    where: { id },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
  });
  await recomputeReserved(mov.fromStoreId);
  return updated;
}

export async function cancelMovement(id: string) {
  const mov = await prisma.inventoryMovement.findUnique({ where: { id } });
  if (!mov) throw notFound('Movimentação não encontrada');
  if (mov.status === 'RECONCILED') throw badRequest('Movimentação já reconciliada não pode ser cancelada.');

  const updated = await prisma.inventoryMovement.update({
    where: { id },
    data: { status: 'CANCELLED' },
  });
  await recomputeReserved(mov.fromStoreId);
  return updated;
}

/** Recalcula a reserva (saídas PENDING) de uma loja específica. */
async function recomputeReserved(storeId?: string | null) {
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
