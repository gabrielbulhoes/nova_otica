import { describe, it, expect } from 'vitest';
import {
  LIMIAR_ROSCA,
  barOption,
  formatarValor,
  formatarValorCurto,
  gaugeOption,
  heatmapOption,
  pieOption,
  sankeyOption,
  timeSeriesOption,
} from './transforms';

// Acesso solto às séries (EChartsOption é um union amplo).
const series = (opt: unknown) => (opt as { series: any[] }).series;
const eixoX = (opt: unknown) => (opt as { xAxis: any }).xAxis;
const eixoY = (opt: unknown) => (opt as { yAxis: any }).yAxis;

describe('transforms do BI', () => {
  it('gaugeOption monta um medidor com valor arredondado e max', () => {
    const s = series(gaugeOption(12.666, 100, 'Ruptura', '#f00', '%'))[0];
    expect(s.type).toBe('gauge');
    expect(s.max).toBe(100);
    expect(s.data[0].value).toBe(12.67);
    // Rótulo em mono é caixa alta por regra do manual — o nome chega maiúsculo.
    expect(s.data[0].name).toBe('RUPTURA');
  });

  it('timeSeriesOption gera linha com eixo e dados alinhados', () => {
    const opt = timeSeriesOption([
      { date: '2024-06-01', total: 10, count: 1 },
      { date: '2024-06-02', total: 20, count: 2 },
    ]);
    const s = series(opt)[0];
    expect(s.type).toBe('line');
    expect(s.data).toEqual([10, 20]);
    // O eixo guarda a data ISO inteira; quem vira dd/mm (ordem brasileira) é o
    // formatador, para que o tooltip ainda possa mostrar o ano.
    expect(eixoX(opt).data).toEqual(['2024-06-01', '2024-06-02']);
    expect(eixoX(opt).axisLabel.formatter('2024-06-01')).toBe('01/06');
  });

  it('barOption gera colunas', () => {
    const opt = barOption([{ label: 'Loja A', total: 100 }]);
    const s = series(opt)[0];
    expect(s.type).toBe('bar');
    expect(s.data).toEqual([100]);
  });

  it('barOption vira barra horizontal ordenada quando há muitas categorias', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ label: `Loja ${i}`, total: i + 1 }));
    const opt = barOption(rows);
    // Horizontal = categoria no eixo Y; e a maior fica no topo da lista.
    expect(eixoY(opt).type).toBe('category');
    expect(eixoY(opt).data[eixoY(opt).data.length - 1]).toBe('Loja 11');
    expect(series(opt)[0].type).toBe('bar');
  });

  it('pieOption mapeia rótulo/valor', () => {
    const s = series(pieOption([{ label: 'PIX', total: 50 }]))[0];
    expect(s.type).toBe('pie');
    expect(s.data[0]).toEqual({ name: 'PIX', value: 50 });
  });

  it('pieOption troca a rosca por barra ordenada acima do limiar', () => {
    const rows = Array.from({ length: 22 }, (_, i) => ({ label: `Meio ${i}`, total: 22 - i }));
    const opt = pieOption(rows);
    const s = series(opt)[0];
    // 22 fatias não se comparam por ângulo: a função decide sozinha pela barra.
    expect(s.type).toBe('bar');
    // Top 8 + "Outros" agregando a cauda, com a contagem no próprio rótulo.
    expect(s.data).toHaveLength(9);
    expect(eixoY(opt).data[0]).toBe('Outros (14 categorias)');
    // Sem legenda: ela repetiria o rótulo que já está no eixo.
    expect((opt as { legend?: unknown }).legend).toBeUndefined();
  });

  it('pieOption mantém a rosca dentro do limiar e descarta valor zerado', () => {
    const rows = [
      { label: 'PIX', total: 60 },
      { label: 'Crédito', total: 40 },
      { label: 'Vale', total: 0 },
    ];
    const s = series(pieOption(rows))[0];
    expect(s.type).toBe('pie');
    expect(s.data).toHaveLength(2);
    expect(LIMIAR_ROSCA).toBe(3);
  });

  it('sankeyOption repassa nós e links, colorindo apenas a origem', () => {
    const flow = {
      nodes: [{ name: 'Armação' }, { name: 'Loja A' }],
      links: [{ source: 'Armação', target: 'Loja A', value: 5 }],
    };
    const s = series(sankeyOption(flow))[0];
    expect(s.type).toBe('sankey');
    // Os nós agora carregam cor e posição de rótulo (a origem recebe slot da
    // escala categórica; o destino fica no tom neutro e rotula à esquerda,
    // senão o nome da última coluna é cortado pela borda do card).
    expect(s.data.map((n: { name: string }) => n.name)).toEqual(['Armação', 'Loja A']);
    expect(s.data[0].label.position).toBe('right');
    expect(s.data[1].label.position).toBe('left');
    expect(s.data[0].itemStyle.color).not.toBe(s.data[1].itemStyle.color);
    expect(s.links).toEqual(flow.links);
  });

  it('heatmapOption calcula o max do visualMap e o eixo Y', () => {
    const data = {
      xLabels: ['Seg', 'Ter'],
      yLabels: ['Loja A'],
      cells: [
        [0, 0, 30],
        [1, 0, 70],
      ] as [number, number, number][],
    };
    const opt = heatmapOption(data);
    expect((opt as any).visualMap.max).toBe(70);
    expect(eixoY(opt).data).toEqual(['Loja A']);
    expect(series(opt)[0].type).toBe('heatmap');
  });

  it('formata número no padrão brasileiro', () => {
    expect(formatarValor(1234.5, 'moeda')).toContain('1.234,50');
    expect(formatarValor(12.75, 'percentual')).toBe('12,8%');
    expect(formatarValor(1234, 'unidades')).toBe('1.234 un.');
    // O separador aqui é ESPAÇO INSEPARÁVEL (U+00A0), não espaço comum: é o
    // que o Intl compacto do pt-BR produz, e é o certo — impede que "1,5" e
    // "mil" caiam em linhas diferentes num rótulo de gráfico. Escrito com
    // escape para ninguém "consertar" de volta olhando duas strings idênticas.
    expect(formatarValorCurto(1500, 'unidades')).toBe('1,5\u00A0mil');
  });
});
