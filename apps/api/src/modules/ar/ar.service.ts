import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { notFound, toNumber } from '../../http/helpers.js';

function periodStart(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

/**
 * Metadados de encaixe válidos são só pares chave → número finito; qualquer
 * outra coisa gravada no JSON é descartada antes de servir ao provador.
 */
function sanitizeFit(fit: unknown): Record<string, number> | null {
  if (fit === null || typeof fit !== 'object' || Array.isArray(fit)) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(fit as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Produtos elegíveis ao provador: produto ativo, asset PUBLICADO e saldo. */
export async function listArProducts() {
  const assets = await prisma.productAsset.findMany({
    where: { status: 'PUBLISHED', product: { active: true } },
    orderBy: { version: 'desc' },
    include: { product: true },
  });

  // Mantém apenas o asset de maior versão por produto.
  const byProduct = new Map<string, (typeof assets)[number]>();
  for (const a of assets) if (!byProduct.has(a.productId)) byProduct.set(a.productId, a);

  const productIds = [...byProduct.keys()];
  const stock = await prisma.stockItem.groupBy({
    by: ['productId'],
    where: { productId: { in: productIds } },
    _sum: { quantity: true },
  });
  const availById = new Map(stock.map((s) => [s.productId, s._sum.quantity ?? 0]));

  return [...byProduct.values()]
    .map((a) => ({
      productId: a.productId,
      description: a.product.description,
      brand: a.product.brand,
      category: a.product.category,
      price: toNumber(a.product.price),
      assetType: a.type,
      assetUrl: a.url,
      available: availById.get(a.productId) ?? 0,
    }))
    .filter((p) => p.available > 0);
}

export interface GetAssetOptions {
  /** Negociação por capacidade do dispositivo (ex.: sem WebGL → OVERLAY_2D). */
  type?: 'GLB_3D' | 'OVERLAY_2D';
  /** Versão máxima suportada pelo cliente (pinning de compatibilidade). */
  maxVersion?: number;
}

/** Asset de AR (modelo + metadados de encaixe) do produto, validado. */
export async function getAsset(productId: string, opts: GetAssetOptions = {}) {
  const where: Prisma.ProductAssetWhereInput = {
    productId,
    status: 'PUBLISHED',
    product: { active: true },
  };
  if (opts.type) where.type = opts.type;
  if (opts.maxVersion !== undefined) where.version = { lte: opts.maxVersion };

  const asset = await prisma.productAsset.findFirst({
    where,
    orderBy: { version: 'desc' },
    include: { product: { select: { description: true, brand: true } } },
  });
  if (!asset) throw notFound('Asset de AR não encontrado para o produto');
  return {
    productId,
    type: asset.type,
    url: asset.url,
    fit: sanitizeFit(asset.fit),
    version: asset.version,
    product: asset.product,
  };
}

export interface UpsertAssetInput {
  type: 'GLB_3D' | 'OVERLAY_2D';
  url: string;
  fit?: Record<string, number>;
}

/** Cria uma nova versão de asset (ADMIN). */
export async function createAsset(productId: string, input: UpsertAssetInput) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw notFound('Produto não encontrado');
  const last = await prisma.productAsset.findFirst({
    where: { productId },
    orderBy: { version: 'desc' },
  });
  return prisma.productAsset.create({
    data: {
      productId,
      type: input.type,
      url: input.url,
      fit: (input.fit ?? undefined) as Prisma.InputJsonValue | undefined,
      version: (last?.version ?? 0) + 1,
      status: 'PUBLISHED',
    },
  });
}

/** Registra um evento de prova (telemetria, sem dados biométricos). */
export async function recordTryOn(input: {
  productId: string;
  storeId?: string;
  userId?: string;
  durationMs?: number;
  converted?: boolean;
}) {
  return prisma.tryOnEvent.create({
    data: {
      productId: input.productId,
      storeId: input.storeId ?? null,
      userId: input.userId ?? null,
      durationMs: input.durationMs ?? null,
      converted: input.converted ?? false,
    },
  });
}

/** Funil de provas: total, conversões e taxa (alimenta o BI). */
export async function tryOnStats(days: number) {
  const start = periodStart(days);
  const where: Prisma.TryOnEventWhereInput = { createdAt: { gte: start } };
  const [total, converted, byProduct] = await Promise.all([
    prisma.tryOnEvent.count({ where }),
    prisma.tryOnEvent.count({ where: { ...where, converted: true } }),
    prisma.tryOnEvent.groupBy({ by: ['productId'], where, _count: true }),
  ]);

  const products = await prisma.product.findMany({
    where: { id: { in: byProduct.map((b) => b.productId) } },
    select: { id: true, description: true },
  });
  const nameById = new Map(products.map((p) => [p.id, p.description]));

  return {
    days,
    total,
    converted,
    conversionRate: total > 0 ? Math.round((converted / total) * 1000) / 10 : 0,
    topProducts: byProduct
      .map((b) => ({ productId: b.productId, description: nameById.get(b.productId) ?? '—', tryOns: b._count }))
      .sort((a, b) => b.tryOns - a.tryOns)
      .slice(0, 10),
  };
}
