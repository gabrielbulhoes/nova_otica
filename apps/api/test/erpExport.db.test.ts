import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { exportPaidOrdersToErp } from '../src/modules/commerce/erpExport.service.js';
import type { CdsInserirVendaPayload, SellbieClient } from '../src/integrations/sellbie/index.js';

/**
 * Semântica de outbox do write-back contra Postgres REAL (RUN_DB_TESTS=1):
 * claim atômico, retry de falha registrada, exclusão dos envios
 * interrompidos e teto de tentativas.
 */
const RUN = process.env.RUN_DB_TESTS === '1';

/** Cliente falso: só inserirVenda importa aqui. */
function fakeClient(behavior: (p: CdsInserirVendaPayload) => Promise<unknown>): {
  client: SellbieClient;
  sent: CdsInserirVendaPayload[];
} {
  const sent: CdsInserirVendaPayload[] = [];
  const client = {
    inserirVenda: async (p: CdsInserirVendaPayload) => {
      const r = await behavior(p);
      sent.push(p);
      return r;
    },
  } as unknown as SellbieClient;
  return { client, sent };
}

describe.skipIf(!RUN)('write-back ao ERP (outbox contra Postgres)', () => {
  let storeId = '';
  let productId = '';
  const created: string[] = [];

  beforeAll(async () => {
    const store = await prisma.store.findFirst();
    const product = await prisma.product.findFirst();
    if (!store || !product) throw new Error('sem dados de teste (rode o seed)');
    storeId = store.id;
    productId = product.id;
    // Blindagem: pedidos PAGOS pré-existentes (seed/outros testes) saem da
    // fila para os contadores deste teste serem determinísticos. Sentinela
    // = epoch; a restauração é o inverso exato (não toca erro/tentativas).
    await prisma.order.updateMany({
      where: { status: 'PAID', erpExportedAt: null },
      data: { erpExportedAt: new Date(0) },
    });
  });

  afterAll(async () => {
    await prisma.orderItem.deleteMany({ where: { orderId: { in: created } } });
    await prisma.order.deleteMany({ where: { id: { in: created } } });
    await prisma.order.updateMany({
      where: { erpExportedAt: new Date(0) },
      data: { erpExportedAt: null },
    });
    await prisma.$disconnect();
  });

  async function paidOrder(number: string): Promise<string> {
    const order = await prisma.order.create({
      data: {
        number,
        storeId,
        status: 'PAID',
        paidAt: new Date(),
        subtotal: 100,
        total: 100,
        items: { create: [{ productId, quantity: 1, unitPrice: 100, total: 100 }] },
      },
    });
    created.push(order.id);
    return order.id;
  }

  it('exporta pedido pago uma única vez (sucesso carimba e nunca reenvia)', async () => {
    const id = await paidOrder('TB-OK-001');
    const { client, sent } = fakeClient(async () => ({ ok: true }));

    const r1 = await exportPaidOrdersToErp(client);
    expect(r1.written).toBe(1);
    expect(sent.map((p) => p.pedidoSite)).toEqual(['TB-OK-001']);

    const after = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(after.erpExportedAt).not.toBeNull();
    expect(after.erpExportError).toBeNull();
    expect(after.erpExportAttempts).toBe(1);

    const r2 = await exportPaidOrdersToErp(client);
    expect(r2.read).toBe(0); // fila vazia — não reenvia
    expect(sent).toHaveLength(1);
  });

  it('rejeição respondida permite retry; sucesso posterior limpa o erro', async () => {
    const id = await paidOrder('TB-FAIL-001');
    const { client: bad } = fakeClient(async () => {
      throw new Error('ERP recusou: funcionario inexistente');
    });

    const r1 = await exportPaidOrdersToErp(bad);
    expect(r1.failed).toBe(1);
    expect(r1.error).toMatch(/1 pedido\(s\) falharam/);
    let row = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(row.erpExportedAt).toBeNull();
    expect(row.erpExportError).toContain('funcionario inexistente');
    expect(row.erpExportAttempts).toBe(1);

    const { client: good } = fakeClient(async () => ({ ok: true }));
    const r2 = await exportPaidOrdersToErp(good);
    expect(r2.written).toBe(1);
    row = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(row.erpExportedAt).not.toBeNull();
    expect(row.erpExportError).toBeNull();
    expect(row.erpExportAttempts).toBe(2);
  });

  it('timeout SEM resposta é ambíguo: vira interrompido e não reenvia sozinho', async () => {
    const id = await paidOrder('TB-TIMEOUT-001');
    const { client: flaky } = fakeClient(async () => {
      // Erro no formato do axios sem response — request enviada, resposta perdida.
      const err = new Error('timeout of 30000ms exceeded') as Error & { isAxiosError: boolean };
      err.isAxiosError = true;
      throw err;
    });

    const r1 = await exportPaidOrdersToErp(flaky);
    expect(r1.failed).toBe(1); // visível no alerta…
    const row = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(row.erpExportError).toBeNull(); // …mas SEM erro gravado: estado interrompido
    expect(row.erpExportAttemptedAt).not.toBeNull();
    expect(row.erpExportedAt).toBeNull();

    const { client: good, sent } = fakeClient(async () => ({ ok: true }));
    const auto = await exportPaidOrdersToErp(good);
    expect(auto.read).toBe(0); // fila automática não o reenvia
    expect(sent).toHaveLength(0);

    const manual = await exportPaidOrdersToErp(good, { retryStuck: true });
    expect(manual.written).toBe(1); // só após decisão humana
  });

  it('envio interrompido (claim sem desfecho) NÃO reenvia sozinho — só com retryStuck', async () => {
    const id = await paidOrder('TB-STUCK-001');
    // Simula crash entre o POST e o carimbo: tentativa marcada, sem erro.
    await prisma.order.update({
      where: { id },
      data: { erpExportAttemptedAt: new Date(), erpExportAttempts: 1 },
    });

    const { client, sent } = fakeClient(async () => ({ ok: true }));
    const auto = await exportPaidOrdersToErp(client);
    expect(auto.read).toBe(0); // ambíguo: não entra na fila automática
    expect(sent).toHaveLength(0);

    const manual = await exportPaidOrdersToErp(client, { retryStuck: true });
    expect(manual.written).toBe(1);
    expect(sent.map((p) => p.pedidoSite)).toEqual(['TB-STUCK-001']);
  });

  it('teto de tentativas tira o pedido "veneno" da fila automática', async () => {
    const id = await paidOrder('TB-POISON-001');
    await prisma.order.update({
      where: { id },
      data: { erpExportAttemptedAt: new Date(), erpExportAttempts: 5, erpExportError: 'sempre 400' },
    });

    const { client, sent } = fakeClient(async () => ({ ok: true }));
    const r = await exportPaidOrdersToErp(client);
    expect(r.read).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
