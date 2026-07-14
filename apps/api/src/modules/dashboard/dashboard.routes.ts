import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, parseDays, toNumber } from '../../http/helpers.js';
import { scopedStoreId } from '../auth/auth.middleware.js';
import { computeStoreCoverage } from '../planning/planning.math.js';

export const dashboardRouter = Router();

/** GET /api/dashboard/summary — indicadores (escopo por loja p/ gestor de loja). */
dashboardRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    const stockWhere: Prisma.StockItemWhereInput = storeId ? { storeId } : {};
    const salesWhere: Prisma.SaleWhereInput = { saleDate: { gte: since }, ...(storeId ? { storeId } : {}) };
    const pendingWhere: Prisma.InventoryMovementWhereInput = {
      status: { in: ['REQUESTED', 'PENDING'] },
      ...(storeId ? { OR: [{ fromStoreId: storeId }, { toStoreId: storeId }] } : {}),
    };

    const [
      stores,
      products,
      customers,
      stockAgg,
      salesAgg,
      pendingMovements,
      lastSync,
    ] = await Promise.all([
      storeId ? Promise.resolve(1) : prisma.store.count(),
      prisma.product.count(),
      prisma.customer.count(),
      prisma.stockItem.aggregate({ where: stockWhere, _sum: { quantity: true } }),
      prisma.sale.aggregate({
        where: salesWhere,
        _sum: { total: true },
        _count: true,
      }),
      prisma.inventoryMovement.count({ where: pendingWhere }),
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

/**
 * GET /api/dashboard/coverage — cobertura de estoque por loja: unidades em
 * estoque ÷ média mensal de unidades vendidas = estoque para X meses.
 * Base de estoque = quantidade sincronizada (StockItem.quantity), a MESMA do
 * card "Unidades em estoque" do /summary — reservas/ajustes internos ficam de
 * fora de propósito para os dois indicadores baterem.
 */
dashboardRouter.get(
  '/coverage',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days, 30, 365);
    const since = new Date();
    since.setDate(since.getDate() - days);
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);

    const [stores, stockGrouped, soldRows] = await Promise.all([
      prisma.store.findMany({
        where: storeId ? { id: storeId } : {},
        select: { id: true, name: true },
      }),
      prisma.stockItem.groupBy({
        by: ['storeId'],
        where: storeId ? { storeId } : {},
        _sum: { quantity: true },
      }),
      prisma.$queryRaw<{ storeId: string; units: bigint }[]>(Prisma.sql`
        SELECT s."storeId" AS "storeId", COALESCE(SUM(si.quantity), 0)::bigint AS units
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
        WHERE s."saleDate" >= ${since} AND s."storeId" IS NOT NULL
        ${storeId ? Prisma.sql`AND s."storeId" = ${storeId}` : Prisma.empty}
        GROUP BY s."storeId"
      `),
    ]);

    const stockByStore = new Map(stockGrouped.map((g) => [g.storeId, g._sum.quantity ?? 0]));
    const soldByStore = new Map(soldRows.map((r) => [r.storeId, Number(r.units)]));
    const rows = computeStoreCoverage(
      stores.map((s) => ({
        storeId: s.id,
        storeName: s.name,
        stockUnits: stockByStore.get(s.id) ?? 0,
        unitsSold: soldByStore.get(s.id) ?? 0,
      })),
      days,
    );
    res.json({ days, rows });
  }),
);

/** GET /api/dashboard/sales-by-store — total de vendas (30d) por loja. */
dashboardRouter.get(
  '/sales-by-store',
  asyncHandler(async (req, res) => {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    const grouped = await prisma.sale.groupBy({
      by: ['storeId'],
      where: { saleDate: { gte: since }, ...(storeId ? { storeId } : {}) },
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
    // Aceita threshold=0 (só produtos zerados); usa 3 apenas quando ausente/inválido.
    const rawThreshold = Number(req.query.threshold);
    const threshold = Number.isFinite(rawThreshold) && rawThreshold >= 0 ? rawThreshold : 3;
    const storeId = scopedStoreId(req, req.query.storeId as string | undefined);
    const grouped = await prisma.stockItem.groupBy({
      by: ['productId'],
      where: storeId ? { storeId } : {},
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
