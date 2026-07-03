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

/**
 * Fecha o carrinho aberto do usuário: cria o pedido, reserva o estoque
 * (movimentação SALE PENDING por item) e abre o pagamento no provedor.
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

  // Ordena por produto: locks sempre adquiridos na mesma ordem (anti-deadlock).
  const lines = cart.items
    .map((it) => {
      const unitPrice = toNumber(it.product.price) ?? 0;
      return { productId: it.productId, quantity: it.quantity, unitPrice, total: lineTotal(unitPrice, it.quantity) };
    })
    .sort((a, b) => a.productId.localeCompare(b.productId));
  const { subtotal, total } = computeOrderTotals(lines);

  // Intent de pagamento fora da transação (no gateway real é I/O de rede).
  const provider = getPaymentProvider();
  const orderNumber = genOrderNumber();
  const intent = await provider.createPayment({ orderNumber, amount: total, method: opts.method });

  // Transação única: pedido + reservas (com validação de saldo sob lock) +
  // pagamento + baixa do carrinho. Falha em qualquer passo reverte tudo.
  const order = await prisma.$transaction(async (tx) => {
    const stillOpen = await tx.cart.findFirst({ where: { id: cart.id, status: 'OPEN' } });
    if (!stillOpen) throw badRequest('Carrinho já finalizado.');

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

    // Reserva por item (SALE PENDING) validando saldo sob advisory lock.
    for (const l of lines) {
      const orderItem = created.items.find((i) => i.productId === l.productId && !i.movementId);
      const movement = await createMovementTx(
        tx,
        { type: 'SALE', productId: l.productId, fromStoreId: cart.storeId, quantity: l.quantity, reference: orderNumber, confirm: false },
        'PENDING',
        SYSTEM.id,
      );
      if (orderItem) await tx.orderItem.update({ where: { id: orderItem.id }, data: { movementId: movement.id } });
    }

    await tx.onlinePayment.create({
      data: {
        orderId: created.id,
        provider: provider.name,
        method: intent.method,
        status: 'PENDING',
        amount: total,
        externalId: intent.externalId,
        qrCode: intent.qrCode ?? null,
      },
    });
    await tx.cart.update({ where: { id: cart.id }, data: { status: 'CONVERTED' } });
    return created;
  });

  await recomputeReserved(cart.storeId);
  publish({ type: 'order.changed', storeId: cart.storeId, orderId: order.id });

  return getOrderView(order.id);
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
    await prisma.onlinePayment.update({ where: { orderId }, data: { status: 'DECLINED' } });
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
