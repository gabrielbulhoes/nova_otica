import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCommercialStrategy } from '../api/client';
import type { RiskProfile, StrategySegment } from '../api/client';
import { Loading, PageHeader, Selo } from '../components/ui';
import { Icon } from '../brand/Icon';

/**
 * Cor de cada fatia da compra.
 *
 * Os três tons precisam ser separáveis SEM cor — a barra empilhada é lida de
 * relance e a auditoria mostrou que a paleta quente do manual colapsa sob
 * deuteranopia. Por isso a escolha é por LUMINÂNCIA, não por matiz:
 * verde (cinza 92) · tinta (cinza 38) · âmbar (cinza 73). Os três também
 * passam de 3:1 como filete de 3px, que é o papel que cumprem no topo dos
 * cartões abaixo.
 *
 * O que NÃO serve aqui, e o motivo: --accent (ouro-texto) fica a 7 pontos de
 * cinza do âmbar, ou seja, duas fatias viram a mesma barra em P&B; e o ouro
 * puro daria um filete de 2.17:1 no cartão — o mesmo erro que a Onda 2 já
 * corrigiu no .banner.warn e no .action-card.
 *
 * São ALIASES da camada 2 de propósito: é o alias que troca de valor no tema
 * escuro; o token da camada 1 ficaria preso ao tema claro.
 */
const segColor: Record<StrategySegment['key'], string> = {
  'best-seller': 'var(--green)',
  lancamento: 'var(--text)',
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
    <>
      {/* Sem botão primário nesta tela, e é resposta certa: aqui não se executa
          nada — mexe-se nos parâmetros e o motor recalcula. O ouro preenchido
          fica para a tela que tem uma ação a cometer (Planejamento & Compras). */}
      <PageHeader
        title="Estratégia comercial"
        subtitle="Piso, risco e janela — a estratégia da compra. Defina quanto comprar e como distribuir; o motor valida contra a capacidade da rede e divide em best-seller, lançamento e aposta."
      />

      <div className="grid grid-2" style={{ alignItems: 'start', gap: 16 }}>
        {/* ── Parâmetros ── */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <p className="eyebrow">Parâmetros</p>

          {/* Deixou de ser um <label> só: ele envolvia DOIS campos, e o rótulo
              nativo só endereça o primeiro. Cada campo carrega o seu aria-label. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="label">Piso de compra</div>
            {/* Número herói em Fraunces, unidade em mono caixa alta: é a mesma
                gramática do indicador em todo o console. */}
            <div className="kpi">
              {fmt(floor)}
              <span className="label" style={{ marginLeft: 8 }}>un.</span>
            </div>
            <input
              type="range"
              min={0}
              max={sliderMax}
              step={50}
              value={Math.min(floor, sliderMax)}
              onChange={(e) => setFloor(Number(e.target.value))}
              aria-label="Piso de compra (controle deslizante)"
              style={{ width: '100%', accentColor: 'var(--accent)', border: 'none', padding: 0 }}
            />
            <input
              type="number"
              min={0}
              value={floor}
              onChange={(e) => setFloor(Math.max(0, Number(e.target.value) || 0))}
              aria-label="Piso de compra em unidades"
              style={{ width: 130 }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="label">Perfil de risco</div>
            <div className="segmented">
              {(['conservador', 'equilibrado', 'agressivo'] as RiskProfile[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={risk === k ? 'active' : ''}
                  onClick={() => setRisk(k)}
                  aria-pressed={risk === k}
                >
                  {riskLabel[k]}
                </button>
              ))}
            </div>
            <div className="hint">Conservador reforça o que já vende; agressivo abre mais espaço para aposta.</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label className="label" htmlFor="janela-de-venda">Janela de venda</label>
            <select
              id="janela-de-venda"
              className="input"
              value={windowMonths}
              onChange={(e) => setWindowMonths(Number(e.target.value))}
              style={{ width: 160 }}
            >
              {WINDOWS.map((m) => <option key={m} value={m}>{m} meses</option>)}
            </select>
          </div>
        </div>

        {/* ── Decisão do motor ── */}
        <div className="card">
          <p className="eyebrow">Decisão do motor</p>
          {q.isLoading || !s ? (
            <Loading />
          ) : (
            <>
              {/* Era um bloco com fundo em color-mix e canto arredondado: fora do
                  sistema (superfície é papel, raio 0) e com o estado só na cor.
                  O .banner já traz filete esquerdo na cor do estado, e o selo
                  traz a palavra e o ícone — três canais, nenhum deles cromático. */}
              <div className={`banner ${s.viable ? 'ok' : 'warn'}`} style={{ alignItems: 'flex-start' }}>
                <Selo
                  tom={s.viable ? 'green' : 'amber'}
                  icone={s.viable ? 'aprovar' : 'atencao'}
                  forte={!s.viable}
                >
                  {s.viable ? 'Viável' : 'Atenção'}
                </Selo>
                <span style={{ lineHeight: 1.45 }}>{s.verdict}</span>
              </div>

              <div style={{ display: 'flex', gap: 28, marginBottom: 18, flexWrap: 'wrap' }}>
                <div>
                  <div className="label">Capacidade na janela</div>
                  <div className="kpi">
                    {fmt(s.capacity)}
                    <span className="label" style={{ marginLeft: 6 }}>un.</span>
                  </div>
                </div>
                <div>
                  <div className="label">Uso da capacidade</div>
                  <div className="kpi">{s.capacityUsedPct}%</div>
                </div>
                <div>
                  <div className="label">Com lastro</div>
                  <div className="kpi">{s.backedPct}%</div>
                </div>
              </div>

              {/* Barra empilhada */}
              <div className="hint" style={{ marginTop: 0, marginBottom: 6 }}>
                Como as {fmt(s.floorUnits)} un. se dividem
              </div>
              <div style={{ display: 'flex', height: 22, overflow: 'hidden', border: '1px solid var(--border)' }}>
                {s.segments.filter((x) => x.units > 0).map((seg) => (
                  <div key={seg.key} title={`${seg.label}: ${fmt(seg.units)} un. (${seg.pct}%)`}
                       style={{ width: `${seg.pct}%`, background: segColor[seg.key] }} />
                ))}
                {s.floorUnits === 0 && <div style={{ width: '100%', background: 'var(--panel-2)' }} />}
              </div>

              {/* Legenda direta, na MESMA ordem da barra. Sem ela a barra separa
                  as fatias só por cor, e cor sozinha não opera (WCAG 1.4.1):
                  o nome escrito e a ordem são o que sobra em escala de cinza. */}
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 8 }}>
                {s.segments.map((seg) => (
                  <span key={seg.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
                    <span style={{ width: 14, height: 3, background: segColor[seg.key], flex: 'none' }} />
                    {seg.label}
                    <span className="muted">{seg.pct}%</span>
                  </span>
                ))}
              </div>

              {s.withoutBacking > 0 && (
                <div className="banner warn" style={{ marginTop: 14, marginBottom: 0 }}>
                  <Icon name="atencao" size={18} />
                  <span>
                    <strong>{fmt(s.withoutBacking)} un.</strong> acima da demanda projetada (sem lastro).
                  </span>
                </div>
              )}

              <div className="grid grid-3" style={{ marginTop: 16, gap: 10 }}>
                {s.segments.map((seg) => (
                  <div key={seg.key} className="card" style={{ padding: 14, borderTop: `3px solid ${segColor[seg.key]}` }}>
                    <div className="label">{seg.label}</div>
                    <div className="kpi">{fmt(seg.units)}</div>
                    <div className="hint">{seg.rationale} · {seg.pct}%</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
