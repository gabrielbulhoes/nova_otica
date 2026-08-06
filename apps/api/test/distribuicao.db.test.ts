import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import {
  createDistributionMovements,
  distributionPlan,
  receivingUnits,
} from '../src/modules/planning/distribution.service.js';
import { PLANNED_STORE_WHERE } from '../src/modules/stores/store.scope.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * Feedback 6.0 · item 06 — o pedido chegava e ninguém dizia para onde mandar.
 *
 * O que só aparece contra o banco: se a soma do rateio fecha com a compra, se
 * as transferências saem pelo caminho que reserva saldo, e se o plano recusa
 * distribuir mercadoria que ainda não chegou.
 */
d('distribuição do recebimento (integração com Postgres)', () => {
  let orderId = '';
  let retaguardaId = '';
  let productId = '';
  let criouRetaguarda = false;

  beforeAll(async () => {
    const lojas = await prisma.store.findMany({ where: PLANNED_STORE_WHERE, take: 4 });
    if (lojas.length < 2) throw new Error('sem lojas suficientes no banco (rode o seed)');

    // Uma unidade de retaguarda tem que existir para a carga ter de onde sair.
    const retaguarda = await prisma.store.findFirst({
      where: { excludeFromPlanning: true, externalErp: false },
    });
    if (retaguarda) {
      retaguardaId = retaguarda.id;
    } else {
      const nova = await prisma.store.create({
        data: {
          externalId: `test-cd-${Date.now()}`,
          name: 'CD DE TESTE',
          excludeFromPlanning: true,
        },
      });
      retaguardaId = nova.id;
      criouRetaguarda = true;
    }

    // Um produto que a rede vendeu — senão o rateio cai no degrau da rede e o
    // teste deixaria de cobrir o caminho que interessa.
    const comVenda = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: { productId: { not: null } },
      _sum: { quantity: true },
    });
    const maisVendido = comVenda.sort(
      (a, b) => (b._sum.quantity ?? 0) - (a._sum.quantity ?? 0),
    )[0];
    productId = (maisVendido?.productId as string) ?? (await prisma.product.findFirstOrThrow()).id;

    // A carga precisa estar NA retaguarda: `createMovement` valida saldo.
    await prisma.stockItem.upsert({
      where: { storeId_productId: { storeId: retaguardaId, productId } },
      create: { storeId: retaguardaId, productId, quantity: 500, available: 500 },
      update: { quantity: 500, available: 500 },
    });

    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    const rec = await prisma.purchaseOrderRecord.create({
      data: {
        sentBy: admin.id,
        supplier: 'FORNECEDOR DE TESTE',
        leadTimeDays: 14,
        status: 'SENT',
        items: [{ productId, description: 'peça de teste', quantity: 37, unitCost: 100, total: 3700 }],
        units: 37,
        total: 3700,
      },
    });
    orderId = rec.id;
  });

  afterAll(async () => {
    await prisma.inventoryMovement.deleteMany({ where: { fromStoreId: retaguardaId } });
    await prisma.purchaseOrderRecord.deleteMany({ where: { supplier: 'FORNECEDOR DE TESTE' } });
    if (criouRetaguarda) {
      await prisma.stockItem.deleteMany({ where: { storeId: retaguardaId } });
      await prisma.store.delete({ where: { id: retaguardaId } });
    }
  });

  it('o rateio soma EXATAMENTE a quantidade comprada', async () => {
    // 37 é primo de propósito: divisão proporcional entre lojas nunca dá
    // inteiro, e é aí que o método dos maiores restos precisa fechar a conta.
    // Unidade que evapora no arredondamento é estoque que ninguém procura.
    const plano = await distributionPlan(orderId);
    const item = plano.items[0];
    const soma = item.rows.reduce((a, r) => a + r.quantity, 0);
    expect(soma + plano.unassigned).toBe(37);
  });

  it('nenhuma linha manda mercadoria para a retaguarda', async () => {
    // A retaguarda é a ORIGEM. Ela está fora do escopo planejável, então nem
    // deveria aparecer — mas o rateio é onde isso se verifica de verdade.
    const plano = await distributionPlan(orderId);
    for (const item of plano.items) {
      expect(item.rows.map((r) => r.storeId)).not.toContain(retaguardaId);
    }
  });

  it('declara de qual base saiu o rateio', async () => {
    const plano = await distributionPlan(orderId);
    expect(['sku', 'marca', 'categoria', 'rede']).toContain(plano.items[0].basis);
    expect(plano.items[0].basisLabel).toBeTruthy();
  });

  it('recusa distribuir antes do recebimento confirmado', async () => {
    // Criar transferência de mercadoria que ainda está com o fornecedor
    // reservaria saldo que não existe.
    await expect(
      createDistributionMovements(orderId, retaguardaId, { id: 'u', role: 'ADMIN', storeId: null }),
    ).rejects.toThrow(/recebimento/i);
  });

  it('depois do recebimento, cria as transferências e reserva o saldo', async () => {
    await prisma.purchaseOrderRecord.update({
      where: { id: orderId },
      data: { status: 'RECEIVED', receivedAt: new Date() },
    });
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    const r = await createDistributionMovements(orderId, retaguardaId, {
      id: admin.id,
      role: 'ADMIN',
      storeId: null,
    });
    expect(r.created).toBeGreaterThan(0);
    expect(r.units).toBeGreaterThan(0);

    const movs = await prisma.inventoryMovement.findMany({
      where: { id: { in: r.movementIds } },
    });
    expect(movs).toHaveLength(r.created);
    for (const m of movs) {
      expect(m.type).toBe('TRANSFER');
      expect(m.fromStoreId).toBe(retaguardaId);
      // PENDING, não CONFIRMED: a mercadoria ainda vai sair fisicamente da
      // retaguarda, e quem confirma é quem despacha.
      expect(m.status).toBe('PENDING');
      expect(m.reason).toContain('Distribuição do pedido');
    }

    // O caminho pelo serviço de movimentação é o que recalcula a reserva. Se
    // alguém trocar por um `create` cru, o saldo reservado para de existir e o
    // mesmo estoque é prometido a duas lojas.
    const pos = await prisma.stockItem.findUnique({
      where: { storeId_productId: { storeId: retaguardaId, productId } },
    });
    expect(pos?.reserved ?? 0).toBeGreaterThan(0);
  });

  it('as unidades de recebimento são só as de retaguarda, nunca as em outro ERP', async () => {
    const { rows } = await receivingUnits();
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(retaguardaId);
    const foraDoErp = await prisma.store.findMany({ where: { externalErp: true } });
    for (const l of foraDoErp) expect(ids).not.toContain(l.id);
  });
});
