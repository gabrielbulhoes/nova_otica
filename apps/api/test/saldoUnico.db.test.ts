import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { listStock, saldosAoVivo } from '../src/modules/stock/stock.service.js';
import { purchaseOrders } from '../src/modules/planning/planning.service.js';
import { PLANNED_STORE_WHERE } from '../src/modules/stores/store.scope.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * A segunda metade de `saldoUnico.test.ts` — a que só se enxerga com banco.
 *
 * O rateio da aba de compras e o plano de distribuição do recebimento liam
 * `StockItem.quantity` cru; a aba de Estoque e o remanejamento liam o saldo ao
 * vivo. Mesma peça, mesma loja, mesma tela, dois números — e o gestor sem saber
 * em qual acreditar.
 *
 * DUAS PARCELAS, E NÃO UMA. Escrevendo este teste eu descobri que o "número
 * único" que eu ia afirmar não existe, e a diferença é de significado, não de
 * bug:
 *
 *   · `StockItem.reserved` são as saídas PENDING — já aprovadas. A peça tem
 *     dono e não está à venda. Sai de TODAS as contas, inclusive da vitrine.
 *   · as saídas REQUESTED são PEDIDOS de gestor ainda não aprovados. A peça
 *     continua vendável no balcão — e é por isso que a aba de Estoque a mostra
 *     como disponível — mas o planejamento NÃO pode oferecê-la de novo, senão
 *     reemite a sugestão que a loja acabou de pedir e a rede fica com duas
 *     ordens para as mesmas unidades.
 *
 * Então `saldosAoVivo` desconta as duas (é o insumo de quem decide), e
 * `listStock` desconta só a primeira (é o que o balconista pode vender hoje).
 * O teste prende as duas regras separadas, em vez de forçar uma igualdade
 * bonita que seria falsa.
 */
const JANELA = 365;
const RESERVADO = 1;
const SOLICITADO = 1;
const FISICO = 3;

interface Posicao {
  storeId: string;
  quantity: number;
  available: number;
  reserved: number;
}

d('uma conta de estoque só (integração com Postgres)', () => {
  let alvo = '';
  let loja = '';
  let movimentoId = '';
  let anterior: Posicao[] = [];

  beforeAll(async () => {
    const vendidos = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: { productId: { not: null } },
      _sum: { quantity: true },
    });
    if (vendidos.length === 0) throw new Error('sem vendas no banco (rode o seed)');
    alvo = vendidos.sort((a, b) => (b._sum.quantity ?? 0) - (a._sum.quantity ?? 0))[0]
      .productId as string;

    anterior = await prisma.stockItem.findMany({
      where: { productId: alvo, store: PLANNED_STORE_WHERE },
      select: { storeId: true, quantity: true, available: true, reserved: true },
    });
    if (anterior.length < 2) throw new Error('peça sem posição em duas lojas (rode o seed)');

    // Rede zerada nesta peça: é o que a faz cair abaixo do ponto de reposição e
    // virar item de PEDIDO — sem pedido não há rateio, e o teste não testaria
    // nada. Só a loja escolhida fica com estoque, e pouco.
    await prisma.stockItem.updateMany({
      where: { productId: alvo, store: PLANNED_STORE_WHERE },
      data: { quantity: 0, available: 0, reserved: 0 },
    });
    loja = anterior[0].storeId;
    await prisma.stockItem.update({
      where: { storeId_productId: { storeId: loja, productId: alvo } },
      // `reserved` escrito à mão é o que `recomputeReserved` teria escrito para
      // uma saída PENDING. Escrever a coluna, e não criar a movimentação, é de
      // propósito: aqui o objeto do teste é a LEITURA.
      data: { quantity: FISICO, available: FISICO - RESERVADO, reserved: RESERVADO },
    });

    const destino = anterior.find((e) => e.storeId !== loja)!.storeId;
    const mov = await prisma.inventoryMovement.create({
      data: {
        type: 'TRANSFER',
        status: 'REQUESTED',
        productId: alvo,
        fromStoreId: loja,
        toStoreId: destino,
        quantity: SOLICITADO,
      },
      select: { id: true },
    });
    movimentoId = mov.id;
  });

  afterAll(async () => {
    if (movimentoId) await prisma.inventoryMovement.delete({ where: { id: movimentoId } });
    for (const e of anterior) {
      await prisma.stockItem.update({
        where: { storeId_productId: { storeId: e.storeId, productId: alvo } },
        data: { quantity: e.quantity, available: e.available, reserved: e.reserved },
      });
    }
  });

  it('o saldo do planejamento desconta o aprovado E o solicitado', async () => {
    const saldos = await saldosAoVivo([alvo], PLANNED_STORE_WHERE);
    const s = saldos.get(`${loja}:${alvo}`);
    expect(s).toBeDefined();
    expect(s!.onHand).toBe(FISICO);
    expect(s!.disponivel).toBe(FISICO - RESERVADO - SOLICITADO);
  });

  it('a aba de Estoque desconta só o aprovado — é o que o balcão pode vender', async () => {
    const { rows } = await listStock({ productId: alvo, storeIds: [loja], limit: 10, skip: 0 });
    const linha = rows.find((r) => r.storeId === loja);
    expect(linha).toBeDefined();
    expect(linha!.onHand).toBe(FISICO);
    expect(linha!.availableNow).toBe(FISICO - RESERVADO);
  });

  it('o rateio da aba de compras não mostra mais o número cru da última sync', async () => {
    const po = await purchaseOrders(JANELA, undefined, 'todos', true);
    const item = po.orders.flatMap((o) => o.items).find((i) => i.productId === alvo);
    expect(item?.distribution).toBeDefined();
    const noRateio = item!.distribution!.rows.find((r) => r.storeId === loja);
    // Sem isto o teste passa por acaso: linha ausente com `?? 0` bateria com um
    // esperado zero, e a asserção não afirmaria nada.
    expect(noRateio).toBeDefined();

    // O defeito, em uma linha: aqui vinha 3 — `StockItem.quantity` cru — na
    // mesma tela em que a aba ao lado mostrava 2. E a unidade que já
    // tinha dono contava como cobertura desta loja, desviando a compra de
    // quem realmente precisava.
    expect(noRateio!.stockUnits).toBe(FISICO - RESERVADO - SOLICITADO);
  });
});
