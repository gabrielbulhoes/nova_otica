import { describe, it, expect } from 'vitest';
import {
  bool,
  date,
  int,
  mapEstoque,
  mapLoja,
  mapProduto,
  num,
} from '../src/integrations/sellbie/mappers.js';

describe('coerções', () => {
  it('num aceita vírgula decimal e valores nulos', () => {
    expect(num('1234,50')).toBe(1234.5);
    expect(num('10')).toBe(10);
    expect(num('')).toBeUndefined();
    expect(num(null)).toBeUndefined();
    expect(num('abc')).toBeUndefined();
  });

  it('int trunca e usa 0 como padrão', () => {
    expect(int('7.9')).toBe(7);
    expect(int(undefined)).toBe(0);
  });

  it('bool interpreta representações comuns', () => {
    expect(bool(1)).toBe(true);
    expect(bool(0)).toBe(false);
    expect(bool('sim')).toBe(true);
    expect(bool('nao')).toBe(false);
    expect(bool(undefined, false)).toBe(false);
  });

  it('date converte aaaa-mm-dd e rejeita inválidas', () => {
    expect(date('2024-06-15')?.getFullYear()).toBe(2024);
    expect(date('xx')).toBeUndefined();
    expect(date(undefined)).toBeUndefined();
  });
});

describe('mappers de entidade', () => {
  it('mapLoja normaliza campos e usa fallback de nome', () => {
    expect(mapLoja({ idFilial: 3, cidade: 'Campinas', uf: 'SP', ativo: 1 })).toMatchObject({
      externalId: '3',
      name: 'Filial 3',
      city: 'Campinas',
      state: 'SP',
      active: true,
    });
    expect(mapLoja({ idFilial: 1, nome: 'Centro' }).name).toBe('Centro');
  });

  it('mapProduto converte preços e referências de cor/tamanho', () => {
    const p = mapProduto({
      prodCodigo: 1001,
      descricao: 'Armação X',
      precoVenda: '199,90',
      corCodigo: 2,
      tamanhoCodigo: 3,
    });
    expect(p).toMatchObject({
      externalId: '1001',
      description: 'Armação X',
      price: 199.9,
      externalColorId: '2',
      externalSizeId: '3',
    });
  });

  it('mapEstoque usa quantidade como disponível quando ausente', () => {
    expect(mapEstoque({ idFilial: 2, prodCodigo: 1001, quantidade: 5 })).toEqual({
      externalStoreId: '2',
      externalProductId: '1001',
      quantity: 5,
      available: 5,
    });
  });
});
