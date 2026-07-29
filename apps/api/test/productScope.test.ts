import { describe, it, expect } from 'vitest';
import { parseGroup, scopeCategories } from '../src/modules/products/product.scope.js';

/**
 * Recorte de produto do console (feedback do Galbe, 29/07).
 * A parte pura: como o recorte se combina com o filtro de categoria da tela.
 */
describe('scopeCategories (recorte × filtro de categoria)', () => {
  const escopo = { category: { in: ['OCULOS', 'ARMACAO', 'RELOGIO'] } };

  it('sem recorte e sem filtro, não restringe nada', () => {
    expect(scopeCategories(undefined, undefined)).toBeUndefined();
    expect(scopeCategories(undefined, [])).toBeUndefined();
  });

  it('só o filtro da tela vale quando não há recorte', () => {
    expect(scopeCategories(undefined, ['LENTES'])).toEqual({ category: { in: ['LENTES'] } });
  });

  it('só o recorte vale quando a tela não filtrou', () => {
    expect(scopeCategories(escopo, undefined)).toEqual(escopo);
  });

  it('os dois juntos INTERSECTAM — o filtro não fura o recorte', () => {
    // É o ponto: escolher uma categoria de lente dentro do recorte principal
    // não pode trazer lente de volta pela porta dos fundos.
    expect(scopeCategories(escopo, ['OCULOS', 'LENTES'])).toEqual({ category: { in: ['OCULOS'] } });
    expect(scopeCategories(escopo, ['LENTES'])).toEqual({ category: { in: [] } });
  });
});

describe('parseGroup', () => {
  it('aceita apenas os recortes conhecidos e cai em "todos"', () => {
    expect(parseGroup('principal')).toBe('principal');
    expect(parseGroup('lentes')).toBe('lentes');
    expect(parseGroup('todos')).toBe('todos');
    expect(parseGroup(undefined)).toBe('todos');
    expect(parseGroup('qualquer-coisa')).toBe('todos');
  });
});
