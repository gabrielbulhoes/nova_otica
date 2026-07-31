import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAlerts,
  getCategories,
  getRebalancePlan,
  getStores,
  setMinStock,
  type StockAlert,
} from '../api/client';
import { PageHeader, Loading, StatCard } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { useScope } from '../lib/scope';

export function Alerts() {
  const { isAdmin } = useAuth();
  const { scope } = useScope();
  const [level, setLevel] = useState('');
  const [storeId, setStoreId] = useState('');
  const [category, setCategory] = useState('');

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores, enabled: isAdmin });
  const categories = useQuery({
    queryKey: ['categories', scope],
    queryFn: () => getCategories({ group: scope }),
  });

  // Trocar o recorte no título pode deixar um tipo escolhido fora da lista.
  // Em vez de exibir um filtro fantasma, ele se desfaz sozinho.
  const tipos = categories.data ?? [];
  const tipo = category && tipos.length > 0 && !tipos.includes(category) ? '' : category;

  const alerts = useQuery({
    queryKey: ['alerts', scope, storeId, tipo],
    queryFn: () =>
      getAlerts({ group: scope, storeId: storeId || undefined, category: tipo || undefined }),
  });
  const rows = (alerts.data?.rows ?? []).filter((r) => !level || r.level === level);

  // Alerta de transferência (feedback 07): antes de comprar, remanejar o que a
  // rede já tem. Só ADMIN (o plano é da rede inteira).
  const rebalance = useQuery({
    queryKey: ['planning-rebalance', '90'],
    queryFn: () => getRebalancePlan({ days: '90' }),
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });
  const transfers = rebalance.data?.rows.slice(0, 8) ?? [];

  const lojaEscolhida = stores.data?.rows.find((s) => s.id === storeId)?.name;

  return (
    <>
      <PageHeader
        title="Alertas de ruptura"
        subtitle="Produtos sem saldo (ruptura) ou abaixo do estoque mínimo, por loja."
      />

      {/* Filtros da tela: sem loja e sem tipo de produto, uma lista da rede
          inteira com tudo junto não é operável. */}
      <div className="toolbar">
        {isAdmin && (
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Loja">
            <option value="">Todas as lojas</option>
            {stores.data?.rows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <select value={tipo} onChange={(e) => setCategory(e.target.value)} aria-label="Tipo de produto">
          <option value="">Todos os tipos</option>
          {tipos.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Nível do alerta">
          <option value="">Ruptura e estoque baixo</option>
          <option value="OUT">Somente rupturas</option>
          <option value="LOW">Somente estoque baixo</option>
        </select>
        <span style={{ flex: 1 }} />
        {(storeId || tipo || level) && (
          <button
            className="btn sm ghost"
            onClick={() => {
              setStoreId('');
              setCategory('');
              setLevel('');
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {alerts.data && (
        <div className="grid grid-3">
          <StatCard
            label="Total de alertas"
            value={alerts.data.total}
            hint={[lojaEscolhida ?? 'Toda a rede', tipo || 'todos os tipos'].join(' · ')}
          />
          <StatCard label="Rupturas (saldo 0)" value={alerts.data.out} />
          <StatCard label="Estoque baixo" value={alerts.data.low} />
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
          <div className="empty">
            {storeId || tipo || level
              ? 'Nenhum alerta com esses filtros.'
              : 'Nenhum alerta. 🎉'}
          </div>
        )}
      </div>

      {isAdmin && rebalance.data && transfers.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="section-title">↔︎ Transferências sugeridas — remanejar antes de comprar</h3>
          <p className="muted" style={{ marginTop: -4, marginBottom: 10, fontSize: 12.5 }}>
            A rede tem <strong>{rebalance.data.summary.units}</strong> unidades a mover em{' '}
            <strong>{rebalance.data.summary.suggestions}</strong> sugestões (custo zero): produto parado numa loja
            com saída em outra.
          </p>
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
            <Link to="/admin/relatorios" style={{ color: 'var(--accent)' }}>
              Ver o relatório completo de transferências →
            </Link>
          </p>
        </div>
      )}
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
