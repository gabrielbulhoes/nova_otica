import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getDecisionHistory,
  getDecisionStats,
  type DecisionHistoryRow,
  type DecisionOutcome,
  formatBRL,
} from '../api/client';
import {
  BotaoPrimario,
  ExportCsv,
  Loading,
  PageHeader,
  Selo,
  StatCard,
  type TomDeSelo,
} from '../components/ui';
import type { IconName } from '../brand/Icon';

/**
 * Aprovado e recusado NUNCA se separam só pelo verde e pelo vermelho aqui: esta
 * é a tela que existe para virar PDF, e no papel (ou sob `filter:grayscale(1)`)
 * os dois tons ficam a uma distância de luminância que não se lê. Cada
 * ocorrência do par carrega, além do tom, o rótulo escrito e uma forma —
 * ícone no selo, hachura na barra.
 */
const OUTCOME_META: Record<
  DecisionOutcome,
  { label: string; tom: TomDeSelo; icone: IconName; forte?: boolean }
> = {
  APPROVED: { label: 'Aprovado', tom: 'green', icone: 'aprovar' },
  // forte: a recusa é a decisão que alguém pode precisar justificar depois.
  REJECTED: { label: 'Recusado', tom: 'red', icone: 'recusar', forte: true },
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

/* Preenchimento das barras. A recusa é hachurada: forma atravessa o cinza, o
   daltonismo e a impressora — a cor, sozinha, não atravessa nenhum dos três.
   `print-color-adjust: exact` porque o navegador não imprime fundo por padrão e,
   sem isso, "Exportar PDF" entregaria um gráfico em branco. */
const PREENCHIMENTO = {
  aprovado: 'var(--green)',
  recusado: 'repeating-linear-gradient(45deg, var(--red) 0 2px, var(--panel) 2px 4.5px)',
} as const;

const impressaoFiel = {
  WebkitPrintColorAdjust: 'exact',
  printColorAdjust: 'exact',
} as const;

/** Quadrado da legenda: o mesmo preenchimento que a barra usa, na mesma ordem. */
function Amostra({ preenchimento }: { preenchimento: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 11,
        height: 11,
        background: preenchimento,
        border: '1px solid var(--border-strong)',
        verticalAlign: -1,
        ...impressaoFiel,
      }}
    />
  );
}

/** Barra de série diária aprovados × recusados (sem dependência de gráfico). */
function Series({ data }: { data: { date: string; approved: number; rejected: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.approved + d.rejected));
  const aprovados = data.reduce((a, d) => a + d.approved, 0);
  const recusados = data.reduce((a, d) => a + d.rejected, 0);
  return (
    <div
      // O leitor de tela não lê barra: sem o resumo, esta caixa é um silêncio de
      // 90px de altura no meio da página.
      role="img"
      aria-label={`Série diária dos últimos ${data.length} dias: ${aprovados} decisões aprovadas e ${recusados} recusadas.`}
      style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90, marginTop: 10 }}
    >
      {data.map((d) => {
        const total = d.approved + d.rejected;
        return (
          <div
            key={d.date}
            title={`${d.date}: ${d.approved} aprovados · ${d.rejected} recusados`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}
          >
            {d.rejected > 0 && (
              // Topo reto: a geometria do sistema só arredonda dentro da forma
              // da marca — a barra não é a marca.
              <div style={{ height: `${(d.rejected / max) * 100}%`, background: PREENCHIMENTO.recusado, ...impressaoFiel }} />
            )}
            {d.approved > 0 && (
              <div style={{ height: `${(d.approved / max) * 100}%`, background: PREENCHIMENTO.aprovado, ...impressaoFiel }} />
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
      {/* Era <h1> solto + <p className="muted"> — as outras 15 telas usam
          <PageHeader>, e o parágrafo solto perdia o teto de 78ch do .page-sub:
          o subtítulo desta página estava saindo numa linha só de ponta a ponta.
          Sem `eyebrow`: nenhuma tela do console usa sobretítulo hoje, e
          estrear um aqui criaria a divergência que este ajuste veio fechar. */}
      <PageHeader
        title="Histórico Geral"
        subtitle="Toda decisão tomada sobre um card fica registrada: quem decidiu, quando, com que justificativa e qual era o impacto naquele momento. Nada é sobrescrito."
        // window.print() leva a página inteira — indicadores, série, equipe e
        // trilha. É ação de tela, não da tabela, então mora no cabeçalho. É
        // também o ÚNICO sólido daqui: o CSV, que exporta só as linhas
        // filtradas, fica terciário lá embaixo.
        actions={
          <BotaoPrimario
            className="no-print"
            icone="imprimir"
            onClick={() => window.print()}
            title="Abre o diálogo de impressão — escolha 'Salvar como PDF'"
          >
            Exportar PDF
          </BotaoPrimario>
        }
      />

      {s && (
        <div className="grid grid-4">
          {/* Os quatro indicadores usavam <div className="muted"> como rótulo,
              em Inter minúsculo, enquanto Dashboard, BI, Alertas e Decisões
              desenham o mesmo componente conceitual com <StatCard> (rótulo em
              mono caixa alta, número em Fraunces). Duas aparências para a mesma
              coisa no mesmo produto. Agora é o componente compartilhado. */}
          <StatCard
            label="Aprovados (30d)"
            icon="aprovar"
            value={<span style={{ color: 'var(--green)' }}>{s.approved}</span>}
            hint={`${formatBRL(s.approvedImpact)} em impacto`}
          />
          <StatCard
            label="Recusados (30d)"
            icon="recusar"
            value={<span style={{ color: 'var(--red)' }}>{s.rejected}</span>}
            hint={`${formatBRL(s.rejectedImpact)} em impacto`}
          />
          <StatCard
            label="Tempo até decidir"
            value={s.avgDaysToDecide != null ? `${s.avgDaysToDecide}d` : '—'}
            hint="média desde que o card apareceu"
          />
          <StatCard
            label="SLA de decisão"
            value={`${s.slaDays}d`}
            hint="além disso o card vira crítico"
          />
        </div>
      )}

      {s && s.series.length > 0 && (
        <div className="card">
          <h3 className="section-title">Aprovações e recusas — últimos {s.series.length} dias</h3>
          <p className="muted" style={{ margin: '-4px 0 0', fontSize: 12 }}>
            <Amostra preenchimento={PREENCHIMENTO.aprovado} /> aprovados ·{' '}
            <Amostra preenchimento={PREENCHIMENTO.recusado} /> recusados
          </p>
          <Series data={s.series} />
        </div>
      )}

      {s && s.byUser.length > 0 && (
        <div className="card">
          <h3 className="section-title">Desempenho da equipe</h3>
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
                  {/* O tom aqui é reforço: quem diz o que a coluna é, é o
                      cabeçalho escrito acima dela. */}
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
          <h3 className="section-title" style={{ marginRight: 'auto', marginBottom: 0 }}>
            Trilha de decisões
          </h3>
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
          <Loading />
        ) : rows.length === 0 ? (
          <div className="empty">
            Nenhuma decisão registrada ainda. Abra <strong>Decisões</strong> e aprove ou recuse um card.
          </div>
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
                    <Selo
                      tom={OUTCOME_META[r.outcome].tom}
                      icone={OUTCOME_META[r.outcome].icone}
                      forte={OUTCOME_META[r.outcome].forte}
                    >
                      {OUTCOME_META[r.outcome].label}
                    </Selo>
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
