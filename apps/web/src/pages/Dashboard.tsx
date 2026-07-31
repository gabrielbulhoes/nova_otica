import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getSummary,
  getStoreCoverage,
  getRebalancePlan,
  getSyncStatus,
  getAlerts,
  getPurchaseOrders,
  formatBRL,
} from '../api/client';
import {
  StatCard,
  PageHeader,
  AberturaDeSecao,
  Codigo,
  Loading,
  CoverageBadge,
} from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { useScope } from '../lib/scope';

/**
 * O job de sincronização devolve o enum cru (`SUCCESS`, `PARTIAL`…) e ele estava
 * chegando em inglês no indicador — na primeira tela depois do login, que é a
 * que o cliente abre para a equipe dele. O console inteiro fala português.
 */
const situacaoDaSincronizacao: Record<string, string> = {
  SUCCESS: 'Sucesso',
  RUNNING: 'Em andamento',
  PARTIAL: 'Parcial',
  FAILED: 'Falhou',
};

export function Dashboard() {
  const { isAdmin } = useAuth();
  const { scope } = useScope();
  const summary = useQuery({ queryKey: ['summary', scope], queryFn: () => getSummary({ group: scope }) });
  const coverage = useQuery({
    queryKey: ['coverage', scope],
    queryFn: () => getStoreCoverage({ group: scope }),
  });
  // Mesma queryKey do Planejamento (days=90): compartilha cache e invalidação
  // SSE; staleTime maior porque o plano completo é caro no backend.
  const rebalance = useQuery({
    queryKey: ['planning-rebalance', '90'],
    queryFn: () => getRebalancePlan({ days: '90' }),
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });
  const sync = useQuery({ queryKey: ['sync-status'], queryFn: getSyncStatus, enabled: isAdmin });
  const alerts = useQuery({ queryKey: ['alerts', scope], queryFn: () => getAlerts({ group: scope }) });
  const orders = useQuery({ queryKey: ['planning-orders', '90', ''], queryFn: () => getPurchaseOrders({ days: '90' }) });

  // Cobertura da rede = todo o estoque ÷ toda a venda mensal (média ponderada).
  //
  // Soma as UNIDADES VENDIDAS e converte uma vez só. Somar os `monthlyUnits`
  // já arredondados de cada loja dava 20,6 aqui e 20,7 em Relatórios — e a
  // diferença de uma casa é exatamente o tipo de coisa que faz o cliente
  // perguntar, com razão, por que as duas telas não batem.
  const cov = coverage.data?.rows ?? [];
  const janela = coverage.data?.windowDays ?? coverage.data?.days ?? 30;
  const totalSold = cov.reduce((a, r) => a + r.unitsSold, 0);
  const totalStock = cov.reduce((a, r) => a + r.stockUnits, 0);
  const totalMonthly = janela > 0 ? (totalSold * 30) / janela : 0;
  const networkCoverage = totalMonthly > 0 ? totalStock / totalMonthly : null;
  const maxMonths = Math.max(1, ...cov.map((r) => r.coverageMonths ?? 0));

  const transfers = rebalance.data?.rows.slice(0, 6) ?? [];

  return (
    <>
      {/* ONDA 5 · ESTA TELA É A IMPLEMENTAÇÃO DE REFERÊNCIA DO DE-PARA.
          O cliente disse, sobre o console: "ficou mais confusa as informações.
          Essa fonte pra infos não é legal também e acho que temos que demarcar
          melhor as informações principais."

          Duas respostas, e as duas moram no sistema (styles.css + ui.tsx), não
          aqui — esta tela só as CONVOCA, e é assim que as outras 19 devem fazer:

          1. dosagem da mono: rótulo descritivo saiu de mono caixa alta e voltou
             para Inter (`.label`); a mono ficou com etiqueta curta (`.eyebrow`,
             `.carimbo`), carimbo de unidade (`.unidade`), identificador
             (`.codigo`) e cabeçalho de coluna;
          2. hierarquia: os nove cartões tinham UMA assinatura visual. Agora têm
             três níveis — `nivel={1}` no indicador que a tela existe para
             mostrar, o padrão no apoio, `nivel={3}` no contexto — e cada seção
             abre com a régua dourada do manual (<AberturaDeSecao>), que até
             aqui não estava sendo usada nesta tela. */}
      <PageHeader
        eyebrow="Operação"
        title="Dashboard"
        subtitle="Visão de estoque da rede em tempo real (base sincronizada + movimentações do dia)."
      />

      {sync.data && (
        <div className={`banner ${sync.data.windowOpen ? 'ok' : 'warn'}`}>
          <span className={`dot ${sync.data.windowOpen ? 'green' : 'amber'}`} />
          <div>
            <strong>Integração {sync.data.mode === 'mock' ? '(modo demonstração)' : '(ao vivo)'}</strong>{' '}
            — janela da API {sync.data.window}.{' '}
            {sync.data.windowOpen
              ? 'Janela aberta agora.'
              : `Fora da janela (agora ${sync.data.now}); o estoque mostrado é o da última sincronização + movimentações internas.`}
          </div>
        </div>
      )}

      {alerts.data && alerts.data.total > 0 && (
        <div className="banner warn">
          <span className="dot amber" />
          <div>
            <strong>{alerts.data.out}</strong> ruptura(s) e <strong>{alerts.data.low}</strong> item(ns) com
            estoque baixo. <Link to="/admin/alertas" style={{ color: 'var(--accent)' }}>Ver alertas →</Link>
          </div>
        </div>
      )}

      {/* Notificação proativa do planejamento: itens no ponto de reposição.
          Atualiza ao vivo (evento planning.urgent pós-sincronização). */}
      {orders.data && orders.data.summary.items > 0 && (
        <div className="banner warn">
          <span className="dot amber" />
          {/* Saiu o emoji de carrinho que abria a frase: muda de desenho
              a cada sistema e some no cinza; e a anatomia do banner já é
              [marcador de estado] + [frase], igual nos outros dois acima —
              trocar por um ícone aqui quebraria essa uniformidade. */}
          <div>
            <strong>{orders.data.summary.items}</strong> item(ns) no ponto de reposição —{' '}
            {orders.data.summary.suppliers} pedido(s) de fornecedor somando{' '}
            <strong>{formatBRL(orders.data.summary.total)}</strong>.{' '}
            <Link to="/admin/planejamento" style={{ color: 'var(--accent)' }}>Ver pedidos prontos →</Link>
          </div>
        </div>
      )}

      {summary.isLoading ? (
        <Loading />
      ) : summary.data ? (
        <>
          {/* NÍVEL 1 — os dois indicadores que respondem "como está o estoque da
              rede AGORA?", que é a pergunta que faz esta tela existir. Dois é o
              teto: com três, a tela volta a não ter principal.
              O `largo` (duas colunas) vai para a COBERTURA e não para as
              unidades, por medida e não por gosto: a explicação da cobertura tem
              76 caracteres e, numa coluna de 265px, quebrava em três linhas —
              três linhas que empurravam a tabela para fora do primeiro quadro.
              Na coluna dupla ela cabe em duas, e a área extra fica no indicador
              que mais precisa dela. */}
          <div className="grid grid-4">
            <StatCard
              nivel={1}
              label="Unidades em estoque"
              value={summary.data.stockUnits.toLocaleString('pt-BR')}
              unidade="un."
              hint="Saldo da rede, ao vivo."
            />
            <StatCard
              nivel={1}
              className="largo"
              // O endpoint escopa gestor de loja à própria loja — o rótulo
              // precisa dizer a verdade sobre o recorte exibido.
              label={isAdmin ? 'Cobertura da rede' : 'Cobertura da loja'}
              value={
                networkCoverage === null
                  ? '—'
                  : (Math.round(networkCoverage * 10) / 10).toLocaleString('pt-BR', {
                      maximumFractionDigits: 1,
                    })
              }
              unidade={networkCoverage === null ? undefined : 'meses'}
              hint={
                cov.length > 1
                  ? `${totalStock.toLocaleString('pt-BR')} un. ÷ ${totalMonthly.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} un./mês — pesa o estoque parado das lojas do fim da lista`
                  : 'Estoque ÷ média mensal de unidades vendidas'
              }
            />
            {/* NÍVEL 2 — apoio: não é o retrato do estoque, é a fila de trabalho
                que sai dele. Assinatura de cartão padrão. */}
            <StatCard
              label="Transferências pendentes"
              value={summary.data.pendingMovements}
              hint="Solicitações e aprovações a resolver"
            />
          </div>

          {/* NÍVEL 3 — contexto. Sem moldura e sem fundo, só o filete de cima:
              recua sem sumir. E ocupa MENOS altura que o cartão padrão que estas
              quatro informações tinham antes — a hierarquia devolveu linha à
              tela em vez de cobrar por ela. */}
          <div className="grid grid-4" style={{ marginTop: 10 }}>
            <StatCard nivel={3} label="Lojas na rede" value={summary.data.stores} />
            {/* toLocaleString: o catálogo saía "21683" enquanto o estoque logo
                acima saía "40.563" — dois formatos de milhar na mesma tela. */}
            {/* O número segue o recorte do topo (Feedbacks 5.0, item 01). Como
                a rede só nos manda a contagem total de SKUs, o recorte é uma
                projeção — e a tela diz isso em vez de fingir contagem. */}
            <StatCard
              nivel={3}
              label="Produtos no catálogo"
              value={summary.data.products.toLocaleString('pt-BR')}
              hint={
                summary.data.productsEstimated && summary.data.productsNetwork != null
                  ? `Estimado no recorte · ${summary.data.productsNetwork.toLocaleString('pt-BR')} SKUs na rede inteira`
                  : 'SKUs da rede inteira'
              }
            />
            <StatCard
              nivel={3}
              label="Última sincronização"
              // Carimbo de data/hora é IDENTIFICADOR, não quantidade: não se lê
              // como magnitude, se compara com outro carimbo. É um dos quatro
              // lugares onde a mono fica — em caixa normal e sem entreletras.
              value={
                summary.data.lastSync ? (
                  <Codigo>{new Date(summary.data.lastSync.startedAt).toLocaleString('pt-BR')}</Codigo>
                ) : (
                  '—'
                )
              }
              hint={
                summary.data.lastSync
                  ? `${
                      situacaoDaSincronizacao[summary.data.lastSync.status] ??
                      summary.data.lastSync.status
                    } · ${summary.data.lastSync.recordsWritten} registros`
                  : 'Nunca executada'
              }
            />
            <StatCard
              nivel={3}
              label="Financeiro"
              value={<Link to="/admin/bi" style={{ color: 'var(--accent)', fontSize: 20 }}>Ver no BI →</Link>}
              hint="Faturamento, ticket médio e formas de pagamento"
            />
          </div>

          {/* Feedback 02/05 (Galbe): painel inicial focado em ESTOQUE — o
              financeiro mora no BI; aqui entram cobertura e remanejamento. */}
          <AberturaDeSecao
            eyebrow="Cobertura"
            titulo="Cobertura de estoque por loja"
            descricao="Unidades em estoque ÷ média mensal de unidades vendidas = estoque para quantos meses."
          />
          <div className="card">
            {coverage.isLoading ? (
              <Loading />
            ) : cov.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Loja</th>
                    <th className="num">Unidades</th>
                    <th className="num">Venda média/mês</th>
                    <th className="num">Cobertura</th>
                    <th style={{ width: '26%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {cov.map((r) => (
                    <tr key={r.storeId}>
                      <td>{r.storeName}</td>
                      <td className="num">{r.stockUnits.toLocaleString('pt-BR')}</td>
                      <td className="num">{r.monthlyUnits.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
                      <td className="num">
                        <CoverageBadge months={r.coverageMonths} level={r.level} />
                      </td>
                      <td>
                        <div
                          style={{
                            height: 8,
                            borderRadius: 4,
                            background: 'var(--accent)',
                            width: `${Math.min(((r.coverageMonths ?? maxMonths) / maxMonths) * 100, 100)}%`,
                            minWidth: 4,
                            opacity: r.coverageMonths === null ? 0.35 : 1,
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty">Sem posições de estoque ainda.</div>
            )}
          </div>

          {isAdmin && (
            <>
              <AberturaDeSecao
                eyebrow="Remanejamento"
                titulo="Transferências sugeridas entre lojas"
                descricao="Produtos parados numa loja com saída em outra — remanejar antes de comprar."
              />
              <div className="card">
              {rebalance.isLoading ? (
                <Loading />
              ) : transfers.length > 0 ? (
                <>
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
                      {transfers.map((t, i) => (
                        <tr key={`${t.productId}-${t.fromStoreId}-${t.toStoreId}-${i}`}>
                          <td>{t.description}</td>
                          <td>
                            {t.fromStoreName} <span className="muted">→</span> {t.toStoreName}
                          </td>
                          <td className="num">{t.quantity}</td>
                          <td className="muted" style={{ fontSize: 12.5 }}>{t.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p style={{ marginTop: 10, marginBottom: 0 }}>
                    <Link to="/admin/planejamento" style={{ color: 'var(--accent)' }}>
                      {rebalance.data && rebalance.data.summary.suggestions > transfers.length
                        ? `Ver todas as ${rebalance.data.summary.suggestions} sugestões no Planejamento →`
                        : 'Abrir o Planejamento →'}
                    </Link>
                  </p>
                </>
              ) : (
                <div className="empty">Nenhuma transferência sugerida agora — estoque equilibrado entre as lojas.</div>
              )}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="empty">
          Sem dados ainda. Rode a sincronização em <strong>Sincronização → Sincronizar agora</strong>.
        </div>
      )}
    </>
  );
}
