import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAbc, getTurnover, getStores, formatBRL } from '../api/client';
import { PageHeader, Loading } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

type Tab = 'abc' | 'turnover';

const classColor: Record<string, string> = { A: 'green', B: 'amber', C: 'gray' };

export function Reports() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>('abc');
  const [days, setDays] = useState('30');
  const [storeId, setStoreId] = useState('');

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores, enabled: isAdmin });
  const params = { days, storeId: storeId || undefined };

  const abc = useQuery({ queryKey: ['abc', days, storeId], queryFn: () => getAbc(params), enabled: tab === 'abc' });
  const turnover = useQuery({
    queryKey: ['turnover', days, storeId],
    queryFn: () => getTurnover(params),
    enabled: tab === 'turnover',
  });

  return (
    <>
      <PageHeader title="Relatórios" subtitle="Curva ABC por receita e giro de estoque no período." />

      <div className="toolbar">
        <div className="segmented">
          <button className={tab === 'abc' ? 'active' : ''} onClick={() => setTab('abc')}>
            Curva ABC
          </button>
          <button className={tab === 'turnover' ? 'active' : ''} onClick={() => setTab('turnover')}>
            Giro de estoque
          </button>
        </div>
        <select value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">Últimos 7 dias</option>
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

      {tab === 'abc' ? (
        abc.isLoading ? (
          <Loading />
        ) : abc.data ? (
          <>
            <div className="grid grid-4">
              {(['A', 'B', 'C'] as const).map((k) => (
                <div className="card stat" key={k}>
                  <div className="label">
                    Classe {k} {k === 'A' ? '(alta)' : k === 'C' ? '(cauda)' : '(média)'}
                  </div>
                  <div className="value">{abc.data.summary[k].products}</div>
                  <div className="hint">{formatBRL(abc.data.summary[k].revenue)}</div>
                </div>
              ))}
              <div className="card stat">
                <div className="label">Receita total</div>
                <div className="value" style={{ fontSize: 20 }}>
                  {formatBRL(abc.data.totalRevenue)}
                </div>
              </div>
            </div>

            <div className="card" style={{ marginTop: 16, padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Classe</th>
                    <th>Produto</th>
                    <th className="num">Un. vendidas</th>
                    <th className="num">Receita</th>
                    <th className="num">% receita</th>
                    <th className="num">% acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {abc.data.rows.slice(0, 100).map((r) => (
                    <tr key={r.productId}>
                      <td>
                        <span className={`badge ${classColor[r.class]}`}>{r.class}</span>
                      </td>
                      <td>{r.description}</td>
                      <td className="num">{r.units}</td>
                      <td className="num">{formatBRL(r.revenue)}</td>
                      <td className="num">{r.revenuePct.toFixed(1)}%</td>
                      <td className="num">{r.cumulativePct.toFixed(1)}%</td>
                    </tr>
                  ))}
                  {abc.data.rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty">
                        Sem vendas no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null
      ) : turnover.isLoading ? (
        <Loading />
      ) : turnover.data ? (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Categoria</th>
                <th className="num">Un. vendidas</th>
                <th className="num">Estoque atual</th>
                <th className="num">Giro</th>
                <th className="num">Dias de cobertura</th>
              </tr>
            </thead>
            <tbody>
              {turnover.data.rows.slice(0, 150).map((r) => (
                <tr key={r.productId}>
                  <td>{r.description}</td>
                  <td>{r.category ?? '—'}</td>
                  <td className="num">{r.unitsSold}</td>
                  <td className="num">{r.currentStock}</td>
                  <td className="num">
                    <span className={`badge ${r.turnover >= 1 ? 'green' : r.turnover > 0 ? 'amber' : 'gray'}`}>
                      {r.turnover.toFixed(2)}
                    </span>
                  </td>
                  <td className="num">{r.daysOfInventory ?? '—'}</td>
                </tr>
              ))}
              {turnover.data.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    Sem dados no período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
