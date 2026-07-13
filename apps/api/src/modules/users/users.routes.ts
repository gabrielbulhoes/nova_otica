import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, badRequest, notFound } from '../../http/helpers.js';
import { requireRole } from '../auth/auth.middleware.js';
import { hashPassword } from '../auth/auth.service.js';
import { isSelfRoleOrStatusChange, wouldOrphanAdmins } from './users.service.js';

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

const updateUserSchema = z
  .object({
    name: z.string().min(2).optional(),
    role: z.enum(['ADMIN', 'STORE_MANAGER']).optional(),
    storeId: z.string().nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Informe ao menos um campo.' });

/** PATCH /api/users/:id — edita nome, papel, loja e status (ADMIN). */
usersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = updateUserSchema.parse(req.body);
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('Usuário não encontrado');

    if (isSelfRoleOrStatusChange(req.user!.id, target.id, input)) {
      throw badRequest('Você não pode alterar o próprio papel ou status.');
    }

    const role = input.role ?? target.role;
    if (role === 'STORE_MANAGER' && !(input.storeId ?? target.storeId)) {
      throw badRequest('Gestor de loja precisa de uma loja (storeId).');
    }

    const otherActiveAdmins = await prisma.user.count({
      where: { role: 'ADMIN', active: true, id: { not: target.id } },
    });
    if (wouldOrphanAdmins(target, input, otherActiveAdmins)) {
      throw badRequest('A rede precisa de pelo menos um ADMIN ativo.');
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: {
        name: input.name,
        role: input.role,
        active: input.active,
        // ADMIN é de rede (sem loja); gestor mantém/recebe a loja informada.
        storeId: role === 'ADMIN' ? null : input.storeId === undefined ? target.storeId : input.storeId,
      },
      select: { id: true, email: true, name: true, role: true, storeId: true, active: true },
    });
    res.json(updated);
  }),
);

const resetPasswordSchema = z.object({ password: z.string().min(6) });

/** POST /api/users/:id/reset-password — redefine a senha de um usuário (ADMIN). */
usersRouter.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const { password } = resetPasswordSchema.parse(req.body);
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('Usuário não encontrado');
    await prisma.user.update({
      where: { id: target.id },
      data: { passwordHash: await hashPassword(password) },
    });
    res.json({ ok: true });
  }),
);
