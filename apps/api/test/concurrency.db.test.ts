import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import {
  approveMovement,
  availableAt,
  confirmMovement,
  createMovement,
  type Actor,
} from '../src/modules/movements/movements.service.js';
import { cancelOrder, checkout } from '../src/modules/commerce/checkout.service.js';

/**
 * Testes de concorrência REAIS (precisam de um PostgreSQL). Rodam apenas quando
 * RUN_DB_TESTS=1 (ex.: na CI com um serviço de banco). O `npm test` normal os
 * pula, mantendo a suíte unitária sem dependência de infraestrutura.
 */
const RUN = process.env.RUN_DB_TESTS === '1';
const SYSTEM: Actor = { id: 'system-test', role: 'ADMIN', storeId: null };

describe.skipIf(!RUN)('concorrência de estoque (integração com Postgres)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function scenario(quantity: number) {
    const store = await prisma.store.findFirst();
    const product = await prisma.product.findFirst();
    if (!store || !product) throw new Error('sem dados de teste (rode o seed)');
    const storeId = store.id;
    const productId = product.id;
    await prisma.inventoryMovement.deleteMany({
      where: { productId, OR: [{ fromStoreId: storeId }, { toStoreId: storeId }] },
    });
    await prisma.stockItem.upsert({
      where: { storeId_productId: { storeId, productId } },
      create: { storeId, productId, quantity, reserved: 0 },
      update: { quantity, reserved: 0 },
    });
    return { storeId, productId };
  }

  async function testUser() {
    return prisma.user.upsert({
      where: { email: 'concurrency-test@local' },
      create: { email: 'concurrency-test@local', name: 'Teste', passwordHash: 'x', role: 'ADMIN' },
      update: {},
    });
  }

  async function cleanCommerce(userId: string) {
    const orders = await prisma.order.findMany({ where: { userId }, select: { id: true } });
    const ids = orders.map((o) => o.id);
    await prisma.onlinePayment.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });
    await prisma.cart.deleteMany({ where: { userId } });
  }

  it('impede oversell: 8 reservas simultâneas de 1 unidade → só 1 vence', async () => {
    const { storeId, productId } = await scenario(1);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        createMovement({ type: 'SALE', productId, fromStoreId: storeId, quantity: 1, confirm: false }, SYSTEM),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(1);
    expect(await availableAt(storeId, productId)).toBe(0);
    await prisma.inventoryMovement.deleteMany({ where: { productId, fromStoreId: storeId } });
  });

  it('guarda de status: 3 confirmações simultâneas do mesmo movimento → só 1 vence', async () => {
    const { storeId, productId } = await scenario(10);
    const mov = await createMovement(
      { type: 'SALE', productId, fromStoreId: storeId, quantity: 1, confirm: false },
      SYSTEM,
    );
    const results = await Promise.allSettled([
      confirmMovement(mov.id, SYSTEM),
      confirmMovement(mov.id, SYSTEM),
      confirmMovement(mov.id, SYSTEM),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(1);
    const fresh = await prisma.inventoryMovement.findUnique({ where: { id: mov.id } });
    expect(fresh?.status).toBe('CONFIRMED');
    await prisma.inventoryMovement.deleteMany({ where: { productId, fromStoreId: storeId } });
  });

  it('aprovar transferência sob lock não causa oversell vs reserva concorrente', async () => {
    const store2 = (await prisma.store.findMany({ take: 2 }))[1];
    const { storeId, productId } = await scenario(1);
    const manager: Actor = { id: 'system-test', role: 'STORE_MANAGER', storeId };
    const transfer = await createMovement(
      { type: 'TRANSFER', productId, fromStoreId: storeId, toStoreId: store2.id, quantity: 1 },
      manager,
    );
    const results = await Promise.allSettled([
      approveMovement(transfer.id, SYSTEM),
      createMovement({ type: 'SALE', productId, fromStoreId: storeId, quantity: 1, confirm: false }, SYSTEM),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(1);
    expect(await availableAt(storeId, productId)).toBe(0);
    await prisma.inventoryMovement.deleteMany({
      where: { productId, OR: [{ fromStoreId: storeId }, { toStoreId: storeId }] },
    });
  });

  it('duplo checkout do mesmo carrinho gera apenas 1 pedido/reserva', async () => {
    const { storeId, productId } = await scenario(5);
    const user = await testUser();
    const buyer: Actor = { id: user.id, role: 'ADMIN', storeId: null };
    await cleanCommerce(user.id);
    await prisma.cart.create({
      data: { userId: user.id, storeId, status: 'OPEN', items: { create: [{ productId, quantity: 1 }] } },
    });

    const results = await Promise.allSettled([checkout(buyer, {}), checkout(buyer, {})]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(1); // o 2º perde o claim do carrinho e falha
    expect(await availableAt(storeId, productId)).toBe(4); // reservado só 1× (não 2×)

    await cleanCommerce(user.id);
    await prisma.inventoryMovement.deleteMany({ where: { productId, fromStoreId: storeId } });
  });

  it('cancelar pedido libera a reserva de estoque', async () => {
    const { storeId, productId } = await scenario(5);
    const user = await testUser();
    const buyer: Actor = { id: user.id, role: 'ADMIN', storeId: null };
    await cleanCommerce(user.id);
    await prisma.cart.create({
      data: { userId: user.id, storeId, status: 'OPEN', items: { create: [{ productId, quantity: 2 }] } },
    });

    const order = await checkout(buyer, {});
    expect(await availableAt(storeId, productId)).toBe(3); // 5 - 2 reservados
    await cancelOrder(order.id);
    expect(await availableAt(storeId, productId)).toBe(5); // reserva liberada

    await cleanCommerce(user.id);
    await prisma.inventoryMovement.deleteMany({ where: { productId, fromStoreId: storeId } });
  });
});
