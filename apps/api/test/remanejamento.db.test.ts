import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { rebalancePlan } from '../src/modules/planning/planning.service.js';
import { DEFAULT_PLANNING_CONFIG } from '../src/modules/planning/planning.math.js';
import { PLANNED_STORE_WHERE } from '../src/modules/stores/store.scope.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

const JANELA = 90;
const DIA = 86_400_000;
const atras = (dias: number) => new Date(Date.now() - dias * DIA);

/**
 * Queixa do Galbe (WhatsApp): o remanejamento manda embora peça que acabou de
 * chegar, e esvazia a loja de origem.
 *
 * As travas moram em `buildRebalance` e os testes de unidade já prendem a
 * conta. O que SÓ aparece contra o banco é se o dado chega lá: idade da
 * posição, reserva e unidades a caminho saem de três lugares diferentes do
 * schema e precisam ser lidos, casados e passados adiante por `rebalancePlan`.
 *
 * Existe precedente literal de trava que ninguém liga: `stuckDaysByProduct` é
 * consumido dentro de planning.math.ts e nunca foi passado em produção. Este
 * arquivo é o que impede a mesma coisa de acontecer com estas quatro.
 */
d('remanejamento · os insumos chegam do banco ao motor', () => {
  let origemId = '';
  let destinoId = '';
  let paradoId = '';
  let recemChegadoId = '';
  const vendas: string[] = [];

  /** Linhas do plano da rede referentes a um dos produtos de teste. */
  const linhasDe = async (productId: string) => {
    const plano = await rebalancePlan(JANELA);
    return plano.rows.filter((r) => r.productId === productId);
  };

  beforeAll(async () => {
    const lojas = await prisma.store.findMany({
      where: PLANNED_STORE_WHERE,
      orderBy: { name: 'asc' },
      take: 2,
    });
    if (lojas.length < 2) throw new Error('sem lojas suficientes no banco (rode o seed)');
    destinoId = lojas[0].id;
    origemId = lojas[1].id;

    // ── Cenário 1: peça madura, parada na origem, vendendo no destino ──
    const parado = await prisma.product.create({
      data: {
        externalId: `test-reb-parado-${Date.now()}`,
        description: 'ARMACAO TESTE REMANEJAMENTO PARADA',
        category: 'ARMACOES',
        price: 300,
        cost: 150,
        includedAt: atras(400),
      },
    });
    paradoId = parado.id;
    await prisma.stockItem.create({
      data: {
        storeId: origemId,
        productId: paradoId,
        quantity: 18,
        available: 18,
        reserved: 0,
        createdAt: atras(400),
      },
    });
    // Destino sem posição e com 30 un. vendidas na janela: 0,333/dia, alvo 20.
    const v1 = await prisma.sale.create({
      data: {
        externalId: `test-reb-venda-parada-${Date.now()}`,
        storeId: destinoId,
        saleDate: atras(5),
        total: 9000,
        items: { create: { productId: paradoId, quantity: 30, unitPrice: 300, total: 9000 } },
      },
    });
    vendas.push(v1.id);

    // ── Cenário 2: peça que chegou há 10 dias nas DUAS lojas, mas com a
    // posição da origem carimbada como antiga (é o que a rede tem quando a
    // peça já rodava e só agora entrou nesta filial). ──
    const recem = await prisma.product.create({
      data: {
        externalId: `test-reb-recem-${Date.now()}`,
        description: 'ARMACAO TESTE REMANEJAMENTO RECEM CHEGADA',
        category: 'ARMACOES',
        price: 300,
        cost: 150,
        includedAt: atras(10),
      },
    });
    recemChegadoId = recem.id;
    await prisma.stockItem.create({
      data: {
        storeId: origemId,
        productId: recemChegadoId,
        quantity: 30,
        available: 30,
        reserved: 0,
        createdAt: atras(400),
      },
    });
    await prisma.stockItem.create({
      data: {
        storeId: destinoId,
        productId: recemChegadoId,
        quantity: 1,
        available: 1,
        reserved: 0,
        createdAt: atras(10),
      },
    });
    const v2 = await prisma.sale.create({
      data: {
        externalId: `test-reb-venda-recem-${Date.now()}`,
        storeId: destinoId,
        saleDate: atras(3),
        total: 600,
        items: { create: { productId: recemChegadoId, quantity: 2, unitPrice: 300, total: 600 } },
      },
    });
    vendas.push(v2.id);
  });

  afterAll(async () => {
    const ids = [paradoId, recemChegadoId].filter(Boolean);
    if (ids.length === 0) return;
    await prisma.inventoryMovement.deleteMany({ where: { productId: { in: ids } } });
    await prisma.sale.deleteMany({ where: { id: { in: vendas } } }); // itens caem por cascade
    await prisma.stockItem.deleteMany({ where: { productId: { in: ids } } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
  });

  it('a origem doa o que sobra e fica com o piso de vitrine — nunca com zero', async () => {
    const linhas = await linhasDe(paradoId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].fromStoreId).toBe(origemId);
    expect(linhas[0].toStoreId).toBe(destinoId);
    // Necessidade do destino é 20 (0,333/dia × 60), a origem tem 18 e guarda 1.
    expect(linhas[0].quantity).toBe(17);
    expect(linhas[0].fromRemainingUnits).toBe(DEFAULT_PLANNING_CONFIG.donorFloorUnits);
  });

  it('posição criada hoje e sem data de catálogo entra em carência', async () => {
    // Isola `StockItem.createdAt`: sem `includedAt` ele é a única evidência de
    // idade, e a peça passa a ser recém-chegada.
    await prisma.product.update({ where: { id: paradoId }, data: { includedAt: null } });
    await prisma.stockItem.updateMany({
      where: { storeId: origemId, productId: paradoId },
      data: { createdAt: new Date() },
    });
    expect(await linhasDe(paradoId)).toHaveLength(0);

    // E com a MESMA posição nova, mas catálogo antigo, a peça volta a doar: a
    // idade é min(posição, catálogo), e isso é fail-open de propósito — é o
    // caso da peça que zerou e voltou, e ganhou carimbo novo por causa disso.
    await prisma.product.update({ where: { id: paradoId }, data: { includedAt: atras(400) } });
    expect(await linhasDe(paradoId)).toHaveLength(1);

    await prisma.stockItem.updateMany({
      where: { storeId: origemId, productId: paradoId },
      data: { createdAt: atras(400) },
    });
  });

  it('unidade reservada para outra transferência não é oferecida de novo', async () => {
    await prisma.stockItem.updateMany({
      where: { storeId: origemId, productId: paradoId },
      data: { reserved: 16 },
    });
    // Livre = 18 − 16 = 2; o piso come 1; sobra 1 para doar.
    const parcial = await linhasDe(paradoId);
    expect(parcial).toHaveLength(1);
    expect(parcial[0].quantity).toBe(1);

    await prisma.stockItem.updateMany({
      where: { storeId: origemId, productId: paradoId },
      data: { reserved: 18 },
    });
    expect(await linhasDe(paradoId)).toHaveLength(0);

    await prisma.stockItem.updateMany({
      where: { storeId: origemId, productId: paradoId },
      data: { reserved: 0 },
    });
  });

  /**
   * A versão anterior deste teste afirmava o CONTRÁRIO da segunda metade: que,
   * confirmada a transferência, a peça "deixa de ser a caminho e a necessidade
   * reaparece" — e prendia isso como acerto.
   *
   * Era o defeito escrito como contrato. Confirmada, a peça JÁ saiu da origem
   * e JÁ chegou no destino; o que não aconteceu foi a sync reconciliar o
   * `StockItem`, que só é reescrito no próximo run (`reconcileMovements` só
   * fecha o que tem `confirmedAt` antes do corte). Nessa janela o plano lia a
   * quantidade velha na origem, o `reserved` de volta a zero e o inbound
   * zerado no destino: os dois lados revertiam juntos e a rodada seguinte
   * reemitia a MESMA sugestão. Pior, o segundo clique era aceito, porque
   * `availableAt` já descontava a saída confirmada — a origem mandava a
   * remessa duas vezes seguindo a sugestão do próprio sistema.
   *
   * O certo é o motor enxergar o mesmo saldo ao vivo que a tela de estoque e a
   * validação de saldo enxergam (`liveDeltas`/`computeLiveStock`).
   */
  it('transferência confirmada some do plano em vez de ser sugerida de novo', async () => {
    const mov = await prisma.inventoryMovement.create({
      data: {
        type: 'TRANSFER',
        status: 'PENDING',
        productId: paradoId,
        fromStoreId: origemId,
        toStoreId: destinoId,
        quantity: 20, // cobre a necessidade inteira
        reason: 'teste de unidades a caminho',
      },
    });
    expect(await linhasDe(paradoId)).toHaveLength(0);

    // Confirmada, a peça saiu da origem e chegou no destino: a necessidade do
    // destino está atendida de verdade e a origem não tem mais o que doar.
    // Reaparecer aqui é o duplo envio.
    await prisma.inventoryMovement.update({
      where: { id: mov.id },
      data: { status: 'CONFIRMED' },
    });
    expect(await linhasDe(paradoId)).toHaveLength(0);

    // Isola a metade do DESTINO. Acima a origem ficou sem saldo para doar, o
    // que sozinho já zeraria o plano; com 40 un. na origem ela volta a ser
    // doadora e o que segura a sugestão passa a ser só o fato de as 20 un. já
    // terem CHEGADO no destino — que nem tem linha de StockItem para elas.
    await prisma.stockItem.updateMany({
      where: { storeId: origemId, productId: paradoId },
      data: { quantity: 40, available: 40 },
    });
    expect(await linhasDe(paradoId)).toHaveLength(0);

    // E depois da sync reconciliar (o `StockItem` já reflete a movimentação),
    // ela para de valer como delta — senão o desconto seria aplicado duas
    // vezes, uma pela quantidade sincronizada e outra pelo histórico.
    await prisma.inventoryMovement.update({
      where: { id: mov.id },
      data: { status: 'RECONCILED', reconciledAt: new Date() },
    });
    const depoisDaSync = await linhasDe(paradoId);
    expect(depoisDaSync).toHaveLength(1);
    expect(depoisDaSync[0].quantity).toBe(20);

    await prisma.stockItem.updateMany({
      where: { storeId: origemId, productId: paradoId },
      data: { quantity: 18, available: 18 },
    });
    await prisma.inventoryMovement.delete({ where: { id: mov.id } });
  });

  /**
   * Transferência criada por gestor de loja nasce REQUESTED e só vira PENDING
   * quando o ADMIN aprova (`decideInitialStatus`). Nesse intervalo ela não
   * aparece no `StockItem.reserved` — `recomputeReserved` só soma PENDING —
   * nem contava como unidade a caminho. O plano é uma tela de ADMIN: ele
   * reemitia a sugestão idêntica e passavam a existir duas ordens para as
   * mesmas unidades, a que a loja pediu e a que o plano criou.
   */
  it('transferência ainda em aprovação já conta como reserva e como a caminho', async () => {
    const terceira = await prisma.store.findFirst({
      where: { ...PLANNED_STORE_WHERE, id: { notIn: [origemId, destinoId] } },
      orderBy: { name: 'asc' },
    });
    if (!terceira) throw new Error('sem terceira loja no banco (rode o seed)');

    // Solicitada para uma TERCEIRA loja: não abate a necessidade do destino,
    // só compromete unidades na origem. Livre = 18 − 12 = 6, o piso come 1.
    const solicitada = await prisma.inventoryMovement.create({
      data: {
        type: 'TRANSFER',
        status: 'REQUESTED',
        productId: paradoId,
        fromStoreId: origemId,
        toStoreId: terceira.id,
        quantity: 12,
        reason: 'teste de solicitação da loja',
      },
    });
    const comSolicitacao = await linhasDe(paradoId);
    expect(comSolicitacao).toHaveLength(1);
    expect(comSolicitacao[0].toStoreId).toBe(destinoId);
    expect(comSolicitacao[0].quantity).toBe(5);
    expect(comSolicitacao[0].fromRemainingUnits).toBe(1);

    // Redirecionada para o próprio destino, ela vira unidade a caminho DELE e
    // cobre a necessidade inteira: nada mais a sugerir.
    await prisma.inventoryMovement.update({
      where: { id: solicitada.id },
      data: { toStoreId: destinoId, quantity: 20 },
    });
    expect(await linhasDe(paradoId)).toHaveLength(0);

    await prisma.inventoryMovement.delete({ where: { id: solicitada.id } });
  });

  it('a demanda do destino sai dos dias de presença da peça, não da janela', async () => {
    // Destino tem 1 un. e vendeu 2 em 10 dias de presença: 0,2/dia, cobertura
    // de 5 dias — está acabando e precisa de 11 un. para os 60 dias de alvo.
    const linhas = await linhasDe(recemChegadoId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].toStoreId).toBe(destinoId);
    expect(linhas[0].quantity).toBe(11);
    expect(linhas[0].toCoverageDays).toBe(5);

    // Medida pela janela inteira, a mesma peça "vende" 2/90 = 0,022/dia e a
    // cobertura vira 45 dias: acima do mínimo, e a loja que está acabando não
    // recebe nada. Era exatamente este o buraco.
    await prisma.stockItem.updateMany({
      where: { storeId: destinoId, productId: recemChegadoId },
      data: { createdAt: atras(400) },
    });
    expect(await linhasDe(recemChegadoId)).toHaveLength(0);

    await prisma.stockItem.updateMany({
      where: { storeId: destinoId, productId: recemChegadoId },
      data: { createdAt: atras(10) },
    });
  });
});

/**
 * As duas frestas que a reverificação achou DEPOIS de a frente ser liberada.
 *
 * As duas nascem do mesmo lugar: o remanejamento passou a enxergar o estoque ao
 * vivo e a contar a solicitação pendente, e duas coisas ao redor não
 * acompanharam a mudança.
 */
d('remanejamento · as duas frestas do saldo', () => {
  let lojaId = '';
  let outraId = '';
  let produtoId = '';

  beforeAll(async () => {
    const lojas = await prisma.store.findMany({
      where: PLANNED_STORE_WHERE,
      orderBy: { name: 'asc' },
      take: 2,
    });
    if (lojas.length < 2) throw new Error('sem lojas suficientes (rode o seed)');
    lojaId = lojas[0].id;
    outraId = lojas[1].id;

    const p = await prisma.product.create({
      data: { externalId: `fresta-${Date.now()}`, description: 'ARMACAO TESTE FRESTA', category: 'ARMACAO' },
    });
    produtoId = p.id;
    await prisma.stockItem.create({
      data: { storeId: lojaId, productId: produtoId, quantity: 12, reserved: 0, available: 12 },
    });
  });

  afterAll(async () => {
    await prisma.inventoryMovement.deleteMany({ where: { productId: produtoId } });
    await prisma.stockItem.deleteMany({ where: { productId: produtoId } });
    await prisma.product.deleteMany({ where: { id: produtoId } });
  });

  it('a SOLICITAÇÃO do gestor também confere saldo', async () => {
    // Antes: `createMovement` só validava saldo quando a movimentação já ia
    // reservar, e toda transferência de gestor de loja nasce REQUESTED. Uma
    // solicitação de 1.000 unidades numa loja de 12 era aceita sem erro — e,
    // como o plano passou a contá-la como saldo comprometido, ela APAGAVA o par
    // (produto, loja) do plano da rede inteira até alguém aprovar ou rejeitar.
    const { createMovement } = await import('../src/modules/movements/movements.service.js');
    const gestor = { id: 'teste-gestor', role: 'STORE_MANAGER' as const, storeId: lojaId };

    await expect(
      createMovement(
        { type: 'TRANSFER', productId: produtoId, fromStoreId: lojaId, toStoreId: outraId, quantity: 1000, confirm: false },
        gestor,
      ),
    ).rejects.toThrow(/Saldo insuficiente/);

    // E o caminho legítimo continua aberto — a trava é sobre a quantidade, não
    // sobre o papel de quem pede.
    const ok = await createMovement(
      { type: 'TRANSFER', productId: produtoId, fromStoreId: lojaId, toStoreId: outraId, quantity: 3, confirm: false },
      gestor,
    );
    expect(ok.status).toBe('REQUESTED');
    await prisma.inventoryMovement.delete({ where: { id: ok.id } });
  });

  it('a aba de COMPRAS e a de REMANEJAMENTO leem o mesmo estoque', async () => {
    // `rebalancePlan` compunha o saldo ao vivo; `planningInputs` — que alimenta
    // compra, sugestões, pedidos e panorama — somava o `quantity` cru da última
    // sincronização. Na janela entre confirmar uma transferência e a sync
    // seguinte fechá-la, as duas abas da MESMA tela diziam números diferentes
    // para a mesma posição.
    const { planningInputs } = await import('../src/modules/planning/planning.service.js');
    const { computeLiveStock, liveDeltas } = await import('../src/modules/stock/stock.service.js');

    const daCompra = async () =>
      (await planningInputs(JANELA)).find((i) => i.productId === produtoId)?.currentStock ?? null;
    const doEstoque = async () => {
      const pos = await prisma.stockItem.findFirstOrThrow({
        where: { storeId: lojaId, productId: produtoId },
      });
      const d = await liveDeltas([produtoId]);
      return computeLiveStock(pos.quantity, pos.reserved, d.get(`${lojaId}:${produtoId}`) ?? 0).onHand;
    };

    expect(await daCompra()).toBe(12);
    expect(await doEstoque()).toBe(12);

    // Quatro unidades já saíram da loja (confirmadas), e a sincronização ainda
    // não fechou a conta.
    await prisma.inventoryMovement.create({
      data: {
        type: 'TRANSFER',
        status: 'CONFIRMED',
        productId: produtoId,
        fromStoreId: lojaId,
        toStoreId: outraId,
        quantity: 4,
        confirmedAt: new Date(),
      },
    });

    // Antes do conserto: a compra dizia 12 e o estoque dizia 8.
    expect(await doEstoque()).toBe(8);
    expect(await daCompra()).toBe(8);
  });
});
