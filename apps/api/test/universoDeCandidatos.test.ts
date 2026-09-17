import { describe, expect, it } from 'vitest';
import {
  SEGMENTOS_DO_PLANO,
  segmentoPorGiro,
  selecionarUniversoDeCandidatos,
  type ProductPlan,
  type SegmentoDoPlano,
} from '../src/modules/planning/planning.math.js';

/**
 * O BALDE DE LANÇAMENTO SAÍA VAZIO PORQUE A SELEÇÃO O DESCARTAVA.
 *
 * "Lançamento não foi alterado, não está detalhando nada do pedido."
 *                                                     — Galbe, 17/09/2026
 *
 * O detalhamento por Marca → Grupo → Gênero → Formato → Cor estava construído e
 * testado (ver `detalhamentoDeLancamento.test.ts`). O que faltava era ENTRADA: o
 * universo de candidatos era uma fila só, ordenada por giro decrescente e
 * cortada no teto. Como "lançamento" é definido por giro ZERO, toda peça
 * candidata a ele ficava no fim da fila e o corte a descartava.
 *
 * Estes testes fixam a regra nos dois sentidos: a cota existe, e ela não
 * desperdiça teto quando um dos lados tem fila curta.
 */

// `...o` por último, e não `o.campo ?? padrão`: com o `??`, passar `unitsSold: 0`
// devolveria o padrão e o teste provaria o contrário do que diz provar.
const plano = (o: Partial<ProductPlan>): ProductPlan => ({
  productId: 'p',
  sku: 'P',
  description: 'PECA',
  brand: 'FORNECEDOR',
  category: 'OCULOS',
  currentStock: 1,
  unitsSold: 0,
  dailyDemand: 0,
  coverageDays: null,
  reorderPoint: 0,
  targetStock: 0,
  unitCost: 100,
  stockValue: 100,
  excessValue: 0,
  revenue: 0,
  movementClass: 'morto',
  recommendation: 'HOLD',
  suggestedQty: 0,
  capital: 0,
  stockoutInDays: null,
  reason: '',
  friendlyReason: '',
  justificativa: '',
  confidence: 0,
  carryingCost30d: 0,
  excessCarryingCost30d: 0,
  unitPrice: 300,
  marginPct: 66,
  expectedMargin: 0,
  onOrderQty: 0,
  leadTimeDays: 30,
  orderByInDays: null,
  ...o,
}) as ProductPlan;

const contarPorSegmento = (pool: ProductPlan[]) => {
  const c: Record<SegmentoDoPlano, number> = { 'best-seller': 0, lancamento: 0 };
  for (const p of pool) c[segmentoPorGiro(p.unitsSold)] += 1;
  return c;
};

const METAS_EQUILIBRADAS: Record<SegmentoDoPlano, number> = { 'best-seller': 405, lancamento: 495 };

describe('o universo de candidatos reserva cota para o lançamento', () => {
  it('com MAIS peças girando que o teto, o lançamento ainda entra', () => {
    // A rede real: milhares de peças vendendo, e o teto menor que isso. Antes,
    // este era exatamente o caso em que o balde saía vazio.
    const plans = [
      ...Array.from({ length: 3_500 }, (_, i) =>
        plano({ productId: `bs${i}`, unitsSold: 3_500 - i, stockValue: 10 }),
      ),
      ...Array.from({ length: 400 }, (_, i) => plano({ productId: `l${i}`, unitsSold: 0, stockValue: i })),
    ];

    const pool = selecionarUniversoDeCandidatos(plans, METAS_EQUILIBRADAS, 3_000);
    const c = contarPorSegmento(pool);

    expect(pool).toHaveLength(3_000);
    // A prova do defeito: sem cota, este número era ZERO.
    expect(c.lancamento).toBeGreaterThan(0);
    expect(c['best-seller']).toBeGreaterThan(0);
    // 495/900 do teto = 1.650 vagas; a fila só tem 400, então entra inteira.
    expect(c.lancamento).toBe(400);
  });

  it('a cota acompanha a meta: mais risco, mais vaga de lançamento', () => {
    const plans = [
      ...Array.from({ length: 5_000 }, (_, i) => plano({ productId: `bs${i}`, unitsSold: 5_000 - i })),
      ...Array.from({ length: 5_000 }, (_, i) => plano({ productId: `l${i}`, unitsSold: 0, stockValue: i })),
    ];

    const conservador = contarPorSegmento(
      selecionarUniversoDeCandidatos(plans, { 'best-seller': 600, lancamento: 400 }, 1_000),
    );
    const agressivo = contarPorSegmento(
      selecionarUniversoDeCandidatos(plans, { 'best-seller': 300, lancamento: 700 }, 1_000),
    );

    expect(conservador.lancamento).toBe(400);
    expect(agressivo.lancamento).toBe(700);
    expect(agressivo.lancamento).toBeGreaterThan(conservador.lancamento);
  });

  it('fila curta de um lado devolve a vaga para o outro — o teto não é desperdiçado', () => {
    // Rede sem peça parada nenhuma: a reserva de lançamento não pode custar
    // vaga de best-seller.
    const plans = Array.from({ length: 4_000 }, (_, i) => plano({ productId: `bs${i}`, unitsSold: 4_000 - i }));

    const pool = selecionarUniversoDeCandidatos(plans, METAS_EQUILIBRADAS, 3_000);
    const c = contarPorSegmento(pool);

    expect(pool).toHaveLength(3_000);
    expect(c['best-seller']).toBe(3_000);
    expect(c.lancamento).toBe(0);
  });

  it('o lançamento é ordenado pelo giro do TIPO, não pelo capital parado', () => {
    // Duas peças paradas: uma de um tipo que a rede vende, outra de um tipo que
    // ninguém compra e que tem MAIS capital preso. A primeira é que interessa.
    const plans = [
      // O lastro do tipo: OCULOS vende, RELOGIO não.
      plano({ productId: 'giro-oculos', category: 'OCULOS', unitsSold: 900 }),
      plano({ productId: 'parada-oculos', category: 'OCULOS', unitsSold: 0, stockValue: 1 }),
      plano({ productId: 'parada-relogio', category: 'RELOGIO', unitsSold: 0, stockValue: 999_999 }),
    ];

    // Teto de 2: uma vaga para cada segmento.
    const pool = selecionarUniversoDeCandidatos(plans, { 'best-seller': 500, lancamento: 500 }, 2);
    const ids = pool.map((p) => p.productId);

    expect(ids).toContain('giro-oculos');
    expect(ids).toContain('parada-oculos');
    // O estoque morto mais caro NÃO é o melhor candidato a lançamento — era
    // exatamente ele que a ordenação por capital elegia.
    expect(ids).not.toContain('parada-relogio');
  });

  it('cabendo tudo no teto, devolve tudo — sem reordenar nada para fora', () => {
    const plans = [
      plano({ productId: 'a', unitsSold: 5 }),
      plano({ productId: 'b', unitsSold: 0 }),
    ];
    const pool = selecionarUniversoDeCandidatos(plans, METAS_EQUILIBRADAS, 3_000);
    expect(pool).toHaveLength(2);
    expect(pool.map((p) => p.productId).sort()).toEqual(['a', 'b']);
  });

  it('a régua do segmento é uma só', () => {
    // Se `segmentoPorGiro` e a classificação do candidato divergirem de novo, o
    // defeito volta por outro caminho. Aqui fica a régua fixada.
    expect(segmentoPorGiro(0)).toBe('lancamento');
    expect(segmentoPorGiro(1)).toBe('best-seller');
    expect([...SEGMENTOS_DO_PLANO]).toEqual(['best-seller', 'lancamento']);
  });
});
