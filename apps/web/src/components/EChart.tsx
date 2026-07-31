import { useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { superficieDoGrafico } from '../bi/transforms';

/**
 * Wrapper do ECharts: o gráfico é desenhado com fundo transparente para herdar
 * a superfície do card, e o PNG exportado é achatado sobre essa mesma
 * superfície (PNG com fundo transparente vira retângulo preto ao ser colado em
 * apresentação ou impresso).
 */
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
  const caixa = useRef<HTMLDivElement>(null);

  /**
   * Fundo do PNG = fundo do tema EM VIGOR.
   *
   * O valor antigo era o hexadecimal fixo '#1b2945', azul-marinho de um tema
   * escuro que não existe mais: todo PNG saía com moldura de outra marca.
   * A cor é lida do token `--panel` do próprio contêiner, e não de uma
   * constante, porque o modo escuro pode estar ligado só num bloco da página
   * (o painel de BI) — `getComputedStyle` resolve o escopo certo sozinho.
   * Se o token não estiver disponível, cai na superfície do tema resolvido.
   */
  const fundoDoTema = () => {
    const alvo = caixa.current;
    if (alvo) {
      const token = getComputedStyle(alvo).getPropertyValue('--panel').trim();
      if (token) return token;
    }
    return superficieDoGrafico();
  };

  const exportPng = () => {
    const inst = ref.current?.getEchartsInstance();
    if (!inst) return;
    const url = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: fundoDoTema() });
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportName ?? 'grafico'}.png`;
    a.click();
  };

  return (
    <div ref={caixa} style={{ position: 'relative' }}>
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
