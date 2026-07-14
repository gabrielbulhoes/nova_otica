import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSales, getSalesAnalysis, getStores, formatBRL, type AnalysisDimension } from '../api/client';
import { PageHeader, Loading, ExportCsv } from '../components/ui';

/** Rótulos das dimensões da análise (feedback 10: foco em produto/unidades). */
const DIMENSIONS: { value: AnalysisDimension; label: string }[] = [
  { value: 'brand', label: 'Marca' },
  { value: 'category', label: 'Grupo' },
  { value: 'product', label: 'SKU' },
  { value: 'store', label: 'Loja' },
  { value: 'seller', label: 'Vendedor' },
];

type Metric = 'units' | 'revenue';

export function Sales() {
  const [storeId, setStoreId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [by, setBy] = useState<AnalysisDimension>('brand');
  const [metric, setMetric] = useState<Metric>('units');
  const [days, setDays] = useState('30');

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores });
  const sales = useQuery({
    queryKey: ['sales', storeId, start, end],
    queryFn: () =>
      getSales({
        storeId: storeId || undefined,
        date_start: start || undefined,
        date_end: end || undefined,
        limit: 100,
      }),
  });
  const analysis = useQuery({
    queryKey: ['sales-analysis', by, days, storeId],
    queryFn: () => getSalesAnalysis({ by, days, storeId: storeId || undefined }),
  });

  const rows = [...(analysis.data?.rows ?? [])].sort((a, b) => b[metric] - a[metric]);
  const top = rows.slice(0, 20);
  const max = Math.max(1, ...top.map((r) => r[metric]));
  const fmt = (v: number) =>
    metric === 'units' ? `${v.toLocaleString('pt-BR')} un.` : formatBRL(v);

  return (
    <>
      <PageHeader
        title="Vendas"
        subtitle="Análise por unidades (ou receita) em qualquer dimensão, e a lista de vendas sincronizadas da fonte."
      />

      <div className="toolbar">
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">Todas as lojas</option>
          {stores.data?.rows.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="muted">De</label>
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <label className="muted">Até</label>
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>

      {/* Análise por dimensão — venda por PRODUTO antes de valor monetário. */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <h3 className="section-title" style={{ margin: 0 }}>
            Venda por…
          </h3>
          <div className="segmented">
            {DIMENSIONS.map((d) => (
              <button key={d.value} className={by === d.value ? 'active' : ''} onClick={() => setBy(d.value)}>
                {d.label}
              </button>
            ))}
          </div>
          <div className="segmented">
            <button className={metric === 'units' ? 'active' : ''} onClick={() => setMetric('units')}>
              Unidades
            </button>
            <button className={metric === 'revenue' ? 'active' : ''} onClick={() => setMetric('revenue')}>
              R$
            </button>
          </div>
          <select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="30">30 dias</option>
            <option value="90">90 dias</option>
            <option value="180">180 dias</option>
          </select>
          <span style={{ flex: 1 }} />
          <ExportCsv
            rows={rows.length > 0 ? rows : undefined}
            filename={`vendas-por-${by}-${days}d`}
            columns={[
              { key: 'label', label: DIMENSIONS.find((d) => d.value === by)?.label ?? by },
              { key: 'units', label: 'Unidades' },
              { key: 'revenue', label: 'Receita' },
            ]}
          />
        </div>
        {analysis.isLoading ? (
          <Loading />
        ) : top.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>{DIMENSIONS.find((d) => d.value === by)?.label}</th>
                <th className="num">Unidades</th>
                <th className="num">Receita</th>
                <th style={{ width: '30%' }}></th>
              </tr>
            </thead>
            <tbody>
              {top.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="num" style={metric === 'units' ? { fontWeight: 600 } : undefined}>
                    {r.units.toLocaleString('pt-BR')}
                  </td>
                  <td className="num" style={metric === 'revenue' ? { fontWeight: 600 } : undefined}>
                    {formatBRL(r.revenue)}
                  </td>
                  <td>
                    <div
                      title={fmt(r[metric])}
                      style={{
                        height: 8,
                        borderRadius: 4,
                        background: 'var(--accent)',
                        width: `${(r[metric] / max) * 100}%`,
                        minWidth: 4,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">Sem vendas no período.</div>
        )}
        {rows.length > top.length && (
          <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 12.5 }}>
            Mostrando o top {top.length} de {rows.length} — o CSV leva tudo.
          </p>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        {sales.isLoading ? (
          <Loading />
        ) : sales.data && sales.data.rows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Nº</th>
                <th>Loja</th>
                <th>Vendedor</th>
                <th>Cliente</th>
                <th className="num">Itens</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {sales.data.rows.map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.saleDate).toLocaleDateString('pt-BR')}</td>
                  <td>{s.externalId}</td>
                  <td>{s.store?.name ?? '—'}</td>
                  <td>{s.seller?.name ?? '—'}</td>
                  <td>{s.customer?.name ?? '—'}</td>
                  <td className="num">{s._count?.items ?? '—'}</td>
                  <td className="num">{formatBRL(s.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">Nenhuma venda encontrada.</div>
        )}
      </div>
      {sales.data && (
        <p className="muted" style={{ marginTop: 10 }}>
          {sales.data.rows.length} de {sales.data.total} vendas.
        </p>
      )}
    </>
  );
}
