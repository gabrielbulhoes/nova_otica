import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { subscribe, type AppEvent } from '../src/lib/eventBus.js';
import { analysisBrand, normBrandKey } from '../src/modules/planning/planning.math.js';
import {
  discontinuedBrandResolver,
  listBrandMix,
  listSupplierSettings,
  planningInputs,
  setBrandMix,
  setSupplierSetting,
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
  let antes: { brand: string; discontinued: boolean }[] = [];

  const ORFA = 'GRIFE QUE NAO EXISTE ZZZ';
  /**
   * Só as chaves que esta suíte escreve.
   *
   * O que estava aqui era `deleteMany({})` — cinco vezes, mais uma no
   * `afterAll`. Contra o banco de desenvolvimento de quem roda a suíte, isso
   * apaga TODA marcação de fora-do-mix que a rede tenha feito, sem aviso e sem
   * volta. Um teste não tem licença para apagar o dado de quem o roda.
   */
  const limpar = async () => {
    const chaves = new Set([normBrandKey(grife), ORFA]);
    if (fornecedor) chaves.add(normBrandKey(fornecedor));
    // O casamento é pela chave NORMALIZADA, calculada aqui e não no `where`:
    // uma linha gravada em forma literal (o defeito que estes testes prendem,
    // ou uma escrita à mão pelo psql) não sai por igualdade de string, e
    // sobreviveria à limpeza para envenenar a execução seguinte. Foi o que
    // aconteceu comigo: a rodada que provou o vermelho deixou uma linha em
    // minúscula, e a rodada verde seguinte falhou por causa dela.
    const todas = await prisma.brandMix.findMany({ select: { brand: true } });
    const alvos = todas.map((r) => r.brand).filter((b) => chaves.has(normBrandKey(b)));
    if (alvos.length) await prisma.brandMix.deleteMany({ where: { brand: { in: alvos } } });
  };

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

    antes = await prisma.brandMix.findMany({ select: { brand: true, discontinued: true } });
    await limpar();
  });

  afterAll(async () => {
    // Volta ao estado exato de antes: apaga o que a suíte escreveu e recoloca
    // o que ela por acaso tenha sobrescrito.
    await limpar();
    for (const r of antes) {
      await prisma.brandMix.upsert({
        where: { brand: r.brand },
        create: { brand: r.brand, discontinued: r.discontinued },
        update: { discontinued: r.discontinued },
      });
    }
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
    await limpar();
    if (fornecedor === null || fornecedor === '—') return; // nada a provar

    await setBrandMix(fornecedor, true);
    const foraDoMix = await discontinuedBrandResolver();
    // A razão social não é a grife. Enquanto a tela oferecia SÓ esta chave, o
    // cliente marcava e nada acontecia — e nada no sistema dizia isso.
    expect(foraDoMix(grife)).toBe(false);
  });

  it('desmarcar apaga a linha em vez de guardar `false`', async () => {
    await limpar();
    const daGrife = () => prisma.brandMix.count({ where: { brand: normBrandKey(grife) } });
    await setBrandMix(grife, true);
    expect(await daGrife()).toBe(1);
    await setBrandMix(grife, false);
    expect(await daGrife()).toBe(0);
  });

  it('desmarcar funciona com OUTRA forma do mesmo nome', async () => {
    // A escrita gravava a string literal da tela; a leitura sempre comparou
    // normalizada. Marcar como "Dolce & Gabbana" e desmarcar como
    // "DOLCE & GABBANA" apagava zero linhas — sem erro, porque `deleteMany`
    // que não encontra nada é operação válida. A tela dizia que desmarcou e o
    // motor continuava cortando a grife da compra.
    await limpar();
    await setBrandMix(grife.toLowerCase(), true);
    expect(await discontinuedBrandResolver().then((f) => f(grife))).toBe(true);

    await setBrandMix(grife.toUpperCase(), false);
    expect(await prisma.brandMix.count({ where: { brand: normBrandKey(grife) } })).toBe(0);
    expect(await discontinuedBrandResolver().then((f) => f(grife))).toBe(false);
  });

  it('marcar duas formas do mesmo nome não cria duas linhas', async () => {
    await limpar();
    await setBrandMix(grife.toLowerCase(), true);
    await setBrandMix(grife.toUpperCase(), true);
    // Contando pela chave NORMALIZADA, e não por igualdade de string: com a
    // gravação literal ficavam duas linhas distintas que colapsam na mesma
    // grife, e um `count` por string exata veria uma só — passando sem ver o
    // defeito. `brand` é único sobre a string literal, então nem o banco
    // reclamava.
    const todas = await prisma.brandMix.findMany({ select: { brand: true } });
    const daGrife = todas.filter((r) => normBrandKey(r.brand) === normBrandKey(grife));
    expect(daGrife.length).toBe(1);
    // E desmarcar por qualquer forma limpa de verdade.
    await setBrandMix(grife, false);
    const sobrou = (await prisma.brandMix.findMany({ select: { brand: true } })).filter(
      (r) => normBrandKey(r.brand) === normBrandKey(grife),
    );
    expect(sobrou.length).toBe(0);
  });

  it('marcação órfã continua visível, com o aviso de que não casa com nada', async () => {
    // O caso da grife digitada errada, ou que saiu do catálogo. Se a linha
    // sumisse da tela, a marcação continuaria valendo no banco sem ninguém
    // conseguir desfazê-la.
    await limpar();
    await setBrandMix(ORFA, true);
    const { rows } = await listBrandMix();
    const orfa = rows.find((r) => r.brand === ORFA);
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

  /**
   * OS DOIS PARÂMETROS QUE A OPERAÇÃO EDITA À MÃO — E QUE NÃO AVISAVAM NINGUÉM.
   *
   * Tudo o mais que muda card publica evento: movimentação, sync, pedido,
   * decisão. Estes dois, não. Marcar uma grife como fora do mix muda a compra
   * sugerida da rede inteira, e nenhuma tela ficava sabendo — nem a de outro
   * ADMIN com a mesma aba aberta, nem a Central de Decisões — até alguém
   * recarregar a página.
   *
   * Passou despercebido porque o efeito É visível para quem clicou: a mutação
   * invalida a própria consulta ali mesmo. O buraco só aparece com duas pessoas
   * (que é a operação real: uma na compra, outra no mix) — e vai importar mais
   * quando o quadro for guardado, porque aí o card errado sobrevive.
   */
  const anunciados = async (acao: () => Promise<unknown>) => {
    const vistos: Extract<AppEvent, { type: 'planning.settings.changed' }>[] = [];
    const parar = subscribe((e) => {
      if (e.type === 'planning.settings.changed') vistos.push(e);
    });
    try {
      await acao();
      return vistos;
    } finally {
      parar();
    }
  };

  it('marcar e desmarcar grife ANUNCIAM', async () => {
    await limpar();
    const aoMarcar = await anunciados(() => setBrandMix(grife, true));
    expect(aoMarcar).toHaveLength(1);
    expect(aoMarcar[0]).toMatchObject({ setting: 'brand-mix', brand: normBrandKey(grife) });

    const aoDesmarcar = await anunciados(() => setBrandMix(grife, false));
    expect(aoDesmarcar).toHaveLength(1);
    expect(aoDesmarcar[0]).toMatchObject({ setting: 'brand-mix' });
  });

  it('mudar e zerar prazo de fornecedor ANUNCIAM', async () => {
    // Marca própria: `setSupplierSetting(_, null)` APAGA a linha, então mexer
    // num fornecedor de verdade do banco de quem roda a suíte destruiria o
    // prazo configurado pela rede.
    const FORNECEDOR = 'FORNECEDOR TESTE ZZZ';
    expect(
      await prisma.supplierSetting.count({ where: { brand: FORNECEDOR } }),
      'o fornecedor de teste não pode existir de verdade',
    ).toBe(0);

    const aoDefinir = await anunciados(() => setSupplierSetting(FORNECEDOR, 45));
    expect(aoDefinir).toHaveLength(1);
    expect(aoDefinir[0]).toMatchObject({ setting: 'supplier', brand: FORNECEDOR });

    const aoZerar = await anunciados(() => setSupplierSetting(FORNECEDOR, null));
    expect(aoZerar).toHaveLength(1);
    expect(await prisma.supplierSetting.count({ where: { brand: FORNECEDOR } })).toBe(0);
  });
});
