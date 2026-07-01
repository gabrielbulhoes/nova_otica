import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getPlanningOverview,
  getPurchaseSuggestions,
  getStores,
  formatBRL,
  type Recommendation,
  type MovementClass,
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

export function Planning() {
  const { isAdmin } = useAuth();
  const [days, setDays] = useState('90');
  const [storeId, setStoreId] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores, enabled: isAdmin });
  const params = { days, storeId: storeId || undefined };

  const overview = useQuery({ queryKey: ['planning-overview', days, storeId], queryFn: () => getPlanningOverview(params) });
  const suggestions = useQuery({ queryKey: ['purchase-suggestions', days, storeId], queryFn: () => getPurchaseSuggestions(params) });

  const filteredRows = useMemo(() => {
    const rows = suggestions.data?.rows ?? [];
    return filter === 'ALL' ? rows : rows.filter((r) => r.recommendation === filter);
  }, [suggestions.data, filter]);

  const alerts = useMemo(
    () =>
      (suggestions.data?.rows ?? [])
        .filter((r) => r.stockoutInDays !== null)
        .sort((a, b) => (a.stockoutInDays ?? 0) - (b.stockoutInDays ?? 0))
        .slice(0, 6),
    [suggestions.data],
  );

  return (
    <>
      <PageHeader
        title="Planejamento & Compras"
        subtitle="Análise preditiva do estoque: capital imobilizado, Pareto 80/20 e o que comprar (ou não)."
      />

      <div className="toolbar">
        <select value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="180">Últimos 180 dias</option>
        </select>
        {isAdmin && (
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">Toda a rede</option>
            {stores.data?.rows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {overview.isLoading || !overview.data ? (
        <Loading />
      ) : (
        <>
          {/* KPIs de capital */}
          <div className="grid grid-4">
            <div className="card stat">
              <div className="label">Capital imobilizado</div>
              <div className="value" style={{ fontSize: 22 }}>{formatBRL(overview.data.capital.total)}</div>
              <div className="hint">A custo, em todo o estoque do escopo</div>
            </div>
            <div className="card stat">
              <div className="label">Capital ocioso (parado + excesso)</div>
              <div className="value" style={{ fontSize: 22, color: 'var(--red)' }}>
                {formatBRL(overview.data.capital.idle)}
              </div>
              <div className="hint">{overview.data.capital.idlePct}% do capital imobilizado</div>
            </div>
            <div className="card stat">
              <div className="label">Recomendado comprar</div>
              <div className="value" style={{ fontSize: 22, color: 'var(--green)' }}>
                {formatBRL(suggestions.data?.summary.buyCapital ?? 0)}
              </div>
              <div className="hint">{suggestions.data?.summary.buy ?? 0} SKUs abaixo do ponto de reposição</div>
            </div>
            <div className="card stat">
              <div className="label">Capital a não repor / liberar</div>
              <div className="value" style={{ fontSize: 22, color: 'var(--amber)' }}>
                {formatBRL(suggestions.data?.summary.avoidedCapital ?? 0)}
              </div>
              <div className="hint">
                {(suggestions.data?.summary.dontBuy ?? 0) + (suggestions.data?.summary.liquidate ?? 0)} SKUs em excesso/parados
              </div>
            </div>
          </div>

          <div className="grid grid-2" style={{ marginTop: 16, alignItems: 'start' }}>
            {/* Panorama de capital imobilizado */}
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

            {/* Pareto 80/20 + maiores capitais parados */}
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
                  {overview.data.topIdle.map((p) => (
                    <tr key={p.productId}>
                      <td>{p.description}</td>
                      <td>
                        <span className={`badge ${moveMeta[p.movementClass].cls}`}>{moveMeta[p.movementClass].label}</span>
                      </td>
                      <td className="num">{p.coverageDays === null ? '∞' : `${p.coverageDays}d`}</td>
                      <td className="num">{formatBRL(p.idleValue)}</td>
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

          {/* Alertas preditivos de reposição */}
          {alerts.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="section-title">Alertas preditivos de reposição (proativo)</div>
              <div className="grid grid-3">
                {alerts.map((a) => (
                  <div key={a.productId} className="banner warn" style={{ margin: 0 }}>
                    <span className="dot amber" />
                    <div style={{ fontSize: 12.5 }}>
                      <strong>{a.description}</strong>
                      <br />
                      Ruptura em ~<strong>{a.stockoutInDays} dias</strong> · comprar {a.suggestedQty} un.
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recomendações de compra */}
          <div className="row-between" style={{ marginTop: 22, marginBottom: 12 }}>
            <div className="section-title" style={{ margin: 0 }}>O que comprar (e o que não)</div>
            <div className="segmented">
              {([
                ['ALL', 'Todos'],
                ['BUY', 'Comprar'],
                ['DONT_BUY', 'Não comprar'],
                ['LIQUIDATE', 'Liquidar'],
              ] as [Filter, string][]).map(([k, label]) => (
                <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
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
                    <th>Categoria</th>
                    <th>Giro</th>
                    <th className="num">Estoque</th>
                    <th className="num">Demanda/dia</th>
                    <th className="num">Cobertura</th>
                    <th>Recomendação</th>
                    <th className="num">Comprar</th>
                    <th className="num">Capital</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr key={r.productId}>
                      <td>{r.description}</td>
                      <td>{r.category ?? '—'}</td>
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
        </>
      )}
    </>
  );
}
