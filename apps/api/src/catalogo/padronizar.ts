import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { esquecerStatusDosAtributos } from './status.js';
import { padronizarPeca, type FonteDeAtributo, type MudancaDePadronizacao } from './padronizacao.js';
import {
  NAO_IDENTIFICADO,
  normFormatoLente,
  normMaterialArmacao,
  type FormatoLenteChave,
  type MaterialArmacaoChave,
} from '../modules/planning/planning.math.js';

const log = logger.child({ mod: 'catalogo' });

/**
 * PADRONIZA FORMATO DA LENTE E MATERIAL DA ARMAÇÃO — rodada final · item 03.
 *
 *     node apps/api/dist/catalogo/padronizar.js            # ENSAIO (não grava)
 *     node apps/api/dist/catalogo/padronizar.js --gravar   # grava
 *
 * ENSAIO POR PADRÃO, como o `estoqueIdeal`. O comando percorre o catálogo
 * inteiro e escreve em duas colunas de todas as peças de moda; um engano aqui
 * não tem desfazer barato. Quem vê o relatório e concorda roda de novo com
 * `--gravar`.
 *
 * ELE FALA. Quantas classificou, por fonte e por campo, quantas ficaram em
 * "não identificado" — e os TEXTOS que mais caíram ali. Esse último bloco é o
 * que faz o dicionário de sinônimos crescer com dado real em vez de
 * adivinhação: cada linha dele é uma grafia que algum fornecedor usa e que o
 * padronizador ainda não conhece.
 */

const LOTE_LEITURA = 2000;
const LOTE_ESCRITA = 500;

interface Contagem {
  formato: Record<string, number>;
  material: Record<string, number>;
  porFonte: Record<string, number>;
}

const somar = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};

async function main(): Promise<void> {
  const gravar = process.argv.includes('--gravar');

  const contagem: Contagem = { formato: {}, material: {}, porFonte: {} };
  const naoIdentificadoFormato = new Map<string, number>();
  const naoIdentificadoMaterial = new Map<string, number>();
  let peças = 0;
  let foraDoEscopo = 0;
  let jaPadronizadas = 0;
  let semTextoNemDescricao = 0;
  const mudancas: MudancaDePadronizacao[] = [];

  let cursor: string | undefined;
  for (;;) {
    const lote = await prisma.product.findMany({
      take: LOTE_LEITURA,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        description: true,
        category: true,
        attributes: {
          select: {
            formato: true,
            material: true,
            formatoLente: true,
            materialArmacao: true,
            fonteFormato: true,
            fonteMaterial: true,
            fonteCadastro: true,
            cadastroEm: true,
            erpEm: true,
          },
        },
      },
    });
    if (lote.length === 0) break;
    cursor = lote[lote.length - 1].id;

    for (const p of lote) {
      const a = p.attributes;
      // A fonte do TEXTO gravado: veio de planilha (`cadastroEm`) ou do ERP.
      const fonteDoTexto: FonteDeAtributo | null = a?.cadastroEm ? 'ficha' : a?.erpEm ? 'erp' : null;
      const mudanca = padronizarPeca({
        productId: p.id,
        description: p.description,
        category: p.category,
        formatoTexto: a?.formato ?? null,
        materialTexto: a?.material ?? null,
        formatoAtual: { valor: (a?.formatoLente as FormatoLenteChave | null) ?? null, fonte: a?.fonteFormato ?? null },
        materialAtual: {
          valor: (a?.materialArmacao as MaterialArmacaoChave | null) ?? null,
          fonte: a?.fonteMaterial ?? null,
        },
        fonteDoTexto,
      });

      if (!p.category || !mudanca) {
        // Separar "não é peça de moda" de "já estava padronizada" de "não há
        // texto nem palavra na descrição": as três pedem ações diferentes, e
        // um número só somando as três não diz o que fazer a seguir.
        const ehModa = mudanca !== null || (a?.formatoLente ?? a?.materialArmacao ?? null) !== null;
        if (!ehModa && !a) foraDoEscopo += 1;
        else if (a?.formatoLente || a?.materialArmacao) jaPadronizadas += 1;
        else semTextoNemDescricao += 1;
      }

      // Os textos que o padronizador NÃO entendeu — a lista de compras do
      // dicionário de sinônimos.
      if (a?.formato && normFormatoLente(a.formato) === NAO_IDENTIFICADO) {
        naoIdentificadoFormato.set(a.formato, (naoIdentificadoFormato.get(a.formato) ?? 0) + 1);
      }
      if (a?.material && normMaterialArmacao(a.material) === NAO_IDENTIFICADO) {
        naoIdentificadoMaterial.set(a.material, (naoIdentificadoMaterial.get(a.material) ?? 0) + 1);
      }

      if (!mudanca) continue;
      peças += 1;
      if (mudanca.formatoLente) {
        somar(contagem.formato, mudanca.formatoLente);
        somar(contagem.porFonte, `formato:${mudanca.fonteFormato}`);
      }
      if (mudanca.materialArmacao) {
        somar(contagem.material, mudanca.materialArmacao);
        somar(contagem.porFonte, `material:${mudanca.fonteMaterial}`);
      }
      mudancas.push(mudanca);
    }
  }

  if (gravar) {
    for (let i = 0; i < mudancas.length; i += LOTE_ESCRITA) {
      await prisma.$transaction(
        mudancas.slice(i, i + LOTE_ESCRITA).map((m) => {
          const dados = {
            ...(m.formatoLente ? { formatoLente: m.formatoLente, fonteFormato: m.fonteFormato } : {}),
            ...(m.materialArmacao ? { materialArmacao: m.materialArmacao, fonteMaterial: m.fonteMaterial } : {}),
          };
          return prisma.productAttribute.upsert({
            where: { productId: m.productId },
            create: { productId: m.productId, ...dados } as never,
            update: dados as never,
          });
        }),
      );
    }
    esquecerStatusDosAtributos();
  }

  const lista = (m: Record<string, number>) =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `      ${String(n).padStart(6)}  ${k}`)
      .join('\n');

  console.log(`\n── padronização do catálogo ${gravar ? '· GRAVANDO' : '· ENSAIO (nada foi gravado)'} ──`);
  console.log(`   peças a padronizar ...... ${peças}`);
  console.log(`   já padronizadas ......... ${jaPadronizadas}`);
  console.log(`   sem texto e sem palavra . ${semTextoNemDescricao}  ← estas dependem de ficha do fornecedor`);
  console.log(`   fora do escopo .......... ${foraDoEscopo}  (relógio, lente, acessório — não têm aro nem lente)`);
  if (peças > 0) {
    console.log('   por fonte:');
    console.log(lista(contagem.porFonte));
    console.log('   formato da lente:');
    console.log(lista(contagem.formato));
    console.log('   material da armação:');
    console.log(lista(contagem.material));
  }

  const dicionario = (m: Map<string, number>, titulo: string) => {
    if (m.size === 0) return;
    console.log(`   ${titulo} — textos que o padronizador não entendeu (os 30 mais frequentes):`);
    for (const [texto, n] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
      console.log(`      ${String(n).padStart(6)}  "${texto}"`);
    }
    console.log('      → cada linha acima é uma grafia a acrescentar aos sinônimos em planning.math.ts');
  };
  dicionario(naoIdentificadoFormato, 'formato');
  dicionario(naoIdentificadoMaterial, 'material');

  if (!gravar && peças > 0) {
    console.log('\n   Nada foi gravado. Para gravar:');
    console.log('      node apps/api/dist/catalogo/padronizar.js --gravar\n');
  } else {
    console.log('');
  }

  log.info('Padronização do catálogo', {
    gravou: gravar,
    pecas: peças,
    jaPadronizadas,
    semTexto: semTextoNemDescricao,
    foraDoEscopo,
  });
}

main()
  .catch((err) => {
    log.error('Falha ao padronizar catálogo', { error: err instanceof Error ? err.message : String(err) });
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
