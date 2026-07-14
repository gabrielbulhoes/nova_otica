import { describe, it, expect } from 'vitest';
import {
  bandeiraDaLoja,
  buildBrandMix,
  buildFairSplit,
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
