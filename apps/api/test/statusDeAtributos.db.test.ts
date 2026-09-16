import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { esquecerStatusDosAtributos, statusDosAtributos } from '../src/catalogo/status.js';
import { prisma } from '../src/lib/prisma.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

/**
 * O `/health` NÃO PODE MENTIR LOGO DEPOIS DA ÚNICA AÇÃO QUE O MUDA.
 *
 * Em 16/09/2026 o padronizador gravou 2.559 peças e o `/health` continuou
 * dizendo `formato.naoIdentificado: 989`. A operação foi conferir no banco
 * achando que a gravação tinha falhado — não tinha: o número certo apareceu
 * sozinho minutos depois, quando a memória de um minuto venceu.
 *
 * A causa é de processo, não de banco: `esquecerStatusDosAtributos()` limpa a
 * memória de QUEM O CHAMA, e o padronizador roda por `docker exec`, fora do
 * processo da API. Ele limpava uma memória vazia, recém-criada, e ia embora.
 *
 * O que estes testes prendem é a correção — a memória agora é validada contra
 * um carimbo do banco — e, junto, o motivo de a memória existir: se alguém
 * "corrigir" isto apagando o cache, o `/health` volta a varrer a tabela nove
 * vezes por chamada num endpoint que o deploy consulta em laço.
 *
 * Os dados são fictícios, criados aqui com prefixo próprio e apagados no fim;
 * as asserções são todas sobre DELTA, porque o banco de teste é compartilhado.
 */
const PREFIXO = `statusatr_${Date.now()}`;
// Uma data fixa e antiga: o carimbo lê o MÁXIMO de `padronizadoEm`, então as
// duas peças precisam compartilhar a mesma data para o teste da CONTAGEM
// conseguir apagar uma sem mexer no máximo.
const PADRONIZADO_EM = new Date('2026-09-16T13:37:17.000Z');

let idA = '';
let idB = '';

d('status dos atributos (memória × escritor de outro processo)', () => {
  beforeAll(async () => {
    const criar = async (n: number) => {
      const p = await prisma.product.create({
        data: {
          externalId: `${PREFIXO}_p${n}`,
          sku: `STATUS${n}`,
          description: `ARMACAO DE TESTE ${n}`,
          category: 'ARMACAO',
          price: 100,
          cost: 40,
        },
      });
      await prisma.productAttribute.create({
        data: {
          productId: p.id,
          formatoLente: 'NAO_IDENTIFICADO',
          fonteFormato: 'descricao',
          padronizadoEm: PADRONIZADO_EM,
        },
      });
      return p.id;
    };
    idA = await criar(1);
    idB = await criar(2);
    esquecerStatusDosAtributos();
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { externalId: { startsWith: PREFIXO } } });
    esquecerStatusDosAtributos();
  });

  it('sem escrita nenhuma, a segunda leitura vem da memória', async () => {
    const um = await statusDosAtributos();
    const dois = await statusDosAtributos();
    // Mesma referência: não recontou. É o que paga o carimbo.
    expect(dois).toBe(um);
  });

  it('escrita de OUTRO processo aparece na leitura seguinte, sem esperar o minuto', async () => {
    const antes = await statusDosAtributos();
    expect(antes.padronizacao.formato.naoIdentificado).toBeGreaterThanOrEqual(2);

    // Este `update` é o padronizador rodando por `docker exec`: escreve no
    // banco e NÃO chama `esquecerStatusDosAtributos()` aqui — porque, na vida
    // real, ele chama no processo dele, que não é este.
    await prisma.productAttribute.update({
      where: { productId: idA },
      data: {
        formatoLente: 'BORBOLETA',
        fonteFormato: 'erp',
        padronizadoEm: new Date(PADRONIZADO_EM.getTime() + 1_000),
      },
    });

    const depois = await statusDosAtributos();
    expect(depois.padronizacao.formato.naoIdentificado).toBe(
      antes.padronizacao.formato.naoIdentificado - 1,
    );
    expect(depois.padronizacao.formato.classificado).toBe(antes.padronizacao.formato.classificado + 1);
  });

  it('peça APAGADA também derruba a memória — data nenhuma se move quando some uma linha', async () => {
    const antes = await statusDosAtributos();

    // B some por cascata. O máximo de `padronizadoEm` continua o mesmo (A ficou
    // com uma data mais nova); só o total de linhas muda. Sem a contagem no
    // carimbo, esta leitura viria da memória com a peça apagada ainda contada.
    await prisma.product.delete({ where: { id: idB } });

    const depois = await statusDosAtributos();
    expect(depois.padronizacao.formato.naoIdentificado).toBe(
      antes.padronizacao.formato.naoIdentificado - 1,
    );
  });
});
