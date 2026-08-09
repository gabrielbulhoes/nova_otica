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
      // O peso que gerou o percentual é o mesmo que a linha mostra.
      expect(r.weightUnits).toBe(r.needUnits);
    }
  });

  it('com filtro de loja NÃO há rateio — a quantidade já é daquela loja', async () => {
    // O defeito que este teste mata: `plans` escopa venda E estoque à loja
    // filtrada, mas as posições do rateio vinham da rede inteira. O pedido de
    // 5 un. que existia POR CAUSA de Campinas saía endereçado 3 para Campinas
    // e 2 para o Rio — duas unidades para uma loja cuja demanda nem entrou na
    // conta da compra.
    //
    // Escopar as posições não resolveria: daria um rateio de 100% para uma
    // loja só, que é um número certo apresentado como se fosse uma decisão.
    // Na visão de uma loja não existe o que repartir.
    const loja = await prisma.store.findFirst({ where: PLANNED_STORE_WHERE, select: { id: true } });
    const po = await purchaseOrders(JANELA, loja!.id, 'todos', true);
    const itens = po.orders.flatMap((o) => o.items);
    expect(itens.length).toBeGreaterThan(0);
    expect(itens.every((i) => i.distribution === undefined)).toBe(true);
  });

  it('sem pedir rateio explicitamente, o pedido não paga a conta do banco', async () => {
    // `publishPlanningAlert` chama `purchaseOrders(days)` a cada sincronização
    // do ERP e usa só os contadores do resumo. Com o default fail-open, o
    // rateio inteiro era calculado — um agregado com um bind param por SKU de
    // compra mais um findMany de estoque — e jogado fora. Nenhuma saída errada;
    // trabalho de banco por sincronização a serviço de nada.
    const po = await purchaseOrders(JANELA);
    const itens = po.orders.flatMap((o) => o.items);
    expect(itens.length).toBeGreaterThan(0);
    expect(itens.every((i) => i.distribution === undefined)).toBe(true);
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
