/* Popula o banco com dados de demonstração: sincroniza (mock), cria usuários
   (admin + gestor por loja) e uma solicitação de transferência de exemplo. */
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { runFullSync } from '../sync/syncService.js';
import { createMovement } from '../modules/movements/movements.service.js';
import { hashPassword } from '../modules/auth/auth.service.js';
import { createAsset } from '../modules/ar/ar.service.js';

async function seedUsers() {
  const adminEmail = env.SEED_ADMIN_EMAIL.toLowerCase();
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: 'Administrador da Rede',
      passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
      role: 'ADMIN',
    },
  });
  logger.info('Seed: admin garantido', { email: adminEmail });

  // Um gestor por loja: loja<externalId>@novaotica.com / senha "loja123".
  const stores = await prisma.store.findMany({ orderBy: { name: 'asc' } });
  const managerHash = await hashPassword('loja123');
  for (const store of stores) {
    const email = `loja${store.externalId}@novaotica.com`;
    await prisma.user.upsert({
      where: { email },
      update: { storeId: store.id },
      create: {
        email,
        name: `Gestor — ${store.name}`,
        passwordHash: managerHash,
        role: 'STORE_MANAGER',
        storeId: store.id,
      },
    });
  }
  logger.info('Seed: gestores de loja garantidos', { count: stores.length });
  return stores;
}

async function main() {
  logger.info('Seed: sincronizando dados (modo mock)…');
  const result = await runFullSync('manual');
  logger.info('Seed: sync concluído', { ok: result.ok });

  const stores = await seedUsers();

  // Solicitação de transferência de exemplo, feita por um gestor de loja
  // (nasce como REQUESTED, aguardando aprovação da rede).
  const manager = await prisma.user.findFirst({
    where: { role: 'STORE_MANAGER', storeId: stores[0]?.id },
  });
  const product = await prisma.product.findFirst({
    where: { stockItems: { some: { storeId: stores[0]?.id, quantity: { gt: 5 } } } },
  });

  if (stores.length >= 2 && product && manager?.storeId) {
    await createMovement(
      {
        type: 'TRANSFER',
        productId: product.id,
        fromStoreId: stores[0].id,
        toStoreId: stores[1].id,
        quantity: 2,
        reason: 'Solicitação de exemplo (seed)',
        confirm: false,
      },
      { id: manager.id, role: 'STORE_MANAGER', storeId: manager.storeId },
    );
    logger.info('Seed: solicitação de transferência criada (REQUESTED)', {
      product: product.description,
      from: stores[0].name,
      to: stores[1].name,
    });
  }

  // Assets de AR de demonstração (curva A / óculos e armações com estoque).
  const arProducts = await prisma.product.findMany({
    where: {
      category: { in: ['Armação', 'Óculos de Sol'] },
      stockItems: { some: { quantity: { gt: 0 } } },
      assets: { none: {} },
    },
    take: 5,
  });
  for (const p of arProducts) {
    await createAsset(p.id, {
      type: 'GLB_3D',
      url: `https://assets.novaotica.demo/frames/${p.externalId}.glb`,
      fit: { frameWidth: 138, bridgeWidth: 18, templeLength: 145, lensHeight: 42, scale: 1 },
    });
  }
  logger.info('Seed: assets de AR de demonstração criados', { count: arProducts.length });

  await prisma.$disconnect();
  logger.info('Seed concluído.');
}

main().catch(async (err) => {
  logger.error('Falha no seed', { error: err instanceof Error ? err.message : String(err) });
  await prisma.$disconnect();
  process.exit(1);
});
