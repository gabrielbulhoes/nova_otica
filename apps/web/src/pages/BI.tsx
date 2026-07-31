import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getBiKpis,
  getBiTimeseries,
  getBiDimension,
  getBiSalesFlow,
  getBiTransferFlow,
  getBiHeatmap,
  getArStats,
  getStores,
  formatBRL,
} from '../api/client';
import { PageHeader, StatCard, Loading } from '../components/ui';
import { EChart } from '../components/EChart';
import { Icon } from '../brand/Icon';
import {
  barOption,
  gaugeOption,
  heatmapOption,
  pieOption,
  sankeyOption,
  timeSeriesOption,
} from '../bi/transforms';
import { toCsv, downloadCsv } from '../bi/csv';
import { useAuth } from '../auth/AuthContext';

/**
 * Vocabulário de cor dos gráficos desta página.
 *
 * POR QUE NÃO É `var(--terra)` / `var(--ouro)` / `var(--verde)`.
 * Dois motivos, e o segundo é o que decide:
 *
 * 1. As `option` do ECharts são pintadas em CANVAS. `fillStyle` não resolve
 *    custom property de CSS — a string `var(--terra)` chega crua e o traço sai
 *    preto (ou some). Token de CSS só funciona onde existe cascata, e dentro do
 *    <canvas> não existe.
 * 2. Mesmo que resolvesse, seria a cor ERRADA. Os tokens do styles.css são cor
 *    de TEXTO, calibrados para ≥4.5:1 sobre a página (`--terra #6e1c0e` dá
 *    10.1:1 no claro). Cor de DADO é outra escala: preenchimento sobre o card,
 *    alvo ≥3:1, e com um par por tema. Quem tem as duas escalas medidas é
 *    `transforms.ts` (`PALETA_DADOS[tema].estado`), e o caminho documentado
 *    para chegar nelas a partir da página é a tabela `PONTE_CORES`, que traduz
 *    exatamente estas chaves para o slot do tema em vigor.
 *
 * Então a página declara INTENÇÃO ("este medidor é o crítico") e quem escolhe o
 * pigmento é o transformador. Passar um hex fora desta tabela não pinta de
 * qualquer jeito: `corDaSerie` o descarta e cai no ouro padrão — por isso as
 * chaves abaixo não podem ser "melhoradas" para valores mais bonitos aqui.
 */
const COR = {
  critico: '#f06363',
  atencao: '#f5b73d',
  saudavel: '#36c98f',
  ametista: '#a78bfa',
  azul: '#38bdf8',
} as const;

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
  const transferFlow = useQuery({ queryKey: ['bi-transfer', days, storeId], queryFn: () => getBiTransferFlow(p) });
  const heatmap = useQuery({ queryKey: ['bi-heat', days, storeId], queryFn: () => getBiHeatmap(p) });
  const arStats = useQuery({ queryKey: ['ar-stats', days], queryFn: () => getArStats(Number(days)) });

  /*
     Cópias locais das respostas.
     Cada `option` agora é uma FUNÇÃO `(tema) => …` — ou seja, um closure. O
     TypeScript não carrega para dentro de um closure o estreitamento feito
     sobre ACESSO A PROPRIEDADE (`byStore.data && …`), porque a função pode ser
     chamada depois, quando a propriedade já mudou. Com const local o
     estreitamento sobrevive e o JSX não precisa de `!` em lugar nenhum.
  */
  const indicadores = kpis.data;
  const serie = timeseries.data;
  const porLoja = byStore.data;
  const porPagamento = byPayment.data;
  const porCategoria = byCategory.data;
  const fluxoVendas = flow.data;
  const fluxoTransferencias = transferFlow.data;
  const mapaCalor = heatmap.data;
  const ar = arStats.data;

  const exportTimeseries = () => {
    if (!serie) return;
    downloadCsv(
      `faturamento-${days}d`,
      toCsv(serie.points, [
        { key: 'date', label: 'Data' },
        { key: 'total', label: 'Faturamento' },
        { key: 'count', label: 'Vendas' },
      ]),
    );
  };

  /*
     SOBRE ESCURECER SÓ O BLOCO DOS GRÁFICOS (`data-tema="escuro"` no contêiner).
     Avaliado e recusado, por três razões:

     · A tela não é um painel homogêneo de gráficos. Entre o cabeçalho, a barra
       de filtros e os quatro indicadores numéricos, mais da metade da altura é
       superfície de leitura comum. Uma ilha preta no meio de papel creme não é
       "painel de alta densidade": é remendo, e o manual reserva o escuro para a
       TELA de alta densidade, não para um pedaço dela.
     · O card do provador virtual mistura StatCard e gráfico no mesmo retângulo.
       Escurecer "o bloco dos gráficos" obrigaria a escurecer indicadores que
       são gêmeos idênticos aos quatro do topo, que ficariam claros. Dois
       tratamentos para o mesmo componente na mesma tela.
     · O alternador de tema já está em produção. Fixar escuro aqui passaria por
       cima da escolha explícita de quem pediu claro — e o escuro do manual é
       "opção do usuário", não imposição da tela.

     O que a tela precisava do tema já está resolvido abaixo: toda `option` é
     função do tema, então quando o usuário troca, card e série trocam juntos.
  */

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

      {kpis.isLoading || !indicadores ? (
        <Loading />
      ) : (
        <>
          {/* KPIs numéricos */}
          <div className="grid grid-4">
            <StatCard label="Faturamento" value={formatBRL(indicadores.revenue)} hint={`${indicadores.salesCount} vendas`} />
            <StatCard label="Ticket médio" value={formatBRL(indicadores.avgTicket)} />
            <StatCard label="Unidades em estoque" value={indicadores.stockUnits.toLocaleString('pt-BR')} hint={`${indicadores.unitsSold} vendidas no período`} />
            <StatCard label="Transferências pendentes" value={indicadores.pendingTransfers} />
          </div>

          {/*
             Medidores.
             Os três estados (crítico, atenção, saudável) nunca dependem da cor:
             cada card traz título escrito, o número em Fraunces e a unidade em
             mono sob o arco. Em `filter: grayscale(1)` os três continuam
             separáveis pelo texto — a cor só reforça.
          */}
          <div className="grid grid-3" style={{ marginTop: 16 }}>
            <div className="card">
              <h3 className="section-title">Taxa de itens em falta</h3>
              <EChart
                option={(tema) => gaugeOption(indicadores.rupturaRate, 100, '% em falta', COR.critico, '%', { tema })}
                height={200}
              />
            </div>
            <div className="card">
              <h3 className="section-title">Estoque baixo</h3>
              <EChart
                option={(tema) =>
                  gaugeOption(indicadores.lowStockRate, 100, '% abaixo do mínimo', COR.atencao, '%', { tema })
                }
                height={200}
              />
            </div>
            <div className="card">
              <h3 className="section-title">Giro (proxy da rede)</h3>
              <EChart
                option={(tema) =>
                  gaugeOption(indicadores.turnover, 2, 'un. vendidas / estoque', COR.saudavel, '', { tema })
                }
                height={200}
              />
            </div>
          </div>

          {/* Timeline */}
          <div className="card" style={{ marginTop: 16 }}>
            {/*
               O <EChart> desenha o botão de PNG flutuando no canto superior
               DIREITO da área do gráfico. Com o CSV também à direita, os dois
               ficavam empilhados um sob o outro, colados na margem do card, e o
               de baixo cobria o topo da série. O CSV volta para junto do título
               — que é onde está o dado que ele exporta — e a coluna da direita
               fica só do PNG, igual a todos os outros cards da tela.
            */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <h3 className="section-title" style={{ margin: 0 }}>
                Faturamento diário
              </h3>
              <button
                className="btn ghost sm"
                onClick={exportTimeseries}
                disabled={!serie}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
              >
                <Icon name="exportar" size={15} />
                CSV
              </button>
            </div>
            {serie && (
              <EChart
                option={(tema) => timeSeriesOption(serie.points, { tema, unidade: 'moeda' })}
                height={280}
                exportName={`faturamento-${days}d`}
              />
            )}
          </div>

          {/* Colunas + Pizza */}
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <h3 className="section-title">Vendas por loja</h3>
              {porLoja && (
                <EChart
                  option={(tema) => barOption(porLoja.rows, undefined, { tema, unidade: 'moeda' })}
                  height={300}
                  exportName="vendas-por-loja"
                />
              )}
            </div>
            <div className="card">
              <h3 className="section-title">Formas de pagamento</h3>
              {porPagamento && (
                <EChart
                  option={(tema) => pieOption(porPagamento.rows, { tema, unidade: 'moeda' })}
                  height={300}
                  exportName="formas-de-pagamento"
                />
              )}
            </div>
          </div>

          {/* Sankeys: vendas e transferências */}
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <h3 className="section-title">Fluxo de vendas — Categoria → Loja</h3>
              {fluxoVendas && fluxoVendas.links.length > 0 ? (
                <EChart
                  option={(tema) => sankeyOption(fluxoVendas, { tema, unidade: 'moeda' })}
                  height={360}
                  exportName="fluxo-vendas"
                />
              ) : (
                <div className="empty">Sem dados de fluxo no período.</div>
              )}
            </div>
            <div className="card">
              <h3 className="section-title">Transferências entre lojas — Origem → Destino</h3>
              {fluxoTransferencias && fluxoTransferencias.links.length > 0 ? (
                // Transferência move PEÇA, não dinheiro: o valor do elo é a
                // quantidade movida (InventoryMovement.quantity).
                <EChart
                  option={(tema) => sankeyOption(fluxoTransferencias, { tema, unidade: 'unidades' })}
                  height={360}
                  exportName="fluxo-transferencias"
                />
              ) : (
                <div className="empty">Sem transferências no período.</div>
              )}
            </div>
          </div>

          {/* Colunas categoria + Heatmap */}
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <h3 className="section-title">Vendas por categoria</h3>
              {porCategoria && (
                <EChart
                  option={(tema) => barOption(porCategoria.rows, COR.ametista, { tema, unidade: 'moeda' })}
                  height={320}
                  exportName="vendas-por-categoria"
                />
              )}
            </div>
            <div className="card">
              <h3 className="section-title">Receita por loja × dia da semana</h3>
              {mapaCalor && mapaCalor.yLabels.length > 0 ? (
                <EChart
                  option={(tema) => heatmapOption(mapaCalor, { tema, unidade: 'moeda' })}
                  height={320}
                  exportName="heatmap-receita"
                />
              ) : (
                <div className="empty">Sem dados no período.</div>
              )}
            </div>
          </div>

          {/* Funil do provador virtual (AR) — sinergia BI × AR */}
          <div className="card" style={{ marginTop: 16 }}>
            <h3 className="section-title">Provador virtual (AR) — provas → conversão</h3>
            {ar && ar.total > 0 ? (
              <div className="grid grid-2">
                <div>
                  <div className="grid grid-3">
                    <StatCard label="Provas" value={ar.total} />
                    <StatCard label="Conversões" value={ar.converted} hint="viraram carrinho/compra" />
                    <StatCard label="Taxa" value={`${ar.conversionRate}%`} />
                  </div>
                  <EChart
                    option={(tema) => gaugeOption(ar.conversionRate, 100, 'conversão', COR.saudavel, '%', { tema })}
                    height={200}
                  />
                </div>
                <div>
                  {/* Rótulo curto de bloco: mono caixa alta, a gramática de
                      rótulo do manual. Em .muted virava um subtítulo em Inter
                      que competia com o título do card, logo acima. */}
                  <div className="label" style={{ marginBottom: 8 }}>
                    Produtos mais provados
                  </div>
                  {/* Prova é contagem de eventos: `unidades`, e não o palpite da
                      inferência — que carimbaria "R$" assim que o topo passasse
                      de mil provas. */}
                  <EChart
                    option={(tema) =>
                      barOption(
                        ar.topProducts.map((t) => ({ label: t.description, total: t.tryOns })),
                        COR.azul,
                        { tema, unidade: 'unidades' },
                      )
                    }
                    height={280}
                    exportName="top-provas"
                  />
                </div>
              </div>
            ) : (
              <div className="empty">Ainda sem provas registradas no período.</div>
            )}
          </div>
        </>
      )}
    </>
  );
}
