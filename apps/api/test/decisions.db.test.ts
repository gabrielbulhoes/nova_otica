import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import {
  DECISION_SLA_DAYS,
  DecisionValidationError,
  currentDecisions,
  decisionHistory,
  decisionStats,
  isCriticallyOverdue,
  recordDecision,
} from '../src/modules/planning/decisions.service.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

d('governança da decisão (integração com Postgres)', () => {
  let userId = '';

  beforeAll(async () => {
    const u = await prisma.user.findFirst();
    if (!u) throw new Error('sem usuário de teste (rode o seed)');
    userId = u.id;
    await prisma.decisionRecord.deleteMany({ where: { cardId: { startsWith: 'TESTE-' } } });
  });

  afterAll(async () => {
    await prisma.decisionRecord.deleteMany({ where: { cardId: { startsWith: 'TESTE-' } } });
  });

  it('recusar SEM justificativa é rejeitado', async () => {
    await expect(
      recordDecision(
        { cardId: 'TESTE-A', cardType: 'LIQUIDATE', outcome: 'REJECTED', impact: 1000 },
        userId,
      ),
    ).rejects.toBeInstanceOf(DecisionValidationError);
    // espaço em branco também não vale como justificativa
    await expect(
      recordDecision(
        { cardId: 'TESTE-A', cardType: 'LIQUIDATE', outcome: 'REJECTED', impact: 1000, note: '   ' },
        userId,
      ),
    ).rejects.toBeInstanceOf(DecisionValidationError);
  });

  it('aprovar não exige justificativa e congela o impacto', async () => {
    const rec = await recordDecision(
      { cardId: 'TESTE-B', cardType: 'BUY', outcome: 'APPROVED', impact: 5500.55 },
      userId,
    );
    expect(rec.outcome).toBe('APPROVED');
    expect(Number(rec.impact)).toBeCloseTo(5500.55, 2);
    expect(rec.note).toBeNull();
  });

  it('recusar COM justificativa grava a trilha', async () => {
    const rec = await recordDecision(
      {
        cardId: 'TESTE-C',
        cardType: 'LIQUIDATE',
        outcome: 'REJECTED',
        impact: 116198.82,
        note: 'Coleção nova chega em 30 dias; segura para vender no verão.',
      },
      userId,
    );
    expect(rec.note).toContain('Coleção nova');
  });

  it('a decisão mais recente do card é a que vale (histórico preservado)', async () => {
    await recordDecision(
      { cardId: 'TESTE-D', cardType: 'BUY', outcome: 'APPROVED', impact: 100 },
      userId,
    );
    await recordDecision(
      { cardId: 'TESTE-D', cardType: 'BUY', outcome: 'REJECTED', impact: 100, note: 'mudou o plano' },
      userId,
    );
    const cur = await currentDecisions(['TESTE-D']);
    expect(cur.get('TESTE-D')).toBe('REJECTED');
    // as duas linhas continuam no histórico — nada é sobrescrito
    const rows = await prisma.decisionRecord.findMany({ where: { cardId: 'TESTE-D' } });
    expect(rows).toHaveLength(2);
  });

  it('mede o tempo até decidir a partir de quando o card apareceu', async () => {
    const seen = new Date();
    seen.setDate(seen.getDate() - 5);
    await recordDecision(
      { cardId: 'TESTE-E', cardType: 'BUY', outcome: 'APPROVED', impact: 10, cardSeenAt: seen },
      userId,
    );
    const hist = await decisionHistory(50);
    const row = hist.find((r) => r.cardId === 'TESTE-E');
    expect(row?.daysToDecide).toBe(5);
  });

  it('estatísticas somam impacto por resultado e montam a série diária', async () => {
    const st = await decisionStats(30);
    expect(st.slaDays).toBe(DECISION_SLA_DAYS);
    expect(st.approved).toBeGreaterThanOrEqual(2);
    expect(st.rejected).toBeGreaterThanOrEqual(2);
    expect(st.approvedImpact).toBeGreaterThan(0);
    expect(st.series).toHaveLength(30);
    // hoje é o último ponto da série e recebeu as decisões deste teste
    const hoje = st.series[st.series.length - 1];
    expect(hoje.approved + hoje.rejected).toBeGreaterThan(0);
    expect(st.byUser.length).toBeGreaterThanOrEqual(1);
  });

  it('SLA: card em aberto além de 30 dias é crítico', () => {
    const velho = new Date();
    velho.setDate(velho.getDate() - (DECISION_SLA_DAYS + 1));
    const novo = new Date();
    novo.setDate(novo.getDate() - 3);
    expect(isCriticallyOverdue(velho)).toBe(true);
    expect(isCriticallyOverdue(novo)).toBe(false);
    expect(isCriticallyOverdue(null)).toBe(false);
  });
});
