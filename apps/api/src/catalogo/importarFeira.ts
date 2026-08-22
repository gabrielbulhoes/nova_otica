import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import { prisma } from '../lib/prisma.js';
import { abrirPlanilha } from '../lib/xlsx.js';
import { lerOfertaDeFeira, OBRIGATORIOS } from './ofertaDeFeira.js';

/**
 * Importa a planilha de oferta de um fornecedor e abre (ou atualiza) a feira.
 *
 *     npm run catalogo:feira -- <arquivo.xlsx> --fornecedor "Safilo" \
 *       --colecao "Safilo 2026" [--piso 900] [--risco equilibrado] \
 *       [--chegada 2026-09-01] [--alvo 2027-03-31]
 *
 * ELE FALA. Sempre — quais colunas casaram, quais foram ignoradas, quantas
 * linhas caíram e por quê. A regra de mix ficou meses desligada em produção
 * porque um arquivo ausente virava `null` sem barulho; um importador mudo é a
 * mesma armadilha com outro nome.
 *
 * IDEMPOTENTE por (feira, SKU): reenviar a planilha corrigida atualiza a oferta
 * sem duplicar linha e SEM apagar o que já foi comprado — que é o dado que não
 * se recalcula.
 */

const LOTE = 500;

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const caminho = process.argv.slice(2).find((a) => !a.startsWith('--') && /\.xlsx$/i.test(a));
  const fornecedor = arg('fornecedor');
  const colecao = arg('colecao') ?? arg('coleção');

  if (!caminho || !fornecedor || !colecao) {
    console.error(
      '\nuso: npm run catalogo:feira -- <arquivo.xlsx> --fornecedor "Safilo" --colecao "Safilo 2026"' +
        '\n     [--piso 900] [--risco conservador|equilibrado|agressivo]' +
        '\n     [--chegada AAAA-MM-DD] [--alvo AAAA-MM-DD]\n',
    );
    process.exitCode = 1;
    return;
  }

  const planilha = abrirPlanilha(readFileSync(caminho));
  const r = lerOfertaDeFeira(planilha);

  console.log(`\n── oferta de feira · ${basename(caminho)} ──`);
  console.log(`   fornecedor .............. ${fornecedor}`);
  console.log(`   coleção ................. ${colecao}`);
  console.log('');
  console.log('   colunas reconhecidas:');
  for (const [titulo, campo] of Object.entries(r.colunas)) {
    console.log(`      ${titulo.padEnd(28)} → ${campo}`);
  }
  if (r.ignoradas.length) {
    // Coluna ignorada em silêncio é como o gênero nunca entra e ninguém
    // descobre — até o plano vir sem gênero nenhum meses depois.
    console.log(`\n   colunas IGNORADAS (${r.ignoradas.length}): ${r.ignoradas.join(', ')}`);
    console.log('      Se alguma delas deveria ter entrado, me diga o título exato.');
  }
  if (r.ausentes.length) {
    console.log(`\n   campos ausentes: ${r.ausentes.join(', ')}`);
  }

  const faltamObrigatorios = OBRIGATORIOS.filter((k) => r.ausentes.includes(k));
  if (faltamObrigatorios.length) {
    console.error(
      `\n   ABORTADO: sem ${faltamObrigatorios.join(', ')} não há o que planejar.` +
        '\n   Mil linhas erradas são piores que nenhuma linha com o motivo.\n',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\n   linhas lidas ............ ${r.linhas.length}`);
  if (r.repetidos > 0) console.log(`   SKUs repetidos .......... ${r.repetidos}  ← a última ocorrência venceu`);
  if (r.descartadas.length) {
    console.log(`   linhas descartadas ...... ${r.descartadas.length}`);
    for (const d of r.descartadas.slice(0, 8)) console.log(`      linha ${d.linha}: ${d.motivo}`);
    if (r.descartadas.length > 8) console.log(`      … e mais ${r.descartadas.length - 8}`);
  }
  if (r.linhas.length === 0) {
    console.error('\n   Nenhuma linha aproveitável. Nada foi gravado.\n');
    process.exitCode = 1;
    return;
  }

  const data = (s?: string) => (s ? new Date(`${s}T00:00:00`) : null);

  // Reenviar a planilha de uma feira que já existe ATUALIZA o evento, não cria
  // outro. E só mexe nos parâmetros que vieram na linha de comando: quem
  // reenvia a oferta corrigida no meio da feira não quer que o piso volte a
  // zero porque esqueceu de repetir `--piso`.
  const existente = await prisma.purchaseFair.findFirst({
    where: { supplier: fornecedor, collection: colecao },
    select: { id: true },
  });
  const parametros = {
    ...(arg('piso') ? { floorUnits: Math.max(0, Math.trunc(Number(arg('piso')) || 0)) } : {}),
    ...(arg('risco') ? { risk: arg('risco')! } : {}),
    ...(arg('chegada') ? { arrivesAt: data(arg('chegada')) } : {}),
    ...(arg('alvo') ? { targetAt: data(arg('alvo')) } : {}),
  };
  const feira = existente
    ? await prisma.purchaseFair.update({ where: { id: existente.id }, data: parametros })
    : await prisma.purchaseFair.create({
        data: { supplier: fornecedor, collection: colecao, ...parametros },
      });

  // Em lotes, e por SKU: reenviar a planilha corrigida atualiza a linha sem
  // tocar em `bought`, que é o registro da compra no balcão.
  let gravadas = 0;
  for (let i = 0; i < r.linhas.length; i += LOTE) {
    const lote = r.linhas.slice(i, i + LOTE);
    await prisma.$transaction(
      lote.map((l) =>
        prisma.purchaseFairOffer.upsert({
          where: { fairId_sku: { fairId: feira.id, sku: l.sku } },
          create: { fairId: feira.id, ...l },
          update: {
            description: l.description,
            brand: l.brand,
            tipo: l.tipo,
            genero: l.genero,
            formato: l.formato,
            cor: l.cor,
            unitCost: l.unitCost,
            unitPrice: l.unitPrice,
          },
        }),
      ),
    );
    gravadas += lote.length;
  }

  const comprado = await prisma.purchaseFairOffer.aggregate({
    where: { fairId: feira.id },
    _sum: { bought: true },
  });

  console.log(`\n   feira ................... ${feira.id}`);
  console.log(`   ofertas gravadas ........ ${gravadas}`);
  console.log(`   piso da compra .......... ${feira.floorUnits} un. · risco ${feira.risk}`);
  if ((comprado._sum.bought ?? 0) > 0) {
    console.log(`   já comprado ............. ${comprado._sum.bought} un.  ← preservado`);
  }
  console.log('\n   Abra Estratégia comercial → Feira para ver o plano.\n');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
