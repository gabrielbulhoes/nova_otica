import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createMovement,
  formatBRL,
  getPlanningOverview,
  getPurchaseSuggestions,
  getRebalancePlan,
  getStores,
  getSupplierSettings,
  setSupplierLeadTime,
  type MovementClass,
  type Recommendation,
  type RebalanceSuggestion,
} from '../api/client';
import { PageHeader, Loading } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

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
        {s.description}
        <div className="muted" style={{ fontSize: 11.5 }}>{s.reason}</div>
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

export function Planning() {
  const { isAdmin } = useAuth();
  const [days, setDays] = useState('90');
  const [storeId, setStoreId] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const rebalanceRef = useRef<HTMLDivElement>(null);
  const purchaseRef = useRef<HTMLDivElement>(null);

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores, enabled: isAdmin });
  const params = { days, storeId: storeId || undefined };

  const overview = useQuery({ queryKey: ['planning-overview', days, storeId], queryFn: () => getPlanningOverview(params) });
  const suggestions = useQuery({ queryKey: ['purchase-suggestions', days, storeId], queryFn: () => getPurchaseSuggestions(params) });
  const rebalance = useQuery({ queryKey: ['planning-rebalance', days], queryFn: () => getRebalancePlan({ days }) });
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
        <button className="card action-card green" onClick={() => goTo(purchaseRef, 'BUY')}>
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

      {/* ── 2º: comprar o que falta, no prazo de cada fornecedor ── */}
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
                    <td className="num">{r.currentStock}</td>
                    <td className="num">{r.dailyDemand}</td>
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
                    </td>
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
                    <td colSpan={9} className="empty">Nenhum item nesta categoria.</td>
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
