import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import {
  batchHistory,
  cardHistories,
  firstSeenAt,
  latestBatch,
  recordGenerationBatch,
} from '../src/modules/planning/batches.service.js';
import { recordDecision } from '../src/modules/planning/decisions.service.js';
import type { DecisionCard } from '../src/modules/planning/planning.math.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/** Card mínimo — só o que o lote precisa (id, tipo e impacto). */
const card = (id: string, type = 'COMPRA', impact = 100): DecisionCard =>
  ({ id, type, impact } as unknown as DecisionCard);

const PREFIXO = '#TESTE-LOTE';

d('lote de geração (integração com Postgres)', () => {
  // Os lotes criados aqui usam os gatilhos REAIS ('schedule'/'manual'), então
  // a limpeza é por id — não dá para distinguir por trigger de um lote de
  // produção, e apagar por trigger levaria junto o que não é do teste.
  const criados: string[] = [];

  const registrar = async (cards: DecisionCard[], trigger: string) => {
    const r = await recordGenerationBatch(cards, { trigger, days: 90 });
    criados.push(r.batchId);
    return r;
  };

  const limpar = async () => {
    await prisma.decisionRecord.deleteMany({ where: { cardId: { startsWith: PREFIXO } } });
    await prisma.cardSighting.deleteMany({ where: { cardId: { startsWith: PREFIXO } } });
    if (criados.length > 0) {
      await prisma.generationBatch.deleteMany({ where: { id: { in: criados } } });
    }
  };

  beforeAll(async () => {
    await prisma.decisionRecord.deleteMany({ where: { cardId: { startsWith: PREFIXO } } });
    await prisma.cardSighting.deleteMany({ where: { cardId: { startsWith: PREFIXO } } });
  });
  afterAll(limpar);

  it('primeiro lote registra todos os cards como novos', async () => {
    const r = await registrar([card(`${PREFIXO}.A1`), card(`${PREFIXO}.B2`)], 'schedule');
    expect(r.cardsTotal).toBe(2);
    expect(r.cardsNew).toBe(2);
  });

  it('card que reaparece NÃO é novo e não reinicia a idade', async () => {
    const antes = await cardHistories([`${PREFIXO}.A1`]);
    const primeiraAparicao = antes.get(`${PREFIXO}.A1`)!.firstSeenAt;

    const r = await registrar(
      [card(`${PREFIXO}.A1`), card(`${PREFIXO}.B2`), card(`${PREFIXO}.C3`)],
      'schedule',
    );
    expect(r.cardsTotal).toBe(3);
    expect(r.cardsNew).toBe(1); // só o C3

    const depois = await cardHistories([`${PREFIXO}.A1`]);
    const h = depois.get(`${PREFIXO}.A1`)!;
    // firstSeenAt imóvel é o que faz o SLA estourar algum dia; se ele andasse
    // junto com o lote, nenhum card jamais ficaria "atrasado".
    expect(h.firstSeenAt.getTime()).toBe(primeiraAparicao.getTime());
    expect(h.timesSeen).toBe(2);
  });

  it('sync agendado vira CRON; disparo manual vira MANUAL', async () => {
    const m = await registrar([card(`${PREFIXO}.D4`)], 'manual');
    const rows = await batchHistory(50);
    const manual = rows.find((b) => b.id === m.batchId);
    const cron = rows.find((b) => b.id === criados[0]);
    expect(manual?.source).toBe('MANUAL');
    expect(cron?.source).toBe('CRON');
  });

  it('o lote guarda a composição por tipo e o impacto somado', async () => {
    await registrar(
      [
        card(`${PREFIXO}.E5`, 'COMPRA', 1000),
        card(`${PREFIXO}.F6`, 'LIQUIDACAO', 250.5),
        card(`${PREFIXO}.G7`, 'REMANEJAMENTO', 0),
      ],
      'schedule',
    );
    const [ultimo] = await batchHistory(1);
    expect(ultimo.compra).toBe(1);
    expect(ultimo.liquidacao).toBe(1);
    expect(ultimo.remanejamento).toBe(1);
    expect(ultimo.impactTotal).toBeCloseTo(1250.5, 2);
  });

  it('latestBatch devolve o mais recente', async () => {
    const b = await latestBatch();
    const [primeiro] = await batchHistory(1);
    expect(b?.id).toBe(primeiro.id);
  });

  it('a decisão pega o cardSeenAt do lote, ignorando o que o cliente mandou', async () => {
    const u = await prisma.user.findFirst();
    if (!u) throw new Error('sem usuário de teste (rode o seed)');

    const doLote = await firstSeenAt(`${PREFIXO}.A1`);
    expect(doLote).toBeInstanceOf(Date);

    // Cliente tenta informar uma data muito anterior (inflaria o SLA).
    const mentira = new Date('2020-01-01T00:00:00Z');
    const rec = await recordDecision(
      {
        cardId: `${PREFIXO}.A1`,
        cardType: 'COMPRA',
        outcome: 'APPROVED',
        impact: 100,
        cardSeenAt: mentira,
      },
      u.id,
    );
    expect(rec.cardSeenAt?.getTime()).toBe(doLote!.getTime());
    expect(rec.cardSeenAt?.getTime()).not.toBe(mentira.getTime());
  });

  it('card sem lote registrado cai na data informada pelo cliente', async () => {
    const u = await prisma.user.findFirst();
    if (!u) throw new Error('sem usuário de teste (rode o seed)');
    const informada = new Date('2026-07-01T00:00:00Z');
    const rec = await recordDecision(
      {
        cardId: `${PREFIXO}.SEM-LOTE`,
        cardType: 'COMPRA',
        outcome: 'APPROVED',
        impact: 10,
        cardSeenAt: informada,
      },
      u.id,
    );
    expect(rec.cardSeenAt?.getTime()).toBe(informada.getTime());
  });
});
