import { useQuery } from '@tanstack/react-query';
import { getStores } from '../api/client';
import { PageHeader, Loading } from '../components/ui';

export function Stores() {
  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores });

  return (
    <>
      <PageHeader title="Lojas" subtitle="Filiais da rede sincronizadas da fonte." />

      <div className="card" style={{ padding: 0 }}>
        {stores.isLoading ? (
          <Loading />
        ) : stores.data && stores.data.rows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Filial</th>
                <th>Nome</th>
                <th>Cidade</th>
                <th>UF</th>
                <th className="num">SKUs em estoque</th>
                <th className="num">Vendas</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {stores.data.rows.map((s) => (
                <tr key={s.id}>
                  <td>{s.externalId}</td>
                  <td>{s.name}</td>
                  <td>{s.city ?? '—'}</td>
                  <td>{s.state ?? '—'}</td>
                  <td className="num">{s._count?.stockItems ?? 0}</td>
                  <td className="num">{s._count?.sales ?? 0}</td>
                  <td>
                    <span className={`badge ${s.active ? 'green' : 'gray'}`}>
                      {s.active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">Nenhuma loja sincronizada.</div>
        )}
      </div>
    </>
  );
}
