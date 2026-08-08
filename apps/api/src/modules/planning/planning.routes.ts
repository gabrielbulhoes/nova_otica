import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseDays } from '../../http/helpers.js';
import {
  CARDS_POR_PAGINA,
  DECISION_PRIORITIES,
  DECISION_TYPES,
  LINHAS_POR_PAGINA,
  PRODUCT_GROUPS,
  RECOMENDACOES,
  TETO_DE_CARDS,
  TETO_DE_LINHAS,
  recortePedido,
  type ProductGroup,
} from './planning.math.js';
import { requireRole, scopedStoreId } from '../auth/auth.middleware.js';
import { publish } from '../../lib/eventBus.js';
import {
  DecisionValidationError,
  decisionHistory,
  decisionStats,
  recordDecision,
} from './decisions.service.js';
import { batchHistory } from './batches.service.js';
import {
  createDistributionMovements,
  distributionPlan,
  receivingUnits,
} from './distribution.service.js';
import {
  commercialStrategy,
  decisionBoard,
  fairSplit,
  listBrandMix,
  listSupplierSettings,
  planningOverview,
  purchaseOrderHistory,
  purchaseOrders,
  purchaseSuggestions,
  rebalancePlan,
  registerPurchaseOrder,
  setBrandMix,
  setSupplierSetting,
  settlePurchaseOrder,
} from './planning.service.js';

export const planningRouter = Router();

// Janela padrão do planejamento: 90 dias de histórico de vendas.
const days = (v: unknown) => parseDays(v, 90);

// Recorte de cobertura (?group=): principal (padrão) | relogios | lentes |
// outros | todos. Operacional começa em 'principal' (óculos de grau e sol);
// os demais só quando pedidos explicitamente.
const group = (v: unknown): ProductGroup =>
  PRODUCT_GROUPS.includes(v as ProductGroup) ? (v as ProductGroup) : 'principal';

/** Valor de query só é aceito quando está no conjunto conhecido. */
const umDe = <T extends string>(v: unknown, aceitos: readonly T[]): T | undefined =>
  aceitos.includes(v as T) ? (v as T) : undefined;

/**
 * Texto livre de filtro (id de loja, nome de grife). Vazio e valor absurdo
 * viram `undefined` — "sem filtro" —, nunca um filtro que não casa com nada:
 * a tela ficaria vazia sem que ninguém soubesse por quê. O teto de 200 é só
 * para a comparação não receber uma cadeia de tamanho arbitrário.
 */
const texto = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 && s.length <= 200 ? s : undefined;
};

/** GET /api/planning/overview — capital imobilizado + Pareto + giro. */
planningRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await planningOverview(days(req.query.days), storeId, group(req.query.group)));
  }),
);

/**
 * GET /api/planning/purchase-suggestions — o que comprar e o que não comprar.
 *
 * `page`/`pageSize` cortam as LINHAS; `recomendacao` é filtro de vista. O
 * `summary` (inclusive `emRisco`) é sempre do conjunto analisado — é ele que a
 * tela lê nos cartões, e ele não pode encolher junto com a página.
 */
planningRouter.get(
  '/purchase-suggestions',
  asyncHandler(async (req, res) => {
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(
      await purchaseSuggestions(days(req.query.days), storeId, group(req.query.group), {
        ...recortePedido(req.query, LINHAS_POR_PAGINA, TETO_DE_LINHAS),
        recomendacao: umDe(req.query.recomendacao, RECOMENDACOES),
      }),
    );
  }),
);

/**
 * GET /api/planning/purchase-orders — rascunhos de ordem de compra por
 * fornecedor (marca), com total e data-limite do pedido.
 *
 * DECISÃO (rateio por loja × permissão): esta rota NÃO ganhou
 * `requireRole('ADMIN')`, ao contrário de `/rebalance`. O rateio por loja é sim
 * dado de rede — a mesma razão que fechou o remanejamento —, mas fechar a rota
 * inteira tiraria de um gerente de loja algo que ele já tinha e que é
 * legítimo: a sugestão de compra da PRÓPRIA loja, que `scopedStoreId` já
 * recorta para ele linha a linha.
 *
 * Então o corte é no dado novo, não na rota: quem não é ADMIN recebe o pedido
 * sem o campo `distribution`. Um gerente de loja continua vendo o que precisa
 * comprar; a divisão entre as 16 lojas — quanto cada uma vende e quanto cada
 * uma tem em estoque — continua sendo visão de rede, para quem enxerga a rede.
 *
 * `distribution` AUSENTE não é "dividir igual": é "não calculado". A tela
 * declara isso, em vez de mostrar uma tabela vazia que pareceria um rateio que
 * deu zero.
 *
 * O campo também some quando há `storeId` — e aí não é permissão, é aritmética:
 * na visão de uma loja a quantidade JÁ é daquela loja, e não existe o que
 * repartir. Ver `purchaseOrders` em planning.service.ts.
 */
planningRouter.get(
  '/purchase-orders',
  asyncHandler(async (req, res) => {
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(
      await purchaseOrders(
        days(req.query.days),
        storeId,
        group(req.query.group),
        req.user?.role === 'ADMIN',
      ),
    );
  }),
);

/**
 * GET /api/planning/rebalance — transferências sugeridas entre lojas
 * (visão da rede: excesso/parado numa loja × falta na outra). Só ADMIN:
 * o plano não tem recorte por loja e expõe estoque/vendas da rede inteira.
 */
planningRouter.get(
  '/rebalance',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await rebalancePlan(days(req.query.days), group(req.query.group)));
  }),
);

/**
 * GET /api/planning/decisions — portal de cards de decisão (compra +
 * remanejamento + liquidação) com tipo, prioridade e impacto. ADMIN: inclui o
 * remanejamento, que é de rede.
 *
 * `page`/`pageSize` cortam os CARDS; `tipo`, `prioridade`, `grife` e `loja` são
 * filtros de VISTA. O `summary`, a contagem de novos/atrasados e a lista de
 * `grifes` continuam sendo do quadro inteiro.
 *
 * `loja` NÃO é `storeId`. `storeId` passa por `scopedStoreId` e muda o ESCOPO DO
 * CÁLCULO — a compra deixa de ser de rede, e a resposta passa a ser de outra
 * pergunta. `loja` só recorta quais cards aparecem. São duas coisas com nomes
 * diferentes exatamente para nunca serem trocadas por engano.
 */
planningRouter.get(
  '/decisions',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(
      await decisionBoard(days(req.query.days), storeId, group(req.query.group), {
        ...recortePedido(req.query, CARDS_POR_PAGINA, TETO_DE_CARDS),
        vista: {
          tipo: umDe(req.query.tipo, DECISION_TYPES),
          prioridade: umDe(req.query.prioridade, DECISION_PRIORITIES),
          loja: texto(req.query.loja),
          grife: texto(req.query.grife),
        },
      }),
    );
  }),
);

/**
 * GET /api/planning/strategy — motor de estratégia comercial (piso · risco ·
 * janela): divide o piso em best-seller/lançamento/aposta e valida o lastro
 * contra a capacidade da rede. ADMIN (visão de rede).
 */
planningRouter.get(
  '/strategy',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const floorUnits = Math.trunc(Number(req.query.floor));
    if (!Number.isFinite(floorUnits) || floorUnits < 0 || floorUnits > 10_000_000) {
      res.status(400).json({ error: 'floor deve ser um inteiro entre 0 e 10000000.' });
      return;
    }
    const windowMonths = Math.trunc(Number(req.query.window)) || 9;
    const r = String(req.query.risk ?? 'equilibrado');
    const risk = r === 'conservador' || r === 'agressivo' ? r : 'equilibrado';
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    res.json(await commercialStrategy(days(req.query.days), { floorUnits, windowMonths, risk }, storeId));
  }),
);

const orderItemSchema = z.object({
  productId: z.string().min(1),
  description: z.string().max(240).default(''),
  quantity: z.number().int().min(1).max(100_000),
  unitCost: z.number().nonnegative().default(0),
  total: z.number().nonnegative().default(0),
});

const registerOrderSchema = z.object({
  supplier: z.string().min(1).max(120),
  leadTimeDays: z.number().int().min(1).max(365),
  items: z.array(orderItemSchema).min(1).max(500),
});

/**
 * POST /api/planning/purchase-orders — registra o pedido como ENVIADO ao
 * fornecedor (1ª confirmação). Enquanto em trânsito, as quantidades são
 * abatidas das próximas sugestões (posição = físico + a caminho).
 */
planningRouter.post(
  '/purchase-orders',
  asyncHandler(async (req, res) => {
    const input = registerOrderSchema.parse(req.body);
    const rec = await registerPurchaseOrder(input, req.user!.id);
    publish({ type: 'purchase-order.changed', recordId: rec.id });
    res.status(201).json(rec);
  }),
);

/** GET /api/planning/purchase-orders/history — histórico enviado/recebido. */
planningRouter.get(
  '/purchase-orders/history',
  asyncHandler(async (_req, res) => {
    res.json(await purchaseOrderHistory());
  }),
);

/**
 * POST /api/planning/purchase-orders/:id/receive — confirma o recebimento
 * (2ª confirmação do ciclo). /:id/cancel cancela um pedido em trânsito.
 */
planningRouter.post(
  '/purchase-orders/:id/:action(receive|cancel)',
  asyncHandler(async (req, res) => {
    const action = req.params.action as 'receive' | 'cancel';
    const rec = await settlePurchaseOrder(req.params.id, action, req.user!.id);
    publish({ type: 'purchase-order.changed', recordId: rec.id });
    res.json(rec);
  }),
);

// ─── Distribuição do recebimento (feedback 6.0 · item 06) ────────────────────

/**
 * GET /api/planning/purchase-orders/:id/distribution — como dividir a
 * mercadoria recebida entre as lojas. Só proposta; não escreve nada.
 */
planningRouter.get(
  '/purchase-orders/:id/distribution',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await distributionPlan(req.params.id));
  }),
);

/** GET /api/planning/receiving-units — de onde a carga pode sair (retaguarda). */
planningRouter.get(
  '/receiving-units',
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    res.json(await receivingUnits());
  }),
);

const distributeSchema = z.object({ fromStoreId: z.string().min(1) });

/**
 * POST /api/planning/purchase-orders/:id/distribute — executa o plano, criando
 * uma transferência por (item × loja) a partir da unidade que recebeu.
 *
 * A origem vem no corpo porque o pedido não registra onde a carga desembarcou,
 * e há três unidades de retaguarda candidatas.
 */
planningRouter.post(
  '/purchase-orders/:id/distribute',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { fromStoreId } = distributeSchema.parse(req.body);
    const r = await createDistributionMovements(req.params.id, fromStoreId, {
      id: req.user!.id,
      role: req.user!.role,
      storeId: req.user!.storeId,
    });
    publish({ type: 'purchase-order.changed', recordId: req.params.id });
    res.status(201).json(r);
  }),
);

/** GET /api/planning/suppliers — fornecedores (marcas) e seus prazos. */
planningRouter.get(
  '/suppliers',
  asyncHandler(async (_req, res) => {
    res.json(await listSupplierSettings());
  }),
);

const supplierSchema = z.object({
  brand: z.string().min(1).max(120),
  leadTimeDays: z.number().int().min(1).max(365).nullable(),
});

/** PUT /api/planning/suppliers — prazo de entrega do fornecedor (ADMIN). */
planningRouter.put(
  '/suppliers',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const input = supplierSchema.parse(req.body);
    res.json(await setSupplierSetting(input.brand, input.leadTimeDays));
  }),
);

/**
 * GET /api/planning/brand-mix — as grifes que o motor conhece, com a marcação
 * de "fora do mix". Lista separada da de fornecedores porque são chaves
 * diferentes: prazo é do fornecedor, mix é da grife.
 */
planningRouter.get(
  '/brand-mix',
  asyncHandler(async (_req, res) => {
    res.json(await listBrandMix());
  }),
);

const brandMixSchema = z.object({
  brand: z.string().min(1).max(120),
  discontinued: z.boolean(),
});

/**
 * PUT /api/planning/brand-mix — marca ou desmarca uma grife como fora do mix
 * (ADMIN). É decisão comercial: nenhum dado do ERP diz que a rede parou de
 * trabalhar uma grife, então ela precisa ser declarada.
 */
planningRouter.put(
  '/brand-mix',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const input = brandMixSchema.parse(req.body);
    res.json(await setBrandMix(input.brand, input.discontinued));
  }),
);

/**
 * GET /api/planning/fair-split — Modo Feira: rateio de uma compra entre as
 * lojas pela participação nas vendas da marca OU do grupo. Só ADMIN.
 */
planningRouter.get(
  '/fair-split',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const qty = Math.trunc(Number(req.query.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 100_000) {
      res.status(400).json({ error: 'qty deve ser um inteiro entre 1 e 100000.' });
      return;
    }
    const brand = (req.query.brand as string | undefined)?.trim() || undefined;
    const category = (req.query.category as string | undefined)?.trim() || undefined;
    res.json(await fairSplit(days(req.query.days), { brand, category }, qty));
  }),
);

// ─── Governança da decisão (Onda 1 · trilha TB) ──────────────────────────────

const decisionSchema = z.object({
  cardId: z.string().min(1).max(120),
  cardType: z.string().min(1).max(40),
  outcome: z.enum(['APPROVED', 'REJECTED']),
  impact: z.number().finite().default(0),
  note: z.string().max(2000).optional(),
  cardSeenAt: z.coerce.date().optional(),
  productId: z.string().min(1).optional(),
  storeId: z.string().min(1).optional(),
});

/**
 * POST /api/planning/decisions — registra a decisão sobre um card.
 * Recusar exige justificativa (regra no serviço).
 */
planningRouter.post(
  '/decisions',
  asyncHandler(async (req, res) => {
    const input = decisionSchema.parse(req.body);
    try {
      const rec = await recordDecision(input, req.user!.id);
      publish({ type: 'decision.recorded', recordId: rec.id });
      res.status(201).json(rec);
    } catch (e) {
      if (e instanceof DecisionValidationError) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      throw e;
    }
  }),
);

/** GET /api/planning/decisions/history — trilha de auditoria (ADMIN vê todos). */
planningRouter.get(
  '/decisions/history',
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || 200;
    // Gestor de loja só enxerga as próprias decisões.
    const scoped = req.user!.role === 'ADMIN' ? undefined : req.user!.id;
    res.json(await decisionHistory(limit, scoped));
  }),
);

/** GET /api/planning/decisions/stats — série, SLA e painel da equipe (ADMIN). */
planningRouter.get(
  '/decisions/stats',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await decisionStats(parseDays(req.query.days, 30)));
  }),
);

/**
 * GET /api/planning/batches — linha do tempo das execuções do motor.
 * O lote nasce do cron das 06h; sync manual gera lote marcado como MANUAL.
 */
planningRouter.get(
  '/batches',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || 30;
    res.json({ rows: await batchHistory(limit) });
  }),
);
