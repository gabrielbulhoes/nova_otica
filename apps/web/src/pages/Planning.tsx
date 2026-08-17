import { Fragment, useRef, useState, type ReactNode } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createMovement,
  formatBRL,
  getCategories,
  getFairSplit,
  getPlanningOverview,
  getPurchaseOrderHistory,
  getDistributionPlan,
  getFilaDeDistribuicao,
  getReceivingUnits,
  distributeOrder,
  getPurchaseOrders,
  getPurchaseSuggestions,
  getRebalancePlan,
  getStores,
  getSupplierSettings,
  registerPurchaseOrder,
  setSupplierLeadTime,
  getMixDeGrifes,
  setGrifeForaDoMix,
  getMixPorLoja,
  declararMixDaGrife,
  settlePurchaseOrder,
  type MovementClass,
  type PurchaseOrder,
  type ProductGroup,
  type PurchaseOrderRecord,
  type Recommendation,
  type RateioLoja,
  type RebalanceSuggestion,
} from '../api/client';
import {
  PageHeader,
  Loading,
  ExportCsv,
  Selo,
  Botao,
  BotaoPrimario,
  AberturaDeSecao,
  Unidade,
  type TomDeSelo,
} from '../components/ui';
import { Icon, type IconName } from '../brand/Icon';
import { useAuth } from '../auth/AuthContext';
import { downloadCsv } from '../bi/csv';
import { deadlineDate, orderCsv, rotuloDoPeso, slug } from '../lib/rateio';
import { opcoesDePeriodo, periodoInicial } from '../lib/periodo';
import { recarregarDoTopo } from '../lib/consultaPaginada';
import {
  LINHAS_POR_CLIQUE,
  juntarPaginas,
  proximoPedido,
  type PedidoDePagina,
  restantes,
} from '../lib/paginacao';
import { LegendaDaAmostra } from '../components/LegendaDaAmostra';

/**
 * Recortes das duas telas. O rateio de feira pede janela LONGA de propósito —
 * ele reparte uma compra pela participação histórica de cada loja —, e é por
 * isso que nenhuma das opções cabe numa amostra de 7 dias. Nesse caso
 * `opcoesDePeriodo` acrescenta a própria cobertura como primeira opção, para a
 * tela continuar utilizável com o que a base tem.
 */
const PERIODOS_RATEIO = [
  { dias: 90, label: '90 dias' },
  { dias: 180, label: '180 dias' },
  { dias: 365, label: '1 ano' },
];

const PERIODOS_ANALISE = [
  { dias: 30, label: 'Últimos 30 dias' },
  { dias: 90, label: 'Últimos 90 dias' },
  { dias: 180, label: 'Últimos 180 dias' },
];

/**
 * Estado operacional desta tela, no formato que o <Selo> compartilhado consome.
 *
 * `tom` é o terceiro canal, nunca o primeiro: quem carrega a decisão é o rótulo
 * escrito e o ícone da grade 24. O critério é objetivo — com filter:grayscale(1)
 * "Comprar" e "Liquidar" continuam separáveis, porque diferem em palavra, em
 * desenho e em espessura do filete do chip, não só em matiz.
 */
type EstadoOperacional = { label: string; tom: TomDeSelo; icone: IconName; forte?: boolean };

const recMeta: Record<Recommendation, EstadoOperacional> = {
  BUY: { label: 'Comprar', tom: 'green', icone: 'compras' },
  HOLD: { label: 'Manter', tom: 'blue', icone: 'aprovar' },
  DONT_BUY: { label: 'Não comprar', tom: 'amber', icone: 'recusar' },
  // forte (peso 600) fica com o que exige mão na massa agora: liquidar é a
  // única recomendação que manda tirar capital parado da prateleira.
  LIQUIDATE: { label: 'Liquidar', tom: 'red', icone: 'etiqueta', forte: true },
};

const moveMeta: Record<MovementClass, EstadoOperacional> = {
  FAST: { label: 'Alto giro', tom: 'green', icone: 'tendencia' },
  // HEALTHY era 'blue' aqui e 'green' no selo compartilhado (ui.tsx): o MESMO
  // estado tinha duas cores dependendo da tela em que o usuário estivesse.
  // Fica verde, que é o valor do componente comum. Alto giro também é verde —
  // os dois são estados saudáveis, e quem os separa é a palavra e o ícone.
  HEALTHY: { label: 'Saudável', tom: 'green', icone: 'aprovar' },
  SLOW: { label: 'Baixo giro', tom: 'amber', icone: 'prazo' },
  DEAD: { label: 'Parado', tom: 'red', icone: 'estoque', forte: true },
};

type Filter = 'ALL' | Recommendation;

/** Recortes de cobertura — vocabulário da operação (feedback do cliente). */
const GROUP_OPTIONS: { value: ProductGroup; label: string; hint: string }[] = [
  {
    value: 'principal',
    label: 'Óculos e armações',
    hint: 'Óculos solares e de grau / armações — o que a rede chama de cobertura no dia a dia.',
  },
  {
    value: 'relogios',
    label: 'Relógios',
    hint: 'Somente relógio, separado de óculos a pedido da rede (Feedbacks 5.0).',
  },
  {
    value: 'lentes',
    label: 'Lentes e tratamentos',
    hint: 'Lente e tratamento — a visão usada para programar as reposições do laboratório.',
  },
  {
    value: 'outros',
    label: 'Acessórios e outros',
    hint: 'Estojo, porta-óculos, cordão, bijuteria, voucher — o que não é óculos, relógio nem lente.',
  },
  {
    value: 'todos',
    label: 'Consolidado',
    hint: 'Todos os produtos juntos. É exatamente a soma dos quatro recortes acima.',
  },
];

/* Sem canto arredondado: a geometria do sistema é reta, e o único arco
   autorizado é o corte assimétrico do símbolo (que vive no .btn). A barra
   tinha raio 999 — pílula, vocabulário de outro tema. */
function Bar({ segments }: { segments: { value: number; color: string; label: string }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div style={{ display: 'flex', height: 14, overflow: 'hidden', background: 'var(--panel-2)' }}>
      {segments.map((s, i) => (
        <div
          key={i}
          title={`${s.label}: ${formatBRL(s.value)}`}
          style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
        />
      ))}
    </div>
  );
}

/**
 * Estado vazio POSITIVO: aqui "nada a fazer" é boa notícia, e era isso que
 * o emoji de palmas tentava dizer. Emoji não serve: muda de desenho em cada
 * sistema e, em escala de cinza, vira mancha sem forma. O ícone de aprovação
 * diz o mesmo em traço 1,3 e herda a cor do contexto.
 */
function TudoCerto({ children }: { children: ReactNode }) {
  return (
    <div
      className="empty"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
    >
      <Icon name="aprovar" size={18} />
      <span>{children}</span>
    </div>
  );
}

/** "Pedir até": urgência do pedido em linguagem do dia a dia. */
function OrderBy({ inDays, leadTimeDays }: { inDays: number | null; leadTimeDays: number }) {
  if (inDays === null) return <span className="muted">—</span>;
  const deadline = new Date(Date.now() + inDays * 86400000).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
  const hoje = inDays === 0;
  const label = hoje ? 'pedir hoje' : `até ${deadline}`;
  const tom: TomDeSelo = hoje ? 'red' : inDays <= 7 ? 'amber' : 'gray';
  // Três ícones, três urgências: triângulo (agora), relógio (esta semana),
  // calendário (dá tempo). Em P&B o desenho separa o que o tom não separa.
  const icone: IconName = hoje ? 'atencao' : inDays <= 7 ? 'prazo' : 'calendario';
  return (
    <Selo
      tom={tom}
      icone={icone}
      forte={hoje}
      title={`Prazo do fornecedor: ${leadTimeDays} dias. Pedido deve ser feito ${hoje ? 'hoje' : `em até ${inDays} dias`} para não romper.`}
    >
      {label}
    </Selo>
  );
}

/**
 * Confiabilidade da decisão (0–100).
 *
 * Aqui a cor não carrega estado sozinha porque o próprio NÚMERO é o rótulo
 * escrito: 42% e 88% se leem iguais em cinza, em P&B e no daltonismo. O tom e
 * o ícone existem para dar a faixa de relance, não para substituir o valor.
 */
function Confidence({ value }: { value: number }) {
  const alta = value >= 75;
  const media = value >= 50;
  const tom: TomDeSelo = alta ? 'green' : media ? 'amber' : 'gray';
  const icone: IconName = alta ? 'aprovar' : media ? 'informacao' : 'atencao';
  const faixa = alta ? 'alta' : media ? 'média' : 'baixa';
  return (
    <Selo
      tom={tom}
      icone={icone}
      title={`Confiabilidade ${faixa}: quanto mais vendas e histórico o item tem, mais confiável é a recomendação.`}
    >
      {value}%
    </Selo>
  );
}

/** Explicação curta e amigável do porquê da decisão. */
function WhyNote({ text }: { text: string }) {
  return (
    <div
      className="muted"
      style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 11.5, marginTop: 3, lineHeight: 1.35 }}
    >
      {/* Substitui o emoji de lâmpada. `ideia` é o desenho que o manual
          reservou para "porquê da recomendação"; marginTop alinha o traço
          à primeira linha do texto. */}
      <Icon name="ideia" size={14} style={{ marginTop: 1 }} />
      <span>{text}</span>
    </div>
  );
}

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—';

/**
 * Ação em duas etapas (prevenção de erro): o 1º clique arma a confirmação
 * ("Confirmar?"), o 2º executa — sem modal, mantendo o contexto na linha.
 */
function TwoStepButton({
  label,
  confirmLabel,
  doneLabel,
  onConfirm,
  ghost,
}: {
  label: string;
  confirmLabel: string;
  doneLabel: string;
  onConfirm: () => Promise<void>;
  ghost?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'armed' | 'loading' | 'done' | 'error'>('idle');

  // O check que vinha colado no rótulo ("Enviado" + glifo) era ícone escrito
  // como texto: largura variável conforme a fonte instalada e nenhuma garantia
  // de desenho. O selo já tem um lugar próprio para o ícone.
  if (state === 'done') return <Selo tom="green" icone="check">{doneLabel}</Selo>;

  if (state === 'armed' || state === 'loading') {
    return (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
        <Botao
          pequeno
          disabled={state === 'loading'}
          onClick={async () => {
            setState('loading');
            try {
              await onConfirm();
              setState('done');
            } catch {
              setState('error');
            }
          }}
        >
          {state === 'loading' ? 'Aguarde…' : confirmLabel}
        </Botao>
        <Botao variante="discreto" pequeno disabled={state === 'loading'} onClick={() => setState('idle')}>
          Voltar
        </Botao>
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <Botao variante={ghost ? 'discreto' : 'comum'} pequeno onClick={() => setState('armed')}>
        {label}
      </Botao>
      {state === 'error' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--red)' }}>
          <Icon name="atencao" size={12} />
          Falhou — tente de novo
        </span>
      )}
    </span>
  );
}

/**
 * A tabela "quanto vai para cada loja". Nasceu dentro do plano de recebimento
 * e saiu de lá porque a aba de COMPRAS passou a fazer a mesma pergunta — e
 * duas tabelas com o mesmo conteúdo divergem: uma ganha a coluna de estoque,
 * a outra não, e aí a mesma peça mostra números diferentes em duas telas.
 *
 * As colunas do meio são a CONTA INTEIRA, não decoração: vendeu tanto, tem
 * tanto, falta tanto, leva tanto. Sem elas a tela mostra um número e pede fé;
 * com elas o gestor confere — e é conferindo que ele passa a confiar.
 *
 * E é por isso que as colunas MUDAM com a base. Na necessidade, a corrente
 * inteira aparece: venda → alvo → falta → participação. Na reserva não existe
 * falta (a soma delas é zero, foi o que jogou o rateio para cá), e a venda
 * desta peça costuma ser zero também — quem manda é o peso da escada. Manter
 * as mesmas colunas ali mostrava quatro zeros ao lado de "mandar 28", que é a
 * tela pedindo fé com cara de estar explicando.
 */
/**
 * EXPORTADA para o teste de tela poder montá-la.
 *
 * É a tabela que saiu com a coluna "Mandar" VAZIA numa entrega inteira, com
 * typecheck verde: a tela lia `quantity` e a API mandava `suggestedQty`, porque
 * o tipo do web era declarado à mão. Nada acusou — não havia teste que abrisse
 * a tela, e a divergência só apareceu quando alguém exportou o arquivo e viu
 * zeros onde deveria haver 38.
 *
 * Exportar um componente só para testá-lo é concessão, e vale dizer por quê:
 * a alternativa era montar a página inteira (React Query, rotas, sessão) para
 * chegar a esta tabela, e teste que precisa de meia aplicação de pé é teste que
 * ninguém escreve o segundo.
 */
/**
 * Para onde vai o pedido INTEIRO, e quanto para cada loja — feedback 6.0 · 07.
 *
 * "No planejamento de compras só aparece o total de peças mas não indica
 * facilmente para onde vai, e qual a quantidade para cada loja."
 *
 * O rateio já era calculado e já aparecia — dentro de cada item, atrás de um
 * clique, um item por vez. Para saber o destino de um pedido de 40 itens era
 * preciso abrir 40 gavetas e somar de cabeça. Aqui é a mesma conta, feita uma
 * vez, sobre todos os fornecedores.
 *
 * Cala quando não há rateio (loja selecionada, ou usuário sem visão de rede) em
 * vez de mostrar uma faixa vazia: a tela já explica o motivo logo abaixo.
 */
export function DestinoDoPedido({ orders }: { orders: PurchaseOrder[] }) {
  const porLoja = new Map<string, number>();
  let semRateio = 0;
  for (const o of orders) {
    for (const it of o.items) {
      if (!it.distribution) {
        semRateio += it.quantity;
        continue;
      }
      for (const r of it.distribution.rows) {
        porLoja.set(r.storeName, (porLoja.get(r.storeName) ?? 0) + r.suggestedQty);
      }
      // O que o rateio não conseguiu endereçar continua sendo do pedido, e
      // some da soma por loja se ninguém contar. Ver `unassigned` no motor.
      semRateio += it.distribution.unassigned;
    }
  }
  if (porLoja.size === 0) return null;

  const linhas = [...porLoja.entries()].sort((a, b) => b[1] - a[1]);
  const total = linhas.reduce((a, [, q]) => a + q, 0);

  return (
    <div className="acao-do-card" style={{ margin: '0 0 12px' }}>
      <div className="label">Para onde vai</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 6 }}>
        {linhas.map(([loja, un]) => (
          <span key={loja} style={{ fontSize: 12.5 }}>
            {loja} <strong>{un}</strong>
            <Unidade>un.</Unidade>
          </span>
        ))}
      </div>
      <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
        {total} un. endereçadas
        {semRateio > 0 && ` · ${semRateio} un. sem destino definido (divisão manual)`}
      </p>
    </div>
  );
}

export function RateioPorLoja({
  rows,
  pesoLabel,
  porNecessidade,
  excludedByMix,
}: {
  rows: RateioLoja[];
  /** Rótulo da coluna de peso — diz de qual base saiu a participação. */
  pesoLabel: string;
  porNecessidade: boolean;
  excludedByMix?: string[];
}) {
  return (
    <>
      {rows.length === 0 ? (
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
          Nenhuma loja com necessidade nem venda nesta base — divisão manual.
        </p>
      ) : (
        <table style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>Loja</th>
              <th className="num">{pesoLabel}</th>
              <th className="num">Em estoque</th>
              {porNecessidade && <th className="num">Falta p/ o alvo</th>}
              <th className="num">Participação</th>
              <th className="num">Mandar</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.storeId}>
                <td>{r.storeName}</td>
                <td className="num">{porNecessidade ? r.unitsSold : r.weightUnits}</td>
                <td className="num">{r.stockUnits}</td>
                {porNecessidade && <td className="num">{r.needUnits}</td>}
                <td className="num">{r.sharePct}%</td>
                <td className="num">
                  <strong>{r.suggestedQty}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Na reserva, o percentual não saiu da falta — e a tabela precisa dizer
          isso onde o gestor está olhando, não só na etiqueta acima dela. */}
      {!porNecessidade && (
        <p className="muted" style={{ fontSize: 11.5, margin: '4px 0 0' }}>
          Nenhuma loja está abaixo da cobertura-alvo: a divisão saiu da coluna
          "{pesoLabel}", não da falta.
        </p>
      )}

      {/* Loja que some da lista sem motivo visível é o tipo de silêncio que
          faz alguém desconfiar do resto da tela. */}
      {excludedByMix && excludedByMix.length > 0 && (
        <p className="muted" style={{ fontSize: 11.5, margin: '4px 0 0' }}>
          Fora do rateio por não trabalharem a grife: {excludedByMix.join(', ')}.
        </p>
      )}
    </>
  );
}

/* Mesmo respiro que o `.stat .value` do indicador compartilhado usa entre o
   rótulo em mono e o número em Fraunces. Fica aqui porque styles.css é de
   outro dono nesta onda e a regra .action-card .action-count não o traz. */
const contadorHeroi = { marginTop: 6 } as const;

/**
 * A COMPOSIÇÃO DO PEDIDO — nova rodada · item 04.
 *
 * "O módulo compras ainda sem o enriquecimento dos tipos de óculos a serem
 *  comprados, quantidades por grife, etc."
 *
 * O pedido é agrupado por FORNECEDOR, e um fornecedor traz várias grifes: a
 * Luxottica manda Ray-Ban, Oakley, Arnette e Vogue no mesmo pedido. "R$ 82 mil
 * na Luxottica" não responde a pergunta que o comprador faz antes de assinar,
 * que é quanto disso é de cada grife — e essa quebra existia nos dados desde
 * sempre, só não tinha sido escrita em lugar nenhum.
 *
 * A COBERTURA VEM DECLARADA. Os tipos saem da ficha do fornecedor, e hoje só o
 * catálogo da Luxottica foi importado: 4.339 peças de 61 mil. Sem a linha de
 * cobertura, um pedido da Marcolin apareceria sem nenhum tipo e pareceria
 * defeito, quando é catálogo que ainda não chegou.
 */
function ComposicaoDoPedido({ order }: { order: PurchaseOrder }) {
  const semFicha = order.items.length - order.itensComFicha;
  // Uma grife só é o caso comum dos fornecedores pequenos: a quebra repetiria
  // o cabeçalho do card e não diria nada. A cobertura ainda vale sozinha.
  const valeQuebrar = order.porGrife.length > 1;
  if (!valeQuebrar && order.porFormato.length === 0) return null;

  return (
    <div
      style={{
        padding: '12px 18px',
        borderTop: '1px solid var(--line)',
        background: 'var(--panel-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {valeQuebrar && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span className="label">Por grife</span>
          {order.porGrife.map((g) => (
            <Selo key={g.brand} tom="gray" icone="etiqueta" title={`${g.items} ${g.items === 1 ? 'item' : 'itens'} desta grife`}>
              {g.brand}: {g.units}<Unidade>un.</Unidade> · {formatBRL(g.total)}
            </Selo>
          ))}
        </div>
      )}

      {order.porFormato.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span className="label">Tipos</span>
          {order.porFormato.map((f) => (
            <Selo key={f.formato} tom="blue" icone="produtos">
              {f.formato}: {f.units}<Unidade>un.</Unidade>
            </Selo>
          ))}
        </div>
      )}

      {semFicha > 0 && (
        <p className="hint" style={{ margin: 0 }}>
          {semFicha} {semFicha === 1 ? 'item sem ficha' : 'itens sem ficha'} do fornecedor — tipo,
          gênero e material aparecem em branco nessas linhas, e a quebra por tipo acima não os conta.
          É catálogo que ainda não foi importado, não falha de leitura.
        </p>
      )}
    </div>
  );
}

/** Rascunho de ordem de compra de um fornecedor, com export CSV e envio. */
function PurchaseOrderCard({ order, dias }: { order: PurchaseOrder; dias: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(order.orderByInDays !== null && order.orderByInDays <= 7);
  // Um rateio aberto por vez: cada um abre uma tabela de 16 linhas, e dois
  // abertos dentro de um pedido de 30 itens viram uma parede. Mesmo critério do
  // plano de recebimento, onde a decisão já tinha sido tomada.
  const [rateioAberto, setRateioAberto] = useState<string | null>(null);
  const urgency =
    order.orderByInDays === null ? null : order.orderByInDays === 0 ? 'hoje' : `até ${deadlineDate(order.orderByInDays)}`;

  const send = async () => {
    await registerPurchaseOrder({
      supplier: order.supplier,
      leadTimeDays: order.leadTimeDays,
      items: order.items.map((it) => ({
        productId: it.productId,
        description: it.description,
        quantity: it.quantity,
        unitCost: it.unitCost,
        total: it.total,
      })),
    });
    qc.invalidateQueries({ queryKey: ['planning-history'] });
    qc.invalidateQueries({ queryKey: ['planning-orders'] });
    recarregarDoTopo(qc, 'purchase-suggestions');
  };

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen(!open);
        }}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '14px 18px',
          cursor: 'pointer',
        }}
      >
        {/* Este glifo era ÍCONE DE ESTADO (aberto/fechado), não pontuação: vira
            desenho da grade 24. Quem anuncia o estado ao leitor de tela é o
            aria-expanded do contêiner, então aqui o ícone é decorativo. */}
        <Icon
          name={open ? 'chevron-baixo' : 'chevron-direita'}
          size={16}
          style={{ color: 'var(--muted)' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>Fornecedor:</span> {order.supplier}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {order.brands.length > 0 && <>marcas: {order.brands.join(', ')} · </>}
            {order.items.length} {order.items.length === 1 ? 'item' : 'itens'} · {order.units} un. · entrega em{' '}
            {order.leadTimeDays} dias
            {order.stockoutInDays !== null && (
              <span style={{ color: 'var(--red)' }}> · vai faltar em ~{order.stockoutInDays}d se não pedir</span>
            )}
          </div>
        </div>
        {/* A CONFIANÇA DO PEDIDO, que agora é o que ORDENA a lista (item 03).
            Sem ela na linha, a nova ordem parece bagunça: os pedidos deixaram
            de vir por urgência e nada na tela diz por qual régua vêm. */}
        <Confidence value={order.confidence} />
        {urgency && (
          <Selo
            tom={order.orderByInDays === 0 ? 'red' : order.orderByInDays! <= 7 ? 'amber' : 'gray'}
            icone={order.orderByInDays === 0 ? 'atencao' : order.orderByInDays! <= 7 ? 'prazo' : 'calendario'}
            forte={order.orderByInDays === 0}
          >
            enviar {urgency}
          </Selo>
        )}
        <strong style={{ whiteSpace: 'nowrap' }}>{formatBRL(order.total)}</strong>
        {/* Era um <span role="button"> sem tabIndex e sem tecla: aparência de
            botão, nenhum comportamento de botão para quem navega por teclado. */}
        <Botao
          variante="discreto"
          pequeno
          icone="exportar"
          onClick={(e) => {
            e.stopPropagation();
            downloadCsv(`pedido-${slug(order.supplier)}`, orderCsv(order));
          }}
        >
          Exportar CSV
        </Botao>
        <span onClick={(e) => e.stopPropagation()}>
          <TwoStepButton
            label="Registrar envio"
            confirmLabel={`Confirmar envio (${formatBRL(order.total)})`}
            doneLabel="Enviado"
            onConfirm={send}
          />
        </span>
      </div>
      {open && <ComposicaoDoPedido order={order} />}
      {open && (
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Marca</th>
              {/* A ficha do fornecedor (nova rodada · item 04). Substitui a
                  coluna "Categoria", que dizia "Armação" em quase toda linha:
                  informação constante não é informação. O tipo, o gênero e o
                  material são o que diferencia uma armação de outra na hora de
                  montar o pedido, e estavam no banco sem chegar a lugar nenhum. */}
              <th>Tipo</th>
              <th>Gênero</th>
              <th>Material</th>
              <th className="num">Qtde</th>
              <th className="num">Custo unit.</th>
              <th className="num">Total</th>
              <th>Pedir até</th>
              <th>Confiança</th>
              <th>Distribuição</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((it) => (
              <Fragment key={it.productId}>
                <tr>
                  <td>
                    {it.description}{' '}
                    {/* Marcação do FORNECEDOR, e o título diz isso em voz alta.
                        Quem decide o que gira nesta rede é o histórico dela,
                        não a campanha de quem vende para ela — o selo é
                        contexto de negociação, nunca recomendação do motor. */}
                    {it.atributos?.bestSeller && (
                      <Selo
                        tom="gray"
                        icone="tendencia"
                        title="Best-seller segundo o catálogo do fornecedor. É a marcação dele, não uma leitura do giro desta rede."
                      >
                        best-seller do fornecedor
                      </Selo>
                    )}
                  </td>
                  <td>{it.brand ?? '—'}</td>
                  {/* Traço quando a peça não casou com o catálogo do
                      fornecedor. Não é falha de leitura: é catálogo que ainda
                      não chegou, e o rodapé do pedido declara quantos itens
                      estão nessa situação para o traço não virar suspeita. */}
                  <td>{it.atributos?.formato ?? <span className="muted">—</span>}</td>
                  <td>{it.atributos?.genero ?? <span className="muted">—</span>}</td>
                  <td>{it.atributos?.material ?? <span className="muted">—</span>}</td>
                  <td className="num">{it.quantity}</td>
                  <td className="num">{formatBRL(it.unitCost)}</td>
                  <td className="num">{formatBRL(it.total)}</td>
                  <td>
                    <OrderBy inDays={it.orderByInDays} leadTimeDays={order.leadTimeDays} />
                  </td>
                  <td>
                    <Confidence value={it.confidence} />
                  </td>
                  <td>
                    {it.distribution ? (
                      <Botao
                        variante="discreto"
                        pequeno
                        icone={rateioAberto === it.productId ? 'chevron-baixo' : 'chevron-direita'}
                        onClick={() =>
                          setRateioAberto(rateioAberto === it.productId ? null : it.productId)
                        }
                        aria-expanded={rateioAberto === it.productId}
                      >
                        {it.distribution.rows.length} loja
                        {it.distribution.rows.length === 1 ? '' : 's'}
                      </Botao>
                    ) : (
                      // Ausente ≠ vazio, e são duas ausências diferentes: para
                      // quem não é ADMIN o rateio é omitido (expõe venda e
                      // estoque da rede inteira); com uma loja selecionada ele
                      // não existe (a quantidade já é daquela loja). As duas
                      // levam ao mesmo lugar — a visão da rede.
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        só na visão da rede
                      </span>
                    )}
                  </td>
                </tr>
                {it.distribution && rateioAberto === it.productId && (
                  <tr>
                    {/* `--panel-2` é o fundo de segundo nível do tema; a linha
                        expandida precisa se destacar da linha do item sem virar
                        um bloco de outra tela. */}
                    {/* 11 colunas desde que a ficha do fornecedor entrou
                        (Tipo, Gênero, Material no lugar de Categoria). */}
                    <td colSpan={11} style={{ background: 'var(--panel-2)' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                        <Selo tom="blue" icone="ideia" title={it.distribution.basisLabel}>
                          por {it.distribution.basis}
                        </Selo>
                        {/* O número que o percentual esconde: 100% de um rateio
                            parece sempre a mesma coisa, cubra ele a falta da
                            rede ou um vigésimo dela. */}
                        <span className="muted" style={{ fontSize: 12 }}>
                          {it.quantity}
                          <Unidade>un.</Unidade> a dividir
                          {/* Na reserva a falta é zero por definição, e "para
                              uma falta de 0 un." seria a tela explicando o
                              número com um número que não explica nada. */}
                          {it.distribution.totalNeed > 0 && (
                            <>
                              {' '}
                              para uma falta de {it.distribution.totalNeed}
                              <Unidade>un.</Unidade> na rede
                            </>
                          )}
                        </span>
                      </div>
                      <RateioPorLoja
                        rows={it.distribution.rows}
                        pesoLabel={rotuloDoPeso(it.distribution.basis, `${dias} dias`)}
                        porNecessidade={it.distribution.basis === 'necessidade'}
                        // As lojas que o mix tirou da divisão. Sem esta linha,
                        // uma loja que some do rateio é indistinguível de uma
                        // loja que não precisava de nada — e as duas pedem
                        // reações opostas de quem compra.
                        excludedByMix={it.distribution.excludedByMix}
                      />
                      {it.distribution.unassigned > 0 && (
                        <p className="muted" style={{ fontSize: 11.5, margin: '4px 0 0' }}>
                          {it.distribution.unassigned} un. sem rateio possível — nenhuma loja tem
                          falta nem histórico desta peça. Ficam para divisão manual.
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const recordStatusMeta: Record<PurchaseOrderRecord['status'], EstadoOperacional> = {
  SENT: { label: 'Em trânsito', tom: 'blue', icone: 'entrega' },
  RECEIVED: { label: 'Recebido', tom: 'green', icone: 'aprovar' },
  // `limpar` (X no círculo) é o mesmo desenho que o selo compartilhado usa para
  // CANCELLED — encerrado por quem pediu, não recusado por governança.
  CANCELLED: { label: 'Cancelado', tom: 'gray', icone: 'limpar' },
};

/**
 * Plano de distribuição de um pedido recebido — feedback 6.0 · item 06.
 *
 * "Ela confirmou o recebimento, mas ele não diz como deve distribuir essa
 *  mercadoria." O ciclo parava aqui: o pedido chegava, e a pergunta de operação
 *  — quantas para cada loja — voltava a ser resolvida no olho.
 *
 * A base de cada item aparece na tela, e não só o número: um rateio pela venda
 * DA PEÇA e um pela venda da CATEGORIA são estimativas de precisões muito
 * diferentes, e mostrar os dois com a mesma cara venderia certeza que não
 * temos.
 */
function DistributionPanel({ orderId, supplier }: { orderId: string; supplier: string }) {
  const qc = useQueryClient();
  const plano = useQuery({
    queryKey: ['distribution', orderId],
    queryFn: () => getDistributionPlan(orderId),
  });
  const unidades = useQuery({ queryKey: ['receiving-units'], queryFn: getReceivingUnits });
  const [origem, setOrigem] = useState('');
  const [estado, setEstado] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [erro, setErro] = useState('');
  const [criadas, setCriadas] = useState(0);

  const executar = async () => {
    if (!origem) return;
    setEstado('loading');
    setErro('');
    try {
      const r = await distributeOrder(orderId, origem);
      setCriadas(r.created);
      setEstado('done');
      qc.invalidateQueries({ queryKey: ['movements'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      // A fila da aba de distribuição precisa perder esta carga — senão ela
      // continua listada como parada logo depois de ter sido repartida, e o
      // próximo clique bate na trava do servidor em vez de na tela.
      qc.invalidateQueries({ queryKey: ['fila-distribuicao'] });
      qc.invalidateQueries({ queryKey: ['distribution', orderId] });
    } catch (e) {
      setEstado('error');
      const ex = e as { response?: { data?: { error?: string } } };
      setErro(ex.response?.data?.error ?? 'Não foi possível criar as transferências.');
    }
  };

  if (plano.isLoading) return <Loading />;
  if (!plano.data) return <div className="empty">Não foi possível montar o plano.</div>;

  return (
    <div style={{ padding: '4px 0 8px' }}>
      <p className="hint" style={{ margin: '0 0 10px' }}>
        Cada item é dividido pela <strong>falta de cada loja até a cobertura-alvo</strong> — quem
        vende mais tem alvo maior, e o que a loja já tem em estoque é descontado antes. Quando
        ninguém está abaixo do alvo (peça nova, por exemplo), a divisão cai na participação nas
        vendas, e a etiqueta ao lado do item diz qual das duas valeu. A soma fecha com a quantidade
        comprada.
      </p>

      {plano.data.items.map((item) => (
        <div key={item.productId} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13 }}>{item.description}</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              {item.quantity}
              <Unidade>un.</Unidade> a dividir
              {item.totalNeed > 0 && (
                <>
                  {' '}
                  para uma falta de {item.totalNeed}
                  <Unidade>un.</Unidade> na rede
                </>
              )}
            </span>
            {/* A base é selo informativo, nunca de estado: dizer que o rateio
                saiu da categoria não é um alerta, é uma ressalva de precisão. */}
            <Selo tom="blue" icone="ideia" title={item.basisLabel}>
              por {item.basis}
            </Selo>
          </div>

          {/* 12 meses fixos: é a janela que `distributionPlan` consulta, e ela
              não segue o seletor de período desta tela. */}
          <RateioPorLoja
            rows={item.rows}
            pesoLabel={rotuloDoPeso(item.basis, '12 m')}
            porNecessidade={item.basis === 'necessidade'}
            excludedByMix={item.excludedByMix}
          />
        </div>
      ))}

      {plano.data.unassigned > 0 && (
        <p className="hint" style={{ margin: '0 0 10px' }}>
          {plano.data.unassigned} un. sem rateio possível — nenhuma loja tem histórico em base
          nenhuma. Essas ficam para divisão manual.
        </p>
      )}

      <hr className="rule" />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {estado === 'done' ? (
          <Selo tom="green" icone="aprovar">
            {criadas} transferência{criadas > 1 ? 's' : ''} criada{criadas > 1 ? 's' : ''}
          </Selo>
        ) : plano.data.distributedAt ? (
          /* JÁ REPARTIDA — o botão nem chega a aparecer.
             O servidor recusa a segunda distribuição de qualquer jeito, mas
             oferecer um botão que só existe para dar erro é desenhar a
             armadilha e depois avisar que ela está lá. Antes da aba própria
             este caso era raro (o plano vivia escondido numa linha); agora a
             ação está na frente de quem passa. */
          <>
            <Selo tom="gray" icone="check" title="Esta carga já foi repartida entre as lojas.">
              distribuída em {shortDate(plano.data.distributedAt)}
            </Selo>
            <span className="hint">
              Para refazer o rateio, cancele antes as transferências pendentes desta carga em
              Movimentações.
            </span>
          </>
        ) : (
          <>
            {/* A origem é PERGUNTADA: o pedido não registra onde a carga
                desembarcou, e há três unidades de retaguarda candidatas.
                Escolher uma sozinho seria inventar um fato de operação. */}
            <label className="muted" style={{ fontSize: 12.5 }} htmlFor={`origem-${orderId}`}>
              A mercadoria chegou em:
            </label>
            <select
              id={`origem-${orderId}`}
              className="input"
              style={{ maxWidth: 240 }}
              value={origem}
              onChange={(e) => setOrigem(e.target.value)}
            >
              <option value="">Escolha a unidade…</option>
              {(unidades.data?.rows ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <Botao
              pequeno
              icone="transferencias"
              disabled={!origem || estado === 'loading'}
              aria-disabled={!origem || estado === 'loading'}
              onClick={executar}
              title={`Cria as transferências do pedido ${supplier} a partir da unidade escolhida`}
            >
              {estado === 'loading' ? 'Criando…' : 'Criar as transferências'}
            </Botao>
          </>
        )}
        {estado === 'error' && (
          <span role="alert" style={{ fontSize: 11.5, color: 'var(--red)' }}>
            {erro}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A FILA DA DISTRIBUIÇÃO — nova rodada · item 05.
 *
 * "Ainda sem a aba de distribuição para as lojas."
 *
 * O rateio existia desde o feedback 6.0 e funcionava. O que não existia era a
 * PORTA: ele morava dentro de uma linha do histórico de pedidos, atrás de um
 * botão "Como distribuir", visível só para quem já tivesse rolado até lá e só
 * depois de confirmar o recebimento. Quem chega de manhã perguntando "o que
 * chegou e ainda não foi repartido?" não tinha onde olhar.
 *
 * A fila responde essa pergunta e nada além dela, ordenada pelo que está
 * parado há mais tempo — mercadoria na retaguarda não vende, e é o capital
 * mais caro da rede: comprado, pago e sem chegar à vitrine.
 *
 * OS JÁ DISTRIBUÍDOS APARECEM NA CAUDA. Sem eles a aba esvaziaria justamente
 * ao terminar o trabalho, e tela vazia depois de um clique é indistinguível de
 * tela quebrada para quem a abre — a mesma razão pela qual "só os aprovados"
 * nasceu desligado.
 */
function FilaDeDistribuicao() {
  const fila = useQuery({ queryKey: ['fila-distribuicao'], queryFn: getFilaDeDistribuicao });
  // Um plano aberto por vez: cada um abre uma tabela de 16 linhas por item.
  // Mesmo critério do histórico de pedidos e do rateio na aba de compras.
  const [aberto, setAberto] = useState<string | null>(null);

  const pendentes = fila.data?.pendentes ?? [];
  const feitos = fila.data?.distribuidos ?? [];

  return (
    <>
      <AberturaDeSecao
        eyebrow="Distribuir"
        titulo="O que chegou e ainda não foi repartido"
        descricao="Cada carga recebida é dividida pela falta de cada loja até a cobertura-alvo — quem vende mais tem alvo maior, e o que a loja já tem é descontado antes. As grifes restritas só entram nas lojas que as trabalham. Confirmar cria as transferências em aberto; quem despacha confirma a saída."
        acoes={
          pendentes.length > 0 ? (
            <Selo
              tom={pendentes.some((p) => (p.paradaHaDias ?? 0) >= 7) ? 'amber' : 'blue'}
              icone="entrega"
              title="Cargas recebidas sem rateio executado."
            >
              {pendentes.length} {pendentes.length === 1 ? 'carga parada' : 'cargas paradas'}
            </Selo>
          ) : undefined
        }
      />
      <div className="card">
        {fila.isLoading ? (
          <Loading />
        ) : pendentes.length === 0 ? (
          <div className="empty">
            Nenhuma carga esperando. Toda mercadoria recebida já foi repartida entre as lojas.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th className="num">Itens</th>
                <th className="num">Un.</th>
                <th>Recebido em</th>
                <th>Parada há</th>
                <th className="right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {pendentes.map((c) => (
                <Fragment key={c.orderId}>
                  <tr>
                    <td>{c.supplier}</td>
                    <td className="num">{c.items}</td>
                    <td className="num">{c.units}</td>
                    <td>{c.receivedAt ? shortDate(c.receivedAt) : '—'}</td>
                    <td>
                      {/* Uma semana é o limiar do aviso, e não é arbitrário: o
                          malote entre praças leva de 1 a 4 dias, então uma
                          carga parada há mais de sete já perdeu um ciclo
                          inteiro de logística dentro da retaguarda. */}
                      {c.paradaHaDias === null ? (
                        <span className="muted">—</span>
                      ) : c.paradaHaDias >= 7 ? (
                        <Selo tom="amber" icone="atencao" title="Mais de uma semana na retaguarda, sem vender.">
                          {c.paradaHaDias} dias
                        </Selo>
                      ) : (
                        <span>{c.paradaHaDias} {c.paradaHaDias === 1 ? 'dia' : 'dias'}</span>
                      )}
                    </td>
                    <td className="right">
                      <Botao
                        variante="discreto"
                        pequeno
                        icone="transferencias"
                        aria-expanded={aberto === c.orderId}
                        onClick={() => setAberto((v) => (v === c.orderId ? null : c.orderId))}
                      >
                        {aberto === c.orderId ? 'Fechar' : 'Como distribuir'}
                      </Botao>
                    </td>
                  </tr>
                  {aberto === c.orderId && (
                    <tr>
                      <td colSpan={6} style={{ background: 'var(--panel-2)' }}>
                        <DistributionPanel orderId={c.orderId} supplier={c.supplier} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {feitos.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <span className="label">Repartidas recentemente</span>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th className="num">Un.</th>
                <th>Distribuída em</th>
              </tr>
            </thead>
            <tbody>
              {feitos.map((c) => (
                <tr key={c.orderId}>
                  <td>{c.supplier}</td>
                  <td className="num">{c.units}</td>
                  <td>{c.distributedAt ? shortDate(c.distributedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 8 }}>
            As transferências dessas cargas saíram <strong>em aberto</strong>: elas reservam o saldo,
            e quem despacha confirma a saída na tela de Movimentações. Uma carga só é repartida uma
            vez — para refazer o rateio, cancele antes as transferências pendentes dela.
          </p>
        </div>
      )}
    </>
  );
}

/** Histórico do ciclo de compras: enviado → recebido (ou cancelado). */
function OrderHistory() {
  const qc = useQueryClient();
  const history = useQuery({ queryKey: ['planning-history'], queryFn: getPurchaseOrderHistory });
  // Qual pedido está com o plano de distribuição aberto. Um por vez: o plano
  // tem uma tabela por item, e dois abertos viram uma parede.
  const [distribuindo, setDistribuindo] = useState<string | null>(null);

  const settle = async (id: string, action: 'receive' | 'cancel') => {
    await settlePurchaseOrder(id, action);
    qc.invalidateQueries({ queryKey: ['planning-history'] });
    qc.invalidateQueries({ queryKey: ['planning-orders'] });
    recarregarDoTopo(qc, 'purchase-suggestions');
    qc.invalidateQueries({ queryKey: ['stock'] });
  };

  return (
    <>
    <AberturaDeSecao
      eyebrow="Trilha"
      titulo="Histórico de pedidos (enviado → recebido)"
      descricao="Pedidos em trânsito são abatidos das sugestões (não compra duas vezes). Confirme o recebimento quando a mercadoria chegar e for conferida."
    />
    <div className="card">
      {history.isLoading ? (
        <Loading />
      ) : (history.data?.rows.length ?? 0) === 0 ? (
        <div className="empty">Nenhum pedido registrado ainda — registre o envio de um rascunho acima.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Fornecedor</th>
              <th className="num">Itens</th>
              <th className="num">Un.</th>
              <th className="num">Total</th>
              <th>Enviado em</th>
              <th>Previsão de chegada</th>
              <th>Status</th>
              <th className="right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {history.data!.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.supplier}</td>
                <td className="num">{r.items.length}</td>
                <td className="num">{r.units}</td>
                <td className="num">{formatBRL(r.total)}</td>
                <td>{shortDate(r.sentAt)}</td>
                <td>{shortDate(r.expectedAt)}</td>
                <td>
                  <Selo tom={recordStatusMeta[r.status].tom} icone={recordStatusMeta[r.status].icone}>
                    {recordStatusMeta[r.status].label}
                    {r.status === 'RECEIVED' && r.receivedAt ? ` · ${shortDate(r.receivedAt)}` : ''}
                  </Selo>
                </td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  {r.status === 'SENT' ? (
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <TwoStepButton
                        label="Confirmar recebimento"
                        confirmLabel="Mercadoria conferida?"
                        doneLabel="Recebido"
                        onConfirm={() => settle(r.id, 'receive')}
                      />
                      <TwoStepButton
                        label="Cancelar"
                        confirmLabel="Cancelar pedido?"
                        doneLabel="Cancelado"
                        onConfirm={() => settle(r.id, 'cancel')}
                        ghost
                      />
                    </span>
                  ) : r.status === 'RECEIVED' ? (
                    /* A pergunta que o ciclo deixava sem resposta: chegou, e
                       agora? Ela só existe depois do recebimento — antes disso
                       não há mercadoria para dividir. */
                    <Botao
                      variante="discreto"
                      pequeno
                      icone="transferencias"
                      aria-expanded={distribuindo === r.id}
                      onClick={() => setDistribuindo((v) => (v === r.id ? null : r.id))}
                    >
                      {distribuindo === r.id ? 'Fechar' : 'Como distribuir'}
                    </Botao>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            {history.data!.rows
              .filter((r) => r.id === distribuindo)
              .map((r) => (
                <tr key={`${r.id}-dist`}>
                  <td colSpan={8} style={{ background: 'var(--surface-2, transparent)' }}>
                    <DistributionPanel orderId={r.id} supplier={r.supplier} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
    </>
  );
}

/**
 * As duas travas do remanejamento, ditas na tela — e o que há de frágil nelas.
 *
 * A idade da peça POR LOJA é estimativa, não medição: o ERP não manda data de
 * chegada por filial. Esconder isso seria pior do que não ter a trava, porque
 * o lojista passaria a confiar num número que erra de um jeito só. Erra sempre
 * para o mesmo lado (peça parece mais VELHA do que é, e por isso pode ser
 * doada), o que é decisão deliberada: uma sugestão a mais ele recusa em um
 * clique, uma sugestão a menos ele nunca vê.
 */
function NotaDeIdadeEstimada({ guards }: { guards: { newProductDays: number; donorFloorUnits: number } }) {
  return (
    <div
      className="muted"
      style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 11.5, marginTop: 10, lineHeight: 1.4 }}
    >
      <Icon name="informacao" size={14} style={{ marginTop: 1 }} />
      <span>
        A loja de origem nunca fica com menos de {guards.donorFloorUnits}{' '}
        {guards.donorFloorUnits === 1 ? 'unidade' : 'unidades'} em vitrine, e peça com menos de{' '}
        {guards.newProductDays} dias na loja não é remanejada — ela ainda nem foi vista.{' '}
        <strong>Essa idade é estimativa</strong>: o ERP não informa quando a peça chegou em cada
        filial, então usamos a data mais antiga entre a criação da posição de estoque e o cadastro
        do produto. Ela erra para mais quando a peça zerou e voltou à prateleira, e quando o
        produto já rodava na rede antes de chegar nesta loja — nos dois casos a peça parece mais
        velha do que é, e o motor prefere sugerir a mais do que sugerir a menos.
      </span>
    </div>
  );
}

/** Linha de transferência sugerida com ação de 1 clique e feedback de estado. */
function RebalanceRow({ s }: { s: RebalanceSuggestion }) {
  const qc = useQueryClient();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  const request = async () => {
    setState('loading');
    try {
      await createMovement({
        type: 'TRANSFER',
        productId: s.productId,
        fromStoreId: s.fromStoreId,
        toStoreId: s.toStoreId,
        quantity: s.quantity,
        reason: 'Redistribuição sugerida pelo planejamento (vendas × estoque por loja).',
      });
      setState('done');
      qc.invalidateQueries({ queryKey: ['movements'] });
      qc.invalidateQueries({ queryKey: ['planning-rebalance'] });
    } catch (e) {
      setState('error');
      const err = e as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error ?? 'Falha ao solicitar. Tente novamente.');
    }
  };

  return (
    <tr>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>{s.description}</span>
          <Confidence value={s.confidence} />
        </div>
        <div className="muted" style={{ fontSize: 11.5 }}>{s.reason}</div>
        <WhyNote text={s.friendlyReason} />
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {s.fromStoreName.replace('Nova Ótica — ', '')} <span className="muted">→</span>{' '}
        <strong>{s.toStoreName.replace('Nova Ótica — ', '')}</strong>
      </td>
      <td className="num">
        {s.quantity}
        {/* O que SOBRA na origem, ao lado do que sai dela. É a conferência que
            o lojista fazia de cabeça antes de recusar a sugestão — "vai me
            deixar sem?" — e não custa nada responder antes de ele perguntar.
            A condição fica escrita: cada linha tem botão próprio, o número é o
            piso de quem aprovar TODAS as desta peça, e um piso que se anuncia
            como certeza é pior do que piso nenhum. */}
        <div className="muted" style={{ fontSize: 11, whiteSpace: 'normal', lineHeight: 1.25 }}>
          aprovando todas desta peça, a origem fica com {s.fromRemainingUnits}
        </div>
      </td>
      <td className="num">
        {s.toCoverageDays === null ? '—' : `${s.toCoverageDays}d`}
        {s.stockoutInDays !== null && (
          <div style={{ fontSize: 11, color: 'var(--red)' }}>
                          {s.stockoutInDays === 0 ? 'já em falta' : `falta em ~${s.stockoutInDays}d`}
                        </div>
        )}
      </td>
      <td className="right" style={{ whiteSpace: 'nowrap' }}>
        {state === 'done' ? (
          <Selo tom="green" icone="check">Solicitada</Selo>
        ) : (
          <Botao pequeno icone="transferencias" onClick={request} disabled={state === 'loading'}>
            {state === 'loading' ? 'Solicitando…' : 'Solicitar transferência'}
          </Botao>
        )}
        {state === 'error' && (
          <div
            style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--red)', marginTop: 4 }}
          >
            <Icon name="atencao" size={12} />
            {error}
          </div>
        )}
      </td>
    </tr>
  );
}

/** Editor de prazo por fornecedor — admin. */
function SupplierRow({
  brand,
  leadTimeDays,
  products,
  isDefault,
  defaultDays,
  canEdit,
}: {
  brand: string;
  leadTimeDays: number | null;
  products: number;
  isDefault: boolean;
  defaultDays: number;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState(leadTimeDays === null ? '' : String(leadTimeDays));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const save = async () => {
    setState('saving');
    try {
      await setSupplierLeadTime(brand, value.trim() === '' ? null : Number(value));
      setState('saved');
      qc.invalidateQueries({ queryKey: ['planning-suppliers'] });
      recarregarDoTopo(qc, 'purchase-suggestions');
      // O prazo de entrega entra em `minCover = leadTimeDays + safetyDays`, que
      // é o corte de quem precisa receber peça. Mudar o prazo e não refazer o
      // remanejamento deixava a aba ao lado com um plano calculado sobre a
      // régua antiga — sem nada na tela dizendo isso.
      qc.invalidateQueries({ queryKey: ['planning-rebalance'] });
      window.setTimeout(() => setState('idle'), 1600);
    } catch {
      setState('error');
    }
  };

  return (
    <tr>
      <td>{brand}</td>
      <td className="num">{products}</td>
      <td className="num">
        {canEdit ? (
          <input
            type="number"
            min={1}
            max={365}
            value={value}
            placeholder={`${defaultDays} (padrão)`}
            onChange={(e) => setValue(e.target.value)}
            style={{ width: 110, textAlign: 'right' }}
            aria-label={`Prazo de entrega de ${brand} em dias`}
          />
        ) : (
          <span>{leadTimeDays ?? defaultDays} dias{isDefault ? ' (padrão)' : ''}</span>
        )}
      </td>
      {canEdit && (
        <td className="right">
          <Botao
            variante="discreto"
            pequeno
            icone={state === 'saved' ? 'check' : undefined}
            onClick={save}
            disabled={state === 'saving'}
          >
            {state === 'saving' ? 'Salvando…' : state === 'saved' ? 'Salvo' : 'Salvar'}
          </Botao>
          {state === 'error' && (
            <div
              style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--red)' }}
            >
              <Icon name="atencao" size={12} />
              Erro ao salvar
            </div>
          )}
        </td>
      )}
    </tr>
  );
}

/**
 * Mix de grifes (feedback 6.0 · item 03) — "sugere grifes que inclusive não
 * fazem mais parte de nosso mix de produto".
 *
 * Lista separada da de fornecedores de propósito, e não por organização de
 * tela: são chaves diferentes. Prazo de entrega é do FORNECEDOR ("Luxottica
 * entrega em 30 dias"); mix é da GRIFE ("a rede não trabalha mais Ray-Ban").
 * Enquanto as duas dividiram a mesma tabela, esta marcação era oferecida
 * sobre nomes de razão social que o motor nunca consulta — dava para marcar
 * e não acontecia nada.
 */
function BrandMixRow({ brand, products, discontinued, canEdit }: {
  brand: string;
  products: number;
  discontinued: boolean;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');

  const alternar = async (valor: boolean) => {
    setState('saving');
    try {
      await setGrifeForaDoMix(brand, valor);
      // A sugestão de compra e o quadro de decisões mudam com isto: as duas
      // precisam ser refeitas, senão a tela ao lado continua mostrando a
      // compra da grife que acabou de sair do mix.
      //
      // `'decisions'`, e não `'decision-board'`: a chave do quadro é
      // `['decisions', params]` (Decisions.tsx). O nome errado não dava erro
      // nenhum — `invalidateQueries` numa chave que não existe é uma operação
      // válida sobre o conjunto vazio — e por isso o quadro simplesmente não
      // era refeito, calado, desde que a linha foi escrita.
      await qc.invalidateQueries({ queryKey: ['planning-brand-mix'] });
      recarregarDoTopo(qc, 'purchase-suggestions');
      recarregarDoTopo(qc, 'decisions');
      await qc.invalidateQueries({ queryKey: ['planning-orders'] });
      setState('idle');
    } catch {
      setState('error');
    }
  };

  return (
    <tr>
      <td>
        {brand}{' '}
        {/* Uma grife marcada que não casa com produto nenhum é uma marcação
            inerte — nome digitado diferente, ou grife que saiu do catálogo. A
            linha continua visível justamente para poder ser desmarcada. */}
        {products === 0 && (
          <Selo tom="amber" icone="atencao">sem produto no catálogo</Selo>
        )}
      </td>
      <td className="num">{products}</td>
      <td className="num">
        {canEdit ? (
          <label
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
            title="Marcada: o motor para de sugerir compra desta grife. A liquidação e o remanejamento continuam."
          >
            <input
              type="checkbox"
              checked={discontinued}
              disabled={state === 'saving'}
              onChange={(e) => void alternar(e.target.checked)}
              aria-label={`${brand} está fora do mix atual da rede`}
            />
            fora do mix
          </label>
        ) : discontinued ? (
          <Selo tom="amber" icone="atencao">Fora do mix</Selo>
        ) : (
          <span className="muted">—</span>
        )}
        {state === 'error' && (
          <div style={{ fontSize: 11, color: 'var(--red)' }}>
            <Icon name="atencao" size={12} /> Erro ao salvar
          </div>
        )}
      </td>
    </tr>
  );
}

/** Tabela do mix de grifes, com busca — são dezenas de linhas. */
function MixDeGrifes({ canEdit }: { canEdit: boolean }) {
  const mix = useQuery({ queryKey: ['planning-brand-mix'], queryFn: getMixDeGrifes });
  const [busca, setBusca] = useState('');

  const linhas = (mix.data?.rows ?? []).filter((r) =>
    busca.trim() === '' ? true : r.brand.toLowerCase().includes(busca.trim().toLowerCase()),
  );
  const fora = (mix.data?.rows ?? []).filter((r) => r.discontinued).length;

  return (
    <>
      <AberturaDeSecao
        eyebrow="Mix"
        titulo="Grifes fora do mix"
        descricao="Marque as grifes que a rede parou de trabalhar. O motor deixa de sugerir COMPRA delas — e só isso: a liquidação continua (grife descontinuada com saldo é exatamente o que se quer escoar) e o remanejamento também. Nenhum dado do ERP diz que uma grife saiu do mix; é decisão comercial e precisa ser declarada aqui."
      />
      <div className="card">
        {mix.isLoading || !mix.data ? (
          <Loading />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <input
                type="search"
                value={busca}
                placeholder="Buscar grife…"
                onChange={(e) => setBusca(e.target.value)}
                aria-label="Buscar grife"
                style={{ maxWidth: 260 }}
              />
              <span className="muted" style={{ fontSize: 12 }}>
                {mix.data.rows.length} grifes · {fora} fora do mix
              </span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Grife</th>
                  <th className="num">Produtos</th>
                  <th className="num">Mix</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((r) => (
                  <BrandMixRow
                    key={r.brand}
                    brand={r.brand}
                    products={r.products}
                    discontinued={r.discontinued}
                    canEdit={canEdit}
                  />
                ))}
              </tbody>
            </table>
            {linhas.length === 0 && (
              <p className="muted" style={{ marginTop: 12 }}>Nenhuma grife com esse nome.</p>
            )}
          </>
        )}
      </div>
    </>
  );
}

/**
 * MIX POR LOJA — quais lojas trabalham cada grife.
 *
 * A tela existe por causa de um defeito que o cliente reportou DUAS rodadas
 * seguidas, com o mesmo exemplo: "Dior para Guarabira ainda continua
 * aparecendo". A regra sempre esteve no motor. A LISTA morava num arquivo JSON
 * no disco do servidor, e o arquivo nunca chegou ao contêiner — `/health` dizia
 * `mix.ativo: false` desde sempre, e nada mais dizia.
 *
 * Consertar seria copiar o arquivo. O que se fez foi outra coisa: uma regra
 * COMERCIAL não pode morar em artefato que só o deploy sabe colocar no lugar.
 * Quem sabe onde a Chanel pode ser vendida é o cliente, e agora ele declara,
 * vê e corrige aqui — sem intermediário e sem publicação no meio.
 *
 * A SEMÂNTICA É ASSIMÉTRICA, e a tela precisa dizer isso em voz alta: grife sem
 * nenhuma loja marcada é CORRENTE (vendida em todas), não proibida. É o estado
 * da esmagadora maioria do catálogo, e trocar os dois sentidos travaria a rede
 * inteira no dia em que alguém salvasse a primeira grife.
 */
function MixPorLoja({ canEdit }: { canEdit: boolean }) {
  const mix = useQuery({ queryKey: ['planning-mix-por-loja'], queryFn: getMixPorLoja });
  const grifes = useQuery({ queryKey: ['planning-brand-mix'], queryFn: getMixDeGrifes });
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<string | null>(null);

  const declaradoPor = new Map((mix.data?.rows ?? []).map((r) => [r.brand, r]));

  // As grifes ofertadas são as que o MOTOR conhece (`analysisBrand`), a mesma
  // lista da tabela de cima — e não os fornecedores do ERP. Marcar "Chanel"
  // numa lista que só tem "LUXOTTICA BRASIL PRODUTOS OTICOS LTDA" foi
  // exatamente o defeito da rodada passada, e não vale a pena repeti-lo aqui.
  //
  // Uma grife declarada que sumiu do catálogo continua na lista, com o aviso:
  // escondê-la deixaria a restrição valendo no banco sem tela para desfazê-la.
  const doCatalogo = (grifes.data?.rows ?? []).map((g) => g.brand);
  const orfas = [...declaradoPor.keys()].filter((b) => !doCatalogo.includes(b));
  const todas = [...doCatalogo, ...orfas];

  const filtro = busca.trim().toLowerCase();
  const linhas = todas
    .filter((b) => (filtro === '' ? true : b.toLowerCase().includes(filtro)))
    // As restritas primeiro: são as decisões tomadas, e é o que se volta a
    // conferir. As correntes são o padrão e não precisam ser lidas.
    .sort((a, b) => {
      const da = declaradoPor.has(a) ? 0 : 1;
      const db = declaradoPor.has(b) ? 0 : 1;
      return da - db || a.localeCompare(b, 'pt-BR');
    })
    // Sem busca, mostra só as restritas: a lista completa tem centenas de
    // grifes correntes, e rolar por elas para achar as quatro que importam é
    // o contrário do que esta tela serve.
    .slice(0, filtro === '' ? declaradoPor.size : 60);

  return (
    <>
      <AberturaDeSecao
        eyebrow="Mix"
        titulo="Quais lojas trabalham cada grife"
        descricao="Grife sem loja marcada é corrente: vendida em todas. Marcar lojas restringe a grife a elas — o motor deixa de sugerir compra, remanejamento e distribuição da grife para as demais. Nenhum dado do ERP diz isso; é contrato com o fornecedor e precisa ser declarado aqui."
        acoes={
          declaradoPor.size > 0 ? (
            <Selo tom="blue" icone="lojas" title="Grifes com lojas declaradas.">
              {declaradoPor.size} grifes restritas
            </Selo>
          ) : undefined
        }
      />
      <div className="card">
        {mix.isLoading || grifes.isLoading || !mix.data ? (
          <Loading />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <input
                type="search"
                value={busca}
                placeholder="Buscar grife para restringir…"
                onChange={(e) => setBusca(e.target.value)}
                aria-label="Buscar grife"
                style={{ maxWidth: 280 }}
              />
              <span className="muted" style={{ fontSize: 12 }}>
                {filtro === ''
                  ? `${declaradoPor.size} restritas · busque para restringir outra`
                  : `${linhas.length} de ${todas.length} grifes`}
              </span>
            </div>

            {linhas.length === 0 ? (
              <p className="muted">
                {filtro === ''
                  ? 'Nenhuma grife restrita. Todas são vendidas em todas as lojas — busque uma grife acima para restringi-la.'
                  : 'Nenhuma grife com esse nome.'}
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Grife</th>
                    <th>Lojas que trabalham</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((brand) => (
                    <LinhaDoMixPorLoja
                      key={brand}
                      brand={brand}
                      declarado={declaradoPor.get(brand) ?? null}
                      lojas={mix.data.lojas}
                      canEdit={canEdit}
                      aberto={editando === brand}
                      abrir={() => setEditando(editando === brand ? null : brand)}
                      fechar={() => setEditando(null)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </>
  );
}

function LinhaDoMixPorLoja({
  brand,
  declarado,
  lojas,
  canEdit,
  aberto,
  abrir,
  fechar,
}: {
  brand: string;
  declarado: { storeIds: string[]; stores: { id: string; name: string | null }[] } | null;
  lojas: { id: string; name: string }[];
  canEdit: boolean;
  aberto: boolean;
  abrir: () => void;
  fechar: () => void;
}) {
  const qc = useQueryClient();
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  // A seleção em edição é local: só vai ao servidor no "Salvar". Salvar a cada
  // clique mandaria a grife para um estado intermediário real — a Chanel
  // restrita a uma loja só, entre o primeiro e o segundo clique — e nesse
  // intervalo o motor decidiria com ele.
  const [sel, setSel] = useState<Set<string>>(new Set(declarado?.storeIds ?? []));

  const salvar = async (ids: string[]) => {
    setState('saving');
    try {
      await declararMixDaGrife(brand, ids);
      await qc.invalidateQueries({ queryKey: ['planning-mix-por-loja'] });
      // As mesmas quatro consultas do "fora do mix": compra, quadro, pedidos e
      // remanejamento mudam TODOS com esta decisão. Deixar qualquer uma de
      // fora faz a tela ao lado seguir mostrando a sugestão que acabou de ser
      // proibida — e o cliente já viu essa cena.
      recarregarDoTopo(qc, 'purchase-suggestions');
      recarregarDoTopo(qc, 'decisions');
      await qc.invalidateQueries({ queryKey: ['planning-orders'] });
      await qc.invalidateQueries({ queryKey: ['planning-rebalance'] });
      setState('idle');
      fechar();
    } catch {
      setState('error');
    }
  };

  const nomes = (declarado?.stores ?? []).map((s) => s.name ?? '(loja fora do escopo)');

  return (
    <>
      <tr>
        <td>{brand}</td>
        <td>
          {declarado && declarado.storeIds.length > 0 ? (
            <span>{nomes.join(', ')}</span>
          ) : (
            <span className="muted">Todas as lojas (grife corrente)</span>
          )}
        </td>
        <td className="num">
          {canEdit && (
            <Botao
              onClick={() => {
                setSel(new Set(declarado?.storeIds ?? []));
                abrir();
              }}
              aria-expanded={aberto}
            >
              {aberto ? 'Fechar' : declarado ? 'Alterar' : 'Restringir'}
            </Botao>
          )}
        </td>
      </tr>
      {aberto && canEdit && (
        <tr>
          <td colSpan={3}>
            <div style={{ padding: '10px 0' }}>
              <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                Marque as lojas que trabalham <strong>{brand}</strong>. Sem nenhuma marcada, a grife
                volta a ser vendida em todas.
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
                  gap: 6,
                }}
              >
                {lojas.map((l) => (
                  <label key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={sel.has(l.id)}
                      onChange={(e) => {
                        const s = new Set(sel);
                        if (e.target.checked) s.add(l.id);
                        else s.delete(l.id);
                        setSel(s);
                      }}
                    />
                    {l.name}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                <BotaoPrimario onClick={() => salvar([...sel])} disabled={state === 'saving'}>
                  {state === 'saving' ? 'Salvando…' : `Salvar (${sel.size} lojas)`}
                </BotaoPrimario>
                <Botao onClick={fechar}>Cancelar</Botao>
                {declarado && (
                  <Botao onClick={() => salvar([])} disabled={state === 'saving'}>
                    Voltar a ser corrente
                  </Botao>
                )}
                {state === 'error' && (
                  <span className="muted" style={{ color: 'var(--nf-danger, crimson)', fontSize: 12 }}>
                    Não foi possível salvar. Tente de novo.
                  </span>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Modo Feira (feedback 08): lançamentos comprados em feira não têm histórico
 * próprio. Escolhida a marca ou o grupo e a quantidade total, rateia a compra
 * entre as lojas pela participação de cada uma nas vendas daquele recorte.
 */
function FairSplit() {
  const suppliers = useQuery({ queryKey: ['planning-suppliers'], queryFn: getSupplierSettings });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => getCategories() });
  const [mode, setMode] = useState<'brand' | 'category'>('brand');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [qty, setQty] = useState('100');
  const [days, setDays] = useState(() => periodoInicial(PERIODOS_RATEIO, 180));
  const [submitted, setSubmitted] = useState<{ brand?: string; category?: string; qty: string; days: string } | null>(null);

  const split = useQuery({
    queryKey: ['fair-split', submitted],
    queryFn: () => getFairSplit({ ...submitted!, qty: submitted!.qty, days: submitted!.days }),
    enabled: submitted !== null,
  });

  const qtyNum = Math.trunc(Number(qty));
  const qtyOk = Number.isFinite(qtyNum) && qtyNum >= 1 && qtyNum <= 100_000;
  const recorteOk = mode === 'brand' ? !!brand : !!category;
  const canRun = recorteOk && qtyOk;
  const run = () => {
    if (!canRun) return;
    setSubmitted(mode === 'brand' ? { brand, qty: String(qtyNum), days } : { category, qty: String(qtyNum), days });
  };

  return (
    <>
    <AberturaDeSecao
      eyebrow="Feira"
      titulo="Modo Feira — como distribuir uma compra nova"
      descricao="Lançamentos de feira não têm histórico. Escolha a marca ou o grupo, a quantidade comprada, e o sistema rateia entre as lojas pela participação de cada uma nas vendas desse recorte (a soma bate exatamente com o total)."
    />
    <div className="card">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <div className="segmented">
          <button type="button" className={mode === 'brand' ? 'active' : ''} onClick={() => setMode('brand')}>Por marca</button>
          <button type="button" className={mode === 'category' ? 'active' : ''} onClick={() => setMode('category')}>Por grupo</button>
        </div>
        {mode === 'brand' ? (
          <select value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Marca">
            <option value="">Escolha a marca…</option>
            {suppliers.data?.rows.map((s) => (
              <option key={s.brand} value={s.brand}>{s.brand}</option>
            ))}
          </select>
        ) : (
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Grupo">
            <option value="">Escolha o grupo…</option>
            {categories.data?.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        <label className="muted">Comprei</label>
        <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          style={{ width: 90 }}
          aria-label="Quantidade total comprada"
        />
        <label className="muted">un., histórico</label>
        <select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Janela de histórico">
          {opcoesDePeriodo(PERIODOS_RATEIO).map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        {/* O ÚNICO sólido da tela.
            Planejamento & Compras é uma tela de muitas ações, mas todas as
            outras são de LINHA e se repetem N vezes (solicitar transferência
            por sugestão, registrar envio por fornecedor, salvar prazo por
            marca) — nenhuma delas pode carregar o ouro preenchido sem virar
            uma parede de ouro. "Distribuir" é a única ação que existe uma vez
            só na página e que produz uma decisão nova: quanto de uma compra de
            feira vai para cada uma das 19 lojas. Por isso o primário é ele. */}
        <BotaoPrimario icone="transferencias" disabled={!canRun} aria-disabled={!canRun} onClick={run}>
          Distribuir
        </BotaoPrimario>
      </div>

      <LegendaDaAmostra days={days} />

      {submitted && (
        split.isLoading ? (
          <Loading />
        ) : split.data && split.data.totalSold === 0 ? (
          <div className="empty" style={{ marginTop: 12 }}>
            Nenhuma venda desse recorte no período — sem base para ratear. Escolha outro período ou distribua manualmente.
          </div>
        ) : split.data ? (
          <>
            <div className="row-between" style={{ marginTop: 12, marginBottom: 8 }}>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {split.data.totalQty} un. rateadas por {split.data.totalSold} vendas do período em{' '}
                {split.data.rows.filter((r) => r.suggestedQty > 0).length} lojas.
              </div>
              <ExportCsv
                rows={split.data.rows}
                filename={`modo-feira-${submitted.brand ?? submitted.category}-${submitted.qty}un`}
                columns={[
                  { key: 'storeName', label: 'Loja' },
                  { key: 'unitsSold', label: 'Vendas do período' },
                  { key: 'sharePct', label: '% participação' },
                  { key: 'stockUnits', label: 'Estoque atual' },
                  { key: 'suggestedQty', label: 'Comprar p/ loja' },
                ]}
              />
            </div>
            <table>
              <thead>
                <tr>
                  <th>Loja</th>
                  <th className="num">Vendas no período</th>
                  <th className="num">Participação</th>
                  <th className="num">Estoque atual</th>
                  <th className="num">Enviar</th>
                </tr>
              </thead>
              <tbody>
                {split.data.rows.map((r) => (
                  <tr key={r.storeId}>
                    <td>{r.storeName}</td>
                    <td className="num">{r.unitsSold}</td>
                    <td className="num">{r.sharePct.toFixed(1)}%</td>
                    <td className="num">{r.stockUnits}</td>
                    <td className="num">
                      {r.suggestedQty > 0 ? <strong>{r.suggestedQty}</strong> : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null
      )}
    </div>
    </>
  );
}

export function Planning() {
  const { isAdmin } = useAuth();
  const [days, setDays] = useState(() => periodoInicial(PERIODOS_ANALISE, 90));
  const [storeId, setStoreId] = useState('');
  // Recorte de cobertura: a operação fala de "cobertura" como óculos + grau +
  // relógio (principal); lentes são acompanhadas à parte; consolidado é tudo.
  const [group, setGroup] = useState<ProductGroup>('principal');
  const [filter, setFilter] = useState<Filter>('ALL');
  const rebalanceRef = useRef<HTMLDivElement>(null);
  const ordersRef = useRef<HTMLDivElement>(null);
  const purchaseRef = useRef<HTMLDivElement>(null);

  const stores = useQuery({ queryKey: ['stores', 'planejaveis'], queryFn: () => getStores('planejaveis'), enabled: isAdmin });
  const params = { days, storeId: storeId || undefined, group };

  /*
   * Feedback 6.0 · item 05 — "separar as abas de transferência entre lojas da
   * aba de Compras".
   *
   * As duas frentes viviam empilhadas na mesma rolagem, e é a ordem certa de
   * PENSAR (redistribuir antes de comprar) apresentada como ordem de LER — o
   * que faz o comprador atravessar a tabela de transferências toda vez que
   * quer ver o pedido. Viram duas frentes com o mesmo peso.
   *
   * Abre em "Transferir" de propósito: é a decisão que não gasta dinheiro, e o
   * título da seção sempre disse "antes de comprar".
   *
   * A TERCEIRA FRENTE veio na rodada seguinte — "ainda sem a aba de
   * distribuição para as lojas". O rateio existia desde o feedback 6.0 e
   * funcionava; o que não existia era a PORTA. Ele morava dentro de uma linha
   * do histórico de pedidos, atrás de um botão "Como distribuir", visível só
   * para quem já tivesse rolado até lá e só depois de confirmar o recebimento.
   *
   * As três frentes são o ciclo inteiro na ordem em que ele acontece:
   * redistribuir o que já existe → comprar o que falta → repartir o que
   * chegou. A terceira era a única sem entrada própria.
   */
  const [frente, setFrente] = useState<'transferir' | 'comprar' | 'distribuir'>('transferir');

  /*
   * Feedback 6.0 · item 10 — "adicionar ao planejamento de pedido apenas as
   * indicações dos cards aprovados".
   *
   * Padrão DESLIGADO, e não é hesitação: ligado por padrão, a tela de pedidos
   * amanheceria vazia no dia da publicação, porque ninguém aprovou nada ainda.
   * Tela vazia logo depois de um deploy é indistinguível de tela quebrada para
   * quem a abre. O botão fica à vista, diz o que faz, e a operação vira a
   * chave quando o fluxo de aprovação estiver rodando.
   */
  const [somenteAprovados, setSomenteAprovados] = useState(false);
  // O recorte por recomendação virou pergunta ao servidor pelo mesmo motivo do
  // quadro de decisões: as linhas vêm paginadas, e filtrar a PÁGINA mostraria
  // "nenhum item nesta categoria" com a lista cheia deles logo adiante.
  const sugParams = {
    ...params,
    recomendacao: filter === 'ALL' ? undefined : filter,
  };

  const overview = useQuery({ queryKey: ['planning-overview', days, storeId, group], queryFn: () => getPlanningOverview(params) });
  // Mesmo conserto do quadro de decisões, pela mesma razão: "ver mais" pedia um
  // `pageSize` cada vez maior e nunca mandava `page`. A rota prende o tamanho
  // em 2.000 linhas, então a partir do 20º clique a tabela parava de crescer,
  // o rótulo seguia prometendo "11.000 restantes" e as linhas 2.001+ ficavam
  // inalcançáveis — cada clique inútil pagando um recálculo completo das
  // sugestões. Agora se pede a PÁGINA seguinte, com tamanho fixo, e a tela
  // acumula.
  //
  // `signal` vai ao axios para a requisição em voo morrer quando a chave muda;
  // `keepPreviousData` evita que a tabela volte a "Carregando…" a cada clique.
  const suggestions = useInfiniteQuery({
    queryKey: ['purchase-suggestions', sugParams],
    queryFn: ({ pageParam, signal }) =>
      getPurchaseSuggestions({ ...sugParams, ...pageParam, pageSize: LINHAS_POR_CLIQUE }, signal),
    initialPageParam: { page: 1 } as PedidoDePagina,
    // Âncora: o SKU da última linha desta resposta — ver `proximoPedido`.
    getNextPageParam: (ultima) =>
      proximoPedido(ultima.pagina, ultima.rows[ultima.rows.length - 1]?.productId),
    placeholderData: keepPreviousData,
  });
  const rebalance = useQuery({ queryKey: ['planning-rebalance', days, group], queryFn: () => getRebalancePlan({ days, group }) });
  const orders = useQuery({
    queryKey: ['planning-orders', days, storeId, group, somenteAprovados],
    queryFn: () => getPurchaseOrders({ ...params, somenteAprovados: somenteAprovados ? 1 : undefined }),
  });
  const suppliers = useQuery({ queryKey: ['planning-suppliers'], queryFn: getSupplierSettings });

  const sugPaginas = suggestions.data?.pages;
  /** A resposta mais recente: dela saem o resumo e o tamanho da vista. */
  const ultimaSug = sugPaginas?.[sugPaginas.length - 1];
  const filteredRows = juntarPaginas(
    sugPaginas?.map((p) => p.rows),
    (r) => r.productId,
  );
  /** Linhas que a vista ainda tem para entregar — não as que já estão na tela. */
  const faltamLinhas = restantes(ultimaSug?.pagina, filteredRows.length);
  // Trocar o recorte muda a chave da consulta e a acumulação recomeça na
  // primeira página sozinha — não há mais contador para zerar à mão.
  const buscandoSug = suggestions.isFetching;

  // "Risco de faltar" vem CONTADO do servidor. A tela percorria as 13 mil
  // linhas para chegar a este inteiro, o que obrigava a baixar as 13 mil.
  const urgentCount = ultimaSug?.summary.emRisco ?? 0;

  const goTo = (ref: typeof purchaseRef, f?: Filter) => {
    if (f) setFilter(f);
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const summary = ultimaSug?.summary;
  const reb = rebalance.data;

  return (
    <>
      <PageHeader
        title="Planejamento & Compras"
        subtitle="Cruza as vendas recentes de cada loja com o estoque atual e diz o que transferir, o que comprar (respeitando o prazo de cada fornecedor) e o que liquidar."
      />

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Grupo de cobertura">
          {GROUP_OPTIONS.map((g) => (
            <button
              key={g.value}
              type="button"
              className={group === g.value ? 'active' : ''}
              aria-pressed={group === g.value}
              onClick={() => setGroup(g.value)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Período de análise">
          {opcoesDePeriodo(PERIODOS_ANALISE).map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        {isAdmin && (
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Escopo de loja">
            <option value="">Toda a rede</option>
            {stores.data?.rows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="muted" style={{ fontSize: 12.5, margin: '-14px 0 18px' }}>
        {GROUP_OPTIONS.find((g) => g.value === group)!.hint}
      </div>

      <LegendaDaAmostra days={days} />

      {/* ── O que fazer hoje: prioridades em 1 olhada, ação em 1 clique ──
          É o painel de decisão da tela, e por isso ganha a abertura completa do
          manual: régua dourada abrindo a seção, sobretítulo em mono e, dentro
          de cada cartão, a gramática única do indicador — RÓTULO em mono caixa
          alta, NÚMERO herói em Fraunces, frase de apoio em Inter. O rótulo
          subiu para cima do número (era .action-label, em Inter semibold,
          embaixo): é a ordem do <StatCard> e a única que impede a frase de 12px
          pesar mais que o nome do cartão. */}
      {/* ONDA 5 · A régua e o sobretítulo estavam soltos, sem título — e o
          sobretítulo tinha 16 caracteres em mono CAIXA ALTA a 0.18em, acima do
          limite de ~14 em que a entreletras deixa de separar letras e passa a
          desmanchar a palavra. O nome inteiro desceu para o título, em Fraunces,
          onde ele se LÊ; o sobretítulo ficou com uma palavra, que é a dose que o
          de-para pede. É a mesma abertura que as outras seis seções desta tela
          passaram a usar — e é o que faz esta ser reconhecível como a primeira
          entre iguais, em vez de flutuar. */}
      <AberturaDeSecao
        eyebrow="Hoje"
        titulo="O que fazer hoje"
        descricao="As quatro frentes do dia. Clique em uma para pular direto para o bloco que a resolve."
      />
      <div className="grid grid-4 action-center">
        <button type="button" className="card action-card red" onClick={() => goTo(purchaseRef, 'BUY')}>
          <div className="label">Risco de faltar</div>
          <div className="action-count" style={contadorHeroi}>{urgentCount}</div>
          <div className="hint">
            {urgentCount > 0 ? 'sem estoque na rede para a demanda — pedir já' : 'nenhum item em risco na rede'}
          </div>
        </button>
        <button type="button" className="card action-card blue" onClick={() => goTo(rebalanceRef)}>
          <div className="label">Transferências sugeridas</div>
          <div className="action-count" style={contadorHeroi}>{reb?.summary.suggestions ?? '…'}</div>
          <div className="hint">{reb ? `${reb.summary.units} un. já existem na rede — sem gastar nada` : 'cruzando vendas × estoque'}</div>
        </button>
        <button type="button" className="card action-card green" onClick={() => goTo(ordersRef)}>
          <div className="label">Pedidos a fazer</div>
          <div className="action-count" style={contadorHeroi}>{summary?.buy ?? '…'}</div>
          <div className="hint">
            {!summary
              ? ''
              : summary.buy > 0
                ? `${formatBRL(summary.buyCapital)} no prazo de cada fornecedor`
                : 'nada a comprar agora'}
          </div>
        </button>
        <button type="button" className="card action-card amber" onClick={() => goTo(purchaseRef, 'LIQUIDATE')}>
          <div className="label">Excesso &amp; parados</div>
          <div className="action-count" style={contadorHeroi}>{summary ? summary.liquidate + summary.dontBuy : '…'}</div>
          <div className="hint">{summary ? `${formatBRL(summary.avoidedCapital)} para não repor / liberar` : ''}</div>
        </button>
      </div>

      {/* ── 1º: redistribuir o que já existe (não custa nada) ──
          A frase da descrição trazia um ← apontando para trás no meio do texto:
          seta como pontuação até funciona ("De → Para"), mas invertida ela
          obriga a ler a linha de trás para frente. Reescrita no sentido da
          leitura, sem glifo nenhum. */}
      {/* As TRÊS frentes, com o mesmo peso — o ciclo na ordem em que acontece:
          redistribuir o que já existe → comprar o que falta → repartir o que
          chegou. A terceira era a única sem entrada própria. */}
      <div className="segmented" role="group" aria-label="Frente de trabalho" style={{ marginTop: 18 }}>
        {(['transferir', 'comprar', 'distribuir'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={frente === f ? 'active' : ''}
            onClick={() => setFrente(f)}
            aria-pressed={frente === f}
          >
            {f === 'transferir'
              ? 'Transferir entre lojas'
              : f === 'comprar'
                ? 'Comprar de fornecedor'
                : 'Distribuir para as lojas'}
          </button>
        ))}
      </div>

      {frente === 'transferir' && (
      <>
      <AberturaDeSecao
        eyebrow="Remanejar"
        titulo="Redistribuir entre lojas (antes de comprar)"
        descricao="O produto sai de onde está parado ou sobrando e vai para onde ele vende e está acabando. Visão de toda a rede."
        acoes={
          reb && reb.rows.length > 0 ? (
            <Selo tom="blue" icone="transferencias" title="Total do plano de redistribuição desta visão.">
              {reb.summary.units} un. em {reb.summary.storesInvolved} lojas
            </Selo>
          ) : undefined
        }
      />
      <div className="card" ref={rebalanceRef}>
        {rebalance.isLoading ? (
          <Loading />
        ) : (reb?.rows.length ?? 0) === 0 ? (
          <TudoCerto>Estoque bem distribuído entre as lojas — nenhuma transferência necessária.</TudoCerto>
        ) : (
          <table style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Produto · por quê</th>
                <th>De → para</th>
                <th className="num">Qtde</th>
                <th className="num">Cobertura no destino</th>
                <th className="right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {reb!.rows.slice(0, 20).map((s) => (
                <RebalanceRow key={`${s.productId}:${s.fromStoreId}:${s.toStoreId}`} s={s} />
              ))}
            </tbody>
          </table>
        )}
        {reb && <NotaDeIdadeEstimada guards={reb.guards} />}
      </div>

      {/* ── 2º: pedidos prontos por fornecedor, com total e data-limite ── */}
      </>
      )}

      {frente === 'comprar' && (
      <>
      <AberturaDeSecao
        eyebrow="Comprar"
        titulo="Pedidos por fornecedor (rascunho)"
        descricao="Itens a comprar agrupados por fornecedor, da maior confiança para a menor — o que o motor tem mais base para afirmar vem primeiro. A urgência continua na linha e desempata dentro de cada faixa: todo item aqui já está no ponto de reposição. Exporte e envie."
        acoes={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* SÓ OS APROVADOS — item 10. Sai desligado por decisão explícita:
                ligado por padrão, esta tela amanheceria vazia no dia da
                publicação, e tela vazia depois de deploy é indistinguível de
                tela quebrada. */}
            <Botao
              variante="discreto"
              pequeno
              icone={somenteAprovados ? 'aprovar' : 'filtro'}
              onClick={() => setSomenteAprovados((v) => !v)}
              title="Monta o pedido só com os itens cujo card de compra foi aprovado na Central de Decisões (últimos 30 dias)"
            >
              {somenteAprovados ? 'Só os aprovados ✓' : 'Só os aprovados'}
            </Botao>
            {orders.data && orders.data.orders.length > 0 ? (
              <Botao
                variante="discreto"
                pequeno
                icone="exportar"
                onClick={() => downloadCsv('pedidos-fornecedores', orders.data!.orders.map(orderCsv).join('\n\n'))}
              >
                Exportar tudo (CSV)
              </Botao>
            ) : null}
          </div>
        }
      />
      <div className="card" ref={ordersRef}>
        {orders.isLoading ? (
          <Loading />
        ) : (orders.data?.orders.length ?? 0) === 0 ? (
          <TudoCerto>Nenhum pedido a fazer agora — estoque coberto para a demanda atual.</TudoCerto>
        ) : (
          <>
            <div className="muted" style={{ fontSize: 12.5, margin: '10px 0' }}>
              {orders.data!.summary.suppliers} fornecedor{orders.data!.summary.suppliers === 1 ? '' : 'es'} ·{' '}
              {orders.data!.summary.items} itens · {orders.data!.summary.units} un. ·{' '}
              <strong>{formatBRL(orders.data!.summary.total)}</strong>
            </div>

            {/* PARA ONDE VAI, E QUANTO PARA CADA LOJA — item 07.
                "No planejamento de compras só aparece o total de peças mas não
                indica facilmente para onde vai."
                O rateio já existia, mas dentro de cada item, atrás de um clique.
                Somado aqui em cima, o comprador vê o destino do pedido inteiro
                antes de abrir item nenhum. */}
            <DestinoDoPedido orders={orders.data!.orders} />
            {/* Com uma loja selecionada não há rateio, e o silêncio sozinho
                pareceria falta de permissão ou defeito. */}
            {storeId && (
              <div className="hint" style={{ margin: '0 0 10px' }}>
                O rateio por loja só aparece na visão da rede: com uma loja selecionada, a
                quantidade sugerida já é a dessa loja e não há o que repartir.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {orders.data!.orders.map((o) => (
                <PurchaseOrderCard key={o.supplier} order={o} dias={orders.data!.days} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Ciclo: enviado → recebido, com pedidos em trânsito abatidos ── */}
      <OrderHistory />
      </>
      )}

      {frente === 'distribuir' && <FilaDeDistribuicao />}

      {/* ── 3º: análise completa item a item ── */}
      <div ref={purchaseRef}>
        <AberturaDeSecao
          eyebrow="Item a item"
          titulo="O que comprar (e o que não)"
          descricao="A análise completa por SKU, com o giro, a cobertura e o veredito do motor para cada um."
          acoes={
          /* Inertes enquanto há busca em voo: o recorte virou pergunta ao
             servidor, e cada pergunta reexecuta o motor inteiro. Quatro cliques
             na janela de uma resposta empilham quatro execuções concorrentes, e
             o processo tem 768 MB de heap. */
          <div className="segmented">
            {([
              ['ALL', 'Todos'],
              ['BUY', 'Comprar'],
              ['DONT_BUY', 'Não comprar'],
              ['LIQUIDATE', 'Liquidar'],
            ] as [Filter, string][]).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={filter === k ? 'active' : ''}
                disabled={buscandoSug}
                onClick={() => setFilter(k)}
                aria-pressed={filter === k}
              >
                {label}
              </button>
            ))}
          </div>
          }
        />

        {/* Feedbacks 6.0, item 02 ("ainda estou achando o número de sugestão de
            pedidos baixo"): o que faltava era o denominador. O motor não está
            calado — ele analisou os SKUs que a base carregada tem, e a base
            atual é uma AMOSTRA da grade do CDS. Dizer "126 de 440 analisados,
            num recorte que tem 5.849 na rede" transforma "está baixo" numa
            pergunta respondível. */}
        {summary?.analisados ? (
          <p className="muted" style={{ fontSize: 12.5, margin: '-6px 0 12px' }}>
            <strong>{summary.buy}</strong> sugestões de compra entre{' '}
            <strong>{summary.analisados.toLocaleString('pt-BR')}</strong> SKUs analisados.
            {summary.universo && summary.universo > summary.analisados ? (
              <>
                {' '}O recorte tem cerca de{' '}
                <strong>{summary.universo.toLocaleString('pt-BR')}</strong> SKUs na rede — a
                extração atual do CDS trouxe uma amostra da grade, e o motor só decide sobre o que
                enxerga.
              </>
            ) : null}
          </p>
        ) : null}

        {suggestions.isLoading || !ultimaSug ? (
          <Loading />
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Giro</th>
                  <th className="num">Estoque</th>
                  <th className="num">Vendas/dia</th>
                  <th className="num">Cobertura</th>
                  <th>Recomendação</th>
                  <th className="num">Confiança</th>
                  <th className="num">Comprar</th>
                  <th>Pedir até</th>
                  <th className="num">Capital</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr key={r.productId}>
                    <td>
                      {r.description}
                      <div className="muted" style={{ fontSize: 11 }}>
                        {r.brand ?? 'Sem marca'} · entrega em {r.leadTimeDays}d
                      </div>
                    </td>
                    <td>
                      <Selo
                        tom={moveMeta[r.movementClass].tom}
                        icone={moveMeta[r.movementClass].icone}
                        forte={moveMeta[r.movementClass].forte}
                      >
                        {moveMeta[r.movementClass].label}
                      </Selo>
                    </td>
                    <td className="num">
                      {r.currentStock}
                      {r.onOrderQty > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--accent)' }}>+{r.onOrderQty} a caminho</div>
                      )}
                    </td>
                    <td
                      className="num"
                      title={
                        r.forecast
                          ? `Previsão ${r.forecast.method} — base ${r.forecast.baseDaily}/dia × índice sazonal ${r.forecast.seasonalIndex} (mês ${r.forecast.targetMonth})`
                          : 'Média simples do período'
                      }
                    >
                      {r.dailyDemand}
                      {/* O sol e a seta de alta eram glifos fazendo papel de
                          ícone: mudam de largura e de desenho conforme a fonte
                          instalada e desalinham a coluna numérica. Aqui o ícone
                          é o ÚNICO rótulo do método de previsão, então leva
                          title — vira role="img" com nome acessível. */}
                      {r.forecast && r.forecast.method !== 'media' && (
                        <Icon
                          name={r.forecast.method === 'sazonal' ? 'calendario' : 'tendencia'}
                          size={13}
                          title={r.forecast.method === 'sazonal' ? 'Previsão sazonal' : 'Previsão por tendência'}
                          style={{ marginLeft: 5, color: 'var(--muted)' }}
                        />
                      )}
                    </td>
                    <td className="num">
                      {/* O infinito dizia "cobertura infinita", que na operação
                          quer dizer "não vendeu nada no período". A palavra é a
                          mesma que o selo de cobertura usa no resto do console. */}
                      {r.coverageDays === null ? <span className="muted">sem venda</span> : `${r.coverageDays}d`}
                      {r.stockoutInDays !== null && (
                        <div style={{ fontSize: 11, color: 'var(--red)' }}>
                          {r.stockoutInDays === 0 ? 'já em falta' : `falta em ~${r.stockoutInDays}d`}
                        </div>
                      )}
                    </td>
                    <td>
                      <Selo
                        tom={recMeta[r.recommendation].tom}
                        icone={recMeta[r.recommendation].icone}
                        forte={recMeta[r.recommendation].forte}
                        title={r.reason}
                      >
                        {recMeta[r.recommendation].label}
                      </Selo>
                      <WhyNote text={r.friendlyReason} />
                    </td>
                    <td className="num"><Confidence value={r.confidence} /></td>
                    <td className="num">{r.suggestedQty > 0 ? r.suggestedQty : '—'}</td>
                    <td>
                      {r.recommendation === 'BUY' ? (
                        <OrderBy inDays={r.orderByInDays} leadTimeDays={r.leadTimeDays} />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num">{r.capital > 0 ? formatBRL(r.capital) : '—'}</td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="empty">Nenhum item nesta categoria.</td>
                  </tr>
                )}
              </tbody>
            </table>
            {/* O corte é do SERVIDOR: "ver mais" busca a PÁGINA seguinte e a
                junta com o que já está na tabela. Quem sabe se ainda há página
                é o `pagina` da resposta (`hasNextPage`) — não uma comparação de
                tamanhos feita aqui, que era o que deixava o botão de pé
                prometendo linhas que a rota não entregava mais. */}
            {suggestions.hasNextPage && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
                <Botao
                  variante="discreto"
                  icone="mais"
                  disabled={buscandoSug}
                  onClick={() => suggestions.fetchNextPage()}
                >
                  {buscandoSug
                    ? 'Buscando…'
                    : `Ver mais ${Math.min(LINHAS_POR_CLIQUE, faltamLinhas)} de ${faltamLinhas} restantes`}
                </Botao>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Prazos por fornecedor: quem entrega rápido, quem demora ── */}
      <AberturaDeSecao
        eyebrow="Prazos"
        titulo="Prazos dos fornecedores (lead time)"
        descricao={`Cada fornecedor entrega num prazo diferente — o ponto de reposição e o “pedir até” de cada item usam o prazo do fornecedor daquele produto. Sem prazo definido, vale o padrão de ${suppliers.data?.defaultLeadTimeDays ?? 14} dias.`}
      />
      <div className="card">
        {suppliers.isLoading || !suppliers.data ? (
          <Loading />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th className="num">Produtos</th>
                <th className="num">Prazo de entrega</th>
                {isAdmin && <th className="right">Ação</th>}
              </tr>
            </thead>
            <tbody>
              {suppliers.data.rows.map((s) => (
                <SupplierRow
                  key={s.brand}
                  brand={s.brand}
                  leadTimeDays={s.leadTimeDays}
                  products={s.products}
                  isDefault={s.isDefault}
                  defaultDays={suppliers.data!.defaultLeadTimeDays}
                  canEdit={isAdmin}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Mix de grifes: o que a rede parou de trabalhar (ADMIN) ──
          Só o ADMIN, como o Modo Feira logo abaixo. A seção era renderizada
          para todo mundo em modo leitura, e a rota que a alimenta varre o
          catálogo inteiro a cada abertura — custo de rede pago por quem não
          tem decisão a tomar com a lista. Marcar sempre foi ADMIN. */}
      {isAdmin && <MixDeGrifes canEdit={isAdmin} />}

      {/* ── Mix POR LOJA: onde cada grife pode ser vendida (ADMIN) ──
          Vem logo depois da tabela acima porque as duas se leem juntas e são
          fáceis de confundir: aquela tira a grife da REDE, esta tira a grife
          de ALGUMAS LOJAS. Separadas por um título, na mesma dobra. */}
      {isAdmin && <MixPorLoja canEdit={isAdmin} />}

      {/* ── Modo Feira: distribuir uma compra nova entre as lojas (ADMIN) ── */}
      {isAdmin && <FairSplit />}

      {/* ── Panorama (secundário): capital imobilizado + Pareto ── */}
      {overview.isLoading || !overview.data ? (
        <Loading />
      ) : (
        <>
        <AberturaDeSecao
          eyebrow="Panorama"
          titulo="Onde o capital está parado"
          descricao="Leitura de fundo, para depois da decisão do dia: como o dinheiro da rede está distribuído e quais itens concentram o que não gira."
        />
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>Panorama do capital imobilizado</div>
            <Bar
              segments={[
                { value: overview.data.capital.healthy, color: 'var(--green)', label: 'Saudável' },
                { value: overview.data.capital.excess, color: 'var(--amber)', label: 'Excesso' },
                { value: overview.data.capital.parked, color: 'var(--red)', label: 'Parado (sem giro)' },
              ]}
            />
            {/* Legenda na MESMA ordem da barra. O terceiro item desenhava um
                .dot com background inline, o que lhe dava o preenchimento mas
                não a borda — e portanto não a FORMA cheia que separa "crítico"
                de "atenção" em escala de cinza. Passa a usar a classe. */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 12 }}>
              <span><span className="dot green" /> Saudável {formatBRL(overview.data.capital.healthy)}</span>
              <span><span className="dot amber" /> Excesso {formatBRL(overview.data.capital.excess)}</span>
              <span><span className="dot red" /> Parado {formatBRL(overview.data.capital.parked)}</span>
            </div>

            <div className="section-title" style={{ marginTop: 20 }}>Por categoria</div>
            <table>
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th className="num">Un.</th>
                  <th className="num">Capital</th>
                  <th className="num">Ocioso</th>
                </tr>
              </thead>
              <tbody>
                {overview.data.byCategory.map((c) => (
                  <tr key={c.category}>
                    <td>{c.category}</td>
                    <td className="num">{c.units}</td>
                    <td className="num">{formatBRL(c.capital)}</td>
                    <td className="num">
                      <Selo
                        tom={c.idle > 0 ? 'amber' : 'gray'}
                        icone={c.idle > 0 ? 'estoque' : 'aprovar'}
                        title={c.idle > 0 ? 'Capital ocioso nesta categoria.' : 'Sem capital ocioso nesta categoria.'}
                      >
                        {formatBRL(c.idle)}
                      </Selo>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="section-title">Lei de Pareto (80/20) — receita</div>
            <div className="banner ok" style={{ marginBottom: 14 }}>
              <span className="dot green" />
              <div>
                <strong>{overview.data.pareto.classAProducts} SKUs</strong> (classe A ={' '}
                {overview.data.pareto.classAShareOfSkus}% do catálogo) geram{' '}
                <strong>{overview.data.pareto.classARevenueShare}%</strong> da receita. Priorize disponibilidade
                desses itens.
              </div>
            </div>

            <div className="section-title">Maiores capitais parados (foco de ação)</div>
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Giro</th>
                  <th className="num">Cobertura</th>
                  <th className="num">Parado</th>
                </tr>
              </thead>
              <tbody>
                {overview.data.topIdle.map((x) => (
                  <tr key={x.productId}>
                    <td>{x.description}</td>
                    <td>
                      <Selo
                        tom={moveMeta[x.movementClass].tom}
                        icone={moveMeta[x.movementClass].icone}
                        forte={moveMeta[x.movementClass].forte}
                      >
                        {moveMeta[x.movementClass].label}
                      </Selo>
                    </td>
                    <td className="num">
                      {x.coverageDays === null ? <span className="muted">sem venda</span> : `${x.coverageDays}d`}
                    </td>
                    <td className="num">{formatBRL(x.idleValue)}</td>
                  </tr>
                ))}
                {overview.data.topIdle.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      <TudoCerto>Nenhum capital ocioso relevante.</TudoCerto>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}
    </>
  );
}
