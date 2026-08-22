import { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { isMadeToOrderLens } from '../planning/planning.math.js';
import { categoriesInGroup } from '../products/product.scope.js';
import { plannedStoreIds, salePlannedWhere, stockPlannedWhere } from '../stores/store.scope.js';
import { computeLiveStock, liveDeltas } from '../stock/stock.service.js';
import type { ProductGroup } from '../planning/planning.math.js';

export type AlertLevel = 'OUT' | 'LOW';

export interface StockAlert {
  level: AlertLevel;
  storeId: string;
  storeName: string;
  productId: string;
  description: string;
  brand: string | null;
  category: string | null;
  availableNow: number;
  threshold: number;
}

/**
 * Resolve o limiar de estoque mínimo de uma posição (loja × produto):
 * mínimo da loja > mínimo do produto > padrão da rede. Puro, testável.
 */
export function resolveThreshold(
  storeMin: number | null | undefined,
  productMin: number | null | undefined,
  networkDefault: number,
): number {
  return storeMin ?? productMin ?? networkDefault;
}

/**
 * A loja TRABALHA esta peça?
 *
 * Esta é a pergunta que faltava, e a falta dela é o defeito central desta tela.
 *
 * O CDS devolve posição de estoque para praticamente todo par (loja × peça):
 * medido em produção, **1.108.423 posições, quase todas zeradas**. Sem esta
 * guarda, cada peça que uma filial NUNCA trabalhou entrava como "em falta" —
 * e o painel de ruptura passava a ser uma lista do catálogo inteiro, com o
 * rótulo errado.
 *
 * O critério tem duas pernas e nenhuma delas sobra:
 *
 *  · **Tem saldo agora** — a loja carrega a peça. Se estiver abaixo do mínimo,
 *    é aviso de reposição.
 *  · **Vendeu na janela** — a loja trabalha a peça mesmo com saldo zero hoje.
 *    Esta perna é a que salva a RUPTURA DE VERDADE: a loja vendeu a última
 *    unidade e zerou. Filtrar só por "tem saldo" apagaria exatamente o caso
 *    mais importante da tela.
 *
 * É a mesma regra que a demonstração já aplicava (`stockQty.has(k) ||
 * soldQty > 0`) e que a produção nunca teve. Mais uma vez as duas pontas
 * discordavam, e a que estava certa era a da demo.
 */
export function lojaTrabalhaAPeca(quantity: number, vendeuNaJanela: boolean): boolean {
  return quantity > 0 || vendeuNaJanela;
}

/** Só os campos que decidem se a posição é alerta — nada de exibição. */
interface PosicaoCrua {
  storeId: string;
  productId: string;
  quantity: number;
  reserved: number;
  minStock: number | null;
  product: { minStock: number | null; category: string | null };
}

export interface StockAlertResult {
  total: number;
  out: number;
  low: number;
  rows: StockAlert[];
  /** Posições examinadas (o universo depois da guarda de "loja trabalha"). */
  examinadas: number;
  /** `true` quando a LISTA foi cortada. Os contadores acima nunca são cortados. */
  truncado: boolean;
  /** Teto da lista, para a tela poder dizer "as N mais críticas". */
  limite: number;
}

/**
 * Quantas linhas a tela recebe. Os CONTADORES não passam por aqui.
 *
 * A distinção é o conserto principal desta função. Antes, o alerta trazia
 * 100.000 posições para a memória `ORDER BY product.description ASC` e contava
 * sobre elas — ou seja, sobre uma FATIA ALFABÉTICA do catálogo. Em produção,
 * com 1,1 milhão de posições, "35.115 alertas na rede" era um número sobre as
 * primeiras letras do alfabeto, e nada na tela dizia isso.
 *
 * Duas coisas mudaram: o corte passou a ser pela URGÊNCIA (menor saldo
 * primeiro, que é como a tela já ordenava depois) e passou a ser DECLARADO.
 */
const TETO_DE_LINHAS = 500;

/**
 * Janela do "a loja vendeu esta peça".
 *
 * Larga de propósito, e mais larga que a janela de análise do planejamento (90
 * dias). Aqui a pergunta não é "quanto gira", é "a loja trabalha isto" — e uma
 * peça sazonal que vendeu no verão e não vende há quatro meses continua sendo
 * uma peça da loja. Uma janela curta a expulsaria do painel de ruptura
 * justamente antes da próxima estação.
 *
 * O outro lado também importa: sem janela nenhuma, uma peça vendida uma vez em
 * 2024 manteria a posição viva para sempre, e a guarda perderia o sentido.
 */
const JANELA_DE_TRABALHO_DIAS = 180;

/**
 * Gera alertas de ruptura (OUT, saldo <= 0) e estoque baixo (LOW, saldo <=
 * mínimo). O mínimo é o da loja, senão o do produto, senão o padrão da rede.
 *
 * DUAS PASSAGENS, de propósito:
 *
 *  1. A decisão roda sobre campos NUMÉRICOS de todas as posições candidatas —
 *     sem `include` de produto e loja. É o que permite contar sem truncar e
 *     sem repetir o incidente de memória da Central de Decisões.
 *  2. Os dados de exibição são buscados só para as linhas que a tela mostra.
 *
 * E a conta do saldo continua sendo `computeLiveStock`, a MESMA da tela de
 * Estoque e do remanejamento. A tentação aqui era reescrevê-la em SQL para
 * contar no banco; seria a terceira definição de saldo ao vivo nesta base, e
 * as duas anteriores já divergiram em produção.
 */
export async function stockAlerts(
  storeId?: string,
  group: ProductGroup = 'todos',
  categories?: string[],
): Promise<StockAlertResult> {
  // GMAIS e outros CDs ficam fora da ruptura: sem loja específica, o escopo é
  // só as lojas planejáveis.
  const storeIds = storeId ? [storeId] : await plannedStoreIds();
  const def = env.DEFAULT_MIN_STOCK;

  // O recorte de produto vira uma LISTA DE CATEGORIAS (a rede tem poucas
  // dezenas), e o filtro do usuário faz interseção com ele — nunca o substitui,
  // senão escolher uma categoria traria lente de volta pela porta dos fundos.
  const doGrupo = await categoriesInGroup(group);
  const catsFiltro = categories?.length ? categories : null;
  const cats =
    doGrupo && catsFiltro
      ? catsFiltro.filter((c) => doGrupo.includes(c))
      : (catsFiltro ?? doGrupo);

  const where: Prisma.StockItemWhereInput = { storeId: { in: storeIds } };
  if (cats) where.product = { category: { in: cats } };

  const [posicoes, vendasPorLoja, deltas] = await Promise.all([
    prisma.stockItem.findMany({
      where,
      select: {
        storeId: true,
        productId: true,
        quantity: true,
        reserved: true,
        minStock: true,
        product: { select: { minStock: true, category: true } },
      },
    }) as Promise<PosicaoCrua[]>,
    // As peças que CADA loja vendeu na janela — a segunda perna da guarda.
    // Agrupa por (loja, peça) porque a pergunta é da loja: uma peça que vende
    // em Midway e nunca vendeu em Guarabira não é ruptura em Guarabira.
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: { productId: { not: null }, sale: salePlannedWhere },
      _sum: { quantity: true },
    }),
    liveDeltas(),
  ]);

  // Par (loja, peça) vendido na janela. Sai de uma consulta crua porque o
  // Prisma não agrupa por coluna de relação — a loja mora em `Sale`, não em
  // `SaleItem`.
  //
  // `storeIds` vazio não pode chegar ao `Prisma.join`: geraria `IN ()`, que é
  // erro de sintaxe no Postgres. Rede sem loja planejável não tem alerta.
  const desde = new Date(Date.now() - JANELA_DE_TRABALHO_DIAS * 86_400_000);
  const vendidoPor = new Set(
    storeIds.length === 0
      ? []
      : (
          await prisma.$queryRaw<{ storeId: string; productId: string }[]>(Prisma.sql`
            SELECT DISTINCT s."storeId" AS "storeId", si."productId" AS "productId"
            FROM "SaleItem" si
            JOIN "Sale" s ON s.id = si."saleId"
            WHERE si."productId" IS NOT NULL
              AND s."saleDate" >= ${desde}
              AND s."storeId" IN (${Prisma.join(storeIds)})
          `)
        ).map((r) => `${r.storeId}:${r.productId}`),
  );

  // Lente por encomenda: saldo 0 é o esperado, não falta. A regra é a mesma de
  // sempre (`isMadeToOrderLens`), e o insumo dela — saldo e venda DA REDE — é
  // por produto, então continua vindo de dois agregados.
  const netSold = new Map(vendasPorLoja.map((n) => [n.productId as string, n._sum.quantity ?? 0]));
  const netStock = new Map(
    (
      await prisma.stockItem.groupBy({
        by: ['productId'],
        where: stockPlannedWhere,
        _sum: { quantity: true },
      })
    ).map((n) => [n.productId, n._sum.quantity ?? 0]),
  );

  const candidatos: { pos: PosicaoCrua; availableNow: number; threshold: number }[] = [];
  let examinadas = 0;

  for (const pos of posicoes) {
    const chave = `${pos.storeId}:${pos.productId}`;
    if (!lojaTrabalhaAPeca(pos.quantity, vendidoPor.has(chave))) continue;
    examinadas += 1;
    if (
      isMadeToOrderLens(
        pos.product.category,
        netStock.get(pos.productId) ?? 0,
        netSold.get(pos.productId) ?? 0,
      )
    ) {
      continue;
    }
    const { availableNow } = computeLiveStock(pos.quantity, pos.reserved, deltas.get(chave) ?? 0);
    const threshold = resolveThreshold(pos.minStock, pos.product.minStock, def);
    if (availableNow > threshold) continue;
    candidatos.push({ pos, availableNow, threshold });
  }

  // CONTAGEM EXATA — sobre todos os candidatos, antes de qualquer corte.
  const out = candidatos.filter((c) => c.availableNow <= 0).length;
  const total = candidatos.length;

  // A LISTA é cortada pela urgência, não pelo alfabeto.
  candidatos.sort((a, b) => a.availableNow - b.availableNow);
  const mostrados = candidatos.slice(0, TETO_DE_LINHAS);

  // Só agora os dados de exibição, e só das linhas que a tela mostra.
  const [produtos, lojas] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: [...new Set(mostrados.map((c) => c.pos.productId))] } },
      select: { id: true, description: true, brand: true, category: true },
    }),
    prisma.store.findMany({
      where: { id: { in: [...new Set(mostrados.map((c) => c.pos.storeId))] } },
      select: { id: true, name: true },
    }),
  ]);
  const produtoPor = new Map(produtos.map((p) => [p.id, p]));
  const lojaPor = new Map(lojas.map((l) => [l.id, l.name]));

  const rows: StockAlert[] = mostrados.map((c) => {
    const p = produtoPor.get(c.pos.productId);
    return {
      level: c.availableNow <= 0 ? 'OUT' : 'LOW',
      storeId: c.pos.storeId,
      storeName: lojaPor.get(c.pos.storeId) ?? '—',
      productId: c.pos.productId,
      description: p?.description ?? '—',
      brand: p?.brand ?? null,
      category: p?.category ?? null,
      availableNow: c.availableNow,
      threshold: c.threshold,
    };
  });

  return {
    total,
    out,
    low: total - out,
    rows,
    examinadas,
    truncado: total > mostrados.length,
    limite: TETO_DE_LINHAS,
  };
}
