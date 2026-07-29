import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { toNumber } from '../../http/helpers.js';
import type { BatchInfo, CardHistory, DecisionCard } from './planning.math.js';

/**
 * Lote de geração (Onda 1 · trilha TB).
 *
 * O motor de decisão recalcula tudo do zero a cada sincronização. Sem registrar
 * a execução, a tela não sabe responder as duas primeiras perguntas que o
 * gestor faz de manhã: "quando isso foi calculado?" e "o que apareceu de novo
 * hoje?". Pior: um card que reaparece há dois meses fica visualmente idêntico
 * a um que estreou hoje.
 *
 * O lote nasce do cron das 06h — decisão do Gabriel. Sync manual também gera
 * lote, marcado como MANUAL para não confundir a leitura da série.
 */

/** Uma linha por card DISTINTO; o id é determinístico entre execuções. */
export interface SightingInput {
  cardId: string;
  cardType: string;
}

export interface RecordBatchResult {
  batchId: string;
  cardsTotal: number;
  cardsNew: number;
}

/**
 * Registra a execução do motor: cria o lote e atualiza as aparições.
 *
 * Card visto pela primeira vez ganha `firstSeenAt` = agora e aponta para este
 * lote. Card que já existia só tem `lastSeenAt`/`timesSeen` atualizados — o
 * `firstSeenAt` nunca se move, senão a idade do card reiniciaria a cada
 * execução e o SLA nunca estouraria.
 */
export async function recordGenerationBatch(
  cards: DecisionCard[],
  opts: { trigger: string; days: number },
): Promise<RecordBatchResult> {
  const source = opts.trigger === 'schedule' ? 'CRON' : 'MANUAL';
  const now = new Date();

  const ids = cards.map((c) => c.id);
  const existing =
    ids.length > 0
      ? await prisma.cardSighting.findMany({ where: { cardId: { in: ids } }, select: { cardId: true } })
      : [];
  const known = new Set(existing.map((s) => s.cardId));
  const fresh = cards.filter((c) => !known.has(c.id));

  const impactTotal = cards.reduce((a, c) => a + c.impact, 0);

  return prisma.$transaction(async (tx) => {
    const batch = await tx.generationBatch.create({
      data: {
        generatedAt: now,
        source,
        trigger: opts.trigger,
        days: opts.days,
        cardsTotal: cards.length,
        cardsNew: fresh.length,
        compra: cards.filter((c) => c.type === 'COMPRA').length,
        remanejamento: cards.filter((c) => c.type === 'REMANEJAMENTO').length,
        liquidacao: cards.filter((c) => c.type === 'LIQUIDACAO').length,
        impactTotal: new Prisma.Decimal(Math.round(impactTotal * 100) / 100),
      },
    });

    if (fresh.length > 0) {
      await tx.cardSighting.createMany({
        data: fresh.map((c) => ({
          cardId: c.id,
          cardType: c.type,
          firstSeenAt: now,
          lastSeenAt: now,
          timesSeen: 1,
          batchId: batch.id,
        })),
        skipDuplicates: true,
      });
    }

    const seenAgain = ids.filter((id) => known.has(id));
    if (seenAgain.length > 0) {
      await tx.cardSighting.updateMany({
        where: { cardId: { in: seenAgain } },
        data: { lastSeenAt: now, timesSeen: { increment: 1 } },
      });
    }

    return { batchId: batch.id, cardsTotal: cards.length, cardsNew: fresh.length };
  });
}

/** Metadados do lote mais recente (undefined enquanto o cron nunca rodou). */
export async function latestBatch(): Promise<BatchInfo | undefined> {
  const b = await prisma.generationBatch.findFirst({ orderBy: { generatedAt: 'desc' } });
  if (!b) return undefined;
  return {
    id: b.id,
    generatedAt: b.generatedAt.toISOString(),
    source: b.source,
    cardsTotal: b.cardsTotal,
    cardsNew: b.cardsNew,
  };
}

/** Histórico de aparições dos cards pedidos, para carimbar a idade no board. */
export async function cardHistories(cardIds: string[]): Promise<Map<string, CardHistory>> {
  if (cardIds.length === 0) return new Map();
  const rows = await prisma.cardSighting.findMany({
    where: { cardId: { in: cardIds } },
    select: { cardId: true, firstSeenAt: true, timesSeen: true },
  });
  return new Map(rows.map((r) => [r.cardId, r]));
}

/**
 * Quando o card apareceu pela primeira vez — usado ao registrar a decisão.
 * Vem do servidor, e não do cliente: é a base do SLA, e cliente não deveria
 * poder informar (nem errar) a idade do próprio card que está decidindo.
 */
export async function firstSeenAt(cardId: string): Promise<Date | undefined> {
  const s = await prisma.cardSighting.findUnique({
    where: { cardId },
    select: { firstSeenAt: true },
  });
  return s?.firstSeenAt;
}

export interface BatchRow {
  id: string;
  generatedAt: string;
  source: 'CRON' | 'MANUAL';
  trigger: string;
  days: number;
  cardsTotal: number;
  cardsNew: number;
  compra: number;
  remanejamento: number;
  liquidacao: number;
  impactTotal: number;
}

/** Série de lotes, mais recente primeiro — a "linha do tempo" das execuções. */
export async function batchHistory(limit = 30): Promise<BatchRow[]> {
  const rows = await prisma.generationBatch.findMany({
    orderBy: { generatedAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
  });
  return rows.map((b) => ({
    id: b.id,
    generatedAt: b.generatedAt.toISOString(),
    source: b.source,
    trigger: b.trigger,
    days: b.days,
    cardsTotal: b.cardsTotal,
    cardsNew: b.cardsNew,
    compra: b.compra,
    remanejamento: b.remanejamento,
    liquidacao: b.liquidacao,
    impactTotal: toNumber(b.impactTotal) ?? 0,
  }));
}
