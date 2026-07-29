/**
 * Extrai as seis fixtures do conector CDS para alimentar o gerador da
 * demonstração (scripts/build-demo-real-data.mjs).
 *
 *   node scripts/extrair-fixtures-cds.mjs ./cds-fixtures
 *   node scripts/extrair-fixtures-cds.mjs ./cds-fixtures --env=/caminho/.env
 *   node scripts/extrair-fixtures-cds.mjs ./cds-fixtures --dias=30
 *
 * É AUTOCONTIDO de propósito: só precisa do Node (18+), de mais nada do
 * repositório e de nenhum pacote instalado. Assim ele roda na máquina onde a
 * credencial já está, sem que ela precise viajar para lugar nenhum.
 *
 * CREDENCIAIS — lidas nesta ordem:
 *   1. variáveis de ambiente já exportadas;
 *   2. arquivo .env indicado em --env (ou ./apps/api/.env, se existir).
 * Elas nunca são impressas, nem em erro. Não cole credencial em chat: o
 * histórico persiste e sincroniza entre dispositivos.
 *
 * PRIVACIDADE: cds/clientes NÃO é buscado. Traz CPF, nome e contato, e o
 * gerador da demonstração nunca lê esse arquivo. Não há opção para ligar isso.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// ─── Argumentos ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (nome, padrao) => {
  const hit = args.find((a) => a.startsWith(`--${nome}=`));
  return hit ? hit.slice(nome.length + 3) : padrao;
};
const outDir = args.find((a) => !a.startsWith('--')) ?? './cds-fixtures';
const dias = Number(flag('dias', '30'));
const envPath = flag('env', path.resolve('apps/api/.env'));

if (!Number.isFinite(dias) || dias < 1) {
  console.error('--dias precisa ser um inteiro positivo.');
  process.exit(1);
}

// ─── Credenciais ─────────────────────────────────────────────────────────────

function lerEnv(arquivo) {
  if (!existsSync(arquivo)) return {};
  const out = {};
  for (const linha of readFileSync(arquivo, 'utf8').split('\n')) {
    const t = linha.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const [k, ...resto] = t.split('=');
    out[k.trim()] = resto.join('=').trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const doArquivo = lerEnv(envPath);
const cfg = (k) => process.env[k] ?? doArquivo[k] ?? '';

const BASE = cfg('SELLBIE_BASE_URL').replace(/\/+$/, '');
const KEY = cfg('SELLBIE_API_KEY');
const TOKEN = cfg('SELLBIE_API_TOKEN');
const CLIENTE = cfg('SELLBIE_CLIENT_ID');

const faltando = [
  ['SELLBIE_BASE_URL', BASE],
  ['SELLBIE_API_KEY', KEY],
  ['SELLBIE_API_TOKEN', TOKEN],
  ['SELLBIE_CLIENT_ID', CLIENTE],
].filter(([, v]) => !v).map(([k]) => k);

if (faltando.length) {
  console.error(`Faltam credenciais: ${faltando.join(', ')}`);
  console.error(`Procurei nas variáveis de ambiente e em ${envPath}.`);
  console.error('Exporte as variáveis ou aponte o arquivo com --env=/caminho/.env');
  process.exit(1);
}

// ─── Datas ───────────────────────────────────────────────────────────────────

const iso = (d) => d.toISOString().slice(0, 10);
const hoje = new Date();
const inicio = new Date(hoje);
inicio.setDate(inicio.getDate() - dias);
const janela = { date_start: iso(inicio), date_end: iso(hoje) };

// ─── As seis entidades ───────────────────────────────────────────────────────
//
// `minimo` é uma sanidade grosseira: abaixo disso quase certamente a janela
// está errada ou a resposta veio truncada, e é melhor falhar aqui do que três
// etapas adiante, quando o número estranho já virou gráfico.

const ENTIDADES = [
  { arquivo: 'lojas', rota: 'cds/lojas', params: {}, minimo: 1 },
  { arquivo: 'produtos', rota: 'cds/produtos', params: janela, minimo: 1 },
  { arquivo: 'estoquegrade', rota: 'cds/estoquegrade', params: { only_disp: 1 }, minimo: 1 },
  { arquivo: 'vendas', rota: 'cds/vendas', params: janela, minimo: 1 },
  { arquivo: 'detalhesVendas', rota: 'cds/detalhesVendas', params: janela, minimo: 1 },
  { arquivo: 'pagamentosVendas', rota: 'cds/pagamentosVendas', params: janela, minimo: 1 },
];

/**
 * O conector às vezes devolve a lista crua e às vezes embrulhada. O gerador da
 * demonstração faz `.filter()` na raiz do arquivo, então o que gravamos tem
 * que ser SEMPRE um array — envelope não desembrulhado quebra a etapa
 * seguinte com um erro que não diz o que houve.
 */
function desembrulhar(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const k of ['data', 'results', 'items', 'rows', 'registros']) {
      if (Array.isArray(payload[k])) return payload[k];
    }
  }
  return null;
}

async function buscar({ rota, params }) {
  const url = new URL(`${BASE}/${rota}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { x_api_key: KEY, x_api_token: TOKEN, x_cliente_id: CLIENTE },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Execução ────────────────────────────────────────────────────────────────

mkdirSync(outDir, { recursive: true });
console.log(`Janela: ${janela.date_start} → ${janela.date_end} (${dias} dias)`);
console.log(`Saída:  ${path.resolve(outDir)}\n`);

let falhas = 0;
for (const ent of ENTIDADES) {
  process.stdout.write(`${ent.arquivo.padEnd(18)} `);
  try {
    const bruto = await buscar(ent);
    const linhas = desembrulhar(bruto);
    if (!linhas) {
      console.log('FALHOU — resposta não é lista nem envelope conhecido');
      falhas++;
      continue;
    }
    writeFileSync(path.join(outDir, `${ent.arquivo}.json`), JSON.stringify(linhas), 'utf8');
    const aviso = linhas.length < ent.minimo ? '  ⚠ vazio — confira a janela' : '';
    console.log(`ok  ${String(linhas.length).padStart(7)} registros${aviso}`);
    if (linhas.length < ent.minimo) falhas++;
  } catch (err) {
    // A mensagem nunca inclui URL nem cabeçalho: os dois carregam credencial.
    console.log(`FALHOU — ${err instanceof Error ? err.message : String(err)}`);
    falhas++;
  }
}

console.log();
if (falhas > 0) {
  console.error(`${falhas} de ${ENTIDADES.length} entidades falharam.`);
  console.error('400 = falta parâmetro · 401/403 = credencial ou IP · vazio = janela sem movimento');
  process.exit(1);
}
console.log('As seis fixtures estão prontas. Próximo passo:');
console.log(`  node scripts/build-demo-real-data.mjs ${path.resolve(outDir)}`);
