import { describe, it, expect } from 'vitest';
import {
  barOption,
  gaugeOption,
  heatmapOption,
  pieOption,
  sankeyOption,
  timeSeriesOption,
} from './transforms';

// Acesso solto às séries (EChartsOption é um union amplo).
const series = (opt: unknown) => (opt as { series: any[] }).series;

describe('transforms do BI', () => {
  it('gaugeOption monta um medidor com valor arredondado e max', () => {
    const s = series(gaugeOption(12.666, 100, 'Ruptura', '#f00', '%'))[0];
    expect(s.type).toBe('gauge');
    expect(s.max).toBe(100);
    expect(s.data[0].value).toBe(12.67);
    expect(s.data[0].name).toBe('Ruptura');
  });

  it('timeSeriesOption gera linha com eixo e dados alinhados', () => {
    const opt = timeSeriesOption([
      { date: '2024-06-01', total: 10, count: 1 },
      { date: '2024-06-02', total: 20, count: 2 },
    ]);
    const s = series(opt)[0];
    expect(s.type).toBe('line');
    expect(s.data).toEqual([10, 20]);
    expect((opt as any).xAxis.data).toEqual(['06-01', '06-02']);
  });

  it('barOption gera colunas', () => {
    const s = series(barOption([{ label: 'Loja A', total: 100 }]))[0];
    expect(s.type).toBe('bar');
    expect(s.data).toEqual([100]);
  });

  it('pieOption mapeia rótulo/valor', () => {
    const s = series(pieOption([{ label: 'PIX', total: 50 }]))[0];
    expect(s.type).toBe('pie');
    expect(s.data[0]).toEqual({ name: 'PIX', value: 50 });
  });

  it('sankeyOption repassa nós e links', () => {
    const flow = { nodes: [{ name: 'Armação' }, { name: 'Loja A' }], links: [{ source: 'Armação', target: 'Loja A', value: 5 }] };
    const s = series(sankeyOption(flow))[0];
    expect(s.type).toBe('sankey');
    expect(s.data).toEqual(flow.nodes);
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
    expect((opt as any).yAxis.data).toEqual(['Loja A']);
    expect(series(opt)[0].type).toBe('heatmap');
  });
});
