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
  /** Confirma/captura um pagamento (simula o retorno do gateway/webhook). */
  confirmPayment(externalId: string): Promise<{ status: 'APPROVED' | 'DECLINED' }>;
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

  async confirmPayment(_externalId: string): Promise<{ status: 'APPROVED' | 'DECLINED' }> {
    return { status: 'APPROVED' };
  }
}

let provider: PaymentProvider | null = null;

/** Retorna o provedor configurado (hoje: mock; futuro: conforme env). */
export function getPaymentProvider(): PaymentProvider {
  if (!provider) provider = new MockPaymentProvider();
  return provider;
}
