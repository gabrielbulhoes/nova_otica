import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest } from '../../http/helpers.js';
import { PLANNED_STORE_WHERE, plannedStoreSql } from '../stores/store.scope.js';
import { loadBrandCatalog } from './brandCatalog.js';
import { analysisBrand, buildFairSplit, storeCarriesBrand } from './planning.math.js';
import { createMovement, type Actor } from '../movements/movements.service.js';

/**
 * Distribuição do recebimento (feedback 6.0 · item 06).
 *
 * "Ela confirmou o pedido que sugeriu, confirmou o recebimento, mas ele não diz
 *  como deve distribuir essa mercadoria. O Chico sugere a compra E sugere a
 *  distribuição dos lotes para as lojas seguindo a lógica de eficiência."
 *
 * O ciclo terminava no recebimento — e é exatamente ali que a pergunta de
 * operação começa: chegaram 40 armações, e agora? A rede tem 16 lojas; dividir
 * igual é errado (a Midway vende três vezes o que vende a Guarabira) e dividir
 * "no olho" é o que a plataforma existe para substituir.
 *
 * A conta de rateio já existia — `buildFairSplit`, dos maiores restos, na tela
 * do Modo Feira. O que faltava era ligá-la ao pedido: lá, o gestor digitava
 * marca e quantidade à mão, uma marca por vez. Aqui, o pedido inteiro sai
 * rateado de uma vez, item a item.
 *
 * A LÓGICA DE EFICIÊNCIA, e por que ela precisa de quatro degraus:
 *
 *   1. SKU       — participação de cada loja nas vendas DESTA peça em 12 meses.
 *                  É a régua certa quando existe histórico.
 *   2. GRIFE     — quase nunca existe. Um pedido de compra é, em boa parte,
 *                  peça NOVA: modelo que a rede nunca vendeu, porque acabou de
 *                  ser lançado. O SKU não tem histórico nenhum, mas a rede sabe
 *                  onde Ray-Ban sai.
 *   3. CATEGORIA — grife nova (primeira compra da marca): sobra saber onde sai
 *                  óculos de sol.
 *   4. REDE      — nada disso existe: cai na participação geral de cada loja.
 *
 * Cada linha DECLARA de qual degrau veio. Um rateio por categoria é uma
 * estimativa bem mais grossa do que um por SKU, e apresentar os dois com a
 * mesma cara seria vender precisão que não temos.
 */

export type DistributionBasis = 'sku' | 'marca' | 'categoria' | 'rede';

export interface DistributionRow {
  storeId: string;
  storeName: string;
  /** Unidades a mandar para esta loja. A soma bate exatamente com a compra. */
  quantity: number;
  /** Participação da loja na base usada (%). */
  sharePct: number;
  /** Unidades que a loja vendeu na base usada, nos últimos 12 meses. */
  unitsSold: number;
}

export interface DistributionItem {
  productId: string;
  description: string;
  /** Quantidade comprada — o que precisa ser dividido. */
  quantity: number;
  basis: DistributionBasis;
  /** O que a base significa em palavras, para a tela mostrar sem traduzir. */
  basisLabel: string;
  rows: DistributionRow[];
  /**
   * Lojas removidas por não trabalharem a grife (catálogo de mix). Declarado
   * porque some loja da lista sem motivo visível, e a soma continua fechando —
   * é o tipo de silêncio que faz alguém desconfiar de tudo o mais.
   */
  excludedByMix?: string[];
}

export interface DistributionPlan {
  orderId: string;
  supplier: string;
  status: string;
  /** Unidades do pedido inteiro. */
  units: number;
  items: DistributionItem[];
  /** Unidades que não puderam ser rateadas (produto some do cadastro). */
  unassigned: number;
}

interface ItemDoPedido {
  productId: string;
  description: string;
  quantity: number;
}

const BASIS_LABEL: Record<DistributionBasis, string> = {
  sku: 'venda desta peça nos últimos 12 meses',
  marca: 'venda da grife nos últimos 12 meses — a peça ainda não tem histórico',
  categoria: 'venda da categoria nos últimos 12 meses — a grife ainda não tem histórico',
  rede: 'participação geral de cada loja — nem a categoria tem histórico',
};

/**
 * Vendas por loja em 12 meses, agrupadas por produto, por grife e por
 * categoria de uma vez. Uma consulta só: a projeção volta com as três chaves e
 * a agregação acontece em memória, porque a grife não é coluna do banco — ela
 * é extraída da descrição (`analysisBrand`).
 */
async function vendasPorLoja(productIds: string[]) {
  const rows = await prisma.$queryRaw<
    {
      storeId: string;
      productId: string;
      description: string;
      brand: string | null;
      category: string | null;
      units: number;
    }[]
  >(Prisma.sql`
    SELECT s."storeId"      AS "storeId",
           p.id             AS "productId",
           p.description    AS description,
           p.brand          AS brand,
           p.category       AS category,
           SUM(si.quantity)::int AS units
    FROM "SaleItem" si
    JOIN "Sale" s   ON s.id = si."saleId"
    JOIN "Store" st ON st.id = s."storeId" AND ${plannedStoreSql('st')}
    JOIN "Product" p ON p.id = si."productId"
    WHERE s."saleDate" >= NOW() - INTERVAL '12 months'
    GROUP BY s."storeId", p.id, p.description, p.brand, p.category
  `);

  const porSku = new Map<string, Map<string, number>>();
  const porMarca = new Map<string, Map<string, number>>();
  const porCategoria = new Map<string, Map<string, number>>();
  const porRede = new Map<string, number>();

  const somar = (m: Map<string, Map<string, number>>, chave: string, loja: string, un: number) => {
    const dentro = m.get(chave) ?? new Map<string, number>();
    dentro.set(loja, (dentro.get(loja) ?? 0) + un);
    m.set(chave, dentro);
  };

  const interessa = new Set(productIds);
  for (const r of rows) {
    // Vendas negativas existem (devolução lançada como venda líquida) e não
    // podem virar participação negativa no rateio.
    const un = Math.max(0, r.units);
    porRede.set(r.storeId, (porRede.get(r.storeId) ?? 0) + un);
    if (interessa.has(r.productId)) somar(porSku, r.productId, r.storeId, un);
    const marca = analysisBrand(r.description, r.category, r.brand);
    if (marca) somar(porMarca, marca, r.storeId, un);
    if (r.category) somar(porCategoria, r.category, r.storeId, un);
  }
  return { porSku, porMarca, porCategoria, porRede };
}

/**
 * Plano de distribuição de um pedido de compra: como dividir cada item entre
 * as lojas. Não escreve nada — é uma proposta, e quem executa é
 * `createDistributionMovements`.
 */
export async function distributionPlan(orderId: string): Promise<DistributionPlan> {
  const pedido = await prisma.purchaseOrderRecord.findUnique({ where: { id: orderId } });
  if (!pedido) throw badRequest('Pedido não encontrado.');

  const itens = (pedido.items as unknown as ItemDoPedido[]).filter(
    (it) => it?.productId && Number.isInteger(it.quantity) && it.quantity > 0,
  );

  const [lojas, produtos, vendas] = await Promise.all([
    prisma.store.findMany({ where: PLANNED_STORE_WHERE, select: { id: true, name: true } }),
    prisma.product.findMany({
      where: { id: { in: itens.map((i) => i.productId) } },
      select: { id: true, description: true, brand: true, category: true },
    }),
    vendasPorLoja(itens.map((i) => i.productId)),
  ]);

  const produtoPor = new Map(produtos.map((p) => [p.id, p]));
  const catalogo = loadBrandCatalog();
  const items: DistributionItem[] = [];
  let unassigned = 0;

  for (const it of itens) {
    const prod = produtoPor.get(it.productId);
    if (!prod) {
      // Produto saiu do cadastro entre o pedido e o recebimento. Contamos e
      // seguimos: melhor um resto declarado do que um rateio inventado.
      unassigned += it.quantity;
      continue;
    }
    const marca = analysisBrand(prod.description, prod.category, prod.brand);

    // Degraus, na ordem. O primeiro com alguma venda ganha.
    const candidatos: [DistributionBasis, Map<string, number> | undefined][] = [
      ['sku', vendas.porSku.get(prod.id)],
      ['marca', marca ? vendas.porMarca.get(marca) : undefined],
      ['categoria', prod.category ? vendas.porCategoria.get(prod.category) : undefined],
      ['rede', vendas.porRede],
    ];
    const escolhido = candidatos.find(
      ([, mapa]) => mapa && [...mapa.values()].some((v) => v > 0),
    );
    const [basis, mapa] = escolhido ?? ['rede', vendas.porRede];

    // Mix: grife premium não vai para loja que não a trabalha. Mesma regra do
    // remanejamento — mandar uma peça para onde ela não pode ser vendida é
    // criar o encalhe que a plataforma existe para evitar.
    const excluidas: string[] = [];
    const elegiveis = lojas.filter((l) => {
      const trabalha = storeCarriesBrand(marca, l.name, catalogo);
      if (!trabalha) excluidas.push(l.name);
      return trabalha;
    });

    const rateio = buildFairSplit(
      elegiveis.map((l) => ({
        storeId: l.id,
        storeName: l.name,
        unitsSold: mapa?.get(l.id) ?? 0,
        stockUnits: 0,
      })),
      it.quantity,
    );

    items.push({
      productId: prod.id,
      description: prod.description,
      quantity: it.quantity,
      basis: basis as DistributionBasis,
      basisLabel: BASIS_LABEL[basis as DistributionBasis],
      rows: rateio.rows
        .filter((r) => r.suggestedQty > 0)
        .map((r) => ({
          storeId: r.storeId,
          storeName: r.storeName,
          quantity: r.suggestedQty,
          sharePct: r.sharePct,
          unitsSold: r.unitsSold,
        })),
      ...(excluidas.length > 0 ? { excludedByMix: excluidas } : {}),
    });

    // O rateio devolve zero para todas as lojas quando NINGUÉM vendeu nada em
    // base nenhuma — rede recém-aberta, ou primeira execução. A quantidade não
    // pode evaporar em silêncio.
    const distribuido = rateio.rows.reduce((a, r) => a + r.suggestedQty, 0);
    unassigned += it.quantity - distribuido;
  }

  return {
    orderId: pedido.id,
    supplier: pedido.supplier,
    status: pedido.status,
    units: pedido.units,
    items,
    unassigned,
  };
}

export interface DistributionExecution {
  created: number;
  units: number;
  movementIds: string[];
}

/**
 * Cria as transferências do plano: uma por (item × loja), saindo da unidade
 * onde a mercadoria chegou.
 *
 * A origem é PEDIDA, não adivinhada. O pedido de compra não registra onde a
 * carga desembarcou, e há três unidades de retaguarda candidatas — escolher
 * uma por conta própria seria inventar um fato de operação para poder gravar
 * uma movimentação.
 */
export async function createDistributionMovements(
  orderId: string,
  fromStoreId: string,
  actor: Actor,
): Promise<DistributionExecution> {
  const origem = await prisma.store.findUnique({ where: { id: fromStoreId } });
  if (!origem) throw badRequest('Unidade de origem não encontrada.');

  const plano = await distributionPlan(orderId);
  if (plano.status !== 'RECEIVED') {
    throw badRequest('Distribua só depois de confirmar o recebimento da mercadoria.');
  }

  const dados = plano.items.flatMap((item) =>
    item.rows
      .filter((r) => r.storeId !== fromStoreId && r.quantity > 0)
      .map((r) => ({
        type: 'TRANSFER' as const,
        productId: item.productId,
        fromStoreId,
        toStoreId: r.storeId,
        quantity: r.quantity,
        // Fica em PENDING (reserva o saldo), não CONFIRMED: a mercadoria ainda
        // vai fisicamente sair da retaguarda, e quem confirma é quem despacha.
        confirm: false,
        reason:
          `Distribuição do pedido ${plano.supplier}: ${r.quantity} un. para ${r.storeName} ` +
          `(${r.sharePct}% da ${item.basis === 'sku' ? 'venda da peça' : `venda por ${item.basis}`}).`,
      })),
  );

  if (dados.length === 0) return { created: 0, units: 0, movementIds: [] };

  // Passa pelo `createMovement` de verdade, e não por um `create` cru: é ele
  // que trava a posição, valida o saldo da origem e recalcula o reservado.
  // Gravar as movimentações à mão criaria transferências que a tela de estoque
  // não enxerga — o mesmo saldo prometido a duas lojas.
  //
  // Uma transação só, porque distribuição pela metade é pior do que
  // distribuição nenhuma: ninguém consegue dizer o que já saiu e o que não.
  const criadas = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const d of dados) ids.push((await createMovement(d, actor, tx)).id);
    return ids;
  });

  return {
    created: criadas.length,
    units: dados.reduce((a, d) => a + d.quantity, 0),
    movementIds: criadas,
  };
}

/** Unidades de retaguarda — os destinos plausíveis de uma carga que chega. */
export async function receivingUnits() {
  const rows = await prisma.store.findMany({
    where: { excludeFromPlanning: true, externalErp: false },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return { rows };
}
