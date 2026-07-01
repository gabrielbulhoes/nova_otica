import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSyncStatus, runSync } from '../api/client';
import { PageHeader, Loading } from '../components/ui';

const statusClass: Record<string, string> = {
  SUCCESS: 'green',
  RUNNING: 'blue',
  PARTIAL: 'amber',
  FAILED: 'red',
};

export function Sync() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['sync-status'], queryFn: getSyncStatus });

  const run = useMutation({
    mutationFn: runSync,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sync-status'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
    },
  });

  return (
    <>
      <div className="row-between">
        <PageHeader
          title="Sincronização"
          subtitle="Integração com a API Sellbie/CDS — disponível apenas na janela diária."
        />
        <button className="btn" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? 'Sincronizando…' : 'Sincronizar agora'}
        </button>
      </div>

      {status.isLoading ? (
        <Loading />
      ) : status.data ? (
        <>
          <div className="grid grid-4">
            <div className="card stat">
              <div className="label">Modo</div>
              <div className="value" style={{ fontSize: 20 }}>
                {status.data.mode === 'mock' ? 'Demonstração' : 'Ao vivo'}
              </div>
            </div>
            <div className="card stat">
              <div className="label">Janela da API</div>
              <div className="value" style={{ fontSize: 20 }}>
                {status.data.window}
              </div>
              <div className="hint">
                <span className={`dot ${status.data.windowOpen ? 'green' : 'amber'}`} />{' '}
                {status.data.windowOpen ? 'Aberta agora' : `Fechada (agora ${status.data.now})`}
              </div>
            </div>
            <div className="card stat">
              <div className="label">Agendamento</div>
              <div className="value" style={{ fontSize: 20 }}>
                {status.data.cron}
              </div>
              <div className="hint">{status.data.timezone}</div>
            </div>
            <div className="card stat">
              <div className="label">Execuções registradas</div>
              <div className="value">{status.data.lastRuns.length}</div>
            </div>
          </div>

          {run.data && (
            <div className="banner ok" style={{ marginTop: 16 }}>
              <span className="dot green" />
              <div>Sincronização executada. Atualize as telas para ver os dados mais recentes.</div>
            </div>
          )}

          <div className="card" style={{ marginTop: 16, padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Início</th>
                  <th>Entidade</th>
                  <th>Status</th>
                  <th className="num">Registros</th>
                  <th>Erro</th>
                </tr>
              </thead>
              <tbody>
                {status.data.lastRuns.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.startedAt).toLocaleString('pt-BR')}</td>
                    <td>{r.entity}</td>
                    <td>
                      <span className={`badge ${statusClass[r.status] ?? 'gray'}`}>{r.status}</span>
                    </td>
                    <td className="num">{r.recordsWritten}</td>
                    <td className="muted" style={{ maxWidth: 280, fontSize: 12 }}>
                      {r.error ?? '—'}
                    </td>
                  </tr>
                ))}
                {status.data.lastRuns.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      Nenhuma sincronização executada ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="empty">Não foi possível obter o status da sincronização.</div>
      )}
    </>
  );
}
