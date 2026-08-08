import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest } from '../../http/helpers.js';
import { PLANNED_STORE_WHERE, plannedStoreSql } from '../stores/store.scope.js';
import { loadBrandCatalog } from './brandCatalog.js';
import {
  analysisBrand,
  splitByNeed,
  storeCarriesBrand,
  type NeedSplitRow,
} from './planning.math.js';
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
 * A LÓGICA DE EFICIÊNCIA — e a correção de rumo que o pedido literal do
 * cliente impôs a ela.
 *
 * A primeira versão rateava por PARTICIPAÇÃO NAS VENDAS, por uma escada de
 * quatro degraus (SKU → grife → categoria → rede). O cliente pediu outra
 * coisa: "de acordo com a melhor chance de venda E OTIMIZAÇÃO DO ESTOQUE".
 * São duas perguntas, e participação responde só a primeira. A Midway vende
 * três vezes o que vende a Guarabira — e se a Midway já tem 40 em prateleira e
 * a Guarabira tem zero, mandar três quartos da carga para a Midway é rigor
 * aritmético a serviço do erro.
 *
 * A régua agora é a NECESSIDADE: quanto falta a cada loja para chegar à
 * cobertura-alvo da peça (`splitByNeed`). Ela responde as duas perguntas de
 * uma vez — o alvo é demanda × dias de cobertura, então quem vende mais tem
 * alvo maior, e o estoque que a loja já tem é descontado antes do rateio.
 *
 * A ESCADA CONTINUA, como RESERVA e não como régua. Ela vale exatamente no
 * caso em que a necessidade não sabe responder: soma das faltas igual a zero,
 * que é o caso normal do pedido de compra — peça NOVA, modelo que a rede nunca
 * vendeu, demanda zero em toda loja e portanto falta zero em toda loja. Aí a
 * escada desce até achar alguma venda:
 *
 *   1. SKU       — venda desta peça em 12 meses (raro num lançamento).
 *   2. GRIFE     — a rede não conhece o modelo, mas sabe onde Ray-Ban sai.
 *   3. CATEGORIA — grife nova (primeira compra da marca): sobra saber onde sai
 *                  óculos de sol.
 *   4. REDE      — nada disso existe: participação geral de cada loja.
 *
 * Cada item DECLARA de qual base veio. Um rateio por categoria é uma
 * estimativa bem mais grossa do que um por necessidade, e apresentar os dois
 * com a mesma cara seria vender precisão que não temos.
 */

export type DistributionBasis = 'necessidade' | 'sku' | 'marca' | 'categoria' | 'rede';

/** Janela do histórico consultado — 12 meses, em dias, para a demanda diária. */
const JANELA_DIAS = 365;

/**
 * Uma linha de rateio por loja. É o MESMO formato do rateio da aba de compras,
 * e com os MESMOS nomes de campo, de propósito: as duas telas respondem a
 * mesma pergunta — quanto vai para cada loja e por quê — e usam uma tabela só.
 *
 * O nome do campo de quantidade é `suggestedQty` porque é assim que o domínio
 * já chama a sugestão em `ProductPlan` e em `NeedSplitRow`. Enquanto esta rota
 * traduzia para `quantity` e a de compras não traduzia, a tela lia um campo
 * que metade das respostas não tinha — e o typecheck passava, porque o web
 * declarava o tipo à mão.
 */
export type DistributionRow = NeedSplitRow;

export interface DistributionItem {
  productId: string;
  description: string;
  /** Quantidade comprada — o que precisa ser dividido. */
  quantity: number;
  basis: DistributionBasis;
  /** O que a base significa em palavras, para a tela mostrar sem traduzir. */
  basisLabel: string;
  /**
   * Necessidade CRUA da rede nesta peça (un.), antes de virar percentual —
   * é o que diz se a carga cobre a falta ou é um cobertor curto. Zero quando
   * o rateio caiu na reserva por participação.
   */
  totalNeed: number;
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
  necessidade: 'falta até a cobertura-alvo de cada loja — venda desta peça e estoque na mesma conta',
  sku: 'venda desta peça nos últimos 12 meses — nenhuma loja está abaixo do alvo',
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

  const [lojas, produtos, vendas, estoques] = await Promise.all([
    prisma.store.findMany({ where: PLANNED_STORE_WHERE, select: { id: true, name: true } }),
    prisma.product.findMany({
      where: { id: { in: itens.map((i) => i.productId) } },
      select: { id: true, description: true, brand: true, category: true },
    }),
    vendasPorLoja(itens.map((i) => i.productId)),
    // Estoque atual por (loja, peça): a metade da necessidade que a
    // participação nas vendas nunca olhou. Só as peças do pedido e só as lojas
    // do escopo, então a consulta é da ordem de itens × 16.
    prisma.stockItem.findMany({
      where: { productId: { in: itens.map((i) => i.productId) }, store: PLANNED_STORE_WHERE },
      select: { storeId: true, productId: true, quantity: true },
    }),
  ]);

  const produtoPor = new Map(produtos.map((p) => [p.id, p]));
  const estoquePor = new Map(estoques.map((e) => [`${e.productId}:${e.storeId}`, e.quantity]));
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

    // Mix: grife premium não vai para loja que não a trabalha. Mesma regra do
    // remanejamento — mandar uma peça para onde ela não pode ser vendida é
    // criar o encalhe que a plataforma existe para evitar.
    //
    // O filtro vem ANTES do rateio, e é a ordem que importa: se o rateio
    // rodasse sobre a rede inteira e as linhas das lojas excluídas fossem
    // descartadas depois, as unidades delas sumiriam da conta sem aparecer nem
    // no rateio nem em `unassigned`. Aqui a carga inteira é sempre repartida
    // entre as lojas elegíveis, e a contabilidade fecha contra `it.quantity`.
    const excluidas: string[] = [];
    const elegiveis = lojas.filter((l) => {
      const trabalha = storeCarriesBrand(marca, l.name, catalogo);
      if (!trabalha) excluidas.push(l.name);
      return trabalha;
    });

    // Degraus da RESERVA, na ordem. O primeiro com alguma venda ganha — e só é
    // consultado se a necessidade não souber responder.
    const candidatos: [DistributionBasis, Map<string, number> | undefined][] = [
      ['sku', vendas.porSku.get(prod.id)],
      ['marca', marca ? vendas.porMarca.get(marca) : undefined],
      ['categoria', prod.category ? vendas.porCategoria.get(prod.category) : undefined],
      ['rede', vendas.porRede],
    ];
    const escolhido = candidatos.find(([, mapa]) => mapa && [...mapa.values()].some((v) => v > 0));
    const [degrau, mapa] = escolhido ?? ['rede', vendas.porRede];

    const rateio = splitByNeed(
      elegiveis.map((l) => ({
        storeId: l.id,
        storeName: l.name,
        // A venda que entra na NECESSIDADE é a da própria peça: o alvo de
        // cobertura de um SKU não pode sair da venda da categoria inteira.
        unitsSold: vendas.porSku.get(prod.id)?.get(l.id) ?? 0,
        stockUnits: estoquePor.get(`${prod.id}:${l.id}`) ?? 0,
      })),
      it.quantity,
      JANELA_DIAS,
      undefined,
      (r) => mapa?.get(r.storeId) ?? 0,
    );

    const basis: DistributionBasis = rateio.basis === 'necessidade' ? 'necessidade' : degrau;

    items.push({
      productId: prod.id,
      description: prod.description,
      quantity: it.quantity,
      basis,
      basisLabel: BASIS_LABEL[basis],
      totalNeed: rateio.totalNeed,
      // Sem tradução de campo no meio: a linha do rateio VAI como está. A
      // tradução que existia aqui (`quantity: r.suggestedQty`) era exatamente
      // o degrau onde as duas telas passaram a falar nomes diferentes.
      rows: rateio.rows.filter((r) => r.suggestedQty > 0),
      ...(excluidas.length > 0 ? { excludedByMix: excluidas } : {}),
    });

    // O rateio devolve zero para todas as lojas quando ninguém precisa de nada
    // E ninguém vendeu nada em base nenhuma — ou quando o mix excluiu a rede
    // inteira. A conta fecha contra a quantidade COMPRADA, não contra o que
    // sobrou depois dos filtros: a quantidade não pode evaporar em silêncio.
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

/**
 * Como a base aparece no motivo da movimentação. Fica gravado no histórico de
 * estoque e é lido meses depois por quem não estava na conversa — por isso não
 * é o nome do campo interpolado cru ("venda por necessidade" não quer dizer
 * nada).
 */
const MOTIVO_DA_BASE: Record<DistributionBasis, string> = {
  necessidade: 'falta até a cobertura-alvo',
  sku: 'venda da peça',
  marca: 'venda da grife',
  categoria: 'venda da categoria',
  rede: 'venda geral da loja',
};

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
      .filter((r) => r.storeId !== fromStoreId && r.suggestedQty > 0)
      .map((r) => ({
        type: 'TRANSFER' as const,
        productId: item.productId,
        fromStoreId,
        toStoreId: r.storeId,
        quantity: r.suggestedQty,
        // Fica em PENDING (reserva o saldo), não CONFIRMED: a mercadoria ainda
        // vai fisicamente sair da retaguarda, e quem confirma é quem despacha.
        confirm: false,
        reason:
          `Distribuição do pedido ${plano.supplier}: ${r.suggestedQty} un. para ${r.storeName} ` +
          `(${r.sharePct}% da ${MOTIVO_DA_BASE[item.basis]}).`,
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
