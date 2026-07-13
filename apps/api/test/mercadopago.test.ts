import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyMercadoPagoSignature } from '../src/modules/commerce/mercadopago.provider.js';

const SECRET = 'segredo-do-painel';

function sign(dataId: string, requestId: string, tsSec: number, secret = SECRET) {
  const manifest = `id:${dataId};request-id:${requestId};ts:${tsSec};`;
  const v1 = createHmac('sha256', secret).update(manifest).digest('hex');
  return `ts=${tsSec},v1=${v1}`;
}

describe('verifyMercadoPagoSignature', () => {
  const now = 1_700_000_000_000;
  const ts = Math.floor(now / 1000);

  it('aceita assinatura válida dentro da tolerância', () => {
    const header = sign('12345', 'req-1', ts);
    expect(
      verifyMercadoPagoSignature({ signatureHeader: header, requestId: 'req-1', dataId: '12345', secret: SECRET, nowMs: now }),
    ).toBe(true);
  });

  it('rejeita segredo errado, dataId trocado e request-id trocado', () => {
    const header = sign('12345', 'req-1', ts);
    expect(verifyMercadoPagoSignature({ signatureHeader: header, requestId: 'req-1', dataId: '12345', secret: 'outro', nowMs: now })).toBe(false);
    expect(verifyMercadoPagoSignature({ signatureHeader: header, requestId: 'req-1', dataId: '99999', secret: SECRET, nowMs: now })).toBe(false);
    expect(verifyMercadoPagoSignature({ signatureHeader: header, requestId: 'req-2', dataId: '12345', secret: SECRET, nowMs: now })).toBe(false);
  });

  it('rejeita timestamp fora da tolerância (anti-replay)', () => {
    const old = ts - 10 * 60; // 10 min atrás (tolerância padrão: 5)
    const header = sign('12345', 'req-1', old);
    expect(verifyMercadoPagoSignature({ signatureHeader: header, requestId: 'req-1', dataId: '12345', secret: SECRET, nowMs: now })).toBe(false);
  });

  it('rejeita cabeçalho ausente/malformado sem lançar', () => {
    expect(verifyMercadoPagoSignature({ signatureHeader: undefined, requestId: 'r', dataId: '1', secret: SECRET, nowMs: now })).toBe(false);
    expect(verifyMercadoPagoSignature({ signatureHeader: 'lixo', requestId: 'r', dataId: '1', secret: SECRET, nowMs: now })).toBe(false);
    expect(verifyMercadoPagoSignature({ signatureHeader: 'ts=abc,v1=zz', requestId: 'r', dataId: '1', secret: SECRET, nowMs: now })).toBe(false);
  });
});
