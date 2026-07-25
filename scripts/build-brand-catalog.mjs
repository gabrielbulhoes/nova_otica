/**
 * Gera apps/api/data/brand-catalog.json a partir da planilha de grifes por PDV
 * (exportada como CSV: colunas Loja, Grife, Grupo, Fornecedor, Status).
 *
 *   node scripts/build-brand-catalog.mjs /caminho/PDVs_Grifes.csv
 *
 * Saída (GITIGNORADA — é dado comercial real):
 *   {
 *     "supplierByBrand": { "GUCCI": "Kering", ... },   // marca → fornecedor (1:1)
 *     "premiumStores":   { "GUCCI": ["A GRACIOSA IGUATEMI", ...], ... }
 *   }
 *
 * Regras:
 *  - fornecedor canônico = o mais frequente por marca (após normalizar apelidos);
 *  - premiumStores só inclui linhas ATIVAS (Status vazio); "Não compramos mais"
 *    não entra (a loja não trabalha mais aquela grife);
 *  - marcas fora desta planilha são CORRENTES e valem para todas as lojas — por
 *    isso não aparecem aqui (o consumidor trata a ausência como "universal").
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// Apelidos de fornecedor confirmados pelo cliente.
const SUPPLIER_ALIASES = {
  DERIGO: 'DeRigo',
  'KALID33': 'Kalid',
  'KALID 33': 'Kalid',
  'KALID 34': 'Kalid',
  LTX: 'Moscott',
};

// MESMA normalização de normBrandKey() em planning.math.ts — manter em sincronia.
const norm = (s) =>
  (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* ignora */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Uso: node scripts/build-brand-catalog.mjs <arquivo.csv>');
  process.exit(1);
}
const rows = parseCsv(readFileSync(csvPath, 'utf8')).filter((r) => r.some((c) => c && c.trim()));
const header = rows.shift().map((h) => norm(h));
const col = (name) => header.indexOf(norm(name));
const iLoja = col('Loja'), iGrife = col('Grife'), iForn = col('Fornecedor'), iStatus = col('Status');
if (iLoja < 0 || iGrife < 0 || iForn < 0) {
  console.error('CSV precisa das colunas Loja, Grife, Fornecedor (e Status).');
  process.exit(1);
}

const supplierVotes = new Map(); // grife → Map(fornecedor → contagem)
const premium = new Map();       // grife → Set(loja normalizada)
for (const r of rows) {
  const grife = norm(r[iGrife]);
  if (!grife) continue;
  let forn = (r[iForn] ?? '').trim();
  forn = SUPPLIER_ALIASES[norm(forn)] ?? forn;
  const active = iStatus < 0 ? true : (r[iStatus] ?? '').trim() === '';
  if (forn) {
    const m = supplierVotes.get(grife) ?? new Map();
    m.set(forn, (m.get(forn) ?? 0) + 1);
    supplierVotes.set(grife, m);
  }
  if (active) {
    const set = premium.get(grife) ?? new Set();
    set.add(norm(r[iLoja]));
    premium.set(grife, set);
  }
}

const supplierByBrand = {};
for (const [grife, votes] of supplierVotes) {
  supplierByBrand[grife] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
const premiumStores = {};
for (const [grife, set] of premium) premiumStores[grife] = [...set].sort();

const outDir = path.resolve('apps/api/data');
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'brand-catalog.json');
writeFileSync(out, JSON.stringify({ supplierByBrand, premiumStores }, null, 2));
console.log(
  `OK → ${out}\n  marcas: ${Object.keys(supplierByBrand).length}` +
    ` | fornecedores: ${new Set(Object.values(supplierByBrand)).size}` +
    ` | grifes premium com loja: ${Object.keys(premiumStores).length}`,
);
