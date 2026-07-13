import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { badRequest, notFound, toNumber } from '../../http/helpers.js';
import { buildNfcePayload, buildTransferNfePayload } from './fiscal.payloads.js';
import { getFiscalProvider, type FiscalEmissionResult } from './fiscal.provider.js';

const cfgBase = () => ({ ncmDefault: env.FISCAL_NCM_DEFAULT, cnpj: env.FISCAL_CNPJ });

async function persistResult(ref: string, r: FiscalEmissionResult) {
  return prisma.fiscalDocument.update({
    where: { ref },
    data: {
      status: r.status,
      accessKey: r.accessKey,
      number: r.number,
      series: r.series,
      danfeUrl: r.danfeUrl,
      xmlUrl: r.xmlUrl,
      error: r.error ?? null,
    },
  });
}

/**
 * Emite a NFC-e de um pedido PAGO. Idempotente por ref (nfce-<orderId>):
 * reemitir devolve/reconsulta o documento existente em vez de duplicar nota.
 */
export async function emitOrderNfce(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } } },
  });
  if (!order) throw notFound('Pedido não encontrado');
  if (order.status !== 'PAID') throw badRequest('Só é possível emitir NFC-e de pedido pago.');

  const ref = `nfce-${orderId}`;
  const existing = await prisma.fiscalDocument.findUnique({ where: { ref } });
  if (existing && existing.status !== 'REJECTED') {
    if (existing.status === 'PROCESSING') {
      return persistResult(ref, await getFiscalProvider().status('nfce', ref));
    }
    return existing;
  }

  const doc =
    existing ??
    (await prisma.fiscalDocument.create({
      data: { type: 'NFCE', ref, orderId, provider: getFiscalProvider().name },
    }));

  const payload = buildNfcePayload({
    orderNumber: order.number,
    customerName: order.customerName,
    items: order.items.map((it) => ({
      sku: it.product.sku,
      description: it.product.description,
      quantity: it.quantity,
      unitPrice: toNumber(it.unitPrice) ?? 0,
    })),
    config: { ...cfgBase(), cfop: env.FISCAL_CFOP_NFCE },
  });
  void doc;
  return persistResult(ref, await getFiscalProvider().emit('nfce', ref, payload));
}

/** Emite a NF-e de uma transferência entre filiais já efetivada. Idempotente. */
export async function emitTransferNfe(movementId: string) {
  const mov = await prisma.inventoryMovement.findUnique({
    where: { id: movementId },
    include: { product: true, fromStore: true, toStore: true },
  });
  if (!mov) throw notFound('Movimentação não encontrada');
  if (mov.type !== 'TRANSFER') throw badRequest('NF-e de transferência só se aplica a TRANSFER.');
  if (mov.status !== 'CONFIRMED' && mov.status !== 'RECONCILED') {
    throw badRequest('A transferência precisa estar efetivada (CONFIRMED/RECONCILED).');
  }
  if (!mov.fromStore || !mov.toStore) throw badRequest('Transferência sem origem/destino.');

  const ref = `nfe-mov-${movementId}`;
  const existing = await prisma.fiscalDocument.findUnique({ where: { ref } });
  if (existing && existing.status !== 'REJECTED') {
    if (existing.status === 'PROCESSING') {
      return persistResult(ref, await getFiscalProvider().status('nfe', ref));
    }
    return existing;
  }

  if (!existing) {
    await prisma.fiscalDocument.create({
      data: { type: 'NFE', ref, movementId, provider: getFiscalProvider().name },
    });
  }

  const unitCost = toNumber(mov.product.cost) ?? (toNumber(mov.product.price) ?? 0) * 0.55;
  const payload = buildTransferNfePayload({
    reference: ref,
    item: { sku: mov.product.sku, description: mov.product.description, quantity: mov.quantity, unitPrice: unitCost },
    // CNPJ por loja fica para quando o cadastro fiscal por filial existir;
    // por ora o emitente/destinatário usam o CNPJ da rede (env).
    fromCnpj: env.FISCAL_CNPJ,
    toCnpj: env.FISCAL_CNPJ,
    config: { ncmDefault: env.FISCAL_NCM_DEFAULT, cfop: env.FISCAL_CFOP_TRANSFER },
  });
  return persistResult(ref, await getFiscalProvider().emit('nfe', ref, payload));
}

export async function listFiscalDocuments(limit = 100) {
  return prisma.fiscalDocument.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      order: { select: { number: true } },
      movement: { select: { id: true, product: { select: { description: true } } } },
    },
  });
}
