import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDecisionBoard, createMovement, formatBRL ,
  recordDecision,
} from '../api/client';
import type { DecisionCard, DecisionType, DecisionPriority } from '../api/client';
import { Loading } from '../components/ui';

const typeMeta: Record<DecisionType, { label: string; cls: string; icon: string; accent: string }> = {
  COMPRA: { label: 'Comprar', cls: 'blue', icon: '🛒', accent: 'var(--accent)' },
  REMANEJAMENTO: { label: 'Remanejar', cls: 'green', icon: '🔁', accent: 'var(--green)' },
  LIQUIDACAO: { label: 'Liquidar', cls: 'amber', icon: '🏷️', accent: 'var(--amber)' },
};
const prioMeta: Record<DecisionPriority, { label: string; cls: string }> = {
  ALTA: { label: 'Alta', cls: 'red' },
  MEDIA: { label: 'Média', cls: 'amber' },
  BAIXA: { label: 'Baixa', cls: 'gray' },
};

type TypeFilter = 'ALL' | DecisionType;
type PrioFilter = 'ALL' | DecisionPriority;

function Confidence({ value }: { value: number }) {
  const cls = value >= 75 ? 'green' : value >= 50 ? 'amber' : 'gray';
  return (
    <span className={`badge ${cls}`} title="Confiabilidade da decisão: mais vendas e histórico = mais confiável.">
      {value}%
    </span>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value" style={tone ? { color: tone } : undefined}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function Card({ c, onDecided }: { c: DecisionCard; onDecided: () => void }) {
  const t = typeMeta[c.type];
  const p = prioMeta[c.priority];
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  // Decisão persistida (trilha de auditoria). Recusar exige justificativa.
  const [decided, setDecided] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [decErr, setDecErr] = useState('');

  const decide = async (outcome: 'APPROVED' | 'REJECTED') => {
    setDeciding(true);
    setDecErr('');
    try {
      await recordDecision({
        cardId: c.id,
        cardType: c.type,
        outcome,
        impact: c.impact,
        note: outcome === 'REJECTED' ? note.trim() : undefined,
        productId: c.productId,
        storeId: c.toStoreId ?? c.fromStoreId,
      });
      setDecided(outcome);
      setRejecting(false);
      onDecided();
    } catch (e) {
      setDecErr(e instanceof Error ? e.message : 'Não foi possível registrar a decisão.');
    } finally {
      setDeciding(false);
    }
  };
  const [err, setErr] = useState('');

  const approveTransfer = async () => {
    if (!c.fromStoreId || !c.toStoreId || !c.quantity) return;
    setState('loading');
    try {
      await createMovement({
        type: 'TRANSFER',
        productId: c.productId,
        fromStoreId: c.fromStoreId,
        toStoreId: c.toStoreId,
        quantity: c.quantity,
        reason: 'Aprovado no portal de Decisões (remanejamento por giro).',
      });
      setState('done');
      qc.invalidateQueries({ queryKey: ['movements'] });
      qc.invalidateQueries({ queryKey: ['decisions'] });
    } catch (e) {
      setState('error');
      const ex = e as { response?: { data?: { error?: string } } };
      setErr(ex.response?.data?.error ?? 'Falha ao solicitar. Tente novamente.');
    }
  };

  return (
    <div
      className="card"
      style={{
        padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        borderLeft: `3px solid ${t.accent}`,
      }}
    >
      <div style={{ padding: '13px 15px 0', display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className={`badge ${t.cls}`}>{t.icon} {t.label}</span>
          <span className={`badge ${p.cls}`}>{p.label}</span>
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>{c.id}</span>
        </div>

        <div>
          <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.25 }}>{c.title}</div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
            {c.description}{c.brand ? ` · ${c.brand}` : ''}
          </div>
        </div>

        <div style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="muted">Alvo:</span>
          <strong>{c.target}</strong>
          {c.quantity != null && c.quantity > 0 && (
            <span className="muted">· {c.quantity} un.</span>
          )}
          {c.urgencyDays != null && (
            <span style={{ color: 'var(--red)', fontSize: 11.5 }}>· ruptura ~{c.urgencyDays}d</span>
          )}
        </div>

        <div
          style={{
            background: 'var(--panel-2)', borderRadius: 8, padding: '8px 10px',
            fontSize: 12.5, lineHeight: 1.4, color: 'var(--text)',
          }}
        >
          💡 {c.reason}
        </div>
      </div>

      <div
        style={{
          marginTop: 10, padding: '10px 15px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}
      >
        <div>
          {c.impact > 0 ? (
            <>
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatBRL(c.impact)}</span>
              <span className="muted" style={{ fontSize: 11, marginLeft: 5 }}>{c.impactLabel}</span>
            </>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>{c.impactLabel}</span>
          )}
        </div>
        <Confidence value={c.confidence} />
      </div>

      <div
        style={{
          padding: '10px 15px', borderTop: '1px solid var(--border)', background: 'var(--panel-2)',
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}
      >
        {c.type === 'REMANEJAMENTO' ? (
          state === 'done' ? (
            <span className="badge green">Transferência solicitada ✓</span>
          ) : (
            <button className="btn sm" onClick={approveTransfer} disabled={state === 'loading'}>
              {state === 'loading' ? 'Solicitando…' : 'Aprovar transferência'}
            </button>
          )
        ) : (
          <button className="btn sm ghost" onClick={() => navigate('/admin/planejamento')}>
            Abrir em Compras
          </button>
        )}
        {state !== 'done' && (
          <>
            {c.type !== 'REMANEJAMENTO' && (
              <button
                className="btn sm"
                disabled={deciding}
                onClick={() => decide('APPROVED')}
                title="Registra a aprovação na trilha de auditoria"
              >
                {deciding ? 'Registrando…' : '✓ Aprovar'}
              </button>
            )}
            <button
              className="btn sm ghost"
              disabled={deciding}
              onClick={() => setRejecting((v) => !v)}
            >
              ✗ Recusar
            </button>
          </>
        )}
        {decided && (
          <span className={`badge ${decided === 'APPROVED' ? 'green' : 'gray'}`}>
            {decided === 'APPROVED' ? 'Aprovado ✓' : 'Recusado — registrado'}
          </span>
        )}
        {state === 'error' && <div style={{ fontSize: 11, color: 'var(--red)' }}>{err}</div>}
        {decErr && <div style={{ fontSize: 11, color: 'var(--red)', flexBasis: '100%' }}>{decErr}</div>}
        {rejecting && !decided && (
          <div style={{ flexBasis: '100%', display: 'flex', gap: 6, marginTop: 6 }}>
            <input
              className="input"
              style={{ flex: 1, fontSize: 12 }}
              placeholder="Por que recusar? (obrigatório — fica no histórico)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) decide('REJECTED'); }}
              autoFocus
            />
            <button
              className="btn sm"
              disabled={!note.trim() || deciding}
              onClick={() => decide('REJECTED')}
            >
              Confirmar recusa
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Decisions() {
  const [typeF, setTypeF] = useState<TypeFilter>('ALL');
  const [prioF, setPrioF] = useState<PrioFilter>('ALL');
  const params = { days: 90, group: 'principal' };
  const board = useQuery({ queryKey: ['decisions', params], queryFn: () => getDecisionBoard(params) });

  const cards = useMemo(() => {
    const all = board.data?.cards ?? [];
    return all.filter(
      (c) => (typeF === 'ALL' || c.type === typeF) && (prioF === 'ALL' || c.priority === prioF),
    );
  }, [board.data, typeF, prioF]);

  const s = board.data?.summary;

  return (
    <div>
      <div className="section-title" style={{ marginBottom: 4 }}>Decisões</div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        Cada oportunidade da rede vira um card: o que comprar, o que remanejar e o que liquidar —
        com prioridade, impacto e o porquê. Ordenado pela prioridade e pelo maior impacto.
      </div>

      {board.isLoading || !s ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-4" style={{ marginBottom: 18 }}>
            <Kpi label="Cards em aberto" value={String(s.total)}
                 hint={`${s.byType.compra} comprar · ${s.byType.remanejamento} remanejar · ${s.byType.liquidacao} liquidar`} />
            <Kpi label="Impacto sob decisão" value={formatBRL(s.impactTotal)} tone="var(--accent)"
                 hint="capital a comprar + a liberar" />
            <Kpi label="Alta prioridade" value={String(s.byPriority.alta)} tone="var(--red)"
                 hint={`${s.byPriority.media} média · ${s.byPriority.baixa} baixa`} />
            <Kpi label="Críticos (~7 dias)" value={String(s.criticos)} tone={s.criticos > 0 ? 'var(--red)' : undefined}
                 hint="ruptura próxima" />
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <div className="segmented">
              {(['ALL', 'COMPRA', 'REMANEJAMENTO', 'LIQUIDACAO'] as TypeFilter[]).map((k) => (
                <button key={k} className={typeF === k ? 'active' : ''} onClick={() => setTypeF(k)} aria-pressed={typeF === k}>
                  {k === 'ALL' ? 'Todos' : typeMeta[k].label}
                </button>
              ))}
            </div>
            <div className="segmented">
              {(['ALL', 'ALTA', 'MEDIA', 'BAIXA'] as PrioFilter[]).map((k) => (
                <button key={k} className={prioF === k ? 'active' : ''} onClick={() => setPrioF(k)} aria-pressed={prioF === k}>
                  {k === 'ALL' ? 'Todas' : prioMeta[k].label}
                </button>
              ))}
            </div>
          </div>

          {cards.length === 0 ? (
            <div className="empty">Nenhum card nesta seleção — rede bem ajustada por aqui. 👏</div>
          ) : (
            <div className="grid grid-3">
              {cards.map((c) => <Card key={c.id} c={c} onDecided={() => board.refetch()} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
