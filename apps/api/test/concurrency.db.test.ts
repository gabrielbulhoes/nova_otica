import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import {
  availableAt,
  confirmMovement,
  createMovement,
  type Actor,
} from '../src/modules/movements/movements.service.js';

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
});
