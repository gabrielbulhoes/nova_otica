import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { getFrescor } from './sync/syncHealth.js';
import { statusDoCatalogo } from './modules/planning/brandCatalog.js';
import { statusDosAtributos } from './catalogo/status.js';
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
import { paymentsWebhookRouter } from './modules/commerce/payments.webhook.js';
import { arRouter } from './modules/ar/ar.routes.js';
import { fiscalRouter } from './modules/fiscal/fiscal.routes.js';
import { syncRouter } from './modules/sync/sync.routes.js';

/**
 * Quando ESTE processo subiu — carimbado na importação do módulo, não a cada
 * requisição.
 *
 * Fora de `createApp` de propósito: dentro dela, cada `createApp()` de teste
 * criaria um instante novo, e o valor deixaria de significar "desde quando a
 * API está de pé".
 */
const INICIADO_EM = new Date().toISOString();

export function createApp() {
  const app = express();

  // Atrás de reverse proxy, faz req.ip refletir o cliente real (usado pelo
  // rate-limit do login). Configurável por TRUST_PROXY (0 = não confia).
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN.split(',').map((o) => o.trim()) }));
  app.use(express.json({ limit: '1mb' }));

  // Readiness probe: confirma que a API responde E o banco está acessível.
  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      res.status(503).json({ status: 'degraded', service: 'nova-otica-api', mode: env.SELLBIE_MODE, db: 'down' });
      return;
    }

    // Daqui para baixo a resposta JÁ É 200. O frescor do sync entra como
    // informação, nunca como veredito.
    //
    // O frescor está aqui para que QUALQUER monitor externo (e o próprio
    // Argos, com um curl) enxergue a base vencida sem precisar entrar no
    // banco. Mas ele custa uma segunda consulta, e antes essa consulta estava
    // DENTRO do mesmo `try` do `SELECT 1` — de modo que uma lentidão ou um
    // erro ao ler `SyncRun` derrubava a prova de vida da aplicação inteira.
    //
    // Isso importa mais do que parece: o Caddy é o único caminho para a
    // internet e faz checagem ativa nesta rota (docker/Caddyfile). Com um
    // destino só, uma checagem que falha vira **503 em toda requisição** até
    // a próxima passar — a tela inteira, não só a rota lenta. Ou seja: um
    // detalhe de observabilidade tinha poder de veto sobre a
    // disponibilidade. Não tem mais.
    let sync: Awaited<ReturnType<typeof getFrescor>> | null = null;
    try {
      sync = await getFrescor();
    } catch {
      // engolido de propósito — ver acima
    }

    // Pelo mesmo motivo, e com o mesmo cuidado: informação, nunca veredito.
    let atributos: Awaited<ReturnType<typeof statusDosAtributos>> | null = null;
    try {
      atributos = await statusDosAtributos();
    } catch {
      // engolido de propósito — ver acima
    }

    res.json({
      status: 'ok',
      service: 'nova-otica-api',
      // A VERSÃO QUE ESTÁ NO AR, e desde quando este processo subiu.
      //
      // Existe por causa de um erro concreto: em 8/8/2026 um parecer afirmou
      // ao cliente que dois consertos estavam publicados — e a esteira de
      // deploy estava quebrada havia dois dias. O código estava mesclado, a CI
      // verde, e ninguém percebeu, porque "mesclado" e "no ar" não tinham como
      // ser distinguidos de fora. Um `curl` agora responde a pergunta.
      //
      // `iniciadoEm` acompanha porque as duas falham separado: a imagem pode
      // estar construída na versão nova e o contêiner ainda rodando a antiga.
      // Versão sem hora de início não distingue "publicado" de "publicado e
      // reiniciado".
      //
      // `null` quando a imagem foi construída sem o carimbo — é honesto, e
      // quem lê sabe que precisa perguntar em vez de confiar.
      versao: env.GIT_SHA || null,
      iniciadoEm: INICIADO_EM,
      // A REGRA DE MIX ESTÁ VALENDO?
      //
      // Pela mesma razão da `versao`: ela esteve permissiva em produção desde
      // sempre — o catálogo é gitignorado, o Dockerfile não o copiava e o
      // contêiner não tinha por onde recebê-lo — e nada dizia isso. Duas
      // entregas declaradas prontas ao cliente (o mix do remanejamento e o da
      // distribuição) não faziam nada, e a lista de "lojas excluídas por mix"
      // vinha vazia porque não havia catálogo, não porque não havia exclusão.
      //
      // Aqui em cima, um `curl` responde. E a `impressao` responde a segunda
      // pergunta, que só aparece depois da primeira: valendo com QUAL catálogo
      // — já que atualizá-lo é trocar o arquivo e reiniciar, o que não muda a
      // versão da imagem.
      mix: statusDoCatalogo(),
      // OS ATRIBUTOS DE PEÇA ESTÃO CARREGADOS?
      //
      // Terceira armadilha da mesma família: gênero, formato, best-seller e o
      // teto de desconto do CDS entram por importador MANUAL. Não rodar, ou
      // rodar contra o banco errado, deixa o motor decidindo sem o dado — e
      // sem nada dizendo. `null` aqui é "não consegui apurar", distinto de
      // zero, que é "apurei e não tem nada".
      atributos,
      mode: env.SELLBIE_MODE,
      db: 'up',
      sync: sync
        ? {
            ultimoSucesso: sync.ultimoSucesso?.toISOString() ?? null,
            horas: sync.horas === null ? null : Math.round(sync.horas * 10) / 10,
            vencido: sync.vencido,
            limiteHoras: sync.limiteHoras,
          }
        : // `null` e não um objeto com campos vazios: "não consegui apurar" e
          // "apurei e está em dia" precisam ser distinguíveis por quem lê.
          null,
    });
  });

  // Autenticação: /login é público; /me é protegido dentro do próprio router.
  app.use('/api/auth', authRouter);

  // SSE: autentica via token de query (EventSource não envia cabeçalhos).
  app.use('/api/stream', streamRouter);

  // Webhook de pagamento: público (gateway não usa JWT); valida x-signature.
  app.use('/api/payments', paymentsWebhookRouter);

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
  app.use('/api/fiscal', fiscalRouter);
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
