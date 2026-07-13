import { env } from '../../config/env.js';
import { MercadoPagoProvider } from './mercadopago.provider.js';
/**
 * Abstração do gateway de pagamento. O checkout fala apenas com esta
 * interface — trocar o provedor (Mercado Pago, Stripe, Pagar.me…) não afeta o
 * restante do fluxo. Enquanto o gateway não é definido, usamos o MockProvider.
 */
export type PaymentMethod = 'PIX' | 'CARD' | 'BOLETO';

export interface PaymentIntent {
  externalId: string;
  status: 'PENDING' | 'APPROVED';
  method: PaymentMethod;
  qrCode?: string;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: { orderNumber: string; amount: number; method?: PaymentMethod }): Promise<PaymentIntent>;
  /**
   * Consulta/captura um pagamento. PENDING = ainda aguardando o pagador
   * (não cancela o pedido); DECLINED = recusado (libera as reservas).
   */
  confirmPayment(externalId: string): Promise<{ status: 'APPROVED' | 'DECLINED' | 'PENDING' }>;
}

/** Provedor de demonstração — aprova sempre e gera um "PIX" fake. */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  async createPayment(input: { orderNumber: string; amount: number; method?: PaymentMethod }): Promise<PaymentIntent> {
    const method = input.method ?? 'PIX';
    return {
      externalId: `mock_${input.orderNumber}`,
      status: 'PENDING',
      method,
      qrCode: method === 'PIX' ? `00020126MOCK-${input.orderNumber}-${input.amount.toFixed(2)}` : undefined,
    };
  }

  async confirmPayment(_externalId: string): Promise<{ status: 'APPROVED' | 'DECLINED' | 'PENDING' }> {
    return { status: 'APPROVED' };
  }
}

let provider: PaymentProvider | null = null;

/** Retorna o provedor configurado via env PAYMENT_PROVIDER (mock padrão). */
export function getPaymentProvider(): PaymentProvider {
  if (!provider) {
    provider =
      env.PAYMENT_PROVIDER === 'mercadopago' ? new MercadoPagoProvider() : new MockPaymentProvider();
  }
  return provider;
}
