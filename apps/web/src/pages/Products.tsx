import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProducts, getCategories, formatBRL } from '../api/client';
import { PageHeader, Loading } from '../components/ui';
import { Icon } from '../brand/Icon';
import { useScope } from '../lib/scope';

export function Products() {
  const { scope } = useScope();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const categories = useQuery({ queryKey: ['categories', scope], queryFn: () => getCategories({ group: scope }) });
  const products = useQuery({
    queryKey: ['products', search, category, scope],
    queryFn: () =>
      getProducts({ search: search || undefined, category: category || undefined, group: scope, limit: 200 }),
  });

  return (
    <>
      {/* Nenhum botão sólido: o catálogo é espelho da fonte (Sellbie). Não se
          cria nem se edita produto aqui — a tela não tem ação principal, e
          inventar uma seria mentir sobre o que ela faz. */}
      <PageHeader
        eyebrow="Consulta"
        title="Produtos"
        subtitle="Catálogo sincronizado da fonte (Sellbie)."
      />

      <div className="toolbar">
        <input
          aria-label="Buscar por descrição, SKU ou marca"
          placeholder="Buscar por descrição, SKU ou marca…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <select aria-label="Filtrar por categoria" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas as categorias</option>
          {categories.data?.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
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
                  {/* Código fica à ESQUERDA de propósito: `.num` é para
                      grandeza (quantidade, dinheiro), que se compara pelo
                      alinhamento das casas. Identificador não se soma nem se
                      compara — alinhá-lo à direita sugeriria uma ordem de
                      magnitude que ele não tem. */}
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
          <div
            className="empty"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
          >
            <Icon name="buscar" size={18} />
            <span>Nenhum produto encontrado. Ajuste a busca ou a categoria.</span>
          </div>
        )}
      </div>
      {products.data && (
        <p className="label" style={{ marginTop: 10 }}>
          {products.data.rows.length.toLocaleString('pt-BR')} de{' '}
          {products.data.total.toLocaleString('pt-BR')} produtos
        </p>
      )}
    </>
  );
}
