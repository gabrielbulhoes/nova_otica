import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANNING_CONFIG, buildRebalance, type StoreProductInput } from '../src/modules/planning/planning.math.js';

/**
 * UMA conta de estoque só.
 *
 * A revisão geral apontou duas metades do mesmo problema, e as duas passavam
 * por baixo da suíte inteira:
 *
 *  · o motor descontava `reserved` na DOADORA ("está na prateleira mas já tem
 *    dono") e não descontava na RECEPTORA. A mesma unidade tinha dois papéis
 *    contraditórios na mesma rodada — saía daqui E contava como cobertura
 *    daqui;
 *  · o rateio da aba de compras e o plano de distribuição do recebimento liam
 *    `StockItem.quantity` cru, enquanto a aba de Estoque e o remanejamento
 *    liam o saldo ao vivo. Duas telas, mesma peça, mesma loja, dois números.
 *
 * Este arquivo prende a primeira metade, que é aritmética pura. A segunda mora
 * em `rateioCompras.db.test.ts`, porque só se enxerga com banco.
 */

const CFG = DEFAULT_PLANNING_CONFIG;
const DIAS = 90;

/** minCover = 14 + 7 = 21 dias; alvo = 60 dias. */
const linha = (over: Partial<StoreProductInput> & Pick<StoreProductInput, 'storeId' | 'storeName'>): StoreProductInput => ({
  productId: 'p1',
  description: 'AN4290 ABAG 55 OCULOS ARNETTE',
  brand: 'LUXOTTICA',
  category: 'OCULOS',
  unitsSold: 0,
  currentStock: 0,
  ...over,
});

describe('cobertura se mede em unidades vendáveis — dos dois lados', () => {
  /**
   * A loja MIDWAY tem 30 peças na prateleira e 20 já reservadas para sair.
   * Vendáveis: 10. Com 1 un./dia, isso é cobertura de 10 dias — metade do
   * mínimo (21) e um sexto do alvo (60).
   *
   * Pelo físico, ela parecia coberta por 30 dias e era filtrada fora da lista
   * de quem precisa. Ficava com 10 peças e sem sugestão nenhuma.
   */
  const midwayApertada = linha({
    storeId: 'midway',
    storeName: 'A GRACIOSA — MIDWAY',
    unitsSold: 90, // 1 un./dia na janela de 90
    currentStock: 30,
    reserved: 20,
  });
  const guarabiraParada = linha({
    storeId: 'guarabira',
    storeName: 'A GRACIOSA — GUARABIRA',
    unitsSold: 0,
    currentStock: 100,
    ageDays: 999,
  });

  it('a loja com estoque reservado É oferecida — o físico escondia a falta', () => {
    const plan = buildRebalance([midwayApertada, guarabiraParada], DIAS, () => CFG);
    const paraMidway = plan.rows.filter((s) => s.toStoreId === 'midway');

    expect(paraMidway.length).toBe(1);
    // Alvo 60 un. menos as 10 vendáveis = 50. Pelo físico dariam 30 — e nem
    // isso, porque com cobertura 30 ela nem entrava na lista.
    expect(paraMidway[0].quantity).toBe(50);
    expect(paraMidway[0].fromStoreId).toBe('guarabira');
  });

  it('a cobertura anunciada é a vendável, não a física', () => {
    const plan = buildRebalance([midwayApertada, guarabiraParada], DIAS, () => CFG);
    // 10 vendáveis ÷ 1 un./dia = 10 dias. O número que a tela mostra tem de ser
    // o mesmo que motivou a sugestão, senão a linha se contradiz sozinha.
    expect(plan.rows[0].toCoverageDays).toBe(10);
  });

  it('sem reserva, nada muda — a mudança não mexe em quem não tem peça comprometida', () => {
    const semReserva = linha({ ...midwayApertada, currentStock: 10, reserved: 0 });
    const plan = buildRebalance([semReserva, guarabiraParada], DIAS, () => CFG);
    expect(plan.rows[0]?.quantity).toBe(50);
    expect(plan.rows[0]?.toCoverageDays).toBe(10);
  });

  it('uma venda em três dias não vira vinte unidades remanejadas', () => {
    // A correção que mede a demanda pelos DIAS DE PRESENÇA da peça — certa, e
    // que resolveu uma queixa real — vinha com piso de 1 dia, o mínimo para
    // não dividir por zero. Isso a transformava numa máquina de extrapolar:
    //
    //   1 venda ÷ 3 dias = 0,33/dia  →  alvo de 60 dias = 20 unidades
    //
    // A rede inteira remanejada por causa de uma venda, e o número subindo
    // quanto MENOS evidência houvesse. Com o piso de observação de 14 dias, a
    // mesma peça lê 1/14 = 0,07/dia e pede 5: uma aposta do tamanho do dado.
    const novaComUmaVenda = linha({
      storeId: 'midway',
      storeName: 'A GRACIOSA — MIDWAY',
      unitsSold: 1,
      currentStock: 0,
      ageDays: 3,
    });
    const plan = buildRebalance([novaComUmaVenda, guarabiraParada], DIAS, () => CFG);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].quantity).toBe(5); // ceil(1/14 × 60) − 0
  });

  it('peça madura não é afetada pelo piso de observação', () => {
    // Guarda de não-regressão: o piso só levanta janelas CURTAS. Uma peça de
    // 90 dias com 90 vendas continua lendo 1/dia.
    const madura = linha({
      storeId: 'midway',
      storeName: 'A GRACIOSA — MIDWAY',
      unitsSold: 90,
      currentStock: 0,
      ageDays: 90,
    });
    const plan = buildRebalance([madura, guarabiraParada], DIAS, () => CFG);
    expect(plan.rows[0]?.quantity).toBe(60); // 1/dia × alvo de 60
  });

  it('a doadora continua descontando o reservado, como já descontava', () => {
    // Guarda de regressão da metade que já estava certa: 100 na prateleira, 95
    // reservadas, piso de vitrine de 1 → doa no máximo 4.
    const doadoraComprometida = linha({
      ...guarabiraParada,
      currentStock: 100,
      reserved: 95,
    });
    const plan = buildRebalance([midwayApertada, doadoraComprometida], DIAS, () => CFG);
    expect(plan.rows[0]?.quantity).toBe(4);
    // E o piso anunciado na tela é o vendável que sobra, não o físico.
    expect(plan.rows[0]?.fromRemainingUnits).toBe(1);
  });
});
