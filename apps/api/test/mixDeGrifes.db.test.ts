import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { analysisBrand, normBrandKey } from '../src/modules/planning/planning.math.js';
import {
  discontinuedBrandResolver,
  listBrandMix,
  listSupplierSettings,
  planningInputs,
  setBrandMix,
} from '../src/modules/planning/planning.service.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * Feedback 6.0 · item 03 — "fora do mix" — e o defeito que ele carregava.
 *
 * A marcação sempre funcionou no motor. O que não funcionava era CHEGAR nela:
 * a tela oferecia as linhas de `Product.brand`, que no CDS é o FORNECEDOR
 * ("LUXOTTICA BRASIL PRODUTOS OTICOS E ESPORTIVOS LTDA"), enquanto o motor
 * procura por `analysisBrand`, a GRIFE da descrição ("ARNETTE"). Dois espaços
 * de nome, uma tabela só, e nenhum teste no meio — porque os testes de
 * unidade montavam catálogo literal e nunca encostavam nas duas pontas ao
 * mesmo tempo.
 *
 * Este arquivo encosta. É o único lugar do repositório onde a chave gravada
 * pela tela e a chave lida pelo motor precisam ser a mesma coisa.
 */
d('mix de grifes · a chave gravada é a chave lida', () => {
  let grife = '';
  let fornecedor: string | null = null;
  let productId = '';

  beforeAll(async () => {
    // Um produto de MODA de verdade do banco, em que a grife extraída da
    // descrição é diferente do fornecedor. É esse o caso que estava quebrado;
    // testar com lente daria verde por acidente (lente não tem grife, e
    // `analysisBrand` cai no fornecedor — as duas chaves coincidem).
    const candidatos = await prisma.product.findMany({
      select: { id: true, description: true, category: true, brand: true },
      take: 4000,
    });
    const alvo = candidatos.find((p) => {
      const g = analysisBrand(p.description, p.category, p.brand);
      return g !== null && (p.brand === null || normBrandKey(g) !== normBrandKey(p.brand));
    });
    if (!alvo) throw new Error('nenhum produto de moda com grife distinta do fornecedor (rode o seed)');
    productId = alvo.id;
    fornecedor = alvo.brand;
    grife = analysisBrand(alvo.description, alvo.category, alvo.brand)!;
  });

  afterAll(async () => {
    await prisma.brandMix.deleteMany({});
  });

  it('a tela oferece a GRIFE, e ela tem produto atrás', async () => {
    const { rows } = await listBrandMix();
    const linha = rows.find((r) => normBrandKey(r.brand) === normBrandKey(grife));
    expect(linha, `a grife ${grife} precisa aparecer na lista de mix`).toBeDefined();
    expect(linha!.products).toBeGreaterThan(0);
    expect(linha!.discontinued).toBe(false);
  });

  it('marcar a grife chega ao motor', async () => {
    await setBrandMix(grife, true);
    const foraDoMix = await discontinuedBrandResolver();
    expect(foraDoMix(grife)).toBe(true);

    // E chega ao insumo que o motor consome de verdade, não só ao predicado.
    const inputs = await planningInputs(3650);
    const item = inputs.find((i) => i.productId === productId);
    expect(item, 'o produto precisa estar nos insumos de planejamento').toBeDefined();
    expect(item!.brandDiscontinued).toBe(true);
  });

  it('marcar o FORNECEDOR não afeta a grife — é o defeito que motivou a separação', async () => {
    await prisma.brandMix.deleteMany({});
    if (fornecedor === null || fornecedor === '—') return; // nada a provar

    await setBrandMix(fornecedor, true);
    const foraDoMix = await discontinuedBrandResolver();
    // A razão social não é a grife. Enquanto a tela oferecia SÓ esta chave, o
    // cliente marcava e nada acontecia — e nada no sistema dizia isso.
    expect(foraDoMix(grife)).toBe(false);
  });

  it('desmarcar apaga a linha em vez de guardar `false`', async () => {
    await prisma.brandMix.deleteMany({});
    await setBrandMix(grife, true);
    expect(await prisma.brandMix.count()).toBe(1);
    await setBrandMix(grife, false);
    expect(await prisma.brandMix.count()).toBe(0);
  });

  it('marcação órfã continua visível, com o aviso de que não casa com nada', async () => {
    // O caso da grife digitada errada, ou que saiu do catálogo. Se a linha
    // sumisse da tela, a marcação continuaria valendo no banco sem ninguém
    // conseguir desfazê-la.
    await prisma.brandMix.deleteMany({});
    await setBrandMix('GRIFE QUE NAO EXISTE ZZZ', true);
    const { rows } = await listBrandMix();
    const orfa = rows.find((r) => r.brand === 'GRIFE QUE NAO EXISTE ZZZ');
    expect(orfa).toBeDefined();
    expect(orfa!.products).toBe(0);
    expect(orfa!.discontinued).toBe(true);
  });

  it('a lista de prazos não fala de mix, e a de mix não fala de prazo', async () => {
    // As duas telas ficaram com escopos disjuntos de propósito. Este teste é o
    // que impede alguém de reintroduzir o campo por conveniência.
    const prazos = await listSupplierSettings();
    for (const r of prazos.rows) expect(r).not.toHaveProperty('discontinued');
    const mix = await listBrandMix();
    for (const r of mix.rows) expect(r).not.toHaveProperty('leadTimeDays');
  });
});
