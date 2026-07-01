# Feature 1 — Dashboard de BI em tempo real

> Metodologia Qodo: **spec-first · incrementos revisáveis · testes de 1ª classe
> · portões de revisão · feedback contínuo.**

## 1. Objetivo

Entregar um painel executivo e operacional que consolide, **em tempo real**,
tudo que a plataforma sabe sobre estoque, vendas, transferências e (na 2ª
fase) provas de AR — com KPIs, gauges, gráficos de coluna, pizza, sankey,
timelines e heatmaps, respeitando o escopo por papel (rede × loja).

### Personas e perguntas que o painel responde
- **Gestor da rede (ADMIN):** Onde estão minhas rupturas agora? Qual loja
  gira melhor? Qual o mix ABC? Como fluem as transferências entre filiais?
  Qual a evolução de faturamento e do estoque?
- **Gestor de loja (STORE_MANAGER):** Como está o *meu* estoque e as *minhas*
  vendas? O que está perto de ruptura? Minhas solicitações de transferência?

## 2. Critérios de aceite (nível feature)

- [ ] Todo gráfico declara e exibe o **timestamp da fonte** do dado, separando
  **vendas em tempo real** (e-commerce/checkout — decisão D4) das **vendas
  diárias do ERP** (última sync das 06h).
- [ ] ADMIN enxerga a rede; STORE_MANAGER só a própria loja (reuso de `scopedStoreId`).
- [ ] O painel atualiza **sem recarregar a página** quando ocorre uma
  movimentação/sync (via SSE), em ≤ 3 s.
- [ ] Filtros de período, loja, categoria e marca afetam todos os gráficos.
- [ ] Carrega em ≤ 2 s (p95) com o dataset de demonstração; agregações em ≤ 300 ms.
- [ ] Cada endpoint de agregação tem teste unitário com dataset semeado →
  resultado esperado.

## 3. Biblioteca de gráficos — decisão

**Recomendação: [Apache ECharts](https://echarts.apache.org)** via
`echarts-for-react`. Justificativa:

| Requisito     | ECharts | Recharts | Nivo | Metabase/Superset (embed) |
| ------------- | :-----: | :------: | :--: | :-----------------------: |
| Gauge         |   ✅    |    ❌    |  ~   |            ✅             |
| Sankey        |   ✅    |    ❌    |  ✅  |            ~              |
| Coluna/Pizza  |   ✅    |    ✅    |  ✅  |            ✅             |
| Timeline/linha|   ✅    |    ✅    |  ✅  |            ✅             |
| Heatmap       |   ✅    |    ~    |  ✅  |            ✅             |
| Tempo real / streaming | ✅ | ~ |  ~   |            ~              |
| Licença       | MIT     | MIT      | MIT  | AGPL/complexo p/ embed    |

ECharts cobre **todos** os tipos pedidos numa única lib performática (canvas),
com tema escuro casando com o app. Alternativa "comprar": embutir **Metabase**
(mais rápido de subir dashboards ad-hoc, porém menos integrado ao nosso auth,
tema e tempo real). *Recomendo ECharts custom.*

## 4. Catálogo de visões (o que vai no painel)

| Visão | Tipo de gráfico | Dado |
| ----- | --------------- | ---- |
| Faturamento vs meta | **Gauge** | vendas do período / meta |
| Taxa de ruptura da rede | **Gauge** | % SKUs com saldo ≤ mínimo |
| Giro médio / cobertura (dias) | **Gauge** | reuso do relatório de giro |
| Vendas por loja | **Coluna** | soma por filial |
| Vendas por categoria/marca | **Coluna empilhada** | soma por categoria |
| Mix de categorias | **Pizza/Donut** | participação por categoria |
| Formas de pagamento | **Pizza** | participação por meio de pagamento |
| **Fluxo de transferências entre lojas** | **Sankey** | origem → destino (qtd) |
| Fluxo de estoque | **Sankey** | entradas → loja → saídas/vendas |
| Evolução de vendas | **Timeline/linha** | série diária no período |
| Entradas × saídas de estoque | **Linha dupla** | movimentações no tempo |
| Vendas por dia da semana × hora | **Heatmap** | concentração temporal |
| Curva ABC | **Coluna + linha de Pareto** | reuso do relatório ABC |
| Top produtos / rupturas | **Tabelas** | listas priorizadas |

## 5. Arquitetura

### 5.1 Backend — namespace `/api/bi/*`
Novos endpoints de **agregação** (leitura), todos com `requireAuth` e escopo
por papel:

- `GET /api/bi/kpis` — cartões/gauges (faturamento, meta, ruptura, giro, ticket).
- `GET /api/bi/sales-timeseries?granularity=day|week` — série temporal.
- `GET /api/bi/sales-by-dimension?by=store|category|brand|payment` — colunas/pizza.
- `GET /api/bi/transfer-flow` — nós/links para o Sankey de transferências.
- `GET /api/bi/stock-flow` — Sankey de entradas→loja→saídas.
- `GET /api/bi/heatmap?metric=sales` — matriz dia×hora.
- `GET /api/bi/abc` e `/turnover` — reaproveitam `reports.service`.

Padrão de resposta já pronto para o ECharts (ex.: `{ nodes, links }` para
Sankey; `{ categories, series }` para colunas), minimizando transformação no cliente.

### 5.2 Tempo real — canal SSE
- `GET /api/stream` (SSE) emite eventos `movement.*`, `sync.completed`,
  `tryon.*`. O frontend, ao receber, **invalida as queries** do React Query
  afetadas (refetch dirigido). Simples, unidirecional, sem infra de WebSocket.
- Um `EventBus` interno (Node `EventEmitter`) é publicado por
  `movements.service`, `syncService` e (fase 2) pelo módulo de AR.
- Fallback: `refetchInterval` do React Query (ex.: 30 s) quando o SSE cair.

### 5.3 Performance e frescor
- **MVP:** agregação on-the-fly com os índices já existentes (`saleDate`,
  `storeId`, `category`); paginação e limites por visão.
- **Escala:** *materialized views* (ex.: `mv_sales_daily`, `mv_stock_position`)
  atualizadas no fim de cada sync e por *debounce* após movimentações; cache
  em memória (TTL curto) para KPIs. Introduzir só quando medirmos gargalo.

## 6. Plano incremental (Qodo)

**BI-1 · Fundação de agregação**
- Escopo: `/api/bi/kpis`, `/sales-timeseries`, `/sales-by-dimension`.
- Testes: unit por agregação (dataset semeado → números esperados); contrato dos endpoints.
- Aceite: valores batem com consultas manuais; escopo por papel aplicado.
- Revisão: correção das somas, índices usados, N+1 ausente.

**BI-2 · Canal SSE + refetch dirigido**
- Escopo: `EventBus`, `GET /api/stream`, hook `useLiveInvalidation` no web.
- Testes: unit do EventBus; E2E (Playwright) — criar movimentação → painel
  reflete em ≤ 3 s sem reload.
- Revisão: segurança do SSE (auth via token), reconexão, vazamento de listeners.

**BI-3 · Camada visual (ECharts)**
- Escopo: componentes `KpiGauge`, `BarChart`, `PieChart`, `TimeSeries`,
  `Heatmap`, `SankeyChart`; página `/bi`.
- Testes: unit dos *transformers* (dados API → option ECharts); snapshot das options.
- Aceite: todos os tipos pedidos renderizam com o tema escuro; responsivo.

**BI-4 · Sankey de fluxos + filtros globais**
- Escopo: `/transfer-flow`, `/stock-flow`, barra de filtros (período/loja/cat/marca).
- Testes: unit dos construtores de `{nodes, links}` (sem ciclos/duplicatas).

**BI-5 · Hardening & performance**
- Escopo: materialized views + cache; export CSV/PNG; budget de performance.
- Testes: benchmark de agregação (< 300 ms); teste de carga leve.

## 7. Riscos e mitigação
- **Frescor de vendas (1×/dia):** mitigado exibindo o timestamp da fonte e
  separando métricas "ao vivo" (estoque/movimentos) de "diárias" (vendas ERP).
- **Custo de agregação:** começar simples, medir, então materializar.
- **SSE atrás de proxy:** manter fallback de polling; heartbeat no stream.

## 8. Definição de pronto (DoD)
Testes verdes (unit+E2E), cobertura das agregações, revisão aprovada, sem
regressão de performance, timestamps visíveis, escopo por papel validado.
