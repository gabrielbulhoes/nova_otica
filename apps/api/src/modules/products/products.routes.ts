import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, notFound, parsePaging } from '../../http/helpers.js';
import { scopedStoreWhere } from '../auth/auth.middleware.js';
import { stockVisibleWhere } from '../stores/store.scope.js';
import { parseGroup, productWhereForGroup, scopeCategories } from './product.scope.js';

export const productsRouter = Router();

/** GET /api/products — catálogo de produtos com busca/filtro. */
productsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, page, skip } = parsePaging(req.query);
    const search = req.query.search as string | undefined;
    const category = req.query.category as string | undefined;

    const where: Prisma.ProductWhereInput = {};
    // Recorte do console: lente e tratamento saem por padrão, mas voltam num
    // clique — o catálogo não perde nada, só sai da frente.
    const scoped = scopeCategories(
      await productWhereForGroup(parseGroup(req.query.group)),
      category ? [category] : undefined,
    );
    if (scoped?.category) where.category = scoped.category;
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

/** GET /api/products/:id — detalhe + posição de estoque por loja (escopada). */
productsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    // Gestor de loja só enxerga o estoque da própria loja; ADMIN vê todas.
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        color: true,
        size: true,
        // O escopo do USUÁRIO (gestor vê só a própria loja) e o da PLATAFORMA
        // (filial em outro ERP não existe) são perguntas diferentes, e as duas
        // valem aqui. Só a primeira estava escrita: para o ADMIN, o detalhe do
        // produto listava a posição das lojas ZEISS com saldo desatualizado.
        stockItems: {
          where: { ...scopedStoreWhere(req), ...stockVisibleWhere },
          include: { store: true },
        },
      },
    });
    if (!product) throw notFound('Produto não encontrado');
    res.json(product);
  }),
);
