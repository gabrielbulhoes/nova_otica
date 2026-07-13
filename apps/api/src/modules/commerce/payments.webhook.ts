import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { asyncHandler } from '../../http/helpers.js';
import { verifyMercadoPagoSignature } from './mercadopago.provider.js';
import { confirmPayment } from './checkout.service.js';

const log = logger.child({ mod: 'payments-webhook' });

export const paymentsWebhookRouter = Router();

/**
 * POST /api/payments/webhook — notificação do Mercado Pago. Rota pública
 * (o gateway não autentica via JWT); a autenticidade vem da assinatura
 * x-signature (HMAC com o segredo do painel). O conteúdo da notificação é
 * tratado apenas como GATILHO: o status real é reconsultado na API do MP
 * dentro de confirmPayment (nunca confiamos no corpo do webhook).
 */
paymentsWebhookRouter.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const dataId = String(
      (req.query['data.id'] as string | undefined) ??
        (req.body as { data?: { id?: string | number } })?.data?.id ??
        '',
    );
    const type = String((req.query.type as string | undefined) ?? (req.body as { type?: string })?.type ?? '');

    if (!dataId || type !== 'payment') return res.status(200).json({ ignored: true });

    const valid = verifyMercadoPagoSignature({
      signatureHeader: req.headers['x-signature'] as string | undefined,
      requestId: req.headers['x-request-id'] as string | undefined,
      dataId,
      secret: env.MP_WEBHOOK_SECRET,
      nowMs: Date.now(),
    });
    if (!valid) {
      log.warn('Webhook de pagamento com assinatura inválida', { dataId });
      return res.status(401).json({ error: 'assinatura inválida' });
    }

    const payment = await prisma.onlinePayment.findFirst({ where: { externalId: dataId } });
    if (!payment) {
      log.warn('Webhook para pagamento desconhecido', { dataId });
      return res.status(200).json({ ignored: true });
    }

    try {
      // Reconsulta o provedor e efetiva (ou libera) conforme o status real.
      await confirmPayment(payment.orderId);
    } catch (err) {
      // PENDING/recusado geram exceção de negócio — o webhook responde 200
      // para o MP não redisparar em loop; o estado fica correto no banco.
      log.info('Webhook processado sem aprovação', {
        dataId,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return res.status(200).json({ ok: true });
  }),
);
