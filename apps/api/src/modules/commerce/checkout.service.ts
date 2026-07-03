import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest, HttpError, notFound, toNumber } from '../../http/helpers.js';
import { publish } from '../../lib/eventBus.js';
import { confirmMovement, createMovement, type Actor } from '../movements/movements.service.js';
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

  const lines = cart.items.map((it) => {
    const unitPrice = toNumber(it.product.price) ?? 0;
    return { productId: it.productId, quantity: it.quantity, unitPrice, total: lineTotal(unitPrice, it.quantity) };
  });
  const { subtotal, total } = computeOrderTotals(lines);

  const order = await prisma.order.create({
    data: {
      number: genOrderNumber(),
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

  // Reserva de estoque por item (SALE PENDING). createMovement revalida o saldo.
  for (const item of order.items) {
    const movement = await createMovement(
      {
        type: 'SALE',
        productId: item.productId,
        fromStoreId: cart.storeId,
        quantity: item.quantity,
        reference: order.number,
        confirm: false,
      },
      SYSTEM,
    );
    await prisma.orderItem.update({ where: { id: item.id }, data: { movementId: movement.id } });
  }

  const provider = getPaymentProvider();
  const intent = await provider.createPayment({ orderNumber: order.number, amount: total, method: opts.method });
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

  await prisma.cart.update({ where: { id: cart.id }, data: { status: 'CONVERTED' } });
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

  await prisma.onlinePayment.update({ where: { orderId }, data: { status: 'APPROVED' } });
  await prisma.order.update({ where: { id: orderId }, data: { status: 'PAID', paidAt: new Date() } });

  // Efetiva as reservas → baixa de estoque ao vivo.
  for (const item of order.items) {
    if (!item.movementId) continue;
    try {
      await confirmMovement(item.movementId, SYSTEM);
    } catch {
      // reserva já confirmada/cancelada — ignora (idempotência).
    }
  }

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
