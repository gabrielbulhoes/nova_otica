import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSales, getStores, formatBRL } from '../api/client';
import { PageHeader, Loading } from '../components/ui';

export function Sales() {
  const [storeId, setStoreId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

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

  return (
    <>
      <PageHeader title="Vendas" subtitle="Vendas sincronizadas da fonte, com itens e pagamentos." />

      <div className="toolbar">
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">Todas as lojas</option>
          {stores.data?.rows.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="muted">De</label>
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <label className="muted">Até</label>
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>

      <div className="card" style={{ padding: 0 }}>
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
                  <td>{new Date(s.saleDate).toLocaleDateString('pt-BR')}</td>
                  <td>{s.externalId}</td>
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
          <div className="empty">Nenhuma venda encontrada.</div>
        )}
      </div>
      {sales.data && (
        <p className="muted" style={{ marginTop: 10 }}>
          {sales.data.rows.length} de {sales.data.total} vendas.
        </p>
      )}
    </>
  );
}
