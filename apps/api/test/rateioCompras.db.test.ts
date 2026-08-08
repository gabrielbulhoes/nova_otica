import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { purchaseOrders } from '../src/modules/planning/planning.service.js';
import { PLANNED_STORE_WHERE } from '../src/modules/stores/store.scope.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * G7 — "na aba de sugestão de compras já precisa indicar a sugestão de
 * distribuição daqueles itens para cada loja".
 *
 * O que só aparece contra o banco: se a consulta agregada de posições por loja
 * (uma por `productId IN (...)`, e não linha por linha como o remanejamento)
 * devolve o que o rateio precisa, e se o corte por permissão realmente corta.
 *
 * A janela é de 365 dias porque a necessidade sai de venda ÷ dias: com janela
 * curta, o alvo de cobertura de uma peça de baixo giro arredonda para zero e o
 * teste passaria a medir arredondamento.
 */
const JANELA = 365;

d('rateio por loja na aba de compras (integração com Postgres)', () => {
  let alvo = '';
  let estoqueAnterior: { storeId: string; quantity: number; available: number }[] = [];

  beforeAll(async () => {
    const vendidos = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: { productId: { not: null } },
      _sum: { quantity: true },
    });
    if (vendidos.length === 0) throw new Error('sem vendas no banco (rode o seed)');
    alvo = vendidos.sort((a, b) => (b._sum.quantity ?? 0) - (a._sum.quantity ?? 0))[0]
      .productId as string;

    // Zerar o estoque da peça em todas as lojas do escopo é o que a faz cair
    // abaixo do ponto de reposição e virar item de PEDIDO — sem isso não há o
    // que ratear, e o teste passaria sem testar nada. O valor volta no afterAll.
    estoqueAnterior = (
      await prisma.stockItem.findMany({
        where: { productId: alvo, store: PLANNED_STORE_WHERE },
        select: { storeId: true, quantity: true, available: true },
      })
    ).map((e) => ({ ...e }));
    await prisma.stockItem.updateMany({
      where: { productId: alvo, store: PLANNED_STORE_WHERE },
      data: { quantity: 0, available: 0 },
    });
  });

  afterAll(async () => {
    for (const e of estoqueAnterior) {
      await prisma.stockItem.update({
        where: { storeId_productId: { storeId: e.storeId, productId: alvo } },
        data: { quantity: e.quantity, available: e.available },
      });
    }
  });

  it('o item do pedido já vem dividido por loja, e a soma fecha com a compra', async () => {
    const po = await purchaseOrders(JANELA, undefined, 'todos', true);
    const item = po.orders.flatMap((o) => o.items).find((i) => i.productId === alvo);
    expect(item).toBeDefined();

    const rateio = item!.distribution;
    expect(rateio).toBeDefined();
    // O invariante, aqui como no plano de recebimento: tudo o que se compra ou
    // tem endereço de loja ou está declarado em `unassigned`.
    const somado = rateio!.rows.reduce((a, r) => a + r.suggestedQty, 0);
    expect(somado + rateio!.unassigned).toBe(item!.quantity);
    expect(rateio!.rows.every((r) => r.suggestedQty > 0)).toBe(true);
  });

  it('a base é a NECESSIDADE quando alguma loja está abaixo do alvo', async () => {
    // Com a rede toda zerada nesta peça, quem vendeu tem falta — e é a falta,
    // não a participação, que precisa aparecer declarada na linha.
    const po = await purchaseOrders(JANELA, undefined, 'todos', true);
    const rateio = po.orders.flatMap((o) => o.items).find((i) => i.productId === alvo)!.distribution!;
    expect(rateio.basis).toBe('necessidade');
    expect(rateio.totalNeed).toBeGreaterThan(0);
    expect(rateio.basisLabel).toBeTruthy();
    // Cada linha carrega a conta inteira, para o gestor conferir em vez de crer.
    for (const r of rateio.rows) {
      expect(r.needUnits).toBeGreaterThan(0);
      expect(r.stockUnits).toBe(0);
      expect(r.targetUnits).toBeGreaterThanOrEqual(r.needUnits);
    }
  });

  it('quem não é ADMIN recebe o pedido SEM o rateio, não um rateio vazio', async () => {
    // A decisão está comentada na rota: `/rebalance` é fechada por expor a rede
    // inteira, e o rateio por loja é exatamente esse tipo de dado. Fechar a rota
    // toda tiraria do gerente a sugestão de compra da própria loja, que é dele.
    // Então o corte é no campo. Ausente ≠ vazio: vazio afirmaria que nenhuma
    // loja recebe nada.
    const po = await purchaseOrders(JANELA, undefined, 'todos', false);
    const itens = po.orders.flatMap((o) => o.items);
    expect(itens.length).toBeGreaterThan(0);
    expect(itens.every((i) => i.distribution === undefined)).toBe(true);
  });
});
