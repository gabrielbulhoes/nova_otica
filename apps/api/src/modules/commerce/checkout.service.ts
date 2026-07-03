import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest, HttpError, notFound, toNumber } from '../../http/helpers.js';
import { publish } from '../../lib/eventBus.js';
import {
  confirmMovementTx,
  createMovementTx,
  recomputeReserved,
  type Actor,
} from '../movements/movements.service.js';
import { getPaymentProvider, type PaymentMethod } from './payment.provider.js';
import { computeOrderTotals, lineTotal } from './commerce.math.js';

// Ações internas do sistema rodam com privilégio de rede.
const SYSTEM: Actor = { id: 'system', role: 'ADMIN', storeId: null };

function genOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  return `NO-${ts}-${rand}`;
}

/**
 * Regra pura de autorização de acesso a um pedido: ADMIN vê tudo; STORE_MANAGER
 * só vê pedidos da própria loja; o comprador vê o próprio pedido. Sem actor =
 * uso interno (sistema), sempre permitido.
 */
export function canAccessOrder(
  order: { storeId: string | null; userId: string | null },
  actor?: Actor,
): boolean {
  if (!actor || actor.role === 'ADMIN') return true;
  const ownsStore = !!order.storeId && order.storeId === actor.storeId;
  const ownsOrder = !!order.userId && order.userId === actor.id;
  return ownsStore || ownsOrder;
}

function assertOrderAccess(order: { storeId: string | null; userId: string | null }, actor?: Actor) {
  if (!canAccessOrder(order, actor)) throw new HttpError(403, 'Acesso negado a este pedido.');
}

export async function getOrderView(orderId: string, actor?: Actor) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } }, payment: true, store: true },
  });
  if (!order) throw notFound('Pedido não encontrado');
  assertOrderAccess(order, actor);
  return order;
}

/** Libera (cancela) as reservas SALE PENDING de um pedido, dentro de uma tx. */
async function releaseReservations(tx: Prisma.TransactionClient, orderId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { movementId: true } });
  for (const it of items) {
    if (!it.movementId) continue;
    // Guarda de status: só cancela o que ainda está reservado (PENDING).
    await tx.inventoryMovement.updateMany({
      where: { id: it.movementId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  }
}

/**
 * Fecha o carrinho aberto do usuário: reserva o estoque (movimentação SALE
 * PENDING por item) e cria o pedido, tudo em uma transação; só então abre o
 * pagamento no provedor. Se a abertura do pagamento falhar, o pedido é
 * cancelado e as reservas liberadas.
 */
export async function checkout(
  userId: string,
  opts: { method?: PaymentMethod; customerName?: string },
) {
  const cart = await prisma.cart.findFirst({
    where: { userId, status: 'OPEN' },
    include: { items: { include: { product: true } }, store: true },
  });
  if (!cart || cart.items.length === 0) throw badRequest('Carrinho vazio.');

  const lines = cart.items.map((it) => {
    const unitPrice = toNumber(it.product.price) ?? 0;
    return { productId: it.productId, quantity: it.quantity, unitPrice, total: lineTotal(unitPrice, it.quantity) };
  });
  const { subtotal, total } = computeOrderTotals(lines);
  const orderNumber = genOrderNumber();

  // 1) Reserva + pedido, atômicos. O claim condicional do carrinho
  //    (status OPEN -> CONVERTED) impede duplo-checkout concorrente.
  const order = await prisma.$transaction(async (tx) => {
    const claim = await tx.cart.updateMany({ where: { id: cart.id, status: 'OPEN' }, data: { status: 'CONVERTED' } });
    if (claim.count === 0) throw badRequest('Carrinho já finalizado.');

    const created = await tx.order.create({
      data: {
        number: orderNumber,
        userId,
        storeId: cart.storeId,
        customerName: opts.customerName ?? null,
        status: 'CREATED',
        subtotal,
        total,
        items: {
          create: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            total: l.total,
          })),
        },
      },
      include: { items: true },
    });

    // created.items é único por produto (@@unique cartId+productId). Ordena
    // por produto para manter estável a ordem dos advisory locks (anti-deadlock).
    const items = [...created.items].sort((a, b) => a.productId.localeCompare(b.productId));
    for (const item of items) {
      const movement = await createMovementTx(
        tx,
        { type: 'SALE', productId: item.productId, fromStoreId: cart.storeId, quantity: item.quantity, reference: orderNumber, confirm: false },
        'PENDING',
        SYSTEM.id,
      );
      await tx.orderItem.update({ where: { id: item.id }, data: { movementId: movement.id } });
    }
    return created;
  });
  await recomputeReserved(cart.storeId);

  // 2) Intent de pagamento APÓS a reserva garantida (evita cobrança órfã no
  //    gateway se a reserva falhasse). Se o intent falhar, cancela o pedido.
  try {
    const provider = getPaymentProvider();
    const intent = await provider.createPayment({ orderNumber, amount: total, method: opts.method });
    await prisma.onlinePayment.create({
      data: {
        orderId: order.id,
        provider: provider.name,
        method: intent.method,
        status: 'PENDING',
        amount: total,
        externalId: intent.externalId,
        qrCode: intent.qrCode ?? null,
      },
    });
  } catch (err) {
    await cancelOrder(order.id).catch(() => undefined);
    throw err;
  }

  publish({ type: 'order.changed', storeId: cart.storeId, orderId: order.id });
  return getOrderView(order.id);
}

/** Cancela um pedido ainda não pago e libera as reservas de estoque. Idempotente. */
export async function cancelOrder(orderId: string, actor?: Actor) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } });
  if (!order) throw notFound('Pedido não encontrado');
  assertOrderAccess(order, actor);
  if (order.status === 'CANCELLED') return getOrderView(orderId);
  if (order.status === 'PAID') throw badRequest('Pedido pago não pode ser cancelado.');

  await prisma.$transaction(async (tx) => {
    await releaseReservations(tx, orderId);
    if (order.payment) await tx.onlinePayment.updateMany({ where: { orderId }, data: { status: 'DECLINED' } });
    await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
  });

  await recomputeReserved(order.storeId);
  publish({ type: 'order.changed', storeId: order.storeId, orderId });
  return getOrderView(orderId);
}

/**
 * Confirma o pagamento (simula o webhook do gateway): aprova, marca o pedido
 * como PAGO e efetiva as reservas (baixa de estoque). Idempotente.
 */
export async function confirmPayment(orderId: string, actor?: Actor) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, payment: true },
  });
  if (!order) throw notFound('Pedido não encontrado');
  assertOrderAccess(order, actor);
  if (order.status === 'PAID') return getOrderView(orderId);
  if (!order.payment) throw badRequest('Pedido sem pagamento associado.');

  const provider = getPaymentProvider();
  const result = await provider.confirmPayment(order.payment.externalId ?? '');
  if (result.status !== 'APPROVED') {
    // Recusado: libera as reservas e cancela o pedido (senão o estoque fica
    // reservado para sempre — availableAt subtrai as reservas PENDING ao vivo).
    await prisma.$transaction(async (tx) => {
      await tx.onlinePayment.update({ where: { orderId }, data: { status: 'DECLINED' } });
      await releaseReservations(tx, orderId);
      await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
    });
    await recomputeReserved(order.storeId);
    publish({ type: 'order.changed', storeId: order.storeId, orderId });
    throw badRequest('Pagamento recusado pelo provedor.');
  }

  // Transação: efetiva a baixa de estoque ANTES de marcar PAID. Se a baixa
  // falhar, tudo reverte — o pedido não fica PAID sem a baixa correspondente.
  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      if (!item.movementId) continue;
      const mov = await tx.inventoryMovement.findUnique({ where: { id: item.movementId } });
      // Idempotente: só confirma o que ainda está reservado (PENDING).
      if (mov && mov.status === 'PENDING') await confirmMovementTx(tx, item.movementId);
    }
    await tx.onlinePayment.update({ where: { orderId }, data: { status: 'APPROVED' } });
    await tx.order.update({ where: { id: orderId }, data: { status: 'PAID', paidAt: new Date() } });
  });

  await recomputeReserved(order.storeId);
  publish({ type: 'order.changed', storeId: order.storeId, orderId });
  return getOrderView(orderId);
}

export async function listOrders(params: {
  storeId?: string;
  userId?: string;
  limit: number;
  skip: number;
}) {
  const where: Prisma.OrderWhereInput = {};
  if (params.storeId) where.storeId = params.storeId;
  if (params.userId) where.userId = params.userId;

  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { store: true, payment: true, _count: { select: { items: true } } },
      take: params.limit,
      skip: params.skip,
    }),
  ]);
  return { total, rows };
}
