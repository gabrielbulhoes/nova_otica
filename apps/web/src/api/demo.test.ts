import { describe, it, expect } from 'vitest';
import { TETO_DE_CARDS, TETO_DE_LINHAS, analysisBrand, normBrandKey } from '@planning';
import { proximaPagina } from '../lib/paginacao';
import { demoHandle, demoIdadeNaLoja } from './demo';

/**
 * Handlers da demo exercitados no dataset FICTÍCIO (o JSON real é gitignorado
 * e nunca existe nos testes) — mas as rotas são as mesmas nos dois sabores.
 */
const get = (url: string, params?: Record<string, string | string[] | undefined>) =>
  demoHandle({ method: 'GET', url, params }) as Record<string, any>;

/**
 * O conjunto inteiro de uma rota paginada, buscado PÁGINA A PÁGINA.
 *
 * Existe porque `?pageSize=100000` não traz o conjunto inteiro: a rota — e
 * agora a demo, que é o espelho dela — prende o tamanho num teto. Quem pede um
 * número absurdo e trata o que volta como "tudo" escreve um teste que passa
 * verde justamente quando o teto muda de lugar, que é o único momento em que
 * ele precisava avisar.
 */
const todasAsPaginas = (
  url: string,
  campo: string,
  params: Record<string, string | string[] | undefined> = {},
  tamanho = 500,
) => {
  const itens: any[] = [];
  let page: number | undefined = 1;
  let idas = 0;
  let ultima: Record<string, any> = {};
  while (page !== undefined) {
    if (++idas > 500) throw new Error(`${url} não chegou ao fim em ${idas} páginas`);
    ultima = get(url, { ...params, page: String(page), pageSize: String(tamanho) });
    itens.push(...(ultima[campo] as any[]));
    page = proximaPagina(ultima.pagina);
  }
  return { itens, resposta: ultima };
};

describe('demo: /products/categories', () => {
  it('deriva as categorias do catálogo carregado (nada de lista fixa)', () => {
    const cats = get('/products/categories') as string[];
    const products = get('/products').rows as { category: string }[];
    expect(cats.length).toBeGreaterThan(0);
    expect(new Set(cats)).toEqual(new Set(products.map((p) => p.category)));
  });

  it('toda categoria oferecida no filtro encontra ao menos um item de estoque', () => {
    for (const c of get('/products/categories') as string[]) {
      const res = get('/stock', { category: c });
      expect(res.rows.length, `categoria "${c}" sem itens`).toBeGreaterThan(0);
    }
  });
});

describe('demo: /stock multi-seleção', () => {
  const stores = (get('/stores').rows as { id: string }[]).map((s) => s.id);

  // `rows` é a PÁGINA (200 itens), não o resultado inteiro: com o catálogo real
  // a primeira página pode conter uma loja só. O contrato verificável é que
  // nenhuma linha vem de fora do filtro e que somar lojas aumenta o total.
  const ids = (r: any) => new Set(r.rows.map((x: any) => x.storeId));
  const dentroDe = (r: any, permitidas: string[]) =>
    [...ids(r)].every((s) => permitidas.includes(s as string));

  it('uma loja filtra só ela; duas lojas (array = parâmetro repetido) somam as duas', () => {
    const one = get('/stock', { storeId: stores[0] });
    expect(ids(one)).toEqual(new Set([stores[0]]));

    const two = get('/stock', { storeId: [stores[0], stores[1]] });
    expect(dentroDe(two, [stores[0], stores[1]])).toBe(true);
    expect(two.total).toBeGreaterThan(one.total);
  });

  it('atalho "a,b" num valor único também funciona', () => {
    const two = get('/stock', { storeId: `${stores[0]},${stores[1]}` });
    const arr = get('/stock', { storeId: [stores[0], stores[1]] });
    expect(dentroDe(two, [stores[0], stores[1]])).toBe(true);
    expect(two.total).toBe(arr.total); // as duas formas dão o mesmo recorte
  });

  it('multi-categoria (array) combina com multi-loja', () => {
    const cats = get('/products/categories') as string[];
    const res = get('/stock', { storeId: stores[0], category: [cats[0], cats[1]] });
    for (const r of res.rows as any[]) {
      expect(r.storeId).toBe(stores[0]);
      expect([cats[0], cats[1]]).toContain(r.category);
    }
  });
});

describe('demo: /dashboard/coverage', () => {
  it('uma linha por loja, com meses de cobertura e nível', () => {
    const res = get('/dashboard/coverage');
    const stores = get('/stores').rows as unknown[];
    expect(res.rows.length).toBe(stores.length);
    for (const r of res.rows as any[]) {
      expect(typeof r.storeName).toBe('string');
      expect(r.stockUnits).toBeGreaterThanOrEqual(0);
      expect(['CRITICAL', 'HEALTHY', 'HIGH', 'EXCESS']).toContain(r.level);
      if (r.monthlyUnits > 0) {
        expect(r.coverageMonths).toBeCloseTo(r.stockUnits / r.monthlyUnits, 1);
      } else {
        expect(r.coverageMonths).toBeNull();
      }
    }
  });

  it('ordena da menor cobertura para a maior', () => {
    const rows = get('/dashboard/coverage').rows as { coverageMonths: number | null }[];
    const months = rows.map((r) => r.coverageMonths ?? Infinity);
    expect(months).toEqual([...months].sort((a, b) => a - b));
  });
});

describe('demo: relatórios da Onda 2', () => {
  it('/reports/abc por marca agrega SKUs da mesma marca', () => {
    const brand = get('/reports/abc', { dimension: 'brand' });
    const sku = get('/reports/abc');
    expect(brand.dimension).toBe('brand');
    expect(sku.dimension).toBe('product');
    expect(brand.rows.length).toBeLessThan(sku.rows.length);
    // Desde a decisão do Galbe, a visão por MARCA cobre só produto de moda
    // (óculos/armação/relógio) — lente e tratamento têm módulo próprio. Logo a
    // receita da visão por marca é um SUBCONJUNTO da receita por SKU.
    expect(brand.totalRevenue).toBeGreaterThan(0);
    expect(brand.totalRevenue).toBeLessThanOrEqual(sku.totalRevenue + 0.01);
    // % acumulado fecha em ~100 e as classes seguem a ordem A→B→C.
    const classes = brand.rows.map((r: any) => r.class).join('');
    expect(classes).toMatch(/^A+B*C*$/);
  });

  it('/reports/coverage traz linha GERAL da REDE, e as marcas nunca a ultrapassam', () => {
    const r = get('/reports/coverage');
    const somaEstoque = r.rows.reduce((a: number, x: any) => a + x.stockUnits, 0);
    expect(r.total.label).toBe('GERAL');
    // O GERAL vem da rede (mesma base do dashboard) e as linhas por marca vêm
    // do catálogo carregado: iguais quando não há amostragem, menores quando há
    // — e nesse caso a resposta declara em `sampled`.
    expect(somaEstoque).toBeLessThanOrEqual(r.total.stockUnits);
    if (r.sampled) expect(r.sampled.stockUnits).toBe(somaEstoque);
    else expect(r.total.stockUnits).toBe(somaEstoque);
    for (const row of r.rows) expect(['CRITICAL', 'HEALTHY', 'HIGH', 'EXCESS']).toContain(row.level);
  });

  it('/reports/sales-analysis responde todas as dimensões com unidades E receita', () => {
    for (const by of ['brand', 'category', 'product', 'store', 'seller']) {
      const r = get('/reports/sales-analysis', { by });
      expect(r.by).toBe(by);
      expect(r.rows.length, `dimensão ${by} vazia`).toBeGreaterThan(0);
      for (const row of r.rows.slice(0, 5)) {
        expect(row.units).toBeGreaterThanOrEqual(0);
        expect(row.revenue).toBeGreaterThanOrEqual(0);
        expect(typeof row.label).toBe('string');
      }
      // Ordenada por unidades (o foco do feedback 10).
      const units = r.rows.map((x: any) => x.units);
      expect(units).toEqual([...units].sort((a: number, b: number) => b - a));
    }
  });

  it('análise por marca bate com o ABC por marca (uma regra só de marca)', () => {
    // As duas telas por marca precisam somar a MESMA receita: se divergirem, o
    // gestor vê dois números para a mesma pergunta.
    const abcMarca = get('/reports/abc', { dimension: 'brand' });
    const porMarca = get('/reports/sales-analysis', { by: 'brand' });
    const somaMarcas = porMarca.rows.reduce((a: number, x: any) => a + x.revenue, 0);
    expect(somaMarcas).toBeCloseTo(abcMarca.totalRevenue, 0);
  });

  it('análise por categoria cobre a base inteira (lente inclusa) — igual ao ABC por SKU', () => {
    const abc = get('/reports/abc');
    const porCategoria = get('/reports/sales-analysis', { by: 'category' });
    const soma = porCategoria.rows.reduce((a: number, x: any) => a + x.revenue, 0);
    expect(soma).toBeCloseTo(abc.totalRevenue, 0);
  });
});

describe('demo: Onda 3 (mix por bandeira + Modo Feira)', () => {
  it('/reports/brand-mix agrega marcas por bandeira com total coerente', () => {
    const r = get('/reports/brand-mix');
    expect(Array.isArray(r.banners)).toBe(true);
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows.slice(0, 5)) {
      const somaVend = r.banners.reduce((a: number, b: string) => a + (row.byBanner[b]?.unitsSold ?? 0), 0);
      expect(row.total.unitsSold).toBe(somaVend);
      // Candidata a remanejo: estoque parado numa bandeira e venda em outra.
      for (const b of row.moveFrom) {
        expect(row.byBanner[b].stockUnits).toBeGreaterThan(0);
        expect(row.byBanner[b].unitsSold).toBe(0);
        expect(row.sellsIn.length).toBeGreaterThan(0);
      }
    }
  });

  it('/planning/fair-split rateia por marca somando exatamente a quantidade', () => {
    const marca = (get('/reports/brand-mix').rows as any[]).find((r) => r.total.unitsSold > 0)?.brand;
    const r = get('/planning/fair-split', { brand: marca, qty: '120', days: '180' });
    if (r.totalSold > 0) {
      const soma = r.rows.reduce((a: number, x: any) => a + x.suggestedQty, 0);
      expect(soma).toBe(120);
      // Loja sem venda da marca não recebe.
      for (const row of r.rows) if (row.unitsSold === 0) expect(row.suggestedQty).toBe(0);
    }
  });

  it('/planning/purchase-orders traz cada item já rateado por loja (G7)', () => {
    // Pedido literal do cliente: "na aba de sugestão de compras já precisa
    // indicar a sugestão de distribuição daqueles itens para cada loja".
    const orders = get('/planning/purchase-orders', { group: 'todos' }).orders as any[];
    const itens = orders.flatMap((o) => o.items);
    expect(itens.length).toBeGreaterThan(0);
    for (const it of itens) {
      expect(it.distribution, `item sem rateio (${it.description})`).toBeDefined();
      expect(['necessidade', 'participacao']).toContain(it.distribution.basis);
      // O invariante: tudo o que se compra tem endereço de loja ou está
      // declarado em `unassigned`. Nenhuma unidade evapora no arredondamento.
      const soma = it.distribution.rows.reduce((a: number, r: any) => a + r.suggestedQty, 0);
      expect(soma + it.distribution.unassigned).toBe(it.quantity);
    }
  });

  it('com filtro de loja a compra vem SEM rateio (paridade com a API)', () => {
    // Na visão de uma loja, `planningPlans` escopa venda e estoque a ela: a
    // quantidade JÁ é daquela loja e não há o que repartir. Ratear isso pela
    // rede endereçava mercadoria a lojas cuja demanda nem entrou na conta.
    const loja = (get('/stores').rows as { id: string }[])[0].id;
    const orders = get('/planning/purchase-orders', { group: 'todos', storeId: loja }).orders as any[];
    const itens = orders.flatMap((o) => o.items);
    expect(itens.length).toBeGreaterThan(0);
    expect(itens.every((it) => it.distribution === undefined)).toBe(true);
  });

  it('o rateio da compra não manda peça para loja que já está no alvo', () => {
    // É a diferença entre o que o cliente pediu ("melhor chance de venda E
    // otimização do estoque") e o rateio por participação, que mandava mais
    // para quem vende mais mesmo já abarrotada.
    const orders = get('/planning/purchase-orders', { group: 'todos' }).orders as any[];
    for (const it of orders.flatMap((o) => o.items)) {
      if (it.distribution.basis !== 'necessidade') continue;
      for (const r of it.distribution.rows) {
        expect(r.needUnits, `${r.storeName} recebeu sem precisar`).toBeGreaterThan(0);
      }
    }
  });

  it('/planning/fair-split valida os parâmetros (paridade com a API)', () => {
    expect(get('/planning/fair-split', { qty: '0', brand: 'X' }).__status).toBe(400);
    // acima do teto (100000) → erro, igual à rota Express
    expect(get('/planning/fair-split', { qty: '1000000', brand: 'X' }).__status).toBe(400);
    // marca E grupo juntos → erro (exatamente um recorte)
    expect(get('/planning/fair-split', { qty: '10', brand: 'X', category: 'Y' }).__status).toBe(400);
    // nenhum recorte → erro
    expect(get('/planning/fair-split', { qty: '10' }).__status).toBe(400);
  });
});

describe('demo: Onda 4 (feedback Galbe — lentes fora do remanejamento)', () => {
  const isLensDesc = (d: string) => /^lente/i.test(d.trim());

  it('remanejamento nunca transfere lentes, nem no consolidado (group=todos)', () => {
    for (const group of [undefined, 'principal', 'todos']) {
      const r = get('/planning/rebalance', group ? { group } : undefined);
      for (const row of r.rows as { description: string }[]) {
        expect(isLensDesc(row.description), `lente sugerida p/ transferência (${row.description})`).toBe(false);
      }
    }
  });

  it('sugestões de compra usam "principal" por padrão (sem lentes)', () => {
    // Página a página DE PROPÓSITO. A afirmação aqui é sobre o RECORTE inteiro:
    // olhando só a primeira página, o teste provaria que não há lente nas 100
    // primeiras e uma lente na linha 101 passaria batido. Pedir `pageSize`
    // absurdo também não serve — a rota tem teto, e o que voltasse seria só
    // outra página, com cara de conjunto inteiro.
    const { itens, resposta } = todasAsPaginas('/planning/purchase-suggestions', 'rows');
    const rows = itens as { description: string }[];
    expect(rows.length).toBe(resposta.pagina.total);
    for (const row of rows) {
      expect(isLensDesc(row.description), `lente na compra padrão (${row.description})`).toBe(false);
    }
  });
});

describe('demo: governança da decisão', () => {
  const post = (url: string, body: Record<string, unknown>) =>
    demoHandle({ method: 'POST', url, body }) as Record<string, any>;

  it('card decidido sai do board e entra em summary.decididos', () => {
    const before = get('/planning/decisions');
    expect(before.cards.length).toBeGreaterThan(0);
    // Um REMANEJAMENTO de propósito, não `cards[0]`: decidir consome o card, e
    // pegar o primeiro do board tirava a liquidação do caminho dos testes que
    // vêm depois — a suíte passava ou não conforme a ordem dos arquivos.
    //
    // E PEDIDO ao servidor, não procurado na resposta: o quadro vem paginado e
    // ordenado por prioridade e impacto, então nada garante um remanejamento na
    // primeira página. O `?? cards[0]` de antes esconderia isso caindo de volta
    // no primeiro card, que é justamente o que este teste evita.
    const card = get('/planning/decisions', { tipo: 'REMANEJAMENTO' }).cards[0];
    expect(card.type).toBe('REMANEJAMENTO');

    post('/planning/decisions', {
      cardId: card.id,
      cardType: card.type,
      outcome: 'APPROVED',
      impact: card.impact,
    });

    const after = get('/planning/decisions');
    expect(after.cards.some((c: any) => c.id === card.id)).toBe(false);
    expect(after.summary.total).toBe(before.summary.total - 1);
    expect(after.summary.decididos).toBeGreaterThanOrEqual(1);
  });

  it('recusar sem justificativa é rejeitado (mesma regra da API)', () => {
    // O tipo vai PEDIDO na consulta: procurá-lo dentro da página devolveria
    // `undefined` no dia em que nenhum remanejamento couber nos primeiros 60.
    const card = get('/planning/decisions', { tipo: 'REMANEJAMENTO' }).cards[0];
    expect(() =>
      post('/planning/decisions', {
        cardId: card.id,
        cardType: card.type,
        outcome: 'REJECTED',
        impact: card.impact,
      }),
    ).toThrow(/justificativa/i);
  });
});

/**
 * A Central de Decisões devolvia o quadro inteiro — 18.541 cards, 16,5 MB — e
 * era a origem do 503 que o cliente fotografou. Estes testes prendem o contrato
 * da resposta paginada: a página encolhe, os NÚMEROS não.
 */
describe('demo: o quadro pagina, o resumo não', () => {
  it('a demo corta no MESMO teto da rota — pedir mais não traz mais', () => {
    // O espelho estava cego exatamente no eixo que a paginação introduziu: a
    // demo servia o quadro inteiro para um `?pageSize=100000` que contra a API
    // devolve no máximo o teto. Com a demo mentindo, todo teste que se apoiava
    // nesse número virava um verde sem lastro — e o "Ver mais" da
    // demonstração chegava a um fim que a tela de produção não alcança.
    //
    // O que se prende aqui é o TETO QUE A RESPOSTA ANUNCIA, não o tamanho do
    // quadro. A primeira versão exigia um quadro MAIOR que o teto para ver o
    // corte acontecer, e isso a amarrava a `demo-real-data.json` — gitignored,
    // ausente na CI, onde o catálogo fictício dá algumas dezenas de cards. O
    // caso "conjunto acima do teto" é provado sobre dados sintéticos em
    // `paginacao.test.ts`, que não depende de catálogo nenhum.
    const absurdo = get('/planning/decisions', { pageSize: '100000', group: 'todos' });
    expect(absurdo.pagina.pageSize).toBe(TETO_DE_CARDS);
    expect(absurdo.cards.length).toBeLessThanOrEqual(TETO_DE_CARDS);
    expect(absurdo.cards.length).toBe(Math.min(TETO_DE_CARDS, absurdo.pagina.total));

    const linhas = get('/planning/purchase-suggestions', { pageSize: '100000' });
    expect(linhas.pagina.pageSize).toBe(TETO_DE_LINHAS);
    expect(linhas.rows.length).toBe(Math.min(TETO_DE_LINHAS, linhas.pagina.total));
  });

  it('a página corta os cards e o resumo continua sendo o do quadro inteiro', () => {
    const inteiro = todasAsPaginas('/planning/decisions', 'cards').resposta;
    const pagina = get('/planning/decisions', { pageSize: '5' });

    expect(pagina.cards.length).toBe(5);
    expect(pagina.pagina).toEqual({ page: 1, pageSize: 5, total: inteiro.summary.total });

    expect(pagina.summary.total).toBe(inteiro.summary.total);
    expect(pagina.summary.byType).toEqual(inteiro.summary.byType);
    expect(pagina.summary.byPriority).toEqual(inteiro.summary.byPriority);
    expect(pagina.summary.criticos).toBe(inteiro.summary.criticos);
    expect(pagina.summary.novos).toBe(inteiro.summary.novos);
    expect(pagina.summary.atrasados).toBe(inteiro.summary.atrasados);
  });

  it('a lista de grifes do seletor sai do quadro inteiro, não da página', () => {
    const { itens, resposta } = todasAsPaginas('/planning/decisions', 'cards');
    const pagina = get('/planning/decisions', { pageSize: '3' });
    expect(pagina.grifes).toEqual(resposta.grifes);
    // E é maior que o que a página sozinha ofereceria — senão o teste passaria
    // por acaso, num quadro onde todos os cards fossem da mesma grife.
    const naPagina = new Set((pagina.cards as any[]).map((c) => c.brandLabel).filter(Boolean));
    expect(pagina.grifes.length).toBeGreaterThan(naPagina.size);
    // As grifes cobrem o quadro TODO, não só o que cabe numa resposta: um
    // seletor montado sobre a fatia do teto perderia justo as grifes do fim.
    const noQuadro = new Set((itens as any[]).map((c) => c.brandLabel).filter(Boolean));
    expect(new Set(pagina.grifes as string[])).toEqual(noQuadro);
  });

  it('a página 2 continua de onde a 1 parou, sem repetir card', () => {
    const p1 = get('/planning/decisions', { page: '1', pageSize: '10' });
    const p2 = get('/planning/decisions', { page: '2', pageSize: '10' });
    const ids = new Set((p1.cards as any[]).map((c) => c.id));
    expect((p2.cards as any[]).every((c) => !ids.has(c.id))).toBe(true);
    expect(p2.pagina.page).toBe(2);
  });

  it('página a página, o quadro inteiro é alcançável e nenhum card se repete', () => {
    // O contrato que o "Ver mais" da tela depende: acima do teto, só chega ao
    // último card quem pede PÁGINA. Com `pageSize` crescente a lista trava em
    // `TETO_DE_CARDS` e o resto fica inalcançável.
    // Página pequena de propósito: o que este teste prova é que percorrer
    // página a página alcança o conjunto inteiro sem repetir nem pular, e isso
    // vale para qualquer tamanho de quadro. O caso "acima do teto" é provado
    // sobre conjunto sintético em `paginacao.test.ts`, que não depende de
    // catálogo nenhum.
    // Tamanho de página DERIVADO do total: fixo, ele dependia de o quadro ter
    // um tamanho específico — que depende do catálogo carregado. Derivado, o
    // teste prova a mesma coisa com 20 cards ou com 1.250.
    const total: number = get('/planning/decisions', { pageSize: '1', group: 'todos' }).pagina.total;
    expect(total).toBeGreaterThan(3);
    const tamanho = Math.max(1, Math.floor(total / 3));
    const { itens, resposta } = todasAsPaginas(
      '/planning/decisions', 'cards', { group: 'todos', pageSize: String(tamanho) }, 400,
    );
    expect(itens.length).toBe(resposta.pagina.total);
    expect(Math.ceil(total / tamanho)).toBeGreaterThan(1);
    expect(new Set(itens.map((c) => c.id)).size).toBe(itens.length);
  });

  it('os filtros de vista recortam os cards e deixam o resumo em paz', () => {
    const inteiro = todasAsPaginas('/planning/decisions', 'cards').resposta;
    const { itens, resposta: so } = todasAsPaginas('/planning/decisions', 'cards', {
      tipo: 'LIQUIDACAO',
    });
    expect(itens.length).toBeGreaterThan(0);
    expect((itens as any[]).every((c) => c.type === 'LIQUIDACAO')).toBe(true);
    // A vista tem o tamanho do tipo; o resumo continua contando o quadro todo.
    expect(so.pagina.total).toBe(inteiro.summary.byType.liquidacao);
    expect(itens.length).toBe(inteiro.summary.byType.liquidacao);
    expect(so.summary.total).toBe(inteiro.summary.total);
  });

  it('`loja` é filtro de VISTA e não muda a conta — `storeId` é que muda o escopo', () => {
    const rede = todasAsPaginas('/planning/decisions', 'cards');
    const umaLoja = (rede.itens as any[]).find((c) => c.toStoreId)?.toStoreId as string;
    expect(umaLoja).toBeTruthy();

    const vista = todasAsPaginas('/planning/decisions', 'cards', { loja: umaLoja });
    // Mesmo quadro, menos cards na tela: nenhum número do resumo se mexe.
    expect(vista.resposta.summary).toEqual(rede.resposta.summary);
    expect(vista.itens.length).toBeLessThan(rede.itens.length);
    for (const c of vista.itens as any[]) {
      expect([c.fromStoreId, c.toStoreId, c.outletStoreId, c.outletFromStoreId]).toContain(umaLoja);
    }
    // Compra não tem loja: some da vista, e o resumo continua dizendo que existe.
    expect((vista.itens as any[]).some((c) => c.type === 'COMPRA')).toBe(false);
  });
});

describe('demo: as sugestões de compra também paginam', () => {
  it('o resumo (inclusive o contador de risco) é do conjunto, não da página', () => {
    const inteiro = todasAsPaginas('/planning/purchase-suggestions', 'rows');
    const pagina = get('/planning/purchase-suggestions', { pageSize: '7' });

    expect(pagina.rows.length).toBe(7);
    expect(pagina.pagina.total).toBe(inteiro.itens.length);
    expect(pagina.summary).toEqual(inteiro.resposta.summary);

    // `emRisco` existe para a tela parar de baixar todas as linhas só para
    // contar: ele tem que bater com a contagem feita sobre as linhas inteiras.
    const contadoNasLinhas = (inteiro.itens as any[]).filter((r) => r.stockoutInDays !== null).length;
    expect(pagina.summary.emRisco).toBe(contadoNasLinhas);
  });

  it('`recomendacao` recorta as linhas sem mexer no resumo', () => {
    const { itens, resposta } = todasAsPaginas('/planning/purchase-suggestions', 'rows', {
      recomendacao: 'LIQUIDATE',
    });
    expect(itens.length).toBeGreaterThan(0);
    expect((itens as any[]).every((r) => r.recommendation === 'LIQUIDATE')).toBe(true);
    expect(resposta.pagina.total).toBe(resposta.summary.liquidate);
    expect(itens.length).toBe(resposta.summary.liquidate);
  });
});

describe('demo: lote de geração', () => {
  it('o board vem com o lote e a idade de cada card', () => {
    const b = get('/planning/decisions');
    expect(b.batch).toBeTruthy();
    expect(b.batch.source).toBe('CRON');
    // O lote é ancorado na última 6h — nunca no futuro.
    expect(new Date(b.batch.generatedAt).getTime()).toBeLessThanOrEqual(Date.now());
    for (const c of b.cards.slice(0, 20)) {
      expect(typeof c.ageDays).toBe('number');
      expect(c.ageDays).toBeGreaterThanOrEqual(0);
      expect(c.isOverdue).toBe(c.ageDays > 30);
    }
    expect(b.summary.novos).toBeGreaterThan(0);
    // Contra `summary.total`, e não contra `cards.length`: novos e atrasados
    // são contados sobre o QUADRO, e `cards` é só a página.
    expect(b.summary.novos + b.summary.atrasados).toBeLessThanOrEqual(b.summary.total);
  });

  it('cada página traz exatamente o que sobrou do corte, e o resumo não muda entre elas', () => {
    // Antes daqui morava `cards.length <= summary.total`, que é verdade por
    // construção — `cards` é uma fatia do conjunto que `summary.total` conta.
    // Um handler que devolvesse `cards: []` em toda requisição, ou a página
    // errada, ou o corte no lugar errado, passava por ela: 0 <= 1.260 é
    // verdadeiro. Uma invariante que nenhuma implementação plausível quebra não
    // é uma prova, é um comentário com sintaxe de teste.
    //
    // O que se prende agora é o TAMANHO EXATO de cada página — min(pageSize,
    // total - deslocamento) — e a estabilidade do resumo, que é o contrato que
    // a tela lê nos indicadores.
    // O tamanho da página é DERIVADO do total, e não fixo: fixo, ele dependia
    // de o quadro ter um tamanho específico — que depende de
    // `demo-real-data.json`, gitignored e ausente na CI. Derivado, o teste
    // prova a mesma coisa em qualquer catálogo.
    const sonda = get('/planning/decisions', { page: '1', pageSize: '1', group: 'todos' });
    const total: number = sonda.pagina.total;
    expect(total).toBeGreaterThan(3);
    // Escolhe um tamanho que garante MAIS DE UMA página e SOBRA na última —
    // sem sobra, o teste não veria a diferença entre cortar certo e cortar
    // sempre `pageSize` itens.
    let tamanho = Math.floor(total / 3);
    while (total % tamanho === 0) tamanho -= 1;
    const primeira = get('/planning/decisions', { page: '1', pageSize: String(tamanho), group: 'todos' });
    expect(total % tamanho).not.toBe(0);

    const ultima = Math.ceil(total / tamanho);
    expect(ultima).toBeGreaterThan(1);
    for (let page = 1; page <= ultima; page++) {
      const r = get('/planning/decisions', { page: String(page), pageSize: String(tamanho), group: 'todos' });
      const esperado = Math.min(tamanho, total - (page - 1) * tamanho);
      expect(r.cards.length, `página ${page}`).toBe(esperado);
      expect(r.summary, `resumo na página ${page}`).toEqual(primeira.summary);
      expect(r.pagina.total, `total na página ${page}`).toBe(total);
    }

    // Passada do fim: nenhuma linha, e o resumo continua o mesmo.
    const vazia = get('/planning/decisions', { page: String(ultima + 1), pageSize: String(tamanho), group: 'todos' });
    expect(vazia.cards.length).toBe(0);
    expect(vazia.summary).toEqual(primeira.summary);
  });

  it('a idade de um card é estável entre chamadas (não muda a cada recarga)', () => {
    const a = get('/planning/decisions').cards[0];
    const b = get('/planning/decisions').cards.find((c: any) => c.id === a.id);
    expect(b.firstSeenAt).toBe(a.firstSeenAt);
  });

  it('/planning/batches devolve a série de lotes, mais recente primeiro', () => {
    const rows = get('/planning/batches').rows as any[];
    expect(rows.length).toBeGreaterThan(0);
    const datas = rows.map((r) => new Date(r.generatedAt).getTime());
    expect(datas).toEqual([...datas].sort((x, y) => y - x));
    expect(rows[0].compra + rows[0].remanejamento + rows[0].liquidacao).toBe(rows[0].cardsTotal);
  });
});

describe('demo: recorte de produto (feedback Galbe — "ainda continua puxando lentes")', () => {
  const isLens = (c: string) => /lente|tratamento/i.test(c ?? '');

  it('/stock com group=principal não traz lente nem tratamento', () => {
    const rows = get('/stock', { group: 'principal' }).rows as { category: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(isLens(r.category), `veio ${r.category}`).toBe(false);
  });

  it('o recorte não apaga nada: group=todos volta a trazer mais linhas', () => {
    const principal = get('/stock', { group: 'principal' }).total;
    const todos = get('/stock', { group: 'todos' }).total;
    expect(todos).toBeGreaterThan(principal);
  });

  it('group=lentes mostra SÓ lente e tratamento (prévia do laboratório)', () => {
    const rows = get('/stock', { group: 'lentes' }).rows as { category: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(isLens(r.category), `veio ${r.category}`).toBe(true);
  });

  it('filtrar por categoria NÃO fura o recorte', () => {
    // Escolher uma categoria de lente dentro do recorte principal não pode
    // trazer lente de volta pela porta dos fundos.
    const cats = get('/products/categories') as string[];
    const lensCat = cats.find((c) => isLens(c));
    if (!lensCat) return; // dataset sem lente: nada a provar
    const rows = get('/stock', { group: 'principal', category: lensCat }).rows as unknown[];
    expect(rows.length).toBe(0);
  });

  it('alertas e produtos respeitam o mesmo recorte', () => {
    const al = get('/alerts', { group: 'principal' }).rows as { category: string }[];
    for (const r of al) expect(isLens(r.category), `alerta de ${r.category}`).toBe(false);
    const pr = get('/products', { group: 'principal' }).rows as { category: string }[];
    for (const r of pr) expect(isLens(r.category), `produto ${r.category}`).toBe(false);
  });
});

describe('demo: /stores (feedback Galbe — "estoque por SKU e loja tá uniforme")', () => {
  const rows = () => get('/stores').rows as { id: string; _count: { stockItems: number; sales: number } }[];

  it('SKUs em estoque NÃO é o mesmo número em toda loja', () => {
    const counts = rows().map((s) => s._count.stockItems);
    expect(counts.length).toBeGreaterThan(1);
    // O defeito era contar o catálogo inteiro (igual para todas as filiais).
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it('SKUs em estoque nunca passa do tamanho do catálogo', () => {
    const catalogo = (get('/products', { group: 'todos' }) as any).total;
    for (const s of rows()) {
      expect(s._count.stockItems).toBeLessThanOrEqual(catalogo);
      expect(s._count.stockItems).toBeGreaterThanOrEqual(0);
    }
  });

  it('a contagem é coerente com o estoque daquela loja', () => {
    // `rows` de /stock é a PÁGINA (200); o número comparável é o `total`, que
    // o handler conta antes de paginar.
    for (const s of rows().slice(0, 5)) {
      const comSaldoDisponivel = get('/stock', {
        storeId: s.id, group: 'todos', onlyAvailable: 'true',
      }).total;
      // "SKUs em estoque" conta saldo na loja; disponível já desconta reserva,
      // então é sempre um subconjunto.
      expect(s._count.stockItems).toBeGreaterThanOrEqual(comSaldoDisponivel);
    }
  });

  it('Vendas não é número inventado — vem do dataset', () => {
    // Antes: int(15, 30) a cada render. Agora tem que ser estável.
    const a = rows().map((s) => s._count.sales);
    const b = rows().map((s) => s._count.sales);
    expect(a).toEqual(b);
  });
});

describe('demo: mudar o filtro muda o dado', () => {
  /*
     O contrato que faltava: o período é um FILTRO, e filtro que não move número
     é rótulo mentindo. Com a amostra estática real isso valia para o
     faturamento, a série diária e o desempenho por loja — os três recortes que
     a fotografia mede com data. Aqui, no dataset fictício, o guarda é a série:
     ela tem que ter exatamente o número de pontos do período pedido.
  */
  /*
     Estas asserções valem nos DOIS sabores de propósito. Com o dataset
     fictício a série tem o tamanho pedido; com a amostra real embarcada ela
     para na janela medida (7 dias). O contrato comum — e o que o defeito
     violava — é: a série nunca é maior que o pedido, nunca é vazia, e
     recortes menores devolvem MENOS pontos.
  */
  it('a série diária nunca promete mais dias do que entrega', () => {
    for (const days of ['1', '3', '7', '30', '90']) {
      const r = get('/bi/sales-timeseries', { days });
      expect(r.points.length, `período de ${days} dias`).toBeGreaterThan(0);
      expect(r.points.length, `período de ${days} dias`).toBeLessThanOrEqual(Number(days));
      // O `days` devolvido é o que a série de fato cobre — é dele que a tela
      // tira o rótulo, então ele não pode divergir do número de pontos.
      expect(r.days).toBe(r.points.length);
    }
  });

  it('encurtar o período encurta a série — o filtro move o dado', () => {
    const um = get('/bi/sales-timeseries', { days: '1' });
    const tres = get('/bi/sales-timeseries', { days: '3' });
    const sete = get('/bi/sales-timeseries', { days: '7' });

    expect(um.points.length).toBe(1);
    expect(tres.points.length).toBe(3);
    expect(sete.points.length).toBe(7);
    // E o conteúdo muda junto, não só o tamanho.
    expect(um.points).not.toEqual(tres.points.slice(0, 1));
  });

  /*
     GUARDA DE COERÊNCIA — foi este teste que pegou o defeito.

     O faturamento por loja é reconstruído do balde `loja × dia da semana`. Numa
     amostra de até 7 dias o dia da semana identifica UMA data e a conta é
     exata; numa de 30, "quinta" agrega ~4 datas. A primeira versão somava o
     balde inteiro sempre que o dia da semana caísse na janela — e um recorte de
     7 dias sobre 30 devolvia os 30 (R$ 4,53 mi em vez de R$ 1,08 mi), com o KPI
     ao lado mostrando o número certo: duas respostas para a mesma pergunta, na
     mesma tela. Agora cada balde entra na proporção das ocorrências dentro da
     janela, o que é exato quando a amostra tem até 7 dias.
  */
  it('KPI, série e soma por loja contam a MESMA história em toda janela', () => {
    for (const days of ['1', '3', '7', '30']) {
      const kpi = get('/bi/kpis', { days, group: 'todos' });
      const porLoja = get('/bi/sales-by-dimension', { days, by: 'store', group: 'todos' });
      const serie = get('/bi/sales-timeseries', { days, group: 'todos' });

      const somaSerie = serie.points.reduce((a: number, p: any) => a + p.total, 0);
      const somaLojas = porLoja.rows.reduce((a: number, r: any) => a + r.total, 0);

      // O KPI é a soma da série — as duas leem a mesma janela.
      expect(kpi.revenue, `KPI vs série em ${days} dias`).toBeCloseTo(somaSerie, 1);
      // E a soma por loja não pode divergir da rede em mais de 5%.
      const desvio = Math.abs(somaLojas - kpi.revenue) / Math.max(1, kpi.revenue);
      expect(desvio, `por loja vs rede em ${days} dias (desvio ${(desvio * 100).toFixed(1)}%)`)
        .toBeLessThan(0.05);
    }
  });

  /*
     NENHUMA PARTE PODE SER MAIOR QUE O TODO.

     Defeito relatado pelo cliente: no BI, com recorte "Óculos" em 1 dia, o
     total da rede marcava R$ 55.069,69 enquanto A GRACIOSA MIDWAY sozinha
     mostrava R$ 78.829,04. A causa: o KPI passou a acompanhar a janela e as
     quebras — loja, marca, categoria, curva ABC, análise de vendas — ficaram
     congeladas no período inteiro, porque nenhuma delas tem dia na amostra.
     Agora todas caem na mesma escala do KPI, e este teste garante que continuem
     caindo: basta uma delas voltar a ignorar a janela para uma "parte" ficar
     maior que o "todo" outra vez.
  */
  it('nenhuma quebra fica maior que a rede, em nenhum recorte', () => {
    for (const group of ['todos', 'principal', 'lentes']) {
      for (const days of ['1', '3', '7']) {
        const kpi = get('/bi/kpis', { days, group });
        const rede = kpi.revenue;

        for (const by of ['store', 'category', 'brand']) {
          const dim = get('/bi/sales-by-dimension', { days, by, group });
          const soma = dim.rows.reduce((a: number, r: any) => a + r.total, 0);
          const maior = dim.rows.reduce((a: number, r: any) => Math.max(a, r.total), 0);

          expect(maior, `${by} · ${group} · ${days}d: uma linha maior que a rede`)
            .toBeLessThanOrEqual(rede * 1.02);
          expect(Math.abs(soma - rede) / Math.max(1, rede), `${by} · ${group} · ${days}d: soma fora da rede`)
            .toBeLessThan(0.05);
        }

        // A curva ABC lê a mesma janela que o BI.
        const abc = get('/reports/abc', { days, group });
        const somaAbc = abc.rows.reduce((a: number, r: any) => a + r.revenue, 0);
        expect(Math.abs(somaAbc - rede) / Math.max(1, rede), `ABC · ${group} · ${days}d`)
          .toBeLessThan(0.05);
      }
    }
  });

  it('a análise de vendas encolhe junto com a janela', () => {
    const um = get('/reports/sales-analysis', { days: '1', by: 'store' });
    const sete = get('/reports/sales-analysis', { days: '7', by: 'store' });
    const soma = (r: any) => r.rows.reduce((a: number, x: any) => a + x.revenue, 0);
    expect(soma(um)).toBeLessThan(soma(sete));
  });

  it('a cobertura declara a janela que realmente usou, nunca maior que a pedida', () => {
    for (const days of ['1', '7', '30', '90']) {
      const r = get('/dashboard/coverage', { days });
      expect(r.windowDays, `período de ${days} dias`).toBeLessThanOrEqual(Number(days));
      expect(r.windowDays).toBeGreaterThan(0);
    }
  });
});

describe('demo: janela de vendas medida, não presumida', () => {
  it('/dashboard/coverage devolve a janela que usou como divisor', () => {
    const r = get('/dashboard/coverage');
    expect(r.windowDays).toBeGreaterThan(0);
    expect(r.days).toBe(r.windowDays);
  });

  it('cobertura = estoque ÷ (vendas no período × 30/janela)', () => {
    // O defeito era dividir por 30 quando o período tinha 7 dias, inflando
    // toda cobertura em 4,3x. A conta tem que fechar com a janela declarada.
    const r = get('/dashboard/coverage');
    for (const row of r.rows as any[]) {
      if (row.monthlyUnits > 0) {
        expect(row.coverageMonths).toBeCloseTo(row.stockUnits / row.monthlyUnits, 1);
        expect(row.monthlyUnits).toBeCloseTo((row.unitsSold * 30) / r.windowDays, 0);
      }
    }
  });

  it('cobertura por loja respeita o recorte de produto', () => {
    const principal = get('/dashboard/coverage', { group: 'principal' });
    const todos = get('/dashboard/coverage', { group: 'todos' });
    const soma = (r: any) => (r.rows as any[]).reduce((a, x) => a + x.stockUnits, 0);
    // Sem lente a rede tem menos unidades — se for igual, o recorte não pegou.
    expect(soma(principal)).toBeLessThanOrEqual(soma(todos));
  });
});


describe('demo: filtros de loja e tipo de produto nos relatórios (feedbacks 3.0)', () => {
  const tipos = get('/products/categories') as string[];
  const lojas = (get('/stores').rows as { id: string }[]).map((s) => s.id);

  it('curva ABC: o tipo recorta por SKU E por marca — trocar a dimensão não desliga o filtro', () => {
    // Um tipo que a análise de MARCA cobre: lente, tratamento e acessório
    // ficam de fora dela por decisão do cliente, e ali o total por marca é
    // zero mesmo — não é o filtro que falhou.
    const tipo =
      tipos.find((t) => get('/reports/abc', { dimension: 'brand', category: t }).totalRevenue > 0) ??
      tipos[0];
    const skuTudo = get('/reports/abc', { dimension: 'product' });
    const skuTipo = get('/reports/abc', { dimension: 'product', category: tipo });
    expect(skuTipo.totalRevenue).toBeGreaterThan(0);
    expect(skuTipo.totalRevenue).toBeLessThanOrEqual(skuTudo.totalRevenue);
    expect((skuTipo.rows as any[]).every((r) => r.category === tipo)).toBe(true);

    const marcaTudo = get('/reports/abc', { dimension: 'brand' });
    const marcaTipo = get('/reports/abc', { dimension: 'brand', category: tipo });
    expect(marcaTipo.totalRevenue).toBeLessThanOrEqual(marcaTudo.totalRevenue);
    // Mesma receita recortada, outro agrupamento.
    expect(Math.abs(marcaTipo.totalRevenue - skuTipo.totalRevenue)).toBeLessThan(1);
  });

  it('curva ABC: a loja recorta a receita (o filtro não é decorativo)', () => {
    const rede = get('/reports/abc', { dimension: 'product' });
    const uma = get('/reports/abc', { dimension: 'product', storeId: lojas[0] });
    expect(uma.totalRevenue).toBeGreaterThan(0);
    expect(uma.totalRevenue).toBeLessThan(rede.totalRevenue);
  });

  it('giro: fora do recorte, fora do relatório', () => {
    const r = get('/reports/turnover', { category: tipos[0] });
    expect((r.rows as any[]).length).toBeGreaterThan(0);
    expect((r.rows as any[]).every((x) => x.category === tipos[0])).toBe(true);
  });

  it('alertas: loja e tipo recortam a lista', () => {
    const todos = get('/alerts', { group: 'principal' });
    const tipo = (todos.rows as any[])[0]?.category;
    if (tipo) {
      const soTipo = get('/alerts', { group: 'principal', category: tipo });
      expect((soTipo.rows as any[]).every((x) => x.category === tipo)).toBe(true);
      expect(soTipo.total).toBeLessThanOrEqual(todos.total);
    }
    const soLoja = get('/alerts', { group: 'principal', storeId: lojas[0] });
    expect((soLoja.rows as any[]).every((x) => x.storeId === lojas[0])).toBe(true);
  });
});

describe('demo: card de liquidação virando transferência (feedbacks 3.0, item 05)', () => {
  it('cada card com destino também diz de ONDE sai e QUANTAS', () => {
    // `tipo=LIQUIDACAO` PEDIDO ao servidor. O quadro vem paginado e ordenado
    // por prioridade e impacto: filtrar liquidações dentro da página tinha
    // chance real de devolver zero e derrubar um teste que nada tem a ver com
    // ordenação.
    const board = get('/planning/decisions', { days: '90', group: 'principal', tipo: 'LIQUIDACAO' });
    const liq = (board.cards as any[]).filter((c) => c.outletStoreId);
    expect(liq.length).toBeGreaterThan(0);
    for (const c of liq) {
      expect(c.type).toBe('LIQUIDACAO');
      if (!c.outletFromStoreId) continue; // só o destino tem saldo: nada a mover
      expect(c.outletFromStoreId).not.toBe(c.outletStoreId);
      expect(c.outletQuantity).toBeGreaterThan(0);
      expect(c.outletFromStoreName).toBeTruthy();
    }
    // A entrega do item 05 é a ação: pelo menos um card precisa ter rota completa.
    expect(liq.some((c) => c.outletFromStoreId && c.outletQuantity > 0)).toBe(true);
  });
});


describe('demo: os números batem entre as telas (feedbacks 30/07)', () => {
  it('curva ABC devolve o denominador do período — "muito baixos" era o recorte', () => {
    const r = get('/reports/abc', { dimension: 'product', group: 'principal' });
    expect(r.periodRevenue).toBeGreaterThan(0);
    expect(r.periodRevenue).toBeGreaterThanOrEqual(r.totalRevenue);
    // O recorte de óculos/armação/relógio é uma FATIA da receita, não o todo.
    expect(r.totalRevenue).toBeLessThan(r.periodRevenue);
  });

  it('a cobertura geral do relatório usa a MESMA base da cobertura do dashboard', () => {
    // Era o furo do feedback 02: o relatório lia a amostra do catálogo e o
    // dashboard lia a rede, então um dizia 1,5 mês e o outro ~26 meses.
    const rel = get('/reports/coverage', { group: 'principal' });
    const dash = get('/dashboard/coverage', { group: 'principal' });
    const estoqueDash = (dash.rows as any[]).reduce((a, x) => a + x.stockUnits, 0);
    expect(rel.total.stockUnits).toBe(estoqueDash);
    const vendidasDash = (dash.rows as any[]).reduce((a, x) => a + x.unitsSold, 0);
    expect(rel.total.unitsSold).toBe(vendidasDash);
  });

  it('quando as linhas por marca são amostra, a resposta declara isso', () => {
    const rel = get('/reports/coverage', { group: 'principal' });
    if (rel.sampled) {
      expect(rel.sampled.stockUnits).toBeLessThan(rel.sampled.networkStockUnits);
      expect(rel.total.stockUnits).toBe(rel.sampled.networkStockUnits);
    }
  });

  it('o desconto do card segue a regra da rede: 20%/30% pelo preço cheio', () => {
    // Tipo pedido na consulta, e não procurado na página — mesma razão do teste
    // da rota de escoamento: a primeira página é dos cards de maior prioridade
    // e impacto, e liquidação não tem prazo de ruptura para disputar com eles.
    const board = get('/planning/decisions', { days: '90', group: 'principal', tipo: 'LIQUIDACAO' });
    const liq = (board.cards as any[]).filter((c) => c.discountPct > 0);
    expect(liq.length).toBeGreaterThan(0);
    for (const c of liq) {
      expect(c.type).toBe('LIQUIDACAO');
      const p = c.discountParams;
      expect(p.stepPct).toBe(10);
      expect(p.stepDays).toBe(90);
      expect([20, 30]).toContain(p.basePct);
      // O sugerido é a regra, limitada pelo teto que zera a margem.
      expect(c.discountPct).toBe(Math.min(p.basePct + 10 * p.steps, c.discountMaxPct));
    }
  });
});

/**
 * Feedbacks 5.0 (Galbe): "lente 80 mil + óculos e relógio 40 mil = 120 mil,
 * porém o total é 211.026". Ele estava certo — os recortes não somavam o
 * catálogo, e 88.661 unidades não tinham opção nenhuma no seletor.
 */
describe('demo: os recortes particionam o catálogo', () => {
  const un = (group: string) => get('/dashboard/summary', { group }).stockUnits as number;

  it('a soma dos quatro recortes é exatamente o total da rede', () => {
    // A invariante que interessa e que vale nos DOIS sabores da demo: nenhuma
    // unidade fica sem recorte. Quantos há em cada um depende do catálogo
    // carregado — o fictício não tem relógio nem bijuteria.
    const partes = ['principal', 'relogios', 'lentes', 'outros'].map(un);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(un('todos'));
    expect(un('todos')).toBeGreaterThan(0);
  });

  it('o KPI de produtos deixa de ser o mesmo número em todo recorte', () => {
    // Item 01: "a quantidade total de produtos permanece 21683 independente da
    // categoria que escolho em cima".
    const skus = (g: string) => get('/dashboard/summary', { group: g }).products as number;
    expect(skus('principal')).toBeLessThan(skus('todos'));
  });

  it('relógio tem recorte próprio e saiu de dentro de óculos', () => {
    // Item 03.
    const cats = (g: string) =>
      new Set((get('/stock', { group: g }).rows as { category: string }[]).map((r) => r.category));
    expect([...cats('principal')].some((c) => /rel[oó]gio/i.test(c))).toBe(false);
    for (const c of cats('relogios')) expect(c).toMatch(/rel[oó]gio/i);
  });

  it('o plano de transferências obedece ao recorte (item 02: lente nos alertas)', () => {
    const plano = (group: string) =>
      get('/planning/rebalance', { days: '90', group }).rows as { description: string }[];
    const rows = plano('principal');
    expect(rows.length).toBeGreaterThan(0);
    // Os dois planos são disjuntos: pedir óculos não traz lente. (No catálogo
    // fictício o plano de lentes pode sair vazio — vazio também é disjunto.)
    const ids = new Set(rows.map((r) => r.description));
    expect(plano('lentes').some((r) => ids.has(r.description))).toBe(false);
  });
});

/**
 * "Os gráficos do BI não estão atualizando quando marcamos categorias
 * específicas" (Galbe). Estava certo: o módulo inteiro ignorava `group` e
 * `category` — as seis rotas, a chave de cache e metade dos números, que eram
 * sorteados ou vinham do agregado da rede.
 */
describe('demo: o BI obedece ao recorte', () => {
  const bi = (url: string, params: Record<string, string | undefined> = {}) => get(url, params);

  it('trocar o recorte muda faturamento, unidades e estoque', () => {
    const oculos = bi('/bi/kpis', { days: '90', group: 'principal' });
    const lentes = bi('/bi/kpis', { days: '90', group: 'lentes' });
    const tudo = bi('/bi/kpis', { days: '90', group: 'todos' });
    for (const k of ['revenue', 'unitsSold', 'stockUnits'] as const) {
      expect(oculos[k], k).not.toBe(lentes[k]);
      expect(oculos[k], k).toBeLessThanOrEqual(tudo[k]);
    }
    // E o número deixou de ser sorteado: duas chamadas iguais dão o mesmo valor.
    expect(bi('/bi/kpis', { days: '90', group: 'principal' }).unitsSold).toBe(oculos.unitsSold);
  });

  it('vendas por categoria só devolve categoria DENTRO do recorte', () => {
    const rows = bi('/bi/sales-by-dimension', { by: 'category', group: 'principal' }).rows as {
      label: string;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.label).not.toMatch(/lente|tratamento/i);
  });

  it('marcar um tipo específico recorta todos os gráficos, não só um', () => {
    const tipos = get('/products/categories', { group: 'principal' }) as string[];
    const alvo = tipos[0];
    const cheio = bi('/bi/sales-by-dimension', { by: 'store', group: 'principal' });
    const marcado = bi('/bi/sales-by-dimension', { by: 'store', group: 'principal', category: alvo });
    const soma = (r: Record<string, any>) =>
      (r.rows as { total: number }[]).reduce((a, x) => a + x.total, 0);
    expect(soma(marcado)).toBeLessThan(soma(cheio));

    // O sankey de vendas segue o mesmo recorte — antes ele era da rede inteira.
    const fluxo = bi('/bi/sales-flow', { group: 'principal', category: alvo });
    for (const n of fluxo.nodes as { name: string }[]) {
      const ehCategoria = tipos.includes(n.name);
      if (ehCategoria) expect(n.name).toBe(alvo);
    }
  });

  it('o que não se reparte por produto vem MARCADO como proporcional', () => {
    // `aproximado` passou a ter DUAS causas: o recorte de produto (pagamento
    // cobre a venda inteira; série e mapa de calor vêm agregados) e o recorte
    // de DATA em quebras que não têm dia. Para isolar a primeira, a janela
    // pedida aqui é maior que a amostra — ela é limitada à cobertura, então
    // não há recorte de data nenhum e o que sobrar é projeção de produto.
    const AMOSTRA_INTEIRA = '3650';
    expect(bi('/bi/sales-by-dimension', { by: 'payment', days: AMOSTRA_INTEIRA, group: 'principal' }).aproximado).toBe(true);
    expect(bi('/bi/sales-timeseries', { days: AMOSTRA_INTEIRA, group: 'principal' }).aproximado).toBe(true);
    expect(bi('/bi/heatmap', { days: AMOSTRA_INTEIRA, group: 'principal' }).aproximado).toBe(true);
    // Sem recorte de produto e sem recorte de data, nada a declarar.
    expect(bi('/bi/sales-by-dimension', { by: 'payment', days: AMOSTRA_INTEIRA, group: 'todos' }).aproximado).toBeUndefined();
    expect(bi('/bi/sales-timeseries', { days: AMOSTRA_INTEIRA, group: 'todos' }).aproximado).toBeUndefined();
  });

  it('o cartão de valor médio responde ao recorte — o ticket médio não responderia', () => {
    // Sob recorte, receita e nº de vendas caem juntos e o ticket devolve o
    // mesmo número em todo recorte. O valor POR PEÇA é o que separa óculos de
    // lente, e é ele que a tela mostra quando há recorte.
    const v = (g: string) => bi('/bi/kpis', { days: '90', group: g }).avgUnitPrice as number;
    const oculos = v('principal');
    const lentes = v('lentes');
    expect(oculos).toBeGreaterThan(0);
    expect(lentes).toBeGreaterThan(0);
    expect(oculos).not.toBeCloseTo(lentes, 0);
  });

  it('escolher uma loja recorta o mapa de calor e as vendas por loja', () => {
    const loja = (get('/stores').rows as { id: string; name: string }[])[0];
    const mapa = bi('/bi/heatmap', { storeId: loja.id });
    expect(mapa.yLabels).toEqual([loja.name]);
    const porLoja = bi('/bi/sales-by-dimension', { by: 'store', storeId: loja.id });
    expect((porLoja.rows as { label: string }[]).every((r) => r.label === loja.name)).toBe(true);
  });
});

/**
 * As duas telas respondiam "quantas unidades a rede tem neste recorte" por
 * caminhos diferentes — 211.026 no painel contra 112.515 no BI, no mesmo
 * instante e no mesmo recorte. Uma função só, e um teste para provar.
 */
describe('demo: painel e BI contam o mesmo estoque', () => {
  for (const g of ['principal', 'relogios', 'lentes', 'outros', 'todos']) {
    it(`recorte "${g}": o KPI do BI bate com o do painel`, () => {
      const painel = get('/dashboard/summary', { group: g }).stockUnits as number;
      const bi = get('/bi/kpis', { days: '90', group: g }).stockUnits as number;
      expect(bi).toBe(painel);
    });
  }
});

/**
 * A tela de Planejamento declara na `NotaDeIdadeEstimada`, a partir de
 * `plan.guards`, duas travas do motor: a origem nunca fica sem vitrine e peça
 * com menos de 45 dias na loja não é remanejada.
 *
 * A demo alimentava `buildRebalance` sem idade, sem reserva e sem unidades a
 * caminho — caía no fail-open e remanejava peça de qualquer idade, e reoferecia
 * unidade que já tinha dono. A nota estava certa; o motor da demonstração é que
 * mentia. Estes testes prendem os dois lados.
 */
describe('demo: o remanejamento aplica as travas que a tela anuncia', () => {
  const plano = () => get('/planning/rebalance', { days: '90' });
  type Linha = {
    productId: string;
    description: string;
    fromStoreId: string;
    fromStoreName: string;
    toStoreId: string;
    quantity: number;
    fromRemainingUnits: number;
  };

  it('nenhuma origem sugerida está dentro da carência declarada em guards', () => {
    const p = plano();
    const rows = p.rows as Linha[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const idade = demoIdadeNaLoja(r.fromStoreId, r.productId);
      expect(idade, `${r.description}: ${r.fromStoreName} doa peça de ${idade} dias`).toBeGreaterThanOrEqual(
        p.guards.newProductDays,
      );
    }
  });

  it('a origem nunca é esvaziada: sobra ao menos o piso de vitrine declarado', () => {
    const p = plano();
    for (const r of p.rows as Linha[]) {
      expect(r.fromRemainingUnits).toBeGreaterThanOrEqual(p.guards.donorFloorUnits);
    }
  });

  it('transferência já pedida deixa de ser oferecida de novo, e volta se for cancelada', () => {
    const alvo = (plano().rows as Linha[])[0];
    const saindo = () =>
      (plano().rows as Linha[])
        .filter((r) => r.productId === alvo.productId && r.fromStoreId === alvo.fromStoreId)
        .reduce((a, r) => a + r.quantity, 0);
    const antes = saindo();
    expect(antes).toBeGreaterThanOrEqual(alvo.quantity);

    const mv = demoHandle({
      method: 'POST',
      url: '/movements',
      body: {
        type: 'TRANSFER',
        productId: alvo.productId,
        fromStoreId: alvo.fromStoreId,
        toStoreId: alvo.toStoreId,
        quantity: alvo.quantity,
      },
    }) as { id: string };

    // As unidades pedidas saem da oferta: seguir oferecendo é criar uma segunda
    // ordem para as mesmas peças.
    expect(saindo()).toBeLessThanOrEqual(antes - alvo.quantity);

    demoHandle({ method: 'POST', url: `/movements/${mv.id}/cancel`, body: {} });
    expect(saindo()).toBe(antes);
  });
});

describe('demo: o mix de grifes chega ao motor, não só à tabela', () => {
  const put = (url: string, body: Record<string, unknown>) =>
    demoHandle({ method: 'PUT', url, body }) as Record<string, any>;

  /**
   * A demonstração era write-only aqui: marcar uma grife como fora do mix
   * marcava a linha e nada mais. A aba de compras seguia sugerindo comprá-la —
   * o oposto do que a plataforma promete, e justamente no ambiente em que a
   * promessa é apresentada a quem decide.
   */
  it('marcar uma grife muda a recomendação das peças dela', () => {
    const linhas = () =>
      todasAsPaginas('/planning/purchase-suggestions', 'rows').itens as {
        productId: string;
        description: string;
        unitsSold: number;
        brand: string | null;
        category: string | null;
        recommendation: string;
        reason: string;
      }[];

    // Uma grife com peça que VENDE, e casada pelo mesmo rótulo que a tela de
    // mix oferece. A primeira versão deste teste exigia uma linha de COMPRA — e
    // ficou verde aqui e vermelha na CI, porque o catálogo real (gitignorado)
    // tem compras sugeridas e o fictício não tem nenhuma. O que a marcação faz
    // não depende de haver compra: com giro, ela vira DONT_BUY e a peça declara
    // `situacao: 'fora-do-mix'`.
    // Casado pela MESMA extração que o motor usa, e não por `includes`: a
    // primeira versão comparava a descrição com o rótulo da tela por substring,
    // e "BAN" casava com "RAY BAN" — o teste marcava uma grife e cobrava o
    // resultado em outra.
    const grifeDe = (r: { description: string; category: string | null; brand: string | null }) =>
      analysisBrand(r.description, r.category, r.brand);
    // `reason` e não `situacao`: a rota devolve a razão em texto, e a peça com
    // giro cuja grife saiu do mix ganha "Grife fora do mix atual da rede".
    // Serve mesmo quando a linha já era DONT_BUY por outro motivo — e é o que
    // o gestor lê na tela.
    const foraDoMix = (r: { reason: string }) => /fora do mix/i.test(r.reason);
    const antes = linhas();
    const comGiro = antes.find((r) => r.unitsSold > 0 && !foraDoMix(r) && grifeDe(r));
    expect(comGiro, 'nenhuma peça com giro e grife identificável').toBeTruthy();
    const grife = grifeDe(comGiro!)!;
    const casa = (r: (typeof antes)[number]) =>
      normBrandKey(grifeDe(r) ?? '') === normBrandKey(grife) && r.unitsSold > 0;
    const doGrife = (rs: typeof antes) => rs.filter(casa);
    expect(doGrife(antes).some(foraDoMix)).toBe(false);

    try {
      put('/planning/brand-mix', { brand: grife, discontinued: true });
      const depois = doGrife(linhas());
      expect(depois.length).toBeGreaterThan(0);
      for (const r of depois) {
        expect(foraDoMix(r), `${r.description} deveria dizer que a grife saiu do mix`).toBe(true);
        expect(r.recommendation, `${r.description} não pode ser reposta`).not.toBe('BUY');
      }
    } finally {
      put('/planning/brand-mix', { brand: grife, discontinued: false });
    }
    // E desmarcar devolve tudo: sem isto, o teste deixaria a demo alterada para
    // quem rodasse depois dele.
    expect(doGrife(linhas()).some(foraDoMix)).toBe(false);
  });

  it('desmarcar com outra forma do nome funciona — a chave é normalizada', () => {
    // O mesmo defeito que a produção acabou de corrigir, que a demo repetia:
    // marcar por uma forma e desmarcar por outra deixava a marcação presa.
    const alvo = (get('/planning/brand-mix').rows as { brand: string }[])[0].brand;
    const marcada = () =>
      (get('/planning/brand-mix').rows as { brand: string; discontinued: boolean }[]).some(
        (r) => r.brand.toUpperCase() === alvo.toUpperCase() && r.discontinued,
      );

    put('/planning/brand-mix', { brand: alvo.toLowerCase(), discontinued: true });
    expect(marcada()).toBe(true);
    put('/planning/brand-mix', { brand: alvo.toUpperCase(), discontinued: false });
    expect(marcada()).toBe(false);
  });
});

/**
 * O MIX POR LOJA na demo — nova rodada · itens 01, 02 e 05.
 *
 * A demonstração é onde o cliente confere o comportamento antes de confiar
 * nele. Um porteiro que existe só na produção faria a demo mostrar exatamente
 * a sugestão que a produção passou a barrar — e foi com o exemplo da demo
 * ("Dior para Guarabira") que o defeito voltou duas rodadas seguidas.
 */
describe('demo: mix por loja e a fila de distribuição', () => {
  const put = (url: string, body: Record<string, unknown>) =>
    demoHandle({ method: 'PUT', url, body }) as Record<string, any>;

  const remanejamentos = () =>
    (get('/planning/rebalance').rows ?? []) as {
      description: string;
      brand: string | null;
      category: string | null;
      toStoreId: string;
      toStoreName: string;
    }[];

  it('grife sem loja declarada é corrente — nenhuma sugestão desaparece', () => {
    const { rows, lojas } = get('/planning/mix-por-loja');
    expect(rows).toEqual([]);
    expect(lojas.length).toBeGreaterThan(1);
    expect(remanejamentos().length).toBeGreaterThan(0);
  });

  it('declarar uma loja tira a grife das demais — e desfazer devolve tudo', () => {
    const antes = remanejamentos();
    const alvo = antes.find((r) => analysisBrand(r.description, r.category, r.brand));
    expect(alvo, 'nenhuma linha de remanejamento com grife identificável').toBeTruthy();
    const grife = analysisBrand(alvo!.description, alvo!.category, alvo!.brand)!;

    const daGrife = (rs: typeof antes) =>
      rs.filter((r) => normBrandKey(analysisBrand(r.description, r.category, r.brand) ?? '') === normBrandKey(grife));
    expect(daGrife(antes).length).toBeGreaterThan(0);

    try {
      // Restringe a grife a UMA loja: a de destino da própria linha alvo.
      put('/planning/mix-por-loja', { brand: grife, storeIds: [alvo!.toStoreId] });
      const depois = daGrife(remanejamentos());
      // Toda sugestão remanescente da grife tem que ir para a loja declarada.
      for (const r of depois) {
        expect(r.toStoreId, `${r.description} foi para uma loja que não trabalha ${grife}`).toBe(
          alvo!.toStoreId,
        );
      }
      // E a declaração aparece na tela, com o nome da loja resolvido.
      const { rows } = get('/planning/mix-por-loja');
      expect(rows).toHaveLength(1);
      expect(rows[0].storeIds).toEqual([alvo!.toStoreId]);
      expect(rows[0].stores[0].name).toBeTruthy();
    } finally {
      // Lista VAZIA apaga a restrição — a grife volta a ser corrente.
      put('/planning/mix-por-loja', { brand: grife, storeIds: [] });
    }

    expect(get('/planning/mix-por-loja').rows).toEqual([]);
    // Sem a limpeza, o teste deixaria a demo alterada para quem rodasse depois.
    expect(daGrife(remanejamentos()).length).toBe(daGrife(antes).length);
  });

  it('a fila de distribuição existe e separa pendentes de repartidas', () => {
    // A aba nova (item 05) abriria em erro se a rota não existisse na demo —
    // e era esse o estado do plano de distribuição, que nunca foi espelhado
    // aqui porque vivia escondido atrás de um botão numa linha de tabela.
    const fila = get('/planning/fila-de-distribuicao');
    expect(Array.isArray(fila.pendentes)).toBe(true);
    expect(Array.isArray(fila.distribuidos)).toBe(true);
    // As duas listas são disjuntas por construção: o que já foi repartido sai
    // da fila. Se um pedido aparecesse nas duas, a aba ofereceria repartir
    // uma carga que já saiu.
    const ids = new Set(fila.pendentes.map((c: { orderId: string }) => c.orderId));
    for (const c of fila.distribuidos) expect(ids.has(c.orderId)).toBe(false);
  });

  it('as unidades de recebimento são a RETAGUARDA, que não está na lista de lojas', () => {
    // `stores` da demo exclui GMAIS, assistência e estoque de compras. A carga
    // sai justamente de uma delas — se esta rota lesse a mesma lista das
    // outras telas, viria vazia e a distribuição não teria origem possível.
    const { rows } = get('/planning/receiving-units');
    const lojas = get('/planning/mix-por-loja').lojas as { id: string }[];
    const idsDeVarejo = new Set(lojas.map((l) => l.id));
    for (const u of rows) expect(idsDeVarejo.has(u.id)).toBe(false);
  });
});
