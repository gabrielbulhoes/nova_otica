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
  AberturaDeSecao,
  BotaoPrimario,
  Codigo,
  ExportCsv,
  Loading,
  PageHeader,
  Selo,
  StatCard,
  Unidade,
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
        <>
          {/* ═══ HIERARQUIA ══════════════════════════════════════════════════
              Os quatro indicadores usavam <div className="muted"> como rótulo,
              em Inter minúsculo, enquanto Dashboard, BI, Alertas e Decisões
              desenham o mesmo componente conceitual com <StatCard>. Duas
              aparências para a mesma coisa no mesmo produto — resolvido na onda
              anterior trocando pelo componente compartilhado.

              O que faltava era o NÍVEL. Os quatro chegavam idênticos, e dois
              deles não são indicadores: o SLA é um PARÂMETRO da rede (não
              mede nada, declara a régua), e o tempo médio até decidir é a
              leitura desse parâmetro. Os dois viram contexto — que é
              literalmente o papel do nível 3 — e a decisão fica com o par que
              esta tela existe para contar: quantas foram aprovadas e quantas
              foram recusadas.

              Aprovados é o nível 1. Não por ser maior, e sim porque é a
              pergunta: "o que a equipe deixou passar no mês". A recusa é o
              contraponto e fica no nível 2, ao lado. */}
          <div className="grid grid-4">
            <StatCard
              nivel={1}
              className="largo"
              label="Aprovados (30 dias)"
              icon="aprovar"
              value={<span style={{ color: 'var(--green)' }}>{s.approved}</span>}
              hint={`${formatBRL(s.approvedImpact)} em impacto passaram por esta trilha.`}
            />
            <StatCard
              label="Recusados (30 dias)"
              icon="recusar"
              value={<span style={{ color: 'var(--red)' }}>{s.rejected}</span>}
              hint={`${formatBRL(s.rejectedImpact)} em impacto`}
            />
            <StatCard
              label="Tempo até decidir"
              value={s.avgDaysToDecide != null ? String(s.avgDaysToDecide) : '—'}
              unidade={s.avgDaysToDecide != null ? 'dias' : undefined}
              hint="média desde que o card apareceu"
            />
          </div>
          <div className="grid grid-3" style={{ marginTop: 6 }}>
            <StatCard
              nivel={3}
              label="SLA de decisão"
              value={String(s.slaDays)}
              unidade="dias"
              hint="além disso o card vira crítico"
            />
          </div>
        </>
      )}

      {/* ═══ AS TRÊS SEÇÕES DESTA TELA ═════════════════════════════════════
          Série, equipe e trilha eram três `.card` empilhados com `.section-title`
          dentro — três caixas idênticas, sem nada dizendo que são assuntos
          diferentes (o gráfico do mês, as pessoas, o registro). A abertura de
          seção é a ferramenta do manual para isso, e esta tela tinha ZERO
          `.rule-section`: a régua dourada + o sobretítulo em mono + o título em
          Fraunces separam o assunto ANTES do cartão, que é onde a separação
          custa zero altura de conteúdo. */}
      {s && s.series.length > 0 && (
        <>
          <AberturaDeSecao
            eyebrow="Ritmo"
            titulo={`Aprovações e recusas — últimos ${s.series.length} dias`}
            descricao="Quanto a rede decidiu por dia, e em que proporção."
          />
        <div className="card">
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            <Amostra preenchimento={PREENCHIMENTO.aprovado} /> aprovados ·{' '}
            <Amostra preenchimento={PREENCHIMENTO.recusado} /> recusados
          </p>
          <Series data={s.series} />
        </div>
        </>
      )}

      {s && s.byUser.length > 0 && (
        <>
          <AberturaDeSecao
            eyebrow="Equipe"
            titulo="Desempenho da equipe"
            descricao="Quem está decidindo — e quanto impacto passou pela mão de cada um."
          />
        <div className="card">
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
        </>
      )}

      <AberturaDeSecao
        eyebrow="Registro"
        titulo="Trilha de decisões"
        descricao="Nada é sobrescrito: cada linha guarda quem decidiu, quando, com que justificativa e qual era o impacto naquele momento."
      />
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginRight: 'auto' }}>
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
                  {/* Data/hora e id do card são IDENTIFICADORES, e o de-para os
                      manda para `.codigo`: mono caixa normal, entreletras zero,
                      tabular. Numa trilha de auditoria essas duas colunas são
                      lidas verticalmente, uma linha contra a outra — a largura
                      fixa é o que faz "31/07, 06:12" e "31/07, 16:12" alinharem
                      dígito com dígito, e é o único motivo de a mono estar aqui.
                      A segunda linha de cada célula é frase, e fica em Inter. */}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Codigo>{shortDateTime(r.decidedAt)}</Codigo>
                    {r.daysToDecide != null && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {r.daysToDecide}
                        <Unidade>d</Unidade> para decidir
                      </div>
                    )}
                  </td>
                  <td>
                    <Codigo>{r.cardId}</Codigo>
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
