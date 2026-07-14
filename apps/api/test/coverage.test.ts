import { describe, it, expect } from 'vitest';
import { classifyCoverage, computeStoreCoverage } from '../src/modules/planning/planning.math.js';
import { parseList } from '../src/http/helpers.js';

describe('computeStoreCoverage', () => {
  const base = { storeId: 's1', storeName: 'Loja Centro' };

  it('cobertura = estoque ÷ média mensal (período de 30 dias)', () => {
    const [row] = computeStoreCoverage([{ ...base, stockUnits: 300, unitsSold: 100 }], 30);
    expect(row.monthlyUnits).toBe(100);
    expect(row.coverageMonths).toBe(3);
    expect(row.level).toBe('HEALTHY');
  });

  it('normaliza períodos diferentes de 30 dias para a média mensal', () => {
    // 90 dias com 300 vendidas = 100/mês.
    const [row] = computeStoreCoverage([{ ...base, stockUnits: 500, unitsSold: 300 }], 90);
    expect(row.monthlyUnits).toBe(100);
    expect(row.coverageMonths).toBe(5);
  });

  it('estoque sem venda no período: cobertura nula, classificada como excesso', () => {
    const [row] = computeStoreCoverage([{ ...base, stockUnits: 50, unitsSold: 0 }], 30);
    expect(row.coverageMonths).toBeNull();
    expect(row.level).toBe('EXCESS');
  });

  it('loja vazia (sem estoque e sem venda) é crítica, nunca excesso', () => {
    const [row] = computeStoreCoverage([{ ...base, stockUnits: 0, unitsSold: 0 }], 30);
    expect(row.coverageMonths).toBeNull();
    expect(row.level).toBe('CRITICAL');
  });

  it('ordena da menor cobertura para a maior, sem venda por último', () => {
    const rows = computeStoreCoverage(
      [
        { storeId: 'a', storeName: 'Excesso', stockUnits: 900, unitsSold: 30 },
        { storeId: 'b', storeName: 'Parada', stockUnits: 100, unitsSold: 0 },
        { storeId: 'c', storeName: 'Crítica', stockUnits: 20, unitsSold: 60 },
      ],
      30,
    );
    expect(rows.map((r) => r.storeId)).toEqual(['c', 'a', 'b']);
    expect(rows[0].level).toBe('CRITICAL');
    expect(rows[1].level).toBe('EXCESS');
  });

  it('período inválido (0 dias) não divide por zero', () => {
    const [row] = computeStoreCoverage([{ ...base, stockUnits: 10, unitsSold: 10 }], 0);
    expect(row.monthlyUnits).toBe(0);
    expect(row.coverageMonths).toBeNull();
  });
});

describe('classifyCoverage', () => {
  it('faixas: <1 crítica, ≤6 saudável, ≤12 alta, >12 excesso', () => {
    expect(classifyCoverage(0.9)).toBe('CRITICAL');
    expect(classifyCoverage(1)).toBe('HEALTHY');
    expect(classifyCoverage(6)).toBe('HEALTHY');
    expect(classifyCoverage(6.1)).toBe('HIGH');
    expect(classifyCoverage(12)).toBe('HIGH');
    expect(classifyCoverage(12.1)).toBe('EXCESS');
    expect(classifyCoverage(null)).toBe('EXCESS');
  });
});

describe('parseList (filtros multi-seleção)', () => {
  it('divide por vírgula ignorando vazios e espaços', () => {
    expect(parseList('a,b , c')).toEqual(['a', 'b', 'c']);
    expect(parseList('a,,b,')).toEqual(['a', 'b']);
  });

  it('valor único vira lista de um item', () => {
    expect(parseList('loja-1')).toEqual(['loja-1']);
  });

  it('parâmetro repetido (?k=a&k=b → array do qs) vale LITERALMENTE', () => {
    expect(parseList(['a', 'b'])).toEqual(['a', 'b']);
    // Elemento de array pode conter vírgula (categoria vinda do ERP).
    expect(parseList(['Lentes, Grifes', 'ARMACAO'])).toEqual(['Lentes, Grifes', 'ARMACAO']);
    expect(parseList([' a ', '', 42 as unknown as string])).toEqual(['a']);
  });

  it('vazio/ausente/não-string → undefined (sem filtro)', () => {
    expect(parseList('')).toBeUndefined();
    expect(parseList(' , ')).toBeUndefined();
    expect(parseList([])).toBeUndefined();
    expect(parseList(undefined)).toBeUndefined();
    expect(parseList(42)).toBeUndefined();
  });
});
