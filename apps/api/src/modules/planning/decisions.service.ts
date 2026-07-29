import { Prisma, type DecisionOutcome } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { toNumber } from '../../http/helpers.js';
import { firstSeenAt } from './batches.service.js';

/**
 * Governança da decisão (Onda 1 · trilha TB).
 *
 * O motor de planejamento gera cards toda execução; sem persistir a decisão,
 * o mesmo card reaparece amanhã e ninguém sabe se já foi olhado. Aqui fica a
 * trilha: quem decidiu, quando, com que justificativa e qual era o impacto
 * naquele momento (o valor muda a cada execução, então é congelado).
 */

/** Dias sem decisão a partir dos quais um card é "crítico atrasado". */
export const DECISION_SLA_DAYS = 30;

export interface RecordDecisionInput {
  cardId: string;
  cardType: string;
  outcome: DecisionOutcome;
  impact: number;
  note?: string;
  cardSeenAt?: Date;
  productId?: string;
  storeId?: string;
}

export class DecisionValidationError extends Error {
  status = 400;
}

/**
 * Tipos de card que o usuário pode decidir. Lista vazia = todos — assim
 * nenhum usuário existente perde acesso quando o campo é introduzido.
 */
export async function assertCanDecide(userId: string, cardType: string): Promise<void> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { allowedCardTypes: true },
  });
  if (!u) throw new DecisionValidationError('Usuário não encontrado.');
  if (u.allowedCardTypes.length === 0) return; // sem restrição configurada
  if (!u.allowedCardTypes.includes(cardType)) {
    const e = new DecisionValidationError(
      `Seu perfil não decide cards do tipo ${cardType}.`,
    );
    e.status = 403;
    throw e;
  }
}

/**
 * Registra a decisão. Recusar EXIGE justificativa — sem isso a trilha não
 * serve para nada depois ("por que recusamos R$ 116 mil em liberação?").
 * Aprovar não exige: o card já traz o porquê.
 */
export async function recordDecision(input: RecordDecisionInput, userId: string) {
  const note = input.note?.trim() || undefined;
  if (input.outcome === 'REJECTED' && !note) {
    throw new DecisionValidationError('Recusar um card exige justificativa.');
  }
  if (!input.cardId.trim()) throw new DecisionValidationError('cardId é obrigatório.');
  await assertCanDecide(userId, input.cardType);

  // A idade do card vem do lote de geração (servidor), não do cliente: é a
  // base do SLA, e quem decide não deveria poder informar — nem errar — desde
  // quando o próprio card está esperando. O valor do cliente fica como
  // reserva, enquanto o cron nunca rodou e não há lote registrado.
  const seenAt = (await firstSeenAt(input.cardId.trim())) ?? input.cardSeenAt;

  return prisma.decisionRecord.create({
    data: {
      cardId: input.cardId.trim(),
      cardType: input.cardType,
      outcome: input.outcome,
      note,
      impact: new Prisma.Decimal(Number.isFinite(input.impact) ? input.impact : 0),
      cardSeenAt: seenAt,
      productId: input.productId,
      storeId: input.storeId,
      decidedBy: userId,
    },
  });
}

/**
 * Decisão vigente de cada card (a mais recente vence). Serve para o board
 * esconder o que já foi decidido sem perder o histórico.
 */
export async function currentDecisions(cardIds: string[]): Promise<Map<string, DecisionOutcome>> {
  if (cardIds.length === 0) return new Map();
  const rows = await prisma.decisionRecord.findMany({
    where: { cardId: { in: cardIds } },
    orderBy: { decidedAt: 'desc' },
    select: { cardId: true, outcome: true },
  });
  const map = new Map<string, DecisionOutcome>();
  for (const r of rows) if (!map.has(r.cardId)) map.set(r.cardId, r.outcome);
  return map;
}

export interface DecisionHistoryRow {
  id: string;
  cardId: string;
  cardType: string;
  outcome: DecisionOutcome;
  note: string | null;
  impact: number;
  decidedAt: string;
  decidedByName: string;
  /** Dias entre a geração do card e a decisão (null quando não se sabe). */
  daysToDecide: number | null;
}

/** Histórico geral, mais recente primeiro. */
export async function decisionHistory(limit = 200, userId?: string): Promise<DecisionHistoryRow[]> {
  const rows = await prisma.decisionRecord.findMany({
    where: userId ? { decidedBy: userId } : undefined,
    orderBy: { decidedAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 1000),
    include: { user: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    cardId: r.cardId,
    cardType: r.cardType,
    outcome: r.outcome,
    note: r.note,
    impact: toNumber(r.impact) ?? 0,
    decidedAt: r.decidedAt.toISOString(),
    decidedByName: r.user.name,
    daysToDecide: r.cardSeenAt
      ? Math.max(0, Math.round((r.decidedAt.getTime() - r.cardSeenAt.getTime()) / 86_400_000))
      : null,
  }));
}

export interface DecisionStats {
  slaDays: number;
  approved: number;
  rejected: number;
  approvedImpact: number;
  rejectedImpact: number;
  /** Tempo médio até decidir, em dias (null sem amostra). */
  avgDaysToDecide: number | null;
  /** Série diária dos últimos `days` dias: aprovados × recusados. */
  series: { date: string; approved: number; rejected: number }[];
  /** Ranking por colaborador — o painel de equipe do benchmark. */
  byUser: { userId: string; name: string; approved: number; rejected: number; impact: number }[];
}

/** Métricas de governança: série temporal, SLA e desempenho da equipe. */
export async function decisionStats(days = 30): Promise<DecisionStats> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await prisma.decisionRecord.findMany({
    where: { decidedAt: { gte: since } },
    include: { user: { select: { id: true, name: true } } },
  });

  const series = new Map<string, { approved: number; rejected: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    series.set(d.toISOString().slice(0, 10), { approved: 0, rejected: 0 });
  }
  const byUser = new Map<string, { userId: string; name: string; approved: number; rejected: number; impact: number }>();

  let approved = 0;
  let rejected = 0;
  let approvedImpact = 0;
  let rejectedImpact = 0;
  let spanSum = 0;
  let spanCount = 0;

  for (const r of rows) {
    const impact = toNumber(r.impact) ?? 0;
    const key = r.decidedAt.toISOString().slice(0, 10);
    const day = series.get(key);
    const u =
      byUser.get(r.user.id) ??
      { userId: r.user.id, name: r.user.name, approved: 0, rejected: 0, impact: 0 };

    if (r.outcome === 'APPROVED') {
      approved++;
      approvedImpact += impact;
      if (day) day.approved++;
      u.approved++;
    } else {
      rejected++;
      rejectedImpact += impact;
      if (day) day.rejected++;
      u.rejected++;
    }
    u.impact += impact;
    byUser.set(r.user.id, u);

    if (r.cardSeenAt) {
      spanSum += (r.decidedAt.getTime() - r.cardSeenAt.getTime()) / 86_400_000;
      spanCount++;
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    slaDays: DECISION_SLA_DAYS,
    approved,
    rejected,
    approvedImpact: round2(approvedImpact),
    rejectedImpact: round2(rejectedImpact),
    avgDaysToDecide: spanCount > 0 ? round2(spanSum / spanCount) : null,
    series: [...series.entries()].map(([date, v]) => ({ date, ...v })),
    byUser: [...byUser.values()].sort((a, b) => b.approved + b.rejected - (a.approved + a.rejected)),
  };
}

/**
 * Marca cards ainda em aberto como críticos quando passam do SLA.
 * `generatedAt` é quando o lote foi gerado — o motor é recalculado a cada
 * execução, então a idade real do card vem da PRIMEIRA vez que ele apareceu.
 */
export function isCriticallyOverdue(firstSeenAt: Date | null | undefined, now = new Date()): boolean {
  if (!firstSeenAt) return false;
  return (now.getTime() - firstSeenAt.getTime()) / 86_400_000 > DECISION_SLA_DAYS;
}
