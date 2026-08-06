import 'dotenv/config';
import { z } from 'zod';

/** Aceita "HH:MM" no formato 24h. */
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const boolish = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0']))
  .transform((v) => v === 'true' || v === '1');

// Segredo conhecido: aceitável apenas em desenvolvimento/teste.
const DEV_JWT_SECRET = 'dev-secret-change-me';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3333),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  // Nº de proxies reversos confiáveis à frente da API (0 = nenhum). Necessário
  // para que req.ip reflita o cliente real (rate-limit) atrás de Nginx/ELB.
  TRUST_PROXY: z.coerce.number().int().nonnegative().default(0),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório'),

  JWT_SECRET: z.string().min(1).default(DEV_JWT_SECRET),
  JWT_EXPIRES_IN: z.string().default('8h'),
  DEFAULT_MIN_STOCK: z.coerce.number().int().nonnegative().default(3),
  // Filiais que são centro de distribuição ou unidade não-varejo (ex.: GMAIS,
  // ASSISTENCIA, ESTOQUE COMPRAS) e não entram na matemática de planejamento.
  // Regex (case-insensitive) casada com o nome da loja no sync; vazio desliga
  // a marcação automática.
  PLANNING_EXCLUDED_STORE_PATTERN: z.string().default('GMAIS|ASSISTENCIA|ESTOQUE COMPRAS'),
  // Caminho do catálogo de marcas (fornecedor + mix por loja). Vazio = procura
  // em apps/api/data/brand-catalog.json. Ausente = sem restrição de mix.
  BRAND_CATALOG_PATH: z.string().optional().default(''),
  SEED_ADMIN_EMAIL: z.string().default('admin@novaotica.com'),
  SEED_ADMIN_PASSWORD: z.string().default('admin123'),

  SELLBIE_MODE: z.enum(['mock', 'live']).default('mock'),
  // Base do conector CDS (ex.: http://<host>:<porta>/conectorCDS).
  SELLBIE_BASE_URL: z.string().optional().default(''),
  // Autenticação da API CDS: três cabeçalhos (x_api_key / x_api_token /
  // x_cliente_id). SELLBIE_API_KEY guarda o x_api_key.
  SELLBIE_API_KEY: z.string().optional().default(''),
  SELLBIE_API_TOKEN: z.string().optional().default(''),
  SELLBIE_CLIENT_ID: z.string().optional().default(''),
  // Basic auth legado (não usado pela CDS; mantido por compatibilidade).
  SELLBIE_USERNAME: z.string().optional().default(''),
  SELLBIE_PASSWORD: z.string().optional().default(''),
  // Identificação do "vendedor" nas vendas online exportadas ao ERP
  // (campo funcionario do POST /cds/inserirvenda).
  SELLBIE_EXPORT_SELLER: z.string().default('ECOMMERCE'),
  // ─── Contorno do truncamento silencioso do conector ──────────────────────
  // O conector CDS não tem paginação (nenhuma rota aceita page/limit/offset) e
  // corta a resposta num teto que não documenta: em 04/08/2026 uma chamada só
  // a cds/produtos devolveu 5.318 dos ~21.683 produtos da rede, sem erro e sem
  // sinal de que faltava o resto. A partir deste número de linhas a resposta é
  // tratada como truncada e a faixa de datas é fatiada (ver sweep.ts).
  // Abaixo do teto real de propósito: fatiar demais custa chamadas, aceitar um
  // truncamento custa catálogo.
  SELLBIE_PAGE_LIMIT: z.coerce.number().int().positive().default(4000),
  // Piso da varredura do catálogo. 1900-01-01 de propósito: o conector usa
  // "1900-01-01" como data-nula, e um piso em 2000 excluiria em silêncio todo
  // produto sem data de cadastro.
  SELLBIE_CATALOG_START: z.string().default('1900-01-01'),
  // Teto de chamadas por varredura — trava contra fatiamento descontrolado.
  SELLBIE_SWEEP_MAX_CALLS: z.coerce.number().int().positive().default(400),
  // Produtos por chamada em cds/estoquegrade. A rota não tem filtro de data;
  // o que ela aceita é `cod_prod` como lista CSV, e é assim que o estoque da
  // rede é lido em pedaços. 250 códigos ≈ 1.750 caracteres de query string,
  // bem abaixo do limite de URL de qualquer servidor.
  SELLBIE_STOCK_CHUNK: z.coerce.number().int().positive().default(250),
  // Teto DURO observado em cds/estoquegrade: cada filial devolveu exatas
  // 50.000 linhas em 04/08/2026, sem aviso. É diferente de SELLBIE_PAGE_LIMIT,
  // que é o limiar de SUSPEITA — este é o número acima do qual a leitura da
  // filial é dada como cortada, e a zeragem das posições sem saldo é pulada
  // (o que não veio pode ter sido apenas truncado, não zerado). Abaixo do teto
  // real de propósito: com only_disp uma filial devolve alguns milhares.
  SELLBIE_STOCK_HARD_CAP: z.coerce.number().int().positive().default(20_000),
  // Janela de vendas do sync diário. O padrão do conector é "último mês", mas
  // implícito: sem faixa explícita não há como fatiar quando a resposta é
  // truncada, e detalhesVendas já chega perto do teto com 30 dias de rede.
  // 35 e não 30 para o lote das 06h ter folga se um dia falhar.
  SELLBIE_SALES_WINDOW_DAYS: z.coerce.number().int().positive().default(35),
  SELLBIE_WINDOW_START: z.string().regex(timeRegex).default('06:00'),
  SELLBIE_WINDOW_END: z.string().regex(timeRegex).default('07:00'),
  // A doc da CDS não define janela de horário — em live, deixe true a menos
  // que a CDS imponha uma janela de consumo.
  SELLBIE_IGNORE_WINDOW: boolish.default('false'),

  // ─── Alertas operacionais ────────────────────────────────────────────────
  // Webhook genérico (Slack/Discord/n8n/Zapier): POST JSON com um campo `text`
  // legível, para não precisar de template do outro lado.
  ALERT_WEBHOOK_URL: z.string().optional().default(''),
  // Telegram como canal de primeira classe. O webhook genérico pressupõe que
  // exista um endpoint para recebê-lo, e enquanto ele não existe o alerta não
  // sai de lugar nenhum — que é a situação de hoje. O Telegram é onde a
  // operação já vive, e configurar são duas variáveis.
  ALERT_TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  ALERT_TELEGRAM_CHAT_ID: z.string().optional().default(''),
  // Horas sem um sync BEM-SUCEDIDO antes de a base ser considerada vencida.
  // 26 e não 24: o lote é diário, e um atraso de duas horas não é incidente.
  SYNC_STALE_HOURS: z.coerce.number().positive().default(26),
  // Quando o vigia confere o frescor. Padrão 09:00 — três horas depois do lote
  // das 06h, tempo suficiente para ele ter terminado e cedo o bastante para
  // alguém agir antes de a rede abrir por completo.
  SYNC_WATCHDOG_CRON: z.string().default('0 9 * * *'),

  PAYMENT_PROVIDER: z.enum(['mock', 'mercadopago']).default('mock'),

  // Emissão fiscal (NFC-e/NF-e) via provider — mock por padrão.
  FISCAL_PROVIDER: z.enum(['mock', 'focusnfe']).default('mock'),
  FISCAL_ENV: z.enum(['homologacao', 'producao']).default('homologacao'),
  FOCUS_NFE_TOKEN: z.string().optional().default(''),
  FISCAL_CNPJ: z.string().optional().default('00000000000000'),
  FISCAL_NCM_DEFAULT: z.string().default('90031100'), // armações de óculos
  FISCAL_CFOP_NFCE: z.string().default('5102'),
  FISCAL_CFOP_TRANSFER: z.string().default('5152'),
  MP_ACCESS_TOKEN: z.string().optional().default(''),
  MP_WEBHOOK_SECRET: z.string().optional().default(''),
  MP_PAYER_EMAIL: z.string().optional().default(''),

  SYNC_CRON: z.string().default('0 6 * * *'),
  SYNC_TIMEZONE: z.string().default('America/Sao_Paulo'),
  SYNC_ON_BOOT: boolish.default('false'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`Configuração inválida (.env):\n${issues}`);
  process.exit(1);
}

// Em produção, subir com segredos/origens default seria comprometer o sistema
// inteiro: tokens forjáveis, admin com senha conhecida e CORS aberto.
if (parsed.data.NODE_ENV === 'production') {
  const problems: string[] = [];
  if (parsed.data.JWT_SECRET === DEV_JWT_SECRET || parsed.data.JWT_SECRET.length < 24) {
    problems.push('JWT_SECRET deve ser forte (>= 24 caracteres, não o padrão de desenvolvimento).');
  }
  if (parsed.data.SEED_ADMIN_PASSWORD === 'admin123') {
    problems.push('SEED_ADMIN_PASSWORD não pode usar o valor padrão em produção.');
  }
  if (parsed.data.WEB_ORIGIN.includes('*')) {
    problems.push('WEB_ORIGIN deve listar origens explícitas em produção (sem "*").');
  }
  if (parsed.data.SELLBIE_MODE === 'live') {
    if (!parsed.data.SELLBIE_BASE_URL) {
      problems.push('SELLBIE_MODE=live exige SELLBIE_BASE_URL configurada.');
    }
    if (!parsed.data.SELLBIE_API_KEY || !parsed.data.SELLBIE_API_TOKEN || !parsed.data.SELLBIE_CLIENT_ID) {
      problems.push(
        'SELLBIE_MODE=live exige SELLBIE_API_KEY, SELLBIE_API_TOKEN e SELLBIE_CLIENT_ID (cabeçalhos da CDS).',
      );
    }
  }
  if (parsed.data.PAYMENT_PROVIDER === 'mercadopago' && !parsed.data.MP_ACCESS_TOKEN) {
    problems.push('PAYMENT_PROVIDER=mercadopago exige MP_ACCESS_TOKEN.');
  }
  if (parsed.data.FISCAL_PROVIDER === 'focusnfe' && !parsed.data.FOCUS_NFE_TOKEN) {
    problems.push('FISCAL_PROVIDER=focusnfe exige FOCUS_NFE_TOKEN.');
  }
  if (problems.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`Configuração inválida (.env):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
}
if (parsed.data.NODE_ENV === 'development' && parsed.data.JWT_SECRET === DEV_JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.warn('JWT_SECRET usando o valor padrão de desenvolvimento — troque antes de publicar.');
}

export const env = parsed.data;
export type Env = typeof env;

export const isProd = env.NODE_ENV === 'production';
export const isLive = env.SELLBIE_MODE === 'live';
