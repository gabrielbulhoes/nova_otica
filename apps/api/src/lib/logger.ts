/* Logger mínimo, estruturado e sem dependências. */
type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? order.info;

// Campos que nunca podem vazar em log (credenciais, pagamento, dados pessoais).
const SENSITIVE_KEYS = [
  'password',
  'senha',
  'token',
  'authorization',
  'secret',
  'apikey',
  'api_key',
  'jwt',
  'card',
  'cartao',
  'cvv',
  'qrcode',
  'document',
  'cpf',
  'cnpj',
  'email',
  'phone',
  'telefone',
];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => k.includes(s));
}

const MAX_DEPTH = 6;

/** Substitui recursivamente valores de chaves sensíveis por "[redacted]". */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object' || depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Date || value instanceof Error) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (order[level] < threshold) return;
  const line = {
    t: new Date().toISOString(),
    level,
    msg,
    ...((redact(meta ?? {}) as Record<string, unknown>) ?? {}),
  };
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(`${JSON.stringify(line)}\n`);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
  child: (bindings: Record<string, unknown>) => ({
    debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, { ...bindings, ...meta }),
    info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, { ...bindings, ...meta }),
    warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, { ...bindings, ...meta }),
    error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, { ...bindings, ...meta }),
  }),
};

export type Logger = typeof logger;
