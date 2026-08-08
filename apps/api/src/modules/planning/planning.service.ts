import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { publish } from '../../lib/eventBus.js';
import { badRequest, toNumber } from '../../http/helpers.js';
import { PLANNED_STORE_WHERE, plannedStoreSql, stockPlannedWhere } from '../stores/store.scope.js';
import { computeLiveStock, liveDeltas } from '../stock/stock.service.js';
import { loadBrandCatalog } from './brandCatalog.js';
import { currentDecisions, DECISION_SLA_DAYS } from './decisions.service.js';
import { cardHistories, latestBatch, recordGenerationBatch } from './batches.service.js';
import {
  analysisBrand,
  analyzeProduct,
  annotateCardAges,
  buildCommercialStrategy,
  buildDecisionCards,
  buildFairSplit,
  buildOverview,
  buildPurchaseOrders,
  buildRebalance,
  buildSuggestions,
  supplierFor,
  storeCarriesBrand,
  DEFAULT_PLANNING_CONFIG,
  matchesProductGroup,
  normBrandKey,
  type FairSplitInput,
  type PlanningConfig,
  type DemandHistory,
  type ProductGroup,
  type ProductMetricsInput,
  type ProductPlan,
  type StoreProductInput,
} from './planning.math.js';

function periodStart(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Prazos por fornecedor (marca): devolve uma função brand → config, com o
 * padrão da rede como fallback. Cada fornecedor entrega num prazo próprio,
 * então o ponto de reposição e o "pedir até" variam por marca.
 */
async function supplierConfigResolver(): Promise<(brand: string | null) => PlanningConfig> {
  const settings = await prisma.supplierSetting.findMany();
  const byBrand = new Map(settings.map((s) => [s.brand, s.leadTimeDays]));
  return (brand) => {
    const leadTimeDays = brand !== null ? byBrand.get(brand) : undefined;
    return leadTimeDays === undefined
      ? DEFAULT_PLANNING_CONFIG
      : { ...DEFAULT_PLANNING_CONFIG, leadTimeDays };
  };
}

/**
 * Grifes fora do mix atual da rede (feedback 6.0 · item 03). Devolve um
 * predicado que aceita qualquer forma da marca — o campo `brand` do ERP é o
 * FORNECEDOR e vem vazio na maior parte do catálogo, então quem manda é a
 * grife extraída da descrição, e a comparação é normalizada (maiúscula, sem
 * acento) para "Dolce & Gabbana" casar com "DOLCE E GABBANA".
 */
export async function discontinuedBrandResolver(): Promise<(brand: string | null) => boolean> {
  const rows = await prisma.brandMix.findMany({
    where: { discontinued: true },
    select: { brand: true },
  });
  if (rows.length === 0) return () => false;
  const fora = new Set(rows.map((r) => normBrandKey(r.brand)));
  return (brand) => (brand ? fora.has(normBrandKey(brand)) : false);
}

/**
 * Coleta, por produto, os insumos de planejamento no escopo (rede ou loja):
 * unidades vendidas no período, estoque atual, custo e preço.
 * Quando o custo não está preenchido, estima-se 55% do preço (margem típica).
 */
export async function planningInputs(
  days: number,
  storeId?: string,
  group: ProductGroup = 'todos',
): Promise<ProductMetricsInput[]> {
  // GMAIS e outros CDs ficam fora da matemática (escopo de lojas planejáveis).
  const saleFilter: Prisma.SaleWhereInput = { saleDate: { gte: periodStart(days) }, store: PLANNED_STORE_WHERE };
  if (storeId) saleFilter.storeId = storeId;

  const sold = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: { sale: saleFilter, productId: { not: null } },
    _sum: { quantity: true },
  });
  const soldBy = new Map(sold.map((s) => [s.productId as string, s._sum.quantity ?? 0]));

  const stockWhere: Prisma.StockItemWhereInput = { ...stockPlannedWhere };
  if (storeId) stockWhere.storeId = storeId;
  const stock = await prisma.stockItem.groupBy({
    by: ['productId'],
    where: stockWhere,
    _sum: { quantity: true },
  });
  const stockBy = new Map(stock.map((s) => [s.productId, s._sum.quantity ?? 0]));

  // Janela recente (até 30 dias) para a suavização com peso recente.
  const recentDays = Math.min(30, days);
  const recentFilter: Prisma.SaleWhereInput = { saleDate: { gte: periodStart(recentDays) }, store: PLANNED_STORE_WHERE };
  if (storeId) recentFilter.storeId = storeId;
  const soldRecent = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: { sale: recentFilter, productId: { not: null } },
    _sum: { quantity: true },
  });
  const recentBy = new Map(soldRecent.map((r) => [r.productId as string, r._sum.quantity ?? 0]));

  // Vendas dos ÚLTIMOS 12 MESES, fora da janela de análise.
  //
  // É o insumo que faltava para o motor distinguir "não vende" de "não vendeu
  // nestes 90 dias" (feedback 6.0 · itens 02 e 03). Não dá para derivá-lo da
  // previsão: `forecastDemand` monta a base a partir de `recentUnits` e
  // `priorUnits`, os dois medidos DENTRO da janela, e o índice sazonal
  // multiplica essa base — zero vezes qualquer índice continua zero.
  //
  // Escopo de loja proposital: quando o gestor olha a própria loja, "vende no
  // ano" é vender NAQUELA loja.
  const anualFilter: Prisma.SaleWhereInput = { saleDate: { gte: periodStart(365) }, store: PLANNED_STORE_WHERE };
  if (storeId) anualFilter.storeId = storeId;

  const ids = Array.from(new Set([...soldBy.keys(), ...stockBy.keys()]));
  const [products, onOrderBy, monthlyBy, anualRows, foraDoMix] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        description: true,
        brand: true,
        category: true,
        price: true,
        cost: true,
        // Data de cadastro no ERP (`data_cadastro`): a única evidência de
        // idade que temos da fonte. `createdAt` local não serve — a primeira
        // carga escreveu o catálogo inteiro no mesmo instante.
        includedAt: true,
      },
    }),
    onOrderQuantities(),
    monthlyHistoryByProduct(storeId),
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: anualFilter, productId: { not: null } },
      _sum: { quantity: true },
    }),
    discontinuedBrandResolver(),
  ]);
  const anualBy = new Map(anualRows.map((r) => [r.productId as string, r._sum.quantity ?? 0]));

  const agora = Date.now();
  const currentMonth = new Date().getMonth() + 1;
  // Recorte de cobertura: principal (óculos/grau/relógio), lentes ou tudo.
  const scoped = products.filter((p) => matchesProductGroup(p.category, group));
  return scoped.map((p) => {
    const price = toNumber(p.price) ?? 0;
    // O valor de compra vem do ERP em parte do catálogo. Onde falta, estimamos
    // — e marcamos, porque é ele que define o TETO do desconto de liquidação.
    const custoReal = toNumber(p.cost);
    const cost = custoReal ?? round2(price * 0.55);
    const unitsSold = soldBy.get(p.id) ?? 0;
    const recentUnits = Math.min(recentBy.get(p.id) ?? 0, unitsSold);
    const demandHistory: DemandHistory = {
      recentUnits,
      recentDays,
      priorUnits: unitsSold - recentUnits,
      priorDays: Math.max(0, days - recentDays),
      monthlyHistory: monthlyBy.get(p.id) ?? [],
      currentMonth,
    };
    return {
      productId: p.id,
      description: p.description,
      brand: p.brand,
      category: p.category,
      unitsSold,
      currentStock: stockBy.get(p.id) ?? 0,
      unitCost: cost,
      unitPrice: price,
      costEstimated: custoReal == null,
      onOrderQty: onOrderBy.get(p.id) ?? 0,
      demandHistory,
      annualUnitsSold: anualBy.get(p.id) ?? 0,
      // Sem `includedAt` o motor fica sem saber a idade e NÃO trata a peça como
      // nova — preferimos deixar passar um card de liquidação a suprimir um
      // encalhe real por falta de dado.
      ageDays: p.includedAt ? Math.floor((agora - p.includedAt.getTime()) / 86_400_000) : null,
      // O mix é da GRIFE (extraída da descrição), não do campo de fornecedor
      // do ERP — que vem vazio na maior parte do catálogo.
      brandDiscontinued: foraDoMix(analysisBrand(p.description, p.category, p.brand)),
    };
  });
}

/**
 * Histórico mensal de vendas por produto (até 24 meses), para o índice
 * sazonal: um bucket por (produto, ano-mês) com o mês calendário e as
 * unidades vendidas.
 */
async function monthlyHistoryByProduct(
  storeId?: string,
): Promise<Map<string, { month: number; units: number }[]>> {
  const rows = await prisma.$queryRaw<{ pid: string; month: number; units: number }[]>(
    storeId
      ? Prisma.sql`
          SELECT si."productId" AS pid,
                 EXTRACT(MONTH FROM s."saleDate")::int AS month,
                 SUM(si.quantity)::int AS units
          FROM "SaleItem" si
          JOIN "Sale" s ON s.id = si."saleId"
          WHERE si."productId" IS NOT NULL
            AND s."saleDate" >= NOW() - INTERVAL '24 months'
            AND s."storeId" = ${storeId}
          GROUP BY pid, to_char(s."saleDate", 'YYYY-MM'), month`
      : Prisma.sql`
          SELECT si."productId" AS pid,
                 EXTRACT(MONTH FROM s."saleDate")::int AS month,
                 SUM(si.quantity)::int AS units
          FROM "SaleItem" si
          JOIN "Sale" s ON s.id = si."saleId"
          JOIN "Store" st ON st.id = s."storeId" AND ${plannedStoreSql('st')}
          WHERE si."productId" IS NOT NULL
            AND s."saleDate" >= NOW() - INTERVAL '24 months'
          GROUP BY pid, to_char(s."saleDate", 'YYYY-MM'), month`,
  );
  const byProduct = new Map<string, { month: number; units: number }[]>();
  for (const r of rows) {
    const list = byProduct.get(r.pid) ?? [];
    list.push({ month: r.month, units: r.units });
    byProduct.set(r.pid, list);
  }
  return byProduct;
}

/** Snapshot de item dentro do JSON de um pedido registrado. */
interface RecordItem {
  productId: string;
  description: string;
  quantity: number;
  unitCost: number;
  total: number;
}

/** Unidades a caminho por produto (pedidos ENVIADOS e não recebidos). */
async function onOrderQuantities(): Promise<Map<string, number>> {
  const sent = await prisma.purchaseOrderRecord.findMany({
    where: { status: 'SENT' },
    select: { items: true },
  });
  const byProduct = new Map<string, number>();
  for (const rec of sent) {
    for (const it of (rec.items as unknown as RecordItem[]) ?? []) {
      if (!it?.productId || !Number.isFinite(it.quantity)) continue;
      byProduct.set(it.productId, (byProduct.get(it.productId) ?? 0) + it.quantity);
    }
  }
  return byProduct;
}

async function plans(days: number, storeId?: string, group: ProductGroup = 'todos'): Promise<ProductPlan[]> {
  const [inputs, cfgFor] = await Promise.all([
    planningInputs(days, storeId, group),
    supplierConfigResolver(),
  ]);
  return inputs.map((i) => analyzeProduct(i, days, cfgFor(i.brand)));
}

/** Panorama de capital imobilizado + Pareto (80/20) da receita. */
export async function planningOverview(days: number, storeId?: string, group: ProductGroup = 'todos') {
  return buildOverview(await plans(days, storeId, group), days);
}

/** Recomendações de compra (comprar / manter / não comprar / liquidar). */
export async function purchaseSuggestions(days: number, storeId?: string, group: ProductGroup = 'todos') {
  return buildSuggestions(await plans(days, storeId, group), days);
}

/**
 * Posições por loja (venda no período + estoque atual) das peças informadas —
 * o insumo do rateio por necessidade na aba de compras.
 *
 * Uma consulta agregada por `productId IN (...)`, de propósito: o
 * `findMany` de `rebalancePlan` traz uma linha de SaleItem por VENDA, o que na
 * base real são centenas de milhares de linhas para depois somar em memória.
 * Aqui o recorte é fechado (só os SKUs com recomendação de COMPRA) e a soma é
 * do banco, então o que trafega é da ordem de itens × lojas.
 */
async function posicoesPorLoja(productIds: string[], days: number): Promise<Map<string, FairSplitInput[]>> {
  const posicoes = new Map<string, FairSplitInput[]>();
  if (productIds.length === 0) return posicoes;

  const [lojas, vendas, estoques] = await Promise.all([
    prisma.store.findMany({ where: PLANNED_STORE_WHERE, select: { id: true, name: true } }),
    prisma.$queryRaw<{ storeId: string; productId: string; units: number }[]>(Prisma.sql`
      SELECT s."storeId" AS "storeId", si."productId" AS "productId", SUM(si.quantity)::int AS units
      FROM "SaleItem" si
      JOIN "Sale" s ON s.id = si."saleId"
      JOIN "Store" lo ON lo.id = s."storeId" AND ${plannedStoreSql('lo')}
      WHERE si."productId" IN (${Prisma.join(productIds)}) AND s."saleDate" >= ${periodStart(days)}
      GROUP BY s."storeId", si."productId"
    `),
    prisma.stockItem.findMany({
      where: { productId: { in: productIds }, store: PLANNED_STORE_WHERE },
      select: { storeId: true, productId: true, quantity: true },
    }),
  ]);

  const vendaPor = new Map(vendas.map((v) => [`${v.productId}:${v.storeId}`, Math.max(0, v.units)]));
  const estoquePor = new Map(estoques.map((e) => [`${e.productId}:${e.storeId}`, e.quantity]));
  for (const id of productIds) {
    posicoes.set(
      id,
      lojas.map((l) => ({
        storeId: l.id,
        storeName: l.name,
        unitsSold: vendaPor.get(`${id}:${l.id}`) ?? 0,
        stockUnits: estoquePor.get(`${id}:${l.id}`) ?? 0,
      })),
    );
  }
  return posicoes;
}

/**
 * Rascunhos de ordem de compra agrupados pelo fornecedor canônico (catálogo),
 * cada item já rateado entre as lojas quando `comRateio` é verdadeiro.
 *
 * `comRateio` é falso para quem não é ADMIN — ver o comentário da rota
 * `GET /planning/purchase-orders` em planning.routes.ts, que explica a decisão.
 *
 * O default é FALSO, e é o inverso do que era. Fail-open aqui não protege
 * ninguém: quem quer o rateio pede, e quem não pede não paga a conta. Com o
 * default aberto, `publishPlanningAlert(90)` — que usa só os contadores do
 * resumo — disparava a consulta de posições a cada sincronização do ERP e
 * jogava o resultado fora. Custo invisível é o pior tipo: não erra a saída,
 * então nada o denuncia.
 */
export async function purchaseOrders(
  days: number,
  storeId?: string,
  group: ProductGroup = 'todos',
  comRateio = false,
) {
  const [productPlans, catalog] = [await plans(days, storeId, group), loadBrandCatalog()];
  // Com catálogo, agrupa pelo fornecedor canônico da grife (Kering, Marcolin…);
  // sem ele, cai no campo "marca" do ERP (comportamento anterior).
  // `analysisBrand` e não `extractBrand(...) ?? p.brand`: é a mesma regra,
  // escrita uma vez só, e leva junto as duas correções que a forma à mão não
  // tinha — a CATEGORIA (uma lente parava de ser lida como grife) e o
  // descarte do "—", que o CDS usa como fornecedor vazio e que ia parar no
  // catálogo como se fosse um nome.
  const resolve = catalog
    ? (p: ProductPlan) => supplierFor(analysisBrand(p.description, p.category, p.brand), catalog)
    : undefined;
  // COM FILTRO DE LOJA NÃO HÁ RATEIO, e não é economia: é que não existe o que
  // repartir. `plans` escopa venda E estoque à loja filtrada, então
  // `suggestedQty` já é a compra DAQUELA loja. Ratear esse número entre a rede
  // endereçava mercadoria a lojas cuja demanda nem entrou na conta — no dado
  // real, 3 das 5 unidades pedidas por causa de uma loja iam para outras três.
  //
  // Escopar as posições também não serve: daria 100% para a loja filtrada, que
  // é um número certo apresentado como se fosse uma decisão. A tela diz, em uma
  // linha, que o rateio vive na visão da rede.
  //
  // Só os SKUs que viram item de pedido entram na consulta de posições: o
  // recorte pode ter dezenas de milhares de peças, e a esmagadora maioria não
  // tem nada a distribuir.
  const posicoes =
    comRateio && !storeId
      ? await posicoesPorLoja(
          productPlans.filter((p) => p.recommendation === 'BUY' && p.suggestedQty > 0).map((p) => p.productId),
          days,
        )
      : undefined;
  return buildPurchaseOrders(productPlans, days, resolve, posicoes);
}

/**
 * Feed unificado de cards de decisão (compra + remanejamento + liquidação),
 * com tipo, prioridade e impacto — a visualização de "portal de decisões".
 * Compra/liquidação respeitam o recorte de loja; o remanejamento é de rede.
 */
export async function decisionBoard(days: number, storeId?: string, group: ProductGroup = 'principal') {
  const generated = await generateCards(days, storeId, group);
  const ids = generated.cards.map((c) => c.id);

  // O board final sai sem os cards com decisão registrada (senão o gestor
  // decide o mesmo card toda vez que o motor roda, e a trilha de auditoria não
  // serve para nada), e com a idade de cada um vinda do lote de geração.
  const [decided, history, batch] = await Promise.all([
    currentDecisions(ids),
    cardHistories(ids),
    latestBatch(),
  ]);

  const open = buildDecisionCards(
    generated.plans,
    generated.rebalance,
    new Set(decided.keys()),
    generated.positions,
    generated.brandPositions,
  );
  return annotateCardAges(open, history, batch, DECISION_SLA_DAYS);
}

/**
 * Todos os cards que o motor gera agora, SEM filtrar os já decididos — é o que
 * o lote de geração registra. O board filtra depois; o lote precisa da foto
 * completa, senão um card decidido sumiria do histórico de aparições.
 */
export async function generateCards(days: number, storeId?: string, group: ProductGroup = 'principal') {
  const [productPlans, reb] = await Promise.all([
    plans(days, storeId, group),
    rebalancePlan(days, group),
  ]);
  // Posições por loja: alimentam o destino de escoamento dos cards de
  // liquidação ("remanejar para onde?"). Vêm do mesmo plano de remanejamento,
  // então não custam consulta nova.
  const posicoes = new Map<
    string,
    { storeId: string; storeName: string; unitsSold: number; currentStock: number }[]
  >();
  for (const r of reb.inputs ?? []) {
    const lista = posicoes.get(r.productId) ?? [];
    lista.push({
      storeId: r.storeId,
      storeName: r.storeName,
      unitsSold: r.unitsSold,
      currentStock: r.currentStock,
    });
    posicoes.set(r.productId, lista);
  }
  // Reserva por marca: a maioria dos cards de liquidação é estoque morto, sem
  // venda própria em loja nenhuma.
  const porMarca = new Map<
    string,
    { storeId: string; storeName: string; unitsSold: number; currentStock: number }[]
  >();
  for (const r of reb.inputs ?? []) {
    // Agrupa pela marca de ANÁLISE (grife da descrição), não pelo campo de
    // fornecedor — que vem vazio na maior parte do catálogo real e faria um
    // balde único com produtos de marcas diferentes.
    const marca = analysisBrand(r.description, r.category ?? null, r.brand);
    if (!marca) continue;
    const lista = porMarca.get(marca) ?? [];
    const atual = lista.find((x) => x.storeId === r.storeId);
    if (atual) {
      atual.unitsSold += r.unitsSold;
      atual.currentStock += r.currentStock;
    } else {
      lista.push({
        storeId: r.storeId,
        storeName: r.storeName,
        unitsSold: r.unitsSold,
        currentStock: r.currentStock,
      });
    }
    porMarca.set(marca, lista);
  }
  const board = buildDecisionCards(productPlans, reb.rows, undefined, posicoes, porMarca);
  return {
    ...board,
    plans: productPlans,
    rebalance: reb.rows,
    positions: posicoes,
    brandPositions: porMarca,
  };
}

/**
 * Registra o lote da execução do motor. Chamado ao fim de cada sincronização —
 * o lote nasce do cron das 06h; sync manual também gera lote, marcado como
 * MANUAL para não sujar a leitura da série.
 */
export async function recordPlanningBatch(trigger: string, days = 90): Promise<void> {
  const generated = await generateCards(days);
  await recordGenerationBatch(generated.cards, { trigger, days });
}

/**
 * Motor de estratégia comercial: valida o piso de compra contra a capacidade
 * (demanda projetada da rede na janela) e divide em segmentos por risco.
 * Roda sobre o recorte operacional ('principal': óculos + relógio).
 */
export async function commercialStrategy(
  days: number,
  params: { floorUnits: number; windowMonths: number; risk: 'conservador' | 'equilibrado' | 'agressivo' },
  storeId?: string,
) {
  const productPlans = await plans(days, storeId, 'principal');
  return buildCommercialStrategy(productPlans, params);
}

/**
 * Notificação proativa: após cada sincronização, publica um evento em tempo
 * real quando há itens no ponto de reposição (pedir hoje) — o painel exibe
 * o aviso sem o lojista precisar abrir o Planejamento.
 */
export async function publishPlanningAlert(days = 90): Promise<void> {
  // Sem rateio, EXPLÍCITO: o evento leva só contadores do resumo, e o rateio
  // custa um agregado com um bind param por SKU de compra mais um findMany de
  // estoque — a cada sincronização, para ser descartado. Escrito à mão mesmo
  // com o default já sendo falso, porque quem lê esta linha precisa ver que a
  // ausência é decisão e não esquecimento.
  const po = await purchaseOrders(days, undefined, 'todos', false);
  if (po.summary.items > 0) {
    publish({
      type: 'planning.urgent',
      items: po.summary.items,
      suppliers: po.summary.suppliers,
      total: po.summary.total,
    });
  }
}

/**
 * Redistribuição entre lojas: cruza vendas do período × estoque atual por
 * loja e sugere transferências de onde sobra/está parado para onde vende.
 */
export async function rebalancePlan(days: number, group: ProductGroup = 'todos') {
  const [sold, stock, stores, cfgFor] = await Promise.all([
    prisma.saleItem.findMany({
      where: {
        productId: { not: null },
        sale: { saleDate: { gte: periodStart(days) }, storeId: { not: null }, store: PLANNED_STORE_WHERE },
      },
      select: { productId: true, quantity: true, sale: { select: { storeId: true } } },
    }),
    // `reserved` e `createdAt` entram aqui, e não numa consulta à parte, porque
    // são colunas da MESMA linha que já vem: custo zero de ida ao banco.
    prisma.stockItem.findMany({
      where: stockPlannedWhere,
      select: { storeId: true, productId: true, quantity: true, reserved: true, createdAt: true },
    }),
    prisma.store.findMany({ where: PLANNED_STORE_WHERE, select: { id: true, name: true } }),
    supplierConfigResolver(),
  ]);

  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const key = (storeId: string, productId: string) => `${storeId}:${productId}`;

  const positions = new Map<
    string,
    {
      storeId: string;
      productId: string;
      stock: number;
      sold: number;
      reserved: number;
      /** Criação da POSIÇÃO nesta loja; `null` quando ela nem existe. */
      posicaoDesde: Date | null;
    }
  >();
  for (const s of stock) {
    positions.set(key(s.storeId, s.productId), {
      storeId: s.storeId,
      productId: s.productId,
      stock: s.quantity,
      sold: 0,
      reserved: s.reserved,
      posicaoDesde: s.createdAt,
    });
  }
  for (const it of sold) {
    const sid = it.sale.storeId;
    if (!sid || !it.productId) continue;
    const k = key(sid, it.productId);
    const cur = positions.get(k) ?? {
      storeId: sid,
      productId: it.productId,
      stock: 0,
      sold: 0,
      reserved: 0,
      posicaoDesde: null,
    };
    cur.sold += it.quantity;
    positions.set(k, cur);
  }

  const productIds = Array.from(new Set(Array.from(positions.values()).map((p) => p.productId)));
  const [products, emAberto, deltasAoVivo] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds } },
      // `includedAt` (data_cadastro do ERP) é a segunda metade da idade por
      // loja — ver `idadeNaLoja` logo abaixo.
      select: { id: true, description: true, brand: true, category: true, includedAt: true },
    }),
    // Transferências ainda NÃO efetivadas: a peça continua fisicamente na
    // origem e ainda não chegou no destino. A consulta é por `productId` e
    // `status`, as duas colunas com índice em InventoryMovement; as lojas
    // ficam só na agregação em memória. O conjunto é pequeno por natureza (é
    // fila de operação, não histórico).
    //
    // REQUESTED entra junto de PENDING porque toda transferência criada por
    // gestor de loja nasce REQUESTED e só vira PENDING quando o ADMIN aprova
    // (`decideInitialStatus`). O plano é tela de ADMIN: sem contar esse
    // intervalo, ele reemitia a sugestão idêntica à que a loja acabou de
    // pedir, e a rede passava a ter duas ordens para as mesmas unidades.
    prisma.inventoryMovement.findMany({
      where: {
        status: { in: ['REQUESTED', 'PENDING'] },
        type: 'TRANSFER',
        productId: { in: productIds },
      },
      select: { productId: true, fromStoreId: true, toStoreId: true, quantity: true, status: true },
    }),
    // Transferências já efetivadas e ainda não reconciliadas pela sync: a peça
    // JÁ saiu da origem e JÁ chegou no destino, mesmo que o `StockItem` da
    // última sincronização não saiba disso (`reconcileMovements` só fecha o
    // que tem `confirmedAt` antes do corte, no run seguinte).
    //
    // É o mesmo saldo que a tela de Estoque mostra e que `availableAt` usa
    // para aceitar ou recusar o clique — daí vir da mesma função, e não de uma
    // segunda conta escrita aqui.
    liveDeltas(productIds),
  ]);
  const productBy = new Map(products.map((p) => [p.id, p]));
  const inboundBy = new Map<string, number>();
  const solicitadoBy = new Map<string, number>();
  for (const m of emAberto) {
    if (m.toStoreId) {
      const k = key(m.toStoreId, m.productId);
      inboundBy.set(k, (inboundBy.get(k) ?? 0) + m.quantity);
    }
    // `StockItem.reserved` já soma as saídas PENDING (`recomputeReserved`),
    // então só a parcela REQUESTED precisa ser somada aqui — contar as duas
    // seria reservar a mesma unidade duas vezes.
    if (m.fromStoreId && m.status === 'REQUESTED') {
      const k = key(m.fromStoreId, m.productId);
      solicitadoBy.set(k, (solicitadoBy.get(k) ?? 0) + m.quantity);
    }
  }

  const agora = Date.now();
  /**
   * Idade ESTIMADA da peça naquela loja, em dias — a mais antiga entre a
   * criação da posição de estoque e o cadastro do produto no ERP.
   *
   * É estimativa, e mente para MENOS em três situações conhecidas:
   *  1. o sync apaga toda posição zerada, então peça de três anos que zerou e
   *     voltou à prateleira ganha `createdAt` novo;
   *  2. o recálculo de reservas faz `upsert` com `create`: uma transferência
   *     pendente CRIA a linha de StockItem na loja de ORIGEM com `createdAt`
   *     de agora — a própria sugestão envelhece o carimbo que a rodada
   *     seguinte vai ler;
   *  3. `includedAt` é da REDE, não da loja: peça antiga no catálogo que
   *     acabou de chegar nesta loja parece antiga aqui também.
   *
   * Todas as três erram para o lado de deixar a peça DOAR. É de propósito:
   * `Product.createdAt` local, que erraria para o outro lado, já é recusado
   * pelo planejamento (a primeira carga carimbou o catálogo inteiro no mesmo
   * instante). Preferimos uma sugestão a mais, que o lojista recusa, a uma
   * sugestão a menos, que ele nunca vê. A tela diz que é estimativa.
   */
  const idadeNaLoja = (posicaoDesde: Date | null, includedAt: Date | null): number | null => {
    const marcos = [posicaoDesde, includedAt].filter((d): d is Date => d != null);
    if (marcos.length === 0) return null;
    const maisAntigo = Math.min(...marcos.map((d) => d.getTime()));
    return Math.max(0, Math.floor((agora - maisAntigo) / 86_400_000));
  };

  const inputs: StoreProductInput[] = [];
  for (const pos of positions.values()) {
    const product = productBy.get(pos.productId);
    if (!product) continue;
    if (!matchesProductGroup(product.category, group)) continue;
    // Regra absoluta da rede: lentes não se transferem entre lojas — só óculos
    // de grau/sol e relógio. Vale mesmo no consolidado ('todos').
    if (matchesProductGroup(product.category, 'lentes')) continue;
    const k = key(pos.storeId, pos.productId);
    const reservado = pos.reserved + (solicitadoBy.get(k) ?? 0);
    const { onHand } = computeLiveStock(pos.stock, reservado, deltasAoVivo.get(k) ?? 0);
    inputs.push({
      storeId: pos.storeId,
      storeName: storeName.get(pos.storeId) ?? '—',
      productId: pos.productId,
      description: product.description,
      brand: product.brand,
      category: product.category,
      unitsSold: pos.sold,
      // Saldo AO VIVO, não a quantidade da última sync. Saldo negativo é
      // possível quando a sync já baixou a origem e a movimentação ainda não
      // foi reconciliada; para o planejamento isso é zero, e não uma loja
      // devendo peça — cobertura negativa faria a origem parecer a mais
      // urgente da fila.
      currentStock: Math.max(0, onHand),
      reserved: reservado,
      inboundUnits: inboundBy.get(k) ?? 0,
      ageDays: idadeNaLoja(pos.posicaoDesde, product.includedAt),
    });
  }

  const plan = buildRebalance(inputs, days, cfgFor);

  // Regra de mix: não transferir uma grife premium para uma loja que não a
  // trabalha (catálogo). Marcas correntes (fora do catálogo) valem para todas.
  const catalog = loadBrandCatalog();
  if (catalog) {
    // `analysisBrand` com a categoria, como no resto do motor. O campo
    // `category` existe em `RebalanceSuggestion` exatamente para isto.
    plan.rows = plan.rows.filter((r) =>
      storeCarriesBrand(analysisBrand(r.description, r.category, r.brand), r.toStoreName, catalog),
    );
    const involved = new Set<string>();
    for (const r of plan.rows) {
      involved.add(r.fromStoreId);
      involved.add(r.toStoreId);
    }
    plan.summary = {
      suggestions: plan.rows.length,
      units: plan.rows.reduce((a, r) => a + r.quantity, 0),
      storesInvolved: involved.size,
    };
  }

  // `inputs` sai junto: são as posições por loja de cada produto, que o board
  // usa para escolher o destino de escoamento sem uma consulta nova.
  return { ...plan, inputs };
}

/** Fornecedores com seus prazos de entrega: cadastrados ou padrão da rede. */
export async function listSupplierSettings() {
  const [brands, settings] = await Promise.all([
    prisma.product.groupBy({ by: ['brand'], where: { brand: { not: null } }, _count: true }),
    prisma.supplierSetting.findMany(),
  ]);
  const cadastrada = new Map(settings.map((s) => [s.brand, s]));
  const doCatalogo = brands.map((b) => ({
    brand: b.brand as string,
    leadTimeDays: cadastrada.get(b.brand as string)?.leadTimeDays ?? null,
    products: b._count,
    isDefault: !cadastrada.has(b.brand as string),
  }));

  // Um prazo cadastrado para um fornecedor que sumiu do catálogo continua
  // aparecendo: senão o operador salvaria e a linha desapareceria no
  // recarregamento, como se nada tivesse sido gravado.
  const noCatalogo = new Set(doCatalogo.map((r) => r.brand));
  const soltas = settings
    .filter((s) => !noCatalogo.has(s.brand))
    .map((s) => ({ brand: s.brand, leadTimeDays: s.leadTimeDays, products: 0, isDefault: false }));

  const rows = [...doCatalogo, ...soltas].sort((a, b) => a.brand.localeCompare(b.brand, 'pt-BR'));
  return { defaultLeadTimeDays: DEFAULT_PLANNING_CONFIG.leadTimeDays, rows };
}

/**
 * Mix de grifes: a lista que a operação usa para declarar o que a rede parou
 * de trabalhar (feedback 6.0 · item 03).
 *
 * As linhas são as GRIFES que o motor de fato usa — `analysisBrand`, a mesma
 * função que decide a marca de um card, de um pedido e de um remanejamento —
 * e NÃO o campo `brand` do CDS, que é o fornecedor. Enquanto a tela ofereceu
 * fornecedores, marcar "fora do mix" numa grife de moda era impossível: RAY
 * BAN, OAKLEY e ARNETTE não estavam na lista, e "LUXOTTICA BRASIL PRODUTOS
 * OTICOS E ESPORTIVOS LTDA", que estava, nunca era consultado pelo motor.
 *
 * A agregação é em memória porque `analysisBrand` é derivada da descrição —
 * não existe coluna para agrupar em SQL. São três campos por produto; num
 * catálogo do tamanho do da rede (61 mil) isso é alguns MB numa tela de
 * administração, consultada raramente.
 */
export async function listBrandMix() {
  const [produtos, marcados] = await Promise.all([
    prisma.product.findMany({ select: { description: true, category: true, brand: true } }),
    prisma.brandMix.findMany(),
  ]);

  const contagem = new Map<string, { brand: string; products: number }>();
  for (const p of produtos) {
    const grife = analysisBrand(p.description, p.category, p.brand);
    if (!grife) continue;
    const k = normBrandKey(grife);
    const atual = contagem.get(k);
    if (atual) atual.products += 1;
    else contagem.set(k, { brand: grife, products: 1 });
  }

  const fora = new Map(marcados.map((m) => [normBrandKey(m.brand), m]));
  const rows = [...contagem.values()].map((c) => ({
    brand: c.brand,
    products: c.products,
    discontinued: fora.get(normBrandKey(c.brand))?.discontinued ?? false,
  }));

  // Uma grife marcada que não casa com produto nenhum continua visível, com
  // `products: 0`. É o aviso de que aquela marcação está inerte — pode ter
  // sido digitada errada, ou a grife pode ter saído do catálogo. Esconder a
  // linha faria a marcação sumir da tela e continuar valendo no banco.
  const conhecidas = new Set(rows.map((r) => normBrandKey(r.brand)));
  for (const m of marcados) {
    if (!conhecidas.has(normBrandKey(m.brand))) {
      rows.push({ brand: m.brand, products: 0, discontinued: m.discontinued });
    }
  }

  rows.sort((a, b) => b.products - a.products || a.brand.localeCompare(b.brand, 'pt-BR'));
  return { rows };
}

/**
 * Marca (ou desmarca) uma grife como fora do mix. Decisão comercial: nenhum
 * dado do ERP diz que a rede parou de trabalhar uma grife.
 */
export async function setBrandMix(brand: string, discontinued: boolean) {
  const clean = brand.trim();
  if (!clean) throw badRequest('Informe a grife.');

  if (!discontinued) {
    // Desmarcar apaga a linha em vez de guardar `false`: a tabela existe para
    // registrar exceções, e uma lista de exceções cheia de não-exceções é uma
    // lista que ninguém consegue ler.
    await prisma.brandMix.deleteMany({ where: { brand: clean } });
    return { brand: clean, discontinued: false };
  }

  const row = await prisma.brandMix.upsert({
    where: { brand: clean },
    create: { brand: clean, discontinued: true },
    update: { discontinued: true },
  });
  return { brand: row.brand, discontinued: row.discontinued };
}

// ─── Ciclo do pedido: enviado → recebido (com histórico) ─────────────────────

export interface RegisterOrderInput {
  supplier: string;
  leadTimeDays: number;
  items: RecordItem[];
}

/** Registra um pedido como ENVIADO ao fornecedor (1ª confirmação do ciclo). */
export async function registerPurchaseOrder(input: RegisterOrderInput, actorId: string) {
  const supplier = input.supplier.trim();
  if (!supplier) throw badRequest('Informe o fornecedor.');
  const items = (input.items ?? []).filter(
    (it) => it.productId && Number.isInteger(it.quantity) && it.quantity > 0,
  );
  if (items.length === 0) throw badRequest('O pedido precisa de ao menos um item com quantidade.');

  const units = items.reduce((s, it) => s + it.quantity, 0);
  const total = round2(items.reduce((s, it) => s + (Number.isFinite(it.total) ? it.total : 0), 0));
  const leadTimeDays = Number.isInteger(input.leadTimeDays) && input.leadTimeDays > 0 ? input.leadTimeDays : 14;

  return prisma.purchaseOrderRecord.create({
    data: {
      supplier,
      leadTimeDays,
      status: 'SENT',
      items: items as unknown as Prisma.InputJsonValue,
      units,
      total,
      sentBy: actorId,
      expectedAt: new Date(Date.now() + leadTimeDays * 86400000),
    },
  });
}

/** Confirma o recebimento (2ª confirmação) ou cancela um pedido em trânsito. */
export async function settlePurchaseOrder(id: string, action: 'receive' | 'cancel', actorId: string) {
  const rec = await prisma.purchaseOrderRecord.findUnique({ where: { id } });
  if (!rec) throw badRequest('Pedido não encontrado.');
  if (rec.status !== 'SENT') throw badRequest(`Pedido não está em trânsito (${rec.status}).`);
  return prisma.purchaseOrderRecord.update({
    where: { id },
    data:
      action === 'receive'
        ? { status: 'RECEIVED', receivedBy: actorId, receivedAt: new Date() }
        : { status: 'CANCELLED' },
  });
}

/** Histórico de pedidos (mais recentes primeiro; em trânsito no topo). */
export async function purchaseOrderHistory(limit = 50) {
  const rows = await prisma.purchaseOrderRecord.findMany({
    // A ordem do enum no Postgres segue a definição (SENT, RECEIVED,
    // CANCELLED), então asc põe os em trânsito primeiro.
    orderBy: [{ status: 'asc' }, { sentAt: 'desc' }],
    take: limit,
  });
  return { total: rows.length, rows };
}

/**
 * Define o prazo e/ou o estado de mix de uma marca. `leadTimeDays: null`
 * devolve a marca ao prazo padrão da rede; a linha só é APAGADA quando também
 * não há nada a dizer sobre o mix — senão marcar uma grife como fora do mix
 * sem informar prazo apagaria o próprio registro que acabou de ser criado.
 */
export async function setSupplierSetting(brand: string, leadTimeDays: number | null) {
  const clean = brand.trim();
  if (!clean) throw badRequest('Informe a marca/fornecedor.');
  if (leadTimeDays !== null && (!Number.isInteger(leadTimeDays) || leadTimeDays < 1 || leadTimeDays > 365)) {
    throw badRequest('Prazo do fornecedor deve ser um número inteiro entre 1 e 365 dias.');
  }

  // Sem prazo próprio, o fornecedor volta ao padrão da rede — e a linha deixa
  // de existir. É o que "voltar ao padrão" significa.
  if (leadTimeDays === null) {
    await prisma.supplierSetting.deleteMany({ where: { brand: clean } });
    return { brand: clean, leadTimeDays: null };
  }

  const row = await prisma.supplierSetting.upsert({
    where: { brand: clean },
    create: { brand: clean, leadTimeDays },
    update: { leadTimeDays },
  });
  return { brand: row.brand, leadTimeDays: row.leadTimeDays };
}

// ─── Modo Feira: rateio de compra por loja (feedback 08, MVP) ────────────────

export interface FairSplitFilter {
  brand?: string;
  category?: string;
}

/**
 * Participação de cada loja nas vendas da marca OU do grupo escolhido, com o
 * rateio da quantidade comprada (buildFairSplit — maiores restos). Lançamento
 * de feira não tem histórico próprio: a régua é a marca/grupo como um todo.
 */
export async function fairSplit(days: number, filter: FairSplitFilter, totalQty: number) {
  if (!filter.brand === !filter.category) {
    throw badRequest('Informe exatamente um recorte: brand OU category.');
  }
  const field = filter.brand ? Prisma.sql`p.brand` : Prisma.sql`p.category`;
  const value = filter.brand ?? filter.category!;

  const [soldRows, stockRows, stores] = await Promise.all([
    prisma.$queryRaw<{ storeId: string | null; units: bigint }[]>(Prisma.sql`
      SELECT s."storeId" AS "storeId", COALESCE(SUM(si.quantity), 0)::bigint AS units
      FROM "SaleItem" si
      JOIN "Sale" s ON s.id = si."saleId"
      JOIN "Store" lo ON lo.id = s."storeId" AND ${plannedStoreSql('lo')}
      JOIN "Product" p ON p.id = si."productId"
      WHERE s."saleDate" >= ${periodStart(days)} AND ${field} = ${value}
      GROUP BY s."storeId"
    `),
    prisma.$queryRaw<{ storeId: string; units: bigint }[]>(Prisma.sql`
      SELECT st."storeId" AS "storeId", COALESCE(SUM(st.quantity), 0)::bigint AS units
      FROM "StockItem" st
      JOIN "Store" lo ON lo.id = st."storeId" AND ${plannedStoreSql('lo')}
      JOIN "Product" p ON p.id = st."productId"
      WHERE ${field} = ${value}
      GROUP BY st."storeId"
    `),
    prisma.store.findMany({ where: PLANNED_STORE_WHERE, select: { id: true, name: true } }),
  ]);
  const soldById = new Map(soldRows.filter((r) => r.storeId).map((r) => [r.storeId as string, Number(r.units)]));
  const stockById = new Map(stockRows.map((r) => [r.storeId, Number(r.units)]));

  const inputs: FairSplitInput[] = stores.map((s) => ({
    storeId: s.id,
    storeName: s.name,
    unitsSold: soldById.get(s.id) ?? 0,
    stockUnits: stockById.get(s.id) ?? 0,
  }));
  return { days, filter, ...buildFairSplit(inputs, totalQty) };
}
