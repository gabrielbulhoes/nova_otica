import { describe, expect, it } from 'vitest';
import { emLotes, varrerPorJanelas, type JanelaDeDatas } from '../src/integrations/sellbie/sweep.js';

/**
 * Conector falso com o comportamento que motivou o módulo: filtra por data e
 * CORTA a resposta num teto, sem erro e sem sinal de que faltou registro.
 */
function conectorFalso(registros: { id: string; data: string }[], teto: number) {
  const chamadas: JanelaDeDatas[] = [];
  const buscar = async (janela: JanelaDeDatas) => {
    chamadas.push(janela);
    const dentro = registros
      .filter((r) => r.data >= janela.date_start && r.data <= janela.date_end)
      .sort((a, b) => a.data.localeCompare(b.data));
    return dentro.slice(0, teto);
  };
  return { buscar, chamadas };
}

/** N registros distribuídos, um a cada `passo` dias a partir de `inicio`. */
function serie(n: number, inicio: string, passo = 1) {
  const base = Date.parse(`${inicio}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    data: new Date(base + i * passo * 86_400_000).toISOString().slice(0, 10),
  }));
}

describe('varrerPorJanelas', () => {
  it('resolve em uma chamada quando a resposta cabe sob o teto', async () => {
    const registros = serie(50, '2024-01-01');
    const { buscar, chamadas } = conectorFalso(registros, 1000);

    const r = await varrerPorJanelas({
      entidade: 'produtos',
      inicio: '1900-01-01',
      fim: '2026-08-04',
      limite: 1000,
      buscar,
      chave: (x) => x.id,
    });

    expect(chamadas).toHaveLength(1);
    expect(r.itens).toHaveLength(50);
    expect(r.janelasTruncadas).toBe(0);
  });

  it('recupera o catálogo inteiro quando o conector trunca em silêncio', async () => {
    // 2.000 registros ao longo de ~5 anos, com um conector que devolve no
    // máximo 100 por chamada. Uma chamada única traria 5% do catálogo.
    const registros = serie(2000, '2020-01-01');
    const { buscar, chamadas } = conectorFalso(registros, 100);

    const r = await varrerPorJanelas({
      entidade: 'produtos',
      inicio: '1900-01-01',
      fim: '2026-08-04',
      limite: 100,
      buscar,
      chave: (x) => x.id,
    });

    expect(r.itens).toHaveLength(2000);
    expect(new Set(r.itens.map((x) => x.id)).size).toBe(2000);
    expect(r.janelasIndivisiveis).toBe(0);
    expect(r.tetoAtingido).toBe(false);
    // O ponto da bisseção: o intervalo vazio de 1900 a 2020 sai barato.
    // Varredura mensal do mesmo período custaria mais de 1.500 chamadas.
    expect(chamadas.length).toBeLessThan(200);
  });

  it('deduplica registros que aparecem em mais de uma janela', async () => {
    // Conector que ignora as datas e devolve sempre os mesmos 3 registros:
    // a união tem que ser 3, não 3 × número de chamadas.
    const buscar = async () => [
      { id: 'a', data: '2024-01-01' },
      { id: 'b', data: '2024-01-02' },
      { id: 'c', data: '2024-01-03' },
    ];
    const r = await varrerPorJanelas({
      entidade: 'produtos',
      inicio: '2024-01-01',
      fim: '2024-12-31',
      limite: 3,
      buscar,
      chave: (x) => x.id,
      maxChamadas: 20,
    });
    expect(r.itens).toHaveLength(3);
  });

  it('não trava quando um único dia estoura o teto, e sinaliza a perda', async () => {
    // 500 registros no MESMO dia, teto de 10: a bisseção chega ao piso e não
    // tem mais o que fatiar. O contrato é terminar e avisar, não girar.
    const registros = Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, data: '2024-06-15' }));
    const { buscar } = conectorFalso(registros, 10);

    const r = await varrerPorJanelas({
      entidade: 'produtos',
      inicio: '2024-06-01',
      fim: '2024-06-30',
      limite: 10,
      buscar,
      chave: (x) => x.id,
    });

    expect(r.janelasIndivisiveis).toBeGreaterThan(0);
    expect(r.itens).toHaveLength(10);
  });

  it('respeita o teto de chamadas em vez de varrer sem fim', async () => {
    const registros = serie(5000, '2000-01-01');
    const { buscar, chamadas } = conectorFalso(registros, 10);

    const r = await varrerPorJanelas({
      entidade: 'produtos',
      inicio: '1900-01-01',
      fim: '2026-08-04',
      limite: 10,
      buscar,
      chave: (x) => x.id,
      maxChamadas: 25,
    });

    expect(chamadas).toHaveLength(25);
    expect(r.tetoAtingido).toBe(true);
  });

  it('aceita janela de um dia só sem fatiar', async () => {
    const { buscar, chamadas } = conectorFalso(serie(3, '2024-06-15'), 100);
    const r = await varrerPorJanelas({
      entidade: 'produtos',
      inicio: '2024-06-15',
      fim: '2024-06-15',
      limite: 100,
      buscar,
      chave: (x) => x.id,
    });
    expect(chamadas).toHaveLength(1);
    expect(r.itens).toHaveLength(1);
  });

  it('reporta as janelas lidas para o log', async () => {
    const eventos: { lidos: number; fatiada: boolean }[] = [];
    const { buscar } = conectorFalso(serie(300, '2024-01-01'), 100);
    await varrerPorJanelas({
      entidade: 'produtos',
      inicio: '2024-01-01',
      fim: '2024-12-31',
      limite: 100,
      buscar,
      chave: (x) => x.id,
      aoRegistrar: (e) => eventos.push({ lidos: e.lidos, fatiada: e.fatiada }),
    });
    expect(eventos.length).toBeGreaterThan(1);
    expect(eventos.some((e) => e.fatiada)).toBe(true);
  });
});

describe('emLotes', () => {
  it('divide preservando ordem e sem perder item', () => {
    const lotes = emLotes([1, 2, 3, 4, 5, 6, 7], 3);
    expect(lotes).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it('devolve lista vazia para entrada vazia', () => {
    expect(emLotes([], 250)).toEqual([]);
  });

  it('trata tamanho inválido como 1 em vez de girar para sempre', () => {
    expect(emLotes([1, 2], 0)).toEqual([[1], [2]]);
  });
});
