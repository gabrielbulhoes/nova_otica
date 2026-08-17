import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { lojaTrabalhaAPeca, resolveThreshold } from '../modules/alerts/alerts.service.js';
import { DEFAULT_PLANNING_CONFIG, estoqueIdealDaLoja } from '../modules/planning/planning.math.js';
import { PLANNED_STORE_WHERE } from '../modules/stores/store.scope.js';

/**
 * Calcula o estoque ideal de cada peça em cada loja e grava o LIMIAR DE ALERTA
 * em `StockItem.minStock` — feedback 6.0 · item 08.
 *
 *     npm run catalogo:estoque-ideal -- [dias] [--gravar]
 *
 * SEM `--gravar` ELE NÃO ESCREVE NADA. O padrão é ensaio a seco, e não é
 * cerimônia: este comando toca TODA posição de estoque da rede, e o campo que
 * ele preenche decide quando o painel de ruptura apita. Um número errado aqui
 * ou afoga a operação em alerta ou cala o alerta de quem está prestes a romper
 * — e nos dois casos a descoberta vem tarde.
 *
 * GRAVA O GATILHO, NÃO O ALVO. `estoqueIdealDaLoja` devolve os dois; o alvo é
 * para a tela. Gravar o alvo como limiar poria quase toda posição em "abaixo do
 * mínimo" no primeiro dia. Ver a nota da função.
 */

const JANELA_PADRAO = 90;
const LOTE = 1_000;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const gravar = args.includes('--gravar');
  const dias = Number(args.find((a) => /^\d+$/.test(a)) ?? JANELA_PADRAO) || JANELA_PADRAO;
  const desde = new Date(Date.now() - dias * 86_400_000);

  const lojas = await prisma.store.findMany({ where: PLANNED_STORE_WHERE, select: { id: true, name: true } });
  const nomePorLoja = new Map(lojas.map((l) => [l.id, l.name]));

  console.log(`\n── estoque ideal por loja · janela de ${dias} dias ──`);
  console.log(`   modo .................... ${gravar ? 'GRAVANDO em StockItem.minStock' : 'ENSAIO A SECO (use --gravar)'}`);
  console.log(`   lojas ................... ${lojas.length}\n`);

  let posicoes = 0;
  let comAlvo = 0;
  let zerados = 0;
  let gravados = 0;
  // O painel de ruptura, antes e depois — ver a nota longa no laço.
  let trabalhadas = 0;
  let alertasAntes = 0;
  let alertasDepois = 0;
  const exemplos: string[] = [];

  for (const [storeId, storeName] of nomePorLoja) {
    // Venda DA LOJA, peça a peça. O laço é por loja porque a loja mora em
    // `Sale` e o Prisma não agrupa através de relação — e porque é o recorte
    // que interessa: o ideal de uma peça em Guarabira não tem nada a ver com o
    // giro dela em Midway.
    const vendas = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { storeId, saleDate: { gte: desde } } },
      _sum: { quantity: true },
    });
    const vendidoPorProduto = new Map(
      vendas.flatMap((v) => (v.productId ? [[v.productId, v._sum?.quantity ?? 0] as const] : [])),
    );

    const itens = await prisma.stockItem.findMany({
      where: { storeId },
      select: {
        productId: true,
        quantity: true,
        reserved: true,
        minStock: true,
        product: { select: { minStock: true } },
      },
    });

    const aGravar: { productId: string; minimo: number }[] = [];
    for (const it of itens) {
      posicoes += 1;

      /*
       * O ANTES E O DEPOIS DO PAINEL DE RUPTURA.
       *
       * Esta contagem é a condição que eu mesmo pus para autorizar o
       * `--gravar`, e ela continua certa: o campo que este comando preenche
       * decide quando o alerta apita. Sem medir os dois lados, gravar é apostar
       * em duas direções ao mesmo tempo — pode afogar a operação em alerta novo
       * ou CALAR alerta que hoje dispara pelo padrão da rede.
       *
       * Conta só as posições que a loja TRABALHA, a mesma guarda do painel
       * (`lojaTrabalhaAPeca`). Contar sobre toda posição do banco daria um
       * número que a tela nunca mostra, e comparar com ele não decide nada.
       *
       * Nota de precisão: a janela aqui é a do comando (`dias`, 90 por padrão)
       * e a do painel é de 180. Onde as duas divergem, esta contagem é a
       * CONSERVADORA — vê menos posições como "trabalhadas", então nunca
       * promete uma queda de alertas maior do que a real.
       */
      const vendeu = (vendidoPorProduto.get(it.productId) ?? 0) > 0;
      if (lojaTrabalhaAPeca(it.quantity, vendeu)) {
        // Sem `pendingDelta`: o comando roda fora do ciclo de requisição e o
        // delta é volátil por natureza. A diferença é de unidades em trânsito,
        // e o que se compara aqui são duas réguas sobre a MESMA foto.
        const disponivel = Math.max(it.quantity - it.reserved, 0);
        const limiarHoje = resolveThreshold(it.minStock, it.product.minStock, env.DEFAULT_MIN_STOCK);
        if (disponivel <= limiarHoje) alertasAntes += 1;
        trabalhadas += 1;
      }
      const { ideal, minimo } = estoqueIdealDaLoja(
        { unitsSold: vendidoPorProduto.get(it.productId) ?? 0, days: dias },
        DEFAULT_PLANNING_CONFIG,
      );
      if (ideal > 0) comAlvo += 1;
      else zerados += 1;

      /*
       * SÓ ESCREVE ONDE HÁ EVIDÊNCIA — e isto apareceu no primeiro ensaio.
       *
       * A versão anterior gravava o limiar em toda posição, inclusive as de
       * demanda zero, onde o limiar calculado é 0. Contra o banco de teste
       * foram 8.310 posições, TODAS indo para zero.
       *
       * Zero em `minStock` não é "sem opinião": é uma opinião forte, porque a
       * cascata de `resolveThreshold` respeita o valor da loja acima de tudo.
       * Escrevê-lo desligaria o alerta de ruptura daquela posição — inclusive
       * onde hoje ele dispara pelo padrão da rede. Um comando de "definir
       * estoque ideal" que emudece metade do painel de ruptura é exatamente o
       * tipo de efeito colateral que ninguém liga à causa três semanas depois.
       *
       * `null` onde não há venda deixa a cascata como está (mínimo do produto,
       * senão o da rede). O comando só ACRESCENTA precisão onde tem lastro.
       */
      // O DEPOIS: o mesmo teste, com o limiar que este comando gravaria.
      // Onde ele não grava (sem venda na loja), a cascata segue como está —
      // então o limiar do "depois" é o de hoje, e a posição conta igual nos
      // dois lados. É por isso que a maior parte dos 35 mil não se move: o
      // conserto delas é a guarda do painel, não este comando.
      if (lojaTrabalhaAPeca(it.quantity, vendeu)) {
        const disponivel = Math.max(it.quantity - it.reserved, 0);
        const limiarDepois =
          ideal > 0 ? minimo : resolveThreshold(it.minStock, it.product.minStock, env.DEFAULT_MIN_STOCK);
        if (disponivel <= limiarDepois) alertasDepois += 1;
      }

      if (ideal > 0 && it.minStock !== minimo) aGravar.push({ productId: it.productId, minimo });
      if (ideal > 0 && exemplos.length < 6) {
        exemplos.push(
          `      ${storeName.padEnd(30)} tem ${String(it.quantity).padStart(3)} · ideal ${String(ideal).padStart(3)} · alerta abaixo de ${minimo}`,
        );
      }
    }

    if (gravar) {
      for (let i = 0; i < aGravar.length; i += LOTE) {
        await prisma.$transaction(
          aGravar.slice(i, i + LOTE).map((a) =>
            prisma.stockItem.update({
              where: { storeId_productId: { storeId, productId: a.productId } },
              data: { minStock: a.minimo },
            }),
          ),
        );
      }
    }
    gravados += aGravar.length;
  }

  console.log(`   posições de estoque ..... ${posicoes}`);
  console.log(`   com alvo (a loja vende) . ${comAlvo}`);
  console.log(`   sem venda na loja ....... ${zerados}  ← intocadas, a cascata segue como está`);
  console.log(`   limiares a mudar ........ ${gravados}${gravar ? ' (GRAVADOS)' : ' (nada foi escrito)'}`);

  // ── O painel de ruptura, antes e depois ──────────────────────────────────
  const delta = alertasDepois - alertasAntes;
  const sinal = delta > 0 ? `+${delta}` : String(delta);
  console.log('');
  console.log(`   posições que a loja trabalha .. ${trabalhadas}  ← o universo do painel`);
  console.log(`   alertas de ruptura HOJE ....... ${alertasAntes}`);
  console.log(`   alertas com os limiares novos . ${alertasDepois}  (${sinal})`);
  if (delta > 0) {
    console.log('');
    console.log(`   ATENÇÃO: os limiares novos ACRESCENTAM ${delta} alertas. Isso acontece onde a`);
    console.log('   loja vende bem e o mínimo calculado fica ACIMA do padrão da rede — é');
    console.log('   correto, mas confira se a operação aguenta o volume antes de gravar.');
  } else if (delta < 0) {
    console.log('');
    console.log(`   Os limiares novos SILENCIAM ${-delta} alertas. Confira a amostra acima: cada`);
    console.log('   um deles é uma posição que hoje apita pelo padrão 3 e passaria a não');
    console.log('   apitar. Onde a loja não vende a peça, é o resultado desejado.');
  }
  if (exemplos.length) {
    console.log('\n   amostra:');
    for (const e of exemplos) console.log(e);
  }
  if (!gravar) {
    console.log('\n   Nada foi escrito. Confira os números acima e repita com --gravar.');
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
