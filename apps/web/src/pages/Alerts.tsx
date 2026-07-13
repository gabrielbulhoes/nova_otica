import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAlerts, setMinStock, type StockAlert } from '../api/client';
import { PageHeader, Loading, StatCard } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

export function Alerts() {
  const { isAdmin } = useAuth();
  const [level, setLevel] = useState('');

  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => getAlerts({}) });
  const rows = (alerts.data?.rows ?? []).filter((r) => !level || r.level === level);

  return (
    <>
      <PageHeader
        title="Alertas de ruptura"
        subtitle="Produtos sem saldo (ruptura) ou abaixo do estoque mínimo, por loja."
      />

      {alerts.data && (
        <div className="grid grid-4">
          <StatCard label="Total de alertas" value={alerts.data.total} />
          <StatCard label="Rupturas (saldo 0)" value={alerts.data.out} />
          <StatCard label="Estoque baixo" value={alerts.data.low} />
          <div className="card stat">
            <div className="label">Filtrar</div>
            <select value={level} onChange={(e) => setLevel(e.target.value)} style={{ marginTop: 8 }}>
              <option value="">Todos</option>
              <option value="OUT">Somente rupturas</option>
              <option value="LOW">Somente baixo</option>
            </select>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        {alerts.isLoading ? (
          <Loading />
        ) : rows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Nível</th>
                <th>Produto</th>
                <th>Loja</th>
                <th className="num">Disponível</th>
                <th className="num">Mínimo</th>
                {isAdmin && <th className="num">Ajustar mínimo</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.storeId}-${r.productId}`}>
                  <td>
                    <span className={`badge ${r.level === 'OUT' ? 'red' : 'amber'}`}>
                      {r.level === 'OUT' ? 'Ruptura' : 'Baixo'}
                    </span>
                  </td>
                  <td>{r.description}</td>
                  <td>{r.storeName}</td>
                  <td className="num">{r.availableNow}</td>
                  <td className="num">{r.threshold}</td>
                  {isAdmin && (
                    <td className="num">
                      <MinStockEditor alert={r} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">Nenhum alerta. 🎉</div>
        )}
      </div>
    </>
  );
}

function MinStockEditor({ alert }: { alert: StockAlert }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(String(alert.threshold));
  const save = useMutation({
    // Editar numa linha de alerta define o mínimo DAQUELA loja (override).
    mutationFn: (v: number) => setMinStock(alert.productId, v, alert.storeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });

  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ width: 70, padding: '4px 8px' }}
      />
      <button
        className="btn sm"
        disabled={save.isPending}
        title="Define o mínimo desta loja para este produto"
        onClick={() => save.mutate(Number(value))}
      >
        OK
      </button>
    </span>
  );
}
