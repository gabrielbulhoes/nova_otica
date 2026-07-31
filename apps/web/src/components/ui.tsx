import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { CoverageLevel } from '../api/client';
import { toCsv, downloadCsv, type CsvColumn } from '../bi/csv';
import { Icon, type IconName } from '../brand/Icon';

/**
 * Primitivas compartilhadas pelas 20 telas do console, no vocabulário NANOFLOW.
 *
 * Este arquivo é o único ponto onde a hierarquia de ação e o significado
 * operacional são decididos: o que estiver errado aqui se repete vinte vezes.
 * Por isso três regras estão embutidas nos componentes, não deixadas a critério
 * de quem monta a página:
 *
 *   1. Nenhum selo de estado comunica só por cor. Cada um carrega rótulo
 *      escrito + ícone da grade 24 + peso tipográfico. Sob `filter:grayscale(1)`
 *      (ou impresso em P&B, que é o caso de Reports.tsx) "Ruptura" e "Saudável"
 *      continuam distinguíveis — a auditoria de contraste mostrou que os tons
 *      quentes da paleta têm praticamente a mesma luminância entre si e colapsam
 *      sob deuteranopia (ΔE 8.8 entre saudável e crítico).
 *   2. Todo botão nasce com type="button". Sem isso, um botão dentro de <form>
 *      submete a página ao ser clicado.
 *   3. O primário sólido só existe através de <BotaoPrimario>, para que a regra
 *      do manual (UMA ocorrência por tela) tenha um lugar visível para morar.
 *
 * As cores vêm sempre dos aliases da camada 2 (var(--red), var(--muted)…), nunca
 * dos tokens da camada 1: é o alias que troca de valor no tema escuro.
 */

// ─── Indicador (StatCard) ────────────────────────────────────────────────────

/**
 * Nível hierárquico do cartão. É a resposta à segunda parte do retorno do
 * cliente ("temos que demarcar melhor as informações principais"), e o nome é
 * o PAPEL, não o desenho — igual às variantes de botão:
 *
 *   1 · o indicador que a tela existe para mostrar. UM por tela, dois no
 *       máximo. Mais área, número em Fraunces 40px, superfície própria e
 *       filete dourado de 3px no topo.
 *   2 · apoio. É o cartão de sempre — e continua sendo o PADRÃO, para que
 *       nenhuma tela nasça promovendo tudo.
 *   3 · contexto e rodapé. Sem moldura e sem fundo, só o filete de cima.
 *       Recua sem sumir, e ocupa MENOS altura que o nível 2 — o que é o motivo
 *       de a hierarquia não custar densidade.
 *
 * Os quatro canais que separam os três (filete de topo, superfície, área,
 * corpo do número) são geométricos de propósito: sobrevivem à impressão P&B
 * de Reports.tsx, ao daltonismo e ao monitor descalibrado da loja. Ver a nota
 * longa em `.card.destaque`, no styles.css.
 */
export type NivelDeCartao = 1 | 2 | 3;

const classeDoNivel: Record<NivelDeCartao, string> = {
  1: 'card stat destaque',
  2: 'card stat',
  3: 'card stat contexto',
};

/**
 * Indicador do manual: o número é o herói (Fraunces, tabular), o rótulo é o
 * serviço. A tipografia vem de `.stat` no styles.css — aqui só se monta a
 * estrutura.
 *
 * ONDA 5 · O RÓTULO SAIU DA MONO CAIXA ALTA. "Unidades em estoque",
 * "Transferências pendentes", "Última sincronização" são rótulos DESCRITIVOS de
 * 19 a 24 caracteres, e em mono caixa alta com 0.18em eles perdem o contorno da
 * palavra — que é a forma pela qual o olho a reconhece sem soletrar. Agora é
 * Inter 12px/600 (regra `.label`). Quem precisa de carimbo tem `unidade`,
 * abaixo, que é onde a mono passa a trabalhar dentro do indicador.
 *
 * `icon` é opcional e serve para o indicador que carrega risco ("Rupturas",
 * "Sem venda"): o ícone dá um segundo canal de leitura antes do número.
 *
 * `unidade` é o carimbo curto colado ao número ("un.", "meses", "/mês", "R$") —
 * mono, caixa alta, 0.18em. É deliberadamente a ÚNICA mono do cartão: o
 * indicador continua assinado pelo sistema, sem que a assinatura tome a frase.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  nivel = 2,
  unidade,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: IconName;
  /** 1 principal · 2 apoio (padrão) · 3 contexto. Ver NivelDeCartao. */
  nivel?: NivelDeCartao;
  /** Carimbo de unidade colado ao número. Até ~8 caracteres. */
  unidade?: string;
  /** Modificadores de grade — hoje só `largo` (ocupa duas colunas). */
  className?: string;
}) {
  return (
    <div className={[classeDoNivel[nivel], className].filter(Boolean).join(' ')}>
      <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* size 14: o rótulo agora tem 12px em Inter — o ícone acompanha o corpo
            da letra em vez de acompanhar o carimbo de 10px de antes. */}
        {icon && <Icon name={icon} size={14} />}
        <span>{label}</span>
      </div>
      <div className="value">
        {value}
        {unidade && <span className="unidade">{unidade}</span>}
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

// ─── Vocabulário tipográfico compartilhado ───────────────────────────────────

/**
 * Identificador: SKU, código de produto, ID de movimentação, data/hora,
 * protocolo. É o lugar onde a monoespaçada é FUNÇÃO e não decoração — são
 * cadeias que o operador compara caractere a caractere ("RB4446L" contra
 * "RB4446I"), e a largura fixa é o que faz a diferença saltar.
 *
 * Por isso, e só aqui, a mono vem em caixa NORMAL e com entreletras ZERO: caixa
 * alta e espaçamento atrapalhariam exatamente a comparação que a família existe
 * para servir.
 */
export function Codigo({ children }: { children: ReactNode }) {
  return <span className="codigo">{children}</span>;
}

/**
 * Carimbo curto de unidade ou estado, colado a um número: "un.", "meses",
 * "/mês", "30d", "%". Mono, caixa alta, 0.18em, dimensionado em relação ao
 * número a que se cola.
 *
 * Limite prático: ~8 caracteres. Acima disso não é carimbo, é rótulo — e rótulo
 * vai de `.label`, em Inter.
 */
export function Unidade({ children }: { children: ReactNode }) {
  return <span className="unidade">{children}</span>;
}

/**
 * Abertura de seção: a régua dourada do manual (`.rule-section`) + o sobretítulo
 * em mono (`.eyebrow`) + o título em Fraunces, como UMA coisa só.
 *
 * Existe porque a régua hierárquica estava subaproveitada a ponto de o
 * Dashboard entregue ter ZERO `.rule-section` e ZERO `.rule` — a ferramenta que
 * o manual prevê para separar seção de item estava no CSS e não na tela, e por
 * isso os nove blocos do painel chegavam ao olho como uma pilha só.
 *
 * `eyebrow` é a etiqueta curta que nomeia a família do bloco ("OPERAÇÃO",
 * "COBERTURA", "REMANEJAMENTO"): 1 a 2 palavras, é aqui que a mono caixa alta a
 * 0.18em está no lugar dela. `descricao` é frase e vai em Inter.
 */
export function AberturaDeSecao({
  eyebrow,
  titulo,
  descricao,
  acoes,
}: {
  eyebrow?: string;
  titulo: string;
  descricao?: ReactNode;
  acoes?: ReactNode;
}) {
  return (
    <div className="abertura">
      <hr className="rule-section" />
      <div className="row-between" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h3 className="section-title">{titulo}</h3>
          {descricao && <p className="hint">{descricao}</p>}
        </div>
        {acoes && (
          <div style={{ display: 'flex', gap: 10, flex: 'none', flexWrap: 'wrap' }}>{acoes}</div>
        )}
      </div>
    </div>
  );
}

// ─── Cabeçalho de página ─────────────────────────────────────────────────────

/**
 * Título em Fraunces, sobretítulo opcional em mono (`.eyebrow`, com o filete
 * dourado curto) e área de ações à direita.
 *
 * O `eyebrow` é onde entra a família da tela ("Operação", "Planejamento",
 * "Governança"): ele abre a seção antes do título, que é a leitura que o manual
 * pede. Use-o quando a tela pertence a um grupo; omita em tela solta, senão
 * vira ruído repetido.
 *
 * `actions` existe para que a tela não precise inventar um flex ao lado do
 * título — e é o lugar natural do único <BotaoPrimario> da página.
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <header>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <div className="row-between" style={{ gap: 16, alignItems: 'flex-start' }}>
        {/* min-width:0 impede que um título longo empurre as ações para fora. */}
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-sub">{subtitle}</p>}
        </div>
        {actions && (
          <div style={{ display: 'flex', gap: 10, flex: 'none', flexWrap: 'wrap' }}>{actions}</div>
        )}
      </div>
    </header>
  );
}

// ─── Estados de carregamento e erro ──────────────────────────────────────────

/**
 * role="status" + aria-live: sem isso o leitor de tela não anuncia que a tabela
 * está sendo buscada e o usuário fica em silêncio esperando.
 */
export function Loading() {
  return (
    <div
      className="empty"
      role="status"
      aria-live="polite"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
    >
      <Icon name="sincronizacao" size={18} />
      <span>Carregando…</span>
    </div>
  );
}

/**
 * role="alert": erro precisa interromper a leitura, não esperar o usuário
 * chegar até ele. A cor vermelha é reforço — quem comunica é a palavra "Erro" e
 * o ícone de atenção.
 */
export function ErrorState({ message }: { message?: string }) {
  return (
    <div
      className="empty"
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        color: 'var(--red)',
      }}
    >
      <Icon name="atencao" size={18} />
      <span>Erro ao carregar dados.{message ? ` ${message}` : ''}</span>
    </div>
  );
}

// ─── Selo de estado (base de StatusBadge e CoverageBadge) ────────────────────

/** Famílias de `.badge` do styles.css. Não são cores: são papéis. */
export type TomDeSelo =
  /** saudável / concluído */
  | 'green'
  /** atenção / esperando decisão */
  | 'amber'
  /** crítico / recusado */
  | 'red'
  /** informativo neutro, sem estado */
  | 'blue'
  /** inerte: encerrado, sem ação pendente */
  | 'gray';

/**
 * Selo operacional. Use sempre isto em vez de escrever `<span className="badge">`
 * na página: é o que garante os três canais redundantes exigidos pela WCAG 1.4.1.
 *
 * - `children` é o rótulo escrito, obrigatório;
 * - `icone` é a forma, que sobrevive ao P&B e ao daltonismo;
 * - `forte` reserva o peso 600 para o estado que exige ação imediata — peso é
 *   um canal ortogonal à cor e é o último a sobrar numa impressão ruim.
 *
 * ONDA 5 · O CHIP SAIU DA MONO CAIXA ALTA (ver a nota longa em `.badge`, no
 * styles.css). O texto que ele carrega não é etiqueta, é frase curta —
 * "9,4 meses · alta", "Aprovada/Pendente", "Reconciliada" — e em caixa alta
 * espaçada, repetida 19 vezes numa coluna, vira ruído. Nenhum dos três canais
 * redundantes se perde: rótulo escrito, ícone e filete esquerdo continuam.
 *
 * E o `forte` passou a valer de verdade: na JetBrains Mono deste projeto a faixa
 * de peso é 400..500 (src/fonts.css), então o 600 caía em negrito sintético; em
 * Inter a faixa é 300..600 e o 600 é uma face real. O peso vira o quarto canal.
 *
 * 11.5px em caixa normal ocupa ~28% menos largura que os 10.5px em caixa alta
 * com 0.18em que o chip tinha, então ele fica MAIOR de ler e MENOR na célula.
 */
export function Selo({
  tom,
  icone,
  forte = false,
  title,
  children,
}: {
  tom: TomDeSelo;
  icone: IconName;
  forte?: boolean;
  /** Explicação do estado ao passar o mouse. Nunca a única fonte da informação. */
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`badge ${tom}`}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        // vertical-align:middle mantém o chip na linha de base da célula da
        // tabela; inline-flex sozinho o desalinha do texto vizinho.
        verticalAlign: 'middle',
        fontSize: '11.5px',
        fontWeight: forte ? 600 : 500,
      }}
    >
      <Icon name={icone} size={14} />
      <span>{children}</span>
    </span>
  );
}

// ─── Situação da movimentação ────────────────────────────────────────────────

interface EstadoDeSelo {
  label: string;
  tom: TomDeSelo;
  icone: IconName;
  forte?: boolean;
  nota?: string;
}

/**
 * Seis situações, seis ícones distintos. Duas escolhas merecem explicação:
 *
 * - CANCELLED saiu de `red` para `gray`. Rejeitada e Cancelada eram o mesmo
 *   vermelho, mas só uma delas é decisão de governança contra o pedido; a outra
 *   é o próprio solicitante desistindo. Vermelho fica com o que foi recusado.
 * - CANCELLED e RECONCILED compartilham o cinza porque ambas são estados
 *   encerrados, sem ação pendente — o que as separa é o ícone e a palavra.
 */
const movementStatus: Record<string, EstadoDeSelo> = {
  REQUESTED: { label: 'Solicitada', tom: 'blue', icone: 'fluxo', nota: 'Na fila, aguardando análise.' },
  REJECTED: {
    label: 'Rejeitada',
    tom: 'red',
    icone: 'recusar',
    forte: true,
    nota: 'Recusada na aprovação. Não gera movimento de estoque.',
  },
  PENDING: {
    label: 'Aprovada/Pendente',
    tom: 'amber',
    icone: 'prazo',
    nota: 'Aprovada, aguardando confirmação de recebimento.',
  },
  CONFIRMED: {
    label: 'Confirmada',
    tom: 'green',
    icone: 'aprovar',
    nota: 'Recebida e baixada no saldo das duas lojas.',
  },
  CANCELLED: { label: 'Cancelada', tom: 'gray', icone: 'limpar', nota: 'Encerrada por quem solicitou.' },
  RECONCILED: {
    label: 'Reconciliada',
    tom: 'gray',
    icone: 'governanca',
    nota: 'Conferida contra a base sincronizada da fonte.',
  },
};

export function StatusBadge({ status }: { status: string }) {
  // Situação desconhecida cai em cinza com ícone de informação: nunca herda a
  // aparência de um estado real, senão inventa um significado que não existe.
  const s = movementStatus[status] ?? { label: status, tom: 'gray' as const, icone: 'informacao' as const };
  return (
    <Selo tom={s.tom} icone={s.icone} forte={s.forte} title={s.nota}>
      {s.label}
    </Selo>
  );
}

const movementType: Record<string, string> = {
  TRANSFER: 'Transferência',
  SALE: 'Venda',
  ADJUSTMENT: 'Ajuste',
  RETURN: 'Devolução',
};
export const movementTypeLabel = (t: string) => movementType[t] ?? t;

// ─── Cobertura de estoque (Dashboard e Relatórios usam o mesmo selo) ─────────

/**
 * O vermelho aqui é EXCLUSIVO da falta — é o único estado cuja ação é "trazer
 * produto para cá". Antes CRITICAL e EXCESS dividiam o vermelho, ou seja, os
 * dois problemas opostos do estoque tinham a mesma aparência.
 *
 * Alta e excesso são o mesmo problema em dois graus (capital parado), então
 * dividem o âmbar e se separam por ícone, por peso e pelo número de meses que
 * vem escrito ao lado — não pelo tom, que a auditoria mostrou ser indistinguível
 * para parte dos usuários.
 *
 * ONDA 5 · os quatro rótulos passaram a nascer capitalizados. Enquanto o chip
 * era caixa alta por CSS, "crítica" e "Crítica" davam o mesmo desenho; sem o
 * text-transform, o minúsculo passou a aparecer, e o nível do estado é a
 * palavra que decide a ação — ela abre com maiúscula como qualquer outro selo
 * do sistema ("Solicitada", "Confirmada", "Reconciliada").
 */
const coverageMeta: Record<CoverageLevel, EstadoDeSelo> = {
  CRITICAL: {
    label: 'Crítica',
    tom: 'red',
    icone: 'atencao',
    forte: true,
    nota: 'Menos de 1 mês de venda em estoque. Ação: repor ou transferir para cá.',
  },
  HEALTHY: {
    label: 'Saudável',
    tom: 'green',
    icone: 'aprovar',
    nota: 'Até 6 meses de venda em estoque. Ação: nenhuma.',
  },
  HIGH: {
    label: 'Alta',
    tom: 'amber',
    icone: 'tendencia',
    nota: 'De 6 a 12 meses de venda em estoque. Ação: segurar compra.',
  },
  EXCESS: {
    label: 'Excesso',
    tom: 'amber',
    icone: 'estoque',
    forte: true,
    nota: 'Mais de 12 meses de venda parados. Ação: escoar ou redistribuir.',
  },
};

export const fmtMonths = (m: number | null) =>
  m === null ? 'sem venda' : `${m.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses`;

/**
 * Selo "X meses · nível" da cobertura (crítica <1 · saudável ≤6 · alta ≤12 ·
 * excesso >12).
 *
 * ONDA 5 · o nível vem em <strong>. Sem a caixa alta, o chip passou a ter duas
 * leituras dentro dele — a MEDIDA ("9,4 meses") e o VEREDITO ("Alta") — e é o
 * veredito que decide a ação. O peso separa os dois sem cor e sem espaço extra,
 * e o @font-face limita o <strong> a 600, que é o mais pesado que o sistema
 * admite (ver src/fonts.css).
 */
export function CoverageBadge({ months, level }: { months: number | null; level: CoverageLevel }) {
  const meta = coverageMeta[level];
  return (
    <Selo tom={meta.tom} icone={meta.icone} forte={meta.forte} title={meta.nota}>
      {fmtMonths(months)} · <strong>{meta.label}</strong>
    </Selo>
  );
}

// ─── Hierarquia de ação ──────────────────────────────────────────────────────

/**
 * As quatro alturas de ação do manual. O nome descreve o PAPEL, não o desenho,
 * porque é o papel que a página precisa escolher:
 *
 *   primario  → o que a tela existe para fazer. UMA ocorrência por tela.
 *   comum     → ação de rotina (filtrar, exportar, abrir detalhe). Contornado.
 *   discreto  → ação terciária, sem ouro nenhum.
 *   perigo    → ação destrutiva ou irreversível (cancelar, excluir, rejeitar).
 */
export type VarianteBotao = 'primario' | 'comum' | 'discreto' | 'perigo';

const classeDaVariante: Record<VarianteBotao, string> = {
  primario: 'btn solid',
  comum: 'btn',
  discreto: 'btn ghost',
  perigo: 'btn danger',
};

export interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBotao;
  /** Ícone da grade 24, à esquerda do rótulo. O rótulo escrito nunca some. */
  icone?: IconName;
  /** Aplica `.btn.sm` — usado dentro de linha de tabela e de toolbar densa. */
  pequeno?: boolean;
}

/**
 * Botão do sistema. A variante padrão é `comum` (contornado) de propósito: se o
 * padrão fosse sólido, toda tela nasceria violando a regra de uma única
 * ocorrência de ouro preenchido.
 */
export function Botao({
  variante = 'comum',
  icone,
  pequeno = false,
  className,
  style,
  children,
  type = 'button',
  ...resto
}: BotaoProps) {
  const classes = [classeDaVariante[variante], pequeno ? 'sm' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type}
      className={classes}
      // inline-flex para o ícone alinhar com o rótulo; o gap de 8 é o mesmo
      // respiro do .toolbar, para o botão não parecer apertado ao lado dos campos.
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...style }}
      {...resto}
    >
      {/* 17px e não os 20px sugeridos em Icon.tsx: o rótulo do console tem
          13,5px e um glifo de 20 pesaria mais que a palavra. */}
      {icone && <Icon name={icone} size={pequeno ? 15 : 17} />}
      {children}
    </button>
  );
}

/**
 * Ação primária da tela — o ouro preenchido.
 *
 * O manual limita a UMA ocorrência por tela: é o botão que responde à pergunta
 * "para que esta tela existe?" (aprovar as transferências, gerar o pedido,
 * confirmar o recebimento). Todo o resto da tela usa <Botao> nas outras
 * variantes. Duas ocorrências na mesma tela significam que a tela não decidiu
 * qual é a ação principal — resolva isso no desenho, não duplicando o sólido.
 */
export function BotaoPrimario(props: Omit<BotaoProps, 'variante'>) {
  return <Botao {...props} variante="primario" />;
}

/** Botão "Exportar CSV" padronizado dos relatórios. Ação terciária: discreto. */
export function ExportCsv<T>({
  rows,
  columns,
  filename,
}: {
  rows: T[] | undefined;
  columns: CsvColumn<T>[];
  filename: string;
}) {
  if (!rows || rows.length === 0) return null;
  return (
    <Botao
      variante="discreto"
      icone="exportar"
      onClick={() => downloadCsv(filename, toCsv(rows, columns))}
    >
      Exportar CSV ({rows.length})
    </Botao>
  );
}
