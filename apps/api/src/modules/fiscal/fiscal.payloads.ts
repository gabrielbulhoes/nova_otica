/**
 * Construtores PUROS dos payloads fiscais (formato Focus NFe). O que é
 * matemática/estrutura fica aqui e é testado; o que é parametrização contábil
 * (NCM, CFOP, CSOSN) vem de configuração — valores default para o Simples
 * Nacional e óptica, a ajustar com o contador antes da produção.
 */

export interface FiscalItemInput {
  sku: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface FiscalConfigInput {
  /** CNPJ do emitente (loja). */
  cnpj: string;
  /** NCM padrão dos itens (ex.: 9003.11.00 — armações de óculos). */
  ncmDefault: string;
  /** CFOP da venda ao consumidor (padrão 5102) ou da transferência (5152). */
  cfop: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function buildItens(items: FiscalItemInput[], cfg: FiscalConfigInput) {
  return items.map((it, i) => ({
    numero_item: i + 1,
    codigo_produto: it.sku ?? `ITEM-${i + 1}`,
    descricao: it.description,
    cfop: cfg.cfop,
    codigo_ncm: cfg.ncmDefault,
    unidade_comercial: 'UN',
    quantidade_comercial: it.quantity,
    valor_unitario_comercial: round2(it.unitPrice),
    valor_bruto: round2(it.quantity * it.unitPrice),
    // Simples Nacional (CSOSN 102 — sem permissão de crédito). Ajustar com o
    // contador conforme o regime tributário real da rede.
    icms_situacao_tributaria: '102',
    icms_origem: 0,
  }));
}

/** NFC-e de venda ao consumidor a partir de um pedido pago. */
export function buildNfcePayload(input: {
  orderNumber: string;
  customerName: string | null;
  items: FiscalItemInput[];
  config: FiscalConfigInput;
}) {
  const itens = buildItens(input.items, input.config);
  const total = round2(itens.reduce((a, i) => a + i.valor_bruto, 0));
  return {
    natureza_operacao: 'VENDA AO CONSUMIDOR',
    presenca_comprador: 1, // operação presencial/entrega direta
    cnpj_emitente: input.config.cnpj,
    referencia_interna: input.orderNumber,
    nome_destinatario: input.customerName ?? undefined,
    valor_total: total,
    formas_pagamento: [{ forma_pagamento: '99', valor_pagamento: total }],
    itens,
  };
}

/** NF-e de transferência de mercadoria entre filiais (mesma titularidade). */
export function buildTransferNfePayload(input: {
  reference: string;
  item: FiscalItemInput;
  fromCnpj: string;
  toCnpj: string;
  config: Omit<FiscalConfigInput, 'cnpj'>;
}) {
  const itens = buildItens([input.item], { ...input.config, cnpj: input.fromCnpj });
  return {
    natureza_operacao: 'TRANSFERENCIA DE MERCADORIA',
    finalidade_emissao: 1,
    cnpj_emitente: input.fromCnpj,
    cnpj_destinatario: input.toCnpj,
    referencia_interna: input.reference,
    valor_total: itens[0].valor_bruto,
    itens,
  };
}
