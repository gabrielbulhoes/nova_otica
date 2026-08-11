import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSales, getSalesAnalysis, getStores, formatBRL, type AnalysisDimension } from '../api/client';
import { PageHeader, Loading, ExportCsv, Codigo, AberturaDeSecao } from '../components/ui';
import { Icon } from '../brand/Icon';
import { opcoesDePeriodo, periodoInicial } from '../lib/periodo';
import { LegendaDaAmostra } from '../components/LegendaDaAmostra';

/** Recortes desta tela. O filtro só oferece os que a base responde. */
const PERIODOS = [
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
  { dias: 180, label: '180 dias' },
];

/** Rótulos das dimensões da análise (feedback 10: foco em produto/unidades). */
const DIMENSIONS: { value: AnalysisDimension; label: string }[] = [
  { value: 'brand', label: 'Marca' },
  { value: 'category', label: 'Grupo' },
  { value: 'product', label: 'SKU' },
  { value: 'store', label: 'Loja' },
  { value: 'seller', label: 'Vendedor' },
];

type Metric = 'units' | 'revenue';

export function Sales() {
  const [storeId, setStoreId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [by, setBy] = useState<AnalysisDimension>('brand');
  const [metric, setMetric] = useState<Metric>('units');
  const [days, setDays] = useState(() => periodoInicial(PERIODOS, 30));

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores });
  const sales = useQuery({
    queryKey: ['sales', storeId, start, end],
    queryFn: () =>
      getSales({
        storeId: storeId || undefined,
        date_start: start || undefined,
        date_end: end || undefined,
        limit: 100,
      }),
  });
  const analysis = useQuery({
    queryKey: ['sales-analysis', by, days, storeId],
    queryFn: () => getSalesAnalysis({ by, days, storeId: storeId || undefined }),
  });

  const rows = [...(analysis.data?.rows ?? [])].sort((a, b) => b[metric] - a[metric]);
  const top = rows.slice(0, 20);
  const max = Math.max(1, ...top.map((r) => r[metric]));
  const fmt = (v: number) =>
    metric === 'units' ? `${v.toLocaleString('pt-BR')} un.` : formatBRL(v);
  // Forma curta porque vai DENTRO de um <th>, e cabeçalho de coluna é etiqueta:
  // mono caixa alta a 0.08em (a entreletras caiu de 0.18em na Onda 5, justamente
  // porque os cabeçalhos deste console têm 15 a 24 caracteres). "Participação ·
  // unidades" por extenso já seria frase dentro de um carimbo.
  const metricaLabel = metric === 'units' ? 'un.' : 'R$';

  return (
    <>
      {/* Sem botão sólido: a tela é de leitura. A ação que existe aqui é
          exportar o recorte, e exportar não é o motivo de a tela existir —
          fica em .btn.ghost, a altura terciária. */}
      <PageHeader
        eyebrow="Consulta"
        title="Vendas"
        subtitle="Análise por unidades (ou receita) em qualquer dimensão, e a lista de vendas sincronizadas da fonte."
      />

      <div className="toolbar">
        <select aria-label="Filtrar por loja" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">Todas as lojas</option>
          {stores.data?.rows.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {/* "De" e "Até" são RÓTULO DE CAMPO — nomeiam um controle que o operador
            vai preencher. Pelo de-para da Onda 6 isso é Inter 12/600 em caixa
            normal (a regra `.label`), não mono caixa alta: rótulo de campo se lê
            de relance junto do campo, e caixa alta espaçada rouba justamente o
            contorno da palavra que torna o relance possível. São <label for>,
            ou seja, clicáveis e anunciados — antes eram um <label> solto. */}
        <label className="label" htmlFor="venda-de">
          De
        </label>
        <input id="venda-de" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <label className="label" htmlFor="venda-ate">
          Até
        </label>
        <input id="venda-ate" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>

      {/* Análise por dimensão — venda por PRODUTO antes de valor monetário.

          ONDA 6 · esta tela empilhava DOIS blocos de natureza diferente — a
          análise agregada e o registro de vendas linha a linha — em dois cards
          de assinatura idêntica, sem uma régua nem um título entre eles. Medido
          nesta build: zero `.rule-section` e zero `.rule` nas seis telas de
          operação. Quem chega pelo alto não tem como saber onde um assunto
          termina e o outro começa; é literalmente a queixa do cliente ("ficou
          mais confusa as informações"). Cada bloco passa a abrir com
          <AberturaDeSecao>, que emite régua dourada + sobretítulo em mono +
          título em Fraunces como uma coisa só. O <h3> que morava DENTRO do card,
          espremido na mesma linha dos controles segmentados, sai de lá: título
          de seção não disputa a linha com um filtro. */}
      <AberturaDeSecao
        eyebrow="Análise"
        titulo="Venda por dimensão"
        descricao="O mesmo período recortado por marca, grupo, SKU, loja ou vendedor — em unidades ou em receita."
      />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <div className="segmented" role="group" aria-label="Dimensão da análise">
            {DIMENSIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                className={by === d.value ? 'active' : ''}
                aria-pressed={by === d.value}
                onClick={() => setBy(d.value)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Métrica">
            <button
              type="button"
              className={metric === 'units' ? 'active' : ''}
              aria-pressed={metric === 'units'}
              onClick={() => setMetric('units')}
            >
              Unidades
            </button>
            <button
              type="button"
              className={metric === 'revenue' ? 'active' : ''}
              aria-pressed={metric === 'revenue'}
              onClick={() => setMetric('revenue')}
            >
              R$
            </button>
          </div>
          <select aria-label="Período da análise" value={days} onChange={(e) => setDays(e.target.value)}>
            {opcoesDePeriodo(PERIODOS).map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <span style={{ flex: 1 }} />
          <ExportCsv
            rows={rows.length > 0 ? rows : undefined}
            filename={`vendas-por-${by}-${days}d`}
            columns={[
              { key: 'label', label: DIMENSIONS.find((d) => d.value === by)?.label ?? by },
              { key: 'units', label: 'Unidades' },
              { key: 'revenue', label: 'Receita' },
            ]}
          />
        </div>
        <LegendaDaAmostra days={days} />
        {analysis.isLoading ? (
          <Loading />
        ) : top.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>{DIMENSIONS.find((d) => d.value === by)?.label}</th>
                <th className="num">Unidades</th>
                <th className="num">Receita</th>
                {/* O cabeçalho diz qual métrica a barra desenha. Antes isso só
                    existia no title do mouse — e informação que só aparece no
                    hover não existe para quem usa teclado ou toque. */}
                <th style={{ width: '30%' }}>Participação · {metricaLabel}</th>
              </tr>
            </thead>
            <tbody>
              {top.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  {/* A métrica escolhida fica em tinta cheia e a outra recua para
                      --muted. O destaque era font-weight 600, mas a JetBrains
                      Mono deste projeto só vai até 500: o navegador sintetizava o
                      negrito e a diferença não era confiável. Luminância é canal
                      seguro e sobrevive ao cinza. */}
                  <td className="num" style={metric === 'units' ? undefined : { color: 'var(--muted)' }}>
                    {r.units.toLocaleString('pt-BR')}
                  </td>
                  <td className="num" style={metric === 'revenue' ? undefined : { color: 'var(--muted)' }}>
                    {formatBRL(r.revenue)}
                  </td>
                  <td>
                    {/* Reto, sem raio: o único canto curvo do sistema é o corte
                        assimétrico do símbolo, e ele pertence ao botão. A barra
                        é redundância visual dos dois números ao lado — por isso
                        pode ser só cor, sem rótulo próprio. */}
                    <div
                      title={fmt(r[metric])}
                      style={{
                        height: 8,
                        borderRadius: 0,
                        background: 'var(--accent)',
                        width: `${(r[metric] / max) * 100}%`,
                        minWidth: 4,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            {/*
              A SOMA TOTAL DO FATURAMENTO — feedback 6.0 · item 01.
              "Criar espaço para soma total do faturamento."

              Ela vai no `tfoot` da ANÁLISE, e não no rodapé da lista de vendas
              logo abaixo, por uma razão de honestidade: aquela lista traz as
              100 vendas mais recentes do recorte, e somar o que está na tela
              devolveria um número menor que o real sem nada dizendo. A análise
              por dimensão vem agregada do servidor sobre o PERÍODO INTEIRO —
              somar as linhas dela é somar tudo.

              Some `rows`, não `top`: a tabela desenha as 20 primeiras, e o
              total precisa contar as que ficaram fora da tela.
            */}
            <tfoot>
              <tr>
                <th>Total do período</th>
                <th className="num">{rows.reduce((a, r) => a + r.units, 0).toLocaleString('pt-BR')}</th>
                <th className="num">{formatBRL(rows.reduce((a, r) => a + r.revenue, 0))}</th>
                <th className="muted" style={{ fontWeight: 400, fontSize: 12.5 }}>
                  {rows.length.toLocaleString('pt-BR')} linha(s) · {days} dias
                </th>
              </tr>
            </tfoot>
          </table>
        ) : (
          <div
            className="empty"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
          >
            <Icon name="calendario" size={18} />
            <span>Sem vendas no período.</span>
          </div>
        )}
        {rows.length > top.length && (
          // Frase, não carimbo: fica em Inter (.muted). Mono caixa alta com
          // 0.18em a esta altura destruiria o contorno das palavras.
          <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 12.5 }}>
            Mostrando o top {top.length} de {rows.length} — o CSV leva tudo.
          </p>
        )}
      </div>

      <AberturaDeSecao
        eyebrow="Registro"
        titulo="Vendas sincronizadas"
        descricao="As vendas mais recentes do recorte, como vieram da fonte."
      />
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        {sales.isLoading ? (
          <Loading />
        ) : sales.data && sales.data.rows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Nº</th>
                <th>Loja</th>
                <th>Vendedor</th>
                <th>Cliente</th>
                <th className="num">Itens</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {sales.data.rows.map((s) => (
                <tr key={s.id}>
                  {/* Data e número da venda são IDENTIFICADORES: o gestor os
                      confere contra o cupom e contra o extrato, caractere a
                      caractere. Mono caixa normal, entreletras zero, tabular —
                      é a `.codigo`. Ver o comentário longo em Products.tsx. */}
                  <td>
                    <Codigo>{new Date(s.saleDate).toLocaleDateString('pt-BR')}</Codigo>
                  </td>
                  <td>
                    <Codigo>{s.externalId}</Codigo>
                  </td>
                  <td>{s.store?.name ?? '—'}</td>
                  <td>{s.seller?.name ?? '—'}</td>
                  <td>{s.customer?.name ?? '—'}</td>
                  <td className="num">{s._count?.items ?? '—'}</td>
                  <td className="num">{formatBRL(s.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div
            className="empty"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
          >
            <Icon name="vendas" size={18} />
            <span>Nenhuma venda encontrada no recorte.</span>
          </div>
        )}
      </div>
      {sales.data && (
        // Frase de rodapé: `.hint`, não `.label`. Ver Products.tsx.
        <p className="hint" style={{ marginTop: 10 }}>
          {sales.data.rows.length.toLocaleString('pt-BR')} de {sales.data.total.toLocaleString('pt-BR')} vendas
        </p>
      )}
    </>
  );
}
