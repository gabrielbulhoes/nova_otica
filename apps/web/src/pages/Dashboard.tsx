import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSummary, getSalesByStore, getSyncStatus, getAlerts, formatBRL } from '../api/client';
import { StatCard, PageHeader, Loading } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

export function Dashboard() {
  const { isAdmin } = useAuth();
  const summary = useQuery({ queryKey: ['summary'], queryFn: getSummary });
  const byStore = useQuery({ queryKey: ['sales-by-store'], queryFn: getSalesByStore, enabled: isAdmin });
  const sync = useQuery({ queryKey: ['sync-status'], queryFn: getSyncStatus, enabled: isAdmin });
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => getAlerts({}) });

  const maxTotal = Math.max(1, ...(byStore.data ?? []).map((s) => s.total));

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Visão consolidada da rede em tempo real (base sincronizada + movimentações do dia)."
      />

      {sync.data && (
        <div className={`banner ${sync.data.windowOpen ? 'ok' : 'warn'}`}>
          <span className={`dot ${sync.data.windowOpen ? 'green' : 'amber'}`} />
          <div>
            <strong>Integração {sync.data.mode === 'mock' ? '(modo demonstração)' : '(ao vivo)'}</strong>{' '}
            — janela da API {sync.data.window}.{' '}
            {sync.data.windowOpen
              ? 'Janela aberta agora.'
              : `Fora da janela (agora ${sync.data.now}); o estoque mostrado é o da última sincronização + movimentações internas.`}
          </div>
        </div>
      )}

      {alerts.data && alerts.data.total > 0 && (
        <div className="banner warn">
          <span className="dot amber" />
          <div>
            <strong>{alerts.data.out}</strong> ruptura(s) e <strong>{alerts.data.low}</strong> item(ns) com
            estoque baixo. <Link to="/admin/alertas" style={{ color: 'var(--accent)' }}>Ver alertas →</Link>
          </div>
        </div>
      )}

      {summary.isLoading ? (
        <Loading />
      ) : summary.data ? (
        <>
          <div className="grid grid-4">
            <StatCard label="Lojas" value={summary.data.stores} />
            <StatCard label="Produtos" value={summary.data.products} />
            <StatCard label="Unidades em estoque" value={summary.data.stockUnits.toLocaleString('pt-BR')} />
            <StatCard
              label="Transferências pendentes"
              value={summary.data.pendingMovements}
              hint="Solicitações e aprovações a resolver"
            />
          </div>

          <div className="grid grid-3" style={{ marginTop: 16 }}>
            <StatCard
              label="Vendas (30 dias)"
              value={formatBRL(summary.data.sales30d.total)}
              hint={`${summary.data.sales30d.count} vendas`}
            />
            <StatCard label="Clientes" value={summary.data.customers} />
            <StatCard
              label="Última sincronização"
              value={
                summary.data.lastSync
                  ? new Date(summary.data.lastSync.startedAt).toLocaleString('pt-BR')
                  : '—'
              }
              hint={
                summary.data.lastSync
                  ? `${summary.data.lastSync.status} · ${summary.data.lastSync.recordsWritten} registros`
                  : 'Nunca executada'
              }
            />
          </div>

          {isAdmin && (
          <div className="card" style={{ marginTop: 16 }}>
            <h3 className="section-title">Vendas por loja (últimos 30 dias)</h3>
            {byStore.data && byStore.data.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Loja</th>
                    <th className="num">Vendas</th>
                    <th className="num">Total</th>
                    <th style={{ width: '30%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {byStore.data.map((s) => (
                    <tr key={s.storeId ?? 'none'}>
                      <td>{s.storeName}</td>
                      <td className="num">{s.count}</td>
                      <td className="num">{formatBRL(s.total)}</td>
                      <td>
                        <div
                          style={{
                            height: 8,
                            borderRadius: 4,
                            background: 'var(--accent)',
                            width: `${(s.total / maxTotal) * 100}%`,
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
          </div>
          )}
        </>
      ) : (
        <div className="empty">
          Sem dados ainda. Rode a sincronização em <strong>Sincronização → Sincronizar agora</strong>.
        </div>
      )}
    </>
  );
}
