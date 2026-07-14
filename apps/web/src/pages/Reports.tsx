import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getAbc,
  getBrandCoverage,
  getRebalancePlan,
  getStores,
  getTurnover,
  formatBRL,
  type AbcDimension,
} from '../api/client';
import { PageHeader, Loading, CoverageBadge, ExportCsv, fmtMonths } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

type Tab = 'abc' | 'turnover' | 'coverage' | 'transfers';

const classColor: Record<string, string> = { A: 'green', B: 'amber', C: 'gray' };

export function Reports() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>('abc');
  const [dimension, setDimension] = useState<AbcDimension>('product');
  const [days, setDays] = useState('30');
  const [storeId, setStoreId] = useState('');

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores, enabled: isAdmin });
  const params = { days, storeId: storeId || undefined };

  const abc = useQuery({
    queryKey: ['abc', days, storeId, dimension],
    queryFn: () => getAbc({ ...params, dimension }),
    enabled: tab === 'abc',
  });
  const turnover = useQuery({
    queryKey: ['turnover', days, storeId],
    queryFn: () => getTurnover(params),
    enabled: tab === 'turnover',
  });
  const coverage = useQuery({
    queryKey: ['brand-coverage', days, storeId],
    queryFn: () => getBrandCoverage(params),
    enabled: tab === 'coverage',
  });
  // Relatório de transferências (feedback 09) = plano de remanejamento.
  const transfers = useQuery({
    queryKey: ['planning-rebalance', days],
    queryFn: () => getRebalancePlan({ days }),
    enabled: tab === 'transfers' && isAdmin,
  });

  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle="Curva ABC (SKU ou marca), giro, cobertura de estoque e transferências sugeridas — todos exportáveis em CSV."
      />

      <div className="toolbar">
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
        <select value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="180">Últimos 180 dias</option>
        </select>
        {isAdmin && tab !== 'transfers' && (
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">Toda a rede</option>
            {stores.data?.rows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
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
                <div className="label">Receita total</div>
                <div className="value" style={{ fontSize: 20 }}>
                  {formatBRL(abc.data.totalRevenue)}
                </div>
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
