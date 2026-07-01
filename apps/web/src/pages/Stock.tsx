import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStock, getStores, getCategories, formatBRL } from '../api/client';
import { PageHeader, Loading } from '../components/ui';

export function Stock() {
  const [search, setSearch] = useState('');
  const [storeId, setStoreId] = useState('');
  const [category, setCategory] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores });
  const categories = useQuery({ queryKey: ['categories'], queryFn: getCategories });
  const stock = useQuery({
    queryKey: ['stock', search, storeId, category, onlyAvailable],
    queryFn: () =>
      getStock({
        search: search || undefined,
        storeId: storeId || undefined,
        category: category || undefined,
        onlyAvailable: onlyAvailable || undefined,
        limit: '200',
      }),
  });

  return (
    <>
      <PageHeader
        title="Estoque consolidado"
        subtitle="Saldo ao vivo por loja = base sincronizada + movimentações internas, menos reservas."
      />

      <div className="toolbar">
        <input
          placeholder="Buscar produto, SKU ou marca…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">Todas as lojas</option>
          {stores.data?.rows.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas as categorias</option>
          {categories.data?.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
          />
          Só com saldo
        </label>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {stock.isLoading ? (
          <Loading />
        ) : stock.data && stock.data.rows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Marca</th>
                <th>Loja</th>
                <th className="num">Sincronizado</th>
                <th className="num">Reservado</th>
                <th className="num">Ajuste</th>
                <th className="num">Disponível</th>
                <th className="num">Preço</th>
              </tr>
            </thead>
            <tbody>
              {stock.data.rows.map((r) => (
                <tr key={`${r.storeId}-${r.productId}`}>
                  <td>
                    <div>{r.description}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      #{r.productExternalId}
                      {r.category ? ` · ${r.category}` : ''}
                    </div>
                  </td>
                  <td>{r.brand ?? '—'}</td>
                  <td>{r.storeName}</td>
                  <td className="num">{r.synced}</td>
                  <td className="num">{r.reserved || '—'}</td>
                  <td className="num">{r.pendingDelta ? (r.pendingDelta > 0 ? `+${r.pendingDelta}` : r.pendingDelta) : '—'}</td>
                  <td className="num">
                    <span className={`badge ${r.availableNow > 0 ? 'green' : 'red'}`}>{r.availableNow}</span>
                  </td>
                  <td className="num">{formatBRL(r.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">Nenhum item encontrado.</div>
        )}
      </div>
      {stock.data && (
        <p className="muted" style={{ marginTop: 10 }}>
          {stock.data.rows.length} de {stock.data.total} registros.
        </p>
      )}
    </>
  );
}
