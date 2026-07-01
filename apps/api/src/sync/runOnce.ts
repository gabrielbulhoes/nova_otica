/* Executa uma sincronização avulsa pela linha de comando. */
import { runFullSync } from './syncService.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

async function main() {
  const result = await runFullSync('manual');
  logger.info('Resultado da sincronização', result as unknown as Record<string, unknown>);
  await prisma.$disconnect();
  process.exit(result.ok ? 0 : 1);
}

main().catch(async (err) => {
  logger.error('Falha na sincronização avulsa', {
    error: err instanceof Error ? err.message : String(err),
  });
  await prisma.$disconnect();
  process.exit(1);
});
