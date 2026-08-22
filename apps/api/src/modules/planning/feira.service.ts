import { prisma } from '../../lib/prisma.js';
import { badRequest, notFound, toNumber } from '../../http/helpers.js';
import {
  TETO_POR_LINHA_PCT,
  buildCommercialStrategy,
  chaveDePerfil,
  classificarCandidato,
  explicarLinha,
  familiaDePeca,
  familiasComGiro,
  margemPct,
  montarPlanoDetalhado,
  normBrandKey,
  splitByNeed,
  type CandidatoDeCompra,
  type PerfilQueVende,
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
  const productPlans = await plans(365, undefined, 'principal');

  /*
   * A REPOSIÇÃO DENTRO DA FEIRA.
   *
   * Nem toda peça de uma coleção é nova: o fornecedor leva à feira as
   * referências que continuam em linha, e essas a rede JÁ VENDE. Tratar a
   * oferta inteira como novidade jogava fora o dado mais forte que existe —
   * giro medido da própria peça — e deixava o balde de best-seller vazio por
   * construção, ou seja, 45% do piso estruturalmente sem alocar em toda feira.
   *
   * O casamento é EXATO, por SKU ou código do ERP. Aproximar por descrição
   * inventaria best-seller: uma peça marcada como "já vende" sem vender é o
   * erro caro desta tela, porque manda comprar em cima de um giro que não
   * existe.
   */
  const refs = feira.offers.flatMap((o) => [o.sku, o.sku.toUpperCase(), o.sku.trim()]);
  const doCatalogo = await prisma.product.findMany({
    where: { OR: [{ sku: { in: refs } }, { externalId: { in: refs } }] },
    select: { id: true, sku: true, externalId: true },
  });
  const planoPor = new Map(productPlans.map((p) => [p.productId, p]));
  const conhecidaPorSku = new Map<string, (typeof productPlans)[number]>();
  for (const p of doCatalogo) {
    const plano = planoPor.get(p.id);
    if (!plano) continue;
    for (const chave of [p.sku, p.externalId]) {
      if (chave) conhecidaPorSku.set(chave.trim().toUpperCase(), plano);
    }
  }

  const candidatos: CandidatoDeCompra[] = feira.offers.map((o) => {
    const conhecida = conhecidaPorSku.get(o.sku.trim().toUpperCase());
    return {
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
      // A peça que a rede já vende entra com o giro DELA; a que é novidade
      // entra zerada, e é isso que joga a decisão para o perfil.
      unitsSold: conhecida?.unitsSold ?? 0,
      currentStock: conhecida?.currentStock ?? 0,
      coberturaDaGrifeMeses:
        conhecida?.coverageDays == null ? null : Math.round((conhecida.coverageDays / 30) * 10) / 10,
      // Sem absorção medida a peça nova não ganha teto próprio: não há
      // histórico DELA para dizer quanto escoa, e inventar uma absorção seria
      // transformar ausência de dado em permissão. A conhecida tem.
      absorcao: conhecida ? Math.max(0, Math.round(conhecida.targetStock - conhecida.currentStock)) : null,
    };
  });
  const jaVendidas = candidatos.filter((c) => c.unitsSold > 0).length;
  /** Das que a rede já vende, quantas ainda têm espaço abaixo do alvo. */
  const comEspaco = candidatos.filter((c) => c.unitsSold > 0 && (c.absorcao ?? 0) > 0).length;

  // A estratégia roda sobre a mesma matemática do contínuo. `windowMonths` sai
  // das datas do evento quando elas existem: uma feira é evento com calendário.
  const meses =
    feira.arrivesAt && feira.targetAt
      ? Math.max(1, Math.round((feira.targetAt.getTime() - feira.arrivesAt.getTime()) / (30 * 86_400_000)))
      : 6;
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

  // O que já foi lançado no balcão, por linha. Vai junto com o plano porque é
  // exatamente a comparação que o comprador precisa fazer de pé na feira:
  // sugeri 16, levei 20.
  const compradoPorOferta = new Map(feira.offers.map((o) => [o.id, o.bought]));

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
        comprado: compradoPorOferta.get(l.candidato.id) ?? 0,
        ...(excluidas.length > 0 ? { excludedByMix: excluidas.map((e) => e.storeName) } : {}),
      });
    }
  }

  const comprado = feira.offers.reduce((a, o) => a + o.bought, 0);
  const compradoNoPlano = plano.segmentos.reduce(
    (a, s) => a + s.linhas.reduce((b, l) => b + (compradoPorOferta.get(l.candidato.id) ?? 0), 0),
    0,
  );
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
      /**
       * Do que foi comprado, quanto saiu de linha que o plano sugeriu. A
       * diferença para `comprado` é o que o comprador levou POR FORA do plano —
       * e essa diferença é informação, não erro: a feira tem peça que só se vê
       * no balcão. O que não pode é a conta sumir.
       */
      compradoNoPlano,
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
      motivo: [
        avisoDeVocabulario(candidatos, perfil),
        motivoDoPlano(plano, candidatos, perfil, { jaVendidas, comEspaco, pecasComGiro }),
      ]
        .filter(Boolean)
        .join(' '),
      /** Quantas peças da oferta a rede já vende — reposição dentro da feira. */
      jaVendidas,
    },
  };
}

/**
 * O ALARME DO VOCABULÁRIO — a ponte falhando ALTO em vez de baixo.
 *
 * Quando o tipo da oferta não casa com nada do histórico, o sintoma é sempre o
 * mesmo e é silencioso: as peças não acham lastro, caem em aposta, e o plano
 * informa que a compra é especulação sem dizer que na verdade não conseguiu ler
 * o tipo. Já aconteceu com quatro grafias diferentes nesta base ("oculos de
 * sol" vs. "solar", "OCULOS" sozinho). A quinta não vai ser prevista por regex
 * nenhuma — então o plano compara as famílias dos dois lados e DIZ.
 */
function avisoDeVocabulario(
  candidatos: CandidatoDeCompra[],
  perfil: PerfilQueVende,
): string {
  const comGiro = familiasComGiro(perfil);
  if (comGiro.size === 0) return '';

  const pecasPorFamilia = new Map<string, number>();
  for (const c of candidatos) {
    const f = familiaDePeca(c.tipo);
    if (f) pecasPorFamilia.set(f, (pecasPorFamilia.get(f) ?? 0) + 1);
  }
  const orfas = [...pecasPorFamilia.entries()].filter(([f]) => !comGiro.has(f));
  if (orfas.length === 0) return '';

  const pecas = orfas.reduce((a, [, n]) => a + n, 0);
  const nomes = orfas.map(([f]) => `“${f}”`).join(', ');
  return (
    `${pecas} ${pecas === 1 ? 'peça da oferta pertence a uma família' : 'peças da oferta pertencem a famílias'} ` +
    `sem histórico na rede (${nomes}) — ${pecas === 1 ? 'ela cai' : 'elas caem'} em aposta por falta de lastro, ` +
    'não por avaliação. Se essas peças deveriam ter comparação, o tipo da planilha está escrito de um jeito ' +
    'que o cadastro da rede não usa; me diga o termo exato e a ponte passa a reconhecê-lo.'
  );
}

/**
 * O BEST-SELLER VAZIO — o motivo estrutural, dito com o nome certo.
 *
 * O perfil de risco reserva a maior fatia do piso para "reposição do que já
 * vende". Numa coleção inteiramente nova não existe o que repor: nenhuma peça
 * da oferta tem giro próprio, e essa fatia fica vazia por construção, não por
 * cálculo. Dizer "não coube sem concentrar demais em poucas peças" ali seria
 * dar o motivo errado para o comprador — ele sairia procurando na oferta uma
 * peça que o motor tivesse recusado, e não há nenhuma.
 */
const ROTULO: Record<SegmentoDoPlano, string> = {
  'best-seller': 'best-seller',
  lancamento: 'lançamento',
  aposta: 'aposta',
};

/**
 * O MOTIVO DO QUE NÃO COUBE — segmento a segmento, com o motivo de cada um.
 *
 * O perfil de risco divide o piso em três fatias antes de olhar a oferta, e
 * numa feira duas delas ficam vazias por NATUREZA e não por cálculo: uma
 * coleção nova não tem o que repor (best-seller), e uma coleção cujo perfil
 * inteiro já roda na rede não tem o que especular (aposta). Nos dois casos há
 * unidades sobrando, e o motivo genérico — "não couberam sem concentrar demais
 * em poucas peças" — manda o comprador procurar na oferta uma peça que o motor
 * tivesse recusado. Não há nenhuma, e ele perde a tarde conferindo.
 *
 * Cada fatia que não fecha explica a SUA razão. É a mesma exigência que a aba
 * de distribuição pagou caro para aprender: tela que mostra menos do que se
 * esperava sem dizer por quê é lida como defeito.
 */
function motivoDoPlano(
  plano: { segmentos: { segmento: SegmentoDoPlano; meta: number; alocado: number }[]; naoAlocado: number },
  candidatos: CandidatoDeCompra[],
  perfil: PerfilQueVende,
  ctx: { jaVendidas: number; comEspaco: number; pecasComGiro: number },
): string {
  if (plano.naoAlocado <= 0) return '';

  const candidatosPor = new Map<SegmentoDoPlano, number>();
  for (const c of candidatos) {
    const s = classificarCandidato(c, perfil);
    candidatosPor.set(s, (candidatosPor.get(s) ?? 0) + 1);
  }

  const partes: string[] = [];
  for (const seg of plano.segmentos) {
    const falta = seg.meta - seg.alocado;
    if (falta <= 0) continue;
    const quantas = candidatosPor.get(seg.segmento) ?? 0;
    partes.push(`${falta} un. de ${ROTULO[seg.segmento]}: ${porQue(seg.segmento, quantas, ctx)}`);
  }
  if (partes.length === 0) return '';

  return (
    `${plano.naoAlocado} un. do piso ficaram sem destino. ${partes.join('; ')}. ` +
    'Um perfil de risco diferente redistribui essas fatias entre os três cenários.'
  );
}

/** A razão de UMA fatia não ter fechado. */
function porQue(
  segmento: SegmentoDoPlano,
  candidatos: number,
  ctx: { jaVendidas: number; comEspaco: number; pecasComGiro: number },
): string {
  if (candidatos === 0) {
    if (segmento === 'best-seller') {
      return (
        'nenhuma peça desta oferta tem giro na rede — é coleção nova, e não há o que repor. Se o ' +
        'fornecedor traz referências que você já vende, elas entram por aqui assim que o SKU da planilha ' +
        'for o mesmo do cadastro'
      );
    }
    if (segmento === 'aposta') {
      // O oposto do medo: todo o resto encontrou lastro, e não sobrou nada
      // genuinamente especulativo para comprar.
      return 'toda peça da oferta encontrou lastro no histórico da rede — não sobrou especulação a fazer';
    }
    return (
      `nenhuma peça da oferta tem perfil que já rode na rede (o lastro vem de ${ctx.pecasComGiro} peças ` +
      'com giro)'
    );
  }
  if (segmento === 'best-seller' && ctx.comEspaco === 0) {
    // Há o que repor, e a resposta é não repor. Comprar de novo o que já passou
    // do alvo é exatamente o defeito que este console existe para evitar.
    return (
      `${ctx.jaVendidas === 1 ? 'a única peça' : `as ${ctx.jaVendidas} peças`} desta oferta que a rede já ` +
      `vende ${ctx.jaVendidas === 1 ? 'está' : 'estão'} com estoque acima do alvo de cobertura — comprar ` +
      'mais na feira aumentaria o excesso em vez de repor'
    );
  }
  return (
    `as ${candidatos} ${candidatos === 1 ? 'peça elegível chegou' : 'peças elegíveis chegaram'} ao teto de ` +
    `${TETO_POR_LINHA_PCT}% por linha — o resto concentraria a compra em poucos modelos`
  );
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
