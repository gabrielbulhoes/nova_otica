import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMovements,
  getStores,
  getProducts,
  createMovement,
  confirmMovement,
  cancelMovement,
  approveMovement,
  rejectMovement,
} from '../api/client';
import { PageHeader, Loading, StatusBadge, movementTypeLabel } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { useScope } from '../lib/scope';
import { getRebalancePlan } from '../api/client';
import type { RebalanceSuggestion } from '../api/client';

const TYPES = [
  { value: 'TRANSFER', label: 'Transferência entre lojas' },
  { value: 'SALE', label: 'Baixa por venda' },
  { value: 'RETURN', label: 'Devolução / entrada' },
  { value: 'ADJUSTMENT', label: 'Ajuste manual' },
];

/**
 * Transferências SUGERIDAS pelo motor, no topo da própria tela de
 * transferências.
 *
 * Feedback 04 do Galbe: "o quadro de transferências deveria estar bem mais
 * sugestivo após as análises, consta apenas com uma transferência sugerida".
 * A conta estava certa — ele abriu o REGISTRO de movimentações, que só tinha a
 * linha que ele mesmo criou. As sugestões existiam, em outras duas telas. O
 * defeito é de arquitetura de informação: a tela não entrega o que o nome
 * promete. Agora entrega, e criar a movimentação é um clique.
 */
function SugestoesDeTransferencia({ onCriada }: { onCriada: () => void }) {
  const { scope } = useScope();
  const [criadas, setCriadas] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  const plano = useQuery({
    queryKey: ['planning-rebalance', '90', scope],
    queryFn: () => getRebalancePlan({ days: '90', group: scope }),
    staleTime: 5 * 60_000,
  });

  const criar = useMutation({
    mutationFn: (r: RebalanceSuggestion) =>
      createMovement({
        type: 'TRANSFER',
        productId: r.productId,
        fromStoreId: r.fromStoreId,
        toStoreId: r.toStoreId,
        quantity: r.quantity,
        reason: r.friendlyReason ?? r.reason,
      }),
    onError: (e: unknown) => setErro(e instanceof Error ? e.message : 'Falha ao criar a movimentação.'),
    onSuccess: (_d, r) => {
      setErro(null);
      setCriadas((s) => new Set(s).add(chave(r)));
      onCriada();
    },
  });

  const chave = (r: RebalanceSuggestion) => `${r.productId}:${r.fromStoreId}:${r.toStoreId}`;
  const rows = plano.data?.rows ?? [];

  if (plano.isLoading) return <Loading />;

  return (
    <div className="card" style={{ padding: 0, marginBottom: 18 }}>
      <div style={{ padding: '14px 16px 10px' }}>
        <div className="section-title" style={{ marginBottom: 2 }}>
          Transferências sugeridas pelo motor
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}>
          {rows.length > 0
            ? `${rows.length} ${rows.length > 1 ? 'sugestões' : 'sugestão'} — de onde está parado para onde vende, somando ${
                plano.data?.summary?.units ?? 0
              } unidades.`
            : 'Nenhuma sugestão no recorte atual. Troque o recorte no topo ou confira o Planejamento.'}
        </div>
        {erro && (
          <div className="muted" style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{erro}</div>
        )}
      </div>

      {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Rota</th>
              <th className="num">Qtd.</th>
              <th>Por quê</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 30).map((r) => {
              const k = chave(r);
              const feita = criadas.has(k);
              return (
                <tr key={k}>
                  <td>
                    <div>{r.description}</div>
                    {r.brand && <div className="muted" style={{ fontSize: 11.5 }}>{r.brand}</div>}
                  </td>
                  <td style={{ fontSize: 12.5 }}>
                    {r.fromStoreName} <span className="muted">→</span> <strong>{r.toStoreName}</strong>
                  </td>
                  <td className="num">{r.quantity}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{r.friendlyReason ?? r.reason}</td>
                  <td style={{ textAlign: 'right' }}>
                    {feita ? (
                      <span className="badge green">solicitada</span>
                    ) : (
                      <button
                        className="btn sm"
                        disabled={criar.isPending}
                        onClick={() => criar.mutate(r)}
                      >
                        Criar movimentação
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {rows.length > 30 && (
        <div className="muted" style={{ padding: '10px 16px', fontSize: 12 }}>
          Mostrando as 30 de maior impacto, de {rows.length}. O conjunto completo está em Decisões.
        </div>
      )}
    </div>
  );
}

export function Movements() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [statusFilter, setStatusFilter] = useState('');
  const [open, setOpen] = useState(false);

  const movements = useQuery({
    queryKey: ['movements', statusFilter],
    queryFn: () => getMovements({ status: statusFilter || undefined }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['movements'] });
    qc.invalidateQueries({ queryKey: ['stock'] });
    qc.invalidateQueries({ queryKey: ['alerts'] });
  };

  const confirm = useMutation({ mutationFn: confirmMovement, onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: cancelMovement, onSuccess: invalidate });
  const approve = useMutation({ mutationFn: (id: string) => approveMovement(id), onSuccess: invalidate });
  const reject = useMutation({
    mutationFn: (id: string) => rejectMovement(id, 'Rejeitada pela rede'),
    onSuccess: invalidate,
  });

  return (
    <>
      <div className="row-between">
        <PageHeader
          title="Transferências e movimentações"
          subtitle="Operações de estoque registradas em tempo real, reconciliadas na sincronização da manhã."
        />
        <button className="btn" onClick={() => setOpen(true)}>
          + Nova movimentação
        </button>
      </div>

      <SugestoesDeTransferencia onCriada={invalidate} />

      <div className="toolbar">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="REQUESTED">Solicitadas</option>
          <option value="PENDING">Aprovadas/Pendentes</option>
          <option value="CONFIRMED">Confirmadas</option>
          <option value="REJECTED">Rejeitadas</option>
          <option value="CANCELLED">Canceladas</option>
          <option value="RECONCILED">Reconciliadas</option>
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {movements.isLoading ? (
          <Loading />
        ) : movements.data && movements.data.rows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Produto</th>
                <th>Origem</th>
                <th>Destino</th>
                <th className="num">Qtd.</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {movements.data.rows.map((m) => (
                <tr key={m.id}>
                  <td>{new Date(m.createdAt).toLocaleString('pt-BR')}</td>
                  <td>{movementTypeLabel(m.type)}</td>
                  <td>{m.product.description}</td>
                  <td>{m.fromStore?.name ?? '—'}</td>
                  <td>{m.toStore?.name ?? '—'}</td>
                  <td className="num">{m.quantity}</td>
                  <td>
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="right">
                    {m.status === 'REQUESTED' && isAdmin && (
                      <>
                        <button
                          className="btn sm"
                          disabled={approve.isPending}
                          onClick={() => approve.mutate(m.id)}
                        >
                          Aprovar
                        </button>{' '}
                        <button
                          className="btn sm danger"
                          disabled={reject.isPending}
                          onClick={() => reject.mutate(m.id)}
                        >
                          Rejeitar
                        </button>
                      </>
                    )}
                    {m.status === 'REQUESTED' && !isAdmin && (
                      <button
                        className="btn sm danger"
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(m.id)}
                      >
                        Cancelar
                      </button>
                    )}
                    {m.status === 'PENDING' && (
                      <>
                        <button
                          className="btn sm"
                          disabled={confirm.isPending}
                          onClick={() => confirm.mutate(m.id)}
                        >
                          Confirmar
                        </button>{' '}
                        <button
                          className="btn sm danger"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate(m.id)}
                        >
                          Cancelar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">Nenhuma movimentação registrada.</div>
        )}
      </div>

      {open && <MovementModal onClose={() => setOpen(false)} />}
    </>
  );
}

function MovementModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores });
  const products = useQuery({
    queryKey: ['products', 'modal'],
    queryFn: () => getProducts({ limit: 300 }),
  });

  const [form, setForm] = useState({
    type: 'TRANSFER',
    productId: '',
    fromStoreId: '',
    toStoreId: '',
    quantity: 1,
    reason: '',
    confirm: false,
  });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: createMovement,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movements'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Erro ao registrar movimentação.';
      setError(msg);
    },
  });

  const needsFrom = form.type === 'TRANSFER' || form.type === 'SALE' || form.type === 'ADJUSTMENT';
  const needsTo = form.type === 'TRANSFER' || form.type === 'RETURN' || form.type === 'ADJUSTMENT';

  const submit = () => {
    setError(null);
    create.mutate({
      type: form.type,
      productId: form.productId,
      fromStoreId: form.fromStoreId || undefined,
      toStoreId: form.toStoreId || undefined,
      quantity: Number(form.quantity),
      reason: form.reason || undefined,
      confirm: form.confirm,
      createdBy: 'web',
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title">Nova movimentação</h3>

        <div className="field">
          <label>Tipo</label>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Produto</label>
          <select
            value={form.productId}
            onChange={(e) => setForm({ ...form, productId: e.target.value })}
          >
            <option value="">Selecione…</option>
            {products.data?.rows.map((p) => (
              <option key={p.id} value={p.id}>
                {p.description} (#{p.externalId})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-2">
          {needsFrom && (
            <div className="field">
              <label>Origem</label>
              <select
                value={form.fromStoreId}
                onChange={(e) => setForm({ ...form, fromStoreId: e.target.value })}
              >
                <option value="">Selecione…</option>
                {stores.data?.rows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {needsTo && (
            <div className="field">
              <label>Destino</label>
              <select
                value={form.toStoreId}
                onChange={(e) => setForm({ ...form, toStoreId: e.target.value })}
              >
                <option value="">Selecione…</option>
                {stores.data?.rows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="grid grid-2">
          <div className="field">
            <label>Quantidade</label>
            <input
              type="number"
              min={1}
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Motivo (opcional)</label>
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
        </div>

        <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.checked })}
          />
          Confirmar imediatamente (efetiva no estoque)
        </label>

        {error && <div className="badge red" style={{ display: 'block', marginBottom: 12, padding: 10 }}>{error}</div>}

        <div className="row-between">
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn"
            disabled={create.isPending || !form.productId}
            onClick={submit}
          >
            {create.isPending ? 'Salvando…' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  );
}
