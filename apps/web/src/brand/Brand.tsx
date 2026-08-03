/**
 * Componentes de marca NANOFLOW: símbolo, wordmark e assinatura.
 *
 * ── Por que cada instância é um SVG autossuficiente ─────────────────────────
 * O manual monta tudo com <use href="#gO"> e fill="url(#gg)" apontando para um
 * sprite <defs> único. Em página estática isso é ótimo; num SPA, não:
 *
 *  · `url(#id)` é URL RELATIVA. O navegador resolve contra a base do documento.
 *    Com um <base href> na página — ou com engines antigas que erram a
 *    resolução quando a URL já carrega fragmento, que é exatamente o caso do
 *    HashRouter (`/#/admin/estoque`) — a referência vira `.../#gg` de outro
 *    documento e o preenchimento some. O logotipo simplesmente não pinta.
 *  · id em <defs> é global no documento. `gg`, `gO`, `gN` são curtos demais:
 *    qualquer outro SVG da página (ícone, gráfico do ECharts, favicon inline)
 *    pode declarar o mesmo id e sequestrar o gradiente da marca.
 *
 * Por isso cada componente aqui carrega seus próprios <defs>, com id derivado
 * do useId() do React (único por instância e estável entre servidor e cliente).
 * A referência continua sendo `url(#...)`, mas aponta para dentro do MESMO
 * <svg> que a usa — não há dependência de sprite montado, de ordem de
 * renderização nem de rota. Montar <BrandDefs /> segue valendo a pena para o
 * CSS e para SVGs escritos à mão, mas não é pré-requisito destes componentes.
 *
 * Os paths vêm de BrandDefs.tsx, que os copiou do manual sem alterar um número.
 */
import { useId } from 'react';
import type { CSSProperties } from 'react';
import {
  CORES_MARCA,
  GRADIENTE_DIAGONAL,
  GRADIENTE_HORIZONTAL,
  MARK_LINE_D,
  MARK_LINE_STROKE,
  MARK_SOLID_D,
  MARK_VIEWBOX,
  MIN_MARK_CAIXA_PX,
  MIN_MARK_PX,
  MIN_SIGNATURE_PX,
  MIN_WORDMARK_PX,
  SIGNATURE_ALTURA_UN,
  SIGNATURE_LARGURA_UN,
  SIGNATURE_VIEWBOX,
  SIGNATURE_WORDMARK_X,
  WORDMARK_ALTURA_UN,
  WORDMARK_FLOW,
  WORDMARK_LARGURA_UN,
  WORDMARK_NANO,
  WORDMARK_VIEWBOX,
} from './BrandDefs';
import type { GlifoPosicionado } from './BrandDefs';

export { BrandDefs, CORES_MARCA } from './BrandDefs';

// ─── Vocabulário de cor ─────────────────────────────────────────────────────

/** Tratamento cromático do símbolo isolado. */
export type MarkTone = 'ouro' | 'preto' | 'branco';

/** Cheio (padrão) ou contorno fino, este só para grandes formatos. */
export type MarkVariant = 'solid' | 'line';

/**
 * Os quatro tratamentos do wordmark previstos no manual (seção 02).
 * `ouro-sobre-*` é a versão principal, bicolor: NANO na tinta da superfície e
 * FLOW no gradiente dourado. `preto` e `branco` são as monocromáticas.
 */
export type WordmarkTone = 'ouro-sobre-claro' | 'ouro-sobre-escuro' | 'preto' | 'branco';

const NOME_DA_MARCA = 'NANOFLOW';

// ─── Piso de legibilidade ───────────────────────────────────────────────────

/**
 * O Vite injeta `import.meta.env.DEV`, mas o TIPO de ImportMetaEnv mora em
 * src/vite-env.d.ts, que enumera só as chaves VITE_* do projeto. Ler por índice
 * deixa este arquivo compilar sem exigir alteração lá — e o Vite continua
 * trocando `import.meta.env` por um objeto literal no build, então a comparação
 * vira constante e os avisos abaixo somem da versão de produção.
 */
const EM_DESENVOLVIMENTO = (import.meta.env as unknown as { DEV?: boolean }).DEV === true;

// StrictMode renderiza duas vezes em desenvolvimento; sem memória o mesmo aviso
// sairia duplicado e o console viraria ruído que ninguém lê.
const avisosEmitidos = new Set<string>();

/**
 * Aplica o tamanho mínimo do manual como PISO — nunca renderiza abaixo dele.
 * Reduzir a marca é decisão de quem chama, e uma marca ilegível é um defeito
 * silencioso: em vez de obedecer, o componente sobe para o mínimo e avisa em
 * desenvolvimento, para o erro aparecer antes de ir para produção.
 */
function aplicarPiso(
  componente: string,
  medida: string,
  pedido: number,
  piso: number,
  regraDoManual: string,
): number {
  if (Number.isFinite(pedido) && pedido >= piso) return pedido;
  if (EM_DESENVOLVIMENTO) {
    const chave = `${componente}:${pedido}`;
    if (!avisosEmitidos.has(chave)) {
      avisosEmitidos.add(chave);
      console.warn(
        `[marca NANOFLOW] <${componente} ${medida}={${pedido}} /> fica abaixo do mínimo ` +
          `do manual (${regraDoManual}). Renderizando com ${piso}px. ` +
          `Se o espaço não comporta a marca, use outro elemento — não a marca menor.`,
      );
    }
  }
  return piso;
}

// ─── Acessibilidade ─────────────────────────────────────────────────────────

type PropsAcessibilidade = {
  role?: 'img';
  'aria-label'?: string;
  'aria-hidden'?: true;
  focusable: 'false';
};

/**
 * `decorative` existe para o caso em que a marca aparece colada ao nome escrito
 * ("[símbolo] Nova Ótica"): sem ele o leitor de tela anunciaria a marca duas
 * vezes. Fora desse caso o logotipo é conteúdo, não enfeite, e precisa de nome.
 * `focusable="false"` é sempre necessário porque motores legados colocam SVG na
 * ordem de tabulação e criam uma parada de teclado invisível.
 */
function acessibilidade(decorativo: boolean, rotulo: string): PropsAcessibilidade {
  return decorativo
    ? { 'aria-hidden': true, focusable: 'false' }
    : { role: 'img', 'aria-label': rotulo, focusable: 'false' };
}

/** useId() devolve algo como ":r3:" — os dois-pontos não podem entrar num id de SVG. */
function idLimpo(bruto: string): string {
  return bruto.replace(/[^a-zA-Z0-9]/g, '');
}

// ─── Peças internas ─────────────────────────────────────────────────────────

function GradienteDiagonal({ id }: { id: string }) {
  return (
    <linearGradient
      id={id}
      x1={GRADIENTE_DIAGONAL.x1}
      y1={GRADIENTE_DIAGONAL.y1}
      x2={GRADIENTE_DIAGONAL.x2}
      y2={GRADIENTE_DIAGONAL.y2}
    >
      {GRADIENTE_DIAGONAL.paradas.map((p) => (
        <stop key={p.offset} offset={p.offset} stopColor={p.cor} />
      ))}
    </linearGradient>
  );
}

function GradienteHorizontal({ id }: { id: string }) {
  return (
    <linearGradient
      id={id}
      x1={GRADIENTE_HORIZONTAL.x1}
      y1={GRADIENTE_HORIZONTAL.y1}
      x2={GRADIENTE_HORIZONTAL.x2}
      y2={GRADIENTE_HORIZONTAL.y2}
    >
      {GRADIENTE_HORIZONTAL.paradas.map((p) => (
        <stop key={p.offset} offset={p.offset} stopColor={p.cor} />
      ))}
    </linearGradient>
  );
}

/** fill-rule evenodd é obrigatório: o "A" e o "O" têm contraforma. */
function Glifos({ glifos, fill }: { glifos: readonly GlifoPosicionado[]; fill: string }) {
  return (
    <g fill={fill} fillRule="evenodd">
      {glifos.map((g, i) => (
        <path key={i} d={g.d} transform={g.x === 0 ? undefined : `translate(${g.x} 0)`} />
      ))}
    </g>
  );
}

/** Desenho do símbolo, sem <svg> em volta — reaproveitado pela assinatura. */
function DesenhoSimbolo({ variant, pintura }: { variant: MarkVariant; pintura: string }) {
  if (variant === 'line') {
    return (
      <path
        d={MARK_LINE_D}
        fill="none"
        stroke={pintura}
        strokeWidth={MARK_LINE_STROKE}
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
    );
  }
  return <path d={MARK_SOLID_D} fill={pintura} fillRule="evenodd" />;
}

/** Tinta do bloco NANO conforme a superfície; FLOW é sempre o gradiente. */
function tintaNano(tone: WordmarkTone): string {
  switch (tone) {
    case 'ouro-sobre-claro':
      return CORES_MARCA.tinta;
    case 'ouro-sobre-escuro':
      return CORES_MARCA.branco;
    case 'preto':
      return CORES_MARCA.preto;
    case 'branco':
      return CORES_MARCA.branco;
  }
}

const toneEhBicolor = (tone: WordmarkTone) =>
  tone === 'ouro-sobre-claro' || tone === 'ouro-sobre-escuro';

// ─── <Mark /> ───────────────────────────────────────────────────────────────

export interface MarkProps {
  /**
   * Lado da caixa, em px. Padrão 24. Piso 18px: a caixa carrega 4 un. de folga
   * por lado (como o manual desenha), então 18px de caixa é o que entrega os
   * 16px de símbolo exigidos.
   */
  size?: number;
  /** `solid` (padrão) ou `line`, o contorno fino reservado a grandes formatos. */
  variant?: MarkVariant;
  /** `ouro` (padrão, gradiente diagonal), `preto` ou `branco`. */
  tone?: MarkTone;
  /** Marque quando o nome da marca já estiver escrito ao lado, em texto. */
  decorative?: boolean;
  /** Nome acessível. Padrão "NANOFLOW". */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** O símbolo da marca: quadrado 100×100 com anel de 10 — a mesma forma da letra O. */
export function Mark({
  size = 24,
  variant = 'solid',
  tone = 'ouro',
  decorative = false,
  label = NOME_DA_MARCA,
  className,
  style,
}: MarkProps) {
  const uid = idLimpo(useId());
  const idGradiente = `nf-mark-gg-${uid}`;
  const lado = aplicarPiso('Mark', 'size', size, MIN_MARK_CAIXA_PX, `símbolo ${MIN_MARK_PX}px`);

  const pintura =
    tone === 'ouro'
      ? `url(#${idGradiente})`
      : tone === 'preto'
        ? CORES_MARCA.preto
        : CORES_MARCA.branco;

  return (
    <svg
      width={lado}
      height={lado}
      viewBox={MARK_VIEWBOX}
      className={className}
      style={style}
      {...acessibilidade(decorative, label)}
    >
      {tone === 'ouro' && (
        <defs>
          <GradienteDiagonal id={idGradiente} />
        </defs>
      )}
      <DesenhoSimbolo variant={variant} pintura={pintura} />
    </svg>
  );
}

// ─── <Wordmark /> ───────────────────────────────────────────────────────────

export interface WordmarkProps {
  /** Largura em px. Padrão 180. Piso 130px (mínimo do manual). */
  width?: number;
  /** Padrão `ouro-sobre-claro`, que é a superfície padrão do produto. */
  tone?: WordmarkTone;
  decorative?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** O wordmark montado: NANO na tinta da superfície, FLOW no gradiente dourado. */
export function Wordmark({
  width = 180,
  tone = 'ouro-sobre-claro',
  decorative = false,
  label = NOME_DA_MARCA,
  className,
  style,
}: WordmarkProps) {
  const uid = idLimpo(useId());
  const idGradiente = `nf-wm-gg2-${uid}`;
  const largura = aplicarPiso('Wordmark', 'width', width, MIN_WORDMARK_PX, `wordmark ${MIN_WORDMARK_PX}px`);
  const altura = (largura * WORDMARK_ALTURA_UN) / WORDMARK_LARGURA_UN;

  const bicolor = toneEhBicolor(tone);
  const nano = tintaNano(tone);
  const flow = bicolor ? `url(#${idGradiente})` : nano;

  return (
    <svg
      width={largura}
      height={altura}
      viewBox={WORDMARK_VIEWBOX}
      className={className}
      style={style}
      {...acessibilidade(decorative, label)}
    >
      {bicolor && (
        <defs>
          <GradienteHorizontal id={idGradiente} />
        </defs>
      )}
      <Glifos glifos={WORDMARK_NANO} fill={nano} />
      <Glifos glifos={WORDMARK_FLOW} fill={flow} />
    </svg>
  );
}

// ─── <Signature /> ──────────────────────────────────────────────────────────

/**
 * Só existe a horizontal: "A assinatura é sempre horizontal — símbolo à
 * esquerda, wordmark à direita" (manual, seção 02). O tipo é uma união de um
 * valor só justamente para que ninguém invente uma vertical sem passar pelo
 * manual antes.
 */
const LAYOUT_ASSINATURA = {
  horizontal: {
    viewBox: SIGNATURE_VIEWBOX,
    razaoAltura: SIGNATURE_ALTURA_UN / SIGNATURE_LARGURA_UN,
  },
} as const;

export interface SignatureProps {
  orientation?: keyof typeof LAYOUT_ASSINATURA;
  /**
   * Largura total em px, respiro incluído. Padrão 240. Piso 164px: é a largura
   * em que tanto o wordmark (130px) quanto o símbolo (16px) atingem o mínimo.
   */
  width?: number;
  /** Segue o vocabulário do wordmark; o símbolo acompanha automaticamente. */
  tone?: WordmarkTone;
  decorative?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Assinatura horizontal: símbolo + wordmark com a área de respiro do manual
 * (30 un. = 3 hastes) entre as duas peças e nas quatro bordas.
 *
 * O respiro está DENTRO do viewBox de propósito. Se dependesse de margem CSS,
 * a primeira tela apertada comeria o respiro e ninguém perceberia; embutido na
 * geometria, ele escala junto com a marca e não tem como ser removido.
 */
export function Signature({
  orientation = 'horizontal',
  width = 240,
  tone = 'ouro-sobre-claro',
  decorative = false,
  label = NOME_DA_MARCA,
  className,
  style,
}: SignatureProps) {
  const uid = idLimpo(useId());
  const idDiagonal = `nf-sig-gg-${uid}`;
  const idHorizontal = `nf-sig-gg2-${uid}`;

  const layout = LAYOUT_ASSINATURA[orientation];
  const largura = aplicarPiso(
    'Signature',
    'width',
    width,
    MIN_SIGNATURE_PX,
    `wordmark ${MIN_WORDMARK_PX}px e símbolo ${MIN_MARK_PX}px`,
  );
  const altura = largura * layout.razaoAltura;

  const bicolor = toneEhBicolor(tone);
  const nano = tintaNano(tone);
  const flow = bicolor ? `url(#${idHorizontal})` : nano;
  // Na versão bicolor o símbolo é sempre dourado; nas monocromáticas ele
  // acompanha a tinta do wordmark, como nos lockups do manual.
  const pinturaSimbolo = bicolor ? `url(#${idDiagonal})` : nano;

  return (
    <svg
      width={largura}
      height={altura}
      viewBox={layout.viewBox}
      className={className}
      style={style}
      {...acessibilidade(decorative, label)}
    >
      {bicolor && (
        <defs>
          <GradienteDiagonal id={idDiagonal} />
          <GradienteHorizontal id={idHorizontal} />
        </defs>
      )}
      <DesenhoSimbolo variant="solid" pintura={pinturaSimbolo} />
      <g transform={`translate(${SIGNATURE_WORDMARK_X} 0)`}>
        <Glifos glifos={WORDMARK_NANO} fill={nano} />
        <Glifos glifos={WORDMARK_FLOW} fill={flow} />
      </g>
    </svg>
  );
}
