import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, notFound, parsePaging } from '../../http/helpers.js';

export const productsRouter = Router();

/** GET /api/products — catálogo de produtos com busca/filtro. */
productsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, page, skip } = parsePaging(req.query);
    const search = req.query.search as string | undefined;
    const category = req.query.category as string | undefined;

    const where: Prisma.ProductWhereInput = {};
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { externalId: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: { description: 'asc' },
        include: { color: true, size: true },
        take: limit,
        skip,
      }),
    ]);
    res.json({ total, page, limit, rows });
  }),
);

/** GET /api/products/categories — categorias distintas (para filtros). */
productsRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.product.findMany({
      where: { category: { not: null } },
      distinct: ['category'],
      select: { category: true },
      orderBy: { category: 'asc' },
    });
    res.json(rows.map((r) => r.category).filter(Boolean));
  }),
);

/** GET /api/products/:id — detalhe + posição de estoque por loja. */
productsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { color: true, size: true, stockItems: { include: { store: true } } },
    });
    if (!product) throw notFound('Produto não encontrado');
    res.json(product);
  }),
);
