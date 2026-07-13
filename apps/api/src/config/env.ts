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
  SEED_ADMIN_EMAIL: z.string().default('admin@novaotica.com'),
  SEED_ADMIN_PASSWORD: z.string().default('admin123'),

  SELLBIE_MODE: z.enum(['mock', 'live']).default('mock'),
  SELLBIE_BASE_URL: z.string().optional().default(''),
  SELLBIE_API_KEY: z.string().optional().default(''),
  SELLBIE_USERNAME: z.string().optional().default(''),
  SELLBIE_PASSWORD: z.string().optional().default(''),
  SELLBIE_WINDOW_START: z.string().regex(timeRegex).default('06:00'),
  SELLBIE_WINDOW_END: z.string().regex(timeRegex).default('07:00'),
  SELLBIE_IGNORE_WINDOW: boolish.default('false'),

  PAYMENT_PROVIDER: z.enum(['mock', 'mercadopago']).default('mock'),
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
  if (parsed.data.SELLBIE_MODE === 'live' && !parsed.data.SELLBIE_BASE_URL) {
    problems.push('SELLBIE_MODE=live exige SELLBIE_BASE_URL configurada.');
  }
  if (parsed.data.PAYMENT_PROVIDER === 'mercadopago' && !parsed.data.MP_ACCESS_TOKEN) {
    problems.push('PAYMENT_PROVIDER=mercadopago exige MP_ACCESS_TOKEN.');
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
