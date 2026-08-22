import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { publish } from '../../lib/eventBus.js';
import { badRequest, toNumber } from '../../http/helpers.js';
import { PLANNED_STORE_WHERE, plannedStoreSql, stockPlannedWhere } from '../stores/store.scope.js';
import { computeLiveStock, liveDeltas, saldosAoVivo } from '../stock/stock.service.js';
import { loadBrandCatalog } from './brandCatalog.js';
import { porteiroDeMix, type PorteiroDeMix } from './mixDeLoja.js';
import { maloteEmTexto, previsaoDeMalote } from './malotes.js';
import { currentDecisions, DECISION_SLA_DAYS, produtosComCompraAprovada } from './decisions.service.js';
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
  chaveDePerfil,
  explicarLinha,
  margemPct,
  montarPlanoDetalhado,
  splitByNeed,
  contarIdades,
  filtrarVista,
  finalizarBoard,
  grifesDoQuadro,
  paginar,
  supplierFor,
  CARDS_POR_PAGINA,
  DEFAULT_PLANNING_CONFIG,
  LINHAS_POR_PAGINA,
  matchesProductGroup,
  normBrandKey,
  type AtributosDaPeca,
  type CandidatoDeCompra,
  type SegmentoDoPlano,
  type FairSplitInput,
  type FiltroDeVista,
  type PlanningConfig,
  type DemandHistory,
  type ProductGroup,
  type ProductMetricsInput,
  type ProductPlan,
  type Recommendation,
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

  // Estoque AO VIVO, não o `quantity` cru da última sincronização.
  //
  // `rebalancePlan` já compunha o saldo com os deltas confirmados-e-não-
  // reconciliados; `planningInputs` — que alimenta compra, sugestões, pedidos e
  // panorama — continuava somando o número cru. As duas abas do MESMO
  // Planejamento discordavam sobre a mesma posição na janela entre confirmar
  // uma transferência e a sincronização seguinte fechá-la.
  //
  // Medido: com 4 unidades confirmadas saindo do Rio, a aba de remanejamento
  // dizia 8, a tela de Estoque dizia 8 e a aba de compras dizia 12 — e o motor
  // de compra planejava sobre 4 unidades que já tinham saído da loja,
  // comprando de menos até a próxima sync.
  //
  // Uma conta só, na mesma função que a tela de Estoque e o `availableAt`
  // usam. Duas contas de saldo ao vivo que precisam concordar por disciplina
  // são a próxima divergência silenciosa.
  //
  // SOMADO NO BANCO, e não linha a linha em memória. A primeira versão desta
  // correção trazia TODA posição do escopo (`findMany` sobre 61 mil peças × 16
  // lojas) e depois pedia `liveDeltas` com um `IN` de vinte mil parâmetros — na
  // rota mais quente da plataforma, e logo depois de uma frente inteira gasta
  // tirando memória de cima deste processo. Trocar um `groupBy` por um
  // `findMany` para corrigir o saldo foi consertar o número certo pelo caminho
  // errado.
  //
  // O que salva a soma é que `onHand` NÃO usa `reserved` — é `quantity +
  // delta`. Somando por peça sobre as lojas do escopo, isso é
  // `Σ quantity + Σ entradas − Σ saídas`, e as três parcelas são agregados que
  // o Postgres faz sozinho. Nenhuma linha de posição atravessa a rede.
  const stockWhere: Prisma.StockItemWhereInput = { ...stockPlannedWhere };
  if (storeId) stockWhere.storeId = storeId;
  // O mesmo recorte de loja, do lado das movimentações: sem ele, uma
  // transferência confirmada de/para a retaguarda entraria numa conta que
  // declara ser só das lojas planejáveis.
  const lojaDaMovimentacao = storeId ? { id: storeId } : PLANNED_STORE_WHERE;
  const [sincronizado, entradas, saidas] = await Promise.all([
    prisma.stockItem.groupBy({ by: ['productId'], where: stockWhere, _sum: { quantity: true } }),
    prisma.inventoryMovement.groupBy({
      by: ['productId'],
      where: { status: 'CONFIRMED', toStore: lojaDaMovimentacao },
      _sum: { quantity: true },
    }),
    prisma.inventoryMovement.groupBy({
      by: ['productId'],
      where: { status: 'CONFIRMED', fromStore: lojaDaMovimentacao },
      _sum: { quantity: true },
    }),
  ]);
  const stockBy = new Map<string, number>();
  for (const r of sincronizado) stockBy.set(r.productId, r._sum.quantity ?? 0);
  for (const r of entradas) stockBy.set(r.productId, (stockBy.get(r.productId) ?? 0) + (r._sum.quantity ?? 0));
  for (const r of saidas) stockBy.set(r.productId, (stockBy.get(r.productId) ?? 0) - (r._sum.quantity ?? 0));

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

/** Recorte de vista da lista de sugestões (não muda nenhum número do resumo). */
export interface OpcoesDeSugestoes {
  page?: number;
  pageSize?: number;
  /** Chave do último item que o cliente já tem — ver `paginar`. */
  apos?: string;
  recomendacao?: Recommendation;
}

/**
 * Recomendações de compra (comprar / manter / não comprar / liquidar).
 *
 * O resumo é sempre do CONJUNTO analisado; `rows` é a página. A tela mostrava
 * as 13 mil linhas de uma vez — 11 MB por requisição para uma tabela que
 * ninguém rola até o fim.
 */
export async function purchaseSuggestions(
  days: number,
  storeId?: string,
  group: ProductGroup = 'todos',
  opcoes: OpcoesDeSugestoes = {},
) {
  const r = buildSuggestions(await plans(days, storeId, group), days);
  const vista = opcoes.recomendacao
    ? r.rows.filter((x) => x.recommendation === opcoes.recomendacao)
    : r.rows;
  const { itens, pagina } = paginar(vista, opcoes.page ?? 1, opcoes.pageSize ?? LINHAS_POR_PAGINA, {
    chave: opcoes.apos,
    de: (r) => r.productId,
  });
  return { ...r, rows: itens, pagina };
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

  const [lojas, vendas, saldos] = await Promise.all([
    prisma.store.findMany({ where: PLANNED_STORE_WHERE, select: { id: true, name: true } }),
    prisma.$queryRaw<{ storeId: string; productId: string; units: number }[]>(Prisma.sql`
      SELECT s."storeId" AS "storeId", si."productId" AS "productId", SUM(si.quantity)::int AS units
      FROM "SaleItem" si
      JOIN "Sale" s ON s.id = si."saleId"
      JOIN "Store" lo ON lo.id = s."storeId" AND ${plannedStoreSql('lo')}
      WHERE si."productId" IN (${Prisma.join(productIds)}) AND s."saleDate" >= ${periodStart(days)}
      GROUP BY s."storeId", si."productId"
    `),
    // Saldo AO VIVO, não `StockItem.quantity`. Ler a coluna crua aqui era o que
    // fazia a aba de compras anunciar 12 na loja onde a aba de Estoque mostrava
    // 8: mesma peça, mesma loja, mesma tela, dois números.
    saldosAoVivo(productIds, PLANNED_STORE_WHERE),
  ]);

  const vendaPor = new Map(vendas.map((v) => [`${v.productId}:${v.storeId}`, Math.max(0, v.units)]));
  for (const id of productIds) {
    posicoes.set(
      id,
      lojas.map((l) => ({
        storeId: l.id,
        storeName: l.name,
        unitsSold: vendaPor.get(`${id}:${l.id}`) ?? 0,
        // VENDÁVEL, não físico: a unidade já prometida a outra loja vai embora e
        // não cobre a demanda daqui. Contá-la faz o rateio pular a loja que
        // mais precisa.
        stockUnits: saldos.get(`${l.id}:${id}`)?.disponivel ?? 0,
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
  somenteAprovados = false,
) {
  const [todosOsPlanos, catalog] = [await plans(days, storeId, group), loadBrandCatalog()];

  /*
   * SÓ OS APROVADOS (feedback 6.0 · item 10).
   *
   * O rascunho de pedido nascia de TODO plano com recomendação de compra,
   * independente de alguém ter olhado. A Central de Decisões e o Planejamento
   * eram dois caminhos paralelos: aprovar um card ali não mudava nada aqui.
   *
   * É OPCIONAL, e o padrão continua sendo o comportamento antigo. Ligá-lo por
   * padrão esvaziaria a tela de pedidos no dia da publicação — ninguém aprovou
   * nada ainda — e uma tela vazia depois de um deploy é indistinguível de uma
   * tela quebrada para quem a abre. A tela oferece o botão e diz quantos itens
   * cada modo traz; a operação escolhe quando virar a chave.
   *
   * O corte é sobre `recommendation === 'BUY'`: os demais planos seguem para
   * `buildPurchaseOrders`, que precisa deles para os totais de contexto.
   */
  const aprovados = somenteAprovados ? await produtosComCompraAprovada() : null;
  const comAprovacao = aprovados
    ? todosOsPlanos.filter((p) => p.recommendation !== 'BUY' || aprovados.has(p.productId))
    : todosOsPlanos;

  /*
   * MIX NA LISTA DE COMPRAS (nova rodada · item 02).
   *
   * O mesmo porteiro dos cards, pelo mesmo motivo, e com o mesmo recorte: só
   * `BUY`, só com loja no filtro. Sem loja é a lista da REDE, e a rede compra
   * a grife — o que o mix decide ali é para ONDE ela vai, e essa pergunta é
   * respondida no rateio, algumas linhas abaixo.
   */
  const mix = await porteiroDeMix();
  const loja = storeId ? await prisma.store.findUnique({ where: { id: storeId }, select: { name: true } }) : null;
  const productPlans =
    storeId && mix.ativo
      ? comAprovacao.filter(
          (p) =>
            p.recommendation !== 'BUY' ||
            mix.permite(analysisBrand(p.description, p.category, p.brand), storeId, loja?.name),
        )
      : comAprovacao;
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

  /*
   * O MIX ENTRA NO RATEIO — e é aqui que "Chanel só no Iguatemi e Natal
   * Shopping" vira comportamento na lista da rede.
   *
   * A compra continua acontecendo (a rede trabalha a grife). O que muda é o
   * destino: a caixa é repartida SÓ entre as lojas que a vendem, e as demais
   * saem nomeadas para a tela.
   *
   * A ORDEM IMPORTA, e é a mesma do plano de recebimento: filtra ANTES de
   * ratear. Ratear sobre a rede inteira e descartar as linhas das excluídas
   * depois faria as unidades delas evaporarem — nem no rateio, nem em
   * `unassigned`, e a soma da tela deixaria de fechar contra a quantidade
   * comprada.
   *
   * Rede inteira excluída (grife declarada só em loja de retaguarda, por
   * exemplo) deixa `elegiveis` vazio: `splitByNeed` devolve tudo em
   * `unassigned`, que é a resposta honesta — a compra não tem para onde ir, e
   * quem olha precisa ver isso, não um rateio inventado.
   */
  const foraDoMix = new Map<string, string[]>();
  if (posicoes && mix.ativo) {
    const marcaPor = new Map(
      productPlans.map((p) => [p.productId, analysisBrand(p.description, p.category, p.brand)]),
    );
    for (const [productId, lista] of posicoes) {
      const { elegiveis, excluidas } = mix.separar(marcaPor.get(productId) ?? null, lista);
      if (excluidas.length === 0) continue;
      posicoes.set(productId, elegiveis);
      foraDoMix.set(productId, excluidas.map((e) => e.storeName));
    }
  }

  return buildPurchaseOrders(
    productPlans,
    days,
    resolve,
    posicoes,
    foraDoMix,
    await fichasDoFornecedor(productPlans),
  );
}

/**
 * A ficha do fornecedor das peças que vão virar item de pedido (nova rodada ·
 * item 04).
 *
 * A tabela `ProductAttribute` é escrita por um importador manual desde a
 * rodada passada — 4.339 peças com gênero, formato e material, e 8.901 com
 * teto de desconto — e até aqui NINGUÉM a lia. Estava tudo no banco e nada na
 * tela; o `/health` contava as linhas e era o único lugar onde elas existiam.
 *
 * SÓ OS SKUs DE COMPRA entram na consulta. O recorte pode ter dezenas de
 * milhares de peças e a lista de compras tem centenas — buscar a tabela
 * inteira para descartar 99% dela é o tipo de custo que não erra a saída e
 * derruba a rota, e esta rota já foi derrubada uma vez aqui por isso.
 */
async function fichasDoFornecedor(planos: ProductPlan[]): Promise<Map<string, AtributosDaPeca>> {
  const ids = planos.filter((p) => p.recommendation === 'BUY' && p.suggestedQty > 0).map((p) => p.productId);
  const fichas = new Map<string, AtributosDaPeca>();
  if (ids.length === 0) return fichas;

  const linhas = await prisma.productAttribute.findMany({
    where: { productId: { in: ids }, cadastroEm: { not: null } },
    select: {
      productId: true,
      genero: true,
      formato: true,
      material: true,
      tamanhoLente: true,
      bestSeller: true,
    },
  });
  for (const l of linhas) {
    fichas.set(l.productId, {
      genero: l.genero,
      formato: l.formato,
      material: l.material,
      tamanhoLente: l.tamanhoLente,
      bestSeller: l.bestSeller,
    });
  }
  return fichas;
}

/** Recorte da resposta do quadro: página + filtros de vista. */
export interface OpcoesDoQuadro {
  page?: number;
  pageSize?: number;
  /** Chave do último card que o cliente já tem — ver `paginar`. */
  apos?: string;
  vista?: FiltroDeVista;
}

/**
 * Feed unificado de cards de decisão (compra + remanejamento + liquidação),
 * com tipo, prioridade e impacto — a visualização de "portal de decisões".
 * Compra/liquidação respeitam o recorte de loja; o remanejamento é de rede.
 *
 * A resposta vem PAGINADA e o resumo vem do quadro INTEIRO. Era a origem do
 * 503 que o cliente fotografou: 18,5 mil cards viravam 16,5 MB de JSON por
 * requisição, e três requisições concorrentes levavam o processo a 856 MB.
 */
export async function decisionBoard(
  days: number,
  storeId?: string,
  group: ProductGroup = 'principal',
  opcoes: OpcoesDoQuadro = {},
) {
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

  // `finalizarBoard` sobre os cards que JÁ existem. Antes daqui saía um
  // `buildDecisionCards` novo, que refazia do zero os mesmos cards que
  // `generateCards` acabara de montar. Numa base de 20 mil SKUs e 12.737 cards,
  // parar de construir duas vezes tirou 15% do tempo da rota (mediana de 10
  // execuções: 1,890 s → 1,598 s) — menos do que parece porque quem manda no
  // relógio são as consultas e o `analyzeProduct`, não a montagem dos cards.
  const quadro = finalizarBoard(generated.cards, new Set(decided.keys()));

  // As três coisas que TÊM de sair do conjunto inteiro: o resumo (já vem de
  // `finalizarBoard`), a contagem de novos/atrasados e a lista de grifes do
  // seletor. Derivar qualquer uma delas da página daria um número plausível e
  // errado, com a tela idêntica.
  // Um `agora` só para a contagem e para a anotação: com dois relógios, um card
  // podia ser contado como atrasado e chegar à tela com a idade do dia anterior.
  const agora = new Date();
  const contagem = contarIdades(quadro.cards, history, DECISION_SLA_DAYS, agora);
  const grifes = grifesDoQuadro(quadro.cards);

  const vista = filtrarVista(quadro.cards, opcoes.vista ?? {});
  const { itens, pagina } = paginar(vista, opcoes.page ?? 1, opcoes.pageSize ?? CARDS_POR_PAGINA, {
    chave: opcoes.apos,
    de: (c) => c.id,
  });

  return annotateCardAges(
    { summary: quadro.summary, cards: itens, grifes, pagina },
    history,
    batch,
    DECISION_SLA_DAYS,
    agora,
    contagem,
  );
}

/**
 * Todos os cards que o motor gera agora, SEM filtrar os já decididos — é o que
 * o lote de geração registra. O board filtra depois; o lote precisa da foto
 * completa, senão um card decidido sumiria do histórico de aparições.
 */
export async function generateCards(days: number, storeId?: string, group: ProductGroup = 'principal') {
  // UM porteiro para toda a montagem: o remanejamento e os cards de compra
  // aplicam a MESMA regra de mix, e aplicá-la com duas leituras diferentes do
  // banco é como o remanejamento e a compra passaram a discordar sobre saldo
  // ao vivo — divergência que ninguém vê até o cliente ver.
  const mix = await porteiroDeMix();
  const [todosOsPlanos, reb] = await Promise.all([
    plans(days, storeId, group),
    rebalancePlan(days, group, mix),
  ]);

  /*
   * MIX NA COMPRA (nova rodada · item 02).
   *
   * "Chanel só pode ser vendido no Iguatemi e Natal Shopping" — e o quadro de
   * uma loja que não trabalha Chanel mandava comprar Chanel. O remanejamento
   * tinha porteiro desde a rodada passada; a compra nunca teve nenhum.
   *
   * O corte é só sobre `BUY`, e a assimetria é deliberada:
   *  · COMPRAR uma grife que a loja não vende é criar encalhe com dinheiro
   *    novo. É o que se barra.
   *  · LIQUIDAR uma grife que a loja não vende é exatamente o que se quer —
   *    a peça está lá, fora do mix, e precisa sair. Barrar aqui prenderia o
   *    encalhe que a plataforma existe para escoar.
   *
   * Vale APENAS com loja no filtro. Sem loja, o quadro é da rede, e a rede
   * trabalha Chanel — em duas lojas. Quem responde "para quais lojas" naquele
   * caso é o rateio do pedido, e é lá que o mesmo porteiro entra.
   */
  const productPlans =
    storeId && mix.ativo
      ? await (async () => {
          const loja = await prisma.store.findUnique({
            where: { id: storeId },
            select: { name: true },
          });
          return todosOsPlanos.filter(
            (p) =>
              p.recommendation !== 'BUY' ||
              mix.permite(analysisBrand(p.description, p.category, p.brand), storeId, loja?.name),
          );
        })()
      : todosOsPlanos;
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
  // O calendário de malotes entra como função (ver `InsumosDoQuadro.malote`):
  // `planning.math.ts` não tem imports de propósito, e a logística é
  // configuração do cliente, não matemática de estoque.
  const agora = new Date();
  const board = buildDecisionCards(productPlans, reb.rows, {
    positionsByProduct: posicoes,
    positionsByBrand: porMarca,
    malote: (de, para) => {
      const p = previsaoDeMalote(de, para, agora);
      return p
        ? {
            embarque: p.embarque.toISOString(),
            chegada: p.chegada.toISOString(),
            dias: p.diasAteChegar,
            texto: maloteEmTexto(p),
          }
        : null;
    },
  });
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
  const estrategia = buildCommercialStrategy(productPlans, params);
  // O DETALHE é o módulo que faltava: a estratégia dizia QUANTO comprar e
  // parava aí. Vem no mesmo pacote porque a tela é a mesma — o comprador ajusta
  // o piso e quer ver a lista mudar junto, não navegar para outro lugar.
  const detalhe = await detalharPlanoContinuo(productPlans, estrategia, days);
  return { ...estrategia, detalhe };
}

/**
 * O universo de candidatos do modo CONTÍNUO tem teto, e o teto é declarado.
 *
 * O recorte 'principal' da rede tem dezenas de milhares de peças, e a
 * esmagadora maioria receberia zero num piso de novecentas unidades. Carregar
 * a ficha de todas para descartar 98% é o custo que não erra a saída e derruba
 * a rota — o mesmo que derrubou a Central de Decisões e o painel de alertas.
 *
 * O corte é por RELEVÂNCIA (giro primeiro), não alfabético, e o que ficou de
 * fora vai declarado na resposta.
 */
const TETO_DE_CANDIDATOS = 3_000;

/**
 * Monta o plano detalhado sobre a rede viva — Segmento → Marca → Tipo →
 * Gênero → SKU, com o porquê de cada linha.
 *
 * A EVIDÊNCIA DO PERFIL sai dos próprios planos cruzados com a ficha do
 * fornecedor: quanto a rede vendeu de cada (tipo|gênero), de cada formato e de
 * cada cor. É o que permite classificar uma peça sem giro próprio como
 * LANÇAMENTO em vez de aposta — a distinção que sustenta o módulo.
 */
async function detalharPlanoContinuo(
  productPlans: ProductPlan[],
  estrategia: ReturnType<typeof buildCommercialStrategy>,
  days: number,
) {
  // Relevância: quem gira primeiro; empate pelo capital da peça, que é o que
  // diferencia duas peças paradas.
  const ordenados = [...productPlans].sort(
    (a, b) => b.unitsSold - a.unitsSold || b.stockValue - a.stockValue,
  );
  const pool = ordenados.slice(0, TETO_DE_CANDIDATOS);
  const fichas = await fichasDoFornecedor(
    pool.map((p) => ({ ...p, recommendation: 'BUY' as const, suggestedQty: 1 })),
  );

  const candidatos: CandidatoDeCompra[] = pool.map((p) => {
    const f = fichas.get(p.productId);
    return {
      id: p.productId,
      sku: p.productId,
      description: p.description,
      // A GRIFE, não o fornecedor — a mesma regra do resto do motor.
      brand: analysisBrand(p.description, p.category, p.brand) ?? 'Sem grife',
      tipo: p.category,
      genero: f?.genero ?? null,
      formato: f?.formato ?? null,
      cor: null,
      unitCost: p.unitCost,
      unitPrice: p.unitPrice,
      unitsSold: p.unitsSold,
      currentStock: p.currentStock,
      coberturaDaGrifeMeses: p.coverageDays === null ? null : Math.round((p.coverageDays / 30) * 10) / 10,
      /*
       * A ABSORÇÃO sai do `targetStock` que o motor já calcula — o alvo de
       * cobertura da peça — menos o que a rede tem hoje. É a mesma régua da
       * sugestão de compra individual, e usá-la aqui é o que impede o plano de
       * discordar da tela ao lado sobre a mesma peça.
       *
       * Só para quem TEM giro. Sem venda não há alvo de cobertura honesto, e
       * inventar um transformaria a ausência de dado em permissão de comprar.
       */
      absorcao: p.unitsSold > 0 ? Math.max(0, Math.round(p.targetStock - p.currentStock)) : null,
    };
  });

  // O PERFIL QUE VENDE — só do que de fato vendeu. Somar o catálogo inteiro
  // daria peso a perfil que existe em estoque e não sai, que é o oposto do
  // sinal que se procura.
  const porTipoGenero = new Map<string, number>();
  const porFormato = new Map<string, number>();
  const soma = (m: Map<string, number>, k: string | null, v: number) => {
    if (!k) return;
    m.set(k, (m.get(k) ?? 0) + v);
  };
  for (const c of candidatos) {
    if (c.unitsSold <= 0) continue;
    soma(porTipoGenero, chaveDePerfil(c.tipo, c.genero), c.unitsSold);
    soma(porFormato, c.formato ? normBrandKey(c.formato) : null, c.unitsSold);
  }
  const perfil = { porTipoGenero, porFormato, porCor: new Map<string, number>() };

  // O RANKING do formato dentro do segmento — é o que transforma "formato que
  // vende" em "2º formato do segmento", e situa a peça contra as concorrentes.
  const rankPorFormato = new Map<string, number>();
  [...porFormato.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([k], i) => rankPorFormato.set(k, i + 1));

  const metas = Object.fromEntries(
    estrategia.segments.map((s) => [s.key, s.units]),
  ) as Record<SegmentoDoPlano, number>;

  // A margem média do recorte, para a frase comparar em vez de só informar.
  const comPreco = candidatos.filter((c) => c.unitPrice > 0);
  const margemMedia = comPreco.length
    ? Math.round((comPreco.reduce((a, c) => a + margemPct(c.unitPrice, c.unitCost), 0) / comPreco.length) * 10) / 10
    : null;

  const plano = montarPlanoDetalhado(candidatos, metas, perfil, (c, seg, units) =>
    explicarLinha(c, seg, units, {
      rankFormato: c.formato ? (rankPorFormato.get(normBrandKey(c.formato)) ?? null) : null,
      margemMedia,
    }),
  );

  /*
   * E PARA ONDE VAI — a metade da pergunta que a plataforma nunca respondeu.
   *
   * "ele sugere a compra, mas ele não sugere como distribuir isso pra por
   *  loja. É isso que a gente precisa sacar." Três rodadas seguidas.
   *
   * A divisão sai do MESMO `splitByNeed` do rateio de pedido e do plano de
   * recebimento, e passa pelo MESMO porteiro de mix: grife restrita só entra
   * nas lojas que a trabalham, e as excluídas saem nomeadas. Uma quarta conta
   * de "quanto vai para cada loja" seria a divergência seguinte.
   *
   * Só as linhas do plano entram na consulta de posições — algumas centenas,
   * não o recorte inteiro.
   */
  const linhas = plano.segmentos.flatMap((s) => s.linhas);
  const posicoes = await posicoesPorLoja(linhas.map((l) => l.candidato.id), days);
  const mix = await porteiroDeMix();

  const porLoja = new Map<string, { storeId: string; storeName: string; units: number }>();
  const comDestino = linhas.map((l) => {
    const todas = posicoes.get(l.candidato.id) ?? [];
    const { elegiveis, excluidas } = mix.separar(l.candidato.brand, todas);
    const rateio = splitByNeed(elegiveis, l.units, days);
    for (const r of rateio.rows) {
      if (r.suggestedQty <= 0) continue;
      const atual = porLoja.get(r.storeId) ?? { storeId: r.storeId, storeName: r.storeName, units: 0 };
      atual.units += r.suggestedQty;
      porLoja.set(r.storeId, atual);
    }
    return {
      ...l,
      lojas: rateio.rows.filter((r) => r.suggestedQty > 0),
      // Unidades que nenhuma loja elegível reclamou. Declaradas: a soma da
      // tela tem que fechar contra as unidades do plano.
      semLoja: l.units - rateio.rows.reduce((a, r) => a + r.suggestedQty, 0),
      ...(excluidas.length > 0 ? { excludedByMix: excluidas.map((e) => e.storeName) } : {}),
    };
  });

  const porLinha = new Map(comDestino.map((l) => [`${l.segmento}:${l.candidato.id}`, l]));
  return {
    ...plano,
    segmentos: plano.segmentos.map((s) => ({
      ...s,
      linhas: s.linhas.map((l) => porLinha.get(`${s.segmento}:${l.candidato.id}`) ?? l),
    })),
    // A visão POR LOJA — o total que cada filial recebe deste plano, somando
    // todas as linhas. É a leitura de quem monta o malote.
    porLoja: [...porLoja.values()].sort((a, b) => b.units - a.units),
    days,
    candidatosExaminados: candidatos.length,
    /** `true` quando o recorte não coube no teto — ver `TETO_DE_CANDIDATOS`. */
    truncado: productPlans.length > pool.length,
    universo: productPlans.length,
    /**
     * POR QUE O PLANO NÃO FECHOU O PISO, quando não fecha.
     *
     * Plano vazio sem explicação é lido como tela quebrada — foi exatamente o
     * que aconteceu com a aba de distribuição, que existia e abria vazia. Aqui
     * o vazio tem causa e ela é INFORMAÇÃO: significa que a rede não escoa o
     * que o piso pede, e é uma resposta melhor do que uma lista bonita
     * mandando encher as lojas.
     */
    motivo: motivoDoResto(plano.naoAlocado, plano.total, candidatos),
  };
}

/** A frase do resto não alocado — vazia quando o plano fechou o piso. */
function motivoDoResto(naoAlocado: number, total: number, candidatos: CandidatoDeCompra[]): string {
  if (naoAlocado <= 0) return '';
  const comAbsorcao = candidatos.filter((c) => (c.absorcao ?? 0) > 0).length;
  const semGiro = candidatos.filter((c) => c.unitsSold <= 0).length;

  if (total === 0 && comAbsorcao === 0) {
    return (
      `Nenhuma das ${candidatos.length} peças analisadas tem folga para receber mais estoque: ` +
      'todas já estão no alvo de cobertura ou acima dele. O piso pedido não cabe na rede hoje — ' +
      'antes de comprar, o caminho é escoar o que está parado.'
    );
  }
  if (comAbsorcao > 0 && semGiro === candidatos.length - comAbsorcao) {
    return (
      `${naoAlocado} un. do piso não foram alocadas: as peças com giro já chegaram ao alvo de ` +
      'cobertura, e as demais não têm histórico que sustente a compra. Ampliar a janela ou ' +
      'reduzir o piso aproxima o plano do que a rede escoa.'
    );
  }
  return (
    `${naoAlocado} un. do piso não foram alocadas — a oferta analisada não tem variedade ou ` +
    'absorção suficiente para o volume pedido sem concentrar demais em poucas peças.'
  );
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
export async function rebalancePlan(days: number, group: ProductGroup = 'todos', mix?: PorteiroDeMix) {
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

  // Regra de mix: não transferir uma grife para uma loja que não a trabalha.
  // Grifes correntes (não declaradas) valem para todas.
  //
  // O porteiro chega pelo argumento porque `rebalancePlan` é chamado de dentro
  // da montagem do quadro, que já o carregou. Buscá-lo de novo aqui seria uma
  // segunda consulta na rota mais quente da plataforma — e, pior, abriria a
  // possibilidade de as duas metades da mesma requisição decidirem com mixes
  // diferentes, se o cliente salvasse a tela no meio.
  const porteiro = mix ?? (await porteiroDeMix());
  if (porteiro.ativo) {
    // `analysisBrand` com a categoria, como no resto do motor. O campo
    // `category` existe em `RebalanceSuggestion` exatamente para isto.
    plan.rows = plan.rows.filter((r) =>
      porteiro.permite(analysisBrand(r.description, r.category, r.brand), r.toStoreId, r.toStoreName),
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
 * não existe coluna para agrupar em SQL.
 *
 * "Consultada raramente" era o que o comentário anterior dizia, e era uma
 * suposição sobre o comportamento da tela, não um fato do código: a rota não
 * exigia papel nenhum, e a contagem varria o catálogo inteiro — 61 mil linhas,
 * três campos, mais uma extração de grife por linha — a CADA requisição. Um F5
 * repetido custava o catálogo inteiro, num processo que a frente do 503 acabou
 * de limitar a 768 MB. Duas mudanças fecham isso: a rota passou a exigir ADMIN
 * (a decisão é comercial, e o PUT já exigia) e a contagem é memorizada.
 *
 * A memória é do PROCESSO e curta de propósito. Não vale a pena invalidar por
 * evento aqui: o que a torna obsoleta é a sincronização do ERP mexendo no
 * catálogo, e um minuto de atraso numa contagem de produtos por grife não muda
 * decisão nenhuma. A marcação, essa sim, é imediata — `setBrandMix` derruba a
 * memória, porque ver o próprio clique refletido é o mínimo que a tela deve.
 */
const MEMORIA_DO_MIX_MS = 60_000;
let memoriaDoMix: { em: number; contagem: Map<string, { brand: string; products: number }> } | null = null;

/** Derruba a contagem memorizada de grifes (chamada por quem escreve o mix). */
export function esquecerContagemDeGrifes() {
  memoriaDoMix = null;
}

async function contagemDeGrifes(agora: number) {
  if (memoriaDoMix && agora - memoriaDoMix.em < MEMORIA_DO_MIX_MS) return memoriaDoMix.contagem;

  const produtos = await prisma.product.findMany({
    select: { description: true, category: true, brand: true },
  });
  const contagem = new Map<string, { brand: string; products: number }>();
  for (const p of produtos) {
    const grife = analysisBrand(p.description, p.category, p.brand);
    if (!grife) continue;
    const k = normBrandKey(grife);
    const atual = contagem.get(k);
    if (atual) atual.products += 1;
    else contagem.set(k, { brand: grife, products: 1 });
  }
  memoriaDoMix = { em: agora, contagem };
  return contagem;
}

export async function listBrandMix() {
  // A contagem pode vir da memória; a MARCAÇÃO nunca — é o dado que a tela
  // acabou de escrever, e lê-la de um instantâneo faria o clique parecer
  // perdido.
  const [contagem, marcados] = await Promise.all([
    contagemDeGrifes(Date.now()),
    prisma.brandMix.findMany(),
  ]);

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

  /*
   * GRAVA NA CHAVE NORMALIZADA — a mesma que a leitura usa.
   *
   * `listBrandMix` e `discontinuedBrandResolver` comparam por `normBrandKey`
   * (maiúscula, sem acento, espaços colapsados); a escrita usava a string
   * literal que veio da tela. As duas pontas concordavam por acaso, enquanto a
   * tela mandasse exatamente o texto que ela mesma tinha renderizado — e
   * desmontavam nos dois casos que a operação produz sozinha:
   *
   *  · DESMARCAR com outra forma da mesma grife ("Dolce & Gabbana" contra
   *    "DOLCE & GABBANA" gravado) apagava zero linhas. A tela dizia que
   *    desmarcou, a linha continuava no banco, e o motor continuava cortando a
   *    grife da compra. Silêncio dos dois lados: `deleteMany` que não encontra
   *    nada não é erro.
   *  · MARCAR com duas formas criava DUAS linhas — `brand` é único sobre a
   *    string literal — e desmarcar uma delas deixava a outra valendo.
   */
  const chave = normBrandKey(clean);

  if (!discontinued) {
    // Desmarcar apaga a linha em vez de guardar `false`: a tabela existe para
    // registrar exceções, e uma lista de exceções cheia de não-exceções é uma
    // lista que ninguém consegue ler.
    await prisma.brandMix.deleteMany({ where: { brand: chave } });
    esquecerContagemDeGrifes();
    publish({ type: 'planning.settings.changed', setting: 'brand-mix', brand: chave });
    return { brand: chave, discontinued: false };
  }

  const row = await prisma.brandMix.upsert({
    where: { brand: chave },
    create: { brand: chave, discontinued: true },
    update: { discontinued: true },
  });
  esquecerContagemDeGrifes();
  publish({ type: 'planning.settings.changed', setting: 'brand-mix', brand: row.brand });
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
    publish({ type: 'planning.settings.changed', setting: 'supplier', brand: clean });
    return { brand: clean, leadTimeDays: null };
  }

  const row = await prisma.supplierSetting.upsert({
    where: { brand: clean },
    create: { brand: clean, leadTimeDays },
    update: { leadTimeDays },
  });
  publish({ type: 'planning.settings.changed', setting: 'supplier', brand: row.brand });
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
