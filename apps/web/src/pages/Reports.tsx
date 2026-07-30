import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getAbc,
  getBrandCoverage,
  getBrandMix,
  getCategories,
  getRebalancePlan,
  getStores,
  getTurnover,
  formatBRL,
  type AbcDimension,
} from '../api/client';
import { PageHeader, Loading, CoverageBadge, ExportCsv, fmtMonths } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { useScope, type Scope } from '../lib/scope';

type Tab = 'abc' | 'turnover' | 'coverage' | 'transfers' | 'brandmix';

const classColor: Record<string, string> = { A: 'green', B: 'amber', C: 'gray' };

/**
 * A análise por marca cobre só produto de moda. Sem dizer isso, o total menor
 * (nos dados reais, ~43% da receita) parece defeito — e é recorte.
 *
 * Fica FORA da barra de filtros: como bloco de largura cheia dentro do flex,
 * ela reposicionava os filtros a cada troca de dimensão — foi o que o Galbe
 * viu como "os filtros somem".
 */
function BrandScopeNote({ scope }: { scope: Scope }) {
  if (scope === 'lentes') {
    return (
      <div className="banner warn" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
        ⚠︎ O recorte escolhido é <strong>Lentes</strong>, e a análise por marca ainda não cobre
        lente nem tratamento — são do setor de produção (laboratório) e terão módulo próprio. Por
        isso esta visão sai vazia: troque o recorte para <strong>Óculos e relógios</strong>.
      </div>
    );
  }
  return (
    <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.35, marginBottom: 12 }}>
      ℹ︎ A análise por marca considera <strong>óculos, armações e relógios</strong>. Lentes e
      tratamentos ficam de fora — são do setor de produção (laboratório) e terão módulo próprio,
      então o total aqui é menor que o da visão por SKU.
    </div>
  );
}

export function Reports() {
  const { isAdmin } = useAuth();
  const { scope } = useScope();
  const [tab, setTab] = useState<Tab>('abc');
  const [dimension, setDimension] = useState<AbcDimension>('product');
  const [days, setDays] = useState('30');
  const [storeId, setStoreId] = useState('');
  const [category, setCategory] = useState('');

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores, enabled: isAdmin });
  const categories = useQuery({
    queryKey: ['categories', scope],
    queryFn: () => getCategories({ group: scope }),
  });

  // Trocar o recorte no título pode deixar um tipo escolhido fora da lista;
  // nesse caso o filtro se desfaz em vez de virar um fantasma.
  const tipos = categories.data ?? [];
  const tipo = category && tipos.length > 0 && !tipos.includes(category) ? '' : category;

  // Transferências e Marcas × Bandeiras são leituras da rede inteira: loja e
  // tipo não se aplicam. Nas outras três, aplicam-se sempre.
  const filtraLoja = tab !== 'transfers' && tab !== 'brandmix';
  const filtraTipo = filtraLoja;

  // Um único conjunto de filtros para TODAS as visões e para as duas dimensões
  // da curva ABC: trocar SKU por marca não mexe em filtro nenhum.
  const params = { days, storeId: storeId || undefined, group: scope, category: tipo || undefined };

  const abc = useQuery({
    queryKey: ['abc', days, storeId, dimension, scope, tipo],
    queryFn: () => getAbc({ ...params, dimension }),
    enabled: tab === 'abc',
  });
  const turnover = useQuery({
    queryKey: ['turnover', days, storeId, scope, tipo],
    queryFn: () => getTurnover(params),
    enabled: tab === 'turnover',
  });
  const coverage = useQuery({
    queryKey: ['brand-coverage', days, storeId, scope, tipo],
    queryFn: () => getBrandCoverage(params),
    enabled: tab === 'coverage',
  });
  // Relatório de transferências (feedback 09) = plano de remanejamento.
  const transfers = useQuery({
    queryKey: ['planning-rebalance', days],
    queryFn: () => getRebalancePlan({ days }),
    enabled: tab === 'transfers' && isAdmin,
  });
  // Mix de marcas por bandeira (feedback 04 fase 2).
  const brandMix = useQuery({
    queryKey: ['brand-mix', days],
    queryFn: () => getBrandMix({ days }),
    enabled: tab === 'brandmix' && isAdmin,
  });

  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle="Curva ABC (SKU ou marca), giro, cobertura de estoque e transferências sugeridas — todos exportáveis em CSV."
      />

      {/* Linha 1 — o que olhar. */}
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <div className="segmented">
          <button className={tab === 'abc' ? 'active' : ''} onClick={() => setTab('abc')}>
            Curva ABC
          </button>
          <button className={tab === 'turnover' ? 'active' : ''} onClick={() => setTab('turnover')}>
            Giro de estoque
          </button>
          <button className={tab === 'coverage' ? 'active' : ''} onClick={() => setTab('coverage')}>
            Cobertura
          </button>
          {isAdmin && (
            <button className={tab === 'transfers' ? 'active' : ''} onClick={() => setTab('transfers')}>
              Transferências
            </button>
          )}
          {isAdmin && (
            <button className={tab === 'brandmix' ? 'active' : ''} onClick={() => setTab('brandmix')}>
              Marcas × Bandeiras
            </button>
          )}
        </div>
        {tab === 'abc' && (
          <div className="segmented">
            <button className={dimension === 'product' ? 'active' : ''} onClick={() => setDimension('product')}>
              Por SKU
            </button>
            <button className={dimension === 'brand' ? 'active' : ''} onClick={() => setDimension('brand')}>
              Por marca
            </button>
          </div>
        )}
      </div>

      {/* Linha 2 — os filtros, sempre no MESMO lugar: mesma linha, mesma ordem,
          em qualquer aba e em qualquer dimensão. */}
      <div className="toolbar">
        <select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Período">
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="180">Últimos 180 dias</option>
        </select>
        {isAdmin && filtraLoja && (
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Loja">
            <option value="">Toda a rede</option>
            {stores.data?.rows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {filtraTipo && (
          <select value={tipo} onChange={(e) => setCategory(e.target.value)} aria-label="Tipo de produto">
            <option value="">Todos os tipos</option>
            {tipos.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        {(storeId || tipo) && (
          <button
            className="btn sm ghost"
            onClick={() => {
              setStoreId('');
              setCategory('');
            }}
          >
            Limpar filtros
          </button>
        )}
        <span style={{ flex: 1 }} />
        {tab === 'abc' && (
          <ExportCsv
            rows={abc.data?.rows}
            filename={`abc-${dimension === 'brand' ? 'marcas' : 'skus'}-${days}d`}
            columns={[
              { key: 'class', label: 'Classe' },
              { key: 'label', label: dimension === 'brand' ? 'Marca' : 'Produto' },
              { key: 'brand', label: 'Marca' },
              { key: 'category', label: 'Categoria' },
              { key: 'units', label: 'Unidades' },
              { key: 'revenue', label: 'Receita' },
              { key: 'revenuePct', label: '% receita' },
              { key: 'cumulativePct', label: '% acumulado' },
            ]}
          />
        )}
        {tab === 'turnover' && (
          <ExportCsv
            rows={turnover.data?.rows}
            filename={`giro-${days}d`}
            columns={[
              { key: 'description', label: 'Produto' },
              { key: 'brand', label: 'Marca' },
              { key: 'category', label: 'Categoria' },
              { key: 'unitsSold', label: 'Un. vendidas' },
              { key: 'currentStock', label: 'Estoque atual' },
              { key: 'turnover', label: 'Giro' },
              { key: 'daysOfInventory', label: 'Dias de cobertura' },
            ]}
          />
        )}
        {tab === 'coverage' && (
          <ExportCsv
            rows={coverage.data ? [coverage.data.total, ...coverage.data.rows] : undefined}
            filename={`cobertura-marcas-${days}d`}
            columns={[
              { key: 'label', label: 'Marca' },
              { key: 'stockUnits', label: 'Unidades em estoque' },
              { key: 'monthlyUnits', label: 'Venda média/mês' },
              { key: 'coverageMonths', label: 'Cobertura (meses)' },
              { key: 'level', label: 'Nível' },
            ]}
          />
        )}
        {tab === 'brandmix' && brandMix.data && (
          <ExportCsv
            rows={brandMix.data.rows.flatMap((r) =>
              brandMix.data!.banners.map((b) => ({
                marca: r.brand,
                bandeira: b,
                vendidas: r.byBanner[b]?.unitsSold ?? 0,
                estoque: r.byBanner[b]?.stockUnits ?? 0,
                remanejar: r.moveFrom.includes(b) ? 'sim' : '',
              })),
            )}
            filename={`marcas-bandeiras-${days}d`}
            columns={[
              { key: 'marca', label: 'Marca' },
              { key: 'bandeira', label: 'Bandeira' },
              { key: 'vendidas', label: 'Un. vendidas' },
              { key: 'estoque', label: 'Estoque' },
              { key: 'remanejar', label: 'Candidata a remanejo' },
            ]}
          />
        )}
        {tab === 'transfers' && (
          <ExportCsv
            rows={transfers.data?.rows}
            filename={`transferencias-sugeridas-${days}d`}
            columns={[
              { key: 'description', label: 'Produto' },
              { key: 'brand', label: 'Marca' },
              { key: 'fromStoreName', label: 'De' },
              { key: 'toStoreName', label: 'Para' },
              { key: 'quantity', label: 'Qtd' },
              { key: 'reason', label: 'Motivo' },
            ]}
          />
        )}
      </div>

      {((tab === 'abc' && dimension === 'brand') || tab === 'coverage') && <BrandScopeNote scope={scope} />}

      {/* Por SKU o recorte também vale, e o total menor tem que ter explicação
          na tela — não no suporte. */}
      {tab === 'abc' && dimension === 'product' && scope !== 'todos' && abc.data?.periodRevenue != null && (
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.35, marginBottom: 12 }}>
          ℹ︎ O total abaixo é do recorte <strong>{scope === 'lentes' ? 'Lentes' : 'óculos, armações e relógios'}</strong>
          {tipo ? <> · <strong>{tipo}</strong></> : null}. A receita da rede no mesmo período foi{' '}
          {formatBRL(abc.data.periodRevenue)} — a diferença é lente, tratamento e demais categorias.
        </div>
      )}

      {tab === 'abc' ? (
        abc.isLoading ? (
          <Loading />
        ) : abc.data ? (
          <>
            <div className="grid grid-4">
              {(['A', 'B', 'C'] as const).map((k) => (
                <div className="card stat" key={k}>
                  <div className="label">
                    Classe {k} {k === 'A' ? '(alta)' : k === 'C' ? '(cauda)' : '(média)'}
                  </div>
                  <div className="value">{abc.data.summary[k].items}</div>
                  <div className="hint">{formatBRL(abc.data.summary[k].revenue)}</div>
                </div>
              ))}
              <div className="card stat">
                <div className="label">Receita no recorte</div>
                <div className="value" style={{ fontSize: 20 }}>
                  {formatBRL(abc.data.totalRevenue)}
                </div>
                {/* "Os números da curva ABC estão muito baixos" — estavam
                    certos: é o recorte. Sem o denominador ao lado, "recortado"
                    parecia "errado". */}
                {abc.data.periodRevenue != null && abc.data.periodRevenue > 0 && (
                  <div className="hint">
                    {((abc.data.totalRevenue / abc.data.periodRevenue) * 100).toFixed(0)}% dos{' '}
                    {formatBRL(abc.data.periodRevenue)} vendidos no período
                  </div>
                )}
              </div>
            </div>

            <div className="card" style={{ marginTop: 16, padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Classe</th>
                    <th>{dimension === 'brand' ? 'Marca' : 'Produto'}</th>
                    <th className="num">Un. vendidas</th>
                    <th className="num">Receita</th>
                    <th className="num">% receita</th>
                    <th className="num">% acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {abc.data.rows.slice(0, 100).map((r) => (
                    <tr key={r.key}>
                      <td>
                        <span className={`badge ${classColor[r.class]}`}>{r.class}</span>
                      </td>
                      <td>
                        <div>{r.label}</div>
                        {(r.brand || r.category) && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {[r.brand, r.category].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="num">{r.units}</td>
                      <td className="num">{formatBRL(r.revenue)}</td>
                      <td className="num">{r.revenuePct.toFixed(1)}%</td>
                      <td className="num">{r.cumulativePct.toFixed(1)}%</td>
                    </tr>
                  ))}
                  {abc.data.rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty">
                        Sem vendas no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null
      ) : tab === 'turnover' ? (
        turnover.isLoading ? (
          <Loading />
        ) : turnover.data ? (
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Categoria</th>
                  <th className="num">Un. vendidas</th>
                  <th className="num">Estoque atual</th>
                  <th className="num">Giro</th>
                  <th className="num">Dias de cobertura</th>
                </tr>
              </thead>
              <tbody>
                {turnover.data.rows.slice(0, 150).map((r) => (
                  <tr key={r.productId}>
                    <td>{r.description}</td>
                    <td>{r.category ?? '—'}</td>
                    <td className="num">{r.unitsSold}</td>
                    <td className="num">{r.currentStock}</td>
                    <td className="num">
                      <span className={`badge ${r.turnover >= 1 ? 'green' : r.turnover > 0 ? 'amber' : 'gray'}`}>
                        {r.turnover.toFixed(2)}
                      </span>
                    </td>
                    <td className="num">{r.daysOfInventory ?? '—'}</td>
                  </tr>
                ))}
                {turnover.data.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty">
                      Sem dados no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null
      ) : tab === 'coverage' ? (
        coverage.isLoading ? (
          <Loading />
        ) : coverage.data ? (
          <>
            <div className="grid grid-3">
              <div className="card stat">
                <div className="label">Cobertura geral</div>
                <div className="value">{fmtMonths(coverage.data.total.coverageMonths)}</div>
                <div className="hint">
                  {coverage.data.total.stockUnits.toLocaleString('pt-BR')} un. ÷{' '}
                  {coverage.data.total.monthlyUnits.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} un./mês
                  {' · '}mesma base do Dashboard
                </div>
              </div>
              <div className="card stat">
                <div className="label">Marcas com estoque</div>
                <div className="value">{coverage.data.rows.length}</div>
                <div className="hint">"Sem marca" = grade do CDS sem fornecedor (o backfill preenche)</div>
              </div>
              <div className="card stat">
                <div className="label">Marcas paradas</div>
                <div className="value">{coverage.data.rows.filter((r) => r.coverageMonths === null && r.stockUnits > 0).length}</div>
                <div className="hint">Com estoque e nenhuma venda no período</div>
              </div>
            </div>
            {/* "Essa cobertura de estoque não bate com a cobertura média do
                dashboard inicial da home" — batia, não: a linha GERAL lia a
                amostra do catálogo e o dashboard lia a rede. Agora as duas leem
                a rede, e onde a tabela por marca ainda é amostra, ela diz. */}
            {coverage.data.sampled && (
              <div className="banner warn" style={{ marginTop: 16, marginBottom: 0, fontSize: 12.5, lineHeight: 1.4 }}>
                ⚠︎ A <strong>cobertura geral</strong> acima é da rede inteira (
                {coverage.data.sampled.networkStockUnits.toLocaleString('pt-BR')} un.), a mesma base do
                Dashboard. As linhas por marca abaixo saem da amostra de catálogo desta demonstração
                estática ({coverage.data.sampled.stockUnits.toLocaleString('pt-BR')} un.), então elas
                não somam o total. No sistema em produção as duas leem a mesma base.
              </div>
            )}
            <div className="card" style={{ marginTop: 16, padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Marca</th>
                    <th className="num">Unidades</th>
                    <th className="num">Venda média/mês</th>
                    <th className="num">Cobertura</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.data.rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      <td className="num">{r.stockUnits.toLocaleString('pt-BR')}</td>
                      <td className="num">{r.monthlyUnits.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
                      <td className="num">
                        <CoverageBadge months={r.coverageMonths} level={r.level} />
                      </td>
                    </tr>
                  ))}
                  {coverage.data.rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="empty">
                        Sem posições de estoque.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null
      ) : tab === 'brandmix' ? (
        brandMix.isLoading ? (
          <Loading />
        ) : brandMix.data ? (
          <>
            {/* "Esse relatório não tá claro o que diz." Estava mesmo: a
                célula "51 / 457" não dizia o que era cada número, e o título
                não dizia que pergunta o relatório responde. */}
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="section-title" style={{ marginBottom: 4 }}>
                Onde cada marca VENDE e onde ela está PARADA
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45 }}>
                Serve para uma decisão só: <strong>tirar estoque da bandeira onde a marca não sai e
                mandar para a bandeira onde ela sai</strong>. Cada célula tem dois números —{' '}
                <strong style={{ color: 'var(--text)' }}>vendidas</strong> no período e{' '}
                <span className="muted">em estoque</span> hoje. Estoque alto com venda zero numa
                bandeira, enquanto a marca vende em outra, ganha o selo{' '}
                <span className="badge amber">remanejar</span>.
              </p>
              {(() => {
                const sinalizadas = brandMix.data!.rows.filter((r) => r.moveFrom.length > 0);
                if (sinalizadas.length === 0) return null;
                // Quando quase todo o remanejo aponta para a MESMA bandeira, o
                // achado do relatório é essa bandeira — e não 39 selos iguais
                // espalhados pela tabela.
                const porBandeira = new Map<string, number>();
                for (const r of sinalizadas)
                  for (const b of r.moveFrom) porBandeira.set(b, (porBandeira.get(b) ?? 0) + 1);
                const [dominante, quantas] = [...porBandeira.entries()].sort((a, b) => b[1] - a[1])[0];
                const concentrada = quantas / sinalizadas.length >= 0.6;
                const unidades = sinalizadas.reduce(
                  (a, r) => a + (r.moveFrom.includes(dominante) ? r.byBanner[dominante]?.stockUnits ?? 0 : 0),
                  0,
                );
                return (
                  <p style={{ margin: '8px 0 0', fontSize: 12.5 }}>
                    <strong>{sinalizadas.length}</strong>{' '}
                    {sinalizadas.length > 1 ? 'marcas têm' : 'marca tem'} estoque parado em alguma
                    bandeira enquanto {sinalizadas.length > 1 ? 'vendem' : 'vende'} em outra.
                    {concentrada && (
                      <>
                        {' '}
                        <strong>{quantas} delas apontam para a mesma bandeira: {dominante}</strong>, que
                        segura {unidades.toLocaleString('pt-BR')} unidades dessas marcas sem nenhuma
                        venda no período. É o maior bloco de capital parado do relatório — vale
                        confirmar com uma janela maior de vendas antes de mover.
                      </>
                    )}
                  </p>
                );
              })()}
            </div>
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Marca</th>
                    {brandMix.data.banners.map((b) => (
                      <th key={b} className="num">
                        <div>{b}</div>
                        <div className="muted" style={{ fontWeight: 400, fontSize: 10, textTransform: 'none' }}>
                          vendidas · estoque
                        </div>
                      </th>
                    ))}
                    <th className="num">
                      <div>Total</div>
                      <div className="muted" style={{ fontWeight: 400, fontSize: 10, textTransform: 'none' }}>
                        vendidas · estoque
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {brandMix.data.rows.slice(0, 40).map((r) => (
                    <tr key={r.brand}>
                      <td>
                        <div>{r.brand}</div>
                        {r.moveFrom.length > 0 && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            parada em {r.moveFrom.join(', ')}
                          </div>
                        )}
                      </td>
                      {brandMix.data!.banners.map((b) => {
                        const cell = r.byBanner[b];
                        const flagged = r.moveFrom.includes(b);
                        return (
                          <td key={b} className="num">
                            {cell ? (
                              <span
                                className={flagged ? 'badge amber' : undefined}
                                title={
                                  flagged
                                    ? `${cell.unitsSold} vendidas e ${cell.stockUnits} em estoque: parada aqui, mas a marca vende em outra bandeira`
                                    : `${cell.unitsSold} vendidas · ${cell.stockUnits} em estoque`
                                }
                              >
                                <strong>{cell.unitsSold}</strong>
                                <span className="muted"> · {cell.stockUnits.toLocaleString('pt-BR')}</span>
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="num">
                        <strong>{r.total.unitsSold}</strong>
                        <span className="muted"> · {r.total.stockUnits.toLocaleString('pt-BR')}</span>
                      </td>
                    </tr>
                  ))}
                  {brandMix.data.rows.length === 0 && (
                    <tr>
                      <td colSpan={brandMix.data.banners.length + 2} className="empty">
                        Sem dados no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
              Mostrando as 40 primeiras marcas, candidatas a remanejo primeiro; o CSV leva todas.
            </p>
          </>
        ) : null
      ) : transfers.isLoading ? (
        <Loading />
      ) : transfers.data ? (
        <>
          <div className="grid grid-3">
            <div className="card stat">
              <div className="label">Transferências sugeridas</div>
              <div className="value">{transfers.data.summary.suggestions}</div>
            </div>
            <div className="card stat">
              <div className="label">Unidades a mover</div>
              <div className="value">{transfers.data.summary.units}</div>
            </div>
            <div className="card stat">
              <div className="label">Lojas envolvidas</div>
              <div className="value">{transfers.data.summary.storesInvolved}</div>
            </div>
          </div>
          <div className="card" style={{ marginTop: 16, padding: 0 }}>
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
                {transfers.data.rows.slice(0, 200).map((t, i) => (
                  <tr key={`${t.productId}-${t.fromStoreId}-${t.toStoreId}-${i}`}>
                    <td>
                      <div>{t.description}</div>
                      {t.brand && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {t.brand}
                        </div>
                      )}
                    </td>
                    <td>
                      {t.fromStoreName} <span className="muted">→</span> {t.toStoreName}
                    </td>
                    <td className="num">{t.quantity}</td>
                    <td className="muted" style={{ fontSize: 12.5 }}>{t.reason}</td>
                  </tr>
                ))}
                {transfers.data.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty">
                      Nenhuma transferência sugerida — estoque equilibrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
