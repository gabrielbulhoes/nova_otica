import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { badRequest } from '../../http/helpers.js';
import type { PaymentIntent, PaymentMethod, PaymentProvider } from './payment.provider.js';

const MP_API = 'https://api.mercadopago.com';

/**
 * Provedor Mercado Pago (PIX). Esqueleto funcional: cria o pagamento PIX via
 * API oficial e consulta o status. Requer MP_ACCESS_TOKEN (sandbox ou
 * produção). Cartão/boleto ficam para depois do checkout transparente.
 */
export class MercadoPagoProvider implements PaymentProvider {
  readonly name = 'mercadopago';

  async createPayment(input: {
    orderNumber: string;
    amount: number;
    method?: PaymentMethod;
  }): Promise<PaymentIntent> {
    const method = input.method ?? 'PIX';
    if (method !== 'PIX') {
      throw badRequest('Por enquanto o Mercado Pago está habilitado apenas para PIX.');
    }
    const res = await fetch(`${MP_API}/v1/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        // Idempotência: repetir o mesmo pedido não cria pagamento duplicado.
        'X-Idempotency-Key': `nova-otica-${input.orderNumber}`,
      },
      body: JSON.stringify({
        transaction_amount: Math.round(input.amount * 100) / 100,
        payment_method_id: 'pix',
        description: `Nova Ótica — pedido ${input.orderNumber}`,
        external_reference: input.orderNumber,
        payer: { email: env.MP_PAYER_EMAIL || 'comprador@novaotica.com' },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw badRequest(`Mercado Pago recusou a criação do pagamento (${res.status}). ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      id: number;
      status: string;
      point_of_interaction?: { transaction_data?: { qr_code?: string } };
    };
    return {
      externalId: String(data.id),
      status: data.status === 'approved' ? 'APPROVED' : 'PENDING',
      method,
      qrCode: data.point_of_interaction?.transaction_data?.qr_code,
    };
  }

  async confirmPayment(externalId: string): Promise<{ status: 'APPROVED' | 'DECLINED' | 'PENDING' }> {
    const res = await fetch(`${MP_API}/v1/payments/${externalId}`, {
      headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
    });
    if (!res.ok) return { status: 'PENDING' };
    const data = (await res.json()) as { status: string };
    if (data.status === 'approved') return { status: 'APPROVED' };
    if (data.status === 'rejected' || data.status === 'cancelled' || data.status === 'refunded') {
      return { status: 'DECLINED' };
    }
    return { status: 'PENDING' }; // pending | in_process | authorized…
  }
}

/**
 * Verificação pura da assinatura de webhook do Mercado Pago (x-signature).
 * Formato do cabeçalho: "ts=<epoch>,v1=<hmac-sha256-hex>"; o manifest assinado
 * é `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` com o segredo do painel.
 * Tolerância de relógio evita replay de notificações antigas.
 */
export function verifyMercadoPagoSignature(input: {
  signatureHeader: string | undefined;
  requestId: string | undefined;
  dataId: string;
  secret: string;
  nowMs: number;
  toleranceMs?: number;
}): boolean {
  if (!input.signatureHeader || !input.requestId || !input.secret) return false;
  const parts = new Map(
    input.signatureHeader.split(',').map((p) => {
      const [k, ...v] = p.trim().split('=');
      return [k, v.join('=')] as const;
    }),
  );
  const ts = parts.get('ts');
  const v1 = parts.get('v1');
  if (!ts || !v1) return false;

  const tolerance = input.toleranceMs ?? 5 * 60 * 1000;
  const tsMs = Number(ts) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(input.nowMs - tsMs) > tolerance) return false;

  const manifest = `id:${input.dataId};request-id:${input.requestId};ts:${ts};`;
  const expected = createHmac('sha256', input.secret).update(manifest).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
