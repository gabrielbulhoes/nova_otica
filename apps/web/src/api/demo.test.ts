import { describe, it, expect } from 'vitest';
import { demoHandle } from './demo';

/**
 * Handlers da demo exercitados no dataset FICTÍCIO (o JSON real é gitignorado
 * e nunca existe nos testes) — mas as rotas são as mesmas nos dois sabores.
 */
const get = (url: string, params?: Record<string, string | string[] | undefined>) =>
  demoHandle({ method: 'GET', url, params }) as Record<string, any>;

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
    const rows = get('/planning/purchase-suggestions').rows as { description: string }[];
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
    const card = before.cards[0];

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
    const card = get('/planning/decisions').cards[0];
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
    expect(b.summary.novos + b.summary.atrasados).toBeLessThanOrEqual(b.cards.length);
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
    const board = get('/planning/decisions', { days: '90', group: 'principal' });
    const liq = (board.cards as any[]).filter((c) => c.type === 'LIQUIDACAO' && c.outletStoreId);
    expect(liq.length).toBeGreaterThan(0);
    for (const c of liq) {
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
    const board = get('/planning/decisions', { days: '90', group: 'principal' });
    const liq = (board.cards as any[]).filter((c) => c.type === 'LIQUIDACAO' && c.discountPct > 0);
    expect(liq.length).toBeGreaterThan(0);
    for (const c of liq) {
      const p = c.discountParams;
      expect(p.stepPct).toBe(10);
      expect(p.stepDays).toBe(90);
      expect([20, 30]).toContain(p.basePct);
      // O sugerido é a regra, limitada pelo teto que zera a margem.
      expect(c.discountPct).toBe(Math.min(p.basePct + 10 * p.steps, c.discountMaxPct));
    }
  });
});
