import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCommercialStrategy } from '../api/client';
import type { RiskProfile, StrategySegment } from '../api/client';
import { Loading } from '../components/ui';

const segColor: Record<StrategySegment['key'], string> = {
  'best-seller': 'var(--green)',
  lancamento: 'var(--accent)',
  aposta: 'var(--amber)',
};
const riskLabel: Record<RiskProfile, string> = {
  conservador: 'Conservador',
  equilibrado: 'Equilibrado',
  agressivo: 'Agressivo',
};
const WINDOWS = [3, 6, 9, 12, 18];
const fmt = (n: number) => n.toLocaleString('pt-BR');

export function Strategy() {
  const [floor, setFloor] = useState(1500);
  const [windowMonths, setWindowMonths] = useState(9);
  const [risk, setRisk] = useState<RiskProfile>('equilibrado');

  const params = { floor, window: windowMonths, risk, days: 90 };
  const q = useQuery({ queryKey: ['strategy', params], queryFn: () => getCommercialStrategy(params) });
  const s = q.data;
  const sliderMax = Math.max(2000, Math.round((s?.capacity ?? 3000) * 1.2));

  return (
    <div>
      <div className="section-title" style={{ marginBottom: 4 }}>Estratégia comercial</div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        Piso, risco e janela — a estratégia da compra. Defina quanto comprar e como distribuir;
        o motor valida contra a capacidade da rede e divide em best-seller, lançamento e aposta.
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start', gap: 16 }}>
        {/* ── Parâmetros ── */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="muted" style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>
            Parâmetros
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Piso de compra</span>
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(floor)} un.</span>
            </div>
            <input type="range" min={0} max={sliderMax} step={50} value={Math.min(floor, sliderMax)}
                   onChange={(e) => setFloor(Number(e.target.value))}
                   style={{ width: '100%', accentColor: 'var(--accent)', border: 'none', padding: 0 }} />
            <input type="number" min={0} value={floor} onChange={(e) => setFloor(Math.max(0, Number(e.target.value) || 0))}
                   style={{ width: 130 }} />
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Perfil de risco</span>
            <div className="segmented">
              {(['conservador', 'equilibrado', 'agressivo'] as RiskProfile[]).map((k) => (
                <button key={k} className={risk === k ? 'active' : ''} onClick={() => setRisk(k)} aria-pressed={risk === k}>
                  {riskLabel[k]}
                </button>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Conservador reforça o que já vende; agressivo abre mais espaço para aposta.
            </div>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Janela de venda</span>
            <select className="input" value={windowMonths} onChange={(e) => setWindowMonths(Number(e.target.value))} style={{ width: 160 }}>
              {WINDOWS.map((m) => <option key={m} value={m}>{m} meses</option>)}
            </select>
          </label>
        </div>

        {/* ── Decisão do motor ── */}
        <div className="card">
          <div className="muted" style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 12 }}>
            Decisão do motor
          </div>
          {q.isLoading || !s ? (
            <Loading />
          ) : (
            <>
              <div
                style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 10,
                  background: s.viable ? 'color-mix(in srgb, var(--green) 12%, transparent)' : 'color-mix(in srgb, var(--amber) 14%, transparent)',
                  marginBottom: 16,
                }}
              >
                <span className={`badge ${s.viable ? 'green' : 'amber'}`}>{s.viable ? 'OK' : 'Atenção'}</span>
                <span style={{ fontSize: 13.5, lineHeight: 1.4 }}>{s.verdict}</span>
              </div>

              <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
                <div>
                  <div className="muted" style={{ fontSize: 11.5 }}>Capacidade da rede (janela)</div>
                  <div style={{ fontWeight: 700, fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{fmt(s.capacity)} un.</div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 11.5 }}>Uso da capacidade</div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{s.capacityUsedPct}%</div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 11.5 }}>Com lastro</div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{s.backedPct}%</div>
                </div>
              </div>

              {/* Barra empilhada */}
              <div style={{ marginBottom: 6, fontSize: 12.5 }} className="muted">
                Como as {fmt(s.floorUnits)} un. se dividem
              </div>
              <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                {s.segments.filter((x) => x.units > 0).map((seg) => (
                  <div key={seg.key} title={`${seg.label}: ${fmt(seg.units)} un. (${seg.pct}%)`}
                       style={{ width: `${seg.pct}%`, background: segColor[seg.key] }} />
                ))}
                {s.floorUnits === 0 && <div style={{ width: '100%', background: 'var(--panel-2)' }} />}
              </div>

              {s.withoutBacking > 0 && (
                <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--red)' }}>
                  ⚠ {fmt(s.withoutBacking)} un. acima da demanda projetada (sem lastro).
                </div>
              )}

              <div className="grid grid-3" style={{ marginTop: 16, gap: 10 }}>
                {s.segments.map((seg) => (
                  <div key={seg.key} className="card" style={{ padding: 14, borderTop: `3px solid ${segColor[seg.key]}` }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{seg.label}</div>
                    <div style={{ fontWeight: 700, fontSize: 22, fontVariantNumeric: 'tabular-nums', margin: '2px 0' }}>{fmt(seg.units)}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{seg.rationale} · {seg.pct}%</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
