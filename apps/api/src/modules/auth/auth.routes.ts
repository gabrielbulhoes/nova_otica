import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, HttpError } from '../../http/helpers.js';
import { rateLimit } from '../../http/rateLimit.js';
import { requireAuth } from './auth.middleware.js';
import { hashPassword, signToken, verifyPassword, type AuthUser } from './auth.service.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Anti força-bruta: no máx. 10 tentativas por IP+e-mail a cada 15 minutos.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.',
  key: (req) => `${req.ip ?? 'ip'}:${String((req.body as { email?: string })?.email ?? '').toLowerCase()}`,
});

/** POST /api/auth/login — autentica e devolve o token + dados do usuário. */
authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { store: { select: { name: true } } },
    });
    if (!user || !user.active) throw new HttpError(401, 'Credenciais inválidas');

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw new HttpError(401, 'Credenciais inválidas');

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      storeId: user.storeId,
    };
    res.json({
      token: signToken(authUser),
      user: {
        ...authUser,
        storeName: user.store?.name ?? null,
        // AS PREFERÊNCIAS VÊM NO LOGIN também, e não só no `/me`: o contexto
        // da interface é montado a partir desta resposta, e o efeito que
        // chama o `/me` só roda uma vez, na montagem. Sem isto, quem gravou
        // "menu horizontal" entrava no layout padrão e só via a própria
        // escolha depois de um F5 — a preferência estava salva e parecia
        // perdida.
        preferences: preferenciasDoBanco(user.preferences),
      },
    });
  }),
);

/** GET /api/auth/me — dados do usuário autenticado. */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { store: { select: { name: true } } },
    });
    if (!user) throw new HttpError(401, 'Usuário não encontrado');
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      storeId: user.storeId,
      storeName: user.store?.name ?? null,
      // As preferências VÊM JUNTO, e não numa segunda chamada, porque é o que
      // impede a interface de abrir num layout e pular para outro meio segundo
      // depois — o console inteiro se reorganizando na frente de quem entrou.
      preferences: preferenciasDoBanco(user.preferences),
    });
  }),
);

/*
 * PREFERÊNCIAS DE INTERFACE — rodada final · item 01.
 *
 * "O menu deve poder ser exibido tanto lateralmente quanto horizontalmente,
 *  alternável por configuração. A preferência deve ser salva por usuário."
 *
 * Guardadas em JSON (`User.preferences`) e não em colunas: a próxima
 * preferência de tela não pode custar uma migração, e o servidor não precisa
 * conhecer o significado de cada chave para guardá-la.
 *
 * O que ele PRECISA fazer é não deixar entrar lixo — um `menu: "diagonal"`
 * gravado aqui vira uma casca sem navegação para aquele usuário, e ninguém
 * descobre isso a não ser o próprio. Por isso o schema é fechado e o valor
 * inválido é 400, não descarte silencioso.
 */
const preferencesSchema = z
  .object({
    menu: z.enum(['lateral', 'horizontal']),
    sidebarRecolhida: z.boolean(),
  })
  .partial()
  .strict();

/** O que está gravado, filtrado pelo mesmo schema: chave desconhecida some. */
function preferenciasDoBanco(bruto: unknown): Record<string, unknown> {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return {};
  const parsed = preferencesSchema.safeParse(bruto);
  // Dado antigo ou escrito fora daqui não derruba o `/me`: a interface trata
  // chave ausente como padrão, e o usuário reescreve a preferência no primeiro
  // clique. Perder a preferência é um aborrecimento; não conseguir entrar, não.
  return parsed.success ? (parsed.data as Record<string, unknown>) : {};
}

/**
 * PATCH /api/auth/preferences — MERGE RASO sobre o que já existe.
 *
 * Merge, e não substituição, porque a tela manda uma chave por vez: recolher a
 * barra e trocar o layout são dois gestos independentes, e quem manda o
 * segundo não deveria apagar o primeiro.
 */
authRouter.patch(
  '/preferences',
  requireAuth,
  asyncHandler(async (req, res) => {
    const mudanca = preferencesSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { preferences: true },
    });
    if (!user) throw new HttpError(401, 'Usuário não encontrado');
    const preferences = { ...preferenciasDoBanco(user.preferences), ...mudanca };
    await prisma.user.update({ where: { id: req.user!.id }, data: { preferences } });
    res.json({ preferences });
  }),
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

/** PATCH /api/auth/password — o próprio usuário troca a senha. */
authRouter.patch(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new HttpError(401, 'Usuário não encontrado');
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) throw new HttpError(403, 'Senha atual incorreta');
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    res.json({ ok: true });
  }),
);
