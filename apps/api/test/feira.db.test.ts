import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { planoDaFeira, registrarCompra } from '../src/modules/planning/feira.service.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * O MODO FEIRA — planejar a compra de uma coleção que ninguém vendeu ainda.
 *
 * A diferença para o contínuo decide tudo: aqui a oferta é nova, o giro
 * próprio de cada peça é ZERO, e a evidência tem que vir do perfil. Se "nunca
 * vendeu" bastasse para virar aposta, a coleção inteira cairia no balde
 * especulativo e o plano diria que 100% da compra é risco.
 */
d('feira de compra (integração com Postgres)', () => {
  let fairId = '';

  beforeAll(async () => {
    const feira = await prisma.purchaseFair.create({
      data: {
        supplier: 'FORNECEDOR DE TESTE',
        collection: `Coleção ${Date.now()}`,
        floorUnits: 400,
        risk: 'equilibrado',
        arrivesAt: new Date('2026-09-01'),
        targetAt: new Date('2027-03-31'),
      },
    });
    fairId = feira.id;

    // Uma oferta com variedade suficiente para o teto de 25% não travar o
    // plano: 12 peças, duas grifes, dois tipos.
    await prisma.purchaseFairOffer.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({
        fairId,
        sku: `T-${i}`,
        description: `PECA DE FEIRA ${i}`,
        brand: i % 2 === 0 ? 'GRIFE ALFA' : 'GRIFE BETA',
        tipo: i % 3 === 0 ? 'SOLAR' : 'ARMACAO',
        genero: i % 2 === 0 ? 'Masculino' : 'Feminino',
        formato: 'Piloto',
        cor: 'Havana',
        unitCost: 100 + i,
        unitPrice: 300 + i * 5,
      })),
    });
  });

  afterAll(async () => {
    if (fairId) await prisma.purchaseFair.delete({ where: { id: fairId } });
  });

  it('o plano fecha contra o piso da feira', async () => {
    const r = await planoDaFeira(fairId);
    expect(r.floorUnits).toBe(400);
    expect(r.detalhe.total + r.detalhe.naoAlocado).toBe(400);
  });

  it('peça sem giro NÃO vira automaticamente aposta', async () => {
    /*
     * A invariante que sustenta o modo feira inteiro.
     *
     * Todas as 12 peças têm `unitsSold: 0` — é coleção nova. Se a classificação
     * olhasse só isso, as 400 unidades cairiam em "aposta" e o plano informaria
     * que a compra toda é especulação, o que é falso e inútil.
     */
    const r = await planoDaFeira(fairId);
    const aposta = r.detalhe.segmentos.find((s) => s.segmento === 'aposta')!;
    const total = r.detalhe.total;
    if (total > 0) {
      expect(aposta.alocado, 'a coleção inteira caiu no balde especulativo').toBeLessThan(total);
    }
  });

  it('nenhuma linha passa do teto de concentração do segmento', async () => {
    // Numa feira não há absorção medida — a peça não existe na rede —, então
    // quem governa a concentração é só o teto. Ele precisa valer.
    const r = await planoDaFeira(fairId);
    for (const seg of r.detalhe.segmentos) {
      if (seg.meta === 0) continue;
      const teto = Math.max(1, Math.ceil((seg.meta * 25) / 100));
      for (const l of seg.linhas) expect(l.units).toBeLessThanOrEqual(teto);
    }
  });

  it('a divisão por loja fecha contra as unidades da linha', async () => {
    const r = await planoDaFeira(fairId);
    const linhas = r.detalhe.segmentos.flatMap((s) => s.linhas) as (typeof r.detalhe.segmentos[number]['linhas'][number] & {
      lojas?: { suggestedQty: number }[];
      semLoja?: number;
    })[];
    for (const l of linhas) {
      const paraLojas = (l.lojas ?? []).reduce((a, x) => a + x.suggestedQty, 0);
      expect(paraLojas + (l.semLoja ?? 0)).toBe(l.units);
    }
  });

  it('o registro da compra PERSISTE — não vive no navegador', async () => {
    /*
     * A diferença que o concorrente não tem: ele guarda os lançamentos em
     * `localStorage` ("seus lançamentos ficam neste navegador durante a
     * feira"). Monousuário, sem histórico, e perdido se alguém limpar o cache
     * no meio de uma compra de seis dígitos.
     */
    const oferta = await prisma.purchaseFairOffer.findFirstOrThrow({ where: { fairId } });
    await registrarCompra(oferta.id, 7);

    const relido = await prisma.purchaseFairOffer.findUniqueOrThrow({ where: { id: oferta.id } });
    expect(relido.bought).toBe(7);

    // E o plano continua contando o que foi comprado, independente do plano.
    const r = await planoDaFeira(fairId);
    expect(r.feira.comprado).toBeGreaterThanOrEqual(7);
  });

  it('recalcular o plano NÃO apaga o que já foi comprado', async () => {
    // O plano é função pura sobre a oferta; a compra é fato. Recalcular um não
    // pode tocar no outro.
    const antes = await prisma.purchaseFairOffer.aggregate({
      where: { fairId },
      _sum: { bought: true },
    });
    await planoDaFeira(fairId);
    await planoDaFeira(fairId);
    const depois = await prisma.purchaseFairOffer.aggregate({
      where: { fairId },
      _sum: { bought: true },
    });
    expect(depois._sum.bought).toBe(antes._sum.bought);
  });

  it('quantidade negativa é recusada', async () => {
    const oferta = await prisma.purchaseFairOffer.findFirstOrThrow({ where: { fairId } });
    await expect(registrarCompra(oferta.id, -1)).rejects.toThrow();
  });
});
