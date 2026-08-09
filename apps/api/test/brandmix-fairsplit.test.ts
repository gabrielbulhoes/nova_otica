import { describe, it, expect } from 'vitest';
import {
  bandeiraDaLoja,
  buildBrandMix,
  buildFairSplit,
  DEFAULT_PLANNING_CONFIG,
  largestRemainders,
  splitByNeed,
  type BrandBannerInput,
  type FairSplitInput,
} from '../src/modules/planning/planning.math.js';

describe('bandeiraDaLoja', () => {
  it('deriva a bandeira do prefixo do nome (sem acento, maiúsculas)', () => {
    expect(bandeiraDaLoja('A GRACIOSA MIDWAY')).toBe('A GRACIOSA');
    expect(bandeiraDaLoja('Óticalli Praia Shopping')).toBe('OTICALLI');
    expect(bandeiraDaLoja('GRAND OPTICAL NATAL')).toBe('GRAND OPTICAL');
    expect(bandeiraDaLoja('ZEISS JUAZEIRO')).toBe('ZEISS');
  });
  it('loja sem prefixo conhecido vira a própria bandeira (não some num balde)', () => {
    expect(bandeiraDaLoja('ASSISTENCIA')).toBe('ASSISTENCIA');
    expect(bandeiraDaLoja('ESTOQUE COMPRAS')).toBe('ESTOQUE COMPRAS');
    expect(bandeiraDaLoja('   ')).toBe('OPERAÇÃO'); // vazio → último recurso
  });
});

describe('buildBrandMix', () => {
  const rows: BrandBannerInput[] = [
    { storeName: 'A GRACIOSA MIDWAY', brand: 'HOYA', stockUnits: 100, unitsSold: 20 },
    { storeName: 'GRAND OPTICAL NATAL', brand: 'HOYA', stockUnits: 50, unitsSold: 0 }, // parado aqui
    { storeName: 'ZEISS MOSSORO', brand: 'ZEISS', stockUnits: 30, unitsSold: 5 },
  ];

  it('agrega por bandeira e soma o total da marca', () => {
    const { banners, rows: out } = buildBrandMix(rows);
    expect(banners).toContain('A GRACIOSA');
    expect(banners).toContain('GRAND OPTICAL');
    const hoya = out.find((r) => r.brand === 'HOYA')!;
    expect(hoya.total).toEqual({ stockUnits: 150, unitsSold: 20 });
    expect(hoya.byBanner['A GRACIOSA']).toEqual({ stockUnits: 100, unitsSold: 20 });
  });

  it('aponta a bandeira com estoque parado como candidata a remanejo', () => {
    const hoya = buildBrandMix(rows).rows.find((r) => r.brand === 'HOYA')!;
    expect(hoya.sellsIn).toContain('A GRACIOSA');
    expect(hoya.moveFrom).toEqual(['GRAND OPTICAL']); // tem estoque, não vendeu, e a marca vende em outra
  });

  it('marca que não vende em lugar nenhum não gera candidata a remanejo', () => {
    const parada = buildBrandMix([
      { storeName: 'A GRACIOSA X', brand: 'MORTA', stockUnits: 10, unitsSold: 0 },
      { storeName: 'ZEISS Y', brand: 'MORTA', stockUnits: 5, unitsSold: 0 },
    ]).rows.find((r) => r.brand === 'MORTA')!;
    expect(parada.sellsIn).toEqual([]);
    expect(parada.moveFrom).toEqual([]);
  });

  it('candidatas a remanejo vêm primeiro na ordenação', () => {
    const { rows: out } = buildBrandMix(rows);
    expect(out[0].brand).toBe('HOYA'); // única com moveFrom
  });
});

describe('buildFairSplit', () => {
  const rows: FairSplitInput[] = [
    { storeId: 'a', storeName: 'Loja A', unitsSold: 60, stockUnits: 5 },
    { storeId: 'b', storeName: 'Loja B', unitsSold: 30, stockUnits: 2 },
    { storeId: 'c', storeName: 'Loja C', unitsSold: 10, stockUnits: 0 },
    { storeId: 'd', storeName: 'Loja D (sem venda)', unitsSold: 0, stockUnits: 8 },
  ];

  it('rateia proporcional à participação, somando EXATAMENTE o total', () => {
    const { rows: out, totalSold } = buildFairSplit(rows, 100);
    expect(totalSold).toBe(100);
    const byId = new Map(out.map((r) => [r.storeId, r]));
    expect(byId.get('a')!.suggestedQty).toBe(60);
    expect(byId.get('b')!.suggestedQty).toBe(30);
    expect(byId.get('c')!.suggestedQty).toBe(10);
    expect(byId.get('d')!.suggestedQty).toBe(0); // sem venda não recebe
    expect(out.reduce((s, r) => s + r.suggestedQty, 0)).toBe(100);
  });

  it('maiores restos recebem a sobra do arredondamento (soma exata)', () => {
    // 3 lojas iguais, 10 unidades: 3,33 cada → 4/3/3 (primeiro maior resto).
    const three: FairSplitInput[] = [
      { storeId: 'x', storeName: 'X', unitsSold: 1, stockUnits: 0 },
      { storeId: 'y', storeName: 'Y', unitsSold: 1, stockUnits: 0 },
      { storeId: 'z', storeName: 'Z', unitsSold: 1, stockUnits: 0 },
    ];
    const out = buildFairSplit(three, 10);
    expect(out.rows.reduce((s, r) => s + r.suggestedQty, 0)).toBe(10);
    expect(out.rows.map((r) => r.suggestedQty).sort((a, b) => b - a)).toEqual([4, 3, 3]);
  });

  it('sem vendas no recorte: ninguém recebe (soma zero), sem dividir por zero', () => {
    const out = buildFairSplit(
      [{ storeId: 'a', storeName: 'A', unitsSold: 0, stockUnits: 5 }],
      50,
    );
    expect(out.totalSold).toBe(0);
    expect(out.rows[0].suggestedQty).toBe(0);
  });

  it('quantidade zero/negativa devolve rateio zerado', () => {
    expect(buildFairSplit(rows, 0).rows.every((r) => r.suggestedQty === 0)).toBe(true);
    expect(buildFairSplit(rows, -5).totalQty).toBe(0);
  });

  it('venda líquida negativa (devolução) não inverte o rateio', () => {
    // Loja com -3 líquidas não pode roubar unidade de quem realmente vende.
    const out = buildFairSplit(
      [
        { storeId: 'a', storeName: 'A', unitsSold: 90, stockUnits: 0 },
        { storeId: 'b', storeName: 'B (devolveu)', unitsSold: -3, stockUnits: 0 },
        { storeId: 'c', storeName: 'C', unitsSold: 10, stockUnits: 0 },
      ],
      100,
    );
    const byId = new Map(out.rows.map((r) => [r.storeId, r]));
    expect(byId.get('b')!.suggestedQty).toBe(0); // clampada, não recebe
    expect(byId.get('b')!.sharePct).toBe(0);
    expect(out.rows.every((r) => r.suggestedQty >= 0)).toBe(true);
    expect(out.rows.reduce((s, r) => s + r.suggestedQty, 0)).toBe(100);
  });
});

describe('largestRemainders (o núcleo do rateio, agora sozinho)', () => {
  it('a soma é EXATAMENTE o total, e a sobra vai para os maiores restos', () => {
    // 3 pesos iguais, 10 unidades: 3,33 cada → 4/3/3.
    expect(largestRemainders([1, 1, 1], 10)).toEqual([4, 3, 3]);
    expect(largestRemainders([7, 2, 1], 13).reduce((a, b) => a + b, 0)).toBe(13);
  });

  it('reparte por peso NENHUM em especial — venda, falta, o que vier', () => {
    // A função não sabe o que os pesos significam, e é isso que permite as duas
    // portas (participação e necessidade) usarem o mesmo arredondamento.
    expect(largestRemainders([57, 0, 20], 30)).toEqual([22, 0, 8]);
  });

  it('peso negativo vira zero em vez de inverter o rateio', () => {
    // Devolução lançada como venda líquida negativa existe no dado real.
    const out = largestRemainders([90, -3, 10], 100);
    expect(out[1]).toBe(0);
    expect(out.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('total zero, quantidade zero ou negativa: tudo zero, sem dividir por zero', () => {
    expect(largestRemainders([0, 0], 50)).toEqual([0, 0]);
    expect(largestRemainders([1, 2], 0)).toEqual([0, 0]);
    expect(largestRemainders([1, 2], -5)).toEqual([0, 0]);
  });

  it('o desempate é do chamador — sem ele o resultado dependeria da ordem do banco', () => {
    // Restos idênticos: quem leva a sobra é quem o tieBreak puser primeiro.
    expect(largestRemainders([1, 1], 3, (i, j) => j - i)).toEqual([1, 2]);
    expect(largestRemainders([1, 1], 3, (i, j) => i - j)).toEqual([2, 1]);
  });
});

describe('splitByNeed (rateio por falta até a cobertura-alvo)', () => {
  const cfg = { ...DEFAULT_PLANNING_CONFIG, targetCoverDays: 60 };
  // 90 dias de janela. A = 1/dia (alvo 60) com 3 em estoque → falta 57.
  // B vende o DOBRO de A (alvo 120) mas tem 200 → falta 0.
  // C = 0,5/dia (alvo 30) com 10 → falta 20.
  const lojas: FairSplitInput[] = [
    { storeId: 'a', storeName: 'Loja A', unitsSold: 90, stockUnits: 3 },
    { storeId: 'b', storeName: 'Loja B (abarrotada)', unitsSold: 180, stockUnits: 200 },
    { storeId: 'c', storeName: 'Loja C', unitsSold: 45, stockUnits: 10 },
  ];

  it('a loja que mais vende NÃO leva mais quando já está coberta', () => {
    // É a diferença inteira entre o que o cliente pediu e o que havia: por
    // participação, a Loja B levaria 57% da carga por vender o dobro da A.
    const porVenda = buildFairSplit(lojas, 30);
    expect(porVenda.rows.find((r) => r.storeId === 'b')!.suggestedQty).toBe(17);

    const out = splitByNeed(lojas, 30, 90, cfg);
    expect(out.basis).toBe('necessidade');
    const byId = new Map(out.rows.map((r) => [r.storeId, r]));
    expect(byId.get('b')!.suggestedQty).toBe(0);
    expect(byId.get('a')!.suggestedQty).toBe(22);
    expect(byId.get('c')!.suggestedQty).toBe(8);
    expect(out.rows.reduce((s, r) => s + r.suggestedQty, 0)).toBe(30);
  });

  it('devolve a necessidade CRUA, para a tela dizer se a carga cobre a falta', () => {
    // 57 + 0 + 20 = 77 un. faltando; a carga é de 30. Normalizado, o rateio de
    // 30 e o de 300 têm exatamente a mesma cara — 100% dividido entre lojas.
    const out = splitByNeed(lojas, 30, 90, cfg);
    expect(out.totalNeed).toBe(77);
    expect(out.totalQty).toBe(30);
    expect(out.unassigned).toBe(0);
  });

  it('soma das necessidades zero: cai na participação e DECLARA a reserva', () => {
    // Rede inteira acima do alvo. A carga já foi comprada e vai chegar.
    const cobertas: FairSplitInput[] = [
      { storeId: 'a', storeName: 'A', unitsSold: 90, stockUnits: 100 },
      { storeId: 'b', storeName: 'B', unitsSold: 30, stockUnits: 100 },
    ];
    const out = splitByNeed(cobertas, 20, 90, cfg);
    expect(out.basis).toBe('participacao');
    expect(out.totalNeed).toBe(0);
    const byId = new Map(out.rows.map((r) => [r.storeId, r]));
    expect(byId.get('a')!.suggestedQty).toBe(15); // 75% de 20
    expect(byId.get('b')!.suggestedQty).toBe(5);
  });

  it('a reserva aceita um peso de fora — a escada de grife/categoria/rede', () => {
    // Peça nova: ninguém vendeu ESTE modelo, então falta zero em toda loja. A
    // venda da própria peça não serve de reserva; a da grife serve.
    const novas: FairSplitInput[] = [
      { storeId: 'a', storeName: 'A', unitsSold: 0, stockUnits: 0 },
      { storeId: 'b', storeName: 'B', unitsSold: 0, stockUnits: 0 },
    ];
    const grife = new Map([['a', 10], ['b', 30]]);
    const out = splitByNeed(novas, 40, 90, cfg, (r) => grife.get(r.storeId) ?? 0);
    expect(out.basis).toBe('participacao');
    const byId = new Map(out.rows.map((r) => [r.storeId, r]));
    expect(byId.get('a')!.suggestedQty).toBe(10);
    expect(byId.get('b')!.suggestedQty).toBe(30);
  });

  it('sem falta e sem venda, as unidades ficam em unassigned — nunca evaporam', () => {
    const out = splitByNeed(
      [{ storeId: 'a', storeName: 'A', unitsSold: 0, stockUnits: 0 }],
      37,
      90,
      cfg,
    );
    expect(out.rows.every((r) => r.suggestedQty === 0)).toBe(true);
    expect(out.unassigned).toBe(37);
  });

  it('a linha mostra a conta inteira: venda, estoque, falta e o peso do rateio', () => {
    // Sem isso a tela mostra um número e pede fé. Com isso, o gestor confere.
    const out = splitByNeed(lojas, 30, 90, cfg);
    const a = out.rows.find((r) => r.storeId === 'a')!;
    expect(a.unitsSold).toBe(90);
    expect(a.stockUnits).toBe(3);
    expect(a.needUnits).toBe(57);
    // Quando a base é a necessidade, o peso do percentual É a falta.
    expect(a.weightUnits).toBe(57);
    expect(a.sharePct).toBe(74.03); // 57 de 77
  });

  it('na RESERVA, o peso da linha fala da mesma base que o percentual', () => {
    // O caso normal de um pedido de compra: peça NOVA, ninguém vendeu ESTE
    // modelo, falta zero em toda loja. Com a coluna presa à venda do próprio
    // SKU, a tela mostrava "vendeu 0 · em estoque 12 · falta 0 · 75% · mandar
    // 28" — as colunas que existem para EXPLICAR o número final todas zeradas
    // ao lado dele. O peso que valeu foi o da grife, e é ele que precisa
    // aparecer.
    const novas: FairSplitInput[] = [
      { storeId: 'midway', storeName: 'Midway', unitsSold: 0, stockUnits: 12 },
      { storeId: 'guarabira', storeName: 'Guarabira', unitsSold: 0, stockUnits: 3 },
    ];
    const grife = new Map([
      ['midway', 300],
      ['guarabira', 100],
    ]);
    const out = splitByNeed(novas, 37, 365, cfg, (r) => grife.get(r.storeId) ?? 0);
    expect(out.basis).toBe('participacao');

    const byId = new Map(out.rows.map((r) => [r.storeId, r]));
    expect(byId.get('midway')!.weightUnits).toBe(300);
    expect(byId.get('midway')!.sharePct).toBe(75);
    expect(byId.get('midway')!.suggestedQty).toBe(28);
    expect(byId.get('guarabira')!.weightUnits).toBe(100);
    expect(byId.get('guarabira')!.sharePct).toBe(25);
    // A venda do próprio SKU continua sendo o que é — zero —, e é por isso que
    // ela não pode ser a coluna que explica os 75%.
    expect(byId.get('midway')!.unitsSold).toBe(0);
  });

  it('a linha não carrega campo que nenhuma tela lê', () => {
    // `dailyDemand` e `targetUnits` trafegavam em ~163 linhas por resposta sem
    // nenhum consumidor de produção: só teste os lia. Campo calculado e
    // servido cria impressão de contrato, e o próximo a chegar assume que
    // alguém o valida.
    const out = splitByNeed(lojas, 30, 90, cfg);
    expect(Object.keys(out.rows[0]).sort()).toEqual([
      'needUnits',
      'sharePct',
      'stockUnits',
      'storeId',
      'storeName',
      'suggestedQty',
      'unitsSold',
      'weightUnits',
    ]);
  });
});
