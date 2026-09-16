import { describe, it, expect } from 'vitest';
import {
  analyzeProduct,
  buildPurchaseOrders,
  chaveDeAtributo,
  comporMixPorPerfil,
  faixaDePreco,
  filtrarPedidos,
  FORMATOS_DE_LENTE,
  MATERIAIS_DE_ARMACAO,
  NAO_IDENTIFICADO,
  normFormatoLente,
  normGenero,
  normMaterialArmacao,
  buildDecisionCards,
  passaNoFiltro,
  pesoDoCandidato,
  repartirComTeto,
  type AtributosDaPeca,
  type CandidatoDeCompra,
  type ProductMetricsInput,
  type ProductPlan,
} from '../src/modules/planning/planning.math.js';

// ─── Item 03 · listas fechadas ───────────────────────────────────────────────

describe('normFormatoLente — a lista fechada do cliente', () => {
  it('casa as grafias que as planilhas de fornecedor usam', () => {
    expect(normFormatoLente('Retangular')).toBe('RETANGULAR');
    expect(normFormatoLente('RECTANGLE')).toBe('RETANGULAR');
    expect(normFormatoLente('Quadrado')).toBe('QUADRADA');
    expect(normFormatoLente('square')).toBe('QUADRADA');
    expect(normFormatoLente('Redondo')).toBe('REDONDA');
    expect(normFormatoLente('Phantos')).toBe('REDONDA');
    expect(normFormatoLente('Ovalado')).toBe('OVAL');
    expect(normFormatoLente('Piloto')).toBe('AVIADOR');
    expect(normFormatoLente('Aviator')).toBe('AVIADOR');
    expect(normFormatoLente('Cat-Eye')).toBe('GATINHO');
    expect(normFormatoLente('gatinho')).toBe('GATINHO');
    expect(normFormatoLente('Hexagonal')).toBe('GEOMETRICA');
    expect(normFormatoLente('Wayfarer')).toBe('WAYFARER');
    expect(normFormatoLente('Máscara')).toBe('MASCARA');
    expect(normFormatoLente('Shield')).toBe('MASCARA');
    expect(normFormatoLente('Outros')).toBe('OUTROS');
  });

  it('o mais específico ganha quando o texto traz dois termos', () => {
    expect(normFormatoLente('Quadrado Wayfarer')).toBe('WAYFARER');
  });

  it('null é ausência; texto que não entende é NAO_IDENTIFICADO — nunca OUTROS', () => {
    expect(normFormatoLente(null)).toBeNull();
    expect(normFormatoLente('')).toBeNull();
    expect(normFormatoLente('   ')).toBeNull();
    expect(normFormatoLente('Borboleta XPTO')).toBe(NAO_IDENTIFICADO);
  });

  it('é idempotente: chave canônica passa direto', () => {
    for (const { chave } of FORMATOS_DE_LENTE) expect(normFormatoLente(chave)).toBe(chave);
  });
});

describe('normMaterialArmacao', () => {
  it('casa as grafias usuais', () => {
    expect(normMaterialArmacao('Acetato')).toBe('ACETATO');
    expect(normMaterialArmacao('acetate')).toBe('ACETATO');
    expect(normMaterialArmacao('Metal')).toBe('METAL');
    expect(normMaterialArmacao('Titânio')).toBe('TITANIO');
    expect(normMaterialArmacao('Titanium')).toBe('TITANIO');
    expect(normMaterialArmacao('Aço inox')).toBe('ACO_INOX');
    expect(normMaterialArmacao('Stainless steel')).toBe('ACO_INOX');
    expect(normMaterialArmacao('Alumínio')).toBe('ALUMINIO');
    expect(normMaterialArmacao('Injetado')).toBe('INJETADO');
    expect(normMaterialArmacao('Propionato')).toBe('INJETADO');
    expect(normMaterialArmacao('TR-90')).toBe('TR90');
    expect(normMaterialArmacao('tr 90')).toBe('TR90');
    expect(normMaterialArmacao('Nylon')).toBe('NYLON');
    expect(normMaterialArmacao('Grilamid')).toBe('NYLON');
    expect(normMaterialArmacao('Madeira')).toBe('MADEIRA');
  });

  it('duas bases no mesmo texto viram COMBINADO; "metal titânio" é só titânio', () => {
    expect(normMaterialArmacao('Acetato e metal')).toBe('COMBINADO');
    expect(normMaterialArmacao('Metal/Acetato')).toBe('COMBINADO');
    expect(normMaterialArmacao('Combinado')).toBe('COMBINADO');
    expect(normMaterialArmacao('Metal titânio')).toBe('TITANIO');
  });

  it('null é ausência; o que não entende é NAO_IDENTIFICADO', () => {
    expect(normMaterialArmacao(null)).toBeNull();
    expect(normMaterialArmacao('')).toBeNull();
    expect(normMaterialArmacao('Pedra-sabão')).toBe(NAO_IDENTIFICADO);
    for (const { chave } of MATERIAIS_DE_ARMACAO) expect(normMaterialArmacao(chave)).toBe(chave);
  });
});

describe('normGenero', () => {
  it('reduz "Unisex" e "Unissex" à mesma chave — eram dois perfis', () => {
    expect(normGenero('Unisex')).toBe('UNISSEX');
    expect(normGenero('UNISSEX')).toBe('UNISSEX');
    expect(normGenero('Feminino')).toBe('FEMININO');
    expect(normGenero('Feminina')).toBe('FEMININO');
    expect(normGenero('Woman')).toBe('FEMININO');
    expect(normGenero('Masculino')).toBe('MASCULINO');
    expect(normGenero('Men')).toBe('MASCULINO');
    expect(normGenero('Menina')).toBe('MENINA');
    expect(normGenero('Menino')).toBe('MENINO');
    expect(normGenero('Kids')).toBe('INFANTIL');
    expect(normGenero(null)).toBeNull();
    expect(normGenero('?')).toBeNull();
  });
});

// ─── Item 04 · faixa de preço ───────────────────────────────────────────────

describe('faixaDePreco — a cada R$ 500, fixa', () => {
  it('R$ 500,00 cai em 500–1.000 e R$ 499,99 em 0–500', () => {
    expect(faixaDePreco(500)).toMatchObject({ indice: 1, de: 500, ate: 1000, rotulo: 'R$ 500–1.000' });
    expect(faixaDePreco(499.99)).toMatchObject({ indice: 0, de: 0, ate: 500, rotulo: 'R$ 0–500' });
    expect(faixaDePreco(1899)).toMatchObject({ indice: 3, rotulo: 'R$ 1.500–2.000' });
  });

  it('preço zero ou inválido cai na faixa 0 sem estourar', () => {
    expect(faixaDePreco(0).indice).toBe(0);
    expect(faixaDePreco(Number.NaN).indice).toBe(0);
    expect(faixaDePreco(-10).indice).toBe(0);
  });
});

// ─── Item 07 · justificativa em toda recomendação ───────────────────────────

const base: ProductMetricsInput = {
  productId: 'p',
  sku: 'RB3025',
  description: 'RAY-BAN RB3025 AVIADOR',
  brand: null,
  category: 'OCULOS',
  unitsSold: 0,
  currentStock: 0,
  unitCost: 300,
  unitPrice: 800,
};

describe('justificativa mínima', () => {
  it('toda recomendação traz estoque, vendas e giro — inclusive as de não fazer nada', () => {
    const compra = analyzeProduct({ ...base, unitsSold: 90, currentStock: 5 }, 90);
    expect(compra.recommendation).toBe('BUY');
    expect(compra.justificativa).toContain('Estoque 5 un.');
    expect(compra.justificativa).toContain('vendeu 90 un. em 90 dias');
    expect(compra.justificativa).toContain('giro de 1/dia');
    expect(compra.justificativa).toContain('sugeridas 55 un');
    // Um ponto só no fim da frase: "un.." era o que saía na tela do comprador.
    expect(compra.justificativa.endsWith('un.')).toBe(true);
    expect(compra.justificativa).not.toContain('..');

    const parada = analyzeProduct({ ...base, unitsSold: 0, currentStock: 10 }, 90);
    expect(parada.recommendation).toBe('LIQUIDATE');
    expect(parada.justificativa).toContain('Estoque 10 un.');
    expect(parada.justificativa).toContain('sem giro no período');

    const segura = analyzeProduct({ ...base, unitsSold: 9, currentStock: 12 }, 90);
    expect(segura.justificativa).toMatch(/giro de 3\/mês/);
  });

  it('o SKU sobe até o plano', () => {
    expect(analyzeProduct(base, 90).sku).toBe('RB3025');
    expect(analyzeProduct({ ...base, sku: undefined }, 90).sku).toBeNull();
  });
});

// ─── Item 04 · sugestão original preservada no item do pedido ───────────────

describe('buildPurchaseOrders — sugerida e efetiva lado a lado', () => {
  it('o item nasce com quantity === suggestedQty e traz SKU, faixa, estoque, vendido, giro e justificativa', () => {
    const plan = analyzeProduct({ ...base, unitsSold: 90, currentStock: 5 }, 90);
    const pedidos = buildPurchaseOrders([plan], 90);
    const item = pedidos.orders[0].items[0];
    expect(item.quantity).toBe(55);
    expect(item.suggestedQty).toBe(55);
    expect(item.sku).toBe('RB3025');
    expect(item.unitPrice).toBe(800);
    expect(item.faixa.rotulo).toBe('R$ 500–1.000');
    expect(item.currentStock).toBe(5);
    expect(item.unitsSold).toBe(90);
    expect(item.giro).toBe(1);
    expect(item.justificativa).toContain('vendeu 90 un.');
  });
});

// ─── Item 08 · filtros combináveis ──────────────────────────────────────────

function plano(over: Partial<ProductMetricsInput> & { days?: number }): ProductPlan {
  const { days = 90, ...rest } = over;
  return analyzeProduct({ ...base, ...rest }, days);
}

describe('filtros combináveis da lista de compras', () => {
  const rb = plano({ productId: 'a', sku: 'RB3025', description: 'RAY-BAN RB3025', brand: 'LUXOTTICA', unitsSold: 90, currentStock: 5, unitPrice: 800 });
  const vo = plano({ productId: 'b', sku: 'VO5276', description: 'VOGUE VO5276', brand: 'LUXOTTICA', unitsSold: 30, currentStock: 2, unitPrice: 400 });
  const fichas = new Map<string, AtributosDaPeca>([
    ['a', { genero: 'Masculino', formato: 'Piloto', material: 'Metal', formatoLente: 'AVIADOR', materialArmacao: 'METAL', tamanhoLente: 58, bestSeller: true }],
    ['b', { genero: 'Feminino', formato: 'Gatinho', material: 'Acetato', formatoLente: 'GATINHO', materialArmacao: 'ACETATO', tamanhoLente: 53, bestSeller: false }],
  ]);
  const pedidos = buildPurchaseOrders([rb, vo], 90, undefined, undefined, undefined, fichas);

  it('sem filtro devolve o plano intacto', () => {
    expect(filtrarPedidos(pedidos, undefined)).toBe(pedidos);
    expect(filtrarPedidos(pedidos, { marca: [], sku: '' })).toBe(pedidos);
  });

  it('cada filtro estreita, e os totais do pedido são refeitos', () => {
    const soFem = filtrarPedidos(pedidos, { genero: ['FEMININO'] });
    expect(soFem.summary.items).toBe(1);
    expect(soFem.orders[0].items[0].sku).toBe('VO5276');
    expect(soFem.orders[0].units).toBe(soFem.orders[0].items[0].quantity);
    expect(soFem.summary.total).toBe(soFem.orders[0].total);

    const combinado = filtrarPedidos(pedidos, { genero: ['FEMININO'], formato: ['AVIADOR'] });
    expect(combinado.summary.items).toBe(0);
    expect(combinado.orders).toHaveLength(0);

    expect(filtrarPedidos(pedidos, { faixa: [1] }).summary.items).toBe(1);
    expect(filtrarPedidos(pedidos, { sku: 'rb30' }).summary.items).toBe(1);
    expect(filtrarPedidos(pedidos, { modelo: 'vogue' }).summary.items).toBe(1);
    expect(filtrarPedidos(pedidos, { material: ['METAL', 'ACETATO'] }).summary.items).toBe(2);
    expect(filtrarPedidos(pedidos, { estoqueMin: 3 }).summary.items).toBe(1);
    expect(filtrarPedidos(pedidos, { giroMin: 0.5 }).summary.items).toBe(1);
  });

  it('gênero do filtro casa com a grafia da ficha via normGenero', () => {
    expect(
      passaNoFiltro(
        { description: 'x', brand: null, category: null, unitPrice: 100, currentStock: 0, giro: 0, atributos: { genero: 'Unisex', formatoLente: null, materialArmacao: null } },
        { genero: ['UNISSEX'] },
      ),
    ).toBe(true);
  });
});

// ─── Chave de atributo — o formato agora casa ───────────────────────────────

describe('chaveDeAtributo — quem grava e quem lê usam a mesma régua', () => {
  it('"Cat-Eye", "cat eye" e "CATEYE" são uma chave só', () => {
    expect(chaveDeAtributo('Cat-Eye')).toBe(chaveDeAtributo('cat eye'));
    expect(chaveDeAtributo('CATEYE')).toBe(chaveDeAtributo('Cat-Eye'));
  });

  it('o peso de lançamento passa a enxergar o formato que vende', () => {
    const c: CandidatoDeCompra = {
      id: 'x', sku: 'x', description: 'x', brand: 'G', tipo: 'SOLAR', genero: 'Feminino', formato: 'Gatinho', cor: null,
      unitCost: 100, unitPrice: 300, unitsSold: 0, currentStock: 0, coberturaDaGrifeMeses: null, absorcao: null,
    };
    const perfil = {
      porTipoGenero: new Map([['solar|feminino', 10]]),
      porFormato: new Map([[chaveDeAtributo('Gatinho'), 40]]),
      porCor: new Map<string, number>(),
    };
    const semFormato = pesoDoCandidato({ ...c, formato: null }, perfil);
    expect(pesoDoCandidato(c, perfil)).toBeGreaterThan(semFormato);
  });
});

// ─── repartirComTeto ────────────────────────────────────────────────────────

describe('repartirComTeto', () => {
  it('fecha exato quando cabe, e declara o resto quando não cabe', () => {
    const ok = repartirComTeto([3, 1], 8, [10, 10]);
    expect(ok.cotas.reduce((a, b) => a + b, 0)).toBe(8);
    expect(ok.naoAlocado).toBe(0);

    const cheio = repartirComTeto([3, 1], 8, [2, 2]);
    expect(cheio.cotas).toEqual([2, 2]);
    expect(cheio.naoAlocado).toBe(4);
  });

  it('redistribui o excedente de quem bateu no teto para quem tem folga', () => {
    const r = repartirComTeto([9, 1], 10, [3, 10]);
    expect(r.cotas).toEqual([3, 7]);
    expect(r.naoAlocado).toBe(0);
  });
});

// ─── Item 05 · composição do mix por perfil ─────────────────────────────────

function peca(id: string, over: Partial<ProductMetricsInput>, days = 90): ProductPlan {
  return analyzeProduct({ ...base, productId: id, sku: id, description: id, ...over }, days);
}

const ficha = (genero: string, formatoLente: AtributosDaPeca['formatoLente'], materialArmacao: AtributosDaPeca['materialArmacao']): AtributosDaPeca => ({
  genero,
  formato: null,
  material: null,
  formatoLente,
  materialArmacao,
  tamanhoLente: null,
  bestSeller: false,
});

describe('comporMixPorPerfil', () => {
  // Gatinho feminino vende muito e tem pouco; aviador masculino está coberto;
  // redondo unissex está parado; um relógio fora do escopo; uma peça sem ficha.
  const plans = [
    peca('g1', { category: 'OCULOS', unitsSold: 60, currentStock: 2, unitPrice: 700 }),
    peca('g2', { category: 'OCULOS', unitsSold: 40, currentStock: 1, unitPrice: 900 }),
    peca('a1', { category: 'OCULOS', unitsSold: 30, currentStock: 60, unitPrice: 1200 }),
    peca('r1', { category: 'ARMACAO', unitsSold: 0, currentStock: 15, unitPrice: 600 }),
    peca('w1', { category: 'RELOGIO', unitsSold: 20, currentStock: 3, unitPrice: 500 }),
    peca('s1', { category: 'OCULOS', unitsSold: 25, currentStock: 4, unitPrice: 800 }),
  ];
  const fichas = new Map<string, AtributosDaPeca>([
    ['g1', ficha('Feminino', 'GATINHO', 'ACETATO')],
    ['g2', ficha('Feminina', 'GATINHO', 'ACETATO')],
    ['a1', ficha('Masculino', 'AVIADOR', 'METAL')],
    ['r1', ficha('Unisex', 'REDONDA', 'METAL')],
    // s1 sem ficha de propósito
  ]);

  it('separa fora do escopo, sem ficha e lidos — e declara a cobertura antes de recomendar', () => {
    const mix = comporMixPorPerfil(plans, fichas, { days: 90, targetCoverDays: 60 });
    expect(mix.cobertura.foraDoEscopo).toBe(1);
    expect(mix.cobertura.semFicha).toBe(1);
    expect(mix.cobertura.lidos).toBe(4);
    expect(mix.cobertura.vendasTotal).toBe(155); // 60+40+30+0+25 (relógio fora)
    expect(mix.cobertura.vendasLidas).toBe(130);
    expect(mix.cobertura.leitura).toBe('confiavel');
    expect(mix.cobertura.aviso).toContain('4 de 5 peças com ficha completa');
  });

  it('agrupa g1 e g2 no mesmo perfil (mesma faixa 500–1.000, "Feminino" e "Feminina")', () => {
    const mix = comporMixPorPerfil(plans, fichas);
    const gat = mix.linhas.find((l) => l.perfil.formato === 'GATINHO');
    expect(gat).toBeDefined();
    expect(gat!.skus).toBe(2);
    expect(gat!.perfil.genero).toBe('FEMININO');
    expect(gat!.rotulo).toBe('Óculos de sol femininos de acetato com lente gatinho · R$ 500–1.000');
  });

  it('modo diagnóstico: só o perfil abaixo recebe; coberto e parado ficam em zero, com frase própria', () => {
    const mix = comporMixPorPerfil(plans, fichas, { days: 90, targetCoverDays: 60 });
    const gat = mix.linhas.find((l) => l.perfil.formato === 'GATINHO')!;
    const avi = mix.linhas.find((l) => l.perfil.formato === 'AVIADOR')!;
    const red = mix.linhas.find((l) => l.perfil.formato === 'REDONDA')!;
    expect(gat.situacao).toBe('abaixo');
    expect(gat.units).toBeGreaterThan(0);
    expect(gat.units).toBeLessThanOrEqual(Math.ceil(gat.faltaParidade));
    expect(avi.situacao).toBe('coberto');
    expect(avi.units).toBe(0);
    expect(avi.justificativa).toContain('Coberto');
    expect(red.situacao).toBe('parado');
    expect(red.units).toBe(0);
    expect(red.justificativa).toContain('remanejamento');
    expect(mix.modo).toBe('diagnostico');
    expect(mix.alocado + mix.naoAlocado).toBe(mix.meta);
    expect(mix.linhas[0]).toBe(gat); // ordenada por units desc
    expect(gat.frase).toMatch(/^\d+ óculos de sol femininos de acetato com lente gatinho \(R\$ 500–1\.000\)$/);
    expect(gat.justificativa).toContain('% das vendas lidas');
    expect(gat.justificativa).toContain('falta de variedade');
    expect(gat.justificativa).toContain('para espelhar a venda teria');
  });

  it('modo meta: Σ units + naoAlocado === meta, e o que não cabe em falta é declarado', () => {
    const pequena = comporMixPorPerfil(plans, fichas, { metaDeUnidades: 3 });
    expect(pequena.modo).toBe('meta');
    expect(pequena.alocado).toBe(3);
    expect(pequena.naoAlocado).toBe(0);

    const grande = comporMixPorPerfil(plans, fichas, { metaDeUnidades: 10_000 });
    expect(grande.alocado + grande.naoAlocado).toBe(10_000);
    expect(grande.naoAlocado).toBeGreaterThan(0);
    for (const l of grande.linhas) expect(l.units).toBeLessThanOrEqual(Math.ceil(l.faltaParidade));
    expect(grande.resumo).toContain('não couberam');
  });

  it('a posição do perfil já conta a reposição por SKU — a composição é o que falta DEPOIS dela', () => {
    const mix = comporMixPorPerfil(plans, fichas);
    const gat = mix.linhas.find((l) => l.perfil.formato === 'GATINHO')!;
    expect(gat.reposicaoPorSku).toBe(plans[0].suggestedQty + plans[1].suggestedQty);
    expect(gat.posicao).toBe(gat.currentStock + gat.onOrder + gat.reposicaoPorSku);
    // Pela régua de cobertura não falta nada (a camada por SKU já compra até
    // o alvo); pela paridade falta variedade.
    expect(gat.faltaCobertura).toBe(0);
    expect(gat.faltaParidade).toBeGreaterThan(0);
    expect(gat.faltaParidade).toBe(Math.max(0, gat.metaDeParidade - gat.posicao));
  });

  it('paridade forte com posição acima do dobro do alvo em dias fica coberto, e a frase explica a discordância', () => {
    const cheio = [
      peca('c1', { category: 'OCULOS', unitsSold: 90, currentStock: 400, unitPrice: 700 }),
      peca('c2', { category: 'OCULOS', unitsSold: 10, currentStock: 1, unitPrice: 700 }),
    ];
    const f2 = new Map<string, AtributosDaPeca>([
      ['c1', ficha('Masculino', 'QUADRADA', 'ACETATO')],
      ['c2', ficha('Feminino', 'OVAL', 'ACETATO')],
    ]);
    // c1 tem 90% das vendas e ~99% da posição: paridade não pede nada. Para
    // forçar a discordância, a meta grande faz a paridade pedir mais para c1
    // mesmo com 400 dias de cobertura.
    const mix = comporMixPorPerfil(cheio, f2, { metaDeUnidades: 5000, targetCoverDays: 60 });
    const q = mix.linhas.find((l) => l.perfil.formato === 'QUADRADA')!;
    expect(q.faltaParidade).toBeGreaterThan(0);
    expect(q.situacao).toBe('coberto');
    expect(q.units).toBe(0);
    expect(q.justificativa).toContain('dobro do alvo');
  });

  it('evidência insuficiente: falta informada, nada alocado', () => {
    const poucas = [peca('x', { category: 'OCULOS', unitsSold: 2, currentStock: 0, unitPrice: 700 }, 90), ...plans];
    const f2 = new Map(fichas);
    f2.set('x', ficha('Menina', 'OVAL', 'INJETADO'));
    const mix = comporMixPorPerfil(poucas, f2, { minVendas: 3 });
    const l = mix.linhas.find((l) => l.perfil.formato === 'OVAL')!;
    expect(l.situacao).toBe('evidencia-insuficiente');
    expect(l.units).toBe(0);
    expect(l.justificativa).toContain('Evidência insuficiente');
  });

  it('sem base (ficha em menos de 5% das vendas) zera a alocação e diz por quê', () => {
    const muitas = Array.from({ length: 40 }, (_, i) =>
      peca(`n${i}`, { category: 'OCULOS', unitsSold: 100, currentStock: 1, unitPrice: 700 }),
    );
    const mix = comporMixPorPerfil([...muitas, ...plans], fichas, { metaDeUnidades: 50 });
    expect(mix.cobertura.leitura).toBe('sem-base');
    expect(mix.alocado).toBe(0);
    expect(mix.naoAlocado).toBe(50);
    expect(mix.cobertura.aviso).toContain('Base insuficiente');
    expect(mix.resumo).toContain('Sem base');
  });

  it('NAO_IDENTIFICADO não entra em perfil nenhum — conta como faltando', () => {
    const f2 = new Map(fichas);
    f2.set('a1', ficha('Masculino', NAO_IDENTIFICADO, 'METAL'));
    const mix = comporMixPorPerfil(plans, f2);
    expect(mix.cobertura.faltando.formato).toBe(2); // a1 + s1 (sem ficha)
    expect(mix.linhas.some((l) => l.perfil.formato === NAO_IDENTIFICADO)).toBe(false);
  });
});

// ─── O que a revisão adversarial encontrou ──────────────────────────────────
//
// Cada bloco abaixo guarda um defeito CONFIRMADO por revisão independente,
// com o cenário que ela reproduziu. Nenhum deles aparecia em teste — é por
// isso que estão aqui.

describe('revisão · o pedido filtrado descreve o pedido filtrado', () => {
  const peca = (id: string, sold: number, stock: number, preco: number) =>
    analyzeProduct({ ...base, productId: id, sku: id, description: `${id} OCULOS RAY BAN`, unitsSold: sold, currentStock: stock, unitPrice: preco }, 90);

  const fichas = new Map<string, AtributosDaPeca>([
    ['a', { genero: 'Feminino', formato: 'Piloto', material: 'Metal', formatoLente: 'AVIADOR', materialArmacao: 'METAL', tamanhoLente: 58, bestSeller: false }],
    ['b', { genero: 'Masculino', formato: 'Máscara', material: 'Acetato', formatoLente: 'MASCARA', materialArmacao: 'ACETATO', tamanhoLente: 60, bestSeller: false }],
  ]);

  const plano = () =>
    buildPurchaseOrders(
      [peca('a', 90, 5, 800), peca('b', 60, 3, 300)],
      90,
      () => 'Luxottica',
      undefined,
      undefined,
      fichas,
    );

  it('a quebra por grife, a por tipo e a contagem de ficha acompanham o filtro', () => {
    const todos = plano();
    const so = filtrarPedidos(todos, { faixa: [1] }); // só a peça de R$ 800
    const pedido = so.orders[0];
    expect(pedido.items).toHaveLength(1);
    // A INVARIANTE: a quebra fecha contra o pedido que está na tela.
    expect(pedido.porGrife.reduce((a, g) => a + g.units, 0)).toBe(pedido.units);
    expect(pedido.porFormato.reduce((a, f) => a + f.units, 0)).toBe(pedido.units);
    expect(pedido.itensComFicha).toBe(1);
    // E o tipo que sobrou é o da peça que sobrou, não o do conjunto original.
    expect(pedido.porFormato.map((f) => f.formato)).toEqual(['Aviador']);
  });

  it('itensComFicha nunca fica maior que os itens — era o que sumia com o aviso de cobertura', () => {
    const semFichaNaSegunda = new Map<string, AtributosDaPeca>([['a', fichas.get('a')!]]);
    const todos = buildPurchaseOrders(
      [peca('a', 90, 5, 800), peca('b', 60, 3, 300)],
      90,
      () => 'Luxottica',
      undefined,
      undefined,
      semFichaNaSegunda,
    );
    const so = filtrarPedidos(todos, { faixa: [0] }); // fica só a peça SEM ficha
    const pedido = so.orders[0];
    expect(pedido.items).toHaveLength(1);
    expect(pedido.itensComFicha).toBe(0);
    expect(pedido.items.length - pedido.itensComFicha).toBeGreaterThanOrEqual(0);
  });

  it('a quebra por tipo usa a LISTA FECHADA: duas grafias do mesmo formato são um selo só', () => {
    const duasGrafias = new Map<string, AtributosDaPeca>([
      ['a', { genero: null, formato: 'Cat-Eye', material: null, formatoLente: 'GATINHO', materialArmacao: null, tamanhoLente: null, bestSeller: false }],
      ['b', { genero: null, formato: 'gatinho', material: null, formatoLente: 'GATINHO', materialArmacao: null, tamanhoLente: null, bestSeller: false }],
    ]);
    const p = buildPurchaseOrders(
      [peca('a', 90, 5, 800), peca('b', 60, 3, 300)],
      90,
      () => 'Luxottica',
      undefined,
      undefined,
      duasGrafias,
    );
    expect(p.orders[0].porFormato).toHaveLength(1);
    expect(p.orders[0].porFormato[0].formato).toBe('Gatinho (cat-eye)');
  });

  it('o filtro de marca casa com a grife de análise — a mesma que o seletor oferece', () => {
    // A peça sem grife na descrição: `brand` fica null, e a régua do seletor
    // (analysisBrand) cai no fornecedor do ERP. Antes, filtrar pela marca
    // oferecida devolvia zero item.
    const semGrife = analyzeProduct(
      { ...base, productId: 'x', sku: 'x', description: 'ARMACAO 5024', brand: 'MARCHON DO BRASIL', category: 'ARMACAO', unitsSold: 90, currentStock: 2 },
      90,
    );
    const p = buildPurchaseOrders([semGrife], 90);
    const item = p.orders[0].items[0];
    expect(item.brand).toBeNull();
    expect(item.grifeDeAnalise).toBe('MARCHON DO BRASIL');
    expect(filtrarPedidos(p, { marca: ['MARCHON DO BRASIL'] }).summary.items).toBe(1);
  });
});

describe('revisão · repartirComTeto não perde a meta', () => {
  it('peso nenhum devolve a meta inteira em naoAlocado, não zero', () => {
    const r = repartirComTeto([0, 0], 30, [10, 10]);
    expect(r.cotas).toEqual([0, 0]);
    // Era `naoAlocado: 0` para meta 30: trinta unidades sumiam sem aparecer
    // em lugar nenhum — o oposto do contrato da função.
    expect(r.naoAlocado).toBe(30);
    expect(r.cotas.reduce((a, b) => a + b, 0) + r.naoAlocado).toBe(30);
  });

  it('peso negativo (devolução) não inverte nem some com a meta', () => {
    const r = repartirComTeto([-5, -1], 12, [10, 10]);
    expect(r.naoAlocado).toBe(12);
  });
});

describe('revisão · material único não vira COMBINADO', () => {
  it('processo e base no mesmo texto continuam sendo um material só', () => {
    expect(normMaterialArmacao('Nylon injetado')).toBe('NYLON');
    expect(normMaterialArmacao('Acetato injetado')).toBe('ACETATO');
    expect(normMaterialArmacao('Grilamid TR90')).toBe('TR90');
    // E a combinação de verdade continua sendo combinação.
    expect(normMaterialArmacao('Acetato e metal')).toBe('COMBINADO');
  });
});

describe('revisão · justificativa nas duas superfícies que faltavam', () => {
  it('o card de decisão carrega os números do plano (item 07)', () => {
    const p = analyzeProduct({ ...base, unitsSold: 0, currentStock: 12 }, 90);
    const quadro = buildDecisionCards([p], []);
    expect(quadro.cards.length).toBeGreaterThan(0);
    for (const c of quadro.cards) {
      expect(c.justificativa).toContain('Estoque');
      expect(c.justificativa).toMatch(/vendeu \d/);
    }
  });
});
