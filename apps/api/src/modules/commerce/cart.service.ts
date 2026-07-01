import { prisma } from '../../lib/prisma.js';
import { badRequest, notFound, toNumber } from '../../http/helpers.js';
import { availableAt } from '../movements/movements.service.js';
import { computeOrderTotals, lineTotal } from './commerce.math.js';

async function openCart(userId: string) {
  return prisma.cart.findFirst({ where: { userId, status: 'OPEN' }, include: { items: true } });
}

export interface CartView {
  cartId: string | null;
  storeId: string | null;
  storeName: string | null;
  items: {
    productId: string;
    description: string;
    unitPrice: number;
    quantity: number;
    total: number;
    available: number;
  }[];
  subtotal: number;
  total: number;
}

/** Estado atual do carrinho aberto do usuário, com disponibilidade ao vivo. */
export async function getCartView(userId: string): Promise<CartView> {
  const cart = await prisma.cart.findFirst({
    where: { userId, status: 'OPEN' },
    include: { items: { include: { product: true } }, store: true },
  });
  if (!cart) return { cartId: null, storeId: null, storeName: null, items: [], subtotal: 0, total: 0 };

  const items = await Promise.all(
    cart.items.map(async (it) => {
      const unitPrice = toNumber(it.product.price) ?? 0;
      return {
        productId: it.productId,
        description: it.product.description,
        unitPrice,
        quantity: it.quantity,
        total: lineTotal(unitPrice, it.quantity),
        available: await availableAt(cart.storeId, it.productId),
      };
    }),
  );
  const { subtotal, total } = computeOrderTotals(items.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity })));
  return { cartId: cart.id, storeId: cart.storeId, storeName: cart.store.name, items, subtotal, total };
}

export async function addItem(
  userId: string,
  input: { productId: string; storeId: string; quantity: number },
): Promise<CartView> {
  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product) throw notFound('Produto não encontrado');
  const store = await prisma.store.findUnique({ where: { id: input.storeId } });
  if (!store) throw notFound('Loja não encontrada');

  let cart = await openCart(userId);
  if (cart && cart.storeId !== input.storeId) {
    throw badRequest('Seu carrinho é de outra loja. Finalize ou limpe antes de trocar de loja.');
  }
  if (!cart) {
    cart = await prisma.cart.create({ data: { userId, storeId: input.storeId }, include: { items: true } });
  }

  const existing = cart.items.find((i) => i.productId === input.productId);
  const desiredQty = (existing?.quantity ?? 0) + input.quantity;
  const available = await availableAt(input.storeId, input.productId);
  if (desiredQty > available) throw badRequest(`Saldo insuficiente (disponível: ${available}, no carrinho: ${desiredQty}).`);

  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId: input.productId } },
    create: { cartId: cart.id, productId: input.productId, quantity: input.quantity },
    update: { quantity: desiredQty },
  });
  return getCartView(userId);
}

export async function setItemQuantity(userId: string, productId: string, quantity: number): Promise<CartView> {
  const cart = await openCart(userId);
  if (!cart) throw notFound('Carrinho vazio');
  if (quantity <= 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
  } else {
    const available = await availableAt(cart.storeId, productId);
    if (quantity > available) throw badRequest(`Saldo insuficiente (disponível: ${available}).`);
    await prisma.cartItem.update({
      where: { cartId_productId: { cartId: cart.id, productId } },
      data: { quantity },
    });
  }
  return getCartView(userId);
}

export async function removeItem(userId: string, productId: string): Promise<CartView> {
  const cart = await openCart(userId);
  if (cart) await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
  return getCartView(userId);
}

export async function clearCart(userId: string): Promise<CartView> {
  const cart = await openCart(userId);
  if (cart) await prisma.cart.update({ where: { id: cart.id }, data: { status: 'ABANDONED' } });
  return getCartView(userId);
}
