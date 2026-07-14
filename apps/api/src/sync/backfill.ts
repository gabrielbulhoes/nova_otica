/**
 * Carga histórica de vendas — roda uma vez na implantação (e quando quiser
 * ampliar o histórico). Janelas mensais para não estourar o conector.
 *
 *   npm run sync:backfill --workspace=@nova-otica/api            # 24 meses
 *   npm run sync:backfill --workspace=@nova-otica/api -- 12      # 12 meses
 *
 * Pré-requisito: um sync completo já executado (lojas/produtos/clientes na
 * base). Upserts por externalId — reexecutar é inofensivo.
 */
import { prisma } from '../lib/prisma.js';
import { backfillSalesHistory } from './syncService.js';

const months = Math.max(1, Math.min(60, Number(process.argv[2] ?? 24)));

const entities = await backfillSalesHistory(months);
const failed = Object.entries(entities).filter(([, v]) => v.error);
// eslint-disable-next-line no-console
console.log(`\nBackfill: ${Object.keys(entities).length} meses processados, ${failed.length} com erro.`);
for (const [mes, v] of failed) console.log(`  ❌ ${mes}: ${v.error}`);
await prisma.$disconnect();
process.exit(failed.length > 0 ? 2 : 0);
