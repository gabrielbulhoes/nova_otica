import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { stockAlerts } from '../src/modules/alerts/alerts.service.js';
import { PLANNED_STORE_WHERE } from '../src/modules/stores/store.scope.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * O painel de ruptura contra o banco.
 *
 * Três defeitos vieram juntos nesta tela, e os três só aparecem aqui:
 *
 *  1. Alertava sobre TODA posição zerada, inclusive peça que a loja nunca
 *     trabalhou — 1,1 milhão de posições em produção, quase todas assim.
 *  2. Trazia 100.000 linhas `ORDER BY product.description` e CONTAVA sobre
 *     elas: o número da tela era sobre uma fatia alfabética do catálogo,
 *     apresentado como se fosse a rede inteira.
 *  3. O corte não era declarado em lugar nenhum.
 *
 * Os testes de unidade cobriam `resolveThreshold` e nada mais — a função que
 * decide o que é alerta nunca tinha sido exercida ponta a ponta.
 */
d('alertas de ruptura · a guarda e a contagem', () => {
  let lojaId = '';
  let pecaTrabalhada = '';
  let pecaEstranha = '';
  const criados: string[] = [];

  beforeAll(async () => {
    const loja = await prisma.store.findFirstOrThrow({ where: PLANNED_STORE_WHERE });
    lojaId = loja.id;

    // Duas peças NOVAS, para o teste não depender do humor do seed.
    const a = await prisma.product.create({
      data: { externalId: `t-alerta-trab-${Date.now()}`, description: 'ARMACAO TESTE TRABALHADA', category: 'ARMACAO' },
    });
    const b = await prisma.product.create({
      data: { externalId: `t-alerta-estr-${Date.now()}`, description: 'ARMACAO TESTE ESTRANHA', category: 'ARMACAO' },
    });
    pecaTrabalhada = a.id;
    pecaEstranha = b.id;
    criados.push(a.id, b.id);

    // A peça TRABALHADA: saldo zero na loja, mas com venda recente. É a
    // ruptura de verdade — vendeu a última unidade e zerou.
    await prisma.stockItem.create({
      data: { storeId: lojaId, productId: pecaTrabalhada, quantity: 0, available: 0 },
    });
    const venda = await prisma.sale.create({
      data: { externalId: `t-alerta-venda-${Date.now()}`, storeId: lojaId, saleDate: new Date(), total: 100 },
    });
    await prisma.saleItem.create({
      data: { saleId: venda.id, productId: pecaTrabalhada, quantity: 1, unitPrice: 100, total: 100 },
    });

    // A peça ESTRANHA: saldo zero e NENHUMA venda. É o caso das centenas de
    // milhares de posições que o CDS devolve para peças que a filial não
    // carrega — e que a tela apresentava como "em falta".
    await prisma.stockItem.create({
      data: { storeId: lojaId, productId: pecaEstranha, quantity: 0, available: 0 },
    });
  });

  afterAll(async () => {
    await prisma.saleItem.deleteMany({ where: { productId: { in: criados } } });
    await prisma.sale.deleteMany({ where: { externalId: { startsWith: 't-alerta-venda-' } } });
    await prisma.stockItem.deleteMany({ where: { productId: { in: criados } } });
    await prisma.product.deleteMany({ where: { id: { in: criados } } });
  });

  it('a peça que a loja VENDEU e zerou entra como falta', async () => {
    const r = await stockAlerts(lojaId);
    const linha = r.rows.find((x) => x.productId === pecaTrabalhada);
    expect(linha, 'a ruptura de verdade sumiu do painel').toBeTruthy();
    expect(linha!.level).toBe('OUT');
    expect(linha!.availableNow).toBe(0);
  });

  it('a peça que a loja NUNCA trabalhou não entra', async () => {
    const r = await stockAlerts(lojaId);
    expect(r.rows.some((x) => x.productId === pecaEstranha)).toBe(false);
  });

  it('os contadores fecham entre si e com a lista', async () => {
    const r = await stockAlerts(lojaId);
    // A invariante que a tela usa: os dois cartões somam o total.
    expect(r.out + r.low).toBe(r.total);
    // OUT e LOW são exclusivos e exaustivos sobre as linhas mostradas.
    for (const linha of r.rows) {
      expect(linha.level).toBe(linha.availableNow <= 0 ? 'OUT' : 'LOW');
      expect(linha.availableNow).toBeLessThanOrEqual(linha.threshold);
    }
  });

  it('a CONTAGEM não é cortada, só a lista — e o corte é declarado', async () => {
    // É o defeito nº 2, e o mais grave dos três: o número da tela precisa ser
    // da seleção inteira mesmo quando a lista não cabe. `truncado` existe para
    // que a tela nunca mais apresente uma fatia como se fosse o todo.
    const r = await stockAlerts(lojaId);
    expect(r.rows.length).toBeLessThanOrEqual(r.limite);
    expect(r.total).toBeGreaterThanOrEqual(r.rows.length);
    expect(r.truncado).toBe(r.total > r.rows.length);
  });

  it('a lista vem da mais crítica para a menos', async () => {
    // O corte é por URGÊNCIA. Antes era alfabético — então as 100 mil linhas
    // trazidas não eram sequer as piores, eram as que começavam com A.
    const r = await stockAlerts(lojaId);
    for (let i = 1; i < r.rows.length; i += 1) {
      expect(r.rows[i - 1].availableNow).toBeLessThanOrEqual(r.rows[i].availableNow);
    }
  });

  it('`examinadas` diz o tamanho do universo real, e ele é menor que o banco', async () => {
    // O número que faltava para responder "esses alertas estão certos?".
    // Sem ele, não havia como distinguir "a rede está em ruptura" de "a
    // consulta está contando o catálogo inteiro".
    const r = await stockAlerts(lojaId);
    const posicoesNoBanco = await prisma.stockItem.count({ where: { storeId: lojaId } });
    expect(r.examinadas).toBeLessThanOrEqual(posicoesNoBanco);
    expect(r.total).toBeLessThanOrEqual(r.examinadas);
  });
});
