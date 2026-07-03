import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { errorMiddleware } from './http/errorMiddleware.js';
import { requireAuth } from './modules/auth/auth.middleware.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { streamRouter } from './modules/stream/stream.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { storesRouter } from './modules/stores/stores.routes.js';
import { productsRouter } from './modules/products/products.routes.js';
import { stockRouter } from './modules/stock/stock.routes.js';
import { salesRouter } from './modules/sales/sales.routes.js';
import { customersRouter } from './modules/customers/customers.routes.js';
import { movementsRouter } from './modules/movements/movements.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { biRouter } from './modules/bi/bi.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { planningRouter } from './modules/planning/planning.routes.js';
import { alertsRouter } from './modules/alerts/alerts.routes.js';
import { cartRouter } from './modules/commerce/cart.routes.js';
import { ordersRouter } from './modules/commerce/orders.routes.js';
import { arRouter } from './modules/ar/ar.routes.js';
import { syncRouter } from './modules/sync/sync.routes.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN.split(',').map((o) => o.trim()) }));
  app.use(express.json({ limit: '1mb' }));

  // Readiness probe: confirma que a API responde E o banco está acessível.
  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', service: 'nova-otica-api', mode: env.SELLBIE_MODE, db: 'up' });
    } catch {
      res.status(503).json({ status: 'degraded', service: 'nova-otica-api', mode: env.SELLBIE_MODE, db: 'down' });
    }
  });

  // Autenticação: /login é público; /me é protegido dentro do próprio router.
  app.use('/api/auth', authRouter);

  // SSE: autentica via token de query (EventSource não envia cabeçalhos).
  app.use('/api/stream', streamRouter);

  // A partir daqui, toda a API exige autenticação.
  app.use('/api', requireAuth);

  app.use('/api/users', usersRouter);
  app.use('/api/stores', storesRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/stock', stockRouter);
  app.use('/api/sales', salesRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/movements', movementsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/bi', biRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/planning', planningRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/ar', arRouter);
  app.use('/api/sync', syncRouter);

  // 404 apenas para rotas de API não encontradas.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

  // Em produção (SERVE_WEB=true), a própria API serve o build do frontend.
  if (process.env.SERVE_WEB === 'true') {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dist = process.env.WEB_DIST_DIR || path.resolve(here, '../../web/dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));
  }

  app.use(errorMiddleware);

  return app;
}
