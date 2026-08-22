import { prisma } from '../../lib/prisma.js';
import { badRequest, notFound, toNumber } from '../../http/helpers.js';
import {
  buildCommercialStrategy,
  chaveDePerfil,
  explicarLinha,
  margemPct,
  montarPlanoDetalhado,
  normBrandKey,
  splitByNeed,
  type CandidatoDeCompra,
  type SegmentoDoPlano,
} from './planning.math.js';
import { porteiroDeMix } from './mixDeLoja.js';
import { plans, posicoesPorLoja } from './planning.service.js';

/**
 * O MODO FEIRA — planejar a compra de uma coleção nova.
 *
 * A diferença para o modo contínuo é uma só, e ela decide tudo: no contínuo o
 * universo é o catálogo que a rede JÁ VENDE, com giro medido peça a peça. Aqui
 * a oferta é de uma coleção que ninguém vendeu ainda, e a evidência tem que
 * vir de outro lugar — do PERFIL da peça contra o histórico da rede.
 *
 * Se "nunca vendeu" bastasse para virar aposta, a coleção inteira cairia no
 * balde especulativo e o plano diria que 100% da compra é risco. O que decide
 * é se piloto masculino em Havana já é o que sai.
 *
 * O REGISTRO DA COMPRA persiste. O concorrente guarda no navegador — "seus
 * lançamentos ficam neste navegador durante a feira" —, o que significa
 * monousuário, sem histórico, e perdido se alguém limpar o cache no meio de
 * uma compra de seis dígitos.
 */

/** Janela em dias entre a chegada e o alvo, para o rateio por loja. */
const JANELA_PADRAO_DIAS = 180;

/** O histórico da rede que serve de lastro para uma coleção que ninguém vendeu. */
export async function perfilDaRede(days = 365) {
  const productPlans = await plans(days, undefined, 'principal');
  const fichas = await prisma.productAttribute.findMany({
    where: { productId: { in: productPlans.map((p) => p.productId) }, cadastroEm: { not: null } },
    select: { productId: true, genero: true, formato: true },
  });
  const fichaPor = new Map(fichas.map((f) => [f.productId, f]));

  const porTipoGenero = new Map<string, number>();
  const porFormato = new Map<string, number>();
  const soma = (m: Map<string, number>, k: string | null, v: number) => {
    if (!k) return;
    m.set(k, (m.get(k) ?? 0) + v);
  };
  for (const p of productPlans) {
    if (p.unitsSold <= 0) continue;
    const f = fichaPor.get(p.productId);
    // AS DUAS CHAVES: com gênero e sem. A oferta do fornecedor sabe o gênero;
    // o histórico da rede quase nunca sabe (4.339 de 61 mil peças têm ficha).
    // Gravar só a completa faria os dois lados nunca casarem — ver
    // `evidenciaDoPerfil`.
    soma(porTipoGenero, chaveDePerfil(p.category, f?.genero ?? null), p.unitsSold);
    soma(porTipoGenero, chaveDePerfil(p.category, null), p.unitsSold);
    soma(porFormato, f?.formato ? normBrandKey(f.formato) : null, p.unitsSold);
  }

  // O RANKING do formato — é o que vira "2º formato do segmento" na frase, e
  // situa a peça contra as concorrentes em vez de só dizer "vende".
  const rankFormato = new Map<string, number>();
  [...porFormato.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([k], i) => rankFormato.set(k, i + 1));

  return {
    perfil: { porTipoGenero, porFormato, porCor: new Map<string, number>() },
    rankFormato,
    pecasComGiro: productPlans.filter((p) => p.unitsSold > 0).length,
  };
}

/** Monta o plano de uma feira a partir da oferta importada. */
export async function planoDaFeira(fairId: string) {
  const feira = await prisma.purchaseFair.findUnique({
    where: { id: fairId },
    include: { offers: true },
  });
  if (!feira) throw notFound('Feira não encontrada');

  const { perfil, rankFormato, pecasComGiro } = await perfilDaRede();

  const candidatos: CandidatoDeCompra[] = feira.offers.map((o) => ({
    id: o.id,
    sku: o.sku,
    description: o.description,
    brand: o.brand,
    tipo: o.tipo,
    genero: o.genero,
    formato: o.formato,
    cor: o.cor,
    unitCost: toNumber(o.unitCost) ?? 0,
    unitPrice: toNumber(o.unitPrice) ?? 0,
    // COLEÇÃO NOVA: a rede nunca vendeu estas peças, então não há giro próprio
    // nem estoque. É o que joga a decisão para o perfil.
    unitsSold: 0,
    currentStock: 0,
    coberturaDaGrifeMeses: null,
    // Sem absorção medida: não há histórico DESTA peça para dizer quanto ela
    // escoa. Quem governa aqui é o teto de concentração do segmento — e
    // inventar uma absorção seria transformar ausência de dado em permissão.
    absorcao: null,
  }));

  // A estratégia roda sobre a mesma matemática do contínuo. `windowMonths` sai
  // das datas do evento quando elas existem: uma feira é evento com calendário.
  const meses =
    feira.arrivesAt && feira.targetAt
      ? Math.max(1, Math.round((feira.targetAt.getTime() - feira.arrivesAt.getTime()) / (30 * 86_400_000)))
      : 6;
  const productPlans = await plans(365, undefined, 'principal');
  const estrategia = buildCommercialStrategy(productPlans, {
    floorUnits: feira.floorUnits,
    windowMonths: meses,
    risk: (feira.risk as 'conservador' | 'equilibrado' | 'agressivo') ?? 'equilibrado',
  });

  const metas = Object.fromEntries(estrategia.segments.map((s) => [s.key, s.units])) as Record<
    SegmentoDoPlano,
    number
  >;
  const comPreco = candidatos.filter((c) => c.unitPrice > 0);
  const margemMedia = comPreco.length
    ? Math.round((comPreco.reduce((a, c) => a + margemPct(c.unitPrice, c.unitCost), 0) / comPreco.length) * 10) / 10
    : null;

  const plano = montarPlanoDetalhado(candidatos, metas, perfil, (c, seg, units) =>
    explicarLinha(c, seg, units, {
      rankFormato: c.formato ? (rankFormato.get(normBrandKey(c.formato)) ?? null) : null,
      margemMedia,
    }),
  );

  /*
   * A DIVISÃO POR LOJA de uma coleção nova.
   *
   * As peças não têm posição na rede — elas não existem aqui ainda —, então o
   * rateio não pode sair da falta DELAS. Sai da participação de cada loja nas
   * vendas da GRIFE: quem vende mais David Beckham recebe mais David Beckham.
   *
   * E passa pelo porteiro de mix, como todo o resto: grife restrita só entra
   * nas lojas que a trabalham.
   */
  const mix = await porteiroDeMix();
  const porGrife = await posicoesPorGrife(feira.offers.map((o) => o.brand));
  const porLoja = new Map<string, { storeId: string; storeName: string; units: number }>();

  const comDestino = new Map<string, unknown>();
  for (const seg of plano.segmentos) {
    for (const l of seg.linhas) {
      const candidatas = porGrife.get(normBrandKey(l.candidato.brand)) ?? [];
      const { elegiveis, excluidas } = mix.separar(l.candidato.brand, candidatas);
      const rateio = splitByNeed(elegiveis, l.units, JANELA_PADRAO_DIAS);
      const linhas = rateio.rows.filter((r) => r.suggestedQty > 0);
      for (const r of linhas) {
        const atual = porLoja.get(r.storeId) ?? { storeId: r.storeId, storeName: r.storeName, units: 0 };
        atual.units += r.suggestedQty;
        porLoja.set(r.storeId, atual);
      }
      comDestino.set(`${seg.segmento}:${l.candidato.id}`, {
        ...l,
        lojas: linhas,
        semLoja: l.units - linhas.reduce((a, r) => a + r.suggestedQty, 0),
        ...(excluidas.length > 0 ? { excludedByMix: excluidas.map((e) => e.storeName) } : {}),
      });
    }
  }

  const comprado = feira.offers.reduce((a, o) => a + o.bought, 0);
  return {
    feira: {
      id: feira.id,
      supplier: feira.supplier,
      collection: feira.collection,
      arrivesAt: feira.arrivesAt?.toISOString() ?? null,
      targetAt: feira.targetAt?.toISOString() ?? null,
      floorUnits: feira.floorUnits,
      risk: feira.risk,
      status: feira.status,
      ofertas: feira.offers.length,
      /** O que já foi lançado no balcão — persistido, não guardado no navegador. */
      comprado,
    },
    ...estrategia,
    detalhe: {
      ...plano,
      segmentos: plano.segmentos.map((s) => ({
        ...s,
        linhas: s.linhas.map((l) => comDestino.get(`${s.segmento}:${l.candidato.id}`) ?? l),
      })),
      porLoja: [...porLoja.values()].sort((a, b) => b.units - a.units),
      days: JANELA_PADRAO_DIAS,
      candidatosExaminados: candidatos.length,
      universo: candidatos.length,
      truncado: false,
      motivo:
        plano.naoAlocado > 0
          ? `${plano.naoAlocado} un. do piso não couberam na oferta desta feira sem concentrar ` +
            `demais em poucas peças. A oferta tem ${candidatos.length} ` +
            `${candidatos.length === 1 ? 'peça' : 'peças'}; o lastro do perfil vem de ` +
            `${pecasComGiro} peças com giro na rede.`
          : '',
    },
  };
}

/**
 * Participação de cada loja nas vendas de cada GRIFE — o peso do rateio quando
 * a peça em si não existe na rede.
 */
async function posicoesPorGrife(marcas: string[]) {
  const chaves = new Set(marcas.map((m) => normBrandKey(m)));
  const productPlans = await plans(365, undefined, 'principal');
  const doInteresse = productPlans.filter((p) =>
    chaves.has(normBrandKey(p.brand ?? '')) || chaves.has(normBrandKey(p.description.split(/\s+/)[0] ?? '')),
  );
  const posicoes = await posicoesPorLoja(doInteresse.map((p) => p.productId), 365);

  // Soma as posições de todas as peças da grife: o que interessa é a força de
  // cada loja NAQUELA grife, não naquela peça.
  const porGrife = new Map<string, Map<string, { storeId: string; storeName: string; unitsSold: number; stockUnits: number }>>();
  for (const p of doInteresse) {
    const chave = chaves.has(normBrandKey(p.brand ?? ''))
      ? normBrandKey(p.brand ?? '')
      : normBrandKey(p.description.split(/\s+/)[0] ?? '');
    const alvo = porGrife.get(chave) ?? new Map();
    for (const pos of posicoes.get(p.productId) ?? []) {
      const atual = alvo.get(pos.storeId) ?? {
        storeId: pos.storeId,
        storeName: pos.storeName,
        unitsSold: 0,
        stockUnits: 0,
      };
      atual.unitsSold += pos.unitsSold;
      atual.stockUnits += pos.stockUnits;
      alvo.set(pos.storeId, atual);
    }
    porGrife.set(chave, alvo);
  }
  return new Map([...porGrife.entries()].map(([k, v]) => [k, [...v.values()]]));
}

/** Lança a compra de uma linha — o dado que não se recalcula. */
export async function registrarCompra(offerId: string, bought: number) {
  if (!Number.isInteger(bought) || bought < 0) throw badRequest('Quantidade inválida.');
  const oferta = await prisma.purchaseFairOffer.update({
    where: { id: offerId },
    data: { bought },
    select: { id: true, sku: true, bought: true, fairId: true },
  });
  return oferta;
}

/** As feiras cadastradas, mais recentes primeiro. */
export async function listarFeiras() {
  const rows = await prisma.purchaseFair.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { _count: { select: { offers: true } } },
  });
  return {
    rows: rows.map((f) => ({
      id: f.id,
      supplier: f.supplier,
      collection: f.collection,
      floorUnits: f.floorUnits,
      risk: f.risk,
      status: f.status,
      arrivesAt: f.arrivesAt?.toISOString() ?? null,
      targetAt: f.targetAt?.toISOString() ?? null,
      ofertas: f._count.offers,
      createdAt: f.createdAt.toISOString(),
    })),
  };
}
