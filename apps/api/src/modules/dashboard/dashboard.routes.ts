import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, toNumber } from '../../http/helpers.js';

export const dashboardRouter = Router();

/** GET /api/dashboard/summary — indicadores gerais da rede. */
dashboardRouter.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [
      stores,
      products,
      customers,
      stockAgg,
      salesAgg,
      pendingMovements,
      lastSync,
    ] = await Promise.all([
      prisma.store.count(),
      prisma.product.count(),
      prisma.customer.count(),
      prisma.stockItem.aggregate({ _sum: { quantity: true } }),
      prisma.sale.aggregate({
        where: { saleDate: { gte: since } },
        _sum: { total: true },
        _count: true,
      }),
      prisma.inventoryMovement.count({ where: { status: 'PENDING' } }),
      prisma.syncRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    ]);

    res.json({
      stores,
      products,
      customers,
      stockUnits: stockAgg._sum.quantity ?? 0,
      pendingMovements,
      sales30d: {
        count: salesAgg._count,
        total: toNumber(salesAgg._sum.total) ?? 0,
      },
      lastSync: lastSync
        ? {
            status: lastSync.status,
            startedAt: lastSync.startedAt.toISOString(),
            finishedAt: lastSync.finishedAt?.toISOString() ?? null,
            recordsWritten: lastSync.recordsWritten,
            window: lastSync.window,
          }
        : null,
    });
  }),
);

/** GET /api/dashboard/sales-by-store — total de vendas (30d) por loja. */
dashboardRouter.get(
  '/sales-by-store',
  asyncHandler(async (_req, res) => {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const grouped = await prisma.sale.groupBy({
      by: ['storeId'],
      where: { saleDate: { gte: since } },
      _sum: { total: true },
      _count: true,
    });
    const stores = await prisma.store.findMany({ select: { id: true, name: true } });
    const nameById = new Map(stores.map((s) => [s.id, s.name]));

    const rows = grouped
      .map((g) => ({
        storeId: g.storeId,
        storeName: g.storeId ? nameById.get(g.storeId) ?? 'Sem loja' : 'Sem loja',
        count: g._count,
        total: toNumber(g._sum.total) ?? 0,
      }))
      .sort((a, b) => b.total - a.total);

    res.json({ rows });
  }),
);

/** GET /api/dashboard/low-stock — produtos com saldo baixo na rede. */
dashboardRouter.get(
  '/low-stock',
  asyncHandler(async (req, res) => {
    const threshold = Number(req.query.threshold) || 3;
    const grouped = await prisma.stockItem.groupBy({
      by: ['productId'],
      _sum: { quantity: true },
    });
    const low = grouped
      .map((g) => ({ productId: g.productId, total: g._sum.quantity ?? 0 }))
      .filter((g) => g.total <= threshold)
      .sort((a, b) => a.total - b.total)
      .slice(0, 50);

    const products = await prisma.product.findMany({
      where: { id: { in: low.map((l) => l.productId) } },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    res.json({
      threshold,
      rows: low.map((l) => ({
        productId: l.productId,
        description: byId.get(l.productId)?.description ?? '—',
        brand: byId.get(l.productId)?.brand ?? null,
        category: byId.get(l.productId)?.category ?? null,
        total: l.total,
      })),
    });
  }),
);
