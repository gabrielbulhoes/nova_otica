import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProducts, getCategories, formatBRL } from '../api/client';
import { PageHeader, Loading } from '../components/ui';

export function Products() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const categories = useQuery({ queryKey: ['categories'], queryFn: getCategories });
  const products = useQuery({
    queryKey: ['products', search, category],
    queryFn: () =>
      getProducts({ search: search || undefined, category: category || undefined, limit: 200 }),
  });

  return (
    <>
      <PageHeader title="Produtos" subtitle="Catálogo sincronizado da fonte (Sellbie)." />

      <div className="toolbar">
        <input
          placeholder="Buscar por descrição, SKU ou marca…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas as categorias</option>
          {categories.data?.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {products.isLoading ? (
          <Loading />
        ) : products.data && products.data.rows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Marca</th>
                <th>Categoria</th>
                <th>Cor</th>
                <th>Tam.</th>
                <th className="num">Preço</th>
              </tr>
            </thead>
            <tbody>
              {products.data.rows.map((p) => (
                <tr key={p.id}>
                  <td>{p.externalId}</td>
                  <td>{p.description}</td>
                  <td>{p.brand ?? '—'}</td>
                  <td>{p.category ?? '—'}</td>
                  <td>{p.color?.name ?? '—'}</td>
                  <td>{p.size?.name ?? '—'}</td>
                  <td className="num">{formatBRL(p.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">Nenhum produto encontrado.</div>
        )}
      </div>
      {products.data && (
        <p className="muted" style={{ marginTop: 10 }}>
          {products.data.rows.length} de {products.data.total} produtos.
        </p>
      )}
    </>
  );
}
