import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getBiKpis,
  getBiTimeseries,
  getBiDimension,
  getBiSalesFlow,
  getBiHeatmap,
  getStores,
  formatBRL,
} from '../api/client';
import { PageHeader, StatCard, Loading } from '../components/ui';
import { EChart } from '../components/EChart';
import {
  barOption,
  gaugeOption,
  heatmapOption,
  pieOption,
  sankeyOption,
  timeSeriesOption,
} from '../bi/transforms';
import { useAuth } from '../auth/AuthContext';

export function BI() {
  const { isAdmin } = useAuth();
  const [days, setDays] = useState('90');
  const [storeId, setStoreId] = useState('');
  const p = { days, storeId: storeId || undefined };

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores, enabled: isAdmin });
  const kpis = useQuery({ queryKey: ['bi-kpis', days, storeId], queryFn: () => getBiKpis(p) });
  const timeseries = useQuery({ queryKey: ['bi-ts', days, storeId], queryFn: () => getBiTimeseries(p) });
  const byStore = useQuery({ queryKey: ['bi-store', days, storeId], queryFn: () => getBiDimension('store', p) });
  const byPayment = useQuery({ queryKey: ['bi-pay', days, storeId], queryFn: () => getBiDimension('payment', p) });
  const byCategory = useQuery({ queryKey: ['bi-cat', days, storeId], queryFn: () => getBiDimension('category', p) });
  const flow = useQuery({ queryKey: ['bi-flow', days, storeId], queryFn: () => getBiSalesFlow(p) });
  const heatmap = useQuery({ queryKey: ['bi-heat', days, storeId], queryFn: () => getBiHeatmap(p) });

  return (
    <>
      <PageHeader
        title="BI — Business Intelligence"
        subtitle="Visão analítica da rede. Vendas do ERP refletem a última sincronização (06h); estoque e movimentações são ao vivo."
      />

      <div className="toolbar">
        <select value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="180">Últimos 180 dias</option>
        </select>
        {isAdmin && (
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">Toda a rede</option>
            {stores.data?.rows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {kpis.isLoading || !kpis.data ? (
        <Loading />
      ) : (
        <>
          {/* KPIs numéricos */}
          <div className="grid grid-4">
            <StatCard label="Faturamento" value={formatBRL(kpis.data.revenue)} hint={`${kpis.data.salesCount} vendas`} />
            <StatCard label="Ticket médio" value={formatBRL(kpis.data.avgTicket)} />
            <StatCard label="Unidades em estoque" value={kpis.data.stockUnits.toLocaleString('pt-BR')} hint={`${kpis.data.unitsSold} vendidas no período`} />
            <StatCard label="Transferências pendentes" value={kpis.data.pendingTransfers} />
          </div>

          {/* Gauges */}
          <div className="grid grid-3" style={{ marginTop: 16 }}>
            <div className="card">
              <h3 className="section-title">Taxa de ruptura</h3>
              <EChart option={gaugeOption(kpis.data.rupturaRate, 100, '% em ruptura', '#f06363', '%')} height={200} />
            </div>
            <div className="card">
              <h3 className="section-title">Estoque baixo</h3>
              <EChart option={gaugeOption(kpis.data.lowStockRate, 100, '% abaixo do mínimo', '#f5b73d', '%')} height={200} />
            </div>
            <div className="card">
              <h3 className="section-title">Giro (proxy da rede)</h3>
              <EChart option={gaugeOption(kpis.data.turnover, 2, 'un. vendidas / estoque', '#36c98f')} height={200} />
            </div>
          </div>

          {/* Timeline */}
          <div className="card" style={{ marginTop: 16 }}>
            <h3 className="section-title">Faturamento diário</h3>
            {timeseries.data && <EChart option={timeSeriesOption(timeseries.data.points)} height={280} />}
          </div>

          {/* Colunas + Pizza */}
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <h3 className="section-title">Vendas por loja</h3>
              {byStore.data && <EChart option={barOption(byStore.data.rows)} height={300} />}
            </div>
            <div className="card">
              <h3 className="section-title">Formas de pagamento</h3>
              {byPayment.data && <EChart option={pieOption(byPayment.data.rows)} height={300} />}
            </div>
          </div>

          {/* Sankey */}
          <div className="card" style={{ marginTop: 16 }}>
            <h3 className="section-title">Fluxo de vendas — Categoria → Loja</h3>
            {flow.data && flow.data.links.length > 0 ? (
              <EChart option={sankeyOption(flow.data)} height={360} />
            ) : (
              <div className="empty">Sem dados de fluxo no período.</div>
            )}
          </div>

          {/* Colunas categoria + Heatmap */}
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <h3 className="section-title">Vendas por categoria</h3>
              {byCategory.data && <EChart option={barOption(byCategory.data.rows, '#a78bfa')} height={320} />}
            </div>
            <div className="card">
              <h3 className="section-title">Receita por loja × dia da semana</h3>
              {heatmap.data && heatmap.data.yLabels.length > 0 ? (
                <EChart option={heatmapOption(heatmap.data)} height={320} />
              ) : (
                <div className="empty">Sem dados no período.</div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
