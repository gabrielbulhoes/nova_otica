import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, badRequest } from '../../http/helpers.js';
import { requireRole } from '../auth/auth.middleware.js';
import { hashPassword } from '../auth/auth.service.js';

export const usersRouter = Router();

// Todas as rotas de usuários são exclusivas do ADMIN.
usersRouter.use(requireRole('ADMIN'));

/** GET /api/users — lista usuários da plataforma. */
usersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        storeId: true,
        active: true,
        lastLoginAt: true,
        store: { select: { name: true } },
      },
    });
    res.json({ total: users.length, rows: users });
  }),
);

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(6),
  role: z.enum(['ADMIN', 'STORE_MANAGER']),
  storeId: z.string().optional(),
});

/** POST /api/users — cria um usuário. */
usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    if (input.role === 'STORE_MANAGER' && !input.storeId) {
      throw badRequest('Gestor de loja precisa de uma loja (storeId).');
    }
    const email = input.email.toLowerCase();
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw badRequest('E-mail já cadastrado.');

    const user = await prisma.user.create({
      data: {
        email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        role: input.role,
        storeId: input.role === 'STORE_MANAGER' ? input.storeId : null,
      },
      select: { id: true, email: true, name: true, role: true, storeId: true, active: true },
    });
    res.status(201).json(user);
  }),
);
