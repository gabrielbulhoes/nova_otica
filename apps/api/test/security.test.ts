import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { redact } from '../src/lib/logger.js';
import { assertStoreAccess, scopedStoreId } from '../src/modules/auth/auth.middleware.js';
import { parseDays } from '../src/http/helpers.js';

function reqAs(role: 'ADMIN' | 'STORE_MANAGER', storeId: string | null): Request {
  return { user: { id: 'u1', email: 'u@x.com', role, storeId } } as unknown as Request;
}

describe('redact (logger)', () => {
  it('mascara chaves sensíveis em qualquer nível', () => {
    const out = redact({
      msg: 'login',
      token: 'jwt-secreto',
      nested: { password: '123', ok: 1, card: { number: '4111' } },
      list: [{ apiKey: 'k' }],
    }) as Record<string, unknown>;
    expect(out.token).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).password).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).card).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
    expect(((out.list as unknown[])[0] as Record<string, unknown>).apiKey).toBe('[redacted]');
  });

  it('preserva valores não sensíveis e tipos primitivos', () => {
    expect(redact({ level: 'info', count: 2 })).toEqual({ level: 'info', count: 2 });
    expect(redact('texto')).toBe('texto');
    expect(redact(null)).toBeNull();
  });
});

describe('assertStoreAccess (fail closed)', () => {
  it('ADMIN acessa qualquer loja', () => {
    expect(() => assertStoreAccess(reqAs('ADMIN', null), 'loja-2')).not.toThrow();
  });

  it('STORE_MANAGER acessa a própria loja', () => {
    expect(() => assertStoreAccess(reqAs('STORE_MANAGER', 'loja-1'), 'loja-1')).not.toThrow();
  });

  it('STORE_MANAGER é negado em loja alheia', () => {
    expect(() => assertStoreAccess(reqAs('STORE_MANAGER', 'loja-1'), 'loja-2')).toThrow();
  });

  it('recurso sem loja é negado ao STORE_MANAGER (fail closed)', () => {
    expect(() => assertStoreAccess(reqAs('STORE_MANAGER', 'loja-1'), null)).toThrow();
    expect(() => assertStoreAccess(reqAs('STORE_MANAGER', 'loja-1'), undefined)).toThrow();
  });

  it('STORE_MANAGER sem loja associada é negado (fail closed)', () => {
    expect(() => assertStoreAccess(reqAs('STORE_MANAGER', null), 'loja-1')).toThrow();
  });
});

describe('scopedStoreId', () => {
  it('STORE_MANAGER é sempre restrito à própria loja', () => {
    expect(scopedStoreId(reqAs('STORE_MANAGER', 'loja-1'), 'loja-2')).toBe('loja-1');
  });

  it('STORE_MANAGER sem loja não enxerga nada (fail closed)', () => {
    expect(scopedStoreId(reqAs('STORE_MANAGER', null), undefined)).toBe('__none__');
  });

  it('ADMIN filtra livremente', () => {
    expect(scopedStoreId(reqAs('ADMIN', null), 'loja-2')).toBe('loja-2');
    expect(scopedStoreId(reqAs('ADMIN', null), undefined)).toBeUndefined();
  });
});

describe('parseDays (janela limitada)', () => {
  it('aceita valores válidos e trunca decimais', () => {
    expect(parseDays('30')).toBe(30);
    expect(parseDays('7.9')).toBe(7);
  });

  it('rejeita zero, negativos, não numéricos e acima do teto', () => {
    expect(parseDays('0')).toBe(30);
    expect(parseDays('-5')).toBe(30);
    expect(parseDays('abc')).toBe(30);
    expect(parseDays('99999')).toBe(30);
  });
});
