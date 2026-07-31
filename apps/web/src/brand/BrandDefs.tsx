/**
 * Definições canônicas da marca NANOFLOW.
 *
 * Tudo o que está aqui foi COPIADO de docs/marca/nanoflow-manual.html sem alterar
 * um número: os paths são o desenho da marca, não sugestão. Se algo precisar mudar,
 * muda no manual primeiro e só depois aqui.
 *
 * Este módulo tem dois papéis:
 *
 *  1. É a fonte única das constantes geométricas (paths, viewBox, avanços do
 *     wordmark, mínimos legíveis). Brand.tsx importa daqui — nenhum path é
 *     redigitado em outro arquivo.
 *
 *  2. Exporta <BrandDefs />, o sprite SVG com <defs> (gradientes + símbolo +
 *     alfabeto) para ser montado UMA VEZ no topo da árvore. Ele existe para quem
 *     precisa referenciar a marca de fora do React: `fill: url(#nf-gg)` no CSS,
 *     `<use href="#nf-markSolid">` em SVG solto, máscara, etc.
 *
 *     ATENÇÃO: os componentes de Brand.tsx NÃO dependem do sprite (ver a nota
 *     sobre HashRouter mais abaixo). Montar <BrandDefs /> é opcional e serve aos
 *     consumidores de CSS/<use>; esquecer de montá-lo nunca quebra um logotipo.
 */
import type { CSSProperties } from 'react';

// ─── Paleta (manual · seção 03) ─────────────────────────────────────────────

export const CORES_MARCA = {
  preto: '#0D0B08',
  carvao: '#17140F',
  grafite: '#221D15',
  branco: '#F6F2E9',
  branco2: '#E4DCC9',
  ouro: '#C9A227',
  ouroLux: '#F0D482',
  ouroDark: '#8A6914',
  tinta: '#2A2416',
  tintaSuave: '#5C543E',
} as const;

// ─── Gradientes (manual · <defs> #gg e #gg2) ────────────────────────────────

/** Diagonal (0,0 → 100%,100%). Usado no símbolo. */
export const GRADIENTE_DIAGONAL = {
  x1: '0%',
  y1: '0%',
  x2: '100%',
  y2: '100%',
  paradas: [
    { offset: '0%', cor: CORES_MARCA.ouroLux },
    { offset: '55%', cor: CORES_MARCA.ouro },
    { offset: '100%', cor: CORES_MARCA.ouroDark },
  ],
} as const;

/** Horizontal (0,0 → 100%,0). Usado no bloco FLOW do wordmark. */
export const GRADIENTE_HORIZONTAL = {
  x1: '0%',
  y1: '0%',
  x2: '100%',
  y2: '0%',
  paradas: [
    { offset: '0%', cor: CORES_MARCA.ouroLux },
    { offset: '100%', cor: CORES_MARCA.ouro },
  ],
} as const;

// ─── Símbolo (manual · #markSolid e #markLine) ──────────────────────────────

/** Símbolo cheio: quadrado 100×100 com anel de 10 — idêntico à letra O. */
export const MARK_SOLID_D =
  'M50,0 L100,0 L100,50 A50,50 0 0,1 50,100 L0,100 L0,50 A50,50 0 0,1 50,0 Z ' +
  'M50,10 L90,10 L90,50 A40,40 0 0,1 50,90 L10,90 L10,50 A40,40 0 0,1 50,10 Z';

/** Contorno do símbolo, para a variante fina de grandes formatos. */
export const MARK_LINE_D =
  'M50,0 L100,0 L100,50 A50,50 0 0,1 50,100 L0,100 L0,50 A50,50 0 0,1 50,0 Z';

// ─── Alfabeto customizado (manual · #gN #gA #gO #gF #gL #gW) ────────────────
// Topo y=0 · base y=100 · haste 10 · proporção alargada.

export const GLIFO_N_D = 'M0,0 L10,0 L90,86 L90,0 L100,0 L100,100 L90,100 L10,14 L10,100 L0,100 Z';

export const GLIFO_A_D =
  'M0,100 L36,0 L64,0 L100,100 L89,100 L80.4,76 L19.6,76 L11,100 Z ' +
  'M43.4,10 L56.6,10 L76.8,66 L23.2,66 Z';

export const GLIFO_O_D =
  'M50,0 L100,0 L100,50 A50,50 0 0,1 50,100 L0,100 L0,50 A50,50 0 0,1 50,0 Z ' +
  'M50,10 L90,10 L90,50 A40,40 0 0,1 50,90 L10,90 L10,50 A40,40 0 0,1 50,10 Z';

export const GLIFO_F_D = 'M0,0 L80,0 L80,10 L10,10 L10,45 L62,45 L62,55 L10,55 L10,100 L0,100 Z';

export const GLIFO_L_D = 'M0,0 L10,0 L10,90 L72,90 L72,100 L0,100 Z';

export const GLIFO_W_D =
  'M0,0 L10.5,0 L37.25,83.6 L64,0 L74.5,0 L101.25,83.6 L128,0 L138.5,0 ' +
  'L106.5,100 L96,100 L69.25,16.4 L42.5,100 L32,100 Z';

// ─── Montagem do wordmark (manual · #wm-mono) ───────────────────────────────

export type GlifoPosicionado = { readonly d: string; readonly x: number };

/** N-A-N-O: recebe tinta ou branco conforme a superfície. */
export const WORDMARK_NANO: readonly GlifoPosicionado[] = [
  { d: GLIFO_N_D, x: 0 },
  { d: GLIFO_A_D, x: 106 },
  { d: GLIFO_N_D, x: 212 },
  { d: GLIFO_O_D, x: 322 },
];

/** F-L-O-W: recebe o gradiente dourado horizontal na versão colorida. */
export const WORDMARK_FLOW: readonly GlifoPosicionado[] = [
  { d: GLIFO_F_D, x: 432 },
  { d: GLIFO_L_D, x: 514 },
  { d: GLIFO_O_D, x: 590 },
  { d: GLIFO_W_D, x: 694 },
];

// ─── Geometria e mínimos (manual · seção 01, tabela de especificações) ──────

/** Lado do símbolo no sistema de 100 unidades (altura de caixa alta). */
export const MARK_UN = 100;

/**
 * Folga de 4 unidades por lado dentro do viewBox do símbolo. É o que o manual
 * aplica em todas as aplicações (`-4 -4 108 108`) e é o que dá espaço para o
 * traço da variante fina, que fica centrado na linha e vaza 2,5 un. para fora.
 */
export const MARK_FOLGA_UN = 4;
export const MARK_VIEWBOX = '-4 -4 108 108';
export const MARK_CAIXA_UN = MARK_UN + MARK_FOLGA_UN * 2; // 108

/** Espessura do traço da variante fina ("Símbolo · fino, grandes formatos"). */
export const MARK_LINE_STROKE = 5;

export const WORDMARK_VIEWBOX = '0 0 833 100';
export const WORDMARK_LARGURA_UN = 833;
export const WORDMARK_ALTURA_UN = 100;

/** Área de respiro: 30 unidades = 3 hastes. */
export const RESPIRO_UN = 30;

/** Mínimo do wordmark: 130 px / 38 mm. */
export const MIN_WORDMARK_PX = 130;

/** Mínimo do símbolo: 16 px / 6 mm — medido no símbolo, não na caixa. */
export const MIN_MARK_PX = 16;

/**
 * Piso da prop `size` do <Mark />. `size` é o lado da CAIXA (inclui a folga de
 * 4 un. por lado); o símbolo desenhado ocupa 100/108 dela. Para o símbolo sair
 * com os 16px que o manual exige, a caixa precisa de 17,28px — arredondado
 * para 18. Sem essa conversão, um `size={16}` entregaria 14,8px de símbolo e
 * violaria o mínimo silenciosamente.
 */
export const MIN_MARK_CAIXA_PX = Math.ceil((MIN_MARK_PX * MARK_CAIXA_UN) / MARK_UN); // 18

// ─── Assinatura horizontal ──────────────────────────────────────────────────
// Símbolo (100) + respiro (30) + wordmark (833), com 30 un. de respiro em volta.

export const SIGNATURE_WORDMARK_X = MARK_UN + RESPIRO_UN; // 130
export const SIGNATURE_CONTEUDO_UN = SIGNATURE_WORDMARK_X + WORDMARK_LARGURA_UN; // 963
export const SIGNATURE_LARGURA_UN = SIGNATURE_CONTEUDO_UN + RESPIRO_UN * 2; // 1023
export const SIGNATURE_ALTURA_UN = WORDMARK_ALTURA_UN + RESPIRO_UN * 2; // 160
export const SIGNATURE_VIEWBOX = `${-RESPIRO_UN} ${-RESPIRO_UN} ${SIGNATURE_LARGURA_UN} ${SIGNATURE_ALTURA_UN}`;

/**
 * Piso da largura da assinatura. Os dois mínimos do manual convivem dentro do
 * mesmo desenho, então vale o mais exigente dos dois: o wordmark pede 160px de
 * assinatura, o símbolo pede 164px. Fica 164.
 */
export const MIN_SIGNATURE_PX = Math.ceil(
  Math.max(
    (MIN_WORDMARK_PX * SIGNATURE_LARGURA_UN) / WORDMARK_LARGURA_UN,
    (MIN_MARK_PX * SIGNATURE_LARGURA_UN) / MARK_UN,
  ),
); // 164

// ─── Sprite ─────────────────────────────────────────────────────────────────

/**
 * Ids do sprite. Prefixo `nf-` de propósito: o manual usa ids curtos (`gg`,
 * `gO`) que colidiriam com qualquer outro SVG da página. Colisão de id em
 * <defs> não dá erro — dá logotipo pintado com o gradiente errado, que é bem
 * pior de diagnosticar.
 */
export const BRAND_DEFS_IDS = {
  gradienteDiagonal: 'nf-gg',
  gradienteHorizontal: 'nf-gg2',
  markSolid: 'nf-markSolid',
  markLine: 'nf-markLine',
  glifoN: 'nf-gN',
  glifoA: 'nf-gA',
  glifoO: 'nf-gO',
  glifoF: 'nf-gF',
  glifoL: 'nf-gL',
  glifoW: 'nf-gW',
  wordmarkMono: 'nf-wm-mono',
} as const;

/**
 * O sprite não pode ser `display:none`: navegador nenhum garante resolver
 * <use> apontando para dentro de uma subárvore removida do fluxo. Tira-se do
 * layout com posição absoluta e tamanho zero, que é o que o manual faz.
 */
const ESTILO_SPRITE: CSSProperties = {
  position: 'absolute',
  width: 0,
  height: 0,
  overflow: 'hidden',
};

const TODOS_GLIFOS: ReadonlyArray<readonly [string, string]> = [
  [BRAND_DEFS_IDS.glifoN, GLIFO_N_D],
  [BRAND_DEFS_IDS.glifoA, GLIFO_A_D],
  [BRAND_DEFS_IDS.glifoO, GLIFO_O_D],
  [BRAND_DEFS_IDS.glifoF, GLIFO_F_D],
  [BRAND_DEFS_IDS.glifoL, GLIFO_L_D],
  [BRAND_DEFS_IDS.glifoW, GLIFO_W_D],
];

const WORDMARK_COMPLETO: readonly GlifoPosicionado[] = [...WORDMARK_NANO, ...WORDMARK_FLOW];

const ID_POR_GLIFO = new Map<string, string>(TODOS_GLIFOS.map(([id, d]) => [d, id]));

/**
 * Injeta uma única vez, no topo da árvore, os <defs> da marca.
 *
 * Uso (main.tsx ou App.tsx, antes de qualquer conteúdo):
 *   <BrandDefs />
 *
 * Depois disso, CSS pode escrever `fill: url(#nf-gg)` e qualquer SVG pode
 * escrever `<use href="#nf-markSolid" />`.
 */
export function BrandDefs() {
  return (
    <svg width={0} height={0} style={ESTILO_SPRITE} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient
          id={BRAND_DEFS_IDS.gradienteDiagonal}
          x1={GRADIENTE_DIAGONAL.x1}
          y1={GRADIENTE_DIAGONAL.y1}
          x2={GRADIENTE_DIAGONAL.x2}
          y2={GRADIENTE_DIAGONAL.y2}
        >
          {GRADIENTE_DIAGONAL.paradas.map((p) => (
            <stop key={p.offset} offset={p.offset} stopColor={p.cor} />
          ))}
        </linearGradient>

        <linearGradient
          id={BRAND_DEFS_IDS.gradienteHorizontal}
          x1={GRADIENTE_HORIZONTAL.x1}
          y1={GRADIENTE_HORIZONTAL.y1}
          x2={GRADIENTE_HORIZONTAL.x2}
          y2={GRADIENTE_HORIZONTAL.y2}
        >
          {GRADIENTE_HORIZONTAL.paradas.map((p) => (
            <stop key={p.offset} offset={p.offset} stopColor={p.cor} />
          ))}
        </linearGradient>

        <path id={BRAND_DEFS_IDS.markSolid} d={MARK_SOLID_D} />
        <path id={BRAND_DEFS_IDS.markLine} d={MARK_LINE_D} />

        {TODOS_GLIFOS.map(([id, d]) => (
          <path key={id} id={id} d={d} />
        ))}

        <g id={BRAND_DEFS_IDS.wordmarkMono} fillRule="evenodd">
          {WORDMARK_COMPLETO.map((g, i) => (
            <use key={i} href={`#${ID_POR_GLIFO.get(g.d)}`} x={g.x} />
          ))}
        </g>
      </defs>
    </svg>
  );
}
