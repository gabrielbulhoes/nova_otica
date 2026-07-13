import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, HttpError } from '../../http/helpers.js';
import { rateLimit } from '../../http/rateLimit.js';
import { requireAuth } from './auth.middleware.js';
import { signToken, verifyPassword, type AuthUser } from './auth.service.js';

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
      user: { ...authUser, storeName: user.store?.name ?? null },
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
    });
  }),
);
