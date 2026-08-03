# Onda 4 — Regressão visual das 17 rotas, nos dois temas

Frente: **regressão visual**. Data: 31/07/2026.
Build auditado: `a51e263` (Onda 3), `VITE_DEMO=1 VITE_HASH_ROUTER=1`, servido de `apps/web/dist`.

## Como foi medido

- Chromium `/opt/pw-browsers/chromium-1194`, Playwright `playwright-core` do `/opt/node22`.
- Viewport **1440×940, DPR 2**, `locale: pt-BR`, `timezone: America/Sao_Paulo`.
- Tema semeado em `localStorage['novaotica.tema']` **antes** do primeiro render, e
  `page.reload()` a cada rota — sem isso a navegação por hash é *same-document* e a
  tela seguinte herda o `scrollTop` da anterior (ver R-15, que é exatamente esse defeito).
- Dois estados por rota e por tema: **topo** (dock expandido) e **rolado** (`.main.scrollTop = scrollHeight`).
  Em oito rotas altas há ainda capturas de faixa intermediária (`-meio<N>.png`).
- 91 PNGs em `/home/user/nova_otica/docs/marca/telas/v4/`.
- Contraste calculado no DOM (WCAG 2.1, fundo efetivo obtido compondo toda a pilha de
  `background-color` até a raiz); cores de gráfico amostradas pixel a pixel nos PNGs.
- **Nada aqui é inferido do código.** Cada linha da tabela tem um número que veio de
  `getBoundingClientRect`, `getComputedStyle`, `getImageData` ou da leitura direta da imagem.

## Placar

| | |
|---|---|
| Rotas capturadas | 17 de 17, nos 2 temas, em 2 estados |
| Erros de console / `pageerror` | **0** em todas as 34 combinações |
| Reprovações abertas | **31** |
| Reprovações só do tema escuro | 3 (R-01, R-02, R-03) |
| Regressões contra as ondas 1–3 | **0 confirmadas** (ver §Regressão) |
| Contraste reprovado no tema claro | 0 |
| Contraste reprovado no tema escuro | 5 ocorrências / 3 seletores distintos |

---

## Tabela de reprovações

Ordenadas por gravidade. `PNG` é relativo a `docs/marca/telas/v4/`.

### R-01 · Número invisível no card de ação (escuro) — GRAVE
- **Rota**: `/#/admin/planejamento` · **Tema**: escuro
- **Seletor**: `.grid.grid-4.action-center > button.card.action-card.red > div.action-count`
- **O que a imagem mostra**: o card "RISCO DE RUPTURA" tem o número `35` praticamente
  invisível; lê-se o rótulo e a legenda, não o valor — que é o único dado do card.
- **Medida**: `rgb(110,28,14)` sobre `rgb(23,20,15)` = **1,61:1**. Mínimo 3:1 (28px). Falta 46%.
- **PNG**: `planejamento-escuro-topo.png`

### R-02 · Segundo número invisível no mesmo bloco (escuro) — GRAVE
- **Rota**: `/#/admin/planejamento` · **Tema**: escuro
- **Seletor**: `.action-card.green > div.action-count` ("PEDIDOS A FAZER 35")
- **Medida**: `rgb(72,100,65)` sobre `rgb(23,20,15)` = **2,78:1**. Mínimo 3:1.
- **Observação**: os dois cards vizinhos ("282" e "404", em ouro) estão legíveis — ou seja,
  metade da fileira funciona e metade não, no mesmo componente.
- **PNG**: `planejamento-escuro-topo.png`

### R-03 · Badge verde abaixo do mínimo (escuro) — GRAVE
- **Rotas**: `/#/admin/estoque`, `/#/admin/lojas` · **Tema**: escuro
- **Seletor**: `tr > td > span.badge.green > span` ("Em estoque", "Ativa")
- **Medida**: `rgb(125,159,98)` sobre `rgb(57,57,31)` = **3,96:1**, texto de **10,5px/500**.
  Mínimo 4,5:1. Reprova em 5 ocorrências medidas (topo e rolado das duas rotas).
- **PNG**: `estoque-escuro-topo.png`, `lojas-escuro-topo.png`

### R-04 · Gráficos fora da paleta NANOFLOW — GRAVE
- **Rota**: `/#/admin/bi` · **Ambos os temas**
- **Seletores**: card "Receita por categoria" (barras), card "Provador virtual (AR) —
  produtos mais provados" (barras), Sankey "Fluxo de vendas — Categoria → Loja".
- **Medida (amostragem de pixel)**:
  - barras de categoria: escuro `rgb(137,74,151)` = `#894A97`; claro `rgb(132,50,150)` = `#843296` — **roxo**
  - barras do provador: escuro `rgb(51,155,201)` = `#339BC9`; claro `rgb(2,137,184)` = `#0289B8` — **azul**
  - nós do Sankey: azul, roxo e turquesa na mesma faixa
- **Por que reprova**: a Onda 1 declarou "gráficos re-codificados" no vocabulário da marca
  (ouro, osso, ônix, verde, vermelho). Roxo, azul e turquesa não existem no manual.
  São três gráficos ainda na paleta categórica padrão da biblioteca.
- **PNG**: `bi-escuro-rolado.png`, `bi-claro-rolado.png`, `bi-escuro-meio900.png`

### R-05 · Separador decimal em ponto, em pt-BR — GRAVE
- **Rotas**: `/#/admin/bi`, `/#/admin/relatorios`, `/#/admin/decisoes`,
  `/#/admin/estrategia`, `/#/admin/planejamento` · **Ambos os temas**
- **Medida (texto lido do DOM)**: `33.33%`, `1.6%`, `1.4%`, `3.1%`, `4.3%`, `5.4%`, `6.4%`,
  `58.62%`, `56.07%`, `147.8%`, `54.9%` — **11 amostras em 5 telas**.
- **A prova mais dura**: no card "Provador virtual" o KPI diz **`33.33%`** e o medidor
  logo abaixo, a ~300px, diz **`33,33%`**. O mesmo número, duas grafias, no mesmo card.
  E na mesma linha da tabela de Relatórios convivem `R$ 7.650,00` (vírgula) e `1.6%` (ponto).
- **PNG**: `bi-escuro-rolado.png`, `relatorios-escuro-topo.png`, `estrategia-escuro-topo.png`

### R-06 · Colunas espremidas em Estoque — GRAVE
- **Rota**: `/#/admin/estoque` · **Ambos os temas** · **Seletor**: `table > tbody > tr > td` (col. 2 e 3)
- **Medida**: `Marca` = **149px**, `Loja` = **109px**; as células quebram em **7 linhas**
  ("LUXOTTICA / BRASIL / PRODUTOS / OTICOS E / ESPORTIVOS / LTDA" e "A / GRACIOSA / NATAL / SHOP").
  Altura de linha resultante: **140px** (linhas 1, 5, 8) e 101px nas demais.
  No mesmo cabeçalho, `Ajuste` = **75px** e `Reservado` = **98px** contêm um único "—".
- **Consequência medida**: cabem ~6 linhas por viewport numa tabela de 200 linhas;
  `.main.scrollHeight` = **22.399px** (26 telas).
- **PNG**: `estoque-escuro-topo.png`, `estoque-claro-topo.png`

### R-07 · Badge que quebra dentro da própria pílula
- **Rota**: `/#/admin/estoque` · **Seletor**: `td .badge` ("Em estoque")
- **Medida**: pílula de **98×42px** com `line-height` 17px → **2,48 linhas**. Numa coluna
  `Situação` de 126px. O rótulo aparece como "EM / ESTOQUE" em duas linhas.
- **PNG**: `estoque-escuro-topo.png`

### R-08 · Duas colunas 100% vazias em Produtos
- **Rota**: `/#/admin/produtos` · **Seletor**: `thead th:nth-child(5)`, `:nth-child(6)`
- **Medida**: `Cor` (51px) e `Tam.` (59px) — **vazias em 501 de 501 linhas**.
  110px de largura reservados para nada, numa tabela que já espreme `Descrição`.
- **PNG**: `produtos-escuro-topo.png`

### R-09 · Duas colunas 100% vazias em Lojas
- **Rota**: `/#/admin/lojas` · **Seletor**: `thead th:nth-child(3)`, `:nth-child(4)`
- **Medida**: `Cidade` (106px) e `UF` (62px) — **vazias em 19 de 19 linhas**. 168px mortos.
- **PNG**: `lojas-escuro-topo.png`

### R-10 · Placeholder cortado no meio da palavra
- **Rota**: `/#/admin/produtos` · **Seletor**: `input[placeholder]` da busca
- **Medida**: o texto "Buscar por descrição, SKU ou marca…" mede **256px**; o espaço
  interno do campo é **236px** → **20px cortados**. Na tela lê-se "…SKU ou marc".
- **PNG**: `produtos-escuro-topo.png`

### R-11 · Card de gráfico vazio no Histórico
- **Rota**: `/#/admin/historico` · **Seletor**: `.card` de "Aprovações e recusas — últimos 30 dias"
- **Medida**: card de **1106×183px** contendo **0 elementos `<svg>`/`<canvas>` e 0 marcas**.
  O que a imagem mostra: título, legenda ("aprovados · recusados") e uma fileira de
  tracinhos cinza no rodapé. Nenhuma barra, nenhum eixo, nenhum rótulo.
- **PNG**: `historico-escuro-topo.png`, `historico-claro-topo.png`

### R-12 · Espaço morto grande em quatro telas
- **Medida** (`.main` bottom − bottom do último elemento visível, viewport útil = 861px):

| Rota | Espaço morto | % do viewport |
|---|---|---|
| `/#/admin/sincronizacao` | **493px** | 57% |
| `/#/admin/usuarios` | **453px** | 53% |
| `/#/admin/estrategia` | **255px** | 30% |
| `/#/admin/historico` | **244px** | 28% |

- Em Sincronização e Usuários mais da metade da janela é fundo liso, com a tabela
  encostada no topo. Em Estratégia o card da esquerda termina 130px antes do da direita.
- **PNG**: `sincronizacao-escuro-topo.png`, `usuarios-escuro-topo.png`,
  `estrategia-escuro-topo.png`, `historico-escuro-topo.png`

### R-13 · O dock tapa conteúdo em 12 das 15 rotas do console
- **Seletor**: `.dock` — **448×58px fixo em y=851**, opacidade 1, fundo sólido.
- **Medida**: elementos com texto sob o dock, por rota (topo, dock expandido):

| Rota | Nº de elementos cobertos | Pior caso |
|---|---|---|
| `/#/admin/decisoes` | 9 | `article.card > p.muted` "Margem estimada — falta…" (10×17px) |
| `/#/admin/vendas` | 6 | `td.num` "R$ 18.430,00" (245×7px) e "R$ 6.980,00" (245×43px) |
| `/#/admin` | 5 | `td.num` "176" (159×35px) e badge "11,2 meses·alta" (130×17px) |
| `/#/admin/relatorios` | 5 | `td > div` "TF3115 6189VS 56 OCULOS TIFFANY" (255×20px) |
| `/#/admin/estoque` | 4 | `td` "A GRACIOSA NATAL SHOP" (109×45px) |
| `/#/admin/produtos` | 4 | `td` "TECHNOS DA AMAZONIA IND. E COM. S/A" (341×36px) |
| `/#/admin/lojas` | 4 | `td` "A GRACIOSA MOSSORO CENTRO" (146×33px) |
| `/#/admin/transferencias` | 3 | `td.muted` **269×58px — a linha inteira, altura total do dock** |
| `/#/admin/alertas` | 2 | `td` "A GRACIOSA NATAL SHOP" (244×23px) |
| `/#/admin/planejamento` | 2 | `td` "ZEISS NATAL" (373×58px) |

- O dock ocupa **40% da largura útil** (448 de 1104px) e é opaco: o que fica embaixo
  desaparece, não fica translúcido.
- **PNG**: `transferencias-escuro-topo.png`, `vendas-escuro-topo.png`, `decisoes-escuro-topo.png`

### R-14 · Dock recolhido corta os ícones ao meio
- **Seletor**: `.dock.recolhido`
- **Medida**: faixa de **23px** exibindo ícones de **22px** posicionados no centro de um
  dock de 58px → sobra a metade superior de cada glifo. `transform: matrix(1,0,0,1,-224,0)`,
  `opacity: 1`.
- **O que a imagem mostra**: nove meios-ícones sem base, que lêem como falha de render.
- **PNG**: `admin-escuro-rolado.png`, `alertas-escuro-rolado.png`

### R-15 · A rolagem da tela anterior vaza para a tela seguinte — GRAVE
- **Rotas**: todas as 15 do console. **Seletor**: `main.main`
- **Reprodução medida**:
  - Estoque rolado a 6000px → clique em "Alertas" (barra lateral) → `main.scrollTop = 304`
    e o `<h1>` "Alertas de ruptura" fica em **y = −218px** (fora da tela, acima).
    A pessoa cai no meio de uma lista de 2176 linhas sem título nem filtros.
  - Qualquer tela rolada a 9000px → clique em "Decisões" **no dock** →
    `main.scrollTop = 9000`, **preservado exatamente**.
- **PNG**: `BUG-scroll-preservado-alertas.png` (cabeçalho da tabela cortado ao meio no
  topo da janela, dock recolhido, título da página ausente)

### R-16 · Nenhuma tabela tem cabeçalho fixo
- **Rotas**: as 10 do console que têm `<table>` · **Seletor**: `thead`
- **Medida**: `position: static` em **todas** (`top: auto`). Em Estoque o `.main` mede
  **22.399px**; em Produtos 24.140px; em Alertas 113.293px. Passa da segunda tela e
  ninguém mais sabe qual coluna é "Sincronizado", "Reservado" ou "Ajuste".
- **PNG**: `estoque-escuro-rolado.png`, `produtos-escuro-rolado.png`

### R-17 · Cards da mesma fileira desalinhados em Decisões
- **Rota**: `/#/admin/decisoes` · **Seletor**: `article.card > h3` ("Reduzir excesso e liberar capital")
- **Medida**: os três cards da primeira fileira começam em `y=438` e têm `height=758`
  (idênticos), mas o título fica em **y=491 / y=515 / y=491**. O card do meio, que tem
  um chip a mais ("Novo"), empurra o `#L7J.NT6` para uma segunda linha e desloca
  **todo o conteúdo em 24px** em relação aos vizinhos.
- **PNG**: `decisoes-escuro-topo.png`

### R-18 · Linha de tabela com 92% de altura morta
- **Rota**: `/#/admin/planejamento` · **Seletor**: `table:nth-of-type(1) > tbody > tr`
- **Medida**: altura da linha **225px**. Conteúdo real por célula:

| Coluna | Largura | Conteúdo | Morto | % morto |
|---|---|---|---|---|
| Qtde | 59px | 19px | **206px** | 92% |
| De → para | 420px | 120px | 105px | 47% |
| Ação | 211px | 126px | 99px | 44% |
| Cobertura no destino | 115px | 130px | 95px | 42% |
| Produto · por quê | 262px | 213px | 12px | 5% |

- A causa está na primeira coluna: ela repete **a mesma justificativa duas vezes**
  ("Vende em X (0 dias de cobertura) e está parado em Y (1 un. sem venda no período)."
  seguido de "Está parado em Y e vende em X — melhor mandar pra onde gira…"), em 262px,
  o que gera 9 linhas de texto e estica as outras quatro colunas junto.
- **PNG**: `planejamento-escuro-meio2400.png`

### R-19 · Quarto card de ação fora da linha de base
- **Rota**: `/#/admin/planejamento` · **Ambos os temas** · **Seletor**: `.action-card .action-count`
- **Medida**: os quatro cards começam em `y=311` com `height=131`, mas os números ficam em
  **y=351, 351, 351, 360**. O quarto está **9px abaixo** porque tem legenda de uma linha e
  os outros de duas — o conteúdo é centrado verticalmente em vez de alinhado ao topo.
- **PNG**: `planejamento-escuro-topo.png`, `planejamento-claro-topo.png`

### R-20 · A vitrine é uma grade de 24 placeholders idênticos
- **Rota**: `/#/loja` · **Ambos os temas** · **Seletor**: `article > div > svg`
- **Medida**: **24 cards, 0 imagens reais** (`article img` = 0). Caixa de imagem = **120px**
  de um card de **332px** = **36% do card** ocupado pelo mesmo desenho de óculos, 24 vezes.
- É a única tela que o consumidor final vê.
- **PNG**: `loja-escuro-topo.png`, `loja-claro-topo.png`

### R-21 · A marca é desenhada de dois jeitos diferentes nas duas cascas
- **Rotas**: console (`/#/admin*`) vs. vitrine (`/#/loja*`) · **Seletor**: `.brand`

| | Console | Vitrine |
|---|---|---|
| `display` | `block` | `flex` com `gap: 10px` |
| Folga entre "Nova" e "Ótica" | **0px** | **10px** |
| Cor de "Nova" | `rgb(42,36,22)` | `rgb(116,87,15)` |
| Cor de "Ótica" | `rgb(116,87,15)` | `rgb(116,87,15)` |
| Resultado na tela | **NovaÓtica** (bicolor, ligada) | **Nova Ótica** (monocolor, partida) |

- O `gap: 10px`, posto para separar o símbolo do texto, também separa as duas palavras,
  porque elas são dois filhos do mesmo flex container.
- **PNG**: `loja-escuro-topo.png` vs. `admin-escuro-topo.png`

### R-22 · Inteiros sem separador de milhar, ao lado de inteiros com separador
- **Rotas**: `/#/admin`, `/#/admin/alertas` · **Ambos os temas**
- **Medida**: no Dashboard, `PRODUTOS` = **`21683`** ao lado de `UNIDADES EM ESTOQUE` =
  **`40.563`** — dois cards vizinhos, duas regras. Em Alertas: `2176`, `314`, `1862`,
  todos crus, enquanto a mesma tela escreve `R$ 27.310,00`.
- **PNG**: `admin-escuro-topo.png`, `alertas-escuro-topo.png`

### R-23 · Rótulos de eixo truncados nos gráficos do BI
- **Rota**: `/#/admin/bi` · **Ambos os temas**
- **Medida (leitura da imagem)**: no heatmap "Vendas por dia da semana", **6 dos 19**
  nomes de loja saem com reticências — "A GRACIOSA MOSSORO …", "OTICALLI PRAIA SHOP…",
  "GRAND OPTICAL PETRO…", "GRAND OPTICAL NATAL…", "A GRACIOSA AFONSO P…",
  "A GRACIOSA NATAL SH…". Em "Produtos mais provados", **5 de 5** SKUs truncados
  ("RY1603L 3857 49 ARMAC…"). No Sankey, "Origem: A GRACIOSA …" / "Destino: A GRACIOSA…".
- **PNG**: `bi-escuro-rolado.png`, `bi-escuro-meio900.png`

### R-24 · Ranking em que a maior barra fica por último e em cinza
- **Rota**: `/#/admin/bi` · **Seletor**: cards "Vendas por loja" e "Formas de pagamento"
- **Medida**: em "Vendas por loja" a barra do topo é `R$ 210,0 mil` e a última,
  "OUTROS (14 CATEGORIAS)", é **`R$ 236,0 mil`** — 12,5% maior que a primeira, desenhada
  em cinza e colocada no fim. O gráfico é ordenado, e a maior barra está fora da ordem.
  Mesmo padrão em "Formas de pagamento" (`R$ 140,0 mil` de "OUTROS" contra `R$ 28 mil` do
  último item nomeado).
- **PNG**: `bi-escuro-meio900.png`

### R-25 · Campos de data em formato americano
- **Rota**: `/#/admin/vendas` · **Ambos os temas** · **Seletor**: `input[type=date]`
- **Medida**: os dois campos ("DE" e "ATÉ") exibem o placeholder **`mm/dd/yyyy`** num
  contexto `locale: pt-BR`. O padrão da rede é dd/mm/aaaa (a própria tela escreve
  "31/07/2026" em outros lugares).
- **PNG**: `vendas-escuro-topo.png`

### R-26 · Traço órfão onde falta a marca
- **Rota**: `/#/admin/transferencias` · **Seletor**: `tbody > tr > td > div.muted`
- **O que a imagem mostra**: nas linhas 1 e 2 aparece um "—" sozinho numa terceira linha
  abaixo do nome do produto, onde nas linhas 3+ aparece o fornecedor. O placeholder cria
  uma linha fantasma de altura cheia e desalinha as duas primeiras linhas das demais.
- **Também nesta tela**: o botão "Criar movimentação" quebra em duas linhas na coluna de
  180px, com o ícone centrado contra um rótulo de dois níveis.
- **PNG**: `transferencias-escuro-topo.png`

### R-27 · Estado vazio do carrinho encostado no topo
- **Rota**: `/#/loja/carrinho` · **Ambos os temas**
- **Medida**: o bloco "Seu carrinho está vazio. / Ver os óculos" termina em ~y=300 numa
  janela de 940px → **≈640px de página vazia** abaixo. O estado vazio não é centrado
  vertical nem horizontalmente em relação à área útil.
- **PNG**: `carrinho-escuro-topo.png`, `carrinho-claro-topo.png`

### R-28 · Três telas renderizam o dataset inteiro de uma vez
- **Medida** (`.main.scrollHeight ÷ clientHeight` e contagem de nós):

| Rota | Altura | Telas | `tbody tr` | `.card` | Nós em `.main` |
|---|---|---|---|---|---|
| `/#/admin/alertas` | 113.293px | **131,6** | 2.184 | 6 | **37.447** |
| `/#/admin/planejamento` | 94.688px | 110,0 | 583 | 16 | 20.848 |
| `/#/admin/decisoes` | 65.096px | 75,6 | 0 | 388 | 24.128 |
| `/#/admin/produtos` | 24.140px | 28,0 | 501 | 2 | 4.034 |
| `/#/admin/estoque` | 22.399px | 26,0 | 200 | 2 | — |

- Sem paginação, sem virtualização e (R-16) sem cabeçalho fixo.

### R-29 · Fim de grade com dois terços da fileira vazios
- **Rota**: `/#/admin/decisoes` · **Seletor**: `.grid.grid-3`
- **Medida**: a última fileira tem 1 card de 3 → sobram **2 colunas × ~990px** de fundo
  liso no pé de uma página de 65.096px.
- **PNG**: `decisoes-escuro-rolado.png`

### R-30 · Expressão cron na face de display
- **Rota**: `/#/admin/sincronizacao` · **Seletor**: card "AGENDAMENTO"
- **O que a imagem mostra**: `0 6 * * *` composto na serifada de display a 28px com
  entreletra larga; os três asteriscos ficam altos, fora da linha de base dos dígitos, e
  o "06" abre em "0 6". Lê-se como dois números soltos e três sinais flutuando.
- **PNG**: `sincronizacao-escuro-topo.png`

### R-31 · Nome de eixo colidindo com o primeiro rótulo
- **Rota**: `/#/admin/bi` · **Seletor**: gráfico "Faturamento diário"
- **O que a imagem mostra**: um `R$` solto imediatamente acima e à direita de
  `R$ 250 mil`, sobrepondo a marca do primeiro tick do eixo Y.
- **PNG**: `bi-escuro-topo.png`, `bi-claro-topo.png`

---

## O que passou (medido, não presumido)

- **Tema escuro cobre a janela inteira.** Amostragem de pixel nos quatro cantos de
  `admin-escuro-topo.png`: `(3,3) = rgb(12,10,7)`, `(8,940) = rgb(10,9,6)`,
  `(2870,1870) = rgb(11,9,7)`. Nenhum halo claro na borda, apesar de o `body` continuar
  em `rgb(246,242,233)` — a `.macos-desktop` cobre tudo.
- **DemoBadge acompanha o tema nas duas cascas.** Claro: fundo `rgb(246,242,233)`,
  texto `rgb(42,36,22)`. Escuro: fundo `rgb(13,11,8)`, texto `rgb(246,242,233)`. Idêntico
  em `/#/admin` e em `/#/loja`. Caixa de 270×28px em (14, 898), `z-index: 60`, e a
  varredura de interseção acusou **0 elementos cobertos** em ambas as rotas.
- **A vitrine herda o tema.** `/#/loja` e `/#/loja/carrinho` escrevem `data-tema="escuro"`
  no `<html>`; `body` vai a `rgb(13,11,8)`. As três rotas da loja respondem à chave
  `novaotica.tema` gravada pelo console.
- **Contraste no tema claro: nenhuma reprovação** em nenhuma das 17 rotas, nos dois
  estados (topo e rolado). O escuro reprova em 3 seletores (R-01, R-02, R-03).
- **Medidores do BI não reprovam.** A impressão de que o arco escuro "parece cheio" não se
  confirma: preenchimento vs. trilho mede **5,78:1** (Taxa de ruptura) e **7,91:1** (Giro)
  no escuro, contra 5,62:1 e 5,08:1 no claro. O trilho contra o fundo do card fica em
  1,29:1 nos dois temas — sutil por escolha, não por falha.
- **Zero erro de console e zero `pageerror`** nas 34 combinações rota × tema.
- **Sem estouro horizontal**: `documentElement.scrollWidth == clientWidth` em todas as
  rotas; `main.scrollWidth == main.clientWidth` (1162px) em todas as 15 do console.

---

## Regressão contra as ondas 1–3

**Nada piorou.** Comparei as capturas novas com o "antes" de `docs/marca/telas/`:

| Antes | Depois | Veredito |
|---|---|---|
| `12-dashboard-escuro.png` | `admin-escuro-topo.png` | igual — `21683` cru e dock sobre as linhas 3–4 já estavam lá |
| `14-estoque-escuro.png` | `estoque-escuro-topo.png` | igual — Marca/Loja já quebravam em 6–7 linhas |
| `13-bi-escuro.png` | `bi-escuro-topo.png` | igual — o `R$` órfão sobre `R$ 250 mil` já estava lá |
| `26-dock-recolhido.png` | `admin-escuro-rolado.png` | igual — os ícones já saíam cortados ao meio |
| `09-planejamento.png` | `planejamento-claro-topo.png` | igual — o 4º card já ficava 9px abaixo |
| `11-loja.png` | `loja-claro-topo.png` | igual — "Nova Ótica" já saía partida e com 24 placeholders |

Ressalva honesta: o conjunto anterior tinha **4 capturas escuras** (dashboard, BI, estoque,
loja) num viewport de 1440×1000 em DPR 1. R-01, R-02 e R-03 estão em telas que **nunca
foram capturadas no escuro** antes — não são regressões, são defeitos que ninguém tinha
olhado. R-04, R-05, R-11, R-15, R-18 e R-23 estão em faixas de rolagem que o conjunto
anterior não alcançava.

---

## Índice das capturas

`docs/marca/telas/v4/` — 91 arquivos, 33 MB.

- `<rota>-<tema>-topo.png` — 34 arquivos (17 rotas × 2 temas), dock expandido.
- `<rota>-<tema>-rolado.png` — 34 arquivos, `.main` no fim.
- `<rota>-<tema>-meio<N>.png` — 22 arquivos, faixas intermediárias de bi, decisoes,
  planejamento, relatorios, estoque, vendas, transferencias e loja.
- `BUG-scroll-preservado-alertas.png` — prova de R-15.

Rotas cobertas: `admin`, `bi`, `estoque`, `produtos`, `transferencias`, `alertas`,
`relatorios`, `decisoes`, `historico`, `estrategia`, `planejamento`, `vendas`, `usuarios`,
`lojas`, `sincronizacao`, `loja`, `carrinho`.
