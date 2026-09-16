import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { abrirPlanilha } from '../lib/xlsx.js';
import { cruzar, lerCadastroFornecedor, lerTetoDeDesconto, reconhecerPlanilha } from './atributos.js';
import { classificarTextos, devoGravar } from './padronizacao.js';
import { esquecerStatusDosAtributos } from './status.js';

const log = logger.child({ mod: 'catalogo' });

/**
 * Importa cadastros de fornecedor e a planilha de desconto do CDS.
 *
 *     npm run catalogo:importar -- arquivo1.xlsx arquivo2.xlsx …
 *
 * O tipo de cada arquivo é reconhecido pelo cabeçalho — não pela ordem nem pelo
 * nome, que mudam a cada envio.
 *
 * ELE FALA. Sempre. Quantos produtos casaram, quantos não, e quais marcas mais
 * faltam. A regra de mix ficou meses desligada em produção porque um arquivo
 * ausente virava `null` sem barulho; um importador mudo é a mesma armadilha com
 * outro nome, e desta vez com 21 mil linhas por trás.
 */

const LOTE = 500;

async function importarCadastro(caminho: string, buf: Buffer): Promise<void> {
  const planilha = abrirPlanilha(buf);
  const { linhas: cadastro, marcas, ignoradas, repetidas } = lerCadastroFornecedor(planilha);
  const arquivo = basename(caminho);

  const produtos = await prisma.product.findMany({ select: { id: true, description: true } });
  const { encontrados, relatorio } = cruzar(
    produtos.map((p) => ({ productId: p.id, description: p.description })),
    cadastro,
    marcas,
  );

  const agora = new Date();
  const entradas = [...encontrados.entries()];
  /*
   * O QUE JÁ ESTÁ CLASSIFICADO, ANTES DE ESCREVER — rodada final.
   *
   * `classificarTextos` devolve `NAO_IDENTIFICADO` para todo texto que o
   * dicionário não reconhece, e a primeira versão mandava isso direto no
   * `update`: uma planilha nova com "Borboleta XPTO" apagava um `AVIADOR`
   * classificado antes. `devoGravar` existe exatamente para impedir isso
   * ("não sei" nunca apaga um "sei"), e não estava sendo chamado aqui.
   */
  const jaGravado = new Map(
    (
      await prisma.productAttribute.findMany({
        where: { productId: { in: entradas.map(([id]) => id) } },
        select: {
          productId: true,
          formatoLente: true,
          materialArmacao: true,
          fonteFormato: true,
          fonteMaterial: true,
        },
      })
    ).map((l) => [l.productId, l]),
  );
  for (let i = 0; i < entradas.length; i += LOTE) {
    await prisma.$transaction(
      entradas.slice(i, i + LOTE).map(([productId, a]) => {
        // A PADRONIZAÇÃO ACONTECE NA IMPORTAÇÃO (rodada final · item 03): o
        // texto do fornecedor continua guardado (é a auditoria), e ao lado
        // dele entram as chaves da lista fechada, com a procedência `ficha`.
        // Deixar isso só para o comando `catalogo:padronizar` faria toda
        // importação nova nascer sem perfil até alguém lembrar de rodá-lo.
        const padrao = classificarTextos(a.formato, a.material);
        const atual = jaGravado.get(productId);
        const padronizado = {
          ...(padrao.formatoLente &&
          devoGravar(
            { valor: atual?.formatoLente ?? null, fonte: atual?.fonteFormato ?? null },
            { valor: padrao.formatoLente, fonte: 'ficha' },
          )
            ? { formatoLente: padrao.formatoLente, fonteFormato: 'ficha' }
            : {}),
          ...(padrao.materialArmacao &&
          devoGravar(
            { valor: atual?.materialArmacao ?? null, fonte: atual?.fonteMaterial ?? null },
            { valor: padrao.materialArmacao, fonte: 'ficha' },
          )
            ? { materialArmacao: padrao.materialArmacao, fonteMaterial: 'ficha' }
            : {}),
        };
        return prisma.productAttribute.upsert({
          where: { productId },
          // O upsert atualiza SÓ o bloco do cadastro. `maxDiscountPct` e sua
          // procedência vêm da outra planilha e não podem ser apagados por
          // quem importa esta — foi assim que a marcação de fora-do-mix já se
          // perdeu uma vez, por escrita que não sabia o que estava sobrescrevendo.
          create: { productId, ...a, ...padronizado, fonteCadastro: arquivo, cadastroEm: agora },
          update: { ...a, ...padronizado, fonteCadastro: arquivo, cadastroEm: agora },
        });
      }),
    );
  }

  const marcasArquivo = [...marcas].sort().join(', ');
  esquecerStatusDosAtributos();
  console.log(`\n── ${arquivo} · cadastro de fornecedor ──`);
  console.log(
    `   linhas no arquivo ....... ${cadastro.size}` +
      `${ignoradas ? ` · ${ignoradas} sem Barra CDS` : ''}${repetidas ? ` · ${repetidas} barras repetidas (a última venceu)` : ''}`,
  );
  console.log(`   marcas do arquivo ....... ${marcas.size}: ${marcasArquivo.slice(0, 160)}${marcasArquivo.length > 160 ? '…' : ''}`);
  console.log(`   produtos no catálogo .... ${relatorio.produtos}`);
  console.log(`   fora do formato de moda . ${relatorio.semFormato}  (lente, serviço, acessório — esperado)`);
  console.log(`   CASARAM ................. ${relatorio.casados}`);
  console.log(`   marca de outro fornec. .. ${relatorio.marcaForaDoCadastro}  (esperado — pede-se o cadastro dele)`);
  console.log(`   MARCA DAQUI SEM CASAR ... ${relatorio.marcaNoCadastroSemCasar}  ← o único número que acusa problema de chave`);
  // A taxa é medida contra o que este arquivo TINHA COMO COBRIR. Medi-la contra
  // todas as peças de moda dá 0% para o cadastro da Marchon num catálogo de
  // Ray-Ban, e 0% ali não significa defeito nenhum.
  const base = relatorio.casados + relatorio.marcaNoCadastroSemCasar;
  if (base > 0) {
    console.log(
      `   taxa .................... ${((100 * relatorio.casados) / base).toFixed(1)}% das peças cujas marcas este arquivo cobre`,
    );
  }
  if (relatorio.marcasFaltantes.length) {
    console.log('   marcas que mais faltam:');
    for (const m of relatorio.marcasFaltantes) {
      const nota = m.noCadastro ? '← está no arquivo e não casou' : '(outro fornecedor)';
      console.log(`      ${String(m.produtos).padStart(5)}  ${m.marca.padEnd(22)} ${nota}`);
    }
  }
  log.info('Cadastro de fornecedor importado', { arquivo, ...relatorio, marcasFaltantes: undefined });
}

async function importarDesconto(caminho: string, buf: Buffer): Promise<void> {
  const planilha = abrirPlanilha(buf);
  const { tetos, ignoradas } = lerTetoDeDesconto(planilha);
  const arquivo = basename(caminho);

  // O casamento aqui é direto por `externalId` — sem heurística, sem formato.
  const produtos = await prisma.product.findMany({ select: { id: true, externalId: true } });
  const agora = new Date();
  const alvos = produtos.flatMap((p) => {
    const pct = tetos.get(p.externalId);
    return pct === undefined ? [] : [{ productId: p.id, pct }];
  });

  for (let i = 0; i < alvos.length; i += LOTE) {
    await prisma.$transaction(
      alvos.slice(i, i + LOTE).map(({ productId, pct }) =>
        prisma.productAttribute.upsert({
          where: { productId },
          create: { productId, maxDiscountPct: pct, fonteDesconto: arquivo, descontoEm: agora },
          update: { maxDiscountPct: pct, fonteDesconto: arquivo, descontoEm: agora },
        }),
      ),
    );
  }

  esquecerStatusDosAtributos();
  console.log(`\n── ${arquivo} · teto de desconto do CDS ──`);
  console.log(`   códigos no arquivo ...... ${tetos.size}${ignoradas ? ` (${ignoradas} linhas descartadas: rótulo/total)` : ''}`);
  console.log(`   produtos no catálogo .... ${produtos.length}`);
  console.log(`   CASARAM ................. ${alvos.length}`);
  console.log(`   sem teto ................ ${produtos.length - alvos.length}`);
  console.log(
    `   códigos do arquivo sem produto correspondente: ${tetos.size - alvos.length}` +
      ' (o arquivo cobre a rede inteira; este banco pode ter menos)',
  );
  log.info('Teto de desconto importado', { arquivo, codigos: tetos.size, casados: alvos.length });
}

async function main(): Promise<void> {
  const arquivos = process.argv.slice(2);
  if (arquivos.length === 0) {
    console.error('uso: npm run catalogo:importar -- <planilha.xlsx> [outra.xlsx …]');
    console.error('     reconhece cadastro de fornecedor ("Barra CDS") e promoção do CDS ("Rótulos de Linha").');
    process.exitCode = 1;
    return;
  }

  for (const caminho of arquivos) {
    let buf: Buffer;
    try {
      buf = readFileSync(caminho);
    } catch {
      console.error(`\n!! ${caminho}: não consegui ler o arquivo`);
      process.exitCode = 1;
      continue;
    }
    const tipo = reconhecerPlanilha(abrirPlanilha(buf));
    if (tipo === 'cadastro') await importarCadastro(caminho, buf);
    else if (tipo === 'desconto') await importarDesconto(caminho, buf);
    else {
      // Recusa em vez de adivinhar: importar a planilha errada em silêncio
      // gravaria atributo em produto nenhum e pareceria sucesso.
      console.error(`\n!! ${basename(caminho)}: cabeçalho não reconhecido.`);
      console.error('   Esperado "Barra CDS" (cadastro de fornecedor) ou "Rótulos de Linha" (promoção do CDS).');
      process.exitCode = 1;
    }
  }
  console.log('');
}

main()
  .catch((err) => {
    log.error('Falha ao importar catálogo', { error: err instanceof Error ? err.message : String(err) });
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
