import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest, HttpError, notFound, toNumber } from '../../http/helpers.js';
import { publish } from '../../lib/eventBus.js';
import {
  availableAt,
  cancelMovement,
  confirmMovement,
  createMovement,
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
 * Escopo de acesso ao pedido: ADMIN vê tudo; os demais só o próprio pedido
 * ou pedidos da própria loja (STORE_MANAGER com loja associada).
 */
function assertOrderAccess(order: { userId: string | null; storeId: string | null }, actor: Actor): void {
  if (actor.role === 'ADMIN') return;
  const isOwner = order.userId !== null && order.userId === actor.id;
  const sameStore = actor.storeId !== null && order.storeId === actor.storeId;
  if (!isOwner && !sameStore) {
    throw new HttpError(403, 'Você não tem acesso a este pedido.');
  }
}

export async function getOrderView(orderId: string, actor?: Actor) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } }, payment: true, store: true },
  });
  if (!order) throw notFound('Pedido não encontrado');
  if (actor) assertOrderAccess(order, actor);
  return order;
}

/**
 * Fecha o carrinho aberto do usuário: revalida a disponibilidade de todos os
 * itens, cria o pedido e reserva o estoque numa única transação e, por fim,
 * abre o pagamento no provedor (com compensação se o provedor falhar).
 */
export async function checkout(
  actor: Actor,
  opts: { method?: PaymentMethod; customerName?: string },
) {
  const cart = await prisma.cart.findFirst({
    where: { userId: actor.id, status: 'OPEN' },
    include: { items: { include: { product: true } }, store: true },
  });
  if (!cart || cart.items.length === 0) throw badRequest('Carrinho vazio.');

  // Revalida todos os itens antes de criar o pedido: itens antigos do
  // carrinho podem ter perdido saldo desde que foram adicionados.
  const insufficient: string[] = [];
  for (const it of cart.items) {
    const available = await availableAt(cart.storeId, it.productId);
    if (it.quantity > available) {
      insufficient.push(`${it.product.description} (disponível: ${available}, no carrinho: ${it.quantity})`);
    }
  }
  if (insufficient.length > 0) {
    throw badRequest(`Saldo insuficiente para finalizar o pedido: ${insufficient.join('; ')}.`);
  }

  const lines = cart.items.map((it) => {
    const unitPrice = toNumber(it.product.price) ?? 0;
    return { productId: it.productId, quantity: it.quantity, unitPrice, total: lineTotal(unitPrice, it.quantity) };
  });
  const { subtotal, total } = computeOrderTotals(lines);

  // Pedido + reservas + conversão do carrinho são um único passo atômico:
  // qualquer falha intermediária desfaz tudo (sem pedido órfão ou reserva solta).
  const order = await prisma.$transaction(async (tx) => {
    // Claim atômico do carrinho (OPEN -> CONVERTED) como PRIMEIRO passo: dois
    // checkouts concorrentes do mesmo carrinho (duplo-clique/duas abas) não
    // geram pedido nem reserva duplicados — o segundo falha aqui.
    const claim = await tx.cart.updateMany({
      where: { id: cart.id, status: 'OPEN' },
      data: { status: 'CONVERTED' },
    });
    if (claim.count === 0) throw badRequest('Carrinho já finalizado.');

    const created = await tx.order.create({
      data: {
        number: genOrderNumber(),
        userId: actor.id,
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

    // Reserva por item (SALE PENDING), em ordem estável de produto para os
    // advisory locks nunca serem adquiridos em ordens opostas (anti-deadlock
    // entre checkouts concorrentes de carrinhos com produtos em comum).
    const items = [...created.items].sort((a, b) => a.productId.localeCompare(b.productId));
    for (const item of items) {
      const movement = await createMovement(
        {
          type: 'SALE',
          productId: item.productId,
          fromStoreId: cart.storeId,
          quantity: item.quantity,
          reference: created.number,
          confirm: false,
        },
        SYSTEM,
        tx,
      );
      await tx.orderItem.update({ where: { id: item.id }, data: { movementId: movement.id } });
    }

    return created;
  });

  // O intent nasce depois das reservas: se o provedor falhar, compensa
  // (cancela reservas e pedido, reabre o carrinho) — sem intent órfão.
  const provider = getPaymentProvider();
  try {
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
  } catch {
    await cancelCheckout(order.id, cart.id);
    throw badRequest('Falha ao abrir o pagamento no provedor. Tente novamente.');
  }

  publish({ type: 'order.changed', storeId: cart.storeId, orderId: order.id });
  return getOrderView(order.id, actor);
}

/**
 * Libera (cancela) as reservas PENDING de um pedido. Usa cancelMovement para
 * manter a coluna denormalizada `reserved` consistente (availableAt depende
 * dela). Reservas já efetivadas/canceladas são puladas (idempotência).
 */
async function releaseReservations(orderId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<void> {
  const items = await db.orderItem.findMany({ where: { orderId }, select: { movementId: true } });
  for (const it of items) {
    if (!it.movementId) continue;
    try {
      await cancelMovement(it.movementId, SYSTEM, db);
    } catch {
      // reserva já cancelada/efetivada — segue com as demais.
    }
  }
}

/** Compensação do checkout: cancela reservas e pedido, reabre o carrinho. */
async function cancelCheckout(orderId: string, cartId: string): Promise<void> {
  await releaseReservations(orderId);
  await prisma.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
  await prisma.cart.update({ where: { id: cartId }, data: { status: 'OPEN' } });
}

/** Cancela um pedido ainda não pago e libera as reservas de estoque. Idempotente. */
export async function cancelOrder(orderId: string, actor?: Actor) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } });
  if (!order) throw notFound('Pedido não encontrado');
  if (actor) assertOrderAccess(order, actor);
  if (order.status === 'CANCELLED') return getOrderView(orderId, actor);
  if (order.status === 'PAID') throw badRequest('Pedido pago não pode ser cancelado.');

  await prisma.$transaction(async (tx) => {
    await releaseReservations(orderId, tx);
    if (order.payment) await tx.onlinePayment.updateMany({ where: { orderId }, data: { status: 'DECLINED' } });
    await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
  });

  publish({ type: 'order.changed', storeId: order.storeId, orderId });
  return getOrderView(orderId, actor);
}

/**
 * Confirma o pagamento (simula o webhook do gateway): aprova no provedor e,
 * numa única transação, efetiva todas as reservas e marca o pedido como PAGO —
 * o status PAID só é gravado se todas as baixas de estoque forem efetivadas.
 * Idempotente.
 */
export async function confirmPayment(orderId: string, actor?: Actor) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, payment: true },
  });
  if (!order) throw notFound('Pedido não encontrado');
  if (actor) assertOrderAccess(order, actor);
  if (order.status === 'PAID') return getOrderView(orderId, actor);
  if (!order.payment) throw badRequest('Pedido sem pagamento associado.');

  const provider = getPaymentProvider();
  const result = await provider.confirmPayment(order.payment.externalId ?? '');
  if (result.status !== 'APPROVED') {
    // Recusado: além de marcar DECLINED, libera as reservas e cancela o
    // pedido — sem isso o estoque ficaria retido para sempre (availableAt
    // desconta as reservas PENDING via coluna `reserved`).
    await prisma.$transaction(async (tx) => {
      await tx.onlinePayment.update({ where: { orderId }, data: { status: 'DECLINED' } });
      await releaseReservations(orderId, tx);
      await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
    });
    publish({ type: 'order.changed', storeId: order.storeId, orderId });
    throw badRequest('Pagamento recusado pelo provedor.');
  }

  await prisma.$transaction(async (tx) => {
    // Efetiva as reservas → baixa de estoque ao vivo. Reservas já confirmadas
    // são puladas (idempotência); qualquer outra falha desfaz a transação e o
    // pedido permanece não pago.
    for (const item of order.items) {
      if (!item.movementId) continue;
      const mov = await tx.inventoryMovement.findUnique({ where: { id: item.movementId } });
      if (mov?.status !== 'PENDING') continue;
      await confirmMovement(item.movementId, SYSTEM, tx);
    }
    await tx.onlinePayment.update({ where: { orderId }, data: { status: 'APPROVED' } });
    await tx.order.update({ where: { id: orderId }, data: { status: 'PAID', paidAt: new Date() } });
  });

  publish({ type: 'order.changed', storeId: order.storeId, orderId });
  return getOrderView(orderId, actor);
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
