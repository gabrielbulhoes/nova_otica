import { describe, expect, it } from 'vitest';

/**
 * O estoque da rede é lido em lotes de produtos porque `cds/estoquegrade` não
 * tem filtro de data e uma chamada única vem truncada. O que este arquivo
 * cobre é o que acontece quando o conector NÃO colabora — que é o caso que
 * derrubou o estoque em produção em 04/08/2026.
 */

process.env.DATABASE_URL ??= 'postgresql://ci:ci@localhost:5432/ci?schema=public';
process.env.SELLBIE_STOCK_CHUNK = '250';

const { lerEstoqueEmLotes } = await import('../src/sync/syncService.js');

type Grade = { CODIGO: string; GRADE?: string; ESTOQUE?: Record<string, { ID_FILIAL: string; ESTOQUE: string }> };

/** Uma linha da grade com 2 unidades na filial 1 e 3 na filial 2. */
const linha = (codigo: string, grade = '1'): Grade => ({
  CODIGO: codigo,
  GRADE: grade,
  ESTOQUE: {
    'LOJA UM': { ID_FILIAL: '1', ESTOQUE: '2' },
    'LOJA DOIS': { ID_FILIAL: '2', ESTOQUE: '3' },
  },
});

/**
 * Conector falso. `maxLote` é quantos códigos ele aceita numa lista `cod_prod`
 * antes de recusar — o número que a documentação não informa e que o código
 * precisa descobrir sozinho.
 */
function conector(codigos: string[], opts: { maxLote?: number; ignoraFiltro?: boolean } = {}) {
  const chamadas: number[] = [];
  const universo = codigos.flatMap((c) => [linha(c)]);
  const client = {
    async getEstoqueGrade(query?: { cod_prod?: string }) {
      const pedidos = (query?.cod_prod ?? '').split(',').filter(Boolean);
      chamadas.push(pedidos.length);
      if (opts.maxLote !== undefined && pedidos.length > opts.maxLote) {
        throw new Error('Request failed with status code 400');
      }
      if (pedidos.length === 0 || opts.ignoraFiltro) return universo;
      return universo.filter((g) => pedidos.includes(g.CODIGO));
    },
  };
  // O tipo real do cliente tem 12 métodos; o acumulador só usa este.
  return { client: client as never, chamadas };
}

const codigos = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

describe('lerEstoqueEmLotes', () => {
  it('lê a rede inteira quando o conector aceita o lote configurado', async () => {
    const { client, chamadas } = conector(codigos(600));
    const acc = await lerEstoqueEmLotes(client, codigos(600), new Map());

    expect(chamadas).toEqual([250, 250, 100]);
    expect(acc.linhas).toBe(600);
    // Cada produto tem posição em 2 filiais.
    expect(acc.posicoes.size).toBe(1200);
    expect(acc.posicoes.get('1|p0')).toBe(2);
    expect(acc.posicoes.get('2|p0')).toBe(3);
  });

  it('descobre sozinho o tamanho de lote que o conector aceita', async () => {
    // O conector recusa listas com mais de 60 códigos, e não diz isso em
    // lugar nenhum. Antes desta lógica, o lote de 250 estourava na primeira
    // chamada e o estoque inteiro ficava congelado no valor anterior.
    const { client, chamadas } = conector(codigos(500), { maxLote: 60 });
    const acc = await lerEstoqueEmLotes(client, codigos(500), new Map());

    expect(acc.linhas).toBe(500);
    expect(acc.posicoes.size).toBe(1000);
    // Houve recusa, e a leitura convergiu partindo o lote ao meio.
    expect(chamadas.some((n) => n > 60)).toBe(true);
    expect(Math.max(...chamadas.filter((n) => n <= 60))).toBeLessThanOrEqual(60);
  });

  it('detecta o filtro ignorado e não soma duas vezes', async () => {
    // Cada lote devolve o universo inteiro. Sem tratamento, os 12 lotes
    // somariam o saldo de cada produto 12 vezes — estoque inflado, que é pior
    // que estoque a menos porque nada no painel denuncia.
    const { client, chamadas } = conector(codigos(3000), { ignoraFiltro: true });
    const acc = await lerEstoqueEmLotes(client, codigos(3000), new Map());

    expect(acc.posicoes.get('1|p0')).toBe(2);
    expect(acc.posicoes.size).toBe(6000);
    // Detectou no primeiro lote e caiu na chamada única, em vez de repetir
    // a mesma resposta gigante mais onze vezes.
    expect(chamadas).toEqual([250, 0]);
  });

  it('ignora linha não pedida sem corromper o saldo', async () => {
    // Ruído abaixo do limiar da guarda: o conector devolve o lote pedido mais
    // um punhado de linhas de outros produtos. A guarda não dispara, e a
    // correção não pode depender dela — a linha excedente é descartada.
    const universo = codigos(300);
    const client = {
      async getEstoqueGrade(query?: { cod_prod?: string }) {
        const pedidos = (query?.cod_prod ?? '').split(',').filter(Boolean);
        if (pedidos.length === 0) return universo.map((c) => linha(c));
        // O lote pedido + 5 linhas repetidas de p0, que não foi pedido no
        // segundo lote.
        return [...pedidos.map((c) => linha(c)), ...Array.from({ length: 5 }, () => linha('p0'))];
      },
    } as never;

    const acc = await lerEstoqueEmLotes(client, universo, new Map());
    // p0 aparece uma vez legitimamente (lote 1) e 5 vezes de carona em cada
    // lote. Só a legítima conta.
    expect(acc.posicoes.get('1|p0')).toBe(2);
    expect(acc.posicoes.size).toBe(600);
  });

  it('soma as variantes (GRADE) do mesmo produto na mesma loja', async () => {
    const client = {
      async getEstoqueGrade() {
        return [linha('p1', '1'), linha('p1', '2')];
      },
    } as never;
    const acc = await lerEstoqueEmLotes(client, [], new Map());
    expect(acc.posicoes.get('1|p1')).toBe(4);
    expect(acc.posicoes.get('2|p1')).toBe(6);
  });

  it('separa os produtos que a grade conhece e o catálogo não', async () => {
    const { client } = conector(['a', 'b', 'c']);
    const conhecidos = new Map([['a', 'id-a']]);
    const acc = await lerEstoqueEmLotes(client, ['a', 'b', 'c'], conhecidos);
    expect([...acc.orfaos.keys()].sort()).toEqual(['b', 'c']);
  });

  it('cai para leitura por filial quando cod_prod é recusado até isolado', async () => {
    // O caso REAL de 04/08/2026: HTTP 500 em `cod_prod` de 250 códigos até 2.
    // Recusa de um código isolado prova que o problema é o parâmetro, não o
    // tamanho — insistir seriam 60 mil chamadas para colher 60 mil erros.
    const universo = codigos(40);
    const chamadas: string[] = [];
    const client = {
      async getEstoqueGrade(query?: { cod_prod?: string; cod_loja?: string }) {
        if (query?.cod_prod) {
          chamadas.push(`prod:${query.cod_prod.split(',').length}`);
          throw new Error('Request failed with status code 500');
        }
        chamadas.push(`loja:${query?.cod_loja ?? '-'}`);
        // Por filial, cada linha traz só o estoque daquela loja.
        return universo.map((c) => ({
          CODIGO: c,
          GRADE: '1',
          ESTOQUE: { X: { ID_FILIAL: String(query?.cod_loja), ESTOQUE: '7' } },
        }));
      },
    } as never;

    const acc = await lerEstoqueEmLotes(client, universo, new Map(), ['1', '2', '3']);

    expect(chamadas.filter((c) => c.startsWith('loja:'))).toEqual(['loja:1', 'loja:2', 'loja:3']);
    // Cada produto tem posição nas três filiais — a chave de deduplicação
    // precisa incluir a loja, senão só a primeira sobreviveria.
    expect(acc.posicoes.size).toBe(120);
    expect(acc.posicoes.get('1|p0')).toBe(7);
    expect(acc.posicoes.get('3|p0')).toBe(7);
  });

  it('só sobra a chamada única quando os dois filtros são recusados', async () => {
    const universo = codigos(10);
    const client = {
      async getEstoqueGrade(query?: { cod_prod?: string; cod_loja?: string }) {
        if (query?.cod_prod || query?.cod_loja) throw new Error('Request failed with status code 500');
        return universo.map((c) => linha(c));
      },
    } as never;

    const acc = await lerEstoqueEmLotes(client, universo, new Map(), ['1', '2']);
    expect(acc.posicoes.size).toBe(20);
    expect(acc.posicoes.get('1|p0')).toBe(2);
  });
});
