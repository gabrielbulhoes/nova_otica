import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createMovement,
  formatBRL,
  getCategories,
  getFairSplit,
  getPlanningOverview,
  getPurchaseOrderHistory,
  getPurchaseOrders,
  getPurchaseSuggestions,
  getRebalancePlan,
  getStores,
  getSupplierSettings,
  registerPurchaseOrder,
  setSupplierLeadTime,
  settlePurchaseOrder,
  type MovementClass,
  type PurchaseOrder,
  type ProductGroup,
  type PurchaseOrderRecord,
  type Recommendation,
  type RebalanceSuggestion,
} from '../api/client';
import { PageHeader, Loading, ExportCsv } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { downloadCsv, toCsv } from '../bi/csv';

const recMeta: Record<Recommendation, { label: string; cls: string }> = {
  BUY: { label: 'Comprar', cls: 'green' },
  HOLD: { label: 'Manter', cls: 'blue' },
  DONT_BUY: { label: 'Não comprar', cls: 'amber' },
  LIQUIDATE: { label: 'Liquidar', cls: 'red' },
};

const moveMeta: Record<MovementClass, { label: string; cls: string }> = {
  FAST: { label: 'Alto giro', cls: 'green' },
  HEALTHY: { label: 'Saudável', cls: 'blue' },
  SLOW: { label: 'Baixo giro', cls: 'amber' },
  DEAD: { label: 'Parado', cls: 'red' },
};

type Filter = 'ALL' | Recommendation;

/** Recortes de cobertura — vocabulário da operação (feedback do cliente). */
const GROUP_OPTIONS: { value: ProductGroup; label: string; hint: string }[] = [
  {
    value: 'principal',
    label: 'Cobertura principal',
    hint: 'Óculos, óculos de grau (armações) e relógios — o que a rede chama de cobertura no dia a dia.',
  },
  {
    value: 'lentes',
    label: 'Lentes',
    hint: 'Somente lentes — a visão usada para programar as reposições de lentes prontas.',
  },
  {
    value: 'todos',
    label: 'Consolidado',
    hint: 'Todos os produtos juntos, incluindo estojos, acessórios e demais categorias.',
  },
];

function Bar({ segments }: { segments: { value: number; color: string; label: string }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', background: 'var(--panel-2)' }}>
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

/** "Pedir até": urgência do pedido em linguagem do dia a dia. */
function OrderBy({ inDays, leadTimeDays }: { inDays: number | null; leadTimeDays: number }) {
  if (inDays === null) return <span className="muted">—</span>;
  const deadline = new Date(Date.now() + inDays * 86400000).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
  const label = inDays === 0 ? 'pedir hoje' : `até ${deadline}`;
  const cls = inDays === 0 ? 'red' : inDays <= 7 ? 'amber' : 'gray';
  return (
    <span className={`badge ${cls}`} title={`Prazo do fornecedor: ${leadTimeDays} dias. Pedido deve ser feito ${inDays === 0 ? 'hoje' : `em até ${inDays} dias`} para não romper.`}>
      {label}
    </span>
  );
}

/** Selo de confiabilidade da decisão (0–100), com cor por faixa. */
function Confidence({ value }: { value: number }) {
  const cls = value >= 75 ? 'green' : value >= 50 ? 'amber' : 'gray';
  return (
    <span className={`badge ${cls}`} title="Confiabilidade da recomendação: quanto mais vendas e histórico, mais confiável.">
      {value}%
    </span>
  );
}

/** Explicação curta e amigável do porquê da decisão. */
function WhyNote({ text }: { text: string }) {
  return (
    <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.35 }}>
      💡 {text}
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

  if (state === 'done') return <span className="badge green">{doneLabel}</span>;

  if (state === 'armed' || state === 'loading') {
    return (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
        <button
          className="btn sm"
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
        </button>
        <button className="btn ghost sm" disabled={state === 'loading'} onClick={() => setState('idle')}>
          Voltar
        </button>
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <button className={`btn ${ghost ? 'ghost ' : ''}sm`} onClick={() => setState('armed')}>
        {label}
      </button>
      {state === 'error' && <span style={{ fontSize: 11, color: 'var(--red)' }}>Falhou — tente de novo</span>}
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
        <span style={{ fontSize: 12, color: 'var(--muted)', width: 14 }}>{open ? '▾' : '▸'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>Fornecedor:</span> {order.supplier}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {order.brands.length > 0 && <>marcas: {order.brands.join(', ')} · </>}
            {order.items.length} {order.items.length === 1 ? 'item' : 'itens'} · {order.units} un. · entrega em{' '}
            {order.leadTimeDays} dias
            {order.stockoutInDays !== null && (
              <span style={{ color: 'var(--red)' }}> · ruptura em ~{order.stockoutInDays}d se não pedir</span>
            )}
          </div>
        </div>
        {urgency && (
          <span className={`badge ${order.orderByInDays === 0 ? 'red' : order.orderByInDays! <= 7 ? 'amber' : 'gray'}`}>
            enviar {urgency}
          </span>
        )}
        <strong style={{ whiteSpace: 'nowrap' }}>{formatBRL(order.total)}</strong>
        <span
          className="btn ghost sm"
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            downloadCsv(`pedido-${slug(order.supplier)}`, orderCsv(order));
          }}
        >
          Exportar CSV
        </span>
        <span onClick={(e) => e.stopPropagation()}>
          <TwoStepButton
            label="Registrar envio"
            confirmLabel={`Confirmar envio (${formatBRL(order.total)})`}
            doneLabel="Enviado ✓"
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

const recordStatusMeta: Record<PurchaseOrderRecord['status'], { label: string; cls: string }> = {
  SENT: { label: 'Em trânsito', cls: 'blue' },
  RECEIVED: { label: 'Recebido', cls: 'green' },
  CANCELLED: { label: 'Cancelado', cls: 'gray' },
};

/** Histórico do ciclo de compras: enviado → recebido (ou cancelado). */
function OrderHistory() {
  const qc = useQueryClient();
  const history = useQuery({ queryKey: ['planning-history'], queryFn: getPurchaseOrderHistory });

  const settle = async (id: string, action: 'receive' | 'cancel') => {
    await settlePurchaseOrder(id, action);
    qc.invalidateQueries({ queryKey: ['planning-history'] });
    qc.invalidateQueries({ queryKey: ['planning-orders'] });
    qc.invalidateQueries({ queryKey: ['purchase-suggestions'] });
    qc.invalidateQueries({ queryKey: ['stock'] });
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title" style={{ marginBottom: 2 }}>Histórico de pedidos (enviado → recebido)</div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        Pedidos em trânsito são abatidos das sugestões (não compra duas vezes). Confirme o recebimento quando a
        mercadoria chegar e for conferida.
      </div>
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
                  <span className={`badge ${recordStatusMeta[r.status].cls}`}>
                    {recordStatusMeta[r.status].label}
                    {r.status === 'RECEIVED' && r.receivedAt ? ` · ${shortDate(r.receivedAt)}` : ''}
                  </span>
                </td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  {r.status === 'SENT' ? (
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <TwoStepButton
                        label="Confirmar recebimento"
                        confirmLabel="Mercadoria conferida?"
                        doneLabel="Recebido ✓"
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
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
      <td className="num">{s.quantity}</td>
      <td className="num">
        {s.toCoverageDays === null ? '—' : `${s.toCoverageDays}d`}
        {s.stockoutInDays !== null && (
          <div style={{ fontSize: 11, color: 'var(--red)' }}>ruptura ~{s.stockoutInDays}d</div>
        )}
      </td>
      <td className="right" style={{ whiteSpace: 'nowrap' }}>
        {state === 'done' ? (
          <span className="badge green">Solicitada ✓</span>
        ) : (
          <button className="btn sm" onClick={request} disabled={state === 'loading'}>
            {state === 'loading' ? 'Solicitando…' : 'Solicitar transferência'}
          </button>
        )}
        {state === 'error' && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{error}</div>}
      </td>
    </tr>
  );
}

/** Editor de prazo por fornecedor (marca) — admin. */
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
          <button className="btn ghost sm" onClick={save} disabled={state === 'saving'}>
            {state === 'saving' ? 'Salvando…' : state === 'saved' ? 'Salvo ✓' : 'Salvar'}
          </button>
          {state === 'error' && <div style={{ fontSize: 11, color: 'var(--red)' }}>Erro ao salvar</div>}
        </td>
      )}
    </tr>
  );
}

/**
 * Modo Feira (feedback 08): lançamentos comprados em feira não têm histórico
 * próprio. Escolhida a marca ou o grupo e a quantidade total, rateia a compra
 * entre as lojas pela participação de cada uma nas vendas daquele recorte.
 */
function FairSplit() {
  const suppliers = useQuery({ queryKey: ['planning-suppliers'], queryFn: getSupplierSettings });
  const categories = useQuery({ queryKey: ['categories'], queryFn: getCategories });
  const [mode, setMode] = useState<'brand' | 'category'>('brand');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [qty, setQty] = useState('100');
  const [days, setDays] = useState('180');
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
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title" style={{ marginBottom: 2 }}>Modo Feira — como distribuir uma compra nova</div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        Lançamentos de feira não têm histórico. Escolha a marca ou o grupo, a quantidade comprada, e o sistema
        rateia entre as lojas pela participação de cada uma nas vendas desse recorte (a soma bate exatamente com o
        total).
      </div>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <div className="segmented">
          <button className={mode === 'brand' ? 'active' : ''} onClick={() => setMode('brand')}>Por marca</button>
          <button className={mode === 'category' ? 'active' : ''} onClick={() => setMode('category')}>Por grupo</button>
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
          <option value="90">90 dias</option>
          <option value="180">180 dias</option>
          <option value="365">1 ano</option>
        </select>
        <button className="btn" disabled={!canRun} onClick={run}>Distribuir</button>
      </div>

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
  );
}

export function Planning() {
  const { isAdmin } = useAuth();
  const [days, setDays] = useState('90');
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
              className={group === g.value ? 'active' : ''}
              aria-pressed={group === g.value}
              onClick={() => setGroup(g.value)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Período de análise">
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="180">Últimos 180 dias</option>
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

      {/* ── O que fazer hoje: prioridades em 1 olhada, ação em 1 clique ── */}
      <div className="grid grid-4 action-center">
        <button className="card action-card red" onClick={() => goTo(purchaseRef, 'BUY')}>
          <div className="action-count">{urgentCount}</div>
          <div className="action-label">Risco de ruptura</div>
          <div className="hint">
            {urgentCount > 0 ? 'sem estoque na rede para a demanda — pedir já' : 'nenhum item em risco na rede 👏'}
          </div>
        </button>
        <button className="card action-card blue" onClick={() => goTo(rebalanceRef)}>
          <div className="action-count">{reb?.summary.suggestions ?? '…'}</div>
          <div className="action-label">Transferências sugeridas</div>
          <div className="hint">{reb ? `${reb.summary.units} un. já existem na rede — sem gastar nada` : 'cruzando vendas × estoque'}</div>
        </button>
        <button className="card action-card green" onClick={() => goTo(ordersRef)}>
          <div className="action-count">{summary?.buy ?? '…'}</div>
          <div className="action-label">Pedidos a fazer</div>
          <div className="hint">
            {!summary
              ? ''
              : summary.buy > 0
                ? `${formatBRL(summary.buyCapital)} no prazo de cada fornecedor`
                : 'nada a comprar agora 👏'}
          </div>
        </button>
        <button className="card action-card amber" onClick={() => goTo(purchaseRef, 'LIQUIDATE')}>
          <div className="action-count">{summary ? summary.liquidate + summary.dontBuy : '…'}</div>
          <div className="action-label">Excesso & parados</div>
          <div className="hint">{summary ? `${formatBRL(summary.avoidedCapital)} para não repor / liberar` : ''}</div>
        </button>
      </div>

      {/* ── 1º: redistribuir o que já existe (não custa nada) ── */}
      <div className="card" style={{ marginTop: 16 }} ref={rebalanceRef}>
        <div className="row-between">
          <div>
            <div className="section-title" style={{ marginBottom: 2 }}>Redistribuir entre lojas (antes de comprar)</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Onde o produto vende e está acabando ← recebe de onde está sobrando ou parado. Visão de toda a rede.
            </div>
          </div>
          {reb && reb.rows.length > 0 && (
            <span className="badge blue">{reb.summary.units} un. em {reb.summary.storesInvolved} lojas</span>
          )}
        </div>
        {rebalance.isLoading ? (
          <Loading />
        ) : (reb?.rows.length ?? 0) === 0 ? (
          <div className="empty">Estoque bem distribuído entre as lojas — nenhuma transferência necessária. 👏</div>
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
      </div>

      {/* ── 2º: pedidos prontos por fornecedor, com total e data-limite ── */}
      <div className="card" style={{ marginTop: 16 }} ref={ordersRef}>
        <div className="row-between">
          <div>
            <div className="section-title" style={{ marginBottom: 2 }}>Pedidos por fornecedor (rascunho)</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Itens a comprar já agrupados por fornecedor, com quantidade, total e a data-limite de envio — o item
              mais urgente define o prazo do pedido. Exporte e envie.
            </div>
          </div>
          {orders.data && orders.data.orders.length > 0 && (
            <button
              className="btn ghost sm"
              onClick={() => downloadCsv('pedidos-fornecedores', orders.data!.orders.map(orderCsv).join('\n\n'))}
            >
              Exportar tudo (CSV)
            </button>
          )}
        </div>
        {orders.isLoading ? (
          <Loading />
        ) : (orders.data?.orders.length ?? 0) === 0 ? (
          <div className="empty">Nenhum pedido a fazer agora — estoque coberto para a demanda atual. 👏</div>
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
        <div className="row-between" style={{ marginTop: 22, marginBottom: 12 }}>
          <div className="section-title" style={{ margin: 0 }}>O que comprar (e o que não)</div>
          <div className="segmented">
            {([
              ['ALL', 'Todos'],
              ['BUY', 'Comprar'],
              ['DONT_BUY', 'Não comprar'],
              ['LIQUIDATE', 'Liquidar'],
            ] as [Filter, string][]).map(([k, label]) => (
              <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)} aria-pressed={filter === k}>
                {label}
              </button>
            ))}
          </div>
        </div>

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
                      <span className={`badge ${moveMeta[r.movementClass].cls}`}>{moveMeta[r.movementClass].label}</span>
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
                      {r.forecast && r.forecast.method !== 'media' && (
                        <span className="muted" style={{ marginLeft: 4, fontSize: 11 }}>
                          {r.forecast.method === 'sazonal' ? '☀' : '↗'}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {r.coverageDays === null ? '∞' : `${r.coverageDays}d`}
                      {r.stockoutInDays !== null && (
                        <div style={{ fontSize: 11, color: 'var(--red)' }}>ruptura ~{r.stockoutInDays}d</div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${recMeta[r.recommendation].cls}`} title={r.reason}>
                        {recMeta[r.recommendation].label}
                      </span>
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
      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginBottom: 2 }}>Prazos dos fornecedores (lead time)</div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          Cada fornecedor entrega num prazo diferente — o ponto de reposição e o “pedir até” de cada item usam o prazo
          da marca. Sem prazo definido, vale o padrão de {suppliers.data?.defaultLeadTimeDays ?? 14} dias.
        </div>
        {suppliers.isLoading || !suppliers.data ? (
          <Loading />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fornecedor (marca)</th>
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

      {/* ── Modo Feira: distribuir uma compra nova entre as lojas (ADMIN) ── */}
      {isAdmin && <FairSplit />}

      {/* ── Panorama (secundário): capital imobilizado + Pareto ── */}
      {overview.isLoading || !overview.data ? (
        <Loading />
      ) : (
        <div className="grid grid-2" style={{ marginTop: 16, alignItems: 'start' }}>
          <div className="card">
            <div className="section-title">Panorama do capital imobilizado</div>
            <Bar
              segments={[
                { value: overview.data.capital.healthy, color: 'var(--green)', label: 'Saudável' },
                { value: overview.data.capital.excess, color: 'var(--amber)', label: 'Excesso' },
                { value: overview.data.capital.parked, color: 'var(--red)', label: 'Parado (sem giro)' },
              ]}
            />
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 12 }}>
              <span><span className="dot green" /> Saudável {formatBRL(overview.data.capital.healthy)}</span>
              <span><span className="dot amber" /> Excesso {formatBRL(overview.data.capital.excess)}</span>
              <span><span className="dot" style={{ background: 'var(--red)' }} /> Parado {formatBRL(overview.data.capital.parked)}</span>
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
                      <span className={`badge ${c.idle > 0 ? 'amber' : 'gray'}`}>{formatBRL(c.idle)}</span>
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
                      <span className={`badge ${moveMeta[x.movementClass].cls}`}>{moveMeta[x.movementClass].label}</span>
                    </td>
                    <td className="num">{x.coverageDays === null ? '∞' : `${x.coverageDays}d`}</td>
                    <td className="num">{formatBRL(x.idleValue)}</td>
                  </tr>
                ))}
                {overview.data.topIdle.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty">Nenhum capital ocioso relevante. 👏</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
