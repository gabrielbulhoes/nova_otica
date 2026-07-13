import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { toNumber } from '../../http/helpers.js';
import type { CdsInserirVendaPayload, SellbieClient } from '../../integrations/sellbie/index.js';

const log = logger.child({ mod: 'erp-export' });

/** Lote máximo por ciclo — mantém o passo curto dentro da janela da CDS. */
const EXPORT_BATCH = 50;

/** Pedido pago com tudo que o payload da CDS precisa. */
export interface ExportableOrder {
  number: string;
  customerName: string | null;
  total: number;
  paymentMethod: string | null;
  items: {
    quantity: number;
    unitPrice: number;
    productExternalId: string;
    productDescription: string;
  }[];
}

/** PIX | CARD | BOLETO → descricaoForma esperada pelo ERP. */
function descricaoForma(method: string | null): string {
  switch (method) {
    case 'PIX':
      return 'PIX';
    case 'CARD':
      return 'CARTAO DE CREDITO';
    case 'BOLETO':
      return 'BOLETO';
    default:
      return 'OUTROS';
  }
}

const FORMA_VAZIA = {
  banco: '',
  agencia: '',
  numDoc: '',
  nsu: '',
  finalCartao: '',
  descBandeira: '',
  codCartao: '',
  autorizacao: '',
};

/**
 * Monta o JSON do POST /cds/inserirvenda a partir de um pedido online pago.
 * Função pura — o formato segue a documentação oficial da CDS.
 *
 * - `pedidoSite` recebe o nosso Order.number: é a referência que permite ao
 *   ERP (e a nós) deduplicar/localizar a venda;
 * - endereço/CPF ficam vazios: o checkout online não os coleta hoje
 *   (consumidor final). Quando o checkout coletar CPF, preencher aqui.
 */
export function buildInserirVendaPayload(order: ExportableOrder): CdsInserirVendaPayload {
  return {
    dadosCliente: {
      cpfCnpj: '',
      nomeCliente: order.customerName?.trim() || 'Consumidor Final',
      razaoSocial: '',
      logradouro: '',
      numero: '',
      complemento: '',
      bairro: '',
      cidade: '',
      UF: '',
      cep: '',
      celular: '',
      email: '',
      consumoFinal: '1',
    },
    funcionario: env.SELLBIE_EXPORT_SELLER,
    pedidoSite: order.number,
    formasPagamento: [
      {
        descricaoForma: descricaoForma(order.paymentMethod),
        valorForma: order.total,
        parcelasForma: 1,
        dataVenctoForma: null,
        ...FORMA_VAZIA,
      },
    ],
    dadosProdutos: order.items.map((it) => ({
      codigoProduto: it.productExternalId,
      descricaoProduto: it.productDescription,
      valorVendido: it.unitPrice,
      quantidadeVendida: it.quantity,
    })),
    finalizarVenda: { descontoPerc: 0, descontoValor: 0, acrescimo: 0, motivoDesconto: null },
  };
}

/**
 * Exporta ao ERP os pedidos PAGOS ainda não exportados (write-back).
 *
 * Idempotência local: um pedido só é reenviado enquanto `erpExportedAt` for
 * nulo; sucesso grava o carimbo e apaga o erro. A CDS não documenta
 * idempotência no inserirvenda, por isso o cliente HTTP não faz retry — uma
 * falha fica registrada em `erpExportError` e a nova tentativa acontece no
 * próximo ciclo, sempre com o mesmo `pedidoSite` (referência de deduplicação
 * do lado do ERP).
 */
export async function exportPaidOrdersToErp(client: SellbieClient): Promise<{ read: number; written: number }> {
  const orders = await prisma.order.findMany({
    where: { status: 'PAID', erpExportedAt: null },
    orderBy: { paidAt: 'asc' },
    take: EXPORT_BATCH,
    include: { items: { include: { product: true } }, payment: true },
  });

  let written = 0;
  for (const order of orders) {
    const payload = buildInserirVendaPayload({
      number: order.number,
      customerName: order.customerName,
      total: toNumber(order.total) ?? 0,
      paymentMethod: order.payment?.method ?? null,
      items: order.items.map((it) => ({
        quantity: it.quantity,
        unitPrice: toNumber(it.unitPrice) ?? 0,
        productExternalId: it.product.externalId,
        productDescription: it.product.description,
      })),
    });

    try {
      await client.inserirVenda(payload);
      await prisma.order.update({
        where: { id: order.id },
        data: { erpExportedAt: new Date(), erpExportError: null },
      });
      written += 1;
      log.info('Pedido exportado ao ERP', { pedidoSite: order.number });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.order.update({
        where: { id: order.id },
        data: { erpExportError: message },
      });
      log.error('Falha ao exportar pedido ao ERP', { pedidoSite: order.number, error: message });
    }
  }

  return { read: orders.length, written };
}
