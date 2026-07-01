import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { startScheduler, stopScheduler } from './sync/scheduler.js';

async function main() {
  const app = createApp();

  const server = app.listen(env.API_PORT, () => {
    logger.info('API no ar', {
      port: env.API_PORT,
      env: env.NODE_ENV,
      mode: env.SELLBIE_MODE,
    });
  });

  startScheduler();

  const shutdown = (signal: string) => {
    logger.info('Encerrando…', { signal });
    stopScheduler();
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Falha ao iniciar a API', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
