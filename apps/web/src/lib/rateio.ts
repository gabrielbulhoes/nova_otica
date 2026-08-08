import { toCsv } from '../bi/csv';
import type { DistributionBasis, NeedBasis, PurchaseOrder } from '../api/client';

/**
 * Formatação pura do rateio por loja e do pedido de compra — o CSV, os rótulos
 * de coluna e as datas.
 *
 * Mora FORA do .tsx por uma razão que custou caro: enquanto isto era um punhado
 * de funções dentro de Planning.tsx, o web não tinha como testá-lo (as seis
 * suítes daqui são todas de módulo puro, e não existe harness de componente).
 * O resultado foi um CSV exportado com TODAS as colunas de loja em zero durante
 * uma frente inteira, com o typecheck verde — porque o tipo do web era
 * declarado à mão e divergia do que a API mandava. Lógica que produz um NÚMERO
 * para o gestor não pode morar onde nenhum teste alcança.
 */

/**
 * Rótulo da coluna que EXPLICA a participação, por base do rateio.
 *
 * Existe porque a coluna e o percentual têm que falar da mesma base. Quando o
 * rateio cai na reserva, o peso não é a venda desta peça — é a da grife, a da
 * categoria ou a da rede —, e rotular de "Vendeu" um número que veio da grife
 * convida o gestor a conferir uma conta que não fecha.
 */
export function rotuloDoPeso(basis: DistributionBasis | NeedBasis, janela: string): string {
  switch (basis) {
    case 'marca':
      return `Vendeu da grife (${janela})`;
    case 'categoria':
      return `Vendeu da categoria (${janela})`;
    case 'rede':
      return `Vendeu no total (${janela})`;
    // 'necessidade', 'participacao' e 'sku' pesam a venda DESTA peça.
    default:
      return `Vendeu (${janela})`;
  }
}

export const deadlineDate = (inDays: number) =>
  new Date(Date.now() + inDays * 86400000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

export const slug = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');

/**
 * Linhas do CSV de uma ordem de compra (uma por item + total).
 *
 * O rateio vira COLUNAS, uma por loja, e não linhas: quem abre este arquivo o
 * abre para conferir e para mandar ao fornecedor, e uma linha por (item ×
 * loja) multiplicaria o pedido por 16 e o tornaria ilegível como pedido. Em
 * coluna, o total de cada item continua sendo o total do item, e a divisão
 * viaja junto para quem for receber a mercadoria.
 */
export function orderCsv(order: PurchaseOrder): string {
  type Row = Record<string, number | string>;
  // As colunas de loja saem da união das lojas citadas em qualquer item — um
  // item pode não ter linha para uma loja (falta zero), e a coluna precisa
  // existir mesmo assim, com 0, senão os cabeçalhos mudam item a item.
  const lojas: string[] = [];
  for (const it of order.items) {
    for (const r of it.distribution?.rows ?? []) if (!lojas.includes(r.storeName)) lojas.push(r.storeName);
  }
  lojas.sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const porLoja = (it: PurchaseOrder['items'][number]): Row => {
    const out: Row = {};
    const byName = new Map((it.distribution?.rows ?? []).map((r) => [r.storeName, r.suggestedQty]));
    // Sem rateio (não-ADMIN, ou visão de uma loja só), a coluna fica VAZIA e
    // não zero: zero afirmaria que a loja não recebe nada, e a verdade é que
    // ninguém calculou.
    for (const l of lojas) out[`loja:${l}`] = it.distribution ? (byName.get(l) ?? 0) : '';
    return out;
  };

  const rows: Row[] = order.items.map((it) => ({
    fornecedor: order.supplier,
    marca: it.brand ?? '',
    produto: it.description,
    categoria: it.category ?? '',
    quantidade: it.quantity,
    custoUnit: it.unitCost.toFixed(2).replace('.', ','),
    total: it.total.toFixed(2).replace('.', ','),
    pedirAte: it.orderByInDays === null ? '' : it.orderByInDays === 0 ? 'hoje' : deadlineDate(it.orderByInDays),
    prazoEntregaDias: order.leadTimeDays,
    baseDoRateio: it.distribution?.basis ?? 'não calculado',
    faltaNaRede: it.distribution ? String(it.distribution.totalNeed).replace('.', ',') : '',
    ...porLoja(it),
  }));
  rows.push({
    fornecedor: order.supplier,
    marca: '',
    produto: 'TOTAL DO PEDIDO',
    categoria: '',
    quantidade: order.units,
    custoUnit: '',
    total: order.total.toFixed(2).replace('.', ','),
    pedirAte: order.orderByInDays === null ? '' : order.orderByInDays === 0 ? 'hoje' : deadlineDate(order.orderByInDays),
    prazoEntregaDias: order.leadTimeDays,
    baseDoRateio: '',
    faltaNaRede: '',
    ...Object.fromEntries(
      lojas.map((l) => [
        `loja:${l}`,
        order.items.reduce(
          (a, it) => a + ((it.distribution?.rows.find((r) => r.storeName === l)?.suggestedQty) ?? 0),
          0,
        ),
      ]),
    ),
  });
  return toCsv(rows, [
    { key: 'fornecedor', label: 'Fornecedor' },
    { key: 'marca', label: 'Marca' },
    { key: 'produto', label: 'Produto' },
    { key: 'categoria', label: 'Categoria' },
    { key: 'quantidade', label: 'Quantidade' },
    { key: 'custoUnit', label: 'Custo unit. (R$)' },
    { key: 'total', label: 'Total (R$)' },
    { key: 'pedirAte', label: 'Pedir até' },
    { key: 'prazoEntregaDias', label: 'Prazo de entrega (dias)' },
    { key: 'baseDoRateio', label: 'Base do rateio' },
    { key: 'faltaNaRede', label: 'Falta na rede (un.)' },
    ...lojas.map((l) => ({ key: `loja:${l}`, label: l })),
  ]);
}
