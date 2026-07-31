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
  /**
   * Custo anual de carregar estoque, em % do capital parado: custo de capital
   * + armazenagem + perda/obsolescência. É o que transforma "tem 47 meses de
   * cobertura" em "isso custa R$ X por mês parado" — a régua que torna as
   * decisões comparáveis entre si.
   */
  carryingCostAnnualPct: number;
}

export const DEFAULT_PLANNING_CONFIG: PlanningConfig = {
  leadTimeDays: 14,
  safetyDays: 7,
  targetCoverDays: 60,
  overstockDays: 120,
  fastCoverDays: 15,
  slowCoverDays: 90,
  // 25%/ano é a faixa usual do varejo de moda (capital ~12% + armazenagem
  // ~5% + obsolescência/perda ~8%). Ajustável por configuração.
  carryingCostAnnualPct: 25,
};

/**
 * A análise de MARCA vale só para produto de moda (óculos, armação, relógio).
 *
 * Decisão do cliente (Galbe, 28/07): lente e tratamento não entram na análise
 * de marca — "Zeiss é fornecedor de lente, portanto não deve entrar nas
 * análises nesse momento". Elas terão módulo próprio, o do setor de produção
 * (o laboratório da rede).
 *
 * Consequência assumida: as visões por marca cobrem uma base MENOR que as
 * visões por SKU/loja/vendedor (nos dados reais, ~43% da receita). Isso é
 * recorte declarado, não perda silenciosa — os serviços devolvem o total
 * excluído para a tela poder dizer o que ficou de fora.
 */
export function isBrandAnalysable(category: string | null | undefined): boolean {
  return matchesProductGroup(category, 'principal');
}

// ─── Economia da decisão: carregamento, margem e faixas de preço ─────────────

/**
 * Quanto custa manter um capital parado por um período.
 * Ex.: R$ 100.000 parados por 30 dias a 25%/ano = R$ 2.054.
 */
export function carryingCost(
  stockValue: number,
  days: number,
  cfg: PlanningConfig = DEFAULT_PLANNING_CONFIG,
): number {
  if (!(stockValue > 0) || !(days > 0)) return 0;
  const annual = Math.max(0, cfg.carryingCostAnnualPct) / 100;
  return round2(stockValue * annual * (days / 365));
}

/** Margem bruta unitária em % do preço (0 quando o preço não é positivo). */
export function marginPct(unitPrice: number, unitCost: number): number {
  if (!(unitPrice > 0)) return 0;
  return round2(((unitPrice - unitCost) / unitPrice) * 100);
}

/**
 * Desconto sugerido para liquidar — a REGRA DA REDE, dita pelo cliente.
 *
 * Galbe, 30/07: "Esse desconto eu vou sugerir um parâmetro, se não vai ficar
 * meio que na doida e não é legal." E mandou o parâmetro:
 *
 *   • promoção vale para peça FORA DE COLEÇÃO do fornecedor;
 *   • começa em 20% quando o preço cheio é abaixo de R$ 1.000;
 *   • começa em 30% quando o preço cheio é R$ 1.000 ou mais;
 *   • sobe 10 pontos percentuais a cada 90 dias.
 *
 * A versão anterior calculava o desconto pelo custo de carregar o estoque. A
 * conta era defensável e a régua era nossa — esta é da rede, que liquida óculos
 * há mais tempo do que nós. Onde as duas discordam, a da rede vence.
 *
 * Duas coisas que a regra não diz e a tela precisa dizer:
 *  1. "Fora de coleção" é um dado do fornecedor que ainda não temos. O gatilho
 *     aqui é o card de LIQUIDAÇÃO (estoque sem giro) — está declarado na tela.
 *  2. O TETO continua sendo o desconto que zera a margem: nenhuma sugestão
 *     automática manda vender abaixo do custo. Quando o custo de compra não
 *     veio do ERP (77% do catálogo hoje), o teto é estimado e a tela avisa.
 */
export interface DiscountInput {
  unitPrice: number;
  unitCost: number;
  /** Cobertura em dias; null = sem giro nenhum. Mantido para compatibilidade. */
  coverageDays: number | null;
  /**
   * Dias parada. Hoje vem do lote de geração (primeira aparição do card) — a
   * data de entrada da peça em estoque não vem na grade do ERP que
   * consumimos. É o que move a peça de degrau na regra dos 90 dias.
   */
  stuckDays?: number | null;
  /** true quando o custo é estimado (o ERP não trouxe o valor de compra). */
  costEstimated?: boolean;
  /** Giro da MARCA na rede, em unidades no período — informativo na tela. */
  brandUnitsSold?: number;
}

export interface DiscountAdvice {
  suggestedPct: number;
  maxPct: number;
  rationale: string;
  /** Os parâmetros usados, para a tela poder mostrar de onde saiu o número. */
  params: {
    /** Degrau inicial da regra: 20% ou 30%. */
    basePct: number;
    /** Faixa de preço que definiu o degrau inicial. */
    priceBand: 'abaixo de R$ 1.000' | 'R$ 1.000 ou mais';
    /** Quanto sobe por degrau (p.p.) e de quantos em quantos dias. */
    stepPct: number;
    stepDays: number;
    /** Quantos degraus já subiu pelo tempo parado. */
    steps: number;
    stuckDays: number | null;
    /** Margem bruta (%) — é ela que define o teto. */
    marginPct: number;
    /** true quando o teto saiu de um custo estimado, não do valor de compra. */
    ceilingEstimated: boolean;
    brandUnitsSold: number | null;
  };
}

/** Degrau inicial da regra da rede, pela faixa de preço cheio. */
export const DISCOUNT_RULE = {
  priceBreak: 1000,
  baseBelow: 20,
  baseFrom: 30,
  stepPct: 10,
  stepDays: 90,
} as const;

export function suggestedDiscount(
  unitPriceOrInput: number | DiscountInput,
  unitCost?: number,
  coverageDays?: number | null,
  _cfg: PlanningConfig = DEFAULT_PLANNING_CONFIG,
): DiscountAdvice {
  const input: DiscountInput =
    typeof unitPriceOrInput === 'number'
      ? { unitPrice: unitPriceOrInput, unitCost: unitCost ?? 0, coverageDays: coverageDays ?? null }
      : unitPriceOrInput;

  const margem = marginPct(input.unitPrice, input.unitCost);
  const maxPct = Math.max(0, Math.floor(margem));
  const ceilingEstimated = input.costEstimated === true;
  const acimaDaQuebra = input.unitPrice >= DISCOUNT_RULE.priceBreak;
  const basePct = acimaDaQuebra ? DISCOUNT_RULE.baseFrom : DISCOUNT_RULE.baseBelow;
  const priceBand: DiscountAdvice['params']['priceBand'] = acimaDaQuebra
    ? 'R$ 1.000 ou mais'
    : 'abaixo de R$ 1.000';
  const parada = input.stuckDays != null && input.stuckDays > 0 ? input.stuckDays : null;
  const steps = parada ? Math.floor(parada / DISCOUNT_RULE.stepDays) : 0;

  const params: DiscountAdvice['params'] = {
    basePct,
    priceBand,
    stepPct: DISCOUNT_RULE.stepPct,
    stepDays: DISCOUNT_RULE.stepDays,
    steps,
    stuckDays: parada,
    marginPct: margem,
    ceilingEstimated,
    brandUnitsSold: input.brandUnitsSold ?? null,
  };

  if (maxPct <= 0) {
    return {
      suggestedPct: 0,
      maxPct: 0,
      rationale: 'Sem margem para desconto — avalie devolução ao fornecedor ou bonificação.',
      params,
    };
  }

  const pelaRegra = basePct + DISCOUNT_RULE.stepPct * steps;
  const suggestedPct = Math.min(pelaRegra, maxPct);
  const limitadoPeloTeto = pelaRegra > maxPct;

  const degrau =
    steps > 0
      ? ` Parada há ${parada} dias: ${steps} ${steps === 1 ? 'degrau' : 'degraus'} de ${DISCOUNT_RULE.stepPct} p.p. (${DISCOUNT_RULE.stepDays} dias cada), então ${basePct}% + ${DISCOUNT_RULE.stepPct * steps} = ${pelaRegra}%.`
      : parada
        ? ` Parada há ${parada} dias — ainda no degrau inicial; sobe ${DISCOUNT_RULE.stepPct} p.p. aos ${DISCOUNT_RULE.stepDays} dias.`
        : ' Sem histórico de quanto tempo está parada: fica no degrau inicial.';
  const teto = limitadoPeloTeto
    ? ` A regra pedia ${pelaRegra}%, mas ${maxPct}% já zera a margem${ceilingEstimated ? ' (margem estimada — falta o valor de compra no ERP)' : ''}.`
    : '';

  return {
    suggestedPct,
    maxPct,
    rationale: `Regra da rede: preço cheio ${priceBand}, começa em ${basePct}%.${degrau}${teto}`,
    params,
  };
}

/** Margem bruta esperada (R$) de vender uma quantidade. */
export function expectedMargin(units: number, unitPrice: number, unitCost: number): number {
  if (!(units > 0)) return 0;
  return round2(units * (unitPrice - unitCost));
}

export interface PriceBand {
  key: 'acessivel' | 'premium_acessivel' | 'premium' | 'luxo';
  label: string;
  min: number;
  max: number;
  /** Quantos SKUs observados caem nesta faixa. */
  count: number;
}

const BAND_META: { key: PriceBand['key']; label: string }[] = [
  { key: 'acessivel', label: 'Acessível' },
  { key: 'premium_acessivel', label: 'Premium acessível' },
  { key: 'premium', label: 'Premium' },
  { key: 'luxo', label: 'Luxo' },
];

/**
 * Faixas de preço OBSERVADAS na rede, por quartil — não são parâmetro
 * digitado. Devolve o intervalo real de cada quartil, que é o que permite
 * ler mix ("o estoque está pesado no topo") sem inventar limites.
 */
export function buildPriceBands(prices: number[]): PriceBand[] {
  const sorted = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const bands: PriceBand[] = [];
  for (let i = 0; i < 4; i++) {
    const start = Math.floor((sorted.length * i) / 4);
    const end = Math.floor((sorted.length * (i + 1)) / 4);
    const slice = sorted.slice(start, end);
    if (slice.length === 0) continue;
    bands.push({
      ...BAND_META[i],
      min: round2(slice[0]),
      max: round2(slice[slice.length - 1]),
      count: slice.length,
    });
  }
  return bands;
}

export type MovementClass = 'DEAD' | 'SLOW' | 'HEALTHY' | 'FAST';
export type Recommendation = 'BUY' | 'HOLD' | 'DONT_BUY' | 'LIQUIDATE';

// ─── Grupos de cobertura (recorte por categoria) ─────────────────────────────

/**
 * Visões de cobertura pedidas pela operação:
 * - `principal`: o que a rede chama de "cobertura" no dia a dia — óculos
 *   (solares), óculos de grau/armações e relógios;
 * - `lentes`: lentes analisadas à parte, para as reposições;
 * - `todos`: consolidado com todas as demais categorias (estojos, acessórios…).
 */
export type ProductGroup = 'principal' | 'lentes' | 'todos';

export const PRODUCT_GROUPS: ProductGroup[] = ['principal', 'lentes', 'todos'];

/** Normaliza para comparação: minúsculas, sem acentos. */
const normCategory = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/**
 * Decide se uma categoria pertence ao grupo. O casamento é por palavra-chave
 * normalizada (sem acento), tolerante às variações de nome vindas do ERP
 * ("OCULOS SOLAR", "Armação RX", "RELOGIO", "Lente de contato"…).
 * Categoria com "lente" nunca entra no principal, mesmo que também cite grau.
 */
export function matchesProductGroup(category: string | null | undefined, group: ProductGroup): boolean {
  if (group === 'todos') return true;
  const c = normCategory(category ?? '');
  const isLente = c.includes('lente');
  if (group === 'lentes') return isLente;
  if (isLente) return false;
  // Acessórios que citam "óculos" no nome (PORTA OCULOS, LENCO DE OCULOS…)
  // não são óculos: entram só no consolidado, nunca no recorte principal.
  if (/\b(porta|estojo|case|lenco|cordao|corrente|limpa)\b/.test(c)) return false;
  return (
    c.includes('oculos') ||
    c.includes('armacao') ||
    c.includes('relogio') ||
    c.includes('grau') ||
    c.includes('solar')
  );
}

// ─── Marca do produto (extraída da descrição) ───────────────────────────────

/**
 * No ERP da rede, o campo "marca" carrega na verdade o FORNECEDOR; a marca
 * real do produto vem no nome/descrição (ex.: "Armação Ray-Ban RB1234 Preto").
 * Esta função extrai a marca da descrição: descarta as palavras de
 * categoria/tipo no começo e para na primeira cor, código de modelo (com
 * dígito) ou tamanho, devolvendo 1–2 tokens como marca. Heurística — deve ser
 * validada e afinada com as descrições reais quando a sonda CDS rodar.
 */
const CATEGORY_WORDS = new Set([
  'armacao', 'armacoes', 'oculos', 'oculo', 'lente', 'lentes', 'relogio', 'relogios',
  'estojo', 'estojos', 'acessorio', 'acessorios', 'sol', 'solar', 'grau', 'receituario',
  'contato', 'infantil', 'de', 'do', 'da', 'para', 'com',
]);
const COLOR_WORDS = new Set([
  'preto', 'preta', 'branco', 'branca', 'dourado', 'dourada', 'prata', 'prateado', 'azul',
  'tartaruga', 'marrom', 'vermelho', 'vermelha', 'verde', 'rosa', 'cinza', 'nude',
  'transparente', 'cristal', 'fume', 'degrade', 'chumbo', 'grafite', 'bordo', 'vinho',
  'roxo', 'laranja', 'amarelo', 'bege', 'caramelo', 'gold', 'black', 'silver', 'blue',
]);

/**
 * Conectores que aparecem DENTRO do nome da grife ("Dolce e Gabbana",
 * "Dolce & Gabbana"). Sem trat\u00e1-los, a marca era cortada em "DOLCE E" e a
 * mesma grife virava duas linhas no relat\u00f3rio, ao lado de "DOLCE GABBANA".
 */
const CONNECTOR_WORDS = new Set(['e', '&']);

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function extractBrand(
  description: string | null | undefined,
  category?: string | null,
): string | null {
  // Grife só existe em produto de moda (óculos, armação, relógio). Em lente,
  // tratamento e serviço a descrição é a LINHA do produto — "MULTIGRESSIV
  // MONOFOCAIS…", "ZEISS ANTIRREFLEXO", "HILUX LENTES PRONTAS…" — e extrair
  // dali fragmenta um mesmo fabricante em dezenas de pseudo-marcas (a ZEISS
  // virava dezesseis). Nesses casos devolvemos null para o chamador cair no
  // fornecedor (p.brand), que é o dado confiável ali.
  // Sem categoria informada, mantém o comportamento antigo (extrai sempre).
  if (category != null && !matchesProductGroup(category, 'principal')) return null;
  const raw = (description ?? '').trim();
  if (!raw) return null;
  const tokens = raw.split(/\s+/);
  const picked: string[] = [];
  let started = false;
  for (const tok of tokens) {
    const n = norm(tok).replace(/[.,;:]+$/, '');
    if (!n) continue;
    // Antes de começar a marca, pula categoria/tipo. Depois de começar,
    // categoria encerra a marca.
    if (CATEGORY_WORDS.has(n)) {
      if (started) break;
      continue;
    }
    // Conector não conta como palavra da marca: "Dolce e Gabbana" → 2 tokens.
    if (CONNECTOR_WORDS.has(n)) continue;
    if (COLOR_WORDS.has(n)) break; // cor encerra a marca
    if (/\d/.test(n)) {
      // código de modelo (RB1234, 0RX...) encerra — a menos que ainda não
      // tenhamos pego nada (aí ignora e segue procurando).
      if (started) break;
      continue;
    }
    picked.push(tok);
    started = true;
    if (picked.length >= 2) break; // marcas têm 1–2 palavras (ex.: Ray-Ban, Chilli Beans)
  }
  return picked.length > 0 ? picked.join(' ') : null;
}

// ─── Lentes por encomenda (sem posição de estoque) ──────────────────────────

/**
 * Lente feita sob demanda: não entra nos alertas de ruptura nem nos relatórios
 * de estoque/cobertura — só no faturamento consolidado.
 *
 * O sinal correto é a CATEGORIA, não o saldo: no CDS as grades separam
 * "…PEDIDO" (sob encomenda) de "…PRONTA(S)"/"…ESTOQUE" (lente de prateleira).
 * Usar só `saldo = 0` confundia uma lente PRONTA que zerou na rede inteira com
 * uma lente por encomenda — e o alerta de ruptura sumia justamente quando mais
 * importa. Categoria ambígua cai num heurístico conservador (ver corpo).
 */
export function isMadeToOrderLens(
  category: string | null | undefined,
  networkStockQty: number,
  networkSoldQty = 0,
): boolean {
  if (!matchesProductGroup(category, 'lentes')) return false;
  const c = normCategory(category ?? '');
  if (/pedido|encomenda/.test(c)) return true; // explícito: sob encomenda
  if (/pronta|estoque/.test(c)) return false; // explícito: lente de prateleira
  // Categoria ambígua: só é encomenda se nunca teve saldo E nunca vendeu.
  return networkStockQty <= 0 && networkSoldQty <= 0;
}

// ─── Previsão de demanda (suavização + sazonalidade) ────────────────────────

/** Um bucket mensal do histórico de vendas (mês calendário 1–12). */
export interface MonthlyDemandPoint {
  month: number;
  units: number;
}

export interface DemandHistory {
  /** Janela recente (ex.: últimos 30 dias) — pesa mais na previsão. */
  recentUnits: number;
  recentDays: number;
  /** Janela anterior (restante do período analisado). */
  priorUnits: number;
  priorDays: number;
  /** Histórico mensal (até 24 buckets) para o índice sazonal. */
  monthlyHistory: MonthlyDemandPoint[];
  /** Mês calendário atual (1–12) — âncora para achar o mês-alvo do pedido. */
  currentMonth: number;
}

export interface DemandForecast {
  /** Demanda diária prevista (base × índice sazonal). */
  dailyDemand: number;
  /** Demanda suavizada, antes da sazonalidade. */
  baseDaily: number;
  /** Índice sazonal aplicado (1 = sem ajuste). */
  seasonalIndex: number;
  /** Mês (1–12) que a previsão mira (chegada do pedido). */
  targetMonth: number;
  method: 'media' | 'tendencia' | 'sazonal';
}

/** Peso da janela recente na suavização (o restante vai para a anterior). */
const RECENT_WEIGHT = 0.65;
/** Sazonalidade só é aplicada com sinal suficiente (evita ruído virar índice). */
const SEASONAL_MIN_MONTHS = 6;
const SEASONAL_MIN_UNITS = 30;
const SEASONAL_CLAMP: [number, number] = [0.5, 2];

/**
 * Prevê a demanda diária combinando:
 * 1. suavização com peso recente — reage a tendência (produto acelerando ou
 *    esfriando) sem abandonar a base histórica;
 * 2. índice sazonal mensal — com >= 6 meses e volume mínimo de histórico,
 *    ajusta para o mês em que o pedido vai chegar (targetMonth); com pouco
 *    histórico, degrada com segurança para a média (índice 1).
 */
export function forecastDemand(history: DemandHistory, leadTimeDays: number): DemandForecast {
  const recentRate = history.recentDays > 0 ? history.recentUnits / history.recentDays : 0;
  const priorRate = history.priorDays > 0 ? history.priorUnits / history.priorDays : 0;

  let baseDaily: number;
  let method: DemandForecast['method'] = 'media';
  if (history.recentDays > 0 && history.priorDays > 0) {
    baseDaily = RECENT_WEIGHT * recentRate + (1 - RECENT_WEIGHT) * priorRate;
    const max = Math.max(recentRate, priorRate);
    if (max > 0 && Math.abs(recentRate - priorRate) / max > 0.1) method = 'tendencia';
  } else {
    baseDaily = history.recentDays > 0 ? recentRate : priorRate;
  }

  // Mês em que o pedido feito hoje chega (âncora da sazonalidade).
  const monthsAhead = Math.round(leadTimeDays / 30);
  const targetMonth = ((history.currentMonth - 1 + monthsAhead) % 12) + 1;

  let seasonalIndex = 1;
  const buckets = history.monthlyHistory;
  const distinctMonths = new Set(buckets.map((b) => b.month)).size;
  const totalUnits = buckets.reduce((a, b) => a + b.units, 0);
  if (distinctMonths >= SEASONAL_MIN_MONTHS && totalUnits >= SEASONAL_MIN_UNITS) {
    const overallAvg = totalUnits / buckets.length;
    const target = buckets.filter((b) => b.month === targetMonth);
    if (overallAvg > 0 && target.length > 0) {
      const targetAvg = target.reduce((a, b) => a + b.units, 0) / target.length;
      seasonalIndex = Math.min(SEASONAL_CLAMP[1], Math.max(SEASONAL_CLAMP[0], targetAvg / overallAvg));
      if (Math.abs(seasonalIndex - 1) > 0.05) method = 'sazonal';
    }
  }

  return {
    dailyDemand: round2(baseDaily * seasonalIndex),
    baseDaily: round2(baseDaily),
    seasonalIndex: round2(seasonalIndex),
    targetMonth,
    method,
  };
}

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
  /** true quando o custo é ESTIMADO — o ERP não trouxe o valor de compra. */
  costEstimated?: boolean;
  /** Unidades já pedidas ao fornecedor e ainda não recebidas (a caminho). */
  onOrderQty?: number;
  /** Histórico para previsão; ausente = média simples (unitsSold/days). */
  demandHistory?: DemandHistory;
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
  /** true quando o custo é estimado (falta o valor de compra no ERP). */
  costEstimated?: boolean;
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
  /** Explicação curta, direta e amigável do porquê da decisão. */
  friendlyReason: string;
  /** Confiabilidade da decisão (0–100): volume de vendas + histórico + método. */
  confidence: number;
  /** Quanto custa manter ESTE estoque parado por 30 dias (R$). */
  carryingCost30d: number;
  /** Quanto custa manter só o EXCESSO por 30 dias (R$) — o desperdício puro. */
  excessCarryingCost30d: number;
  /** Preço de venda unitário — base do desconto sugerido na liquidação. */
  unitPrice: number;
  /** Margem bruta unitária em % do preço. */
  marginPct: number;
  /** Margem bruta esperada da compra sugerida (R$). */
  expectedMargin: number;
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
  /** Detalhe da previsão de demanda usada (ausente = média simples). */
  forecast?: { baseDaily: number; seasonalIndex: number; targetMonth: number; method: 'media' | 'tendencia' | 'sazonal' };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Confiabilidade da decisão (0–100). Quanto mais vendas e mais histórico,
 * mais confiável a previsão de demanda — e a previsão sazonal/tendência
 * (com dados suficientes) soma um bônus. Para itens sem giro, a certeza de
 * que estão "parados" cresce com o tempo observado.
 */
export function decisionConfidence(
  unitsSold: number,
  days: number,
  hasDemand: boolean,
  method: DemandForecast['method'] | null,
): number {
  const history = Math.min(1, days / 180); // 6 meses = histórico "cheio"
  let conf: number;
  if (!hasDemand) {
    conf = 0.4 + 0.5 * history; // "parado": mais tempo observando = mais certeza
  } else {
    const volume = Math.min(1, unitsSold / 30); // 30 vendas no período satura
    const methodBonus = method === 'sazonal' ? 0.1 : method === 'tendencia' ? 0.05 : 0;
    conf = 0.35 + 0.45 * volume + 0.2 * history + methodBonus;
  }
  return Math.round(Math.min(0.97, Math.max(0.3, conf)) * 100);
}

/** Texto curto e amigável explicando a decisão para o lojista. */
function friendlyReasonFor(rec: Recommendation, ctx: { onOrder: number; coverageDays: number | null }): string {
  switch (rec) {
    case 'BUY':
      return 'Vende bem e o estoque está no limite — vale repor pra não deixar cliente na mão.';
    case 'HOLD':
      return ctx.onOrder > 0
        ? 'Já tem pedido a caminho que cobre a necessidade — não precisa comprar de novo agora.'
        : 'Estoque tranquilo pro ritmo de venda — pode deixar como está por enquanto.';
    case 'DONT_BUY':
      return ctx.coverageDays === null
        ? 'Não vende e não tem em estoque — não vale a pena trazer.'
        : 'Tem estoque de sobra pra bastante tempo — segura a compra pra não empatar dinheiro.';
    case 'LIQUIDATE':
      return 'Parado, sem sair há um tempo — melhor liquidar ou remanejar pra soltar o capital.';
  }
}

/** Analisa um único produto e devolve o plano completo. */
export function analyzeProduct(
  input: ProductMetricsInput,
  days: number,
  cfg: PlanningConfig = DEFAULT_PLANNING_CONFIG,
): ProductPlan {
  // Com histórico, a demanda vem da previsão (tendência + sazonalidade no mês
  // de chegada do pedido, dado o lead time); sem histórico, média simples.
  const forecast = input.demandHistory ? forecastDemand(input.demandHistory, cfg.leadTimeDays) : null;
  const dailyDemand = forecast ? forecast.dailyDemand : days > 0 ? input.unitsSold / days : 0;
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
    friendlyReason: friendlyReasonFor(recommendation, { onOrder, coverageDays }),
    confidence: decisionConfidence(input.unitsSold, days, dailyDemand > 0, forecast?.method ?? null),
    carryingCost30d: carryingCost(stockValue, 30, cfg),
    excessCarryingCost30d: carryingCost(excessValue, 30, cfg),
    unitPrice: input.unitPrice,
    costEstimated: input.costEstimated === true,
    marginPct: marginPct(input.unitPrice, input.unitCost),
    expectedMargin: expectedMargin(suggestedQty, input.unitPrice, input.unitCost),
    onOrderQty: onOrder,
    leadTimeDays: cfg.leadTimeDays,
    orderByInDays,
    forecast: forecast
      ? {
          baseDaily: forecast.baseDaily,
          seasonalIndex: forecast.seasonalIndex,
          targetMonth: forecast.targetMonth,
          method: forecast.method,
        }
      : undefined,
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
  /** Categoria do produto — entra na extração da marca (ver analysisBrand). */
  category?: string | null;
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
  /** Explicação curta e amigável do porquê transferir. */
  friendlyReason: string;
  /** Confiabilidade da sugestão (0–100): giro do destino e sobra na origem. */
  confidence: number;
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
        const donorParado = donor.dailyDemand === 0;
        const donorSide = donorParado
          ? `parado em ${donor.storeName} (${donor.stock} un. sem venda no período)`
          : `sobrando em ${donor.storeName} (${fmtCover(donor.coverage)})`;
        const fromShort = donor.storeName.replace(/^.*—\s*/, '');
        const toShort = receiver.storeName.replace(/^.*—\s*/, '');
        const friendly = donorParado
          ? `Está parado em ${fromShort} e vende em ${toShort} — melhor mandar pra onde gira do que deixar encalhado.`
          : `${toShort} está no limite e ${fromShort} tem de sobra — remaneja e ninguém fica sem, sem gastar nada.`;
        // Confiança: giro no destino (quanto mais vende, mais seguro) + sobra
        // folgada na origem. Escala simples, coerente com a de compra.
        const recvRate = receiver.dailyDemand * days;
        const volume = Math.min(1, recvRate / 30);
        const spareRatio = donorParado ? 1 : Math.min(1, donor.spare / Math.max(1, qty));
        const conf = Math.round(Math.min(0.97, Math.max(0.3, 0.4 + 0.4 * volume + 0.2 * spareRatio)) * 100);
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
          friendlyReason: friendly,
          confidence: conf,
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
  /** Marca real do produto (extraída da descrição), para exibir no pedido. */
  brand: string | null;
  category: string | null;
  quantity: number;
  unitCost: number;
  total: number;
  /** Dias restantes para pedir sem romper (0 = hoje). */
  orderByInDays: number | null;
  stockoutInDays: number | null;
  /** Confiabilidade da sugestão de compra deste item (0–100). */
  confidence: number;
}

export interface PurchaseOrder {
  /** Fornecedor (campo "marca" do ERP); itens sem fornecedor ficam em "Sem fornecedor". */
  supplier: string;
  /** Marcas de produto (reais) presentes neste pedido — resumo do fornecedor. */
  brands: string[];
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

const NO_SUPPLIER = 'Sem fornecedor';

/**
 * Consolida os itens com recomendação COMPRAR em rascunhos de ordem de
 * compra, um por FORNECEDOR (campo "marca" do ERP). Cada item mostra a marca
 * real do produto (extraída da descrição), então dentro do pedido de um
 * fornecedor as várias marcas aparecem. Fornecedores mais urgentes primeiro.
 */
export function buildPurchaseOrders(
  plans: ProductPlan[],
  days: number,
  /** Opcional: fornecedor canônico por plano (catálogo de marcas). Sem ele,
   *  agrupa pelo campo do ERP (p.brand). */
  resolveSupplier?: (p: ProductPlan) => string | null,
): PurchaseOrdersPlan {
  const bySupplier = new Map<string, PurchaseOrder>();

  for (const p of plans) {
    if (p.recommendation !== 'BUY' || p.suggestedQty <= 0) continue;
    const supplier = resolveSupplier?.(p) ?? p.brand ?? NO_SUPPLIER;
    const order =
      bySupplier.get(supplier) ??
      ({
        supplier,
        brands: [],
        leadTimeDays: p.leadTimeDays,
        items: [],
        units: 0,
        total: 0,
        orderByInDays: null,
        stockoutInDays: null,
      } as PurchaseOrder);

    const productBrand = extractBrand(p.description);
    if (productBrand && !order.brands.includes(productBrand)) order.brands.push(productBrand);
    order.items.push({
      productId: p.productId,
      description: p.description,
      brand: productBrand,
      category: p.category,
      quantity: p.suggestedQty,
      unitCost: p.unitCost,
      total: p.capital,
      orderByInDays: p.orderByInDays,
      stockoutInDays: p.stockoutInDays,
      confidence: p.confidence,
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

// ─── Cobertura de estoque (por loja, por marca, geral…) ─────────────────────

export type CoverageLevel = 'CRITICAL' | 'HEALTHY' | 'HIGH' | 'EXCESS';

export interface CoverageInput {
  key: string;
  label: string;
  /** Unidades em estoque no recorte (rede inteira do catálogo, não amostra). */
  stockUnits: number;
  /** Unidades vendidas no recorte durante o período analisado. */
  unitsSold: number;
}

export interface CoverageRow extends CoverageInput {
  /** Média mensal de unidades vendidas (normalizada do período para 30 dias). */
  monthlyUnits: number;
  /** Estoque para quantos meses no ritmo atual (null = sem venda no período). */
  coverageMonths: number | null;
  level: CoverageLevel;
}

export function classifyCoverage(months: number | null): CoverageLevel {
  if (months === null) return 'EXCESS'; // estoque parado, sem nenhuma venda no período
  if (months < 1) return 'CRITICAL';
  if (months <= 6) return 'HEALTHY';
  if (months <= 12) return 'HIGH';
  return 'EXCESS';
}

/**
 * Cobertura genérica: X unidades em estoque ÷ média mensal vendida = estoque
 * para X meses, por qualquer recorte (loja, marca…). Menos fôlego primeiro
 * (sem venda por último). Recorte vazio (sem estoque e sem venda) é CRITICAL
 * — não tem o que vender —, nunca "excesso".
 */
export function computeCoverage<T extends CoverageInput>(
  rows: T[],
  days: number,
): (T & Pick<CoverageRow, 'monthlyUnits' | 'coverageMonths' | 'level'>)[] {
  const factor = days > 0 ? 30 / days : 0;
  return rows
    .map((r) => {
      const monthlyUnits = round2(r.unitsSold * factor);
      const coverageMonths = monthlyUnits > 0 ? round2(r.stockUnits / monthlyUnits) : null;
      const level =
        coverageMonths === null && r.stockUnits === 0 ? 'CRITICAL' : classifyCoverage(coverageMonths);
      return { ...r, monthlyUnits, coverageMonths, level };
    })
    .sort(
      (a, b) =>
        (a.coverageMonths ?? Infinity) - (b.coverageMonths ?? Infinity) ||
        a.label.localeCompare(b.label, 'pt-BR'),
    );
}

// Recorte por loja (dashboard) — mesma matemática, com nomes de campo de loja.

export interface StoreCoverageInput {
  storeId: string;
  storeName: string;
  stockUnits: number;
  unitsSold: number;
}

export interface StoreCoverageRow extends StoreCoverageInput {
  monthlyUnits: number;
  coverageMonths: number | null;
  level: CoverageLevel;
}

export function computeStoreCoverage(rows: StoreCoverageInput[], days: number): StoreCoverageRow[] {
  return computeCoverage(
    rows.map((r) => ({ key: r.storeId, label: r.storeName, ...r })),
    days,
  ).map(({ key, label, ...rest }) => rest);
}

// ─── Bandeiras da rede ───────────────────────────────────────────────────────

/** Prefixos conhecidos das bandeiras da rede (nomes de loja do CDS, sem acento). */
const BANDEIRAS = ['A GRACIOSA', 'OTICALLI', 'GRAND OPTICAL', 'ZEISS', 'GMAIS', 'MOZAIK'];

export function bandeiraDaLoja(storeName: string): string {
  const raw = storeName.trim();
  const n = raw
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  for (const b of BANDEIRAS) if (n.startsWith(b)) return b;
  // Loja sem prefixo conhecido vira a PRÓPRIA bandeira — uma unidade nova (ou
  // renomeada no CDS) aparece como coluna própria em vez de sumir num balde
  // genérico. Vazio → OPERAÇÃO só como último recurso.
  return raw || 'OPERAÇÃO';
}

// ─── Mix de marcas por bandeira (feedback 04 fase 2) ─────────────────────────

export interface BrandBannerInput {
  storeName: string;
  brand: string;
  stockUnits: number;
  unitsSold: number;
}

export interface BrandMixCell {
  stockUnits: number;
  unitsSold: number;
}

export interface BrandMixRow {
  brand: string;
  total: BrandMixCell;
  byBanner: Record<string, BrandMixCell>;
  /** Bandeiras onde a marca vendeu no período. */
  sellsIn: string[];
  /** Bandeiras com estoque da marca PARADO (sem venda) enquanto ela vende em outra. */
  moveFrom: string[];
}

/**
 * Agrega estoque e vendas de cada marca por bandeira e aponta candidatas a
 * remanejo de marca: estoque numa bandeira que não vende a marca, com venda
 * dela em outra bandeira. Candidatas primeiro, depois maiores vendas.
 */
export function buildBrandMix(rows: BrandBannerInput[]): { banners: string[]; rows: BrandMixRow[] } {
  const byBrand = new Map<string, Map<string, BrandMixCell>>();
  const bannerTotals = new Map<string, number>();
  for (const r of rows) {
    const banner = bandeiraDaLoja(r.storeName);
    const brand = r.brand || 'Sem marca';
    const cells = byBrand.get(brand) ?? new Map<string, BrandMixCell>();
    const cell = cells.get(banner) ?? { stockUnits: 0, unitsSold: 0 };
    cell.stockUnits += r.stockUnits;
    cell.unitsSold += r.unitsSold;
    cells.set(banner, cell);
    byBrand.set(brand, cells);
    bannerTotals.set(banner, (bannerTotals.get(banner) ?? 0) + r.unitsSold);
  }

  const banners = [...bannerTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
    .map(([b]) => b);

  const out: BrandMixRow[] = [...byBrand.entries()].map(([brand, cells]) => {
    const byBanner: Record<string, BrandMixCell> = {};
    const total = { stockUnits: 0, unitsSold: 0 };
    for (const [banner, cell] of cells) {
      byBanner[banner] = cell;
      total.stockUnits += cell.stockUnits;
      total.unitsSold += cell.unitsSold;
    }
    const sellsIn = banners.filter((b) => (byBanner[b]?.unitsSold ?? 0) > 0);
    const moveFrom =
      sellsIn.length > 0
        ? banners.filter((b) => (byBanner[b]?.stockUnits ?? 0) > 0 && (byBanner[b]?.unitsSold ?? 0) === 0)
        : [];
    return { brand, total, byBanner, sellsIn, moveFrom };
  });

  out.sort(
    (a, b) =>
      Number(b.moveFrom.length > 0) - Number(a.moveFrom.length > 0) ||
      b.total.unitsSold - a.total.unitsSold ||
      a.brand.localeCompare(b.brand, 'pt-BR'),
  );
  return { banners, rows: out };
}

// ─── Modo Feira: rateio de compra por loja (feedback 08, MVP) ────────────────

export interface FairSplitInput {
  storeId: string;
  storeName: string;
  /** Unidades da marca/grupo vendidas pela loja no período. */
  unitsSold: number;
  /** Estoque atual da marca/grupo na loja (contexto, não entra no rateio). */
  stockUnits: number;
}

export interface FairSplitRow extends FairSplitInput {
  sharePct: number;
  suggestedQty: number;
}

/**
 * Rateia uma compra (lançamentos de feira, sem histórico próprio) entre as
 * lojas proporcionalmente à participação de cada uma nas VENDAS da marca ou
 * do grupo escolhido. Arredondamento pelo método dos maiores restos — a soma
 * das sugestões é EXATAMENTE totalQty. Loja sem venda da marca não recebe.
 */
export function buildFairSplit(
  rows: FairSplitInput[],
  totalQty: number,
): { totalQty: number; totalSold: number; rows: FairSplitRow[] } {
  // Devoluções podem vir como venda líquida negativa; participação nunca é
  // negativa — clampa em 0 para o rateio dos maiores restos não se inverter.
  rows = rows.map((r) => ({ ...r, unitsSold: Math.max(0, r.unitsSold) }));
  const totalSold = rows.reduce((a, r) => a + r.unitsSold, 0);
  const qty = Math.max(0, Math.trunc(totalQty));
  if (qty === 0 || totalSold === 0) {
    return {
      totalQty: qty,
      totalSold,
      rows: rows
        .map((r) => ({ ...r, sharePct: 0, suggestedQty: 0 }))
        .sort((a, b) => b.unitsSold - a.unitsSold || a.storeName.localeCompare(b.storeName, 'pt-BR')),
    };
  }

  const exact = rows.map((r) => (qty * r.unitsSold) / totalSold);
  const base = exact.map(Math.floor);
  let rest = qty - base.reduce((a, b) => a + b, 0);
  // Maiores restos primeiro (empate: mais vendas, depois nome).
  const order = rows
    .map((r, i) => ({ i, frac: exact[i] - base[i], sold: r.unitsSold, name: r.storeName }))
    .sort((a, b) => b.frac - a.frac || b.sold - a.sold || a.name.localeCompare(b.name, 'pt-BR'));
  for (const o of order) {
    if (rest <= 0) break;
    base[o.i] += 1;
    rest -= 1;
  }

  return {
    totalQty: qty,
    totalSold,
    rows: rows
      .map((r, i) => ({
        ...r,
        sharePct: round2((r.unitsSold / totalSold) * 100),
        suggestedQty: base[i],
      }))
      .sort((a, b) => b.suggestedQty - a.suggestedQty || a.storeName.localeCompare(b.storeName, 'pt-BR')),
  };
}

// ─── Curva ABC (por SKU, por marca…) ─────────────────────────────────────────

/** Classificação ABC de um item a partir do % acumulado de receita. */
export function classifyABC(cumulativePct: number): 'A' | 'B' | 'C' {
  if (cumulativePct <= 80) return 'A';
  if (cumulativePct <= 95) return 'B';
  return 'C';
}

export type AbcDimension = 'product' | 'brand';

export interface AbcItem {
  key: string;
  label: string;
  /** Detalhes exibidos sob o rótulo (marca/categoria do SKU; vazio p/ marca). */
  brand: string | null;
  category: string | null;
  revenue: number;
  units: number;
}

export interface AbcRow extends AbcItem {
  revenuePct: number;
  cumulativePct: number;
  class: 'A' | 'B' | 'C';
}

export interface AbcResult {
  days: number;
  dimension: AbcDimension;
  totalRevenue: number;
  /**
   * Receita do MESMO período e da mesma loja, sem o recorte de produto.
   *
   * Galbe, 30/07: "os números da curva ABC estão muito baixos". Estavam certos
   * — o recorte de óculos, armação e relógio é 43% da receita da rede, e a tela
   * não dizia isso em lugar nenhum. Com este número ao lado, "baixo" vira
   * "recortado", que é diferente.
   */
  periodRevenue?: number;
  summary: Record<'A' | 'B' | 'C', { items: number; revenue: number }>;
  rows: AbcRow[];
}

/**
 * Classificação ABC pura sobre itens já agregados (SKUs, marcas…): ordena por
 * receita, acumula o % e corta em A ≤80, B ≤95, C >95 — avaliando o PONTO
 * MÉDIO da faixa que o item ocupa na curva. Com itens pequenos (SKUs) dá o
 * mesmo resultado do corte clássico; com um item dominante (uma marca com
 * 80%+ da receita) evita o absurdo de a classe A ficar vazia.
 */
export function abcFromItems(items: AbcItem[], days: number, dimension: AbcDimension): AbcResult {
  const sorted = items.filter((i) => i.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = sorted.reduce((s, i) => s + i.revenue, 0);
  const summary = {
    A: { items: 0, revenue: 0 },
    B: { items: 0, revenue: 0 },
    C: { items: 0, revenue: 0 },
  };
  let cumulative = 0;
  const rows: AbcRow[] = sorted.map((i) => {
    const revenuePct = totalRevenue > 0 ? (i.revenue / totalRevenue) * 100 : 0;
    const midpoint = cumulative + revenuePct / 2;
    cumulative += revenuePct;
    const klass = classifyABC(midpoint);
    summary[klass].items += 1;
    summary[klass].revenue = round2(summary[klass].revenue + i.revenue);
    return {
      ...i,
      revenue: round2(i.revenue),
      revenuePct: round2(revenuePct),
      cumulativePct: round2(cumulative),
      class: klass,
    };
  });
  return { days, dimension, totalRevenue: round2(totalRevenue), summary, rows };
}

// ─── Cards de decisão (portal unificado — paridade Chico) ────────────────────
//
// Unifica compra, remanejamento e liquidação num único feed de "cards" com
// tipo, prioridade, impacto em R$ e a explicação amigável — a visualização que
// o cliente pediu. Puro: alimenta o backend e a demo com os MESMOS dados que já
// calculamos (analyzeProduct + buildRebalance), sem consulta nova.

export type DecisionType = 'COMPRA' | 'REMANEJAMENTO' | 'LIQUIDACAO';
export type DecisionPriority = 'ALTA' | 'MEDIA' | 'BAIXA';

export interface DecisionCard {
  id: string;
  type: DecisionType;
  title: string;
  priority: DecisionPriority;
  productId: string;
  description: string;
  brand: string | null;
  /** Loja-alvo ou rota (De → Para) do card. */
  target: string;
  /** IDs de loja para ação de 1 clique no remanejamento (origem → destino). */
  fromStoreId?: string;
  toStoreId?: string;
  /** Quantidade envolvida (a comprar/transferir), quando se aplica. */
  quantity: number | null;
  /** Explicação curta e amigável do porquê. */
  reason: string;
  confidence: number;
  /** Impacto financeiro do card em R$ (custo do pedido ou capital a liberar). */
  impact: number;
  impactLabel: string;
  /** Urgência em dias (ruptura próxima); menor = mais urgente. */
  urgencyDays: number | null;
  /**
   * Quando o card apareceu pela PRIMEIRA vez (do lote de geração). Ausente
   * enquanto o motor nunca rodou pelo cron — o card existe, mas ainda não tem
   * histórico de aparições.
   */
  firstSeenAt?: string;
  /** Dias desde a primeira aparição. */
  ageDays?: number;
  /** Apareceu pela primeira vez no lote mais recente. */
  isNew?: boolean;
  /** Reaparece há mais dias do que o SLA sem ninguém decidir. */
  isOverdue?: boolean;
  /** Liquidação: desconto sugerido e teto (feedback 05 — "liquidar como?"). */
  discountPct?: number;
  discountMaxPct?: number;
  /**
   * Liquidação: transferência de escoamento já resolvida (de onde, quantas).
   * Com `outletStoreId` como destino, é uma movimentação de um clique.
   */
  outletFromStoreId?: string;
  outletFromStoreName?: string;
  outletQuantity?: number;
  discountReason?: string;
  /** De onde saiu o número — o Galbe pediu para entender os parâmetros. */
  discountParams?: DiscountAdvice['params'];
  /** Liquidação: loja com maior chance de escoar ("remanejar para onde?"). */
  outletStoreId?: string;
  outletStoreName?: string;
  /** Se o destino veio do giro da própria peça ou do giro da marca. */
  outletBasis?: 'sku' | 'marca';
}

export interface DecisionSummary {
  total: number;
  byType: { compra: number; remanejamento: number; liquidacao: number };
  byPriority: { alta: number; media: number; baixa: number };
  /** Impacto total sob decisão (R$) — soma do impacto de todos os cards. */
  impactTotal: number;
  /** Cards críticos (ruptura em ~7 dias ou menos). */
  criticos: number;
  /**
   * Cards que o motor gerou mas já têm decisão registrada e por isso saíram do
   * board. Fica explícito no resumo: o que sai da tela é declarado, não some.
   */
  decididos: number;
  /** Cards que apareceram pela primeira vez no lote mais recente. */
  novos?: number;
  /** Cards reaparecendo há mais tempo que o SLA sem decisão. */
  atrasados?: number;
}

/** Metadados do lote que gerou os cards ("quando isso foi calculado?"). */
export interface BatchInfo {
  id: string;
  generatedAt: string;
  source: 'CRON' | 'MANUAL';
  cardsTotal: number;
  cardsNew: number;
  /**
   * Só a demo marca isto. Lá não há execuções passadas para consultar, então
   * as idades dos cards são derivadas do id — a tela precisa dizer isso, em
   * vez de apresentar um número derivado como se fosse medido.
   */
  simulated?: boolean;
}

export interface DecisionBoard {
  summary: DecisionSummary;
  cards: DecisionCard[];
  /** Lote que gerou estes cards. Ausente enquanto o cron nunca rodou. */
  batch?: BatchInfo;
}

/** Uma aparição de card, como o lote de geração registra. */
export interface CardHistory {
  cardId: string;
  firstSeenAt: Date;
  timesSeen: number;
}

/**
 * Carimba nos cards a idade vinda do lote de geração: quando apareceu pela
 * primeira vez, há quantos dias, se é novo neste lote e se já passou do SLA
 * sem ninguém decidir.
 *
 * Card que reaparece há semanas sem decisão é o sintoma central que o painel
 * de governança precisa mostrar — sem isso, um card de 60 dias e um de ontem
 * são visualmente idênticos.
 */
export function annotateCardAges(
  board: DecisionBoard,
  history: ReadonlyMap<string, CardHistory>,
  batch: BatchInfo | undefined,
  slaDays = 30,
  now = new Date(),
): DecisionBoard {
  if (history.size === 0) return { ...board, batch };

  let novos = 0;
  let atrasados = 0;
  const cards = board.cards.map((c) => {
    const h = history.get(c.id);
    if (!h) return c;
    const ageDays = Math.max(0, Math.floor((now.getTime() - h.firstSeenAt.getTime()) / 86_400_000));
    // "Novo" = apareceu só uma vez, ou seja, estreou no lote mais recente.
    const isNew = h.timesSeen <= 1;
    const isOverdue = ageDays > slaDays;
    if (isNew) novos++;
    if (isOverdue) atrasados++;
    return { ...c, firstSeenAt: h.firstSeenAt.toISOString(), ageDays, isNew, isOverdue };
  });

  return { summary: { ...board.summary, novos, atrasados }, cards, batch };
}

const PRIORITY_RANK: Record<DecisionPriority, number> = { ALTA: 0, MEDIA: 1, BAIXA: 2 };
const shortStore = (name: string) => name.replace(/^.*—\s*/, '').trim();

/** ID curto e estável por card (estilo "#72D.A1"), derivado do conteúdo. */
function cardId(type: DecisionType, seed: string): string {
  let h = 2166136261;
  const s = type + '|' + seed;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const code = (h >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6);
  const prefix = type === 'COMPRA' ? 'C' : type === 'REMANEJAMENTO' ? 'R' : 'L';
  return `#${prefix}${code.slice(0, 2)}.${code.slice(2, 5)}`;
}

function buyPriority(orderByInDays: number | null, stockoutInDays: number | null): DecisionPriority {
  const d = orderByInDays ?? stockoutInDays;
  if (d !== null && d <= 0) return 'ALTA';
  if (d !== null && d <= 7) return 'ALTA';
  if (d !== null && d <= 21) return 'MEDIA';
  return 'BAIXA';
}
function urgencyPriority(stockoutInDays: number | null): DecisionPriority {
  if (stockoutInDays === null) return 'BAIXA';
  if (stockoutInDays <= 7) return 'ALTA';
  if (stockoutInDays <= 21) return 'MEDIA';
  return 'BAIXA';
}
function capitalPriority(value: number): DecisionPriority {
  if (value >= 1500) return 'ALTA';
  if (value >= 400) return 'MEDIA';
  return 'BAIXA';
}

/**
 * Monta o feed de cards de decisão a partir dos planos por produto (compra e
 * liquidação) e das sugestões de remanejamento. Ordena por prioridade e, dentro
 * dela, pelo maior impacto.
 */
/**
 * Monta o board de decisão.
 *
 * `decidedIds` são os cards que JÁ têm decisão registrada: o motor recalcula
 * tudo a cada execução e regeraria o mesmo card amanhã, fazendo o gestor
 * decidir duas vezes a mesma coisa. Eles saem da lista e entram no contador
 * `summary.decididos` — o board mostra o que falta decidir, não o que já foi.
 */
/**
 * Loja com maior chance de escoar um produto parado.
 *
 * Feedback 05 do Galbe: "remanejar para onde (qual loja teria maior chance de
 * escoamento?)". O card de liquidação dizia o que fazer e não onde.
 *
 * Critério, nesta ordem: quem MAIS VENDEU a peça no período; empatado, quem
 * tem MENOS estoque dela (menos risco de repetir o encalhe). Loja sem nenhuma
 * venda não é destino — mandar para lá só muda o endereço do problema.
 */
export interface OutletPosition {
  storeId: string;
  storeName: string;
  unitsSold: number;
  currentStock: number;
}

/**
 * Marca de ANÁLISE de um produto: a grife extraída da descrição e, na falta
 * dela, o fornecedor. Devolve null quando nenhuma das duas serve.
 *
 * Existe porque o campo `brand` do CDS é o FORNECEDOR e vem vazio (ou "—") na
 * maior parte do catálogo real. Agrupar por ele jogava centenas de produtos
 * sem fornecedor no MESMO balde: o "giro da marca" de um óculos MIU MIU saía
 * como 1.120 unidades (o balde inteiro) e o destino de escoamento apontava
 * sempre para a mesma filial — a loja que mais vende de tudo. O null é
 * proposital: sem marca conhecida, é melhor não ter reserva por marca do que
 * ter uma reserva errada.
 */
export function analysisBrand(
  description: string | null,
  category: string | null,
  supplier: string | null,
): string | null {
  const grife = extractBrand(description, category);
  if (grife) return grife;
  const fornecedor = (supplier ?? '').trim();
  return fornecedor && fornecedor !== '—' ? fornecedor : null;
}

export function bestOutletStore(
  positions: OutletPosition[],
  exceptStoreId?: string,
  /**
   * Posições por MARCA, usadas quando a peça não vendeu em lugar nenhum.
   * É o caso mais comum entre os cards de liquidação — estoque morto — e sem
   * este recurso a pergunta "para onde?" fica sem resposta justamente nos
   * cards em que ela é feita. Um óculos MIU MIU que nunca saiu não tem
   * histórico próprio, mas a rede sabe onde MIU MIU sai.
   */
  brandPositions?: OutletPosition[],
): { storeId: string; storeName: string; unitsSold: number; basis: 'sku' | 'marca' } | null {
  // Volume absoluto elege sempre a loja maior — foi o que fez seis cards de
  // marcas diferentes apontarem todos para a mesma filial (feedback 05). A
  // taxa de escoamento sozinha também não resolve: a loja com melhor taxa
  // geral ganha em quase toda marca. O sinal certo é RELATIVO — onde esta
  // marca escoa acima da média da rede.
  const taxa = (p: OutletPosition) => p.unitsSold / Math.max(1, p.unitsSold + p.currentStock);
  const escolher = (lista: OutletPosition[]) => {
    const elegiveis = lista.filter((p) => p.storeId !== exceptStoreId && p.unitsSold > 0);
    if (elegiveis.length === 0) return undefined;
    const media = elegiveis.reduce((a, p) => a + taxa(p), 0) / elegiveis.length;
    // Desvio da loja em relação à média; empate desempata pelo volume.
    return elegiveis.sort(
      (a, b) => (taxa(b) - media) - (taxa(a) - media) || b.unitsSold - a.unitsSold,
    )[0];
  };

  const porSku = escolher(positions);
  if (porSku) {
    return { storeId: porSku.storeId, storeName: porSku.storeName, unitsSold: porSku.unitsSold, basis: 'sku' };
  }
  const porMarca = brandPositions ? escolher(brandPositions) : undefined;
  return porMarca
    ? { storeId: porMarca.storeId, storeName: porMarca.storeName, unitsSold: porMarca.unitsSold, basis: 'marca' }
    : null;
}

/**
 * Transferência de escoamento derivada do card de liquidação — a "grande
 * entrega dessa categoria" no feedback 05: o card deixa de dizer só *quanto* de
 * desconto e *para onde*, e passa a dizer DE ONDE, QUANTAS e com um clique.
 *
 * Origem: entre as lojas que têm a peça (menos a de destino), a que MENOS
 * escoa; empatado, a que tem mais saldo encalhado. Quantidade: fica na origem
 * o que ela provou escoar no período, o resto sai — pelo menos 1 unidade,
 * senão não há transferência a propor.
 */
export interface OutletTransfer {
  fromStoreId: string;
  fromStoreName: string;
  quantity: number;
}

export function outletTransfer(
  positions: OutletPosition[],
  outletStoreId: string,
): OutletTransfer | null {
  const taxa = (p: OutletPosition) => p.unitsSold / Math.max(1, p.unitsSold + p.currentStock);
  const candidatas = positions.filter((p) => p.storeId !== outletStoreId && p.currentStock > 0);
  if (candidatas.length === 0) return null;
  const origem = [...candidatas].sort((a, b) => taxa(a) - taxa(b) || b.currentStock - a.currentStock)[0];
  return {
    fromStoreId: origem.storeId,
    fromStoreName: origem.storeName,
    quantity: Math.max(1, origem.currentStock - origem.unitsSold),
  };
}

export function buildDecisionCards(
  plans: ProductPlan[],
  rebalance: RebalanceSuggestion[],
  decidedIds?: ReadonlySet<string>,
  /** Posições por loja de cada produto, para escolher o destino de escoamento. */
  positionsByProduct?: ReadonlyMap<string, OutletPosition[]>,
  /** Posições por MARCA — reserva para peça sem venda própria. */
  positionsByBrand?: ReadonlyMap<string, OutletPosition[]>,
  /**
   * Dias parados por produto (primeira aparição do card no lote). É o sinal de
   * TEMPO que faz o desconto variar por peça em vez de sair constante.
   */
  stuckDaysByProduct?: ReadonlyMap<string, number>,
): DecisionBoard {
  const cards: DecisionCard[] = [];

  for (const p of plans) {
    if (p.recommendation === 'BUY') {
      cards.push({
        id: cardId('COMPRA', p.productId),
        type: 'COMPRA',
        title: 'Repor e evitar ruptura',
        priority: buyPriority(p.orderByInDays, p.stockoutInDays),
        productId: p.productId,
        description: p.description,
        brand: p.brand,
        target: `Fornecedor: ${p.brand ?? '—'}`,
        quantity: p.suggestedQty,
        reason: p.friendlyReason,
        confidence: p.confidence,
        impact: round2(p.capital),
        impactLabel: 'Custo do pedido',
        urgencyDays: p.stockoutInDays,
      });
    } else if (p.recommendation === 'LIQUIDATE') {
      // "Liquidar" sozinho devolve a decisão para quem não sabia decidir: o
      // card passa a dizer com quanto de desconto e para qual loja mandar.
      // A marca que vale aqui é a de ANÁLISE (grife da descrição), não o campo
      // de fornecedor — ver analysisBrand.
      const marca = analysisBrand(p.description, p.category, p.brand);
      const posMarca = marca ? positionsByBrand?.get(marca) : undefined;
      const giroMarca = posMarca ? posMarca.reduce((a, x) => a + x.unitsSold, 0) : undefined;
      const desc = suggestedDiscount({
        unitPrice: p.unitPrice,
        unitCost: p.unitCost,
        coverageDays: p.coverageDays,
        stuckDays: stuckDaysByProduct?.get(p.productId) ?? null,
        costEstimated: p.costEstimated,
        brandUnitsSold: giroMarca,
      });
      const outlet = positionsByProduct
        ? bestOutletStore(positionsByProduct.get(p.productId) ?? [], undefined, posMarca)
        : null;
      cards.push({
        id: cardId('LIQUIDACAO', p.productId),
        type: 'LIQUIDACAO',
        title: 'Reduzir excesso e liberar capital',
        discountPct: desc.suggestedPct,
        discountMaxPct: desc.maxPct,
        discountReason: desc.rationale,
        discountParams: desc.params,
        ...(outlet
          ? {
              outletStoreId: outlet.storeId,
              outletStoreName: outlet.storeName,
              outletBasis: outlet.basis,
              // De onde sai e quantas: sem isso o destino é informação, não ação.
              ...(() => {
                const t = outletTransfer(positionsByProduct?.get(p.productId) ?? [], outlet.storeId);
                return t
                  ? {
                      outletFromStoreId: t.fromStoreId,
                      outletFromStoreName: t.fromStoreName,
                      outletQuantity: t.quantity,
                    }
                  : {};
              })(),
            }
          : {}),
        priority: capitalPriority(p.stockValue),
        productId: p.productId,
        description: p.description,
        brand: p.brand,
        // O alvo é a MARCA de análise: `p.brand` é o fornecedor e sai "—" na
        // maior parte do catálogo, o que virava "Alvo: —" na tela.
        target: marca ?? 'Excesso na rede',
        quantity: p.currentStock,
        reason: p.friendlyReason,
        confidence: p.confidence,
        impact: round2(p.stockValue),
        impactLabel: 'Capital a liberar',
        urgencyDays: null,
      });
    }
  }

  for (const s of rebalance) {
    cards.push({
      id: cardId('REMANEJAMENTO', `${s.productId}:${s.fromStoreId}:${s.toStoreId}`),
      type: 'REMANEJAMENTO',
      title: 'Transferir para loja com maior giro',
      priority: urgencyPriority(s.stockoutInDays),
      productId: s.productId,
      description: s.description,
      brand: s.brand,
      target: `${shortStore(s.fromStoreName)} → ${shortStore(s.toStoreName)}`,
      fromStoreId: s.fromStoreId,
      toStoreId: s.toStoreId,
      quantity: s.quantity,
      reason: s.friendlyReason,
      confidence: s.confidence,
      impact: 0,
      impactLabel: 'Giro (sem capital)',
      urgencyDays: s.stockoutInDays,
    });
  }

  const generated = cards.length;
  const open = decidedIds && decidedIds.size > 0 ? cards.filter((c) => !decidedIds.has(c.id)) : cards;

  open.sort((a, b) => {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr !== 0) return pr;
    return b.impact - a.impact;
  });

  const summary: DecisionSummary = {
    total: open.length,
    byType: {
      compra: open.filter((c) => c.type === 'COMPRA').length,
      remanejamento: open.filter((c) => c.type === 'REMANEJAMENTO').length,
      liquidacao: open.filter((c) => c.type === 'LIQUIDACAO').length,
    },
    byPriority: {
      alta: open.filter((c) => c.priority === 'ALTA').length,
      media: open.filter((c) => c.priority === 'MEDIA').length,
      baixa: open.filter((c) => c.priority === 'BAIXA').length,
    },
    impactTotal: round2(open.reduce((a, c) => a + c.impact, 0)),
    criticos: open.filter((c) => c.urgencyDays !== null && c.urgencyDays <= 7).length,
    decididos: generated - open.length,
  };

  return { summary, cards: open };
}

// ─── Motor de estratégia comercial (piso · risco · janela) ───────────────────
//
// Planejador de compra top-down (paridade com a tela "Estratégia comercial" do
// concorrente): dado um PISO (total de unidades a comprar), um PERFIL DE RISCO e
// uma JANELA de venda, valida o piso contra a CAPACIDADE da rede (demanda
// projetada na janela) e divide o piso em segmentos de intenção.

export type RiskProfile = 'conservador' | 'equilibrado' | 'agressivo';

export interface StrategyParams {
  /** Piso de compra: total de unidades a adquirir para a janela. */
  floorUnits: number;
  /** Janela de venda em meses (horizonte do planejamento). */
  windowMonths: number;
  risk: RiskProfile;
}

export interface StrategySegment {
  key: 'best-seller' | 'lancamento' | 'aposta';
  label: string;
  rationale: string;
  units: number;
  pct: number; // participação no piso (0–100)
}

export interface CommercialStrategy {
  floorUnits: number;
  windowMonths: number;
  risk: RiskProfile;
  /** Demanda projetada da rede na janela (unidades) — o "lastro". */
  capacity: number;
  /** Piso ÷ capacidade (0–100+). */
  capacityUsedPct: number;
  /** Piso cabe na capacidade da rede? */
  viable: boolean;
  /** Unidades do piso acima da demanda projetada (0 quando viável). */
  withoutBacking: number;
  /** % com lastro = best-seller + lançamento (aposta é especulação). */
  backedPct: number;
  segments: StrategySegment[];
  /** Texto da "decisão do motor". */
  verdict: string;
}

const RISK_SPLIT: Record<RiskProfile, { bs: number; lanc: number; aposta: number }> = {
  conservador: { bs: 0.6, lanc: 0.3, aposta: 0.1 },
  equilibrado: { bs: 0.45, lanc: 0.35, aposta: 0.2 },
  agressivo: { bs: 0.3, lanc: 0.4, aposta: 0.3 },
};

const clampInt = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/**
 * Monta a estratégia de compra a partir dos planos por produto (que trazem a
 * demanda diária) e dos parâmetros de piso/risco/janela. Puro e determinístico.
 */
export function buildCommercialStrategy(plans: ProductPlan[], params: StrategyParams): CommercialStrategy {
  const windowMonths = clampInt(params.windowMonths, 1, 24);
  const floorUnits = Math.max(0, Math.round(params.floorUnits));
  const risk = RISK_SPLIT[params.risk] ? params.risk : 'equilibrado';

  const dailyDemand = plans.reduce((a, p) => a + p.dailyDemand, 0);
  const capacity = Math.round(dailyDemand * windowMonths * 30);

  const split = RISK_SPLIT[risk];
  const bs = Math.round(floorUnits * split.bs);
  const lanc = Math.round(floorUnits * split.lanc);
  const aposta = Math.max(0, floorUnits - bs - lanc); // resto fecha o total exato
  const pctOf = (n: number) => (floorUnits > 0 ? round1((n / floorUnits) * 100) : 0);

  const segments: StrategySegment[] = [
    { key: 'best-seller', label: 'Best-seller', rationale: 'reposição do que já vende', units: bs, pct: pctOf(bs) },
    { key: 'lancamento', label: 'Lançamento', rationale: 'quota por segmento', units: lanc, pct: pctOf(lanc) },
    { key: 'aposta', label: 'Aposta', rationale: 'especulação dirigida', units: aposta, pct: pctOf(aposta) },
  ];

  const withoutBacking = Math.max(0, floorUnits - capacity);
  const backedPct = floorUnits > 0 ? round1(((bs + lanc) / floorUnits) * 100) : 0;
  const capacityUsedPct = capacity > 0 ? round1((floorUnits / capacity) * 100) : 0;
  const viable = capacity > 0 && floorUnits <= capacity;

  const verdict = capacity <= 0
    ? 'Sem histórico de vendas suficiente para projetar a capacidade — carregue o período ou amplie a janela.'
    : viable
      ? `O piso (${floorUnits}) é ${capacityUsedPct}% da capacidade (${capacity}) da rede na janela — com lastro e viável.`
      : `O piso (${floorUnits}) passa a capacidade da rede (${capacity}): ${withoutBacking} un. ficariam sem lastro. Reduza o piso ou amplie a janela.`;

  return {
    floorUnits, windowMonths, risk,
    capacity, capacityUsedPct, viable, withoutBacking, backedPct,
    segments, verdict,
  };
}

// ─── Catálogo de marcas: fornecedor canônico + mix por loja ──────────────────
//
// Vem da planilha real "PDVs_Grifes" (Loja · Grife · Grupo · Fornecedor). Duas
// regras que o cliente confirmou:
//  1. Fornecedor é derivado da MARCA (grife), 1:1 — no ERP o campo "marca"
//     traz o fornecedor, mas a marca real é a grife da descrição.
//  2. Mix: as grifes PREMIUM (as que aparecem na planilha) só existem nas lojas
//     listadas; qualquer marca fora da planilha (linhas correntes: Ray-Ban,
//     Chilli Beans, Technos…) é vendida em TODAS as lojas.
//
// O JSON é gitignorado (dado comercial real); gerado por
// scripts/build-brand-catalog.mjs. Sem catálogo carregado, tudo é permissivo.

export interface BrandCatalog {
  /** Marca (grife) normalizada → fornecedor canônico. */
  supplierByBrand: Record<string, string>;
  /** Grife premium normalizada → nomes de loja (normalizados) que a trabalham. */
  premiumStores: Record<string, string[]>;
}

/** Chave de comparação: MAIÚSCULA, sem acento, espaços colapsados. */
export function normBrandKey(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Fornecedor canônico de uma marca (null quando não há catálogo ou marca desconhecida). */
export function supplierFor(brand: string | null | undefined, catalog: BrandCatalog | null): string | null {
  if (!brand || !catalog) return null;
  return catalog.supplierByBrand[normBrandKey(brand)] ?? null;
}

/**
 * A loja trabalha a marca? Grife premium → só nas lojas listadas; marca fora
 * da lista (corrente) → todas. Sem catálogo ou marca vazia → permissivo (true).
 * O casamento de loja é tolerante (inclusão em qualquer direção) porque o nome
 * da planilha pode diferir levemente do nome vindo do ERP.
 */
export function storeCarriesBrand(
  brand: string | null | undefined,
  storeName: string | null | undefined,
  catalog: BrandCatalog | null,
): boolean {
  if (!catalog || !brand) return true;
  const stores = catalog.premiumStores[normBrandKey(brand)];
  if (!stores || stores.length === 0) return true; // não é grife premium → universal
  const sn = normBrandKey(storeName ?? '');
  if (!sn) return true;
  return stores.some((s) => sn === s || sn.includes(s) || s.includes(sn));
}
