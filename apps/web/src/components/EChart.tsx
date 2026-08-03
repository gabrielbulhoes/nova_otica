import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { Icon } from '../brand/Icon';
import type { TemaGrafico } from '../bi/transforms';
import { superficieDoGrafico, temaDoGrafico } from '../bi/transforms';

/**
 * Tema em vigor PARA ESTE ELEMENTO, como estado do React.
 *
 * O escuro do design system pode estar ligado só num bloco (o painel de BI), e
 * não na raiz — por isso a resposta depende de onde o elemento está na árvore,
 * e quem sabe isso é `temaDoGrafico(undefined, alvo)`.
 *
 * O motivo de ser um HOOK, e não uma leitura direta do DOM na hora de montar a
 * option: as options do ECharts são construídas na renderização e não repintam
 * sozinhas quando o atributo muda. Lendo o DOM no meio do render, a troca de
 * tema não produziria re-render nenhum e o gráfico ficaria com as cores
 * antigas até algo mais forçar a atualização. Como estado observado pelo React,
 * a troca vira re-render e a option é reconstruída — que é o único jeito de o
 * ECharts receber cor nova.
 *
 * O observador é montado no <html> com `subtree`, e não no elemento casado,
 * porque `data-tema` costuma ser ADICIONADO a um contêiner que antes não tinha
 * o atributo — observar só o ancestral já casado perderia exatamente esse
 * evento. O filtro por atributo mantém o custo perto de zero.
 */
export function useTemaDoElemento(alvo: RefObject<Element | null>): TemaGrafico {
  // Na primeira renderização o ref ainda é nulo e a resposta cai na raiz; o
  // efeito de layout corrige antes da pintura, então não há flash de tema.
  const [tema, setTema] = useState<TemaGrafico>(() => temaDoGrafico(undefined, alvo.current));

  useLayoutEffect(() => {
    // setState com o mesmo valor não re-renderiza: reler à toa é barato.
    const reler = () => setTema(temaDoGrafico(undefined, alvo.current));
    reler();
    if (typeof MutationObserver === 'undefined') return;
    const observador = new MutationObserver(reler);
    observador.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-tema'],
      subtree: true,
    });
    return () => observador.disconnect();
  }, [alvo]);

  return tema;
}

/**
 * Montador de option: recebe o tema já resolvido para o contêiner do gráfico.
 * É a forma preferida de passar `option` — a página descreve COMO montar, e
 * quem decide em que tema montar é o contêiner, que é quem conhece o escopo.
 */
export type MontadorDeOption = (tema: TemaGrafico) => EChartsOption;

/**
 * Wrapper do ECharts: o gráfico é desenhado com fundo transparente para herdar
 * a superfície do card, e o PNG exportado é achatado sobre essa mesma
 * superfície (PNG com fundo transparente vira retângulo preto ao ser colado em
 * apresentação ou impresso).
 *
 * `option` aceita duas formas:
 *   · função `(tema) => option` — recomendada. O tema é o do contêiner e a
 *     option é remontada sempre que ele muda, então escurecer só o bloco do BI
 *     escurece card E séries juntos;
 *   · objeto pronto — contrato antigo, mantido para não quebrar as chamadas
 *     existentes. Nesse caso o tema foi decidido por quem montou a option, e o
 *     componente não tem como reconstruí-la.
 */
export function EChart({
  option,
  height = 300,
  exportName,
}: {
  option: EChartsOption | MontadorDeOption;
  height?: number;
  exportName?: string;
}) {
  const ref = useRef<ReactECharts>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const tema = useTemaDoElemento(caixa);

  // `EChartsOption` é sempre objeto, nunca função: o typeof discrimina sem risco.
  const opcaoResolvida = useMemo(
    () => (typeof option === 'function' ? option(tema) : option),
    [option, tema],
  );

  /**
   * Fundo do PNG = fundo do tema EM VIGOR NESTE PONTO DA ÁRVORE.
   *
   * O valor antigo era o hexadecimal fixo '#1b2945', azul-marinho de um tema
   * escuro que não existe mais: todo PNG saía com moldura de outra marca.
   * A cor preferida é o token `--panel` do próprio contêiner, porque é
   * literalmente a superfície que o card está pintando. Sem o token (jsdom,
   * navegador antigo), cai na superfície da paleta do tema já resolvido para
   * este elemento — nunca na da raiz.
   */
  const fundoDoTema = useCallback(() => {
    const alvo = caixa.current;
    if (alvo) {
      const token = getComputedStyle(alvo).getPropertyValue('--panel').trim();
      if (token) return token;
    }
    return superficieDoGrafico(tema);
  }, [tema]);

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
    // O botão de exportação RESERVA uma faixa em vez de flutuar sobre o
    // desenho. Antes ele era position:absolute em cima da área de plotagem e
    // cobria o rótulo de valor da primeira barra — que é justamente a maior,
    // porque a barra ordenada ordena decrescente e o rótulo dela cai no canto
    // superior direito, exatamente onde o botão estava.
    <div ref={caixa} style={{ position: 'relative' }}>
      {exportName && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <button className="btn ghost sm" onClick={exportPng} title="Baixar o gráfico em PNG">
            <Icon name="exportar" size={13} aria-hidden />
            PNG
          </button>
        </div>
      )}
      <ReactECharts
        ref={ref}
        option={opcaoResolvida}
        style={{ height, width: '100%' }}
        notMerge
        lazyUpdate
        opts={{ renderer: 'canvas' }}
      />
    </div>
  );
}
