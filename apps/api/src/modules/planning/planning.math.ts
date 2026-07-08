/**
 * Planejamento & Compras — funções puras de análise preditiva de estoque.
 *
 * Reúne os indicadores usados para uma gestão preventiva/proativa:
 *  - demanda diária, cobertura (dias de estoque), ponto de reposição e alvo;
 *  - classificação de giro (parado / baixo / saudável / alto);
 *  - recomendação de compra (comprar, manter, não comprar, liquidar);
 *  - capital imobilizado (total, ocioso/parado, em excesso) — a custo;
 *  - Pareto (80/20) da receita (poucos SKUs "vitais" x muitos "triviais").
 *
 * Tudo é puro e determinístico para permitir testes e reuso pela demo.
 */

export interface PlanningConfig {
  /** Prazo de entrega/ressuprimento do fornecedor (dias). */
  leadTimeDays: number;
  /** Estoque de segurança expresso em dias de demanda. */
  safetyDays: number;
  /** Cobertura-alvo ao repor (dias de demanda). */
  targetCoverDays: number;
  /** Acima desta cobertura o item é considerado em excesso (não comprar). */
  overstockDays: number;
  /** Cobertura abaixo da qual o giro é "alto" (risco de ruptura). */
  fastCoverDays: number;
  /** Cobertura acima da qual o giro é "baixo" (mas ainda com vendas). */
  slowCoverDays: number;
}

export const DEFAULT_PLANNING_CONFIG: PlanningConfig = {
  leadTimeDays: 14,
  safetyDays: 7,
  targetCoverDays: 60,
  overstockDays: 120,
  fastCoverDays: 15,
  slowCoverDays: 90,
};

export type MovementClass = 'DEAD' | 'SLOW' | 'HEALTHY' | 'FAST';
export type Recommendation = 'BUY' | 'HOLD' | 'DONT_BUY' | 'LIQUIDATE';

export interface ProductMetricsInput {
  productId: string;
  description: string;
  brand: string | null;
  category: string | null;
  /** Unidades vendidas no período analisado. */
  unitsSold: number;
  /** Estoque atual (on-hand) somando as lojas do escopo. */
  currentStock: number;
  /** Custo unitário (R$). */
  unitCost: number;
  /** Preço de venda unitário (R$). */
  unitPrice: number;
  /** Unidades já pedidas ao fornecedor e ainda não recebidas (a caminho). */
  onOrderQty?: number;
}

export interface ProductPlan {
  productId: string;
  description: string;
  brand: string | null;
  category: string | null;
  currentStock: number;
  unitsSold: number;
  dailyDemand: number;
  /** Dias de cobertura do estoque atual; null quando não há giro (infinito). */
  coverageDays: number | null;
  reorderPoint: number;
  targetStock: number;
  unitCost: number;
  /** Capital imobilizado neste item (estoque atual × custo). */
  stockValue: number;
  /** Capital imobilizado acima do alvo de cobertura (excesso/ocioso). */
  excessValue: number;
  revenue: number;
  movementClass: MovementClass;
  recommendation: Recommendation;
  /** Quantidade a comprar (0 quando não se recomenda comprar). */
  suggestedQty: number;
  /** Capital da compra sugerida (R$). */
  capital: number;
  /** Previsão de ruptura em dias, para itens em risco (senão null). */
  stockoutInDays: number | null;
  reason: string;
  /** Unidades a caminho (pedidos enviados e não recebidos). */
  onOrderQty: number;
  /** Prazo de ressuprimento aplicado (do fornecedor/marca ou padrão). */
  leadTimeDays: number;
  /**
   * Dias restantes para fazer o pedido sem romper: quanto falta para o
   * estoque atingir o ponto de reposição no ritmo de venda atual.
   * 0 = pedir agora (já está no/abaixo do ponto); null = sem giro.
   */
  orderByInDays: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Analisa um único produto e devolve o plano completo. */
export function analyzeProduct(
  input: ProductMetricsInput,
  days: number,
  cfg: PlanningConfig = DEFAULT_PLANNING_CONFIG,
): ProductPlan {
  const dailyDemand = days > 0 ? input.unitsSold / days : 0;
  const coverageDays = dailyDemand > 0 ? input.currentStock / dailyDemand : null;
  const reorderPoint = dailyDemand * (cfg.leadTimeDays + cfg.safetyDays);
  const targetStock = dailyDemand * cfg.targetCoverDays;

  // Posição de estoque = físico + a caminho: decide a compra sem duplicar
  // pedidos já enviados ao fornecedor.
  const onOrder = Math.max(0, input.onOrderQty ?? 0);
  const position = input.currentStock + onOrder;

  const stockValue = round2(input.currentStock * input.unitCost);
  const excessUnits = Math.max(0, input.currentStock - targetStock);
  const excessValue = round2(excessUnits * input.unitCost);
  const revenue = round2(input.unitsSold * input.unitPrice);

  // Classe de giro
  let movementClass: MovementClass;
  if (dailyDemand === 0) movementClass = 'DEAD';
  else if ((coverageDays as number) < cfg.fastCoverDays) movementClass = 'FAST';
  else if ((coverageDays as number) <= cfg.slowCoverDays) movementClass = 'HEALTHY';
  else movementClass = 'SLOW';

  // Recomendação de compra
  let recommendation: Recommendation;
  let suggestedQty = 0;
  let reason: string;
  if (dailyDemand === 0) {
    if (input.currentStock > 0) {
      recommendation = 'LIQUIDATE';
      reason = 'Sem vendas no período — capital parado; avaliar liquidação ou remanejamento.';
    } else {
      recommendation = 'DONT_BUY';
      reason = 'Sem giro e sem estoque — não repor.';
    }
  } else if (position <= reorderPoint) {
    recommendation = 'BUY';
    suggestedQty = Math.max(1, Math.ceil(targetStock - position));
    reason = `Abaixo do ponto de reposição (${round1(reorderPoint)} un.); repor para ~${cfg.targetCoverDays} dias de cobertura.`;
  } else if (input.currentStock <= reorderPoint && onOrder > 0) {
    recommendation = 'HOLD';
    reason = `No ponto de reposição, mas ${onOrder} un. a caminho cobrem a reposição.`;
  } else if ((coverageDays as number) > cfg.overstockDays) {
    recommendation = 'DONT_BUY';
    reason = `Excesso: ${Math.round(coverageDays as number)} dias de cobertura (acima de ${cfg.overstockDays}). Não comprar.`;
  } else {
    recommendation = 'HOLD';
    reason = `Cobertura adequada (${Math.round(coverageDays as number)} dias).`;
  }

  const capital = round2(suggestedQty * input.unitCost);
  const stockoutInDays =
    dailyDemand > 0 && position <= reorderPoint ? Math.floor(coverageDays as number) : null;

  // Prazo-limite do pedido: dias até a POSIÇÃO cair ao ponto de reposição
  // (o que está a caminho adia a necessidade de um novo pedido).
  const orderByInDays =
    dailyDemand > 0 ? Math.max(0, Math.floor((position - reorderPoint) / dailyDemand)) : null;

  return {
    productId: input.productId,
    description: input.description,
    brand: input.brand,
    category: input.category,
    currentStock: input.currentStock,
    unitsSold: input.unitsSold,
    dailyDemand: round2(dailyDemand),
    coverageDays: coverageDays === null ? null : round1(coverageDays),
    reorderPoint: round1(reorderPoint),
    targetStock: Math.round(targetStock),
    unitCost: round2(input.unitCost),
    stockValue,
    excessValue,
    revenue,
    movementClass,
    recommendation,
    suggestedQty,
    capital,
    stockoutInDays,
    reason,
    onOrderQty: onOrder,
    leadTimeDays: cfg.leadTimeDays,
    orderByInDays,
  };
}

export interface CapitalBreakdown {
  total: number;
  /** Capital ocioso = parado (sem giro) + excesso acima do alvo. */
  idle: number;
  /** Capital parado (itens sem nenhuma venda no período). */
  parked: number;
  /** Capital em excesso de itens com giro (acima da cobertura-alvo). */
  excess: number;
  /** Capital em itens saudáveis (dentro do alvo). */
  healthy: number;
  /** % do capital total que está ocioso. */
  idlePct: number;
}

export interface CategoryCapital {
  category: string;
  capital: number;
  idle: number;
  units: number;
}

export interface ParetoSummary {
  totalRevenue: number;
  totalProducts: number;
  classAProducts: number;
  classAShareOfSkus: number;
  classARevenueShare: number;
}

export interface PlanningOverview {
  days: number;
  currency: 'BRL';
  capital: CapitalBreakdown;
  movement: Record<Lowercase<MovementClass>, number>;
  pareto: ParetoSummary;
  topIdle: Array<{
    productId: string;
    description: string;
    category: string | null;
    currentStock: number;
    unitCost: number;
    idleValue: number;
    coverageDays: number | null;
    movementClass: MovementClass;
  }>;
  byCategory: CategoryCapital[];
}

/** Pareto (80/20) por receita a partir dos planos. */
export function paretoSummary(plans: ProductPlan[]): ParetoSummary {
  const ranked = plans.filter((p) => p.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = round2(ranked.reduce((s, p) => s + p.revenue, 0));
  let cum = 0;
  let classAProducts = 0;
  let classARevenue = 0;
  for (const p of ranked) {
    cum += p.revenue;
    const cumPct = totalRevenue > 0 ? (cum / totalRevenue) * 100 : 0;
    if (cumPct <= 80) {
      classAProducts += 1;
      classARevenue += p.revenue;
    } else {
      break; // os demais são classe B/C (mesma regra da curva ABC)
    }
  }
  // Garante ao menos 1 "vital" quando um único SKU já concentra >80% da receita.
  if (classAProducts === 0 && ranked.length > 0) {
    classAProducts = 1;
    classARevenue = ranked[0].revenue;
  }
  return {
    totalRevenue,
    totalProducts: ranked.length,
    classAProducts,
    classAShareOfSkus: ranked.length > 0 ? round1((classAProducts / ranked.length) * 100) : 0,
    classARevenueShare: totalRevenue > 0 ? round1((classARevenue / totalRevenue) * 100) : 0,
  };
}

/** Monta o panorama de capital imobilizado + Pareto a partir dos planos. */
export function buildOverview(plans: ProductPlan[], days: number): PlanningOverview {
  const total = round2(plans.reduce((s, p) => s + p.stockValue, 0));
  const parked = round2(
    plans.filter((p) => p.movementClass === 'DEAD').reduce((s, p) => s + p.stockValue, 0),
  );
  const excess = round2(
    plans.filter((p) => p.movementClass !== 'DEAD').reduce((s, p) => s + p.excessValue, 0),
  );
  const idle = round2(parked + excess);
  const healthy = round2(Math.max(0, total - idle));

  const movement = { dead: 0, slow: 0, healthy: 0, fast: 0 } as Record<Lowercase<MovementClass>, number>;
  for (const p of plans) movement[p.movementClass.toLowerCase() as Lowercase<MovementClass>] += 1;

  const catMap = new Map<string, CategoryCapital>();
  for (const p of plans) {
    const key = p.category ?? 'Sem categoria';
    const cur = catMap.get(key) ?? { category: key, capital: 0, idle: 0, units: 0 };
    cur.capital = round2(cur.capital + p.stockValue);
    cur.idle = round2(cur.idle + (p.movementClass === 'DEAD' ? p.stockValue : p.excessValue));
    cur.units += p.currentStock;
    catMap.set(key, cur);
  }
  const byCategory = Array.from(catMap.values()).sort((a, b) => b.capital - a.capital);

  const topIdle = [...plans]
    .map((p) => ({
      productId: p.productId,
      description: p.description,
      category: p.category,
      currentStock: p.currentStock,
      unitCost: p.unitCost,
      idleValue: p.movementClass === 'DEAD' ? p.stockValue : p.excessValue,
      coverageDays: p.coverageDays,
      movementClass: p.movementClass,
    }))
    .filter((p) => p.idleValue > 0)
    .sort((a, b) => b.idleValue - a.idleValue)
    .slice(0, 8);

  return {
    days,
    currency: 'BRL',
    capital: {
      total,
      idle,
      parked,
      excess,
      healthy,
      idlePct: total > 0 ? round1((idle / total) * 100) : 0,
    },
    movement,
    pareto: paretoSummary(plans),
    topIdle,
    byCategory,
  };
}

export interface PurchaseSuggestions {
  days: number;
  summary: {
    buy: number;
    hold: number;
    dontBuy: number;
    liquidate: number;
    buyCapital: number;
    /** Capital que NÃO deve ser reposto / pode ser liberado (excesso + parado). */
    avoidedCapital: number;
  };
  rows: ProductPlan[];
}

const recRank: Record<Recommendation, number> = { BUY: 0, LIQUIDATE: 1, DONT_BUY: 2, HOLD: 3 };

/** Consolida a lista de recomendações de compra a partir dos planos. */
export function buildSuggestions(plans: ProductPlan[], days: number): PurchaseSuggestions {
  const summary = {
    buy: 0,
    hold: 0,
    dontBuy: 0,
    liquidate: 0,
    buyCapital: 0,
    avoidedCapital: 0,
  };
  for (const p of plans) {
    if (p.recommendation === 'BUY') {
      summary.buy += 1;
      summary.buyCapital += p.capital;
    } else if (p.recommendation === 'HOLD') summary.hold += 1;
    else if (p.recommendation === 'DONT_BUY') {
      summary.dontBuy += 1;
      summary.avoidedCapital += p.excessValue;
    } else {
      summary.liquidate += 1;
      summary.avoidedCapital += p.stockValue;
    }
  }
  summary.buyCapital = round2(summary.buyCapital);
  summary.avoidedCapital = round2(summary.avoidedCapital);

  const rows = [...plans].sort((a, b) => {
    const r = recRank[a.recommendation] - recRank[b.recommendation];
    if (r !== 0) return r;
    // dentro de BUY, prioriza quem rompe antes; senão, maior capital envolvido
    if (a.recommendation === 'BUY') return (a.stockoutInDays ?? 1e9) - (b.stockoutInDays ?? 1e9);
    return b.stockValue - a.stockValue;
  });

  return { days, summary, rows };
}

// ─── Redistribuição entre lojas (rebalanceamento) ───────────────────────────

export interface StoreProductInput {
  storeId: string;
  storeName: string;
  productId: string;
  description: string;
  brand: string | null;
  /** Unidades vendidas NESTA loja no período. */
  unitsSold: number;
  /** Estoque atual NESTA loja. */
  currentStock: number;
}

export interface RebalanceSuggestion {
  productId: string;
  description: string;
  brand: string | null;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  quantity: number;
  fromCoverageDays: number | null;
  toCoverageDays: number | null;
  /** Previsão de ruptura no destino (dias), quando houver. */
  stockoutInDays: number | null;
  reason: string;
}

export interface RebalancePlan {
  days: number;
  summary: { suggestions: number; units: number; storesInvolved: number };
  rows: RebalanceSuggestion[];
}

const fmtCover = (c: number | null) =>
  c === null ? 'sem giro' : `${Math.round(c)} dia${Math.round(c) === 1 ? '' : 's'} de cobertura`;

/**
 * Cruza vendas × estoque por loja e sugere transferências: lojas com excesso
 * (ou estoque parado) doam para lojas onde o mesmo produto vende e está
 * abaixo do ponto de reposição. Antes de sugerir compra, o estoque que já
 * existe na rede é realocado — evitando sobra num canto e ruptura no outro.
 *
 * Regras (por produto):
 *  - Receptora: vende (demanda > 0) e cobertura < leadTime+safety; a
 *    necessidade repõe até a cobertura-alvo.
 *  - Doadora: sem giro com estoque parado (doa tudo), ou com giro e
 *    cobertura acima do alvo (doa só o excedente acima do alvo).
 *  - Receptoras mais urgentes primeiro; doadoras com mais sobra primeiro.
 */
export function buildRebalance(
  rows: StoreProductInput[],
  days: number,
  cfgFor: (brand: string | null) => PlanningConfig = () => DEFAULT_PLANNING_CONFIG,
): RebalancePlan {
  interface StorePos {
    storeId: string;
    storeName: string;
    dailyDemand: number;
    stock: number;
    coverage: number | null;
  }
  const byProduct = new Map<string, { description: string; brand: string | null; stores: StorePos[] }>();

  for (const r of rows) {
    const dailyDemand = days > 0 ? r.unitsSold / days : 0;
    const pos: StorePos = {
      storeId: r.storeId,
      storeName: r.storeName,
      dailyDemand,
      stock: r.currentStock,
      coverage: dailyDemand > 0 ? r.currentStock / dailyDemand : null,
    };
    const cur = byProduct.get(r.productId) ?? { description: r.description, brand: r.brand, stores: [] };
    cur.stores.push(pos);
    byProduct.set(r.productId, cur);
  }

  const out: RebalanceSuggestion[] = [];

  for (const [productId, p] of byProduct) {
    const cfg = cfgFor(p.brand);
    const minCover = cfg.leadTimeDays + cfg.safetyDays;

    const receivers = p.stores
      .filter((s) => s.dailyDemand > 0 && (s.coverage as number) < minCover)
      .map((s) => ({
        ...s,
        need: Math.max(0, Math.ceil(s.dailyDemand * cfg.targetCoverDays - s.stock)),
      }))
      .filter((s) => s.need > 0)
      .sort((a, b) => (a.coverage as number) - (b.coverage as number));

    const donors = p.stores
      .map((s) => ({
        ...s,
        spare:
          s.dailyDemand === 0
            ? s.stock // parado: pode doar tudo
            : Math.floor(s.stock - s.dailyDemand * cfg.targetCoverDays), // com giro: só o excedente
      }))
      .filter((s) => s.spare > 0)
      .sort((a, b) => b.spare - a.spare);

    for (const receiver of receivers) {
      let need = receiver.need;
      for (const donor of donors) {
        if (need <= 0) break;
        if (donor.spare <= 0 || donor.storeId === receiver.storeId) continue;
        const qty = Math.min(need, donor.spare);
        need -= qty;
        donor.spare -= qty;

        const stockout = (receiver.coverage as number) < minCover ? Math.floor(receiver.coverage as number) : null;
        const donorSide =
          donor.dailyDemand === 0
            ? `parado em ${donor.storeName} (${donor.stock} un. sem venda no período)`
            : `sobrando em ${donor.storeName} (${fmtCover(donor.coverage)})`;
        out.push({
          productId,
          description: p.description,
          brand: p.brand,
          fromStoreId: donor.storeId,
          fromStoreName: donor.storeName,
          toStoreId: receiver.storeId,
          toStoreName: receiver.storeName,
          quantity: qty,
          fromCoverageDays: donor.coverage === null ? null : round1(donor.coverage),
          toCoverageDays: receiver.coverage === null ? null : round1(receiver.coverage),
          stockoutInDays: stockout,
          reason: `Vende em ${receiver.storeName} (${fmtCover(receiver.coverage)}) e está ${donorSide}.`,
        });
      }
    }
  }

  // Urgência primeiro: menor previsão de ruptura no destino, depois maior qtde.
  out.sort((a, b) => (a.stockoutInDays ?? 1e9) - (b.stockoutInDays ?? 1e9) || b.quantity - a.quantity);

  const stores = new Set<string>();
  for (const s of out) {
    stores.add(s.fromStoreId);
    stores.add(s.toStoreId);
  }
  return {
    days,
    summary: {
      suggestions: out.length,
      units: out.reduce((sum, s) => sum + s.quantity, 0),
      storesInvolved: stores.size,
    },
    rows: out,
  };
}

// ─── Pedidos por fornecedor (rascunho de ordem de compra) ───────────────────

export interface PurchaseOrderItem {
  productId: string;
  description: string;
  category: string | null;
  quantity: number;
  unitCost: number;
  total: number;
  /** Dias restantes para pedir sem romper (0 = hoje). */
  orderByInDays: number | null;
  stockoutInDays: number | null;
}

export interface PurchaseOrder {
  /** Fornecedor = marca do produto; itens sem marca ficam em "Sem marca". */
  supplier: string;
  leadTimeDays: number;
  items: PurchaseOrderItem[];
  units: number;
  total: number;
  /**
   * Data-limite do pedido (dias): o item mais urgente define quando este
   * pedido precisa ser enviado ao fornecedor. null = sem urgência definida.
   */
  orderByInDays: number | null;
  /** Menor previsão de ruptura entre os itens (dias) — urgência do pedido. */
  stockoutInDays: number | null;
}

export interface PurchaseOrdersPlan {
  days: number;
  summary: { suppliers: number; items: number; units: number; total: number };
  orders: PurchaseOrder[];
}

const NO_BRAND = 'Sem marca';

/**
 * Consolida os itens com recomendação COMPRAR em rascunhos de ordem de
 * compra, um por fornecedor (marca): quantidades, capital total e a
 * data-limite (o item mais urgente manda). Fornecedores mais urgentes
 * primeiro — é a fila de pedidos do dia.
 */
export function buildPurchaseOrders(plans: ProductPlan[], days: number): PurchaseOrdersPlan {
  const bySupplier = new Map<string, PurchaseOrder>();

  for (const p of plans) {
    if (p.recommendation !== 'BUY' || p.suggestedQty <= 0) continue;
    const supplier = p.brand ?? NO_BRAND;
    const order =
      bySupplier.get(supplier) ??
      ({
        supplier,
        leadTimeDays: p.leadTimeDays,
        items: [],
        units: 0,
        total: 0,
        orderByInDays: null,
        stockoutInDays: null,
      } as PurchaseOrder);

    order.items.push({
      productId: p.productId,
      description: p.description,
      category: p.category,
      quantity: p.suggestedQty,
      unitCost: p.unitCost,
      total: p.capital,
      orderByInDays: p.orderByInDays,
      stockoutInDays: p.stockoutInDays,
    });
    order.units += p.suggestedQty;
    order.total = round2(order.total + p.capital);
    if (p.orderByInDays !== null) {
      order.orderByInDays =
        order.orderByInDays === null ? p.orderByInDays : Math.min(order.orderByInDays, p.orderByInDays);
    }
    if (p.stockoutInDays !== null) {
      order.stockoutInDays =
        order.stockoutInDays === null ? p.stockoutInDays : Math.min(order.stockoutInDays, p.stockoutInDays);
    }
    bySupplier.set(supplier, order);
  }

  // Itens BUY estão sempre no/abaixo do ponto de reposição (prazo-limite
  // "hoje"); quem desempata a urgência é a previsão de ruptura.
  const orders = Array.from(bySupplier.values());
  for (const o of orders) {
    o.items.sort((a, b) => (a.stockoutInDays ?? 1e9) - (b.stockoutInDays ?? 1e9) || b.total - a.total);
  }
  orders.sort((a, b) => (a.stockoutInDays ?? 1e9) - (b.stockoutInDays ?? 1e9) || b.total - a.total);

  return {
    days,
    summary: {
      suppliers: orders.length,
      items: orders.reduce((s, o) => s + o.items.length, 0),
      units: orders.reduce((s, o) => s + o.units, 0),
      total: round2(orders.reduce((s, o) => s + o.total, 0)),
    },
    orders,
  };
}
