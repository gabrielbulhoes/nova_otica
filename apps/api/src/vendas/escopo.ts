import { Prisma } from '@prisma/client';

/**
 * O RECORTE DE "ISTO É UMA VENDA" — um lugar só, como o escopo de lojas.
 *
 * Existe pelo motivo que `store.scope.ts` documenta uma porta ao lado: a
 * condição estava escrita à mão em seis consultas e, quando ganhou um segundo
 * campo, seis lugares precisaram lembrar disso. Aqui são mais de vinte
 * consultas — giro, cobertura, curva ABC, faturamento, ranking de vendedor,
 * ficha da peça, sugestão de compra — e uma que esqueça o filtro não quebra:
 * devolve um número um pouco maior, que é o defeito mais caro que existe.
 *
 * `devolvido: false` e não `NOT devolvido: true` de propósito: a coluna é
 * `NOT NULL DEFAULT false`, então os dois dão o mesmo conjunto, mas só a forma
 * positiva usa o índice `(devolvido, productId)`.
 */
export const itemVendidoWhere: Prisma.SaleItemWhereInput = { devolvido: false };

/**
 * A MESMA condição para SQL cru, aplicada a um alias de `"SaleItem"`.
 * Uso: `JOIN "SaleItem" si ON … AND ${itemVendidoSql('si')}`.
 *
 * O alias é interpolado como identificador cru, então só chame com literais do
 * próprio código — nunca com entrada de usuário.
 */
export function itemVendidoSql(alias: string): Prisma.Sql {
  const a = Prisma.raw(`"${alias}"`);
  return Prisma.sql`${a}."devolvido" = false`;
}

/**
 * O recorte INVERSO — os itens que voltaram.
 *
 * "Nunca contabiliza a venda devolvida, a não ser para esse dado específico:
 *  relatório de itens devolvidos." É este, e é o único lugar da plataforma que
 * pode usá-lo.
 */
export const itemDevolvidoWhere: Prisma.SaleItemWhereInput = { devolvido: true };

/**
 * A VENDA INTEIRA que vale — o par de `itemVendidoWhere`, um nível acima.
 *
 * O faturamento COM recorte de produto soma os itens; SEM recorte, soma
 * `Sale.total`. As duas leituras aparecem na mesma tela do BI, e sem este
 * filtro o cabeçalho contaria uma venda estornada que a tabela abaixo dele,
 * essa sim filtrada por item, não conta. Dois números na mesma tela sobre o
 * mesmo período é o defeito que esta base já pagou três vezes.
 *
 * NÃO se aplica à LISTAGEM de vendas: uma venda cancelada aconteceu e o
 * operador precisa vê-la. O que ela não pode é entrar em soma.
 */
export const vendaValidaWhere: Prisma.SaleWhereInput = { cancelada: false };

/**
 * Quantas linhas o filtro está de fato tirando da conta — para o `/health`.
 *
 * Existe pelo mesmo motivo que `statusDosAtributos`: a correção da contagem
 * depende de um dicionário escrito sem amostra real, e "não mudou nada" é
 * indistinguível de "não pegou". Estes dois números respondem isso em um
 * `curl`, no dia seguinte à primeira sincronização.
 *
 * As duas contagens usam os índices de boolean e contam o lado RARO
 * (devolvido/cancelada = true), que é o que as torna baratas o bastante para
 * um endereço que o deploy consulta em laço. Nada aqui varre a tabela inteira.
 *
 * A memória é curta e simples — sem o carimbo de `catalogo/status.ts` — porque
 * aqui não há comando externo que mude o número de repente: quem muda é a
 * sincronização, que roda uma vez por dia e dentro deste mesmo processo.
 */
const MEMORIA_MS = 300_000;
let memoria: { em: number; valor: { devolvidos: number; canceladas: number } } | null = null;

export function esquecerContagemDeDevolucoes(): void {
  memoria = null;
}

export async function contagemDeDevolucoes(): Promise<{ devolvidos: number; canceladas: number }> {
  const agora = Date.now();
  if (memoria && agora - memoria.em < MEMORIA_MS) return memoria.valor;
  const { prisma } = await import('../lib/prisma.js');
  const [devolvidos, canceladas] = await Promise.all([
    prisma.saleItem.count({ where: itemDevolvidoWhere }),
    prisma.sale.count({ where: { cancelada: true } }),
  ]);
  const valor = { devolvidos, canceladas };
  memoria = { em: agora, valor };
  return valor;
}
