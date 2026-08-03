import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * O filtro de período NÃO PODE OFERECER O QUE A BASE NÃO RESPONDE.
 *
 * O defeito real: a fotografia do CDS cobre 7 dias e a tela oferecia 30, 90 e
 * 180. A conta já usava a janela medida, então escolher 30 devolvia os números
 * de 7 com o rótulo de 30 — o filtro parecia quebrado, e quem lia o rótulo
 * tomava sete dias de receita por um mês.
 *
 * Estes testes fixam as três garantias: períodos fora da amostra ficam
 * desabilitados, sempre sobra pelo menos uma escolha válida, e nada disso vale
 * quando não há amostra estática (backend ao vivo).
 */

const AMOSTRA_7_DIAS = { dias: 7, de: '2026-07-07', ate: '2026-07-13' };

/** Troca a cobertura devolvida pelo client antes de cada import do módulo. */
async function comCobertura(cobertura: typeof AMOSTRA_7_DIAS | null) {
  vi.resetModules();
  vi.doMock('../api/client', () => ({
    DEMO: cobertura !== null,
    coberturaDaAmostra: () => cobertura,
  }));
  return import('./periodo');
}

const RELATORIOS = [
  { dias: 7, label: 'Últimos 7 dias' },
  { dias: 30, label: 'Últimos 30 dias' },
  { dias: 90, label: 'Últimos 90 dias' },
  { dias: 180, label: 'Últimos 180 dias' },
];

/** A tela de rateio de feira: NENHUMA opção cabe em 7 dias. */
const RATEIO = [
  { dias: 90, label: '90 dias' },
  { dias: 180, label: '180 dias' },
  { dias: 365, label: '1 ano' },
];

describe('período com amostra de 7 dias', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('oferece recortes MEDIDOS dentro da amostra — um filtro com uma opção não é filtro', async () => {
    const { opcoesDePeriodo } = await comCobertura(AMOSTRA_7_DIAS);
    const opcoes = opcoesDePeriodo(RELATORIOS);

    const validas = opcoes.filter((o) => !o.disabled).map((o) => o.value);
    expect(validas).toEqual(['1', '3', '7']);
    // O vocabulário da página vence quando o período dela cabe na cobertura.
    expect(opcoes.find((o) => o.value === '7')?.label).toBe('Últimos 7 dias');
  });

  it('desabilita todo recorte maior que a cobertura e diz o motivo no rótulo', async () => {
    const { opcoesDePeriodo } = await comCobertura(AMOSTRA_7_DIAS);
    const fora = opcoesDePeriodo(RELATORIOS).filter((o) => o.disabled);

    expect(fora.map((o) => o.value)).toEqual(['30', '90', '180']);
    for (const o of fora) expect(o.label).toContain('fora da amostra');
  });

  it('o valor inicial cai para o maior recorte que a base responde', async () => {
    const { periodoInicial } = await comCobertura(AMOSTRA_7_DIAS);
    // A tela pedia 30; a base só tem 7.
    expect(periodoInicial(RELATORIOS, 30)).toBe('7');
    // E um pedido que já cabe é respeitado.
    expect(periodoInicial(RELATORIOS, 7)).toBe('7');
  });

  it('mesmo quando nenhuma opção da página cabe, sobram escolhas válidas', async () => {
    const { opcoesDePeriodo, periodoInicial } = await comCobertura(AMOSTRA_7_DIAS);
    const opcoes = opcoesDePeriodo(RATEIO);

    // Um <select> com todas as opções desabilitadas seria um beco sem saída.
    const validas = opcoes.filter((o) => !o.disabled);
    expect(validas.map((o) => o.value)).toEqual(['1', '3', '7']);
    expect(validas.at(-1)!.label).toContain('toda a amostra');
    expect(periodoInicial(RATEIO, 180)).toBe('7');
  });

  it('a legenda nomeia a janela e as datas medidas', async () => {
    const { legendaDaAmostra } = await comCobertura(AMOSTRA_7_DIAS);
    const texto = legendaDaAmostra(7);
    expect(texto).toContain('7 dias');
    expect(texto).toContain('07/07');
    expect(texto).toContain('13/07/2026');
  });

  it('num recorte menor, a legenda dá as datas do recorte e separa o que acompanha', async () => {
    const { legendaDaAmostra } = await comCobertura(AMOSTRA_7_DIAS);
    const texto = legendaDaAmostra(3)!;

    // 3 dias terminando em 13/07 => 11/07 a 13/07.
    expect(texto).toContain('Recorte de 3 dias');
    expect(texto).toContain('11/07');
    expect(texto).toContain('13/07/2026');
    // A parte que o filtro move…
    expect(texto).toContain('por loja');
    // …e a que não move, dita com todas as letras.
    expect(texto).toContain('marca');
    expect(texto).toContain('7 dias');
  });
});

describe('sem amostra estática (backend ao vivo)', () => {
  it('nada é desabilitado, o preferido é respeitado e não há legenda', async () => {
    const { opcoesDePeriodo, periodoInicial, legendaDaAmostra } = await comCobertura(null);

    expect(opcoesDePeriodo(RELATORIOS).every((o) => !o.disabled)).toBe(true);
    expect(opcoesDePeriodo(RELATORIOS).map((o) => o.label)).toEqual(
      RELATORIOS.map((p) => p.label),
    );
    expect(periodoInicial(RELATORIOS, 30)).toBe('30');
    expect(periodoInicial(RATEIO, 180)).toBe('180');
    expect(legendaDaAmostra()).toBeNull();
  });
});
