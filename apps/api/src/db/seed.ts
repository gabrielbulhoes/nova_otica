/* Popula o banco com dados de demonstração executando a sincronização em
   modo mock e criando algumas movimentações internas de exemplo. */
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { runFullSync } from '../sync/syncService.js';
import { createMovement } from '../modules/movements/movements.service.js';

async function main() {
  logger.info('Seed: sincronizando dados (modo mock)…');
  const result = await runFullSync('manual');
  logger.info('Seed: sync concluído', { ok: result.ok });

  const stores = await prisma.store.findMany({ orderBy: { name: 'asc' }, take: 2 });
  const product = await prisma.product.findFirst({
    where: { stockItems: { some: { storeId: stores[0]?.id, quantity: { gt: 5 } } } },
  });

  if (stores.length >= 2 && product) {
    await createMovement({
      type: 'TRANSFER',
      productId: product.id,
      fromStoreId: stores[0].id,
      toStoreId: stores[1].id,
      quantity: 2,
      reason: 'Transferência de exemplo (seed)',
      createdBy: 'seed',
      confirm: false,
    });
    logger.info('Seed: movimentação de exemplo criada', {
      product: product.description,
      from: stores[0].name,
      to: stores[1].name,
    });
  }

  await prisma.$disconnect();
  logger.info('Seed concluído.');
}

main().catch(async (err) => {
  logger.error('Falha no seed', { error: err instanceof Error ? err.message : String(err) });
  await prisma.$disconnect();
  process.exit(1);
});
