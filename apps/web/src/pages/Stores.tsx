import { useQuery } from '@tanstack/react-query';
import { getStores } from '../api/client';
import { PageHeader, Loading } from '../components/ui';

export function Stores() {
  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores });

  return (
    <>
      <PageHeader title="Lojas" subtitle="Filiais da rede sincronizadas da fonte." />

      {/* A demo estática carrega uma AMOSTRA do catálogo. Sem este aviso, o
          "SKUs em estoque" parece um número da rede inteira — e é menor. */}
      {stores.data?.sampled && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 12, fontSize: 12.5 }}>
          <span className="muted">
            Nesta demonstração o catálogo vem amostrado
            {stores.data.catalogSampled && stores.data.productCountNetwork
              ? `: ${stores.data.catalogSampled.toLocaleString('pt-BR')} de ${stores.data.productCountNetwork.toLocaleString('pt-BR')} SKUs da rede`
              : ''}
            . A coluna <strong>SKUs em estoque</strong> conta sobre essa amostra, então fica menor
            que o número real da filial. Unidades, receita e cobertura são da rede inteira.
          </span>
        </div>
      )}

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
                  <td className="num">{(s._count?.stockItems ?? 0).toLocaleString('pt-BR')}</td>
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
