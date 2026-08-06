/**
 * Carga histórica de vendas — roda uma vez na implantação (e quando quiser
 * ampliar o histórico). Janelas mensais para não estourar o conector.
 *
 *   npm run sync:backfill --workspace=@nova-otica/api            # 24 meses
 *   npm run sync:backfill --workspace=@nova-otica/api -- 12      # 12 meses
 *   npm run sync:backfill --workspace=@nova-otica/api -- tudo    # todo o histórico
 *
 * Pré-requisito: um sync completo já executado (lojas/produtos/clientes na
 * base). Upserts por externalId — reexecutar é inofensivo.
 */
import { prisma } from '../lib/prisma.js';
import { backfillSalesHistory, SyncInProgressError } from './syncService.js';

const arg = String(process.argv[2] ?? '24').trim().toLowerCase();
// `tudo` varre até encontrar o fim do histórico, em vez de apostar num número.
// Não sabemos desde quando o ERP guarda venda, e adivinhar erra dos dois
// lados: curto demais perde histórico, longo demais gasta horas em meses que
// nunca tiveram nada.
const opts =
  arg === 'tudo' || arg === 'all' || arg === '0'
    ? ({ meses: 'tudo' } as const)
    : ({ meses: Math.max(1, Math.min(240, Number(arg) || 24)) } as const);

let entities;
try {
  entities = await backfillSalesHistory(opts);
} catch (err) {
  // A trava é a proteção mais importante deste comando, e quem a encontra
  // precisa entender o que fazer — não receber uma pilha de chamadas.
  if (err instanceof SyncInProgressError) {
    // eslint-disable-next-line no-console
    console.error(
      'Já existe uma sincronização (ou outro backfill) em andamento.\n' +
        'Duas execuções em paralelo disputam as mesmas linhas e podem apagar\n' +
        'pagamentos de uma janela sem deixar rastro. Espere a atual terminar.\n\n' +
        'Para ver o que está rodando:\n' +
        '  docker compose -f docker-compose.prod.yml logs --tail=20 app',
    );
    await prisma.$disconnect();
    process.exit(3);
  }
  throw err;
}
const failed = Object.entries(entities).filter(([, v]) => v.error);
// eslint-disable-next-line no-console
console.log(`\nBackfill: ${Object.keys(entities).length} meses processados, ${failed.length} com erro.`);
for (const [mes, v] of failed) console.log(`  ❌ ${mes}: ${v.error}`);
await prisma.$disconnect();
process.exit(failed.length > 0 ? 2 : 0);
