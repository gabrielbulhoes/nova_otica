/**
 * Normalização dos payloads REAIS da CDS para o formato persistido.
 * Baseado em amostras de produção (sonda de 13/07/2026). Centraliza as
 * idiossincrasias do conector:
 * - padding de espaços à direita em textos;
 * - "1900-01-01" como data-nula e "naotem" como e-mail-nulo;
 * - números como string ("1092.00", "5");
 * - codigo_venda que repete entre lojas (identidade composta loja-venda);
 * - CPF formatado que precisa casar entre /clientes e /vendas (join por dígitos);
 * - /estoquegrade em MAIÚSCULAS com estoque aninhado por filial;
 * - typo `categora` de /produtos.
 */
import type {
  SellbieCliente,
  SellbieContaPagar,
  SellbieCor,
  SellbieDetalheVenda,
  SellbieEstoqueGrade,
  SellbieLoja,
  SellbiePagamentoVenda,
  SellbieProduto,
  SellbieTamanho,
  SellbieVenda,
  SellbieVendedor,
} from './types.js';

/** String sem padding; vazio/null → undefined. */
export const str = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
};

/** Identificador estável: trim + string (aceita number). */
export const idStr = (v: unknown): string => String(v ?? '').trim();

export const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export const int = (v: unknown): number => {
  const n = num(v);
  return n === undefined ? 0 : Math.trunc(n);
};

/** Só os dígitos — para casar CPF/CNPJ entre rotas com máscaras diferentes. */
export const digits = (v: unknown): string | undefined => {
  const s = str(v);
  if (!s) return undefined;
  const d = s.replace(/\D/g, '');
  return d === '' ? undefined : d;
};

/**
 * Datas do conector: "aaaa-mm-dd" ou "aaaa-mm-dd hh:mm:ss.mmm".
 * "1900-01-01" é placeholder de "não informado" → undefined.
 */
export const date = (v: unknown): Date | undefined => {
  const s = str(v);
  if (!s || s.startsWith('1900-01-01')) return undefined;
  const iso = s.length === 10 ? `${s}T00:00:00` : s.replace(' ', 'T');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

export const mapLoja = (l: SellbieLoja) => ({
  externalId: idStr(l.codigo_loja),
  code: str(l.codigo_loja),
  name: str(l.nome_fantasia) ?? `Loja ${idStr(l.codigo_loja)}`,
  // O conector não envia cidade/UF/telefone; CNPJ/CEP chegam mas ainda não
  // têm coluna (entram no cadastro fiscal por loja, incremento próprio).
  city: undefined as string | undefined,
  state: undefined as string | undefined,
  phone: undefined as string | undefined,
  active: true,
});

export const mapVendedor = (v: SellbieVendedor) => ({
  // A chave do vendedor no conector é o próprio nome (padded).
  externalId: idStr(v.codigo_vendedor),
  name: str(v.nome) ?? idStr(v.codigo_vendedor) ?? 'Vendedor',
  externalStoreId: str(v.codigo_loja),
  active: (str(v.estado) ?? '').toLowerCase() !== 'desativado',
  includedAt: date(v.data_cadastro) ?? date(v.data_admissao),
});

export const mapCor = (c: SellbieCor) => ({
  externalId: idStr(c.codigo),
  name: str(c.nome) ?? '—',
  hex: undefined as string | undefined,
});

export const mapTamanho = (t: SellbieTamanho) => ({
  externalId: idStr(t.codigo),
  name: str(t.nome) ?? '—',
});

export const mapProduto = (p: SellbieProduto) => ({
  externalId: idStr(p.codigo_base),
  sku: str(p.sku),
  description: str(p.nome) ?? `Produto ${idStr(p.codigo_base)}`,
  brand: str(p.nome_fornecedor),
  // `categora` é typo real do conector — cai como categoria quando a
  // classificação não vier.
  category: str(p.classificacao) ?? str(p.categora),
  externalColorId: str(p.codigo_cor),
  externalSizeId: undefined as string | undefined,
  price: num(p.valor_venda),
  cost: num(p.valor_compra),
  active: (str(p.status) ?? 'Ativo').toLowerCase() === 'ativo',
  includedAt: date(p.data_cadastro),
});

export const mapCliente = (c: SellbieCliente) => {
  const doc = digits(c.cpf);
  const email = str(c.email);
  const celular = [str(c.ddd_celular), str(c.celular)].filter(Boolean).join(' ');
  const fixo = [str(c.ddd_telefone), str(c.telefone)].filter(Boolean).join(' ');
  return {
    // CPF (dígitos) é a única chave estável que o conector expõe p/ cliente.
    externalId: doc ?? '',
    document: doc,
    name: str(c.nome) ?? 'Cliente',
    // "naotem" é o placeholder de vazio usado na base da rede.
    email: email && email.toLowerCase() !== 'naotem' ? email : undefined,
    phone: celular || fixo || undefined,
    city: str(c.cidade),
    state: str(c.estado),
    includedAt: date(c.data_inclusao),
  };
};

/** Identidade composta da venda — codigo_venda repete entre lojas. */
export const saleExternalId = (codigoLoja: unknown, codigoVenda: unknown): string =>
  `${idStr(codigoLoja)}-${idStr(codigoVenda)}`;

export const mapVenda = (v: SellbieVenda) => ({
  externalId: saleExternalId(v.codigo_loja, v.codigo_venda),
  externalStoreId: str(v.codigo_loja),
  externalSellerId: str(v.codigo_vendedor),
  externalCustomerDoc: digits(v.cpf_cliente),
  saleDate: date(v.data) ?? new Date(),
  total: num(v.valor_pago) ?? 0,
  discount: undefined as number | undefined,
  status: str(v.status),
});

export const mapDetalheVenda = (d: SellbieDetalheVenda) => {
  const quantity = int(d.quantidade) || 1;
  // valor_liquido é o TOTAL da linha; o unitário é derivado.
  const total = num(d.valor_liquido) ?? 0;
  return {
    externalId: `${saleExternalId(d.codigo_loja, d.codigo_venda)}-${idStr(d.item) || '1'}`,
    externalSaleId: saleExternalId(d.codigo_loja, d.codigo_venda),
    externalProductId: str(d.codigo_produto),
    quantity,
    unitPrice: Math.round((total / quantity) * 100) / 100,
    discount: undefined as number | undefined,
    total,
  };
};

export const mapPagamento = (p: SellbiePagamentoVenda) => ({
  // O conector não expõe id do pagamento; a parcela dentro da venda é a
  // identidade natural (venda + nº da parcela).
  externalId: `${saleExternalId(p.codigo_loja, p.codigo_venda)}-p${int(p.parcela_atual) || 1}`,
  externalSaleId: saleExternalId(p.codigo_loja, p.codigo_venda),
  method: str(p.forma_pag),
  amount: num(p.valor_forma_pag) ?? 0,
  installments: num(p.qtd_parcelas),
  paidAt: date(p.data_venda),
});

/**
 * Achata uma linha da grade (produto×variante) nas posições por loja:
 * o campo ESTOQUE é um objeto { "NOME DA FILIAL": { ID_FILIAL, ESTOQUE } }.
 * A soma por (produto, loja) entre variantes fica a cargo do sync.
 */
export const mapEstoqueGrade = (
  g: SellbieEstoqueGrade,
): { externalProductId: string; externalStoreId: string; quantity: number }[] => {
  const productId = idStr(g.CODIGO);
  if (!productId || !g.ESTOQUE || typeof g.ESTOQUE !== 'object') return [];
  return Object.values(g.ESTOQUE)
    .filter((f) => f && f.ID_FILIAL !== undefined && f.ID_FILIAL !== null)
    .map((f) => ({
      externalProductId: productId,
      externalStoreId: idStr(f.ID_FILIAL),
      quantity: int(f.ESTOQUE),
    }));
};

export const mapContaPagar = (c: SellbieContaPagar) => ({
  externalId: idStr(c.conta),
  dueDate: date(c.data_vencimento),
  paidAt: date(c.data_pagamento),
  externalStoreId: str(c.loja),
  costCenter: str(c.centro_custo),
  group: str(c.grupo_conta),
  amount: num(c.valor_conta) ?? 0,
  payee: str(c.pagador_conta),
});
