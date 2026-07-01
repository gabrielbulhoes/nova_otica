/**
 * Transformers puros: convertem as respostas da API em `option` do ECharts.
 * Sem React/DOM — testáveis diretamente (metodologia Qodo).
 */
import type { EChartsOption } from 'echarts';
import type { HeatmapData, SalesFlow, TimeseriesPoint } from '../api/client';

export const PALETTE = ['#4f8cff', '#36c98f', '#f5b73d', '#f06363', '#a78bfa', '#38bdf8', '#fb7185'];

const AXIS_COLOR = '#9aa9c7';
const GRID_COLOR = '#213354';
const TEXT = '#e8edf7';

const catAxis = (data: string[], rotate = 0) => ({
  type: 'category' as const,
  data,
  axisLabel: { color: AXIS_COLOR, interval: 0, rotate, hideOverlap: true },
  axisLine: { lineStyle: { color: GRID_COLOR } },
});

const valAxis = () => ({
  type: 'value' as const,
  axisLabel: { color: AXIS_COLOR },
  axisLine: { show: false },
  splitLine: { lineStyle: { color: GRID_COLOR } },
});

const round = (n: number) => Math.round(n * 100) / 100;

/** Medidor (gauge) para um valor limitado. */
export function gaugeOption(value: number, max: number, name: string, color = '#4f8cff', unit = ''): EChartsOption {
  return {
    series: [
      {
        type: 'gauge',
        min: 0,
        max,
        radius: '95%',
        progress: { show: true, width: 12, itemStyle: { color } },
        axisLine: { lineStyle: { width: 12, color: [[1, GRID_COLOR]] } },
        axisLabel: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        pointer: { show: false },
        anchor: { show: false },
        detail: {
          valueAnimation: true,
          formatter: (v: number) => `${round(v)}${unit}`,
          color: TEXT,
          fontSize: 22,
          offsetCenter: [0, '8%'],
        },
        title: { color: AXIS_COLOR, fontSize: 12, offsetCenter: [0, '72%'] },
        data: [{ value: round(value), name }],
      },
    ],
  } as EChartsOption;
}

/** Série temporal (linha com área) de faturamento diário. */
export function timeSeriesOption(points: TimeseriesPoint[]): EChartsOption {
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 64, right: 20, top: 20, bottom: 40 },
    xAxis: catAxis(points.map((p) => p.date.slice(5))),
    yAxis: valAxis(),
    series: [
      {
        type: 'line',
        smooth: true,
        showSymbol: false,
        areaStyle: { opacity: 0.15, color: '#4f8cff' },
        lineStyle: { color: '#4f8cff', width: 2 },
        itemStyle: { color: '#4f8cff' },
        data: points.map((p) => p.total),
      },
    ],
  } as EChartsOption;
}

/** Colunas de valor por rótulo. */
export function barOption(rows: { label: string; total: number }[], color = '#36c98f'): EChartsOption {
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 72, right: 20, top: 20, bottom: 70 },
    xAxis: catAxis(rows.map((r) => r.label), rows.length > 4 ? 25 : 0),
    yAxis: valAxis(),
    series: [{ type: 'bar', data: rows.map((r) => r.total), itemStyle: { color, borderRadius: [4, 4, 0, 0] } }],
  } as EChartsOption;
}

/** Pizza/donut de participação. */
export function pieOption(rows: { label: string; total: number }[]): EChartsOption {
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, textStyle: { color: AXIS_COLOR } },
    color: PALETTE,
    series: [
      {
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['50%', '42%'],
        itemStyle: { borderColor: '#1b2945', borderWidth: 2 },
        label: { color: TEXT },
        data: rows.map((r) => ({ name: r.label, value: r.total })),
      },
    ],
  } as EChartsOption;
}

/** Sankey de fluxo (Categoria → Loja). */
export function sankeyOption(flow: SalesFlow): EChartsOption {
  return {
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'sankey',
        left: 10,
        right: 120,
        data: flow.nodes,
        links: flow.links,
        emphasis: { focus: 'adjacency' },
        lineStyle: { color: 'gradient', opacity: 0.4 },
        label: { color: TEXT },
        itemStyle: { borderWidth: 0 },
        nodeGap: 10,
      },
    ],
  } as EChartsOption;
}

/** Heatmap Loja × dia da semana. */
export function heatmapOption(data: HeatmapData): EChartsOption {
  const max = Math.max(1, ...data.cells.map((c) => c[2]));
  return {
    tooltip: { position: 'top' },
    grid: { left: 130, right: 20, top: 10, bottom: 60 },
    xAxis: catAxis(data.xLabels),
    yAxis: { type: 'category', data: data.yLabels, axisLabel: { color: AXIS_COLOR }, axisLine: { lineStyle: { color: GRID_COLOR } } },
    visualMap: {
      min: 0,
      max,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: { color: ['#16213e', '#4f8cff', '#36c98f'] },
      textStyle: { color: AXIS_COLOR },
    },
    series: [{ type: 'heatmap', data: data.cells, label: { show: false }, itemStyle: { borderColor: '#1b2945', borderWidth: 1 } }],
  } as EChartsOption;
}
