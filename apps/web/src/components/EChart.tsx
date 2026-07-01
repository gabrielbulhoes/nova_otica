import { useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';

/** Wrapper do ECharts com fundo transparente e export opcional para PNG. */
export function EChart({
  option,
  height = 300,
  exportName,
}: {
  option: EChartsOption;
  height?: number;
  exportName?: string;
}) {
  const ref = useRef<ReactECharts>(null);

  const exportPng = () => {
    const inst = ref.current?.getEchartsInstance();
    if (!inst) return;
    const url = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#1b2945' });
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportName ?? 'grafico'}.png`;
    a.click();
  };

  return (
    <div style={{ position: 'relative' }}>
      {exportName && (
        <button
          className="btn ghost sm"
          onClick={exportPng}
          style={{ position: 'absolute', top: -2, right: 0, zIndex: 1 }}
          title="Baixar PNG"
        >
          ⤓ PNG
        </button>
      )}
      <ReactECharts
        ref={ref}
        option={option}
        style={{ height, width: '100%' }}
        notMerge
        lazyUpdate
        opts={{ renderer: 'canvas' }}
      />
    </div>
  );
}
