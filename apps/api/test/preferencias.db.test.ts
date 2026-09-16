import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/modules/auth/auth.service.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * A PREFERÊNCIA DE NAVEGAÇÃO, DE PONTA A PONTA — rodada final · item 01.
 *
 * "A preferência deve ser salva por usuário."
 *
 * O teste sobe a app de verdade e fala HTTP porque é aí que mora o que pode
 * dar errado: o merge raso (recolher a barra não pode apagar a escolha do
 * layout), a validação (um valor fora da lista não entra no banco) e o `/me`
 * devolvendo a preferência junto — que é o que impede a interface de abrir num
 * layout e pular para outro.
 */
const SENHA = 'preferencia-de-teste-1';

let servidor: ReturnType<ReturnType<typeof createApp>['listen']>;
let base = '';
let usuarioId = '';
const email = `preferencias.${Date.now()}@teste.local`;

const pedir = async (
  caminho: string,
  opcoes: { metodo?: string; token?: string; corpo?: unknown } = {},
) => {
  const r = await fetch(`${base}${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opcoes.token ? { authorization: `Bearer ${opcoes.token}` } : {}),
    },
    ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }),
  });
  const texto = await r.text();
  return { status: r.status, corpo: texto ? (JSON.parse(texto) as Record<string, unknown>) : {} };
};

d('preferências de interface por usuário (integração com Postgres)', () => {
  let token = '';

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: {
        email,
        name: 'Usuário de preferências',
        passwordHash: await hashPassword(SENHA),
        role: 'ADMIN',
      },
    });
    usuarioId = u.id;
    const app = createApp();
    await new Promise<void>((resolve) => {
      servidor = app.listen(0, () => resolve());
    });
    const { port } = servidor.address() as { port: number };
    base = `http://127.0.0.1:${port}/api`;
    const login = await pedir('/auth/login', { metodo: 'POST', corpo: { email, password: SENHA } });
    expect(login.status).toBe(200);
    token = String(login.corpo.token);
  });

  afterAll(async () => {
    if (usuarioId) await prisma.user.delete({ where: { id: usuarioId } }).catch(() => undefined);
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  });

  it('quem nunca mexeu recebe um objeto vazio — e a tela trata isso como padrão', async () => {
    const eu = await pedir('/auth/me', { token });
    expect(eu.status).toBe(200);
    expect(eu.corpo.preferences).toEqual({});
  });

  it('grava a escolha do layout e devolve no /me', async () => {
    const p = await pedir('/auth/preferences', {
      metodo: 'PATCH',
      token,
      corpo: { menu: 'horizontal' },
    });
    expect(p.status).toBe(200);
    expect(p.corpo.preferences).toEqual({ menu: 'horizontal' });

    const eu = await pedir('/auth/me', { token });
    expect(eu.corpo.preferences).toEqual({ menu: 'horizontal' });
  });

  it('é MERGE: recolher a barra não apaga a escolha do layout', async () => {
    const p = await pedir('/auth/preferences', {
      metodo: 'PATCH',
      token,
      corpo: { sidebarRecolhida: true },
    });
    expect(p.corpo.preferences).toEqual({ menu: 'horizontal', sidebarRecolhida: true });
  });

  it('valor fora da lista é 400 — não entra no banco em silêncio', async () => {
    const p = await pedir('/auth/preferences', {
      metodo: 'PATCH',
      token,
      corpo: { menu: 'diagonal' },
    });
    expect(p.status).toBe(400);
    const eu = await pedir('/auth/me', { token });
    expect(eu.corpo.preferences).toEqual({ menu: 'horizontal', sidebarRecolhida: true });
  });

  it('chave desconhecida também é 400: o schema é fechado', async () => {
    const p = await pedir('/auth/preferences', {
      metodo: 'PATCH',
      token,
      corpo: { menu: 'lateral', tema: 'escuro' },
    });
    expect(p.status).toBe(400);
  });

  it('sem token, ninguém grava preferência de ninguém', async () => {
    const p = await pedir('/auth/preferences', { metodo: 'PATCH', corpo: { menu: 'lateral' } });
    expect(p.status).toBe(401);
  });

  it('dado estranho já gravado no banco não derruba o /me', async () => {
    await prisma.user.update({
      where: { id: usuarioId },
      data: { preferences: { menu: 'diagonal', sobra: 1 } },
    });
    const eu = await pedir('/auth/me', { token });
    expect(eu.status).toBe(200);
    expect(eu.corpo.preferences).toEqual({});
  });
});
