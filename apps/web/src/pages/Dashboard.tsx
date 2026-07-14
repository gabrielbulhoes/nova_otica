import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getSummary,
  getStoreCoverage,
  getRebalancePlan,
  getSyncStatus,
  getAlerts,
  getPurchaseOrders,
  formatBRL,
  type CoverageLevel,
} from '../api/client';
import { StatCard, PageHeader, Loading } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

/** Rótulo/cor da cobertura: <1 mês crítica, ≤6 saudável, ≤12 alta, >12 excesso. */
const COVERAGE_BADGE: Record<CoverageLevel, { label: string; cls: string }> = {
  CRITICAL: { label: 'crítica', cls: 'red' },
  HEALTHY: { label: 'saudável', cls: 'green' },
  HIGH: { label: 'alta', cls: 'amber' },
  EXCESS: { label: 'excesso', cls: 'red' },
};

const fmtMonths = (m: number | null) =>
  m === null ? 'sem venda' : `${m.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses`;

export function Dashboard() {
  const { isAdmin } = useAuth();
  const summary = useQuery({ queryKey: ['summary'], queryFn: getSummary });
  const coverage = useQuery({ queryKey: ['coverage'], queryFn: () => getStoreCoverage() });
  // Mesma queryKey do Planejamento (days=90): compartilha cache e invalidação
  // SSE; staleTime maior porque o plano completo é caro no backend.
  const rebalance = useQuery({
    queryKey: ['planning-rebalance', '90'],
    queryFn: () => getRebalancePlan({ days: '90' }),
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });
  const sync = useQuery({ queryKey: ['sync-status'], queryFn: getSyncStatus, enabled: isAdmin });
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => getAlerts({}) });
  const orders = useQuery({ queryKey: ['planning-orders', '90', ''], queryFn: () => getPurchaseOrders({ days: '90' }) });

  // Cobertura da rede = todo o estoque ÷ toda a venda mensal (média ponderada).
  const cov = coverage.data?.rows ?? [];
  const totalMonthly = cov.reduce((a, r) => a + r.monthlyUnits, 0);
  const totalStock = cov.reduce((a, r) => a + r.stockUnits, 0);
  const networkCoverage = totalMonthly > 0 ? totalStock / totalMonthly : null;
  const maxMonths = Math.max(1, ...cov.map((r) => r.coverageMonths ?? 0));

  const transfers = rebalance.data?.rows.slice(0, 6) ?? [];

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Visão de estoque da rede em tempo real (base sincronizada + movimentações do dia)."
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

      {/* Notificação proativa do planejamento: itens no ponto de reposição.
          Atualiza ao vivo (evento planning.urgent pós-sincronização). */}
      {orders.data && orders.data.summary.items > 0 && (
        <div className="banner warn">
          <span className="dot amber" />
          <div>
            🛒 <strong>{orders.data.summary.items}</strong> item(ns) no ponto de reposição —{' '}
            {orders.data.summary.suppliers} pedido(s) de fornecedor somando{' '}
            <strong>{formatBRL(orders.data.summary.total)}</strong>.{' '}
            <Link to="/admin/planejamento" style={{ color: 'var(--accent)' }}>Ver pedidos prontos →</Link>
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
              // O endpoint escopa gestor de loja à própria loja — o rótulo
              // precisa dizer a verdade sobre o recorte exibido.
              label={isAdmin ? 'Cobertura da rede' : 'Cobertura da loja'}
              value={networkCoverage === null ? '—' : fmtMonths(Math.round(networkCoverage * 10) / 10)}
              hint="Estoque ÷ média mensal de unidades vendidas"
            />
          </div>

          <div className="grid grid-3" style={{ marginTop: 16 }}>
            <StatCard
              label="Transferências pendentes"
              value={summary.data.pendingMovements}
              hint="Solicitações e aprovações a resolver"
            />
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
            <StatCard
              label="Financeiro"
              value={<Link to="/admin/bi" style={{ color: 'var(--accent)', fontSize: 20 }}>Ver no BI →</Link>}
              hint="Faturamento, ticket médio e formas de pagamento"
            />
          </div>

          {/* Feedback 02/05 (Galbe): painel inicial focado em ESTOQUE — o
              financeiro mora no BI; aqui entram cobertura e remanejamento. */}
          <div className="card" style={{ marginTop: 16 }}>
            <h3 className="section-title">Cobertura de estoque por loja</h3>
            <p className="muted" style={{ marginTop: -4, marginBottom: 10, fontSize: 12.5 }}>
              Unidades em estoque ÷ média mensal de unidades vendidas = estoque para quantos meses.
            </p>
            {coverage.isLoading ? (
              <Loading />
            ) : cov.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Loja</th>
                    <th className="num">Unidades</th>
                    <th className="num">Venda média/mês</th>
                    <th className="num">Cobertura</th>
                    <th style={{ width: '26%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {cov.map((r) => (
                    <tr key={r.storeId}>
                      <td>{r.storeName}</td>
                      <td className="num">{r.stockUnits.toLocaleString('pt-BR')}</td>
                      <td className="num">{r.monthlyUnits.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
                      <td className="num">
                        <span className={`badge ${COVERAGE_BADGE[r.level].cls}`}>
                          {fmtMonths(r.coverageMonths)} · {COVERAGE_BADGE[r.level].label}
                        </span>
                      </td>
                      <td>
                        <div
                          style={{
                            height: 8,
                            borderRadius: 4,
                            background: 'var(--accent)',
                            width: `${Math.min(((r.coverageMonths ?? maxMonths) / maxMonths) * 100, 100)}%`,
                            minWidth: 4,
                            opacity: r.coverageMonths === null ? 0.35 : 1,
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty">Sem posições de estoque ainda.</div>
            )}
          </div>

          {isAdmin && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 className="section-title">Transferências sugeridas entre lojas</h3>
              <p className="muted" style={{ marginTop: -4, marginBottom: 10, fontSize: 12.5 }}>
                Produtos parados numa loja com saída em outra — remanejar antes de comprar.
              </p>
              {rebalance.isLoading ? (
                <Loading />
              ) : transfers.length > 0 ? (
                <>
                  <table>
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>De → Para</th>
                        <th className="num">Qtd</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transfers.map((t, i) => (
                        <tr key={`${t.productId}-${t.fromStoreId}-${t.toStoreId}-${i}`}>
                          <td>{t.description}</td>
                          <td>
                            {t.fromStoreName} <span className="muted">→</span> {t.toStoreName}
                          </td>
                          <td className="num">{t.quantity}</td>
                          <td className="muted" style={{ fontSize: 12.5 }}>{t.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p style={{ marginTop: 10, marginBottom: 0 }}>
                    <Link to="/admin/planejamento" style={{ color: 'var(--accent)' }}>
                      {rebalance.data && rebalance.data.summary.suggestions > transfers.length
                        ? `Ver todas as ${rebalance.data.summary.suggestions} sugestões no Planejamento →`
                        : 'Abrir o Planejamento →'}
                    </Link>
                  </p>
                </>
              ) : (
                <div className="empty">Nenhuma transferência sugerida agora — estoque equilibrado entre as lojas.</div>
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
