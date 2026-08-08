import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createMovement,
  formatBRL,
  getCategories,
  getFairSplit,
  getPlanningOverview,
  getPurchaseOrderHistory,
  getDistributionPlan,
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
  settlePurchaseOrder,
  type MovementClass,
  type PurchaseOrder,
  type ProductGroup,
  type PurchaseOrderRecord,
  type Recommendation,
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
import { downloadCsv, toCsv } from '../bi/csv';
import { opcoesDePeriodo, periodoInicial } from '../lib/periodo';
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

const deadlineDate = (inDays: number) =>
  new Date(Date.now() + inDays * 86400000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

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

/** Linhas do CSV de uma ordem de compra (uma por item + total). */
function orderCsv(order: PurchaseOrder): string {
  type Row = {
    fornecedor: string;
    marca: string;
    produto: string;
    categoria: string;
    quantidade: number | string;
    custoUnit: string;
    total: string;
    pedirAte: string;
    prazoEntregaDias: number | string;
  };
  const rows: Row[] = order.items.map((it) => ({
    fornecedor: order.supplier,
    marca: it.brand ?? '',
    produto: it.description,
    categoria: it.category ?? '',
    quantidade: it.quantity,
    custoUnit: it.unitCost.toFixed(2).replace('.', ','),
    total: it.total.toFixed(2).replace('.', ','),
    pedirAte: it.orderByInDays === null ? '' : it.orderByInDays === 0 ? 'hoje' : deadlineDate(it.orderByInDays),
    prazoEntregaDias: order.leadTimeDays,
  }));
  rows.push({
    fornecedor: order.supplier,
    marca: '',
    produto: 'TOTAL DO PEDIDO',
    categoria: '',
    quantidade: order.units,
    custoUnit: '',
    total: order.total.toFixed(2).replace('.', ','),
    pedirAte: order.orderByInDays === null ? '' : order.orderByInDays === 0 ? 'hoje' : deadlineDate(order.orderByInDays),
    prazoEntregaDias: order.leadTimeDays,
  });
  return toCsv(rows, [
    { key: 'fornecedor', label: 'Fornecedor' },
    { key: 'marca', label: 'Marca' },
    { key: 'produto', label: 'Produto' },
    { key: 'categoria', label: 'Categoria' },
    { key: 'quantidade', label: 'Quantidade' },
    { key: 'custoUnit', label: 'Custo unit. (R$)' },
    { key: 'total', label: 'Total (R$)' },
    { key: 'pedirAte', label: 'Pedir até' },
    { key: 'prazoEntregaDias', label: 'Prazo de entrega (dias)' },
  ]);
}

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');

/* Mesmo respiro que o `.stat .value` do indicador compartilhado usa entre o
   rótulo em mono e o número em Fraunces. Fica aqui porque styles.css é de
   outro dono nesta onda e a regra .action-card .action-count não o traz. */
const contadorHeroi = { marginTop: 6 } as const;

/** Rascunho de ordem de compra de um fornecedor, com export CSV e envio. */
function PurchaseOrderCard({ order }: { order: PurchaseOrder }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(order.orderByInDays !== null && order.orderByInDays <= 7);
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
    qc.invalidateQueries({ queryKey: ['purchase-suggestions'] });
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
      {open && (
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Marca</th>
              <th>Categoria</th>
              <th className="num">Qtde</th>
              <th className="num">Custo unit.</th>
              <th className="num">Total</th>
              <th>Pedir até</th>
              <th>Confiança</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((it) => (
              <tr key={it.productId}>
                <td>{it.description}</td>
                <td>{it.brand ?? '—'}</td>
                <td>{it.category ?? '—'}</td>
                <td className="num">{it.quantity}</td>
                <td className="num">{formatBRL(it.unitCost)}</td>
                <td className="num">{formatBRL(it.total)}</td>
                <td>
                  <OrderBy inDays={it.orderByInDays} leadTimeDays={order.leadTimeDays} />
                </td>
                <td>
                  <Confidence value={it.confidence} />
                </td>
              </tr>
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
        Cada item é dividido pela participação de cada loja nas vendas — a mesma lógica do Modo
        Feira, agora aplicada ao pedido inteiro de uma vez. A soma fecha com a quantidade comprada.
      </p>

      {plano.data.items.map((item) => (
        <div key={item.productId} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13 }}>{item.description}</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              {item.quantity}
              <Unidade>un.</Unidade> a dividir
            </span>
            {/* A base é selo informativo, nunca de estado: dizer que o rateio
                saiu da categoria não é um alerta, é uma ressalva de precisão. */}
            <Selo tom="blue" icone="ideia" title={item.basisLabel}>
              por {item.basis}
            </Selo>
          </div>

          {item.rows.length === 0 ? (
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
              Nenhuma loja com venda nesta base — divisão manual.
            </p>
          ) : (
            <table style={{ marginTop: 6 }}>
              <thead>
                <tr>
                  <th>Loja</th>
                  <th className="num">Vendeu (12 m)</th>
                  <th className="num">Participação</th>
                  <th className="num">Mandar</th>
                </tr>
              </thead>
              <tbody>
                {item.rows.map((r) => (
                  <tr key={r.storeId}>
                    <td>{r.storeName}</td>
                    <td className="num">{r.unitsSold}</td>
                    <td className="num">{r.sharePct}%</td>
                    <td className="num">
                      <strong>{r.quantity}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Loja que some da lista sem motivo visível é o tipo de silêncio que
              faz alguém desconfiar do resto da tela. */}
          {item.excludedByMix && item.excludedByMix.length > 0 && (
            <p className="muted" style={{ fontSize: 11.5, margin: '4px 0 0' }}>
              Fora do rateio por não trabalharem a grife: {item.excludedByMix.join(', ')}.
            </p>
          )}
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
    qc.invalidateQueries({ queryKey: ['purchase-suggestions'] });
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
      qc.invalidateQueries({ queryKey: ['purchase-suggestions'] });
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
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['planning-brand-mix'] }),
        qc.invalidateQueries({ queryKey: ['purchase-suggestions'] }),
        qc.invalidateQueries({ queryKey: ['planning-orders'] }),
        qc.invalidateQueries({ queryKey: ['decision-board'] }),
      ]);
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

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores, enabled: isAdmin });
  const params = { days, storeId: storeId || undefined, group };

  const overview = useQuery({ queryKey: ['planning-overview', days, storeId, group], queryFn: () => getPlanningOverview(params) });
  const suggestions = useQuery({ queryKey: ['purchase-suggestions', days, storeId, group], queryFn: () => getPurchaseSuggestions(params) });
  const rebalance = useQuery({ queryKey: ['planning-rebalance', days, group], queryFn: () => getRebalancePlan({ days, group }) });
  const orders = useQuery({ queryKey: ['planning-orders', days, storeId, group], queryFn: () => getPurchaseOrders(params) });
  const suppliers = useQuery({ queryKey: ['planning-suppliers'], queryFn: getSupplierSettings });

  const filteredRows = useMemo(() => {
    const rows = suggestions.data?.rows ?? [];
    return filter === 'ALL' ? rows : rows.filter((r) => r.recommendation === filter);
  }, [suggestions.data, filter]);

  const urgentCount = useMemo(
    () => (suggestions.data?.rows ?? []).filter((r) => r.stockoutInDays !== null).length,
    [suggestions.data],
  );

  const goTo = (ref: typeof purchaseRef, f?: Filter) => {
    if (f) setFilter(f);
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const summary = suggestions.data?.summary;
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
      <AberturaDeSecao
        eyebrow="Comprar"
        titulo="Pedidos por fornecedor (rascunho)"
        descricao="Itens a comprar já agrupados por fornecedor, com quantidade, total e a data-limite de envio — o item mais urgente define o prazo do pedido. Exporte e envie."
        acoes={
          orders.data && orders.data.orders.length > 0 ? (
            <Botao
              variante="discreto"
              pequeno
              icone="exportar"
              onClick={() => downloadCsv('pedidos-fornecedores', orders.data!.orders.map(orderCsv).join('\n\n'))}
            >
              Exportar tudo (CSV)
            </Botao>
          ) : undefined
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {orders.data!.orders.map((o) => (
                <PurchaseOrderCard key={o.supplier} order={o} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Ciclo: enviado → recebido, com pedidos em trânsito abatidos ── */}
      <OrderHistory />

      {/* ── 3º: análise completa item a item ── */}
      <div ref={purchaseRef}>
        <AberturaDeSecao
          eyebrow="Item a item"
          titulo="O que comprar (e o que não)"
          descricao="A análise completa por SKU, com o giro, a cobertura e o veredito do motor para cada um."
          acoes={
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
        {suggestions.data?.summary.analisados ? (
          <p className="muted" style={{ fontSize: 12.5, margin: '-6px 0 12px' }}>
            <strong>{suggestions.data.summary.buy}</strong> sugestões de compra entre{' '}
            <strong>{suggestions.data.summary.analisados.toLocaleString('pt-BR')}</strong> SKUs analisados.
            {suggestions.data.summary.universo &&
            suggestions.data.summary.universo > suggestions.data.summary.analisados ? (
              <>
                {' '}O recorte tem cerca de{' '}
                <strong>{suggestions.data.summary.universo.toLocaleString('pt-BR')}</strong> SKUs na rede — a
                extração atual do CDS trouxe uma amostra da grade, e o motor só decide sobre o que
                enxerga.
              </>
            ) : null}
          </p>
        ) : null}

        {suggestions.isLoading || !suggestions.data ? (
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

      {/* ── Mix de grifes: o que a rede parou de trabalhar ── */}
      <MixDeGrifes canEdit={isAdmin} />

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
