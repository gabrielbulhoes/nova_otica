import { describe, it, expect } from 'vitest';
import type { Request, Response } from 'express';
import { rateLimit } from '../src/http/rateLimit.js';

/** Executa o middleware e devolve o erro passado ao next (ou undefined). */
function run(mw: ReturnType<typeof rateLimit>, req: Partial<Request>): Promise<unknown> {
  return new Promise((resolve) => {
    mw(req as Request, {} as Response, (err?: unknown) => resolve(err));
  });
}

describe('rateLimit', () => {
  it('permite até o máximo e depois bloqueia com 429', async () => {
    const mw = rateLimit({ windowMs: 60_000, max: 3, key: () => 'k' });
    const req = { ip: '1.1.1.1', body: {} } as Partial<Request>;
    expect(await run(mw, req)).toBeUndefined();
    expect(await run(mw, req)).toBeUndefined();
    expect(await run(mw, req)).toBeUndefined();
    const err = (await run(mw, req)) as { status?: number };
    expect(err).toBeTruthy();
    expect(err.status).toBe(429);
  });

  it('mantém contadores independentes por chave', async () => {
    const mw = rateLimit({ windowMs: 60_000, max: 1, key: (r) => r.ip ?? '' });
    expect(await run(mw, { ip: 'a' })).toBeUndefined();
    expect(((await run(mw, { ip: 'a' })) as { status?: number }).status).toBe(429);
    expect(await run(mw, { ip: 'b' })).toBeUndefined();
  });

  it('permanece estável sob alta cardinalidade de chaves (cota rígida)', async () => {
    // Mais chaves distintas que o teto interno: não deve lançar nem degradar.
    const mw = rateLimit({ windowMs: 60_000, max: 1, key: (r) => r.ip ?? '' });
    for (let i = 0; i < 12_000; i += 1) {
      expect(await run(mw, { ip: `ip-${i}` })).toBeUndefined();
    }
  });
});
