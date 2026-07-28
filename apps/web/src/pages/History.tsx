import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getDecisionHistory,
  getDecisionStats,
  type DecisionHistoryRow,
  type DecisionOutcome,
  formatBRL,
} from '../api/client';
import { ExportCsv } from '../components/ui';

const OUTCOME_META: Record<DecisionOutcome, { label: string; cls: string }> = {
  APPROVED: { label: 'Aprovado', cls: 'green' },
  REJECTED: { label: 'Recusado', cls: 'red' },
};

const TYPE_LABEL: Record<string, string> = {
  COMPRA: 'Comprar',
  REMANEJAMENTO: 'Remanejar',
  LIQUIDACAO: 'Liquidar',
};

const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

/** Barra de série diária aprovados × recusados (sem dependência de gráfico). */
function Series({ data }: { data: { date: string; approved: number; rejected: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.approved + d.rejected));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90, marginTop: 10 }}>
      {data.map((d) => {
        const total = d.approved + d.rejected;
        return (
          <div
            key={d.date}
            title={`${d.date}: ${d.approved} aprovados · ${d.rejected} recusados`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}
          >
            {d.rejected > 0 && (
              <div style={{ height: `${(d.rejected / max) * 100}%`, background: 'var(--red)', borderRadius: '2px 2px 0 0' }} />
            )}
            {d.approved > 0 && (
              <div style={{ height: `${(d.approved / max) * 100}%`, background: 'var(--green)' }} />
            )}
            {total === 0 && <div style={{ height: 2, background: 'var(--border)' }} />}
          </div>
        );
      })}
    </div>
  );
}

export function History() {
  const [outcomeF, setOutcomeF] = useState<'ALL' | DecisionOutcome>('ALL');
  const history = useQuery({ queryKey: ['decision-history'], queryFn: () => getDecisionHistory(500) });
  const stats = useQuery({ queryKey: ['decision-stats', 30], queryFn: () => getDecisionStats(30) });

  const rows = useMemo(
    () => (history.data ?? []).filter((r) => outcomeF === 'ALL' || r.outcome === outcomeF),
    [history.data, outcomeF],
  );

  const s = stats.data;

  return (
    <div className="stack">
      <div>
        <h1>Histórico Geral</h1>
        <p className="muted">
          Toda decisão tomada sobre um card fica registrada: quem decidiu, quando, com que
          justificativa e qual era o impacto naquele momento. Nada é sobrescrito.
        </p>
      </div>

      {s && (
        <div className="grid grid-4">
          <div className="card">
            <div className="muted">Aprovados (30d)</div>
            <div className="kpi" style={{ color: 'var(--green)' }}>{s.approved}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>{formatBRL(s.approvedImpact)} em impacto</div>
          </div>
          <div className="card">
            <div className="muted">Recusados (30d)</div>
            <div className="kpi" style={{ color: 'var(--red)' }}>{s.rejected}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>{formatBRL(s.rejectedImpact)} em impacto</div>
          </div>
          <div className="card">
            <div className="muted">Tempo até decidir</div>
            <div className="kpi">{s.avgDaysToDecide != null ? `${s.avgDaysToDecide}d` : '—'}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>média desde que o card apareceu</div>
          </div>
          <div className="card">
            <div className="muted">SLA de decisão</div>
            <div className="kpi">{s.slaDays}d</div>
            <div className="muted" style={{ fontSize: 11.5 }}>além disso o card vira crítico</div>
          </div>
        </div>
      )}

      {s && s.series.length > 0 && (
        <div className="card">
          <h2>Aprovações e recusas — últimos {s.series.length} dias</h2>
          <div className="muted" style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--green)' }}>■</span> aprovados ·{' '}
            <span style={{ color: 'var(--red)' }}>■</span> recusados
          </div>
          <Series data={s.series} />
        </div>
      )}

      {s && s.byUser.length > 0 && (
        <div className="card">
          <h2>Desempenho da equipe</h2>
          <p className="muted">Quem está decidindo — e quanto impacto passou pela mão de cada um.</p>
          <table className="table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th className="num">Aprovados</th>
                <th className="num">Recusados</th>
                <th className="num">Total</th>
                <th className="num">Impacto</th>
              </tr>
            </thead>
            <tbody>
              {s.byUser.map((u) => (
                <tr key={u.userId}>
                  <td>{u.name}</td>
                  <td className="num" style={{ color: 'var(--green)' }}>{u.approved}</td>
                  <td className="num" style={{ color: 'var(--red)' }}>{u.rejected}</td>
                  <td className="num">{u.approved + u.rejected}</td>
                  <td className="num">{formatBRL(u.impact)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ marginRight: 'auto' }}>Trilha de decisões</h2>
          <div className="segmented">
            {(['ALL', 'APPROVED', 'REJECTED'] as const).map((k) => (
              <button key={k} className={outcomeF === k ? 'active' : ''} onClick={() => setOutcomeF(k)}>
                {k === 'ALL' ? 'Todas' : OUTCOME_META[k].label}
              </button>
            ))}
          </div>
          <ExportCsv<DecisionHistoryRow>
            rows={rows}
            filename="decisoes"
            columns={[
              { key: 'decidedAt', label: 'Quando' },
              { key: 'cardId', label: 'Card' },
              { key: 'cardType', label: 'Tipo' },
              { key: 'outcome', label: 'Resultado' },
              { key: 'impact', label: 'Impacto' },
              { key: 'decidedByName', label: 'Quem' },
              { key: 'note', label: 'Justificativa' },
            ]}
          />
        </div>

        {history.isLoading ? (
          <p className="muted">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="muted">
            Nenhuma decisão registrada ainda. Abra <strong>Decisões</strong> e aprove ou recuse um card.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Card</th>
                <th>Resultado</th>
                <th className="num">Impacto</th>
                <th>Quem</th>
                <th>Justificativa</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {shortDateTime(r.decidedAt)}
                    {r.daysToDecide != null && (
                      <div className="muted" style={{ fontSize: 11 }}>{r.daysToDecide}d para decidir</div>
                    )}
                  </td>
                  <td>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.cardId}</span>
                    <div className="muted" style={{ fontSize: 11 }}>{TYPE_LABEL[r.cardType] ?? r.cardType}</div>
                  </td>
                  <td>
                    <span className={`badge ${OUTCOME_META[r.outcome].cls}`}>{OUTCOME_META[r.outcome].label}</span>
                  </td>
                  <td className="num">{formatBRL(r.impact)}</td>
                  <td>{r.decidedByName}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{r.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
