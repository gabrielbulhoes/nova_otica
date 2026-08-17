import { useQuery } from '@tanstack/react-query';
import { getStores } from '../api/client';
import { PageHeader, Loading, Selo, Codigo } from '../components/ui';
import { Icon } from '../brand/Icon';

export function Stores() {
  const stores = useQuery({ queryKey: ['stores', 'todas'], queryFn: () => getStores('todas') });

  const linhas = stores.data?.rows ?? [];
  const ativas = linhas.filter((s) => s.active).length;

  return (
    <>
      {/* Sem botão sólido: a lista de filiais vem da fonte sincronizada. Não se
          abre nem se fecha loja por aqui, então a tela não tem ação principal. */}
      <PageHeader
        eyebrow="Consulta"
        title="Lojas"
        subtitle="Filiais da rede sincronizadas da fonte."
      />

      {/* A demo estática carrega uma AMOSTRA do catálogo. Sem este aviso, o
          "SKUs em estoque" parece um número da rede inteira — e é menor.
          Virou .banner (e não card genérico) porque é aviso de metodologia: o
          filete esquerdo e o ícone de informação o marcam como nota de escopo,
          não como mais um painel de dados. Neutro de propósito — não é risco
          operacional, é ressalva de leitura. */}
      {stores.data?.sampled && (
        <div className="banner" style={{ alignItems: 'flex-start' }}>
          <Icon name="informacao" size={18} style={{ marginTop: 2, color: 'var(--muted)' }} />
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

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        {stores.isLoading ? (
          <Loading />
        ) : linhas.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Filial</th>
                <th>Nome</th>
                <th>Cidade</th>
                <th>UF</th>
                <th className="num">SKUs em estoque</th>
                <th className="num">Vendas</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((s) => (
                <tr key={s.id}>
                  {/* O código da filial é o que o gestor dita no telefone e
                      confere contra o sistema da loja: identificador, mono
                      caixa normal. Ver o comentário longo em Products.tsx. */}
                  <td>
                    <Codigo>{s.externalId}</Codigo>
                  </td>
                  <td>
                    {s.name}{' '}
                    {/* O ESCOPO, DITO NA LINHA — nova rodada · item 06.
                        Estas quatro filiais já ficavam fora de toda a conta
                        (planejamento, BI, relatórios, painel) e agora saíram
                        também dos seletores das outras telas. Aqui elas
                        continuam, porque esta É a tela do cadastro: esconder
                        a filial esconderia a linha que precisa ser conferida.
                        O que faltava era o rótulo — sem ele, a mesma lista
                        servia de prova de que "elas continuam gerando
                        informação". */}
                    {s.externalErp ? (
                      <Selo
                        tom="gray"
                        icone="atencao"
                        title="Opera em outro ERP. O CDS devolve dados desta filial, mas desatualizados — ficam fora de todo número da plataforma."
                      >
                        outro ERP
                      </Selo>
                    ) : s.excludeFromPlanning ? (
                      <Selo
                        tom="gray"
                        icone="informacao"
                        title="Retaguarda: tem estoque de verdade, mas não vende ao cliente. Fora do planejamento, da compra e da ruptura."
                      >
                        retaguarda
                      </Selo>
                    ) : null}
                  </td>
                  <td>{s.city ?? '—'}</td>
                  <td>{s.state ?? '—'}</td>
                  <td className="num">{(s._count?.stockItems ?? 0).toLocaleString('pt-BR')}</td>
                  <td className="num">{(s._count?.sales ?? 0).toLocaleString('pt-BR')}</td>
                  <td>
                    {/* Ativa × Inativa vinham como .badge green × .badge gray: em
                        escala de cinza, dois chips de contorno claro com palavras
                        parecidas. O <Selo> acrescenta ícone — o único canal que
                        atravessa daltonismo, impressão em P&B e monitor de loja
                        mal calibrado sem perder nada. */}
                    {s.active ? (
                      <Selo tom="green" icone="aprovar" title="Filial em operação, sincronizando com a fonte.">
                        Ativa
                      </Selo>
                    ) : (
                      <Selo tom="gray" icone="limpar" title="Filial fora de operação. Não recebe nem envia estoque.">
                        Inativa
                      </Selo>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div
            className="empty"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
          >
            <Icon name="sincronizacao" size={18} />
            <span>Nenhuma loja sincronizada.</span>
          </div>
        )}
      </div>
      {linhas.length > 0 && (
        // Frase de rodapé, não rótulo de indicador: `.hint` (Inter 12/400) e
        // não `.label` (Inter 12/600). Ver Products.tsx.
        <p className="hint" style={{ marginTop: 10 }}>
          {linhas.length} filiais · {ativas} ativas
        </p>
      )}
    </>
  );
}
