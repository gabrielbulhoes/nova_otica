import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';

/** Wrapper fino do ECharts com fundo transparente (tema escuro do app). */
export function EChart({ option, height = 300 }: { option: EChartsOption; height?: number }) {
  return (
    <ReactECharts
      option={option}
      style={{ height, width: '100%' }}
      notMerge
      lazyUpdate
      opts={{ renderer: 'canvas' }}
    />
  );
}
