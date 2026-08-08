import { describe, it, expect } from 'vitest';
import {
  TETO_DE_CARDS,
  TETO_DE_LINHAS,
  paginar,
  recortePedido,
  type PaginaDaResposta,
} from '@planning';
import { demoHandle } from '../api/demo';
import {
  CARDS_POR_CLIQUE,
  LINHAS_POR_CLIQUE,
  juntarPaginas,
  proximaPagina,
  restantes,
} from './paginacao';

/**
 * O "Ver mais" das duas telas paginadas.
 *
 * O defeito que estes testes matam: o botão crescia o `pageSize` e nunca
 * mandava `page`. Como a rota prende o `pageSize` num teto (1.000 cards /
 * 2.000 linhas), a partir do momento em que o pedido passava do teto a lista
 * parava de crescer, o rótulo continuava anunciando restantes que ele não
 * conseguia mais trazer, e tudo além do teto ficava inalcançável pela tela —
 * cada clique inútil ainda pagando uma execução completa do motor.
 *
 * A prova exige um conjunto MAIOR que o teto: abaixo dele o defeito não
 * aparece, e um teste que não o vê não prova nada.
 */

interface Resposta<T> {
  itens: T[];
  pagina: PaginaDaResposta;
}

/**
 * Roda o "Ver mais" até o botão sumir, do jeito que a tela roda: pede PÁGINA,
 * acumula o que chega, e para quando `proximaPagina` diz que acabou.
 *
 * O limite de idas não é paranoia — é o que transforma o defeito em falha
 * legível: um botão que nunca chega ao fim faria o laço rodar para sempre.
 */
function verMaisAteOFim<T>(
  pedir: (page: number) => Resposta<T>,
  chaveDe: (item: T) => string,
  limiteDeIdas = 200,
) {
  const paginas: T[][] = [];
  const rotulos: number[] = [];
  let page: number | undefined = 1;
  let idas = 0;
  while (page !== undefined) {
    if (++idas > limiteDeIdas) throw new Error(`"Ver mais" não chegou ao fim em ${idas} idas`);
    const r = pedir(page);
    paginas.push(r.itens);
    rotulos.push(restantes(r.pagina, juntarPaginas(paginas, chaveDe).length));
    page = proximaPagina(r.pagina);
  }
  return { itens: juntarPaginas(paginas, chaveDe), idas, rotulos };
}

describe('paginação: o tamanho de página das telas cabe no teto da rota', () => {
  it('o que a tela pede por clique é fixo e menor que o teto que a rota entrega', () => {
    expect(CARDS_POR_CLIQUE).toBeLessThanOrEqual(TETO_DE_CARDS);
    expect(LINHAS_POR_CLIQUE).toBeLessThanOrEqual(TETO_DE_LINHAS);
  });
});

describe('paginação: proximaPagina', () => {
  it('sem resposta ainda, não há próxima', () => {
    expect(proximaPagina(undefined)).toBeUndefined();
  });

  it('há próxima enquanto o entregue não cobrir o total', () => {
    expect(proximaPagina({ page: 1, pageSize: 60, total: 1260 })).toBe(2);
    expect(proximaPagina({ page: 20, pageSize: 60, total: 1260 })).toBe(21);
    // Página exata: 21 × 60 = 1.260. Nada sobra, e o botão some.
    expect(proximaPagina({ page: 21, pageSize: 60, total: 1260 })).toBeUndefined();
    // Uma linha a mais do outro lado do corte ainda pede a página 22.
    expect(proximaPagina({ page: 21, pageSize: 60, total: 1261 })).toBe(22);
  });

  it('a última página incompleta encerra', () => {
    expect(proximaPagina({ page: 3, pageSize: 60, total: 121 })).toBeUndefined();
  });
});

describe('paginação: juntarPaginas', () => {
  it('preserva a ordem e não repete item que veio em duas páginas', () => {
    // O quadro encolhe entre execuções do motor (um card decidido some), e os
    // seguintes escorregam para trás: o mesmo id volta na página seguinte.
    const juntos = juntarPaginas(
      [
        [{ id: 'a' }, { id: 'b' }],
        [{ id: 'b' }, { id: 'c' }],
      ],
      (x) => x.id,
    );
    expect(juntos.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('paginação: o "Ver mais" do quadro alcança o último card', () => {
  /**
   * Sobre um conjunto SINTÉTICO maior que `TETO_DE_CARDS`, cortado pelo mesmo
   * par `recortePedido` + `paginar` que a rota usa — igual ao bloco das
   * sugestões, logo abaixo.
   *
   * A primeira versão deste teste media o quadro da demonstração e exigia que
   * ele passasse do teto. Isso o amarrava a `demo-real-data.json`, que é
   * gitignored: na máquina de quem desenvolve o quadro tinha 1.250 cards e o
   * teste provava algo; na CI, que nunca tem o arquivo, o catálogo fictício dá
   * poucas centenas e o teste quebrava — ou, pior, passaria a não provar nada
   * se alguém o relaxasse para caber. O defeito que ele guarda (o `pageSize`
   * crescente que trava no teto) não tem nada a ver com o catálogo.
   */
  const cards = Array.from({ length: 4_000 }, (_, i) => ({ id: `card-${i}` }));
  const rota = (query: Record<string, string>) => {
    const { page, pageSize } = recortePedido(query, CARDS_POR_CLIQUE, TETO_DE_CARDS);
    return paginar(cards, page, pageSize);
  };

  it('clicando até o fim, chega ao ÚLTIMO card mesmo com o quadro maior que o teto', () => {
    const { itens, idas, rotulos } = verMaisAteOFim(
      (page) => rota({ page: String(page), pageSize: String(CARDS_POR_CLIQUE) }),
      (c) => c.id,
      200,
    );

    expect(itens.length).toBe(cards.length);
    expect(new Set(itens.map((c) => c.id)).size).toBe(cards.length); // nenhum duas vezes
    expect(idas).toBe(Math.ceil(cards.length / CARDS_POR_CLIQUE));
    expect(itens[itens.length - 1].id).toBe(cards[cards.length - 1].id);

    // E o último card está FORA do que o teto entrega numa resposta só — era
    // exatamente ele que ficava inalcançável.
    expect(rota({ page: '1', pageSize: String(TETO_DE_CARDS) }).itens.map((c) => c.id))
      .not.toContain(cards[cards.length - 1].id);

    // O rótulo nunca prometeu o que não veio: o último clique fecha em zero, e
    // cada anúncio de "restantes" foi cumprido pela ida seguinte.
    expect(rotulos[rotulos.length - 1]).toBe(0);
    expect(rotulos.filter((r) => r === 0).length).toBe(1);
  });

  it('o `pageSize` crescente — o defeito — não alcança o card 1.001', () => {
    let visiveis = CARDS_POR_CLIQUE;
    for (let clique = 0; clique < 30; clique++) visiveis += CARDS_POR_CLIQUE;
    const r = rota({ pageSize: String(visiveis) });
    expect(visiveis).toBeGreaterThan(TETO_DE_CARDS);
    expect(r.itens.length).toBe(TETO_DE_CARDS);
    expect(r.itens.map((x) => x.id)).not.toContain(cards[TETO_DE_CARDS].id);
  });
});

describe('paginação: o "Ver mais" das sugestões alcança a última linha', () => {
  /**
   * Sobre um conjunto sintético maior que `TETO_DE_LINHAS`, cortado pelo MESMO
   * par `recortePedido` + `paginar` que a rota usa. A demo tem 440 linhas — o
   * defeito só se enxerga acima do teto, e nenhum dataset disponível aqui passa
   * de 2.000.
   */
  const linhas = Array.from({ length: 13_000 }, (_, i) => ({ id: `sku-${i}` }));
  const rota = (query: Record<string, string>) => {
    const { page, pageSize } = recortePedido(query, LINHAS_POR_CLIQUE, TETO_DE_LINHAS);
    return paginar(linhas, page, pageSize);
  };

  it('a rota nunca entrega mais que o teto, por mais que se peça', () => {
    expect(rota({ pageSize: '999999' }).pagina.pageSize).toBe(TETO_DE_LINHAS);
    expect(rota({ pageSize: '999999' }).itens.length).toBe(TETO_DE_LINHAS);
  });

  it('clicando até o fim, chega à ÚLTIMA linha e nenhuma aparece duas vezes', () => {
    const { itens, idas } = verMaisAteOFim(
      (page) => rota({ page: String(page), pageSize: String(LINHAS_POR_CLIQUE) }),
      (r) => r.id,
      200,
    );
    expect(itens.length).toBe(linhas.length);
    expect(new Set(itens.map((r) => r.id)).size).toBe(linhas.length);
    expect(itens[itens.length - 1].id).toBe(linhas[linhas.length - 1].id);
    expect(idas).toBe(Math.ceil(linhas.length / LINHAS_POR_CLIQUE));
  });

  it('o `pageSize` crescente — o defeito — não alcança a linha 2.001', () => {
    // A prova pelo avesso, para o teste acima não passar por acaso: é assim que
    // a tela pedia, e é este pedido que deixa as linhas 2.001+ inacessíveis.
    let visiveis = LINHAS_POR_CLIQUE;
    for (let clique = 0; clique < 30; clique++) visiveis += LINHAS_POR_CLIQUE;
    const r = rota({ pageSize: String(visiveis) });
    expect(visiveis).toBeGreaterThan(TETO_DE_LINHAS);
    expect(r.itens.length).toBe(TETO_DE_LINHAS);
    expect(r.itens.map((x) => x.id)).not.toContain(linhas[2000].id);
  });
});

describe('paginação: restantes', () => {
  it('conta o que falta da vista e nunca fica negativo', () => {
    expect(restantes({ page: 1, pageSize: 60, total: 1260 }, 60)).toBe(1200);
    // O quadro encolheu entre as idas: o acumulado passou do total mais novo.
    expect(restantes({ page: 3, pageSize: 60, total: 100 }, 180)).toBe(0);
  });
});
