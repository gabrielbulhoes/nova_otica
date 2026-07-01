import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, notFound, parsePaging } from '../../http/helpers.js';

export const salesRouter = Router();

/** GET /api/sales — vendas com filtro por período/loja. */
salesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, page, skip } = parsePaging(req.query);
    const where: Prisma.SaleWhereInput = {};
    if (req.query.storeId) where.storeId = req.query.storeId as string;

    const start = req.query.date_start as string | undefined;
    const end = req.query.date_end as string | undefined;
    if (start || end) {
      where.saleDate = {};
      if (start) where.saleDate.gte = new Date(`${start}T00:00:00`);
      if (end) where.saleDate.lte = new Date(`${end}T23:59:59`);
    }

    const [total, rows] = await Promise.all([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where,
        orderBy: { saleDate: 'desc' },
        include: {
          store: true,
          seller: true,
          customer: true,
          _count: { select: { items: true } },
        },
        take: limit,
        skip,
      }),
    ]);
    res.json({ total, page, limit, rows });
  }),
);

/** GET /api/sales/:id — detalhe da venda com itens e pagamentos. */
salesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id },
      include: {
        store: true,
        seller: true,
        customer: true,
        items: { include: { product: true } },
        payments: true,
      },
    });
    if (!sale) throw notFound('Venda não encontrada');
    res.json(sale);
  }),
);
