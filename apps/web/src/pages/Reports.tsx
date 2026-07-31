import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getAbc,
  getBrandCoverage,
  getBrandMix,
  getCategories,
  getRebalancePlan,
  getStores,
  getTurnover,
  formatBRL,
  type AbcDimension,
} from '../api/client';
import {
  PageHeader,
  Loading,
  CoverageBadge,
  ExportCsv,
  fmtMonths,
  Selo,
  Botao,
  StatCard,
} from '../components/ui';
import { Icon } from '../brand/Icon';
import { useAuth } from '../auth/AuthContext';
import { useScope, SCOPE_LABEL, type Scope } from '../lib/scope';

type Tab = 'abc' | 'turnover' | 'coverage' | 'transfers' | 'brandmix';

const classColor: Record<string, string> = { A: 'green', B: 'amber', C: 'gray' };

/**
 * Nota de metodologia: ícone da grade 24 + frase em Inter.
 *
 * Substitui o "ℹ︎" que estava escrito como caractere. Glifo tipográfico usado
 * como ícone muda de desenho e de largura conforme a fonte instalada no sistema
 * do usuário, e algumas famílias simplesmente não têm o caractere — nessas o
 * cliente via um retângulo vazio antes da explicação mais importante da tela.
 */
function NotaDeEscopo({ children }: { children: ReactNode }) {
  return (
    <div
      className="muted"
      style={{
        display: 'flex',
        gap: 7,
        alignItems: 'flex-start',
        fontSize: 11.5,
        lineHeight: 1.35,
        marginBottom: 12,
      }}
    >
      {/* marginTop 1: alinha o quadrado do ícone com a primeira linha de texto,
          que tem 11,5px — sem isso ele flutua acima da altura-x. */}
      <Icon name="informacao" size={14} style={{ marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

/**
 * A análise por marca cobre só produto de moda. Sem dizer isso, o total menor
 * (nos dados reais, ~43% da receita) parece defeito — e é recorte.
 *
 * Fica FORA da barra de filtros: como bloco de largura cheia dentro do flex,
 * ela reposicionava os filtros a cada troca de dimensão — foi o que o Galbe
 * viu como "os filtros somem".
 */
function BrandScopeNote({ scope }: { scope: Scope }) {
  if (scope === 'lentes') {
    return (
      /* `.banner` já é flex com gap 10: o ícone entra como primeiro item e o
         texto vai num <div> para não quebrar em vários itens de flex. */
      <div className="banner warn" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
        <Icon name="atencao" size={18} />
        <div>
          O recorte escolhido é <strong>Lentes e tratamentos</strong>, e a análise por marca ainda
          não cobre esse grupo — é do setor de produção (laboratório) e terá módulo próprio. Por
          isso esta visão sai vazia: troque o recorte para <strong>Óculos e armações</strong>.
        </div>
      </div>
    );
  }
  return (
    <NotaDeEscopo>
      A análise por marca considera <strong>óculos, armações e relógios</strong>. Lentes e
      tratamentos ficam de fora — são do setor de produção (laboratório) e terão módulo próprio,
      então o total aqui é menor que o da visão por SKU.
    </NotaDeEscopo>
  );
}

/**
 * Giro: número + estado escrito, no mesmo formato do CoverageBadge.
 *
 * Antes o chip levava só o número e o estado ficava por conta do tom (verde,
 * âmbar, cinza). Esta é a tela que o cliente IMPRIME, e impressora não tem cor:
 * em preto e branco 1,20 e 0,85 saíam no mesmo cinza, com o mesmo contorno. As
 * faixas são as que já estavam no código — o que muda é que agora elas têm nome,
 * ícone e espessura de filete, três canais que atravessam a folha.
 */
function GiroBadge({ giro }: { giro: number }) {
  const n = giro.toFixed(2);
  if (giro >= 1)
    return (
      <Selo tom="green" icone="aprovar" title="Vendeu ao menos uma vez o estoque no período.">
        {n} · gira
      </Selo>
    );
  if (giro > 0)
    return (
      <Selo tom="amber" icone="tendencia" title="Vendeu menos de uma vez o estoque no período.">
        {n} · giro baixo
      </Selo>
    );
  return (
    /* "sem venda" é o mesmo termo que fmtMonths() usa na cobertura: um estado,
       uma palavra, no produto inteiro. */
    <Selo tom="gray" icone="estoque" title="Nenhuma venda no período com estoque em casa.">
      {n} · sem venda
    </Selo>
  );
}

export function Reports() {
  const { isAdmin } = useAuth();
  const { scope } = useScope();
  const [tab, setTab] = useState<Tab>('abc');
  const [dimension, setDimension] = useState<AbcDimension>('product');
  const [days, setDays] = useState('30');
  const [storeId, setStoreId] = useState('');
  const [category, setCategory] = useState('');

  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores, enabled: isAdmin });
  const categories = useQuery({
    queryKey: ['categories', scope],
    queryFn: () => getCategories({ group: scope }),
  });

  // Trocar o recorte no título pode deixar um tipo escolhido fora da lista;
  // nesse caso o filtro se desfaz em vez de virar um fantasma.
  const tipos = categories.data ?? [];
  const tipo = category && tipos.length > 0 && !tipos.includes(category) ? '' : category;

  // Transferências e Marcas × Bandeiras são leituras da rede inteira: loja e
  // tipo não se aplicam. Nas outras três, aplicam-se sempre.
  const filtraLoja = tab !== 'transfers' && tab !== 'brandmix';
  const filtraTipo = filtraLoja;

  // Um único conjunto de filtros para TODAS as visões e para as duas dimensões
  // da curva ABC: trocar SKU por marca não mexe em filtro nenhum.
  const params = { days, storeId: storeId || undefined, group: scope, category: tipo || undefined };

  const abc = useQuery({
    queryKey: ['abc', days, storeId, dimension, scope, tipo],
    queryFn: () => getAbc({ ...params, dimension }),
    enabled: tab === 'abc',
  });
  const turnover = useQuery({
    queryKey: ['turnover', days, storeId, scope, tipo],
    queryFn: () => getTurnover(params),
    enabled: tab === 'turnover',
  });
  const coverage = useQuery({
    queryKey: ['brand-coverage', days, storeId, scope, tipo],
    queryFn: () => getBrandCoverage(params),
    enabled: tab === 'coverage',
  });
  // Relatório de transferências (feedback 09) = plano de remanejamento.
  const transfers = useQuery({
    queryKey: ['planning-rebalance', days],
    queryFn: () => getRebalancePlan({ days }),
    enabled: tab === 'transfers' && isAdmin,
  });
  // Mix de marcas por bandeira (feedback 04 fase 2).
  const brandMix = useQuery({
    queryKey: ['brand-mix', days],
    queryFn: () => getBrandMix({ days }),
    enabled: tab === 'brandmix' && isAdmin,
  });

  return (
    <>
      {/* Sem botão sólido nesta tela, e é de propósito.
          Relatórios é leitura: escolher recorte, ler a tabela, levar em CSV.
          Nenhuma dessas ações muda o estoque nem decide nada, então nenhuma
          merece o ouro preenchido — o `eyebrow` "Consulta" já é o contrato que
          as outras telas de leitura do console usam (Estoque, Produtos, Lojas,
          Vendas). O sólido fica onde há decisão: Transferências, Planejamento. */}
      <PageHeader
        eyebrow="Consulta"
        title="Relatórios"
        subtitle="Curva ABC (SKU ou marca), giro, cobertura de estoque e transferências sugeridas — todos exportáveis em CSV."
      />

      {/* Linha 1 — o que olhar. */}
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <div className="segmented">
          <button className={tab === 'abc' ? 'active' : ''} onClick={() => setTab('abc')}>
            Curva ABC
          </button>
          <button className={tab === 'turnover' ? 'active' : ''} onClick={() => setTab('turnover')}>
            Giro de estoque
          </button>
          <button className={tab === 'coverage' ? 'active' : ''} onClick={() => setTab('coverage')}>
            Cobertura
          </button>
          {isAdmin && (
            <button className={tab === 'transfers' ? 'active' : ''} onClick={() => setTab('transfers')}>
              Transferências
            </button>
          )}
          {isAdmin && (
            <button className={tab === 'brandmix' ? 'active' : ''} onClick={() => setTab('brandmix')}>
              Marcas × Bandeiras
            </button>
          )}
        </div>
        {tab === 'abc' && (
          <div className="segmented">
            <button className={dimension === 'product' ? 'active' : ''} onClick={() => setDimension('product')}>
              Por SKU
            </button>
            <button className={dimension === 'brand' ? 'active' : ''} onClick={() => setDimension('brand')}>
              Por marca
            </button>
          </div>
        )}
      </div>

      {/* Linha 2 — os filtros, sempre no MESMO lugar: mesma linha, mesma ordem,
          em qualquer aba e em qualquer dimensão. */}
      <div className="toolbar">
        <select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Período">
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="180">Últimos 180 dias</option>
        </select>
        {isAdmin && filtraLoja && (
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Loja">
            <option value="">Toda a rede</option>
            {stores.data?.rows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {filtraTipo && (
          <select value={tipo} onChange={(e) => setCategory(e.target.value)} aria-label="Tipo de produto">
            <option value="">Todos os tipos</option>
            {tipos.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        {(storeId || tipo) && (
          <Botao
            variante="discreto"
            pequeno
            icone="limpar"
            onClick={() => {
              setStoreId('');
              setCategory('');
            }}
          >
            Limpar filtros
          </Botao>
        )}
        <span style={{ flex: 1 }} />
        {tab === 'abc' && (
          <ExportCsv
            rows={abc.data?.rows}
            filename={`abc-${dimension === 'brand' ? 'marcas' : 'skus'}-${days}d`}
            columns={[
              { key: 'class', label: 'Classe' },
              { key: 'label', label: dimension === 'brand' ? 'Marca' : 'Produto' },
              { key: 'brand', label: 'Marca' },
              { key: 'category', label: 'Categoria' },
              { key: 'units', label: 'Unidades' },
              { key: 'revenue', label: 'Receita' },
              { key: 'revenuePct', label: '% receita' },
              { key: 'cumulativePct', label: '% acumulado' },
            ]}
          />
        )}
        {tab === 'turnover' && (
          <ExportCsv
            rows={turnover.data?.rows}
            filename={`giro-${days}d`}
            columns={[
              { key: 'description', label: 'Produto' },
              { key: 'brand', label: 'Marca' },
              { key: 'category', label: 'Categoria' },
              { key: 'unitsSold', label: 'Un. vendidas' },
              { key: 'currentStock', label: 'Estoque atual' },
              { key: 'turnover', label: 'Giro' },
              { key: 'daysOfInventory', label: 'Dias de cobertura' },
            ]}
          />
        )}
        {tab === 'coverage' && (
          <ExportCsv
            rows={coverage.data ? [coverage.data.total, ...coverage.data.rows] : undefined}
            filename={`cobertura-marcas-${days}d`}
            columns={[
              { key: 'label', label: 'Marca' },
              { key: 'stockUnits', label: 'Unidades em estoque' },
              { key: 'monthlyUnits', label: 'Venda média/mês' },
              { key: 'coverageMonths', label: 'Cobertura (meses)' },
              { key: 'level', label: 'Nível' },
            ]}
          />
        )}
        {tab === 'brandmix' && brandMix.data && (
          <ExportCsv
            rows={brandMix.data.rows.flatMap((r) =>
              brandMix.data!.banners.map((b) => ({
                marca: r.brand,
                bandeira: b,
                vendidas: r.byBanner[b]?.unitsSold ?? 0,
                estoque: r.byBanner[b]?.stockUnits ?? 0,
                remanejar: r.moveFrom.includes(b) ? 'sim' : '',
              })),
            )}
            filename={`marcas-bandeiras-${days}d`}
            columns={[
              { key: 'marca', label: 'Marca' },
              { key: 'bandeira', label: 'Bandeira' },
              { key: 'vendidas', label: 'Un. vendidas' },
              { key: 'estoque', label: 'Estoque' },
              { key: 'remanejar', label: 'Candidata a remanejo' },
            ]}
          />
        )}
        {tab === 'transfers' && (
          <ExportCsv
            rows={transfers.data?.rows}
            filename={`transferencias-sugeridas-${days}d`}
            columns={[
              { key: 'description', label: 'Produto' },
              { key: 'brand', label: 'Marca' },
              { key: 'fromStoreName', label: 'De' },
              { key: 'toStoreName', label: 'Para' },
              { key: 'quantity', label: 'Qtd' },
              { key: 'reason', label: 'Motivo' },
            ]}
          />
        )}
      </div>

      {((tab === 'abc' && dimension === 'brand') || tab === 'coverage') && <BrandScopeNote scope={scope} />}

      {/* Por SKU o recorte também vale, e o total menor tem que ter explicação
          na tela — não no suporte. */}
      {tab === 'abc' && dimension === 'product' && scope !== 'todos' && abc.data?.periodRevenue != null && (
        <NotaDeEscopo>
          O total abaixo é do recorte <strong>{SCOPE_LABEL[scope]}</strong>
          {tipo ? <> · <strong>{tipo}</strong></> : null}. A receita da rede no mesmo período foi{' '}
          {formatBRL(abc.data.periodRevenue)} — a diferença é lente, tratamento e demais categorias.
        </NotaDeEscopo>
      )}

      {/* Feedbacks 5.0, item 05: a curva é curta porque só entra quem vendeu na
          janela, e a janela do CDS é menor do que o rótulo do período sugere.
          Dizer isso é diferente de a tela parecer quebrada. */}
      {tab === 'abc' && abc.data?.skusComVenda != null && abc.data.skusNoCatalogo != null && (
        <NotaDeEscopo>
          A curva tem <strong>{abc.data.skusComVenda.toLocaleString('pt-BR')}</strong> produtos porque
          só entra quem <strong>vendeu</strong> no período — o catálogo tem{' '}
          {abc.data.skusNoCatalogo.toLocaleString('pt-BR')} SKUs, e o resto ficou parado.
          {abc.data.janelaRealDias != null && abc.data.janelaRealDias < abc.data.days ? (
            <>
              {' '}A extração atual do CDS cobre <strong>{abc.data.janelaRealDias} dias</strong> de venda,
              não {abc.data.days}: com a janela cheia a curva cresce.
            </>
          ) : null}
        </NotaDeEscopo>
      )}

      {tab === 'abc' ? (
        abc.isLoading ? (
          <Loading />
        ) : abc.data ? (
          <>
            {/* HIERARQUIA — os quatro cartões eram `div.card.stat` escritos à
                mão, com UMA assinatura só: as três classes e a receita pesavam
                igual. Agora usam <StatCard>, que é onde os níveis moram.

                NÍVEL 1 é RECEITA NO RECORTE, e vem PRIMEIRO. É o número que
                ancora a leitura de todos os outros: as contagens 172/85/49 só
                querem dizer alguma coisa depois que se sabe sobre que receita
                elas foram repartidas — e é exatamente esse o mal-entendido que
                a tela foi negociada para desfazer ("os números da curva ABC
                estão muito baixos"). Com a receita e o seu percentual em
                destaque, "recortado" para de parecer "errado" antes mesmo de o
                gestor ler a nota.

                A, B e C ficam TODAS em nível 2, e isso é deliberado: são um
                CONJUNTO COMPARÁVEL. Destacar a classe A sobre as outras duas
                destruiria a única leitura que o trio serve — a de proporção
                entre elas. Hierarquia é para separar famílias, não para eleger
                membro dentro de uma família.

                Nenhum texto desta tela mudou: a tela foi acordada frase a frase
                com o cliente nesta semana e o que se mexeu aqui é vocabulário
                tipográfico e nível, não conteúdo. */}
            <div className="grid grid-4">
              <StatCard
                nivel={1}
                label="Receita no recorte"
                // O corpo de 40px do nível 1 é para número curto; um valor em
                // reais com milhar tem 13 caracteres e estouraria a coluna. O
                // destaque continua vencendo pelos outros três canais —
                // superfície própria, filete dourado de 3px e respiro maior —
                // que é justamente por que eles são canais independentes.
                value={<span style={{ fontSize: 26 }}>{formatBRL(abc.data.totalRevenue)}</span>}
                /* "Os números da curva ABC estão muito baixos" — estavam
                   certos: é o recorte. Sem o denominador ao lado, "recortado"
                   parecia "errado". */
                hint={
                  abc.data.periodRevenue != null && abc.data.periodRevenue > 0 ? (
                    <>
                      {((abc.data.totalRevenue / abc.data.periodRevenue) * 100).toFixed(0)}% dos{' '}
                      {formatBRL(abc.data.periodRevenue)} vendidos no período
                    </>
                  ) : undefined
                }
              />
              {(['A', 'B', 'C'] as const).map((k) => (
                <StatCard
                  key={k}
                  label={`Classe ${k} ${k === 'A' ? '(alta)' : k === 'C' ? '(cauda)' : '(média)'}`}
                  value={abc.data.summary[k].items}
                  unidade="SKUs"
                  hint={formatBRL(abc.data.summary[k].revenue)}
                />
              ))}
            </div>

            <div className="card" style={{ marginTop: 16, padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Classe</th>
                    <th>{dimension === 'brand' ? 'Marca' : 'Produto'}</th>
                    <th className="num">Un. vendidas</th>
                    <th className="num">Receita</th>
                    <th className="num">% receita</th>
                    <th className="num">% acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {abc.data.rows.slice(0, 100).map((r) => (
                    <tr key={r.key}>
                      {/* Este continua chip cru, sem <Selo> e sem ícone, e é
                          decisão: classe ABC não é estado operacional, é
                          classificação — e a letra A/B/C JÁ é o rótulo escrito.
                          Em cinza as três se separam pela letra e pela espessura
                          do filete que o `.badge` dá a cada família. Um ícone
                          aqui não acrescentaria canal nenhum: acrescentaria
                          ruído em 100 linhas. */}
                      <td>
                        <span className={`badge ${classColor[r.class]}`}>{r.class}</span>
                      </td>
                      <td>
                        <div>{r.label}</div>
                        {(r.brand || r.category) && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {[r.brand, r.category].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="num">{r.units}</td>
                      <td className="num">{formatBRL(r.revenue)}</td>
                      <td className="num">{r.revenuePct.toFixed(1)}%</td>
                      <td className="num">{r.cumulativePct.toFixed(1)}%</td>
                    </tr>
                  ))}
                  {abc.data.rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty">
                        Sem vendas no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null
      ) : tab === 'turnover' ? (
        turnover.isLoading ? (
          <Loading />
        ) : turnover.data ? (
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Categoria</th>
                  <th className="num">Un. vendidas</th>
                  <th className="num">Estoque atual</th>
                  <th className="num">Giro</th>
                  <th className="num">Dias de cobertura</th>
                </tr>
              </thead>
              <tbody>
                {turnover.data.rows.slice(0, 150).map((r) => (
                  <tr key={r.productId}>
                    <td>{r.description}</td>
                    <td>{r.category ?? '—'}</td>
                    <td className="num">{r.unitsSold}</td>
                    <td className="num">{r.currentStock}</td>
                    <td className="num">
                      <GiroBadge giro={r.turnover} />
                    </td>
                    <td className="num">{r.daysOfInventory ?? '—'}</td>
                  </tr>
                ))}
                {turnover.data.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty">
                      Sem dados no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null
      ) : tab === 'coverage' ? (
        coverage.isLoading ? (
          <Loading />
        ) : coverage.data ? (
          <>
            {/* NÍVEL 1 é COBERTURA GERAL, pelo mesmo motivo que no Dashboard: é
                a única razão dos três, e é a que foi conciliada com a home
                ("mesma base do Dashboard" está na frase, e a frase não mudou).
                As contagens de marcas são recorte do catálogo — apoio.
                `largo` porque a explicação do cálculo tem 60+ caracteres e numa
                coluna só ela quebrava em três linhas. */}
            <div className="grid grid-4">
              <StatCard
                nivel={1}
                className="largo"
                label="Cobertura geral"
                value={fmtMonths(coverage.data.total.coverageMonths)}
                hint={
                  <>
                    {coverage.data.total.stockUnits.toLocaleString('pt-BR')} un. ÷{' '}
                    {coverage.data.total.monthlyUnits.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} un./mês
                    {' · '}mesma base do Dashboard
                  </>
                }
              />
              <StatCard
                label="Marcas com estoque"
                value={coverage.data.rows.length}
                hint={'"Sem marca" = grade do CDS sem fornecedor (o backfill preenche)'}
              />
              <StatCard
                label="Marcas paradas"
                value={coverage.data.rows.filter((r) => r.coverageMonths === null && r.stockUnits > 0).length}
                hint="Com estoque e nenhuma venda no período"
              />
            </div>
            {/* "Essa cobertura de estoque não bate com a cobertura média do
                dashboard inicial da home" — batia, não: a linha GERAL lia a
                amostra do catálogo e o dashboard lia a rede. Agora as duas leem
                a rede, e onde a tabela por marca ainda é amostra, ela diz. */}
            {coverage.data.sampled && (
              <div className="banner warn" style={{ marginTop: 16, marginBottom: 0, fontSize: 12.5, lineHeight: 1.4 }}>
                <Icon name="atencao" size={18} />
                <div>
                  A <strong>cobertura geral</strong> acima é da rede inteira (
                  {coverage.data.sampled.networkStockUnits.toLocaleString('pt-BR')} un.), a mesma base do
                  Dashboard. As linhas por marca abaixo saem da amostra de catálogo desta demonstração
                  estática ({coverage.data.sampled.stockUnits.toLocaleString('pt-BR')} un.), então elas
                  não somam o total. No sistema em produção as duas leem a mesma base.
                </div>
              </div>
            )}
            <div className="card" style={{ marginTop: 16, padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Marca</th>
                    <th className="num">Unidades</th>
                    <th className="num">Venda média/mês</th>
                    <th className="num">Cobertura</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.data.rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      <td className="num">{r.stockUnits.toLocaleString('pt-BR')}</td>
                      <td className="num">{r.monthlyUnits.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
                      <td className="num">
                        <CoverageBadge months={r.coverageMonths} level={r.level} />
                      </td>
                    </tr>
                  ))}
                  {coverage.data.rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="empty">
                        Sem posições de estoque.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null
      ) : tab === 'brandmix' ? (
        brandMix.isLoading ? (
          <Loading />
        ) : brandMix.data ? (
          <>
            {/* "Esse relatório não tá claro o que diz." Estava mesmo: a
                célula "51 / 457" não dizia o que era cada número, e o título
                não dizia que pergunta o relatório responde. */}
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="section-title" style={{ marginBottom: 4 }}>
                Onde cada marca VENDE e onde ela está PARADA
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45 }}>
                Serve para uma decisão só: <strong>tirar estoque da bandeira onde a marca não sai e
                mandar para a bandeira onde ela sai</strong>. Cada célula tem dois números —{' '}
                <strong style={{ color: 'var(--text)' }}>vendidas</strong> no período e{' '}
                <span className="muted">em estoque</span> hoje. Estoque alto com venda zero numa
                bandeira, enquanto a marca vende em outra, ganha o selo{' '}
                <Selo tom="amber" icone="transferencias">
                  remanejar
                </Selo>
                .
              </p>
              {(() => {
                const sinalizadas = brandMix.data!.rows.filter((r) => r.moveFrom.length > 0);
                if (sinalizadas.length === 0) return null;
                // Quando quase todo o remanejo aponta para a MESMA bandeira, o
                // achado do relatório é essa bandeira — e não 39 selos iguais
                // espalhados pela tabela.
                const porBandeira = new Map<string, number>();
                for (const r of sinalizadas)
                  for (const b of r.moveFrom) porBandeira.set(b, (porBandeira.get(b) ?? 0) + 1);
                const [dominante, quantas] = [...porBandeira.entries()].sort((a, b) => b[1] - a[1])[0];
                const concentrada = quantas / sinalizadas.length >= 0.6;
                const unidades = sinalizadas.reduce(
                  (a, r) => a + (r.moveFrom.includes(dominante) ? r.byBanner[dominante]?.stockUnits ?? 0 : 0),
                  0,
                );
                return (
                  <p style={{ margin: '8px 0 0', fontSize: 12.5 }}>
                    <strong>{sinalizadas.length}</strong>{' '}
                    {sinalizadas.length > 1 ? 'marcas têm' : 'marca tem'} estoque parado em alguma
                    bandeira enquanto {sinalizadas.length > 1 ? 'vendem' : 'vende'} em outra.
                    {concentrada && (
                      <>
                        {' '}
                        <strong>{quantas} delas apontam para a mesma bandeira: {dominante}</strong>, que
                        segura {unidades.toLocaleString('pt-BR')} unidades dessas marcas sem nenhuma
                        venda no período. É o maior bloco de capital parado do relatório — vale
                        confirmar com uma janela maior de vendas antes de mover.
                      </>
                    )}
                  </p>
                );
              })()}
            </div>
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Marca</th>
                    {brandMix.data.banners.map((b) => (
                      <th key={b} className="num">
                        <div>{b}</div>
                        <div className="muted" style={{ fontWeight: 400, fontSize: 10, textTransform: 'none' }}>
                          vendidas · estoque
                        </div>
                      </th>
                    ))}
                    <th className="num">
                      <div>Total</div>
                      <div className="muted" style={{ fontWeight: 400, fontSize: 10, textTransform: 'none' }}>
                        vendidas · estoque
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {brandMix.data.rows.slice(0, 40).map((r) => (
                    <tr key={r.brand}>
                      <td>
                        <div>{r.brand}</div>
                        {r.moveFrom.length > 0 && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            parada em {r.moveFrom.join(', ')}
                          </div>
                        )}
                      </td>
                      {brandMix.data!.banners.map((b) => {
                        const cell = r.byBanner[b];
                        const flagged = r.moveFrom.includes(b);
                        return (
                          <td key={b} className="num">
                            {cell ? (
                              /* A célula sinalizada carregava só o tom âmbar: em cinza, e
                                 na folha impressa, ela ficava idêntica às vizinhas. O ícone
                                 de transferência dá FORMA ao selo — e é o mesmo ícone do
                                 chip "remanejar" da legenda acima, para que legenda e
                                 tabela digam a mesma coisa com o mesmo desenho. */
                              <span
                                className={flagged ? 'badge amber' : undefined}
                                style={
                                  flagged
                                    ? { display: 'inline-flex', alignItems: 'center', gap: 5, verticalAlign: 'middle' }
                                    : undefined
                                }
                                title={
                                  flagged
                                    ? `${cell.unitsSold} vendidas e ${cell.stockUnits} em estoque: parada aqui, mas a marca vende em outra bandeira`
                                    : `${cell.unitsSold} vendidas · ${cell.stockUnits} em estoque`
                                }
                              >
                                {flagged && <Icon name="transferencias" size={12} />}
                                <span>
                                  <strong>{cell.unitsSold}</strong>
                                  <span className="muted"> · {cell.stockUnits.toLocaleString('pt-BR')}</span>
                                </span>
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="num">
                        <strong>{r.total.unitsSold}</strong>
                        <span className="muted"> · {r.total.stockUnits.toLocaleString('pt-BR')}</span>
                      </td>
                    </tr>
                  ))}
                  {brandMix.data.rows.length === 0 && (
                    <tr>
                      <td colSpan={brandMix.data.banners.length + 2} className="empty">
                        Sem dados no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
              Mostrando as 40 primeiras marcas, candidatas a remanejo primeiro; o CSV leva todas.
            </p>
          </>
        ) : null
      ) : transfers.isLoading ? (
        <Loading />
      ) : transfers.data ? (
        <>
          {/* NÍVEL 1 é UNIDADES A MOVER: é a única das três que mede o TAMANHO
              do trabalho. "Sugestões" conta linhas de plano e "lojas envolvidas"
              descreve o alcance — as duas são recorte da primeira, e é por isso
              que descem para contexto (nível 3) em vez de disputar o topo. */}
          <div className="grid grid-4">
            <StatCard
              nivel={1}
              className="largo"
              label="Unidades a mover"
              value={transfers.data.summary.units}
              unidade="un."
              hint="Produto parado numa loja com saída em outra — remanejar custa zero."
            />
            <StatCard nivel={3} label="Transferências sugeridas" value={transfers.data.summary.suggestions} />
            <StatCard nivel={3} label="Lojas envolvidas" value={transfers.data.summary.storesInvolved} />
          </div>
          <div className="card" style={{ marginTop: 16, padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  {/* A seta aqui é PONTUAÇÃO, não ícone: ela liga duas palavras
                      dentro de uma frase ("De → Para", "Centro → Shopping") e é
                      lida como "para". Trocar por <Icon> quebraria a linha do
                      texto e obrigaria a alinhar um SVG dentro do nome da loja.
                      A regra de "zero glifo como ícone" vale para o glifo que
                      ocupa lugar de botão ou de marcador de estado. */}
                  <th>De → Para</th>
                  <th className="num">Qtd</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {transfers.data.rows.slice(0, 200).map((t, i) => (
                  <tr key={`${t.productId}-${t.fromStoreId}-${t.toStoreId}-${i}`}>
                    <td>
                      <div>{t.description}</div>
                      {t.brand && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {t.brand}
                        </div>
                      )}
                    </td>
                    <td>
                      {t.fromStoreName} <span className="muted">→</span> {t.toStoreName}
                    </td>
                    <td className="num">{t.quantity}</td>
                    <td className="muted" style={{ fontSize: 12.5 }}>{t.reason}</td>
                  </tr>
                ))}
                {transfers.data.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty">
                      Nenhuma transferência sugerida — estoque equilibrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
