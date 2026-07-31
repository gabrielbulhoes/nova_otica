/**
 * Transformers puros: convertem as respostas da API em `option` do ECharts.
 *
 * Continuam sem React e sem manipular o DOM (testáveis diretamente, metodologia
 * Qodo). A ÚNICA leitura de ambiente é `temaDoGrafico()`, que consulta o
 * atributo `data-tema` do <html> para saber em que superfície o gráfico vai
 * cair — e mesmo essa leitura é opcional: todas as funções aceitam `tema`
 * explícito, e em ambiente sem `document` (vitest roda em `node`) o padrão é
 * o tema CLARO, que é o padrão do produto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE ARQUIVO PARECE GRANDE PARA "SÓ MONTAR GRÁFICO"
 * Porque a decisão de FORMA mora aqui, não na página. `pieOption` decide
 * sozinha entre rosca e barra ordenada conforme o número de categorias; as
 * páginas continuam chamando `pieOption(rows)` e não precisam saber. Esse é o
 * contrato que permite consertar a leitura de um gráfico sem tocar em 20 telas.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { EChartsOption } from 'echarts';
import type { HeatmapData, SalesFlow, TimeseriesPoint } from '../api/client';

// ═══════════════════════════════════════════════════════════════════════════
// 1 · PALETA DE DADOS NANOFLOW
// ═══════════════════════════════════════════════════════════════════════════
/*
   O manual da NANOFLOW é quase monocromático: dourado sobre neutros quentes.
   Isso resolve marca, mas não resolve IDENTIDADE DE SÉRIE — duas fatias
   precisam ser distinguíveis por quem não enxerga cor como a maioria.

   A escala categórica abaixo foi DERIVADA, não escolhida no olho:
   · o slot 1 é o ouro do manual (#8A6914 no claro, o mesmo tom rebaixado à
     faixa de luminosidade do escuro) — a marca abre a série;
   · os outros 7 saíram de uma busca com recozimento simulado sobre matiz,
     luminosidade e croma em OKLCH, maximizando a menor separação entre
     vizinhos sob protanopia e deuteranopia (Machado 2009, severidade 1.0);
   · o croma foi mantido baixo de propósito (0,10–0,17 em OKLCH, contra 0,19+
     de paletas genéricas): a marca é sóbria, então a cor de dado é terrosa,
     não fluorescente.

   Medido com o validador da skill `dataviz` (ΔE em OKLab ×100):
     claro  (superfície #F6F2E9): CVD 10,6 · visão normal 17,3 · contraste ≥3,3:1
     escuro (superfície #17140F): CVD  9,5 · visão normal 15,9 · contraste ≥3,2:1
   Alvo do método: CVD ≥ 8 e visão normal ≥ 15. Passa nos dois modos.

   TETO DE 3 FATIAS NA ROSCA — e por que ele é medido, não opinião.
   Em barra/linha só vizinhos se encostam, então basta validar pares
   adjacentes. Numa rosca é diferente: o anel é um CICLO e, com 3 fatias,
   TODAS se encostam — o teste correto é o de todos os pares. Os três
   primeiros slots passam nesse teste nos dois temas (claro CVD 11,1 / normal
   22,0; escuro CVD 13,1 / normal 22,1). Nenhum quarteto testado passou nos
   DOIS temas. Daí LIMIAR_ROSCA = 3: acima disso a forma correta é a barra
   ordenada, que gasta zero canal de cor.
*/

export type TemaGrafico = 'claro' | 'escuro';

interface PaletaDeTema {
  /** Superfície onde o gráfico é desenhado (é o .card, não o fundo da página). */
  superficie: string;
  /** Tinta primária: números e rótulos que precisam ser lidos. */
  tinta: string;
  /** Tinta secundária: eixo, legenda, carimbo de unidade. */
  tintaSuave: string;
  /** Filete neutro de 1px — grade e linha de base. Separa item. */
  filete: string;
  /** Filete dourado — abre e fecha seção (régua hierárquica do manual). */
  fileteOuro: string;
  /** 8 slots de identidade, em ordem fixa. Nunca cicla: o 9º vira "Outros". */
  categorica: string[];
  /** Rampa sequencial de um matiz só (ouro), clara → escura. Heatmap. */
  sequencial: string[];
  /** Tom de recuo, croma quase zero: o agregado "Outros" e o que é contexto. */
  neutro: string;
  /** Estados operacionais. Reservados — nunca viram "série 4". */
  estado: { bom: string; atencao: string; critico: string };
}

export const PALETA_DADOS: Record<TemaGrafico, PaletaDeTema> = {
  claro: {
    superficie: '#f6f2e9',
    tinta: '#2a2416',
    tintaSuave: '#5c543e',
    filete: 'rgba(13, 11, 8, 0.13)',
    fileteOuro: 'rgba(201, 162, 39, 0.32)',
    categorica: [
      '#8a6914', // 1 · ouro fosco — o slot da marca
      '#0289b8', // 2 · azul-petróleo
      '#843296', // 3 · ametista
      '#069488', // 4 · verde-mar
      '#cf653f', // 5 · terracota
      '#8d3743', // 6 · vinho
      '#5d8d2d', // 7 · oliva
      '#824f02', // 8 · âmbar
    ],
    sequencial: ['#e7d6af', '#d6bd7f', '#c6a34a', '#b28b09', '#977502', '#7d6001', '#644c02'],
    neutro: '#8a8168',
    estado: { bom: '#3e5e32', atencao: '#7e5111', critico: '#8e2f1e' },
  },
  escuro: {
    superficie: '#17140f',
    tinta: '#f6f2e9',
    tintaSuave: 'rgba(228, 220, 201, 0.72)',
    filete: 'rgba(246, 242, 233, 0.14)',
    fileteOuro: 'rgba(201, 162, 39, 0.32)',
    categorica: [
      '#b48f0a', // 1 · ouro — o mesmo matiz, na faixa de luminosidade do escuro
      '#339bc9', // 2 · azul-petróleo
      '#894a97', // 3 · ametista
      '#1d9c90', // 4 · verde-mar
      '#a44f02', // 5 · terracota
      '#d0557f', // 6 · vinho
      '#5b9600', // 7 · oliva
      '#8f5801', // 8 · âmbar
    ],
    sequencial: ['#382c0c', '#533f04', '#6e5402', '#896a01', '#a68003', '#c19926', '#d7b357'],
    neutro: '#8a8069',
    estado: { bom: '#a8cc85', atencao: '#f0d482', critico: '#e39074' },
  },
};

/**
 * Contrato antigo. Ficava exportado como paleta crua e agora aponta para a
 * escala categórica do tema claro (o padrão do produto). Preservado porque o
 * nome é interface; quem precisa dos dois temas usa `PALETA_DADOS`.
 */
export const PALETTE = PALETA_DADOS.claro.categorica;

/** Acima disso, rosca vira barra ordenada. Ver a nota sobre o ciclo do anel. */
export const LIMIAR_ROSCA = 3;
/** Barras mostradas antes de agregar a cauda em "Outros". */
const TOP_PADRAO = 8;

/**
 * Tema em vigor. Claro é o padrão do produto; escuro é escolha explícita
 * (data-tema="escuro" no <html>, como o CSS do design system define).
 */
export function temaDoGrafico(explicito?: TemaGrafico): TemaGrafico {
  if (explicito) return explicito;
  if (typeof document === 'undefined') return 'claro';
  return document.documentElement.getAttribute('data-tema') === 'escuro' ? 'escuro' : 'claro';
}

/** Superfície do tema — usada também pelo export de PNG (ver EChart.tsx). */
export function superficieDoGrafico(tema?: TemaGrafico): string {
  return PALETA_DADOS[temaDoGrafico(tema)].superficie;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · TIPOGRAFIA DOS GRÁFICOS
// ═══════════════════════════════════════════════════════════════════════════
/*
   As três famílias do manual, com os mesmos papéis que têm na página:
     Fraunces       número-herói (medidor). Nunca abaixo de 18px.
     Inter          nome próprio (loja, produto, categoria) e texto de tooltip.
     JetBrains Mono rótulo de eixo, legenda, valor, carimbo de unidade.

   LIMITAÇÃO CONHECIDA E DELIBERADA: o manual pede entreletras 0.18em em
   rótulo mono, e o renderizador canvas do ECharts não expõe letter-spacing
   (não existe em textStyle nem em rich). O registro é então sustentado pela
   família + caixa alta, que é o que o canvas permite. Falsear o espaçamento
   com espaços finos entre caracteres deixaria o texto ilegível e quebraria a
   medição do próprio ECharts — não vale o ganho.
*/
const FONTE_TITULO = "'Fraunces', 'Iowan Old Style', Georgia, serif";
const FONTE_CORPO = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const FONTE_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// ═══════════════════════════════════════════════════════════════════════════
// 3 · NÚMEROS EM pt-BR
// ═══════════════════════════════════════════════════════════════════════════
/*
   Todo número que aparece em eixo, rótulo ou tooltip passa por aqui. Vírgula
   decimal e ponto de milhar não são preferência: é o formato que o operador da
   loja lê sem traduzir.
*/
export type UnidadeGrafico = 'moeda' | 'unidades' | 'percentual';

const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtMoedaCurta = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const fmtNumero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const fmtNumeroCurto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const fmtPercent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** Valor por extenso, para tooltip e rótulo direto. */
export function formatarValor(v: number, unidade: UnidadeGrafico): string {
  if (unidade === 'moeda') return fmtMoeda.format(v);
  if (unidade === 'percentual') return `${fmtPercent.format(v)}%`;
  return `${fmtNumero.format(v)} un.`;
}

/** Valor abreviado, para marca de eixo e ponta de barra estreita. */
export function formatarValorCurto(v: number, unidade: UnidadeGrafico): string {
  if (unidade === 'moeda') return fmtMoedaCurta.format(v);
  if (unidade === 'percentual') return `${fmtPercent.format(v)}%`;
  return fmtNumeroCurto.format(v);
}

/** Carimbo da unidade no nome do eixo — em mono, caixa alta, como rótulo. */
const carimboUnidade = (unidade: UnidadeGrafico) =>
  unidade === 'moeda' ? 'R$' : unidade === 'percentual' ? '%' : 'UN.';

/**
 * Quando o chamador não diz a unidade, ela é inferida da forma do dado:
 * contagem é sempre inteira e pequena; faturamento tem centavos ou passa de
 * mil. A inferência é conservadora e o chamador pode sobrescrever com
 * `{ unidade }` — a página sabe o que está medindo melhor do que o dado.
 */
function inferirUnidade(valores: number[]): UnidadeGrafico {
  if (!valores.length) return 'unidades';
  const soInteiros = valores.every((v) => Number.isInteger(v));
  const maximo = Math.max(...valores.map(Math.abs));
  return soInteiros && maximo < 1000 ? 'unidades' : 'moeda';
}

/** Data ISO → dd/mm. O eixo de tempo brasileiro começa pelo dia. */
function diaMes(iso: string): string {
  const [, mes, dia] = iso.split('-');
  return dia && mes ? `${dia}/${mes}` : iso;
}

/** Data ISO → dd/mm/aaaa, para o cabeçalho do tooltip. */
function dataPorExtenso(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

/**
 * Corta rótulo comprido com reticências. Rótulo cortado pela borda do gráfico
 * é um dos pecados que este arquivo persegue: melhor cortar de propósito, com
 * reticência visível, e deixar o nome inteiro no tooltip.
 */
function encurtar(texto: string, limite: number): string {
  return texto.length > limite ? `${texto.slice(0, limite - 1)}…` : texto;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · PEÇAS COMUNS (eixo, grade, tooltip)
// ═══════════════════════════════════════════════════════════════════════════

export interface OpcoesGrafico {
  /** Força um tema em vez de ler o `data-tema` do documento. */
  tema?: TemaGrafico;
  /** Unidade do valor. Sem isso, é inferida da forma do dado. */
  unidade?: UnidadeGrafico;
  /** Quantas barras antes de agregar a cauda em "Outros". */
  maxCategorias?: number;
}

const paleta = (opcoes?: OpcoesGrafico) => PALETA_DADOS[temaDoGrafico(opcoes?.tema)];

/**
 * Caixa do tooltip: superfície do tema, filete de 1px, canto reto.
 * Superfície é papel, não vidro — por isso sem sombra difusa e sem raio.
 */
const caixaTooltip = (p: PaletaDeTema) => ({
  backgroundColor: p.superficie,
  borderColor: p.fileteOuro,
  borderWidth: 1,
  borderRadius: 0,
  padding: [10, 12] as [number, number],
  extraCssText: 'box-shadow:none;',
  textStyle: { color: p.tinta, fontFamily: FONTE_CORPO, fontSize: 12 },
});

/** Linha de tooltip: nome em Inter, valor em mono — dado é mono, sempre. */
const linhaTooltip = (p: PaletaDeTema, nome: string, valor: string, cor?: string) =>
  `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">` +
  (cor ? `<i style="width:9px;height:9px;background:${cor};display:inline-block;flex:0 0 auto"></i>` : '') +
  `<span style="font-family:${FONTE_CORPO};color:${p.tintaSuave}">${nome}</span>` +
  `<b style="margin-left:auto;font-family:${FONTE_MONO};color:${p.tinta}">${valor}</b>` +
  `</div>`;

/** Cabeçalho do tooltip em mono caixa alta — é rótulo, não texto corrido. */
const tituloTooltip = (p: PaletaDeTema, texto: string) =>
  `<div style="font-family:${FONTE_MONO};font-size:10px;text-transform:uppercase;color:${p.tintaSuave}">${texto}</div>`;

/** Eixo de categoria: rótulo em mono caixa alta, sem marca de escala. */
function eixoCategoria(
  p: PaletaDeTema,
  data: string[],
  cfg: { rotate?: number; limite?: number; inverse?: boolean } = {},
) {
  const limite = cfg.limite ?? 18;
  return {
    type: 'category' as const,
    data,
    inverse: cfg.inverse,
    axisLabel: {
      color: p.tintaSuave,
      fontFamily: FONTE_MONO,
      fontSize: 10,
      interval: 0,
      rotate: cfg.rotate ?? 0,
      hideOverlap: true,
      formatter: (v: string) => encurtar(String(v).toUpperCase(), limite),
    },
    axisLine: { lineStyle: { color: p.filete } },
    axisTick: { show: false },
    splitLine: { show: false },
  };
}

/** Eixo de valor: filete fino sólido (nunca tracejado) e unidade carimbada. */
function eixoValor(p: PaletaDeTema, unidade: UnidadeGrafico) {
  return {
    type: 'value' as const,
    name: carimboUnidade(unidade),
    nameLocation: 'end' as const,
    nameGap: 12,
    nameTextStyle: { color: p.tintaSuave, fontFamily: FONTE_MONO, fontSize: 9, align: 'right' as const },
    axisLabel: {
      color: p.tintaSuave,
      fontFamily: FONTE_MONO,
      fontSize: 10,
      formatter: (v: number) => formatarValorCurto(v, unidade),
    },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: p.filete, width: 1, type: 'solid' as const } },
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Mistura uma cor com transparência — o trilho do medidor sai do mesmo tom. */
const comAlfa = (hex: string, alfa: number) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
};

/**
 * Ponte com o vocabulário antigo: as páginas ainda passam os hexadecimais do
 * tema macOS anterior para escolher a cor de um gráfico. Em vez de quebrar as
 * chamadas (ou de deixar azul-genérico vazando na interface), o hex antigo é
 * traduzido para o slot NANOFLOW de mesma INTENÇÃO. O chamador continua
 * dizendo "esta série é a roxa"; quem decide o que é "roxo" é este arquivo.
 */
const PONTE_CORES: Record<string, (p: PaletaDeTema) => string> = {
  '#4f8cff': (p) => p.categorica[1], // azul  → azul-petróleo
  '#38bdf8': (p) => p.categorica[1], // ciano → azul-petróleo
  '#a78bfa': (p) => p.categorica[2], // roxo  → ametista
  '#36c98f': (p) => p.estado.bom, // verde   → estado saudável
  '#f5b73d': (p) => p.estado.atencao, // âmbar → estado de atenção
  '#f06363': (p) => p.estado.critico, // vermelho → estado crítico
  '#fb7185': (p) => p.categorica[5], // rosa  → vinho
};

/** Resolve a cor pedida pelo chamador dentro da paleta do tema em vigor. */
function corDaSerie(p: PaletaDeTema, pedida: string | undefined, padrao: string): string {
  if (!pedida) return padrao;
  const ponte = PONTE_CORES[pedida.toLowerCase()];
  if (ponte) return ponte(p);
  // Hex fora do vocabulário conhecido: cai no padrão do tema em vez de furar a
  // paleta validada. Cor de dado não é escolha livre do chamador.
  return /^#[0-9a-f]{3,8}$/i.test(pedida) ? padrao : pedida;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · MEDIDOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Medidor de um valor contra um limite. Número em Fraunces (número-herói do
 * manual, 30px — bem acima do piso de 18px), rótulo em mono caixa alta.
 * O trilho é o próprio tom do preenchimento a 16% — estado lido no arco
 * inteiro, não só na parte cheia.
 */
export function gaugeOption(
  value: number,
  max: number,
  name: string,
  color?: string,
  unit = '',
  opcoes?: OpcoesGrafico,
): EChartsOption {
  const p = paleta(opcoes);
  const cor = corDaSerie(p, color, p.categorica[0]);
  return {
    tooltip: {
      ...caixaTooltip(p),
      formatter: () =>
        tituloTooltip(p, name) +
        linhaTooltip(p, 'Valor', `${fmtNumero.format(round(value))}${unit}`, cor) +
        linhaTooltip(p, 'Escala', `0 – ${fmtNumeroCurto.format(max)}${unit}`),
    },
    series: [
      {
        type: 'gauge',
        min: 0,
        max,
        radius: '95%',
        progress: { show: true, width: 12, itemStyle: { color: cor } },
        axisLine: { lineStyle: { width: 12, color: [[1, comAlfa(cor, 0.16)]] } },
        // Só as pontas da escala: o leitor precisa do limite, não de 5 marcas.
        splitNumber: 1,
        axisLabel: {
          show: true,
          distance: -30,
          color: p.tintaSuave,
          fontFamily: FONTE_MONO,
          fontSize: 9,
          formatter: (v: number) => `${fmtNumeroCurto.format(v)}${unit}`,
        },
        axisTick: { show: false },
        splitLine: { show: false },
        pointer: { show: false },
        anchor: { show: false },
        detail: {
          valueAnimation: true,
          formatter: (v: number) => `${fmtNumero.format(round(v))}${unit}`,
          color: p.tinta,
          fontFamily: FONTE_TITULO,
          fontWeight: 400,
          fontSize: 30,
          offsetCenter: [0, '6%'],
        },
        title: {
          color: p.tintaSuave,
          fontFamily: FONTE_MONO,
          fontSize: 9,
          offsetCenter: [0, '74%'],
        },
        data: [{ value: round(value), name: name.toUpperCase() }],
      },
    ],
  } as EChartsOption;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6 · SÉRIE TEMPORAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Faturamento diário: linha de 2px, área a 12% (lavagem, não bloco saturado).
 * Uma série só → sem legenda; o título do card já diz o que está plotado.
 * O último ponto ganha rótulo direto — é ele que responde "e hoje?".
 */
export function timeSeriesOption(points: TimeseriesPoint[], opcoes?: OpcoesGrafico): EChartsOption {
  const p = paleta(opcoes);
  const cor = p.categorica[0];
  const unidade = opcoes?.unidade ?? 'moeda';
  const datas = points.map((pt) => pt.date);
  return {
    tooltip: {
      trigger: 'axis',
      ...caixaTooltip(p),
      axisPointer: { type: 'line', lineStyle: { color: p.fileteOuro, width: 1 } },
      formatter: (params: unknown) => {
        const lista = Array.isArray(params) ? params : [params];
        const primeiro = lista[0] as { dataIndex: number; value: number };
        const ponto = points[primeiro.dataIndex];
        if (!ponto) return '';
        return (
          tituloTooltip(p, dataPorExtenso(ponto.date)) +
          linhaTooltip(p, 'Faturamento', formatarValor(ponto.total, unidade), cor) +
          linhaTooltip(p, 'Vendas', `${fmtNumero.format(ponto.count)} un.`)
        );
      },
    },
    // A folga à direita é o espaço do rótulo de ponta: sem ela o último valor
    // seria escrito por cima da borda do card e cortado.
    grid: { left: 8, right: 78, top: 26, bottom: 28, containLabel: true },
    xAxis: {
      ...eixoCategoria(p, datas, { limite: 12 }),
      axisLabel: {
        color: p.tintaSuave,
        fontFamily: FONTE_MONO,
        fontSize: 10,
        hideOverlap: true,
        formatter: (v: string) => diaMes(v),
      },
      boundaryGap: false,
    },
    yAxis: eixoValor(p, unidade),
    series: [
      {
        type: 'line',
        name: 'Faturamento',
        smooth: 0.2,
        showSymbol: false,
        symbolSize: 8,
        areaStyle: { opacity: 0.12, color: cor },
        lineStyle: { color: cor, width: 2, cap: 'round', join: 'round' },
        itemStyle: { color: cor, borderColor: p.superficie, borderWidth: 2 },
        // Rótulo só na ponta: número em todo ponto vira ruído e ninguém lê.
        endLabel: {
          show: true,
          color: p.tinta,
          fontFamily: FONTE_MONO,
          fontSize: 10,
          distance: 6,
          formatter: (par: { value: number }) => formatarValorCurto(par.value, unidade),
        },
        emphasis: { focus: 'series' },
        data: points.map((pt) => pt.total),
      },
    ],
  } as EChartsOption;
}

// ═══════════════════════════════════════════════════════════════════════════
// 7 · BARRAS
// ═══════════════════════════════════════════════════════════════════════════

interface LinhaDimensao {
  label: string;
  total: number;
}

/**
 * Monta a barra ordenada horizontal com top-N + "Outros".
 * É o coração do conserto: comparar comprimento a partir de uma base comum é
 * a codificação mais precisa que existe; comparar ângulo de fatia é a pior.
 */
function barraOrdenada(
  p: PaletaDeTema,
  rows: LinhaDimensao[],
  cor: string,
  unidade: UnidadeGrafico,
  maxCategorias: number,
): EChartsOption {
  const ordenadas = [...rows].sort((a, b) => b.total - a.total);
  const visiveis = ordenadas.slice(0, maxCategorias);
  const cauda = ordenadas.slice(maxCategorias);
  const somaCauda = cauda.reduce((acc, r) => acc + r.total, 0);
  const totalGeral = ordenadas.reduce((acc, r) => acc + r.total, 0) || 1;

  // "Outros" fecha a lista e usa o tom neutro: é agregado, não é categoria.
  // A cor de recuo evita que ele compita com as barras que têm nome próprio.
  const dados = [
    ...visiveis.map((r) => ({ nome: r.label, valor: r.total, cor })),
    ...(cauda.length
      ? [{ nome: `Outros (${cauda.length} categorias)`, valor: somaCauda, cor: p.neutro }]
      : []),
  ];
  // O eixo de categoria do ECharts cresce de baixo para cima: invertido para
  // que o maior fique no topo, que é onde o olho começa a ler.
  const emOrdemDeLeitura = [...dados].reverse();

  return {
    tooltip: {
      trigger: 'item',
      ...caixaTooltip(p),
      formatter: (par: unknown) => {
        const { dataIndex } = par as { dataIndex: number };
        const d = emOrdemDeLeitura[dataIndex];
        if (!d) return '';
        return (
          tituloTooltip(p, d.nome) +
          linhaTooltip(p, 'Valor', formatarValor(d.valor, unidade), d.cor) +
          linhaTooltip(p, 'Participação', `${fmtPercent.format((d.valor / totalGeral) * 100)}%`)
        );
      },
    },
    // Sem eixo de valor: cada barra já carrega o número na ponta, então a
    // escala seria tinta repetida. `containLabel` impede corte do nome, e a
    // folga à direita é medida pelo rótulo de ponta mais largo.
    grid: { left: 4, right: 76, top: 6, bottom: 6, containLabel: true },
    xAxis: { type: 'value', show: false },
    yAxis: {
      ...eixoCategoria(
        p,
        emOrdemDeLeitura.map((d) => d.nome),
        { limite: 22 },
      ),
      axisLine: { show: false },
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 22,
        // Vão de 2px entre barras vizinhas é feito com ar, não com contorno.
        barCategoryGap: '38%',
        itemStyle: {
          color: (par: { dataIndex: number }) => emOrdemDeLeitura[par.dataIndex]?.cor ?? cor,
          borderRadius: [0, 4, 4, 0],
        },
        // Só o valor na ponta. A participação em % viria junto e dobraria a
        // largura reservada à direita, empurrando o rótulo para fora do card —
        // ela mora no tooltip, onde não disputa espaço com a barra.
        label: {
          show: true,
          position: 'right',
          distance: 8,
          color: p.tinta,
          fontFamily: FONTE_MONO,
          fontSize: 10,
          formatter: (par: { value: number }) => formatarValorCurto(par.value, unidade),
        },
        data: emOrdemDeLeitura.map((d) => d.valor),
      },
    ],
  } as EChartsOption;
}

/**
 * Valor por rótulo. Uma série só, então uma cor só: pintar cada barra de uma
 * cor diferente gastaria o canal de identidade para dizer o que o comprimento
 * já diz. A orientação é decidida aqui: com muitas categorias ou nomes longos,
 * coluna vertical obriga rótulo girado (e rótulo girado é rótulo não lido).
 */
export function barOption(
  rows: LinhaDimensao[],
  color?: string,
  opcoes?: OpcoesGrafico,
): EChartsOption {
  const p = paleta(opcoes);
  const cor = corDaSerie(p, color, p.categorica[0]);
  const unidade = opcoes?.unidade ?? inferirUnidade(rows.map((r) => r.total));
  const nomeLongo = rows.some((r) => r.label.length > 12);

  if (rows.length > 6 || nomeLongo) {
    return barraOrdenada(p, rows, cor, unidade, opcoes?.maxCategorias ?? TOP_PADRAO);
  }

  const ordenadas = [...rows].sort((a, b) => b.total - a.total);
  return {
    tooltip: {
      trigger: 'item',
      ...caixaTooltip(p),
      formatter: (par: unknown) => {
        const { dataIndex } = par as { dataIndex: number };
        const r = ordenadas[dataIndex];
        return r ? tituloTooltip(p, r.label) + linhaTooltip(p, 'Valor', formatarValor(r.total, unidade), cor) : '';
      },
    },
    grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
    xAxis: eixoCategoria(
      p,
      ordenadas.map((r) => r.label),
      { limite: 14 },
    ),
    yAxis: eixoValor(p, unidade),
    series: [
      {
        type: 'bar',
        barMaxWidth: 24,
        barCategoryGap: '42%',
        itemStyle: { color: cor, borderRadius: [4, 4, 0, 0] },
        label: {
          show: true,
          position: 'top',
          color: p.tinta,
          fontFamily: FONTE_MONO,
          fontSize: 10,
          formatter: (par: { value: number }) => formatarValorCurto(par.value, unidade),
        },
        data: ordenadas.map((r) => r.total),
      },
    ],
  } as EChartsOption;
}

// ═══════════════════════════════════════════════════════════════════════════
// 8 · PARTICIPAÇÃO (rosca OU barra ordenada — a função decide)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Participação por categoria.
 *
 * O DEFEITO QUE ISTO CONSERTA: "Formas de pagamento" chegava como rosca de 22
 * fatias. Rosca obriga a comparar ÂNGULO, que é a codificação menos precisa
 * que existe; com 22 fatias os rótulos e as linhas-guia se atropelam dos dois
 * lados, a legenda embaixo repete os mesmos 22 nomes (ruído dobrado) e nenhum
 * valor aparece. Não era problema de cor: era de forma.
 *
 * A decisão fica aqui, e não na página:
 *   até LIMIAR_ROSCA categorias  → rosca, com rótulo direto e valor em cada
 *                                   fatia, sem legenda (a legenda repetiria o
 *                                   rótulo que já está na fatia);
 *   acima disso                  → barra horizontal ordenada, top-N + "Outros"
 *                                   agregado, valor na ponta, sem legenda.
 *
 * O limiar é 3 porque no anel TODAS as fatias se encostam quando são três, e
 * três é o maior conjunto da paleta que passa no teste de todos os pares sob
 * daltonismo nos dois temas (ver a nota da paleta, no topo do arquivo).
 */
export function pieOption(rows: LinhaDimensao[], opcoes?: OpcoesGrafico): EChartsOption {
  const p = paleta(opcoes);
  // Fatia de valor zero ou negativo não tem ângulo: só suja o anel.
  const validas = rows.filter((r) => r.total > 0);
  const unidade = opcoes?.unidade ?? inferirUnidade(validas.map((r) => r.total));

  if (validas.length > LIMIAR_ROSCA) {
    return barraOrdenada(p, validas, p.categorica[0], unidade, opcoes?.maxCategorias ?? TOP_PADRAO);
  }

  const total = validas.reduce((acc, r) => acc + r.total, 0) || 1;
  return {
    color: p.categorica,
    tooltip: {
      trigger: 'item',
      ...caixaTooltip(p),
      formatter: (par: unknown) => {
        const { name, value, percent, color } = par as {
          name: string;
          value: number;
          percent: number;
          color: string;
        };
        return (
          tituloTooltip(p, name) +
          linhaTooltip(p, 'Valor', formatarValor(value, unidade), color) +
          linhaTooltip(p, 'Participação', `${fmtPercent.format(percent)}%`)
        );
      },
    },
    series: [
      {
        type: 'pie',
        radius: ['52%', '76%'],
        center: ['50%', '52%'],
        // O vão entre fatias é feito com a cor da superfície (2px), nunca com
        // contorno de outra cor: é ar separando, não tinta somando.
        itemStyle: { borderColor: p.superficie, borderWidth: 2 },
        // Rótulo direto em cada fatia dispensa a legenda: com até 3 fatias há
        // espaço de sobra e a identidade nunca depende só da cor.
        label: {
          show: true,
          alignTo: 'labelLine',
          color: p.tinta,
          fontFamily: FONTE_CORPO,
          fontSize: 12,
          lineHeight: 16,
          formatter: (par: { name: string; value: number }) =>
            `{n|${encurtar(par.name, 22)}}\n{v|${formatarValorCurto(par.value, unidade)}  ${fmtPercent.format(
              (par.value / total) * 100,
            )}%}`,
          rich: {
            n: { fontFamily: FONTE_CORPO, fontSize: 12, color: p.tinta },
            v: { fontFamily: FONTE_MONO, fontSize: 10, color: p.tintaSuave },
          },
        },
        labelLine: { length: 14, length2: 16, smooth: false, lineStyle: { color: p.filete } },
        data: validas.map((r) => ({ name: r.label, value: r.total })),
      },
    ],
  } as EChartsOption;
}

// ═══════════════════════════════════════════════════════════════════════════
// 9 · SANKEY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fluxo Categoria → Loja (e Origem → Destino nas transferências).
 *
 * Cor com significado: quem é ORIGEM recebe slot da escala categórica (até 8;
 * da nona em diante cai no tom neutro, porque gerar um nono matiz produziria
 * uma cor indistinguível das anteriores sob daltonismo). Quem é só DESTINO
 * fica no tom neutro — o destino é identificado pelo nome, e pintar os dois
 * lados dobraria a contagem de cores sem acrescentar informação.
 *
 * O rótulo da última coluna vai para a ESQUERDA do nó, senão o ECharts o
 * escreve para fora da área de desenho e ele é cortado pela borda do card.
 */
export function sankeyOption(flow: SalesFlow, opcoes?: OpcoesGrafico): EChartsOption {
  const p = paleta(opcoes);
  const unidade = opcoes?.unidade ?? inferirUnidade(flow.links.map((l) => l.value));

  const origens = new Set(flow.links.map((l) => l.source));
  const destinos = new Set(flow.links.map((l) => l.target));
  let slot = 0;

  const nos = flow.nodes.map((n) => {
    const ehOrigem = origens.has(n.name);
    const cor = ehOrigem
      ? (p.categorica[slot++] ?? p.neutro)
      : p.neutro;
    const soDestino = destinos.has(n.name) && !ehOrigem;
    return {
      name: n.name,
      itemStyle: { color: cor, borderWidth: 0 },
      label: {
        position: soDestino ? ('left' as const) : ('right' as const),
        color: p.tinta,
        fontFamily: FONTE_CORPO,
        fontSize: 11,
        formatter: (par: { name: string }) => encurtar(par.name, 20),
      },
    };
  });

  return {
    tooltip: {
      trigger: 'item',
      ...caixaTooltip(p),
      formatter: (par: unknown) => {
        const d = par as {
          dataType?: string;
          name: string;
          value: number;
          data?: { source?: string; target?: string };
        };
        if (d.dataType === 'edge' && d.data?.source) {
          return (
            tituloTooltip(p, `${d.data.source} → ${d.data.target}`) +
            linhaTooltip(p, 'Fluxo', formatarValor(d.value, unidade))
          );
        }
        return tituloTooltip(p, d.name) + linhaTooltip(p, 'Total', formatarValor(d.value, unidade));
      },
    },
    series: [
      {
        type: 'sankey',
        left: 12,
        right: 100,
        top: 10,
        bottom: 10,
        data: nos,
        links: flow.links,
        emphasis: { focus: 'adjacency' },
        lineStyle: { color: 'gradient', opacity: 0.32, curveness: 0.5 },
        itemStyle: { borderWidth: 0 },
        nodeWidth: 12,
        nodeGap: 12,
      },
    ],
  } as EChartsOption;
}

// ═══════════════════════════════════════════════════════════════════════════
// 10 · HEATMAP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Receita por loja × dia da semana.
 *
 * Magnitude contínua pede escala SEQUENCIAL de um matiz só, clara → escura —
 * nunca arco-íris. Aqui o matiz é o ouro do manual, o que faz a grade inteira
 * ler como uma peça da marca. A rampa foi validada: luminosidade monotônica,
 * degrau ≥0,06 em OKLCH e matiz único (variação de 1°). O degrau mais claro
 * fica de propósito perto do papel (1,3:1): numa escala sequencial "quase
 * zero" TEM que recuar para o fundo — esse é o comportamento correto, e a
 * leitura do valor está garantida pela régua do visualMap e pelo tooltip.
 */
export function heatmapOption(data: HeatmapData, opcoes?: OpcoesGrafico): EChartsOption {
  const p = paleta(opcoes);
  const valores = data.cells.map((c) => c[2]);
  const max = Math.max(1, ...valores);
  const unidade = opcoes?.unidade ?? inferirUnidade(valores);
  // Célula pequena não comporta número sem cortar: só rotula grade enxuta.
  const cabeRotulo = data.xLabels.length <= 8 && data.yLabels.length <= 8;

  return {
    tooltip: {
      ...caixaTooltip(p),
      position: 'top',
      formatter: (par: unknown) => {
        const { value } = par as { value: [number, number, number] };
        const [x, y, v] = value;
        return (
          tituloTooltip(p, `${data.yLabels[y] ?? ''} · ${data.xLabels[x] ?? ''}`) +
          linhaTooltip(p, 'Receita', formatarValor(v, unidade))
        );
      },
    },
    grid: { left: 8, right: 16, top: 10, bottom: 54, containLabel: true },
    xAxis: eixoCategoria(p, data.xLabels, { limite: 10 }),
    yAxis: { ...eixoCategoria(p, data.yLabels, { limite: 20 }), splitArea: { show: false } },
    visualMap: {
      min: 0,
      max,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 120,
      inRange: { color: p.sequencial },
      textStyle: { color: p.tintaSuave, fontFamily: FONTE_MONO, fontSize: 10 },
      formatter: (v: number) => formatarValorCurto(v, unidade),
    },
    series: [
      {
        type: 'heatmap',
        data: data.cells,
        label: {
          show: cabeRotulo,
          color: p.tinta,
          fontFamily: FONTE_MONO,
          fontSize: 9,
          formatter: (par: { value: [number, number, number] }) =>
            formatarValorCurto(par.value[2], unidade),
        },
        // Vão de 2px na cor da superfície: separa célula sem desenhar contorno.
        itemStyle: { borderColor: p.superficie, borderWidth: 2 },
        emphasis: { itemStyle: { borderColor: p.fileteOuro, borderWidth: 2 } },
      },
    ],
  } as EChartsOption;
}
