import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, notFound, parsePaging } from '../../http/helpers.js';

export const customersRouter = Router();

/** GET /api/customers — clientes com busca por nome/documento. */
customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, page, skip } = parsePaging(req.query);
    const search = req.query.search as string | undefined;

    const where: Prisma.CustomerWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { document: { contains: search } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, rows] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        include: { _count: { select: { sales: true } } },
        take: limit,
        skip,
      }),
    ]);
    res.json({ total, page, limit, rows });
  }),
);

/** GET /api/customers/:id — detalhe + últimas vendas. */
customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        sales: { orderBy: { saleDate: 'desc' }, take: 20, include: { store: true } },
      },
    });
    if (!customer) throw notFound('Cliente não encontrado');
    res.json(customer);
  }),
);
