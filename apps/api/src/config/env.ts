import 'dotenv/config';
import { z } from 'zod';

/** Aceita "HH:MM" no formato 24h. */
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const boolish = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0']))
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3333),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  // Nº de proxies reversos confiáveis à frente da API (0 = nenhum). Necessário
  // para que req.ip reflita o cliente real por trás de Nginx/Ingress/ELB.
  TRUST_PROXY: z.coerce.number().int().nonnegative().default(0),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório'),

  JWT_SECRET: z.string().min(1).default('dev-secret-change-me'),
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

  SYNC_CRON: z.string().default('0 6 * * *'),
  SYNC_TIMEZONE: z.string().default('America/Sao_Paulo'),
  SYNC_ON_BOOT: boolish.default('false'),
});

// Valores inseguros que NÃO podem ir para produção com o default.
const INSECURE_JWT_SECRET = 'dev-secret-change-me';
const INSECURE_ADMIN_PASSWORD = 'admin123';

const schemaWithProdGuards = schema.superRefine((v, ctx) => {
  if (v.NODE_ENV !== 'production') return;
  if (v.JWT_SECRET === INSECURE_JWT_SECRET || v.JWT_SECRET.length < 24) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_SECRET'],
      message: 'Em produção, defina um JWT_SECRET forte (>= 24 caracteres, não o padrão).',
    });
  }
  if (v.SEED_ADMIN_PASSWORD === INSECURE_ADMIN_PASSWORD) {
    ctx.addIssue({
      code: 'custom',
      path: ['SEED_ADMIN_PASSWORD'],
      message: 'Em produção, defina uma SEED_ADMIN_PASSWORD própria (não o padrão).',
    });
  }
  if (v.WEB_ORIGIN.trim() === '*' || v.WEB_ORIGIN.includes('*')) {
    ctx.addIssue({
      code: 'custom',
      path: ['WEB_ORIGIN'],
      message: 'Em produção, WEB_ORIGIN deve listar origens explícitas (sem "*").',
    });
  }
  if (v.SELLBIE_MODE === 'live' && !v.SELLBIE_BASE_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['SELLBIE_BASE_URL'],
      message: 'SELLBIE_MODE=live exige SELLBIE_BASE_URL configurada.',
    });
  }
});

const parsed = schemaWithProdGuards.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`Configuração inválida (.env):\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProd = env.NODE_ENV === 'production';
export const isLive = env.SELLBIE_MODE === 'live';
