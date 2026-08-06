import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { backfillSalesHistory, SyncInProgressError } from '../src/sync/syncService.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * A carga histórica tem dois comportamentos que só aparecem em execução real:
 * onde ela PARA, e o que acontece quando duas rodam ao mesmo tempo.
 *
 * O segundo não é hipotético — aconteceu em 06/08/2026, com dois deadlocks do
 * Postgres. `syncPayments` reescreve a janela (apaga e recria), então a corrida
 * pode deixar um mês sem pagamento nenhum, e nada acusa.
 */
d('backfill (integração com Postgres)', () => {
  afterEach(async () => {
    await prisma.syncRun.deleteMany({ where: { entity: 'backfill' } });
  });

  it("modo 'tudo': para sozinho onde o histórico acaba", async () => {
    const r = await backfillSalesHistory({ meses: 'tudo', pararApos: 2, tetoMeses: 60 });
    const meses = Object.keys(r).sort();

    // O mock tem ~30 dias de venda. A varredura tem que encostar no fim e
    // parar — não percorrer os 60 meses do teto.
    expect(meses.length).toBeGreaterThan(1);
    expect(meses.length).toBeLessThan(10);

    // Os meses vazios do fim são o SINAL de parada, e entram no resultado
    // com leitura zero — é assim que se distingue "acabou" de "falhou".
    const comVenda = Object.values(r).filter((m) => m.read > 0);
    expect(comVenda.length).toBeGreaterThan(0);
  });

  it('modo fixo: varre exatamente o número de meses pedido', async () => {
    const r = await backfillSalesHistory({ meses: 3 });
    // 3 meses para trás + o corrente.
    expect(Object.keys(r)).toHaveLength(4);
  });

  it('recusa quando já há sincronização em andamento', async () => {
    // A trava que não existia: `runFullSync` sempre teve, o backfill não.
    const run = await prisma.syncRun.create({
      data: { entity: 'backfill', status: 'RUNNING', window: 'tudo', trigger: 'manual' },
    });
    await expect(backfillSalesHistory({ meses: 1 })).rejects.toBeInstanceOf(SyncInProgressError);
    await prisma.syncRun.delete({ where: { id: run.id } });
  });

  it('fecha o RUNNING abandonado em vez de deixá-lo mentindo na tabela', async () => {
    // Os "fantasmas" nunca bloquearam — a trava só olha RUNNING recente. Mas
    // ficavam para sempre e levaram a operação a diagnosticar um bug de trava
    // que não existia. Registro que mente sobre o próprio estado custa caro
    // mesmo quando é inócuo.
    const fantasma = await prisma.syncRun.create({
      data: {
        entity: 'backfill',
        status: 'RUNNING',
        window: 'tudo',
        trigger: 'manual',
        startedAt: new Date(Date.now() - 4 * 60 * 60_000),
      },
    });
    await backfillSalesHistory({ meses: 1 });
    const depois = await prisma.syncRun.findUnique({ where: { id: fantasma.id } });
    expect(depois?.status).toBe('FAILED');
    expect(depois?.finishedAt).not.toBeNull();
    expect(depois?.error).toContain('abandonado');
    await prisma.syncRun.delete({ where: { id: fantasma.id } });
  });

  it('um RUNNING velho não bloqueia — processo que morreu não pode travar a rede', async () => {
    const velho = await prisma.syncRun.create({
      data: {
        entity: 'backfill',
        status: 'RUNNING',
        window: 'tudo',
        trigger: 'manual',
        startedAt: new Date(Date.now() - 60 * 60_000),
      },
    });
    await expect(backfillSalesHistory({ meses: 1 })).resolves.toBeDefined();
    await prisma.syncRun.deleteMany({ where: { id: velho.id } });
  });

  it('registra o run com o resultado, para o vigia enxergar', async () => {
    await backfillSalesHistory({ meses: 1 });
    const run = await prisma.syncRun.findFirst({
      where: { entity: 'backfill' },
      orderBy: { startedAt: 'desc' },
    });
    expect(run?.status).toBe('SUCCESS');
    expect(run?.finishedAt).not.toBeNull();
    expect(run?.recordsWritten ?? 0).toBeGreaterThan(0);
  });
});
