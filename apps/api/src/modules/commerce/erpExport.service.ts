import axios from 'axios';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { toNumber } from '../../http/helpers.js';
import { checkWindow, WindowClosedError } from '../../integrations/sellbie/window.js';
import type { CdsInserirVendaPayload, SellbieClient } from '../../integrations/sellbie/index.js';
import type { PaymentMethod } from './payment.provider.js';

const log = logger.child({ mod: 'erp-export' });

/** Lote por consulta e teto de lotes por ciclo (mantém o passo curto na janela). */
const EXPORT_BATCH = 50;
const MAX_BATCHES = 10;
/** Após N tentativas falhas o pedido sai da fila automática (pedido "veneno"). */
const MAX_ATTEMPTS = 5;

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

/**
 * PIX | CARD | BOLETO → descricaoForma do ERP. Tipado sobre o union
 * PaymentMethod: método novo sem mapeamento cai em OUTROS, mas o Record
 * parcial força quem adicionar o método a passar por aqui.
 */
const DESCRICAO_FORMA: Record<PaymentMethod, string> = {
  PIX: 'PIX',
  CARD: 'CARTAO DE CREDITO',
  BOLETO: 'BOLETO',
};
function descricaoForma(method: string | null): string {
  return DESCRICAO_FORMA[method as PaymentMethod] ?? 'OUTROS';
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Monta o JSON do POST /cds/inserirvenda a partir de um pedido online pago.
 * Função pura — o formato segue a documentação oficial da CDS.
 *
 * - `pedidoSite` recebe o nosso Order.number: é a referência que permite ao
 *   ERP (e a nós) deduplicar/localizar a venda;
 * - desconto/acréscimo são derivados da diferença entre a soma dos itens e o
 *   total pago (em centavos, sem deriva de ponto flutuante) — assim a venda
 *   fecha a conta do lado do ERP mesmo quando houver cupom ou frete;
 * - endereço/CPF ficam vazios: o checkout online não os coleta hoje
 *   (consumidor final). Quando o checkout coletar CPF, preencher aqui;
 * - limitação conhecida: uma única forma de pagamento com parcelasForma=1 —
 *   o checkout atual é PIX à vista; parcelado/split exigirá evoluir aqui.
 */
export function buildInserirVendaPayload(order: ExportableOrder): CdsInserirVendaPayload {
  const itemsCents = order.items.reduce((sum, it) => sum + Math.round(it.unitPrice * 100) * it.quantity, 0);
  const totalCents = Math.round(order.total * 100);
  const diff = itemsCents - totalCents;
  const descontoValor = diff > 0 ? diff / 100 : 0;
  const acrescimo = diff < 0 ? -diff / 100 : 0;

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
        valorForma: round2(order.total),
        parcelasForma: 1,
        dataVenctoForma: null,
        banco: '',
        agencia: '',
        numDoc: '',
        nsu: '',
        finalCartao: '',
        descBandeira: '',
        codCartao: '',
        autorizacao: '',
      },
    ],
    dadosProdutos: order.items.map((it) => ({
      codigoProduto: it.productExternalId,
      descricaoProduto: it.productDescription,
      valorVendido: it.unitPrice,
      quantidadeVendida: it.quantity,
    })),
    finalizarVenda: {
      descontoPerc: 0,
      descontoValor,
      acrescimo,
      motivoDesconto: descontoValor > 0 ? 'Desconto aplicado no pedido online' : null,
    },
  };
}

/** Mensagem de erro acionável: status HTTP + corpo da resposta do ERP. */
function detailError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const body = err.response?.data !== undefined ? JSON.stringify(err.response.data).slice(0, 400) : '';
    return `HTTP ${status ?? '—'}${body ? ` — ${body}` : ` — ${err.message}`}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export interface ErpExportResult {
  read: number;
  written: number;
  failed: number;
  skipped: number;
}

/**
 * Exporta ao ERP os pedidos PAGOS ainda não exportados (write-back).
 *
 * Semântica de outbox com claim atômico (padrão ADR-01 da base):
 * - cada pedido é RESERVADO via `updateMany` condicional antes do POST —
 *   dois exportadores concorrentes (sync agendado × rota manual) nunca
 *   enviam o mesmo pedido duas vezes;
 * - sucesso grava `erpExportedAt` (nunca reexporta); falha grava
 *   `erpExportError` detalhado e o pedido volta à fila até MAX_ATTEMPTS;
 * - claim sem desfecho registrado (crash entre o POST e o carimbo) deixa o
 *   pedido em estado "interrompido" (attemptedAt ≠ null, sem erro, sem
 *   sucesso): ele NÃO é reenviado automaticamente — como a CDS não documenta
 *   idempotência, reenviar um envio ambíguo poderia duplicar a venda.
 *   Verifique no ERP (pelo pedidoSite) e reprocesse com `retryStuck`;
 * - a janela da CDS é verificada a cada pedido; fechou, o lote para sem
 *   marcar erro nos pedidos restantes.
 *
 * Lança erro ao final se houver falhas reais (track() do sync transforma em
 * alerta operacional); janela fechada não conta como falha.
 */
export async function exportPaidOrdersToErp(
  client: SellbieClient,
  opts: { retryStuck?: boolean } = {},
): Promise<ErpExportResult> {
  let read = 0;
  let written = 0;
  let failed = 0;
  let skipped = 0;
  let lastError = '';
  let windowClosed = false;
  // Pedidos já tratados NESTE ciclo: um pedido que falhou não volta à fila
  // do mesmo run (o retry é no próximo ciclo, nunca em rajada contra o ERP).
  const seen: string[] = [];

  for (let batch = 0; batch < MAX_BATCHES && !windowClosed; batch += 1) {
    const orders = await prisma.order.findMany({
      where: {
        status: 'PAID',
        erpExportedAt: null,
        erpExportAttempts: { lt: MAX_ATTEMPTS },
        id: { notIn: seen },
        OR: [
          { erpExportAttemptedAt: null }, // nunca tentado
          { erpExportError: { not: null } }, // falha registrada → retry seguro
          ...(opts.retryStuck ? [{ erpExportAttemptedAt: { not: null } }] : []), // interrompidos, sob demanda
        ],
      },
      orderBy: { paidAt: 'asc' },
      take: EXPORT_BATCH,
      include: { items: { include: { product: true } }, payment: true },
    });
    if (orders.length === 0) break;
    read += orders.length;

    for (const order of orders) {
      seen.push(order.id);
      if (!checkWindow().allowed) {
        windowClosed = true;
        log.warn('Janela da CDS fechada — export interrompido; retoma no próximo ciclo', {
          pendentes: orders.length,
        });
        break;
      }

      // Claim atômico: só um exportador "vence" cada pedido (padrão da base:
      // updateMany condicional). A condição casa exatamente o estado lido —
      // o vencedor o altera, e qualquer concorrente deixa de casar:
      // - virgem: attemptedAt ainda nulo;
      // - retry de falha: o erro ainda registrado (o vencedor o limpa);
      // - interrompido (só com retryStuck): o attemptedAt exato da tentativa.
      const claimGuard =
        order.erpExportAttemptedAt === null
          ? { erpExportAttemptedAt: null }
          : order.erpExportError !== null
            ? { erpExportError: { not: null } }
            : { erpExportAttemptedAt: order.erpExportAttemptedAt, erpExportError: null };
      const claim = await prisma.order.updateMany({
        where: { id: order.id, erpExportedAt: null, ...claimGuard },
        data: {
          erpExportAttemptedAt: new Date(),
          erpExportError: null,
          erpExportAttempts: { increment: 1 },
        },
      });
      if (claim.count === 0) {
        // Outro exportador (ou o retryStuck de outra chamada) já reservou.
        skipped += 1;
        continue;
      }

      const total = toNumber(order.total);
      if (total === null || !Number.isFinite(total) || total <= 0 || order.items.length === 0) {
        failed += 1;
        lastError = 'Pedido sem itens ou com total inválido — não exportado.';
        await prisma.order.update({ where: { id: order.id }, data: { erpExportError: lastError } });
        log.error('Pedido inexportável', { pedidoSite: order.number, total: String(order.total) });
        continue;
      }

      const payload = buildInserirVendaPayload({
        number: order.number,
        customerName: order.customerName,
        total,
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
        const message = detailError(err);
        await prisma.order.update({
          where: { id: order.id },
          data: { erpExportError: message },
        });
        if (err instanceof WindowClosedError) {
          // Janela fechou entre o pré-check e o POST: estado fica retryável
          // e o lote para — sem espalhar erro pelos pedidos restantes.
          windowClosed = true;
          break;
        }
        failed += 1;
        lastError = message;
        log.error('Falha ao exportar pedido ao ERP', { pedidoSite: order.number, error: message });
      }
    }
  }

  if (failed > 0) {
    // Visível na operação: track() do sync grava o erro da entidade e o
    // alerta de falha dispara — um ERP fora do ar não passa em silêncio.
    throw new Error(
      `${failed} pedido(s) falharam no envio ao ERP (${written} exportados neste ciclo). Último erro: ${lastError}`,
    );
  }
  return { read, written, failed, skipped };
}
