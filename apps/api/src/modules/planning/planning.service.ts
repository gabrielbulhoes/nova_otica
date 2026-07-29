import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { publish } from '../../lib/eventBus.js';
import { badRequest, toNumber } from '../../http/helpers.js';
import { PLANNED_STORE_WHERE, stockPlannedWhere } from '../stores/store.scope.js';
import { loadBrandCatalog } from './brandCatalog.js';
import { currentDecisions, DECISION_SLA_DAYS } from './decisions.service.js';
import { cardHistories, latestBatch, recordGenerationBatch } from './batches.service.js';
import {
  analyzeProduct,
  annotateCardAges,
  buildCommercialStrategy,
  buildDecisionCards,
  buildFairSplit,
  buildOverview,
  buildPurchaseOrders,
  buildRebalance,
  buildSuggestions,
  extractBrand,
  supplierFor,
  storeCarriesBrand,
  DEFAULT_PLANNING_CONFIG,
  matchesProductGroup,
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

  const ids = Array.from(new Set([...soldBy.keys(), ...stockBy.keys()]));
  const [products, onOrderBy, monthlyBy] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, description: true, brand: true, category: true, price: true, cost: true },
    }),
    onOrderQuantities(),
    monthlyHistoryByProduct(storeId),
  ]);

  const currentMonth = new Date().getMonth() + 1;
  // Recorte de cobertura: principal (óculos/grau/relógio), lentes ou tudo.
  const scoped = products.filter((p) => matchesProductGroup(p.category, group));
  return scoped.map((p) => {
    const price = toNumber(p.price) ?? 0;
    const cost = toNumber(p.cost) ?? round2(price * 0.55);
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
      onOrderQty: onOrderBy.get(p.id) ?? 0,
      demandHistory,
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
          JOIN "Store" st ON st.id = s."storeId" AND st."excludeFromPlanning" = false
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

/** Rascunhos de ordem de compra agrupados pelo fornecedor canônico (catálogo). */
export async function purchaseOrders(days: number, storeId?: string, group: ProductGroup = 'todos') {
  const [productPlans, catalog] = [await plans(days, storeId, group), loadBrandCatalog()];
  // Com catálogo, agrupa pelo fornecedor canônico da grife (Kering, Marcolin…);
  // sem ele, cai no campo "marca" do ERP (comportamento anterior).
  const resolve = catalog
    ? (p: ProductPlan) => supplierFor(extractBrand(p.description) ?? p.brand, catalog)
    : undefined;
  return buildPurchaseOrders(productPlans, days, resolve);
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
    if (!r.brand) continue;
    const lista = porMarca.get(r.brand) ?? [];
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
    porMarca.set(r.brand, lista);
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
  const po = await purchaseOrders(days);
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
    prisma.stockItem.findMany({ where: stockPlannedWhere, select: { storeId: true, productId: true, quantity: true } }),
    prisma.store.findMany({ where: PLANNED_STORE_WHERE, select: { id: true, name: true } }),
    supplierConfigResolver(),
  ]);

  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const key = (storeId: string, productId: string) => `${storeId}:${productId}`;

  const positions = new Map<string, { storeId: string; productId: string; stock: number; sold: number }>();
  for (const s of stock) {
    positions.set(key(s.storeId, s.productId), {
      storeId: s.storeId,
      productId: s.productId,
      stock: s.quantity,
      sold: 0,
    });
  }
  for (const it of sold) {
    const sid = it.sale.storeId;
    if (!sid || !it.productId) continue;
    const k = key(sid, it.productId);
    const cur = positions.get(k) ?? { storeId: sid, productId: it.productId, stock: 0, sold: 0 };
    cur.sold += it.quantity;
    positions.set(k, cur);
  }

  const productIds = Array.from(new Set(Array.from(positions.values()).map((p) => p.productId)));
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, description: true, brand: true, category: true },
  });
  const productBy = new Map(products.map((p) => [p.id, p]));

  const inputs: StoreProductInput[] = [];
  for (const pos of positions.values()) {
    const product = productBy.get(pos.productId);
    if (!product) continue;
    if (!matchesProductGroup(product.category, group)) continue;
    // Regra absoluta da rede: lentes não se transferem entre lojas — só óculos
    // de grau/sol e relógio. Vale mesmo no consolidado ('todos').
    if (matchesProductGroup(product.category, 'lentes')) continue;
    inputs.push({
      storeId: pos.storeId,
      storeName: storeName.get(pos.storeId) ?? '—',
      productId: pos.productId,
      description: product.description,
      brand: product.brand,
      unitsSold: pos.sold,
      currentStock: pos.stock,
    });
  }

  const plan = buildRebalance(inputs, days, cfgFor);

  // Regra de mix: não transferir uma grife premium para uma loja que não a
  // trabalha (catálogo). Marcas correntes (fora do catálogo) valem para todas.
  const catalog = loadBrandCatalog();
  if (catalog) {
    plan.rows = plan.rows.filter((r) =>
      storeCarriesBrand(extractBrand(r.description) ?? r.brand, r.toStoreName, catalog),
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

/** Fornecedores (marcas) com seus prazos: cadastrados ou padrão da rede. */
export async function listSupplierSettings() {
  const [brands, settings] = await Promise.all([
    prisma.product.groupBy({ by: ['brand'], where: { brand: { not: null } }, _count: true }),
    prisma.supplierSetting.findMany(),
  ]);
  const byBrand = new Map(settings.map((s) => [s.brand, s.leadTimeDays]));
  const rows = brands
    .map((b) => ({
      brand: b.brand as string,
      leadTimeDays: byBrand.get(b.brand as string) ?? null,
      products: b._count,
      isDefault: !byBrand.has(b.brand as string),
    }))
    .sort((a, b) => a.brand.localeCompare(b.brand));
  return { defaultLeadTimeDays: DEFAULT_PLANNING_CONFIG.leadTimeDays, rows };
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

/** Define (ou remove, com null) o prazo de um fornecedor/marca. */
export async function setSupplierLeadTime(brand: string, leadTimeDays: number | null) {
  const clean = brand.trim();
  if (!clean) throw badRequest('Informe a marca/fornecedor.');
  if (leadTimeDays === null) {
    await prisma.supplierSetting.deleteMany({ where: { brand: clean } });
    return { brand: clean, leadTimeDays: null };
  }
  if (!Number.isInteger(leadTimeDays) || leadTimeDays < 1 || leadTimeDays > 365) {
    throw badRequest('Prazo do fornecedor deve ser um número inteiro entre 1 e 365 dias.');
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
      JOIN "Store" lo ON lo.id = s."storeId" AND lo."excludeFromPlanning" = false
      JOIN "Product" p ON p.id = si."productId"
      WHERE s."saleDate" >= ${periodStart(days)} AND ${field} = ${value}
      GROUP BY s."storeId"
    `),
    prisma.$queryRaw<{ storeId: string; units: bigint }[]>(Prisma.sql`
      SELECT st."storeId" AS "storeId", COALESCE(SUM(st.quantity), 0)::bigint AS units
      FROM "StockItem" st
      JOIN "Store" lo ON lo.id = st."storeId" AND lo."excludeFromPlanning" = false
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
