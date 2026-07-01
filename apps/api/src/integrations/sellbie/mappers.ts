/**
 * Normalização dos payloads brutos da Sellbie para o formato persistido.
 * Centraliza coerções (string<->number, datas, booleanos) e o tratamento
 * de campos ausentes. Ajuste aqui quando receber exemplos reais de resposta.
 */
import type {
  SellbieCliente,
  SellbieCor,
  SellbieDetalheVenda,
  SellbieEstoque,
  SellbieLoja,
  SellbiePagamentoVenda,
  SellbieProduto,
  SellbieTamanho,
  SellbieVenda,
  SellbieVendedor,
} from './types.js';

export const str = (v: unknown): string | undefined =>
  v === null || v === undefined || v === '' ? undefined : String(v);

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

export const bool = (v: unknown, fallback = true): boolean => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 's', 'sim', 'ativo'].includes(s)) return true;
  if (['0', 'false', 'n', 'nao', 'não', 'inativo'].includes(s)) return false;
  return fallback;
};

/** Converte "aaaa-mm-dd" (ou ISO) em Date; retorna undefined se inválida. */
export const date = (v: unknown): Date | undefined => {
  const s = str(v);
  if (!s) return undefined;
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

export const mapLoja = (l: SellbieLoja) => ({
  externalId: idStr(l.idFilial),
  code: str(l.codigo),
  name: str(l.nome) ?? str(l.razaoSocial) ?? `Filial ${idStr(l.idFilial)}`,
  city: str(l.cidade),
  state: str(l.uf),
  phone: str(l.telefone),
  active: bool(l.ativo),
});

export const mapVendedor = (v: SellbieVendedor) => ({
  externalId: idStr(v.funcionario),
  name: str(v.nome) ?? `Vendedor ${idStr(v.funcionario)}`,
  externalStoreId: str(v.idFilial),
  active: bool(v.ativo),
  includedAt: date(v.dataInclusao),
});

export const mapCor = (c: SellbieCor) => ({
  externalId: idStr(c.codigo ?? c.id),
  name: str(c.nome) ?? str(c.descricao) ?? '—',
  hex: str(c.hex),
});

export const mapTamanho = (t: SellbieTamanho) => ({
  externalId: idStr(t.codigo ?? t.id),
  name: str(t.nome) ?? str(t.descricao) ?? '—',
});

export const mapProduto = (p: SellbieProduto) => ({
  externalId: idStr(p.prodCodigo),
  sku: str(p.sku),
  description: str(p.descricao) ?? `Produto ${idStr(p.prodCodigo)}`,
  brand: str(p.marca),
  category: str(p.categoria) ?? str(p.tipo),
  externalColorId: str(p.corCodigo),
  externalSizeId: str(p.tamanhoCodigo),
  price: num(p.precoVenda),
  cost: num(p.precoCusto),
  active: bool(p.ativo),
  includedAt: date(p.dataInclusao),
});

export const mapCliente = (c: SellbieCliente) => ({
  externalId: idStr(c.id ?? c.cpfCnpj),
  document: str(c.cpfCnpj),
  name: str(c.nome) ?? 'Cliente',
  email: str(c.email),
  phone: str(c.telefone),
  city: str(c.cidade),
  state: str(c.uf),
  includedAt: date(c.dataInclusao),
});

export const mapVenda = (v: SellbieVenda) => ({
  externalId: idStr(v.idVenda ?? v.id),
  externalStoreId: str(v.idFilial),
  externalSellerId: str(v.funcionario),
  externalCustomerDoc: str(v.cpfCnpj),
  saleDate: date(v.dataVenda) ?? new Date(),
  total: num(v.valorTotal) ?? 0,
  discount: num(v.desconto),
  status: str(v.situacao),
});

export const mapDetalheVenda = (d: SellbieDetalheVenda) => ({
  externalId: str(d.id),
  externalSaleId: idStr(d.idVenda),
  externalProductId: str(d.prodCodigo),
  quantity: int(d.quantidade) || 1,
  unitPrice: num(d.valorUnitario) ?? 0,
  discount: num(d.desconto),
  total: num(d.valorTotal) ?? 0,
});

export const mapPagamento = (p: SellbiePagamentoVenda) => ({
  externalId: str(p.id),
  externalSaleId: idStr(p.idVenda),
  method: str(p.formaPagamento),
  amount: num(p.valor) ?? 0,
  installments: num(p.parcelas),
  paidAt: date(p.dataPagamento),
});

export const mapEstoque = (e: SellbieEstoque) => ({
  externalStoreId: idStr(e.idFilial),
  externalProductId: idStr(e.prodCodigo),
  quantity: int(e.quantidade),
  available: int(e.disponivel ?? e.quantidade),
});
