import { describe, it, expect } from 'vitest';
import { resolveThreshold } from '../src/modules/alerts/alerts.service.js';

describe('resolveThreshold (mínimo por loja > produto > rede)', () => {
  it('usa o mínimo da loja quando definido', () => {
    expect(resolveThreshold(7, 3, 5)).toBe(7);
    expect(resolveThreshold(0, 3, 5)).toBe(0); // zero é valor válido, não "ausente"
  });

  it('cai para o mínimo do produto sem override da loja', () => {
    expect(resolveThreshold(null, 3, 5)).toBe(3);
    expect(resolveThreshold(undefined, 0, 5)).toBe(0);
  });

  it('cai para o padrão da rede sem loja nem produto', () => {
    expect(resolveThreshold(null, null, 5)).toBe(5);
    expect(resolveThreshold(undefined, undefined, 5)).toBe(5);
  });
});
