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
  // Loja zerada de propósito no beforeAll (e restaurada no afterAll): é ela
  // que garante necessidade > 0 sem o teste depender do humor do seed.
  let lojaZerada = '';
  let estoqueAnterior: number | null = null;
  // Pedido de uma peça que a rede NUNCA vendeu — o caso da reserva.
  let pedidoPecaNovaId = '';
  let pecaNovaId = '';

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

    // O rateio agora é por NECESSIDADE (falta até a cobertura-alvo), e
    // necessidade só existe onde há venda E falta estoque. Zeramos uma loja que
    // vendeu a peça para o caso comum ser deterministicamente 'necessidade' —
    // senão o teste passaria ou falharia conforme o estoque que o seed sorteou.
    const vendas = await prisma.saleItem.findMany({
      where: { productId, sale: { store: PLANNED_STORE_WHERE } },
      select: { quantity: true, sale: { select: { storeId: true } } },
    });
    const porLoja = new Map<string, number>();
    for (const v of vendas) {
      const sid = v.sale.storeId;
      if (sid) porLoja.set(sid, (porLoja.get(sid) ?? 0) + v.quantity);
    }
    lojaZerada = [...porLoja.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    if (lojaZerada) {
      const atual = await prisma.stockItem.findUnique({
        where: { storeId_productId: { storeId: lojaZerada, productId } },
      });
      estoqueAnterior = atual?.quantity ?? null;
      await prisma.stockItem.upsert({
        where: { storeId_productId: { storeId: lojaZerada, productId } },
        create: { storeId: lojaZerada, productId, quantity: 0, available: 0 },
        update: { quantity: 0, available: 0 },
      });
    }

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

    // Peça que a rede nunca vendeu: demanda zero em toda loja, logo alvo zero e
    // falta zero em toda loja. É o caso normal de um pedido de compra — modelo
    // recém-lançado — e é onde a escada de reserva tem que assumir.
    const pecaNova = await prisma.product.create({
      data: {
        externalId: `test-peca-nova-${Date.now()}`,
        description: 'ARMACAO PECA NOVA DE TESTE',
        category: (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).category,
      },
    });
    pecaNovaId = pecaNova.id;
    const recNova = await prisma.purchaseOrderRecord.create({
      data: {
        sentBy: admin.id,
        supplier: 'FORNECEDOR DE TESTE',
        leadTimeDays: 14,
        status: 'SENT',
        items: [{ productId: pecaNovaId, description: pecaNova.description, quantity: 37, unitCost: 100, total: 3700 }],
        units: 37,
        total: 3700,
      },
    });
    pedidoPecaNovaId = recNova.id;
  });

  afterAll(async () => {
    await prisma.inventoryMovement.deleteMany({ where: { fromStoreId: retaguardaId } });
    await prisma.purchaseOrderRecord.deleteMany({ where: { supplier: 'FORNECEDOR DE TESTE' } });
    if (pecaNovaId) {
      await prisma.stockItem.deleteMany({ where: { productId: pecaNovaId } });
      await prisma.product.delete({ where: { id: pecaNovaId } });
    }
    if (lojaZerada) {
      if (estoqueAnterior === null) {
        await prisma.stockItem.deleteMany({ where: { storeId: lojaZerada, productId } });
      } else {
        await prisma.stockItem.update({
          where: { storeId_productId: { storeId: lojaZerada, productId } },
          data: { quantity: estoqueAnterior, available: estoqueAnterior },
        });
      }
    }
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

  it('declara de qual base saiu o rateio — e o caso comum é a NECESSIDADE', async () => {
    // Este teste aceitava qualquer degrau da escada de participação
    // ('sku'|'marca'|'categoria'|'rede') porque era assim que o rateio saía: por
    // PARTICIPAÇÃO NAS VENDAS. O cliente pediu outra coisa — "de acordo com a
    // melhor chance de venda E OTIMIZAÇÃO DO ESTOQUE" —, e participação responde
    // só a primeira metade: quem vende mais leva mais, mesmo já abarrotada.
    // A régua passou a ser a falta até a cobertura-alvo, e a escada virou
    // reserva. A expectativa aperta em vez de afrouxar: com uma loja que vende a
    // peça e está zerada (ver beforeAll), a base TEM que ser 'necessidade'.
    const plano = await distributionPlan(orderId);
    const item = plano.items[0];
    expect(item.basis).toBe('necessidade');
    expect(item.totalNeed).toBeGreaterThan(0);
    expect(item.basisLabel).toBeTruthy();
    // A loja zerada que vende é a que mais precisa — e o rateio tem que
    // enxergar isso, que é exatamente o que a participação não enxergava.
    expect(item.rows.map((r) => r.storeId)).toContain(lojaZerada);
  });

  it('soma das necessidades = 0 cai na RESERVA por participação, e declara', async () => {
    // Peça nova: ninguém vendeu, então ninguém tem alvo, então ninguém tem
    // falta. A carga foi comprada e vai chegar de qualquer jeito — repartir por
    // quem vende é melhor do que empilhar na retaguarda. O que não pode é a
    // tela apresentar essa estimativa grossa com a mesma cara da necessidade.
    const plano = await distributionPlan(pedidoPecaNovaId);
    const item = plano.items[0];
    expect(item.totalNeed).toBe(0);
    expect(item.basis).not.toBe('necessidade');
    expect(['sku', 'marca', 'categoria', 'rede']).toContain(item.basis);
    expect(item.basisLabel).toBeTruthy();
    // Reserva ou não, a conta continua fechando.
    expect(item.rows.reduce((a, r) => a + r.quantity, 0) + plano.unassigned).toBe(37);
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
    const plano = await distributionPlan(orderId);
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    const r = await createDistributionMovements(orderId, retaguardaId, {
      id: admin.id,
      role: 'ADMIN',
      storeId: null,
    });

    // ANCORADO NO INVARIANTE, não no número de linhas. O rateio por
    // necessidade zera as lojas que já estão na cobertura-alvo — e elas
    // recebiam unidade por participação —, então o número de movimentações
    // MUDA com a régua e voltaria a mudar na próxima calibragem. O que não
    // pode mudar nunca é a conta: tudo o que foi comprado ou vira transferência
    // ou está declarado em `unassigned`. Unidade que evapora entre os dois é
    // estoque que ninguém procura.
    const previsto = plano.items.reduce(
      (a, i) => a + i.rows.reduce((s, linha) => s + linha.quantity, 0),
      0,
    );
    expect(r.units).toBe(previsto);
    expect(r.units + plano.unassigned).toBe(37);
    expect(r.created).toBe(plano.items.reduce((a, i) => a + i.rows.length, 0));

    const movs = await prisma.inventoryMovement.findMany({
      where: { id: { in: r.movementIds } },
    });
    expect(movs).toHaveLength(r.created);
    expect(movs.reduce((a, m) => a + m.quantity, 0)).toBe(previsto);
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
