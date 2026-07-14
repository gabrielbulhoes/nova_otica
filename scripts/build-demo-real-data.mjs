/**
 * Gera apps/web/src/api/demo-real-data.json a partir dos fixtures da sonda
 * CDS (cds-fixtures/), para a DEMO ESTÁTICA exibir dados reais da rede.
 *
 *   node scripts/build-demo-real-data.mjs /caminho/para/cds-fixtures
 *
 * PRIVACIDADE (por construção):
 * - clientes.json NUNCA é lido; nenhum CPF/nome/contato de cliente entra;
 * - de vendas, só entram agregados (por loja/dia/produto/forma de pagamento);
 * - de vendedores entra APENAS o ranking agregado (nome + vendas do período,
 *   feedback 10 do Galbe — dado de equipe para a própria gestão; nada de CPF,
 *   admissão ou contato).
 * O JSON gerado é GITIGNORADO: contém dados de negócio reais (estoque,
 * faturamento) e só deve existir no build destinado à rede — publique com
 * proteção de acesso (.htaccess) por conter números comerciais.
 *
 * CATÁLOGO AMOSTRADO para o bundle ficar leve: todos os produtos recentes
 * (/produtos), todos os vendidos no período e o top-N por estoque da grade.
 * Os TOTAIS do painel (faturamento, unidades, nº de produtos) são os da rede
 * INTEIRA, calculados aqui antes do corte.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const GRADE_TOP_BY_STOCK = 600;

const dir = process.argv[2];
if (!dir) {
  console.error('Uso: node scripts/build-demo-real-data.mjs <dir-cds-fixtures>');
  process.exit(1);
}
const load = (name) => JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8'));

const lojas = load('lojas');
const produtos = load('produtos');
const grade = load('estoquegrade');
const vendas = load('vendas').filter((v) => (v.status ?? 'Válido') === 'Válido');
const detalhes = load('detalhesVendas').filter((d) => (d.status_produto_vendido ?? 'Válido') === 'Válido');
const pagamentos = load('pagamentosVendas');

const trim = (s) => String(s ?? '').trim();
const num = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;

// ─── Lojas ────────────────────────────────────────────────────────────────────
const stores = lojas.map((l) => ({
  externalId: trim(l.codigo_loja),
  name: trim(l.nome_fantasia) || `Loja ${trim(l.codigo_loja)}`,
}));

// ─── Estoque da grade (rede inteira) ─────────────────────────────────────────
// stock[produto][loja] = qtd (variantes somadas); catálogo mínimo p/ exibição.
const stockByProduct = new Map(); // ext -> Map(storeExt -> qty)
const gradeInfo = new Map(); // ext -> { nome, grupo, preco }
for (const g of grade) {
  const ext = trim(g.CODIGO);
  if (!ext) continue;
  if (!gradeInfo.has(ext)) {
    gradeInfo.set(ext, { nome: trim(g.DESCRICAO), grupo: trim(g.GRUPO), preco: num(g.PRECO_VENDA) });
  }
  const per = stockByProduct.get(ext) ?? new Map();
  for (const f of Object.values(g.ESTOQUE ?? {})) {
    const st = trim(f?.ID_FILIAL);
    if (!st) continue;
    per.set(st, (per.get(st) ?? 0) + Math.trunc(num(f.ESTOQUE)));
  }
  stockByProduct.set(ext, per);
}
const totalUnitsNetwork = [...stockByProduct.values()].reduce(
  (a, per) => a + [...per.values()].reduce((x, y) => x + y, 0),
  0,
);
// Unidades em estoque por loja — rede INTEIRA (antes do corte do catálogo),
// para a cobertura por loja não subcontar.
const stockUnitsByStore = new Map(); // lojaExt -> unidades
for (const per of stockByProduct.values())
  for (const [st, qty] of per) stockUnitsByStore.set(st, (stockUnitsByStore.get(st) ?? 0) + qty);

// ─── Vendas (30 dias) — agregados, nada identificável ────────────────────────
const vendaLoja = new Map(); // "loja-venda" -> lojaExt
const salesByStoreMap = new Map(); // lojaExt -> {count,total}
const daily = new Map(); // date -> {total,count}
const weekdayStore = new Map(); // "loja|wd" -> total
for (const v of vendas) {
  const loja = trim(v.codigo_loja);
  const keyV = `${loja}-${trim(v.codigo_venda)}`;
  vendaLoja.set(keyV, loja);
  const total = num(v.valor_pago);
  const s = salesByStoreMap.get(loja) ?? { count: 0, total: 0 };
  s.count += 1;
  s.total = round2(s.total + total);
  salesByStoreMap.set(loja, s);
  const dia = trim(v.data).slice(0, 10);
  if (dia) {
    const d = daily.get(dia) ?? { total: 0, count: 0 };
    d.total = round2(d.total + total);
    d.count += 1;
    daily.set(dia, d);
    const wd = new Date(`${dia}T12:00:00`).getDay();
    const wk = `${loja}|${wd}`;
    weekdayStore.set(wk, round2((weekdayStore.get(wk) ?? 0) + total));
  }
}

const soldByStoreProduct = new Map(); // "loja|prod" -> units
const productSales = new Map(); // prodExt -> {units, revenue}
for (const d of detalhes) {
  const loja = trim(d.codigo_loja) || vendaLoja.get(`${trim(d.codigo_loja)}-${trim(d.codigo_venda)}`) || '';
  const prod = trim(d.codigo_produto);
  if (!prod) continue;
  const qty = Math.max(1, Math.trunc(num(d.quantidade)));
  const revenue = num(d.valor_liquido);
  if (loja) {
    const k = `${loja}|${prod}`;
    soldByStoreProduct.set(k, (soldByStoreProduct.get(k) ?? 0) + qty);
  }
  const ps = productSales.get(prod) ?? { units: 0, revenue: 0 };
  ps.units += qty;
  ps.revenue = round2(ps.revenue + revenue);
  productSales.set(prod, ps);
}

// Unidades e receita (de itens) vendidas por loja — rede inteira.
const soldUnitsByStore = new Map(); // lojaExt -> unidades
for (const [k, qty] of soldByStoreProduct) {
  const st = k.split('|')[0];
  soldUnitsByStore.set(st, (soldUnitsByStore.get(st) ?? 0) + qty);
}
const soldRevenueByStore = new Map(); // lojaExt -> receita (valor_liquido dos itens)
for (const d of detalhes) {
  const st = trim(d.codigo_loja);
  if (!st) continue;
  soldRevenueByStore.set(st, round2((soldRevenueByStore.get(st) ?? 0) + num(d.valor_liquido)));
}

const byPayment = new Map(); // forma -> {total,count}
for (const p of pagamentos) {
  const forma = trim(p.forma_pag) || 'OUTROS';
  const b = byPayment.get(forma) ?? { total: 0, count: 0 };
  b.total = round2(b.total + num(p.valor_forma_pag));
  b.count += 1;
  byPayment.set(forma, b);
}

// Vendas por VENDEDOR (top 40 por receita) — dados de equipe, uso interno da
// gestão (o site é protegido por senha de diretório). A venda traz o
// codigo_vendedor; o nome vem do cadastro /vendedores. Receita pela venda;
// unidades pelos itens (join loja+venda -> vendedor).
const vendedores = load('vendedores');
const nomeVendedor = new Map(vendedores.map((v) => [trim(v.codigo_vendedor), trim(v.nome)]));
const vendaVendedor = new Map(); // "loja-venda" -> nome do vendedor
const sellerAgg = new Map(); // nome -> {units, revenue, sales}
for (const v of vendas) {
  const cod = trim(v.codigo_vendedor);
  const nome = nomeVendedor.get(cod) || cod;
  if (!nome) continue;
  vendaVendedor.set(`${trim(v.codigo_loja)}-${trim(v.codigo_venda)}`, nome);
  const s = sellerAgg.get(nome) ?? { units: 0, revenue: 0, sales: 0 };
  s.revenue = round2(s.revenue + num(v.valor_pago));
  s.sales += 1;
  sellerAgg.set(nome, s);
}
for (const d of detalhes) {
  const nome = vendaVendedor.get(`${trim(d.codigo_loja)}-${trim(d.codigo_venda)}`);
  if (!nome) continue;
  const s = sellerAgg.get(nome);
  if (s) s.units += Math.max(1, Math.trunc(num(d.quantidade)));
}
const bySeller = [...sellerAgg.entries()]
  .map(([label, v]) => ({ label, ...v }))
  .sort((a, b) => b.revenue - a.revenue)
  .slice(0, 40);

// Cobertura por MARCA (rede inteira): estoque da grade + vendas do período,
// com marca vinda de /produtos (grade não traz fornecedor -> "Sem marca").
const brandByExt = new Map(); // ext -> marca
for (const p of produtos) {
  const ext = trim(p.codigo_base);
  const marca = trim(p.nome_fornecedor);
  if (ext && marca) brandByExt.set(ext, marca);
}
const brandCoverageMap = new Map(); // marca -> {stockUnits, soldUnits}
const brandBucket = (ext) => {
  const marca = brandByExt.get(ext) || 'Sem marca';
  const cur = brandCoverageMap.get(marca) ?? { stockUnits: 0, soldUnits: 0 };
  brandCoverageMap.set(marca, cur);
  return cur;
};
for (const [ext, per] of stockByProduct)
  brandBucket(ext).stockUnits += [...per.values()].reduce((a, b) => a + b, 0);
for (const [ext, ps] of productSales) brandBucket(ext).soldUnits += ps.units;
const brandCoverage = [...brandCoverageMap.entries()].map(([label, v]) => ({ label, ...v }));

// Estoque × vendas por LOJA × MARCA e por LOJA × GRUPO — rede inteira, para o
// mix por bandeira e o Modo Feira da demo. Categoria: /produtos primeiro,
// senão o GRUPO da grade.
const catByExt = new Map(); // ext -> grupo/categoria
for (const p of produtos) {
  const ext = trim(p.codigo_base);
  const cat = trim(p.classificacao) || trim(p.categora);
  if (ext && cat) catByExt.set(ext, cat);
}
for (const [ext, g] of gradeInfo) if (!catByExt.has(ext) && g.grupo) catByExt.set(ext, g.grupo);

const storeBrandMap = new Map(); // "loja|marca" -> {stockUnits, soldUnits}
const storeCategoryMap = new Map(); // "loja|grupo" -> {stockUnits, soldUnits}
const bump = (map, st, dim, field, qty) => {
  const k = `${st}|${dim}`;
  const cur = map.get(k) ?? { stockUnits: 0, soldUnits: 0 };
  cur[field] += qty;
  map.set(k, cur);
};
for (const [ext, per] of stockByProduct) {
  const marca = brandByExt.get(ext) || 'Sem marca';
  const grupo = catByExt.get(ext) || 'OUTROS';
  for (const [st, qty] of per) {
    bump(storeBrandMap, st, marca, 'stockUnits', qty);
    bump(storeCategoryMap, st, grupo, 'stockUnits', qty);
  }
}
for (const [k, qty] of soldByStoreProduct) {
  const [st, ext] = k.split('|');
  const marca = brandByExt.get(ext) || 'Sem marca';
  const grupo = catByExt.get(ext) || 'OUTROS';
  bump(storeBrandMap, st, marca, 'soldUnits', qty);
  bump(storeCategoryMap, st, grupo, 'soldUnits', qty);
}
const unpack = (map) =>
  [...map.entries()].map(([k, v]) => {
    const [storeExt, label] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
    return { storeExt, label, ...v };
  });
const storeBrand = unpack(storeBrandMap);
const storeCategory = unpack(storeCategoryMap);

// ─── Catálogo amostrado ──────────────────────────────────────────────────────
const catalog = new Map(); // ext -> product
for (const p of produtos) {
  const ext = trim(p.codigo_base);
  if (!ext) continue;
  catalog.set(ext, {
    externalId: ext,
    sku: trim(p.sku) || ext,
    description: trim(p.nome) || `Produto ${ext}`,
    brand: trim(p.nome_fornecedor),
    // Mesma resolução do catByExt (classificacao || categora || grupo da grade)
    // para o grupo do catálogo casar com os baldes de storeCategory (Modo Feira).
    category: catByExt.get(ext) || 'OUTROS',
    price: num(p.valor_venda),
    cost: num(p.valor_compra) || null,
  });
}
const fromGrade = (ext) => {
  const g = gradeInfo.get(ext) ?? {};
  return {
    externalId: ext,
    sku: ext,
    description: g.nome || `Produto ${ext}`,
    brand: '',
    category: g.grupo || 'OUTROS',
    price: g.preco || 0,
    cost: null,
  };
};
// Todos os vendidos entram (planejamento/giro reais):
for (const ext of productSales.keys()) if (!catalog.has(ext)) catalog.set(ext, fromGrade(ext));
// Top-N da grade por estoque total:
const byStockDesc = [...stockByProduct.entries()]
  .map(([ext, per]) => [ext, [...per.values()].reduce((a, b) => a + b, 0)])
  .sort((a, b) => b[1] - a[1]);
let added = 0;
for (const [ext] of byStockDesc) {
  if (added >= GRADE_TOP_BY_STOCK) break;
  if (!catalog.has(ext)) {
    catalog.set(ext, fromGrade(ext));
    added += 1;
  }
}

// stock/sold só do catálogo amostrado (o resto vive nos totais):
const stock = [];
for (const [ext, per] of stockByProduct) {
  if (!catalog.has(ext)) continue;
  for (const [st, qty] of per) stock.push([st, ext, qty]);
}
const sold = [];
for (const [k, qty] of soldByStoreProduct) {
  const [st, ext] = k.split('|');
  if (catalog.has(ext)) sold.push([st, ext, qty]);
}

// byBrand/byCategory (30d) a partir do catálogo:
const byBrand = new Map();
const byCategory = new Map();
for (const [ext, ps] of productSales) {
  const c = catalog.get(ext);
  if (!c) continue;
  const b = c.brand || '—';
  const g = c.category || 'OUTROS';
  const vb = byBrand.get(b) ?? { total: 0, count: 0 };
  vb.total = round2(vb.total + ps.revenue);
  vb.count += ps.units;
  byBrand.set(b, vb);
  const vg = byCategory.get(g) ?? { total: 0, count: 0 };
  vg.total = round2(vg.total + ps.revenue);
  vg.count += ps.units;
  byCategory.set(g, vg);
}

const out = {
  label: 'Dados reais da rede · amostra estática',
  generatedFrom: 'sonda CDS 13/07/2026 (30 dias de vendas; estoque da grade completa)',
  totals: {
    revenue30d: round2(vendas.reduce((a, v) => a + num(v.valor_pago), 0)),
    salesCount30d: vendas.length,
    stockUnitsNetwork: totalUnitsNetwork,
    productCountNetwork: stockByProduct.size,
    catalogSampled: catalog.size,
    storeCount: stores.length,
  },
  stores,
  products: [...catalog.values()],
  stock,
  sold,
  salesByStore: stores.map((s) => ({
    externalId: s.externalId,
    name: s.name,
    ...(salesByStoreMap.get(s.externalId) ?? { count: 0, total: 0 }),
  })),
  // Cobertura por loja (rede inteira): unidades em estoque e vendidas no
  // período completo — independentes da amostragem do catálogo acima.
  storeStats: stores.map((s) => ({
    externalId: s.externalId,
    stockUnits: stockUnitsByStore.get(s.externalId) ?? 0,
    soldUnits: soldUnitsByStore.get(s.externalId) ?? 0,
    soldRevenue: soldRevenueByStore.get(s.externalId) ?? 0,
  })),
  bySeller,
  brandCoverage,
  storeBrand,
  storeCategory,
  dailySales: [...daily.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, v]) => ({ date, ...v })),
  byPayment: [...byPayment.entries()].map(([label, v]) => ({ label, ...v })),
  byBrand: [...byBrand.entries()].map(([label, v]) => ({ label, ...v })),
  byCategory: [...byCategory.entries()].map(([label, v]) => ({ label, ...v })),
  productSales: [...productSales.entries()]
    .filter(([ext]) => catalog.has(ext))
    .map(([externalId, v]) => ({ externalId, ...v })),
  weekdayStore: [...weekdayStore.entries()].map(([k, total]) => {
    const [storeExt, wd] = k.split('|');
    return { storeExt, weekday: Number(wd), total };
  }),
};

const dest = path.resolve('apps/web/src/api/demo-real-data.json');
writeFileSync(dest, JSON.stringify(out));
const kb = Math.round(Buffer.byteLength(JSON.stringify(out)) / 1024);
console.log(`OK: ${dest} (${kb} KB) — ${out.products.length} produtos amostrados de ${out.totals.productCountNetwork}; ` +
  `${out.stores.length} lojas; R$ ${out.totals.revenue30d} em ${out.totals.salesCount30d} vendas (30d).`);
