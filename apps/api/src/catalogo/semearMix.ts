import { writeFileSync } from 'node:fs';
import { prisma } from '../lib/prisma.js';
import { analysisBrand, normBrandKey } from '../modules/planning/planning.math.js';
import { decomporDescricao } from './atributos.js';
import { PLANNED_STORE_WHERE } from '../modules/stores/store.scope.js';
import { derivarMixPorLoja, mixEmCsv, type EvidenciaDeMix } from './mixPorLoja.js';

/**
 * Gera o RASCUNHO do mix por loja a partir do histórico da rede.
 *
 *     npm run catalogo:semear-mix -- [meses] [pasta-de-saida]
 *
 * Sai com dois arquivos:
 *   · `mix-por-loja.csv`  → o que o cliente confere e corrige
 *   · `premium-stores.json` → o bloco pronto para o catálogo de grifes
 *
 * NÃO GRAVA NADA NO BANCO NEM NO CATÁLOGO EM USO. A regra que decide o que a
 * rede compra e transfere não pode passar a valer por efeito colateral de um
 * script — ela entra quando alguém olhar o CSV e disser que está certo.
 */

const MESES_PADRAO = 12;

async function main(): Promise<void> {
  const meses = Number(process.argv[2] ?? MESES_PADRAO) || MESES_PADRAO;
  const pasta = process.argv[3] ?? '.';
  const desde = new Date(Date.now() - meses * 30 * 86_400_000);

  const lojas = await prisma.store.findMany({ where: PLANNED_STORE_WHERE, select: { id: true, name: true } });
  const nomePorLoja = new Map(lojas.map((l) => [l.id, l.name]));

  /*
   * SÓ PEÇA DE MODA, E SÓ PELA CHAVE QUE O MOTOR COMPARA.
   *
   * Duas armadilhas, as duas descobertas rodando isto contra o catálogo real.
   *
   * 1. `analysisBrand` CAI NO FORNECEDOR quando a descrição não tem grife. É o
   *    comportamento certo para lente, e é veneno aqui: a primeira rodada
   *    produziu regra de mix para "CARL ZEISS VISION BRASIL INDUSTRIA OPTICA
   *    LTDA" e "CLEANLAB IND.OPTICA" — razão social, não grife. Restringir a
   *    compra da rede por fornecedor é a mesma confusão de espaços de nome que
   *    já custou uma entrega inteira nesta plataforma.
   *
   *    O filtro é `decomporDescricao`: só entra o que a descrição do CDS monta
   *    como peça de moda (`REF COR TAM GRUPO MARCA`). Lente e serviço não têm
   *    grife e não têm por que restringir loja nenhuma.
   *
   * 2. A CHAVE tem de ser a de `analysisBrand`, e não a marca que a
   *    decomposição devolve. É `analysisBrand` que o motor chama em tempo de
   *    execução; semear por outra função faria a regra existir no arquivo e não
   *    valer na hora — o defeito que a migração a11 consertou noutra tabela.
   */
  const produtos = await prisma.product.findMany({
    select: { id: true, description: true, category: true, brand: true },
  });
  const grifePorProduto = new Map<string, string>();
  let semFormato = 0;
  let divergentes = 0;
  for (const p of produtos) {
    const partes = decomporDescricao(p.description);
    if (!partes) {
      semFormato += 1;
      continue;
    }
    const g = analysisBrand(p.description, p.category, p.brand);
    if (!g) continue;
    // As duas leituras precisam concordar. Divergir é sinal de que uma das
    // pontas mudou, e o número aparece em vez de virar regra torta em silêncio.
    if (normBrandKey(g) !== normBrandKey(partes.marca)) divergentes += 1;
    grifePorProduto.set(p.id, g);
  }

  const idsDasLojas = [...nomePorLoja.keys()];
  const evidencias: EvidenciaDeMix[] = [];

  // O ESTOQUE é uma linha por (loja, produto) — cabe de uma vez.
  const estoque = await prisma.stockItem.findMany({
    where: { storeId: { in: idsDasLojas } },
    select: { storeId: true, productId: true, quantity: true },
  });
  for (const s of estoque) {
    const grife = grifePorProduto.get(s.productId);
    const storeName = nomePorLoja.get(s.storeId);
    if (grife && storeName && s.quantity > 0) {
      evidencias.push({ storeName, grife, unidadesVendidas: 0, unidadesEmEstoque: s.quantity });
    }
  }

  // AS VENDAS são item a item, e doze meses de dezesseis lojas não cabem numa
  // consulta só num processo limitado a 768 MB. A loja mora em `Sale`, e o
  // Prisma não agrupa através de relação — então o laço é por LOJA, que é
  // também o recorte que interessa, e agrega em memória por grife.
  for (const [storeId, storeName] of nomePorLoja) {
    const itens = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { storeId, saleDate: { gte: desde } } },
      _sum: { quantity: true },
    });
    const porGrife = new Map<string, number>();
    for (const i of itens) {
      const grife = i.productId ? grifePorProduto.get(i.productId) : undefined;
      if (!grife) continue;
      porGrife.set(grife, (porGrife.get(grife) ?? 0) + (i._sum?.quantity ?? 0));
    }
    for (const [grife, unidades] of porGrife) {
      evidencias.push({ storeName, grife, unidadesVendidas: unidades, unidadesEmEstoque: 0 });
    }
  }

  const resultado = derivarMixPorLoja(
    evidencias,
    lojas.map((l) => l.name),
  );

  const csv = `${pasta}/mix-por-loja.csv`;
  const json = `${pasta}/premium-stores.json`;
  writeFileSync(csv, mixEmCsv(resultado, evidencias), 'utf8');
  writeFileSync(json, JSON.stringify({ premiumStores: resultado.premiumStores }, null, 2), 'utf8');

  console.log(`\n── mix por loja · rascunho de ${meses} meses ──`);
  console.log(`   lojas da rede ........... ${resultado.lojas.length}`);
  console.log(`   peças de moda ........... ${grifePorProduto.size}  (${semFormato} fora do formato: lente, serviço)`);
  if (divergentes > 0) {
    console.log(`   !! ${divergentes} produtos em que analysisBrand e a descrição discordam da grife — confira antes de usar`);
  }
  console.log(`   grifes com histórico .... ${resultado.resumo.grifes}`);
  console.log(`   RESTRINGEM .............. ${resultado.resumo.restritas}  ← viram regra`);
  console.log(`   universais (toda loja) .. ${resultado.resumo.universais}  (não restringem — seria só risco)`);
  console.log(`   evidência rala .......... ${resultado.resumo.ralas}  (1 loja só — acaso, não decisão de mix)`);
  console.log(`\n   ${csv}   ← mande este para o cliente conferir`);
  console.log(`   ${json}  ← só depois de conferido, entra no catálogo\n`);

  const exemplos = resultado.derivado.filter((d) => d.lojasDeFora.length > 0).slice(0, 8);
  if (exemplos.length) {
    console.log('   as exclusões mais relevantes:');
    for (const d of exemplos) {
      console.log(
        `      ${d.grife.padEnd(24)} em ${String(d.lojas.length).padStart(2)} lojas · fora de ${d.lojasDeFora.length}` +
          ` · ${d.unidadesVendidas} un. vendidas`,
      );
    }
    console.log('');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
