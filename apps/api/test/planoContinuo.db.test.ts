import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { commercialStrategy } from '../src/modules/planning/planning.service.js';
import { PLANNED_STORE_WHERE } from '../src/modules/stores/store.scope.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * O plano detalhado sobre a rede viva — modo CONTÍNUO.
 *
 * "ele sugere a compra, mas ele não sugere como distribuir isso pra por loja.
 *  É isso que a gente precisa sacar."  — três rodadas seguidas.
 *
 * O que só aparece contra o banco: se a hierarquia fecha com a estratégia, se
 * a divisão por loja fecha com o plano, e se o porteiro de mix e o escopo de
 * loja continuam valendo aqui — todos já valiam em outras telas e nenhum
 * valia nesta, porque esta não existia.
 */
d('plano de compra detalhado · modo contínuo (integração com Postgres)', () => {
  const params = { floorUnits: 900, windowMonths: 7, risk: 'equilibrado' as const };
  const criados: string[] = [];

  beforeAll(async () => {
    /*
     * O SEED NÃO SERVE, e descobri isso pela guarda deste próprio arquivo.
     *
     * O dataset fictício tem toda peça absurdamente sobre-estocada — 118
     * unidades contra 3 vendidas, as 60 em `DONT_BUY`. Com a trava de absorção
     * (uma linha não pode passar do que a peça escoa), o plano corretamente
     * aloca ZERO ali, e um teste sobre plano vazio não afirma nada.
     *
     * Então o teste monta o que precisa: peças com giro de verdade e estoque
     * baixo, que é a forma da rede real — 34.547 das 40.047 posições de
     * produção têm 1 ou 2 unidades.
     */
    const lojas = await prisma.store.findMany({ where: PLANNED_STORE_WHERE, take: 3 });
    if (lojas.length === 0) throw new Error('sem loja planejável no banco (rode o seed)');

    for (let i = 0; i < 6; i += 1) {
      const p = await prisma.product.create({
        data: {
          externalId: `t-plano-${Date.now()}-${i}`,
          description: `ARMACAO PLANO TESTE ${i}`,
          category: 'ARMACAO',
          price: 300 + i * 10,
          cost: 120,
        },
      });
      criados.push(p.id);
      for (const loja of lojas) {
        // Estoque BAIXO: é o que deixa folga de absorção.
        await prisma.stockItem.create({
          data: { storeId: loja.id, productId: p.id, quantity: 1, available: 1 },
        });
        // E venda de verdade, para a peça ser best-seller com alvo alto.
        const venda = await prisma.sale.create({
          data: {
            externalId: `t-plano-v-${Date.now()}-${i}-${loja.id}`,
            storeId: loja.id,
            saleDate: new Date(),
            total: 3000,
          },
        });
        await prisma.saleItem.create({
          data: { saleId: venda.id, productId: p.id, quantity: 10, unitPrice: 300, total: 3000 },
        });
      }
    }
  });

  afterAll(async () => {
    await prisma.saleItem.deleteMany({ where: { productId: { in: criados } } });
    await prisma.sale.deleteMany({ where: { externalId: { startsWith: 't-plano-v-' } } });
    await prisma.stockItem.deleteMany({ where: { productId: { in: criados } } });
    await prisma.product.deleteMany({ where: { id: { in: criados } } });
  });

  it('a hierarquia fecha com os baldes da estratégia', async () => {
    const r = await commercialStrategy(90, params);
    // O detalhe não pode inventar unidade além do que a estratégia autorizou.
    // `alocado + naoAlocado` de cada segmento é a meta daquele segmento.
    for (const seg of r.detalhe.segmentos) {
      const doSegmento = r.segments.find((s) => s.key === seg.segmento);
      expect(doSegmento, `segmento ${seg.segmento} sumiu da estratégia`).toBeTruthy();
      expect(seg.meta).toBe(doSegmento!.units);
      expect(seg.alocado).toBeLessThanOrEqual(seg.meta);
    }
    expect(r.detalhe.total + r.detalhe.naoAlocado).toBe(r.floorUnits);
  });

  it('nenhuma linha passa do teto do seu segmento', async () => {
    const r = await commercialStrategy(90, params);
    for (const seg of r.detalhe.segmentos) {
      if (seg.meta === 0) continue;
      const teto = Math.max(1, Math.ceil((seg.meta * 25) / 100));
      for (const l of seg.linhas) expect(l.units).toBeLessThanOrEqual(teto);
    }
  });

  it('a divisão por loja FECHA contra as unidades da linha', async () => {
    /*
     * A invariante que impede o número da tela de mentir.
     *
     * Cada linha reparte suas unidades entre as lojas elegíveis; o que nenhuma
     * loja reclamou fica em `semLoja`. Unidade que some entre os dois é
     * mercadoria comprada que ninguém vai procurar — o mesmo defeito que o
     * rateio do recebimento já tinha sido obrigado a fechar.
     */
    const r = await commercialStrategy(90, params);
    const linhas = r.detalhe.segmentos.flatMap((s) => s.linhas);
    expect(linhas.length, 'plano vazio: o teste não afirmaria nada').toBeGreaterThan(0);
    for (const l of linhas as (typeof linhas[number] & {
      lojas?: { suggestedQty: number }[];
      semLoja?: number;
    })[]) {
      const paraLojas = (l.lojas ?? []).reduce((a, x) => a + x.suggestedQty, 0);
      expect(paraLojas + (l.semLoja ?? 0)).toBe(l.units);
    }
  });

  it('o total POR LOJA bate com o que as linhas mandaram', async () => {
    // A visão de quem monta o malote: quanto cada filial recebe deste plano.
    const r = await commercialStrategy(90, params);
    const linhas = r.detalhe.segmentos.flatMap((s) => s.linhas) as (typeof r.detalhe.segmentos[number]['linhas'][number] & {
      lojas?: { suggestedQty: number }[];
    })[];
    const somaDasLinhas = linhas.reduce(
      (a, l) => a + (l.lojas ?? []).reduce((b, x) => b + x.suggestedQty, 0),
      0,
    );
    const somaPorLoja = r.detalhe.porLoja.reduce((a, x) => a + x.units, 0);
    expect(somaPorLoja).toBe(somaDasLinhas);
  });

  it('cada linha traz o porquê em português, sem log de máquina', async () => {
    /*
     * O concorrente publica `low_cover_21mo_abs_weighted+sinal_tendencia_
     * verificado+teto_25p` numa coluna chamada BASE, que o comprador lê
     * enquanto decide. Este teste existe para que isso nunca vaze aqui.
     */
    const r = await commercialStrategy(90, params);
    const linhas = r.detalhe.segmentos.flatMap((s) => s.linhas);
    for (const l of linhas.slice(0, 40)) {
      expect(l.porque.length).toBeGreaterThan(20);
      expect(l.porque, `log de máquina vazou: ${l.porque}`).not.toMatch(/_[a-z]+_|\+[a-z_]+=/);
      // Vírgula decimal: a frase vai para a tela do comprador brasileiro.
      expect(l.porque).not.toMatch(/\d+\.\d+%/);
    }
  });

  it('piso zero não inventa compra nenhuma', async () => {
    const r = await commercialStrategy(90, { ...params, floorUnits: 0 });
    expect(r.detalhe.total).toBe(0);
    expect(r.detalhe.segmentos.every((s) => s.linhas.length === 0)).toBe(true);
  });
});
