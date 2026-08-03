# Auditoria de LARGURA e PESO — console Nova Ótica (NANOFLOW)

**Frente:** largura e peso. **Regra:** medir, não presumir.

## Como foi medido

- Build de produção real (`npm run build -w @nova-otica/web`, `VITE_DEMO=1 VITE_HASH_ROUTER=1 VITE_BASE=./`), servido por HTTP estático a partir de `apps/web/dist`, **sem compressão no transporte** (os números de gzip abaixo foram calculados à parte).
- Chromium 1194 headless, `deviceScaleFactor: 1`, sem estrangulamento de CPU nem de rede. **Esta máquina é rápida:** todo tempo relatado é um piso otimista; em um terminal de loja os mesmos números crescem por um fator de 4 a 6.
- Playwright injeta uma sonda que lê caixas reais (`getBoundingClientRect`), `scrollWidth/clientWidth`, `PerformanceObserver` (`longtask`, `paint`, `largest-contentful-paint`, `layout-shift`) e contadores de motor via CDP `Performance.getMetrics`.
- Cada rota só é medida **depois que a contagem de nós do DOM para de mudar** (3 leituras iguais a 150 ms de intervalo). Nada foi medido a meio-carregamento.
- Sessão autenticada uma vez (`galbe@novaotica.com`) e reaproveitada por `storageState`.

### Correção de método que muda o que já foi dito antes

As rotas do briefing (`/#/estoque`, `/#/bi`, …) **não existem**. O `App.tsx` aninha tudo sob `/admin` (`<Route path="/admin"><Route path="estoque"/>…`), e a rota curinga `<Route path="*" element={<Navigate to="/" replace />}/>` manda qualquer caminho desconhecido para o Launcher **sem erro visível**. Uma primeira execução desta auditoria mediu o Launcher 16 vezes achando que media 16 telas. Os endereços corretos são `/#/admin/estoque`, `/#/admin/bi`, etc. Quem tiver relatado medições nessas URLs curtas mediu a tela errada.

## 1. Rolagem horizontal da página

`documentElement.scrollWidth − clientWidth`, em px, nas 6 larguras × 17 rotas.

| rota | 1920 | 1440 | 1280 | 1180 | 1024 | 768 |
|---|---:|---:|---:|---:|---:|---:|
| admin | 0 | 0 | 0 | 0 | 0 | 0 |
| bi | 0 | 0 | 0 | 0 | 0 | 0 |
| estoque | 0 | 0 | 0 | 0 | 0 | 0 |
| produtos | 0 | 0 | 0 | 0 | 0 | 0 |
| transferencias | 0 | 0 | 0 | 0 | 0 | 0 |
| alertas | 0 | 0 | 0 | 0 | 0 | 0 |
| relatorios | 0 | 0 | 0 | 0 | 0 | 0 |
| decisoes | 0 | 0 | 0 | 0 | 0 | 0 |
| historico | 0 | 0 | 0 | 0 | 0 | 0 |
| estrategia | 0 | 0 | 0 | 0 | 0 | 0 |
| planejamento | 0 | 0 | 0 | 0 | 0 | 0 |
| vendas | 0 | 0 | 0 | 0 | 0 | 0 |
| usuarios | 0 | 0 | 0 | 0 | 0 | 0 |
| lojas | 0 | 0 | 0 | 0 | 0 | 0 |
| sincronizacao | 0 | 0 | 0 | 0 | 0 | 0 |
| loja | 0 | 0 | 0 | 0 | 0 | 0 |
| loja-carrinho | 0 | 0 | 0 | 0 | 0 | 0 |

**Resultado: 0 em 102 medições.** A página nunca ganha barra horizontal, porque `.macos-window` tem `overflow: hidden` e `.main` tem `overflow: auto`. Isso passa no teste literal — e é justamente o que esconde os defeitos das seções 2 e 3: em vez de transbordar de forma visível, o console **corta** ou **rola o corpo inteiro de lado**.

## 2. Titlebar

### 2.1 O que a barra carrega, e por que ela não cabe

`.titlebar` (`styles.css:417`) é `display:flex`, `height:44px` **fixa**, sem `flex-wrap`, `gap:18px`, `padding:0 18px`. Três filhos diretos:

1. `span.title` — nome da tela, `white-space:nowrap` inline, **não encolhe**;
2. `div` do `<ScopePicker>` — `RECORTE` + grupo `.segmented` de 3 chips, com `minWidth: 0` e **sem `flex:none`** → é o único item elástico da barra;
3. `div` do grupo direito — "Dados ao vivo" + botão de tema, ambos `nowrap`, com `flex: none` → **não encolhe**.

**Não existe uma única `@media` para `.titlebar` em todo o `styles.css`.** As media queries do arquivo são `min-width:1120px` (`.macos-desktop`), `max-width:1100px` (`.grid-4`), `max-width:720px` (casca, `.dock`, `.demo-seal`) e `max-width:640px` (`.tiles`). A faixa de 721 px a 1099 px — que inclui iPad retrato (768) e netbooks (1024) — **não tem nenhuma regra de casca**.

Largura intrínseca da barra por rota, medida por clone `width:max-content` fora do fluxo:

| rota | barra (intrínseca) | sidebar | viewport mínima para caber |
|---|---:|---:|---:|
| planejamento | 927.2 px | 244 px | **1172 px** |
| estrategia | 910.8 px | 244 px | **1155 px** |
| decisoes | 878.1 px | 244 px | **1123 px** |
| historico | 869.9 px | 244 px | **1114 px** |
| transferencias | 861.7 px | 244 px | **1106 px** |
| sincronizacao | 853.5 px | 244 px | **1098 px** |
| relatorios | 828.9 px | 244 px | **1073 px** |
| admin | 820.8 px | 244 px | **1065 px** |
| produtos | 812.6 px | 244 px | **1057 px** |
| usuarios | 812.6 px | 244 px | **1057 px** |
| estoque | 804.4 px | 244 px | **1049 px** |
| alertas | 804.4 px | 244 px | **1049 px** |
| vendas | 796.2 px | 244 px | **1041 px** |
| lojas | 788.0 px | 244 px | **1032 px** |
| bi | 763.4 px | 244 px | **1008 px** |

Composição da pior rota (`planejamento`, 927,2 px intrínsecos):

| peça | largura intrínseca |
|---|---:|
| `Planejamento & Compras` | 180.2 px |
| `RecorteÓculos e relógiosLentesTudo` | 414.2 px |
| `Dados ao vivoTema escuro` | 260.8 px |
| 2 × gap 18 px + padding 18+18 | 72,0 px |
| **total** | **927,2 px** |

Some a sidebar fixa de 244 px e a barra do Planejamento exige **1 172 px de viewport** só para os controles caberem lado a lado. O console é entregue com 15 telas cuja barra superior precisa de 1 008 a 1 172 px.

### 2.2 O que realmente acontece: o RECORTE é esmagado, não transbordado

Como o `ScopePicker` é o único filho elástico, o flexbox resolve a falta de espaço encolhendo **só ele**. Medida da largura real do grupo `.segmented` (intrínseca = 349,6 px) em 11 larguras:

| rota | 1920 | 1440 | 1280 | 1180 | 1150 | 1100 | 1024 | 900 | 860 | 800 | 768 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| admin | 350 | 350 | 350 | 350 | 350 | 350 | **309** | **185** | **145** | **85** | **53** |
| bi | 350 | 350 | 350 | 350 | 350 | 350 | 350 | **242** | **202** | **142** | **110** |
| estoque | 350 | 350 | 350 | 350 | 350 | 350 | **325** | **201** | **161** | **101** | **69** |
| produtos | 350 | 350 | 350 | 350 | 350 | 350 | **317** | **193** | **153** | **93** | **61** |
| transferencias | 350 | 350 | 350 | 350 | 350 | 344 | **268** | **144** | **104** | **44** | **12** |
| alertas | 350 | 350 | 350 | 350 | 350 | 350 | **325** | **201** | **161** | **101** | **69** |
| relatorios | 350 | 350 | 350 | 350 | 350 | 350 | **301** | **177** | **137** | **77** | **45** |
| decisoes | 350 | 350 | 350 | 350 | 344 | **328** | **252** | **128** | **88** | **28** | **2** |
| historico | 350 | 350 | 350 | 350 | 350 | **336** | **260** | **136** | **96** | **36** | **4** |
| estrategia | 350 | 350 | 350 | 341 | **311** | **295** | **219** | **95** | **55** | **2** | **2** |
| planejamento | 350 | 350 | 350 | **324** | **294** | **278** | **202** | **78** | **38** | **2** | **2** |
| vendas | 350 | 350 | 350 | 350 | 350 | 350 | **334** | **210** | **170** | **110** | **78** |
| usuarios | 350 | 350 | 350 | 350 | 350 | 350 | **317** | **193** | **153** | **93** | **61** |
| lojas | 350 | 350 | 350 | 350 | 350 | 350 | 342 | **218** | **178** | **118** | **86** |
| sincronizacao | 350 | 350 | 350 | 350 | 350 | 350 | **276** | **152** | **112** | **52** | **20** |

### 2.3 Consequência funcional: o RECORTE perde opções

Não é só estética. Medida da **fração visível** de cada chip (parcela que não está coberta pelo grupo direito, que é pintado depois, nem fora da barra), e do número de linhas de texto do chip ativo:

Chip 1 — "Óculos e relógios" — número de linhas de texto:

| rota | 1440 | 1280 | 1180 | 1100 | 1024 | 900 | 768 |
|---|---:|---:|---:|---:|---:|---:|---:|
| admin | 1 | 1 | 1 | 1 | **2** | **2** | **2** |
| bi | 1 | 1 | 1 | 1 | 1 | **2** | **2** |
| estoque | 1 | 1 | 1 | 1 | **2** | **2** | **2** |
| produtos | 1 | 1 | 1 | 1 | **2** | **2** | **2** |
| transferencias | 1 | 1 | 1 | **2** | **2** | **2** | **2** |
| alertas | 1 | 1 | 1 | 1 | **2** | **2** | **2** |
| relatorios | 1 | 1 | 1 | 1 | **2** | **2** | **2** |
| decisoes | 1 | 1 | 1 | **2** | **2** | **2** | **2** |
| historico | 1 | 1 | 1 | **2** | **2** | **2** | **2** |
| estrategia | 1 | 1 | **2** | **2** | **2** | **2** | **2** |
| planejamento | 1 | 1 | **2** | **2** | **2** | **2** | **2** |
| vendas | 1 | 1 | 1 | 1 | **2** | **2** | **2** |
| usuarios | 1 | 1 | 1 | 1 | **2** | **2** | **2** |
| sincronizacao | 1 | 1 | 1 | 1 | **2** | **2** | **2** |

Chip 3 — "Tudo" — % visível:

| rota | 1440 | 1280 | 1180 | 1100 | 1024 | 900 | 768 |
|---|---:|---:|---:|---:|---:|---:|---:|
| admin | 100 % | 100 % | 100 % | 100 % | 100 % | **1 %** | **0 %** |
| bi | 100 % | 100 % | 100 % | 100 % | 100 % | **76 %** | **0 %** |
| estoque | 100 % | 100 % | 100 % | 100 % | 100 % | **22 %** | **0 %** |
| produtos | 100 % | 100 % | 100 % | 100 % | 100 % | **12 %** | **0 %** |
| transferencias | 100 % | 100 % | 100 % | 100 % | 100 % | **0 %** | **0 %** |
| alertas | 100 % | 100 % | 100 % | 100 % | 100 % | **22 %** | **0 %** |
| relatorios | 100 % | 100 % | 100 % | 100 % | 100 % | **0 %** | **0 %** |
| decisoes | 100 % | 100 % | 100 % | 100 % | **88 %** | **0 %** | **0 %** |
| historico | 100 % | 100 % | 100 % | 100 % | **99 %** | **0 %** | **0 %** |
| estrategia | 100 % | 100 % | 100 % | 100 % | **45 %** | **0 %** | **0 %** |
| planejamento | 100 % | 100 % | 100 % | 100 % | **24 %** | **0 %** | **0 %** |
| vendas | 100 % | 100 % | 100 % | 100 % | 100 % | **33 %** | **0 %** |
| usuarios | 100 % | 100 % | 100 % | 100 % | 100 % | **12 %** | **0 %** |
| sincronizacao | 100 % | 100 % | 100 % | 100 % | 100 % | **0 %** | **0 %** |

Chip 2 — "Lentes" — % visível:

| rota | 1440 | 1280 | 1180 | 1100 | 1024 | 900 | 768 |
|---|---:|---:|---:|---:|---:|---:|---:|
| admin | 100 % | 100 % | 100 % | 100 % | 100 % | 100 % | **0 %** |
| bi | 100 % | 100 % | 100 % | 100 % | 100 % | 100 % | **20 %** |
| estoque | 100 % | 100 % | 100 % | 100 % | 100 % | 100 % | **0 %** |
| produtos | 100 % | 100 % | 100 % | 100 % | 100 % | 100 % | **0 %** |
| transferencias | 100 % | 100 % | 100 % | 100 % | 100 % | **57 %** | **0 %** |
| alertas | 100 % | 100 % | 100 % | 100 % | 100 % | 100 % | **0 %** |
| relatorios | 100 % | 100 % | 100 % | 100 % | 100 % | **92 %** | **0 %** |
| decisoes | 100 % | 100 % | 100 % | 100 % | 100 % | **39 %** | **0 %** |
| historico | 100 % | 100 % | 100 % | 100 % | 100 % | **48 %** | **0 %** |
| estrategia | 100 % | 100 % | 100 % | 100 % | 100 % | **4 %** | **0 %** |
| planejamento | 100 % | 100 % | 100 % | 100 % | 100 % | **0 %** | **0 %** |
| vendas | 100 % | 100 % | 100 % | 100 % | 100 % | 100 % | **0 %** |
| usuarios | 100 % | 100 % | 100 % | 100 % | 100 % | 100 % | **0 %** |
| sincronizacao | 100 % | 100 % | 100 % | 100 % | 100 % | **65 %** | **0 %** |

Leitura:

- **A 1 180 px** o chip ativo já quebra em duas linhas em Planejamento e Estratégia; **a 1 024 px, em 13 das 14 telas administrativas**.
- **A 1 024 px** a opção "Tudo" começa a sumir: 24 % visível em Planejamento, 45 % em Estratégia, 88 % em Decisões.
- **A 900 px** "Tudo" está entre 0 % e 76 % visível em todas as telas, e "Lentes" já é encoberta em 6 delas.
- **A 768 px, em TODAS as 14 telas administrativas, "Tudo" tem 0 % de visibilidade e "Lentes" tem 0 % em 13 delas.** O seletor de recorte — o controle que define o universo de produtos de toda a sessão — fica reduzido à opção já selecionada, e mesmo essa impressa por cima de outros controles.

Isso é perda de função, não desalinho: abaixo de 900 px o operador **não consegue trocar o recorte**, porque os alvos de clique estão cobertos por outro grupo pintado depois. A evidência visual está em `docs/marca/auditoria/evidencia/titlebar-planejamento-{1440,1180,1080,1024,900,768}.png`; a 768 px a captura mostra o texto `RECORTE` impresso sobre `DADOS AO VIVO`.

### 2.4 Onde exatamente quebra (bisseção px a px entre 700 e 1920)

Três limiares, buscados por bisseção binária com o layout real:

- **compressão** — a maior largura de viewport em que os chips do RECORTE já perderam largura;
- **colisão** — a maior largura em que os chips passam a ser *pintados por cima* de "Dados ao vivo" / botão de tema (o `.segmented` encolhe a caixa, mas os `<button>` mantêm o tamanho mínimo do texto e vazam, com `overflow` visível);
- **fuga da barra** — a maior largura em que os chips são pintados fora da própria `.titlebar`.

| rota | compressão começa em ≤ | colisão com os controles da direita em ≤ | chips saem da barra em ≤ |
|---|---:|---:|---:|
| planejamento | **1204 px** | **1081 px** | **821 px** |
| estrategia | **1188 px** | **1065 px** | **804 px** |
| decisoes | **1155 px** | **1032 px** | **772 px** |
| historico | **1113 px** | **1024 px** | **763 px** |
| transferencias | **1105 px** | **1016 px** | **755 px** |
| sincronizacao | **1096 px** | **1008 px** | **747 px** |
| relatorios | **1072 px** | **983 px** | não ocorre |
| admin | **1064 px** | **975 px** | não ocorre |
| produtos | **1055 px** | **967 px** | não ocorre |
| usuarios | **1055 px** | **967 px** | não ocorre |
| estoque | **1047 px** | **959 px** | não ocorre |
| alertas | **1047 px** | **959 px** | não ocorre |
| vendas | **1039 px** | **950 px** | não ocorre |
| lojas | **1031 px** | **942 px** | não ocorre |
| bi | **1006 px** | **918 px** | não ocorre |

**O aviso anterior de "abaixo de ~900 px aperta" está errado nas duas pontas.** A compressão do RECORTE começa em **1 204 px** (Planejamento) — dentro de um MacBook de 13", acima da largura de projeto de alguns monitores — e a **sobreposição literal de texto sobre texto** começa em **1 081 px**, não em 900. Em 12 das 15 telas administrativas a colisão já ocorre a 1 024 px ou perto disso.

Prova concreta (`planejamento`, viewport 768 px):

| medida | valor |
|---|---:|
| caixa do `ScopePicker` | 11 px (precisa de 67 px) |
| grupo `.segmented` | **2 px** (precisa de 277 px) |
| largura somada dos 3 `<button>` pintados | 277.4 px |
| borda direita pintada dos chips | x = 803.2 |
| borda esquerda do grupo "Dados ao vivo" + tema | x = 489.2 |
| **sobreposição** | **314 px** — os chips cobrem o grupo direito inteiro (260,8 px de largura) |
| chips pintados fora da titlebar | 53.2 px |

Os três chips do RECORTE ficam desenhados por cima de "Dados ao vivo" e do botão de tema, e 53 px deles caem fora da barra — onde o `overflow:hidden` da janela os apaga. O controle que o próprio código descreve como "uma escolha por sessão, **sempre visível**" (`AdminShell.tsx:266`) é, a 768 px, uma caixa de 2 px cujo conteúdo é impresso sobre outros controles clicáveis.

## 3. Tabelas: quem rola, e o que rola junto

Só 6 dos 13 arquivos de página que contêm `<table>` embrulham a tabela em um contêiner com `overflowX:auto` (`Products`, `Reports`, `Sales`, `Stock`, `Stores` — 1 wrapper cada; `Stock` tem 2). `Alerts`, `Cart`, `Dashboard`, `History`, `Movements`, `Planning` (8 tabelas!), `Sync` e `Usuarios` **não têm nenhum**. Nessas, quem rola é o `.main` — ou seja, a página inteira desliza para o lado, arrastando cabeçalho, filtros e todos os outros cartões.

`.main.scrollWidth − .main.clientWidth`, em px:

| rota | 1920 | 1440 | 1280 | 1180 | 1024 | 768 |
|---|---:|---:|---:|---:|---:|---:|
| admin | 0 | 0 | 0 | 0 | 0 | 0 |
| bi | 0 | 0 | 0 | 0 | 0 | 0 |
| estoque | 0 | 0 | 0 | 0 | 0 | 0 |
| produtos | 0 | 0 | 0 | 0 | 0 | 0 |
| transferencias | 0 | 0 | 0 | **+74** | **+196** | **+452** |
| alertas | 0 | 0 | 0 | 0 | **+7** | **+263** |
| relatorios | 0 | 0 | 0 | 0 | 0 | **+116** |
| decisoes | 0 | 0 | 0 | 0 | 0 | **+243** |
| historico | 0 | 0 | 0 | 0 | 0 | 0 |
| estrategia | 0 | 0 | 0 | 0 | 0 | **+242** |
| planejamento | 0 | 0 | **+153** | **+253** | **+375** | **+631** |
| vendas | 0 | 0 | 0 | 0 | 0 | 0 |
| usuarios | 0 | 0 | 0 | 0 | **+71** | **+327** |
| lojas | 0 | 0 | 0 | 0 | 0 | 0 |
| sincronizacao | 0 | 0 | 0 | 0 | 0 | 0 |
| loja | — | — | — | — | — | — |
| loja-carrinho | — | — | — | — | — | — |

**Planejamento rola de lado já a 1 280 px** (+153 px) — uma largura de trabalho corriqueira. Transferências a 1 180 px (+74). Alertas, Decisões, Estratégia, Relatórios e Usuários a 1 024 ou 768.

Detalhe das tabelas que não cabem:

| rota | largura | tabela | exige | disponível | excesso | quem rola |
|---|---:|---|---:|---:|---:|---|
| estoque | 1280 | 9 col × 200 lin | 1024 px | 944 px | **+80** | cartão (contido) |
| estoque | 1180 | 9 col × 200 lin | 1024 px | 844 px | **+180** | cartão (contido) |
| estoque | 1024 | 9 col × 200 lin | 1024 px | 722 px | **+302** | cartão (contido) |
| estoque | 768 | 9 col × 200 lin | 1024 px | 466 px | **+558** | cartão (contido) |
| produtos | 768 | 7 col × 501 lin | 687 px | 466 px | **+221** | cartão (contido) |
| transferencias | 1180 | 8 col × 1 lin | 947 px | 902 px | **+45** | **`.main` — a página inteira desliza** |
| transferencias | 1024 | 8 col × 1 lin | 947 px | 780 px | **+167** | **`.main` — a página inteira desliza** |
| transferencias | 768 | 5 col × 30 lin | 547 px | 524 px | **+23** | **`.main` — a página inteira desliza** |
| transferencias | 768 | 8 col × 1 lin | 947 px | 524 px | **+423** | **`.main` — a página inteira desliza** |
| alertas | 768 | 6 col × 2176 lin | 758 px | 524 px | **+234** | **`.main` — a página inteira desliza** |
| relatorios | 768 | 6 col × 100 lin | 611 px | 524 px | **+87** | **`.main` — a página inteira desliza** |
| planejamento | 1280 | 10 col × 501 lin | 1126 px | 1002 px | **+124** | **`.main` — a página inteira desliza** |
| planejamento | 1180 | 5 col × 20 lin | 908 px | 902 px | **+6** | **`.main` — a página inteira desliza** |
| planejamento | 1180 | 10 col × 501 lin | 1126 px | 902 px | **+224** | **`.main` — a página inteira desliza** |
| planejamento | 1024 | 5 col × 20 lin | 908 px | 780 px | **+128** | **`.main` — a página inteira desliza** |
| planejamento | 1024 | 8 col × 30 lin | 833 px | 780 px | **+53** | **`.main` — a página inteira desliza** |
| planejamento | 1024 | 10 col × 501 lin | 1126 px | 780 px | **+346** | **`.main` — a página inteira desliza** |
| planejamento | 768 | 5 col × 20 lin | 908 px | 524 px | **+384** | **`.main` — a página inteira desliza** |
| planejamento | 768 | 8 col × 30 lin | 833 px | 524 px | **+309** | **`.main` — a página inteira desliza** |
| planejamento | 768 | 8 col × 4 lin | 763 px | 524 px | **+239** | **`.main` — a página inteira desliza** |
| planejamento | 768 | 8 col × 1 lin | 743 px | 524 px | **+219** | **`.main` — a página inteira desliza** |
| planejamento | 768 | 10 col × 501 lin | 1126 px | 524 px | **+602** | **`.main` — a página inteira desliza** |
| vendas | 768 | 7 col × 20 lin | 631 px | 466 px | **+165** | cartão (contido) |
| usuarios | 1024 | 7 col × 3 lin | 823 px | 780 px | **+43** | **`.main` — a página inteira desliza** |
| usuarios | 768 | 7 col × 3 lin | 823 px | 524 px | **+299** | **`.main` — a página inteira desliza** |
| lojas | 768 | 7 col × 19 lin | 567 px | 466 px | **+101** | cartão (contido) |

A tabela mais larga do console é a de Planejamento: **10 colunas exigindo 1 126 px**. Ela não cabe em 1 024 nem em 1 180, e a 1 280 já força o corpo da página a rolar. A de Estoque exige 1 024 px em 9 colunas — contida no cartão, portanto o comportamento correto, e a prova de que o wrapper resolve.

## 4. Selos e rótulos quebrando em duas linhas

Critério: a caixa é mais alta do que **uma** line-box da sua própria `line-height` computada **e** o elemento tem 2 ou mais baselines de texto distintas. (Contar `Range.getClientRects()` sozinho dá falso positivo: num `.badge` que é `inline-flex` com ícone, o `<svg>` e o texto geram rects separados na *mesma* linha. A primeira passagem desta auditoria caiu nisso e reportou 4 357 quebras em Alertas; o número correto é 0.)

| rota | 1920 | 1440 | 1280 | 1180 | 1024 | 768 |
|---|---:|---:|---:|---:|---:|---:|
| admin | 0 | 0 | **15** | **20** | **21** | **23** |
| bi | 0 | 0 | **1** | **1** | 0 | **3** |
| estoque | **19** | **19** | **19** | **19** | **20** | **20** |
| produtos | 0 | 0 | 0 | 0 | **1** | **1** |
| transferencias | **30** | **30** | **30** | **30** | **31** | **31** |
| alertas | 0 | 0 | 0 | 0 | **1** | **4** |
| relatorios | 0 | 0 | **3** | **3** | **4** | **7** |
| decisoes | 0 | 0 | 0 | **1** | **383** | **383** |
| historico | 0 | 0 | 0 | 0 | **1** | **1** |
| estrategia | 0 | 0 | 0 | **1** | **2** | **2** |
| planejamento | **334** | **744** | **751** | **753** | **753** | **765** |
| vendas | 0 | 0 | 0 | 0 | **1** | **2** |
| usuarios | 0 | 0 | 0 | **4** | **5** | **5** |
| lojas | 0 | 0 | 0 | 0 | **2** | **2** |
| sincronizacao | 0 | 0 | 0 | **1** | **1** | **1** |
| loja | 0 | 0 | 0 | 0 | 0 | 0 |
| loja-carrinho | 0 | 0 | 0 | 0 | 0 | 0 |

### 4.1 Quebra já na largura de projeto (1440 px)

| rota | elementos quebrados | classes | exemplos |
|---|---:|---|---|
| estoque | 19 | `.badge.green` ×19 | "Em estoque" (98×42) · "Em estoque" (98×42) · "Em estoque" (98×42) |
| transferencias | 30 | `.btn.sm` ×30 | "Criar movimentação" (152×42) · "Criar movimentação" (152×42) · "Criar movimentação" (152×42) |
| planejamento | 744 | `.num` ×2, `.btn.ghost` ×1, `.badge.red` ×66, `.badge.green` ×35, `.badge.amber` ×640 | "Cobertura no destino" (115×52) · "Exportar tudo (CSV)" (167×42) · "pedir hoje" (105×42) |

**Planejamento quebra 744 elementos a 1 440 px** — 640 `.badge.amber`, 66 `.badge.red`, 35 `.badge.green`. A 1 920 px ainda são 334. Ou seja: não é falta de tela, é a largura da coluna. Cada selo mede 105×42 px onde caberia 105×25 — a linha da tabela fica 17 px mais alta do que devia, 741 vezes.

O caso já conhecido está confirmado e quantificado: **`EM ESTOQUE` quebra em 2 linhas 19 vezes na tela de Estoque, a 1 440 px**, caixa de 98×42 px contra 25 px de altura de uma linha. Some-se `CRIAR MOVIMENTAÇÃO` (`.btn.sm`, 152×42) quebrando 30 vezes em Transferências, também a 1 440 px.

### 4.2 O que piora conforme estreita

| rota | a 1440 | a 1280 | a 1024 | a 768 | o que entra |
|---|---:|---:|---:|---:|---|
| admin | 0 | 15 | 21 | 23 | `.badge.amber` "14,5 meses · excesso" (183×42) ×14 |
| decisoes | 0 | 0 | **383** | 383 | `.label` "Capital a liberar" (114×30) ×382 — 1 por card |
| relatorios | 0 | 3 | 4 | 7 | `th.num` de cabeçalho |
| usuarios | 0 | 0 | 5 | 5 | `.btn.ghost` ×3 + `<th>` |
| planejamento | 744 | 751 | 753 | 765 | soma `<th>`, `.btn.ghost`, `.badge.blue` |

**Causa raiz:** `.badge` (`styles.css:980`) declara `letter-spacing:.18em` + `text-transform:uppercase` + `font-size:10.5px` e **não declara `white-space:nowrap`**. O espaçamento de 0,18 em em caixa alta engorda o rótulo em ~20 % e nada impede a quebra. Uma linha de CSS (`white-space: nowrap`) elimina as 741 quebras de Planejamento, as 19 de Estoque e as 14 de Dashboard.

## 5. Casca: sidebar e dock

| viewport | grid de `.macos-window` | sidebar | main | dock | dock escapa |
|---:|---|---:|---:|---|---:|
| 1920 | `244px 1642px` | 244 px | 1642 px | 448 px × 9 itens | 0 px |
| 1440 | `244px 1162px` | 244 px | 1162 px | 448 px × 9 itens | 0 px |
| 1280 | `244px 1002px` | 244 px | 1002 px | 448 px × 9 itens | 0 px |
| 1180 | `244px 902px` | 244 px | 902 px | 448 px × 9 itens | 0 px |
| 1024 | `244px 780px` | 244 px | 780 px | 448 px × 9 itens | 0 px |
| 768 | `244px 524px` | 244 px | 524 px | 448 px × 9 itens | 0 px |

- **A sidebar nunca vira outra coisa acima de 720 px.** Ela é a primeira coluna de um grid `244px 1fr` e só empilha no `@media (max-width:720px)`. A 768 px — iPad retrato, uma largura real de balcão — ela continua ocupando **244 px de 768 (31,8 %)**, deixando 524 px para a tela inteira. Não some, não colapsa, não vira ícones. É o motivo de tudo na seção 2 e 3 quebrar cedo demais.
- **O dock cabe sempre**: 448 px de largura, 9 botões, `escapesViewport = 0` em todas as larguras medidas (fica centrado em `.main`, e 448 < 524 mesmo a 768). Abaixo de 720 px ele é escondido por `@media`. O dock é a única peça da casca que passa limpa.
- A janela ganha margem e sombra só acima de 1 120 px; entre 721 e 1 119 px ela é retangular e colada nas bordas, o que é coerente.

## 6. Peso do DOM

Medido a 1 440×900, depois da estabilização. `nós` = `document.querySelectorAll("*").length` (elementos). `Nodes (CDP)` = contador do motor, que inclui nós de texto.

| rota | nós (elementos) | Nodes (CDP) | prof. máx. | `<tr>` | `td/th` | `<button>` | campos | HTML serializado | heap JS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| alertas | **37572** | 63991 | 16 | 2186 | 13098 | 2190 | 2179 | 3121 KB | 20.2 MB |
| decisoes | **24253** | 34622 | 13 | 0 | 0 | 948 | 0 | 2077 KB | 12.4 MB |
| planejamento | **20973** | 30815 | 17 | 591 | 5549 | 71 | 21 | 1644 KB | 11.3 MB |
| produtos | **4159** | 6783 | 12 | 502 | 3514 | 14 | 2 | 88 KB | 5.8 MB |
| estoque | **3743** | 6237 | 15 | 201 | 1809 | 16 | 2 | 194 KB | 7.1 MB |
| relatorios | **1214** | 2403 | 13 | 101 | 606 | 22 | 3 | 42 KB | 5.4 MB |
| transferencias | **673** | 1125 | 16 | 33 | 171 | 47 | 1 | 43 KB | 7.8 MB |
| loja | **583** | 923 | 11 | 0 | 0 | 49 | 3 | 56 KB | 6.0 MB |
| vendas | **481** | 988 | 13 | 42 | 231 | 22 | 4 | 22 KB | 6.2 MB |
| admin | **470** | 737 | 15 | 27 | 128 | 14 | 0 | 32 KB | 4.9 MB |
| lojas | **398** | 582 | 15 | 20 | 140 | 14 | 0 | 25 KB | 5.3 MB |
| bi | **334** | 560 | 15 | 0 | 0 | 23 | 2 | 27 KB | 11.3 MB |
| historico | **240** | 337 | 14 | 0 | 0 | 18 | 0 | 21 KB | 5.0 MB |
| usuarios | **228** | 387 | 16 | 4 | 28 | 21 | 3 | 17 KB | 5.3 MB |
| estrategia | **210** | 393 | 13 | 0 | 0 | 17 | 3 | 16 KB | 6.0 MB |
| sincronizacao | **167** | 257 | 13 | 2 | 6 | 15 | 0 | 13 KB | 4.9 MB |
| loja-carrinho | **68** | 120 | 11 | 0 | 0 | 0 | 0 | 6 KB | 4.8 MB |

Três telas estão fora de escala, e os números reais são **muito piores** do que os que circulavam:

| tela | o que se dizia | o que foi medido |
|---|---|---|
| Alertas | "2 176 linhas" | **2 176 linhas ✔ (exato), mas 37 572 elementos, 63 991 nós CDP, 2 176 `<input>`, 2 190 `<button>`, 20,2 MB de heap e 3 121 KB de HTML** — 17,2 elementos por linha |
| Decisões | "928 botões" | **948 botões** — confirmado (o número anterior errava por 2 %). O que ninguém contou: **382 cards, 24 253 elementos, 2 485 svg, 2 077 KB de HTML** |
| Planejamento | **não estava na lista** | **20 973 elementos, 30 815 nós CDP, 8 tabelas somando 583 linhas de corpo, uma delas com 501 linhas × 10 colunas** |

Nenhuma das três tem paginação ou virtualização. `Alerts.tsx:151` faz `rows.map(...)` sobre o resultado inteiro; `Decisions.tsx:670` faz `cards.map(...)` sobre o board inteiro; `Planning.tsx` monta 8 tabelas de uma vez. O único `slice` do arquivo de Alertas é `rebalance.data?.rows.slice(0, 8)` — a tabela secundária é limitada, a principal não.

### 6.1 O custo real do ícone por linha

| rota | `<svg>` | nós dentro dos svg | total svg | % do DOM | `<tr>` | svg por linha |
|---|---:|---:|---:|---:|---:|---:|
| alertas | 4372 | 6897 | 11269 | 30.0 % | 2186 | 2.00 |
| decisoes | 2485 | 7129 | 9614 | 39.6 % | 0 | — |
| planejamento | 2541 | 6352 | 8893 | 42.4 % | 591 | 4.30 |
| estoque | 218 | 626 | 844 | 22.5 % | 201 | 1.08 |
| loja | 80 | 195 | 275 | 47.2 % | 0 | — |
| transferencias | 50 | 169 | 219 | 32.5 % | 33 | 1.52 |
| lojas | 36 | 84 | 120 | 30.2 % | 20 | 1.80 |
| admin | 35 | 81 | 116 | 24.7 % | 27 | 1.30 |
| bi | 25 | 70 | 95 | 28.4 % | 0 | — |
| usuarios | 26 | 65 | 91 | 39.9 % | 4 | 6.50 |
| historico | 19 | 49 | 68 | 28.3 % | 0 | — |
| relatorios | 18 | 49 | 67 | 5.5 % | 101 | 0.18 |
| estrategia | 18 | 49 | 67 | 31.9 % | 0 | — |
| sincronizacao | 17 | 47 | 64 | 38.3 % | 2 | 8.50 |
| vendas | 17 | 46 | 63 | 13.1 % | 42 | 0.40 |
| produtos | 16 | 43 | 59 | 1.4 % | 502 | 0.03 |
| loja-carrinho | 7 | 25 | 32 | 47.1 % | 0 | — |

`<Icon>` (`brand/Icon.tsx:363`) renderiza um `<svg>` inline com 1 a 8 filhos por desenho. Custo médio medido: **2,58 nós por ícone** (Alertas: 11 269 nós de svg / 4 372 svg).

Simulação da troca por sprite (`<svg><use href="#nome"/></svg>` = 2 nós fixos por ícone):

| rota | nós hoje | nós de svg hoje | nós de svg com sprite | economia | % do DOM | nós depois |
|---|---:|---:|---:|---:|---:|---:|
| estoque | 3743 | 844 | 436 | −408 | 10.9 % | 3335 |
| transferencias | 673 | 219 | 100 | −119 | 17.7 % | 554 |
| alertas | 37572 | 11269 | 8744 | −2525 | 6.7 % | 35047 |
| decisoes | 24253 | 9614 | 4970 | −4644 | 19.1 % | 19609 |
| planejamento | 20973 | 8893 | 5082 | −3811 | 18.2 % | 17162 |
| loja | 583 | 275 | 160 | −115 | 19.7 % | 468 |

**Veredito medido: o ícone por linha é sustentável; o número de linhas não é.** Em Alertas, converter todos os 4 372 ícones para sprite economiza 2 525 nós — **6,7 % do DOM** — e ainda restam 35 047 elementos. Em Decisões a economia é de 4 644 nós (19,2 %) e restam 19 609. Trocar o `<Icon>` por `<use>` é uma micro-otimização legítima, mas ataca 6 a 19 % de um problema; paginar Alertas em 50 linhas por página corta 97 % do DOM. **Sprite não é a resposta; paginação é.** Nota adicional: `Produtos` renderiza 502 linhas com apenas 16 ícones (0,03 por linha) e mesmo assim chega a 4 159 nós — a densidade de ícone varia muito por tela e não é o fator dominante em nenhuma delas.

## 7. Desempenho

### 7.1 Carga fria por rota (contexto novo, cache vazio, 1440×900)

| rota | FCP | LCP | DCL | conteúdo estável | long tasks | soma | maior | CLS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| admin | 108 ms | 248 ms | 82 ms | 233 ms | 1 | 100 ms | 100 ms | 0 |
| bi | 108 ms | 308 ms | 80 ms | 516 ms | 3 | **308 ms** | 175 ms | 0 |
| estoque | 116 ms | 328 ms | 89 ms | 228 ms | 2 | 122 ms | 71 ms | 0 |
| produtos | 120 ms | 192 ms | 89 ms | 194 ms | 1 | 75 ms | 75 ms | 0 |
| transferencias | 112 ms | 212 ms | 83 ms | 224 ms | 1 | 57 ms | 57 ms | 0.1016 |
| alertas | 132 ms | 132 ms | 99 ms | 582 ms | 3 | **1266 ms** | **836 ms** | 0.0545 |
| relatorios | 120 ms | 120 ms | 87 ms | 195 ms | 1 | 50 ms | 50 ms | 0.0009 |
| decisoes | 116 ms | 116 ms | 85 ms | 454 ms | 3 | **690 ms** | **374 ms** | 0 |
| historico | 108 ms | 108 ms | 81 ms | 155 ms | 0 | 0 ms | 0 ms | 0.057 |
| estrategia | 112 ms | 112 ms | 81 ms | 171 ms | 0 | 0 ms | 0 ms | 0 |
| planejamento | 124 ms | 124 ms | 91 ms | 441 ms | 3 | **642 ms** | **368 ms** | 0.3897 |
| vendas | 124 ms | 124 ms | 88 ms | 184 ms | 0 | 0 ms | 0 ms | 0.0489 |
| usuarios | 120 ms | 120 ms | 93 ms | 170 ms | 0 | 0 ms | 0 ms | 0 |
| lojas | 128 ms | 128 ms | 93 ms | 166 ms | 0 | 0 ms | 0 ms | 0.0341 |
| sincronizacao | 124 ms | 124 ms | 93 ms | 167 ms | 0 | 0 ms | 0 ms | 0 |
| loja | 128 ms | 128 ms | 96 ms | 202 ms | 0 | 0 ms | 0 ms | 0 |
| loja-carrinho | 124 ms | 124 ms | 93 ms | 141 ms | 0 | 0 ms | 0 ms | 0 |

FCP e LCP são uniformemente bons (108–132 ms) porque a primeira pintura é a casca, não os dados. O que dói vem depois: **Alertas gasta 1 266 ms em long tasks, com uma única tarefa de 836 ms** — quase um segundo de thread principal travada, nesta máquina rápida e sem estrangulamento. Decisões: 690 ms (maior 374). Planejamento: 642 ms (maior 368). Durante esses blocos o console não responde a clique, tecla nem rolagem.

### 7.2 Navegação quente (troca de rota pelo dock, sem recarregar)

| rota | até o DOM parar de mudar | mutações | long tasks | soma long task | maior | nós ao final |
|---|---:|---:|---:|---:|---:|---:|
| admin | -0 ms | 0 | 0 | 0 ms | 0 ms | 470 |
| bi | 420 ms | 205 | 3 | **311 ms** | 167 ms | 334 |
| estoque | 72 ms | 72 | 1 | 68 ms | 68 ms | 3743 |
| produtos | 48 ms | 17 | 1 | 65 ms | 65 ms | 4159 |
| transferencias | 46 ms | 19 | 0 | 0 ms | 0 ms | 673 |
| alertas | 352 ms | 20 | 2 | **1085 ms** | 777 ms | 37572 |
| relatorios | 131 ms | 21 | 1 | 118 ms | 118 ms | 1214 |
| decisoes | 299 ms | 20 | 3 | **623 ms** | 326 ms | 24253 |
| historico | 69 ms | 17 | 1 | 63 ms | 63 ms | 240 |
| estrategia | 32 ms | 19 | 0 | 0 ms | 0 ms | 210 |
| planejamento | 210 ms | 58 | 3 | **488 ms** | 287 ms | 20973 |
| vendas | 87 ms | 31 | 1 | 77 ms | 77 ms | 481 |
| usuarios | 19 ms | 14 | 0 | 0 ms | 0 ms | 228 |
| lojas | 13 ms | 11 | 0 | 0 ms | 0 ms | 398 |
| sincronizacao | 11 ms | 12 | 0 | 0 ms | 0 ms | 167 |
| loja | 31 ms | 8 | 0 | 0 ms | 0 ms | 583 |
| loja-carrinho | 4 ms | 13 | 0 | 0 ms | 0 ms | 68 |

Trocar de tela para Alertas custa **1 085 ms de long task** medidos na janela de assentamento; Decisões 623 ms; Planejamento 488 ms. As outras 14 rotas ficam em 0–311 ms. (A soma de long tasks pode exceder o tempo de assentamento porque a janela observada inclui os 600 ms de quiescência exigidos e as entradas são reportadas com atraso; o valor é um teto da janela, não um cronômetro exato.)

### 7.3 Custo de rolagem

| rota | altura rolável | quadros | mediana | p95 | pior quadro | quadros > 20 ms | long tasks | ms em long task |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| admin | 2252 px | 20 | 16.7 ms | 16.8 ms | 16.8 ms | 0 | 0 | 0 ms |
| bi | 2822 px | 25 | 16.7 ms | 16.7 ms | 33.3 ms | 1 | 0 | 0 ms |
| estoque | 22399 px | 104 | 16.7 ms | 16.7 ms | 66.6 ms | 1 | 0 | 0 ms |
| produtos | 24140 px | 104 | 16.7 ms | 16.8 ms | 16.8 ms | 0 | 0 | 0 ms |
| transferencias | 3112 px | 27 | 16.7 ms | 16.8 ms | 16.8 ms | 0 | 0 | 0 ms |
| alertas | 113293 px | 104 | 16.7 ms | 33.4 ms | 66.7 ms | **22** | 1 | 60 ms |
| relatorios | 6538 px | 57 | 16.7 ms | 16.7 ms | 16.8 ms | 0 | 0 | 0 ms |
| decisoes | 65096 px | 104 | 16.7 ms | 16.8 ms | 33.4 ms | **5** | 0 | 0 ms |
| historico | 821 px | 8 | 16.7 ms | 16.7 ms | 16.7 ms | 0 | 0 | 0 ms |
| estrategia | 821 px | 8 | 16.7 ms | 16.7 ms | 16.7 ms | 0 | 0 | 0 ms |
| planejamento | 94688 px | 104 | 16.7 ms | 16.8 ms | 33.4 ms | **4** | 0 | 0 ms |
| vendas | 2217 px | 20 | 16.7 ms | 16.7 ms | 16.7 ms | 0 | 0 | 0 ms |
| usuarios | 821 px | 8 | 16.7 ms | 16.7 ms | 16.7 ms | 0 | 0 | 0 ms |
| lojas | 1288 px | 12 | 16.7 ms | 16.8 ms | 16.8 ms | 0 | 0 | 0 ms |
| sincronizacao | 821 px | 8 | 16.7 ms | 16.7 ms | 16.7 ms | 0 | 0 | 0 ms |
| loja | 2615 px | 21 | 16.7 ms | 16.8 ms | 16.8 ms | 0 | 0 | 0 ms |
| loja-carrinho | 900 px | 8 | 16.7 ms | 16.7 ms | 16.7 ms | 0 | 0 | 0 ms |

A rolagem em si é barata — mediana de 16,7 ms (60 fps) em todas as rotas, porque não há trabalho de JS por quadro. O que custa é o **tamanho do documento**: Alertas tem **113 293 px de altura rolável** (126 telas de 900 px), Planejamento 94 688 px, Decisões 65 096 px. Alertas perde 22 quadros e sofre 1 long task de 60 ms durante a rolagem; as demais ficam abaixo de 5 quadros perdidos.

### 7.4 Custo de recalcular estilo — o número mais grave da auditoria

Duas medidas de motor: um recálculo forçado de estilo+layout de toda a página, e um **acionamento do botão de tema** da titlebar (que troca `[data-tema]` na raiz e invalida o estilo de cada nó). Mediana de 3 a 5 repetições.

| rota | Nodes (CDP) | relayout forçado | trocar o tema | heap JS | listeners |
|---|---:|---:|---:|---:|---:|
| alertas | 63991 | **326.2 ms** | **735.4 ms** | 20.2 MB | 4524 |
| decisoes | 34622 | **122.1 ms** | **201.2 ms** | 12.4 MB | 1102 |
| planejamento | 30815 | **114.8 ms** | **133.0 ms** | 11.3 MB | 252 |
| produtos | 6783 | 26.1 ms | 28.8 ms | 5.8 MB | 172 |
| estoque | 6237 | 24.3 ms | 25.9 ms | 7.1 MB | 174 |
| relatorios | 2403 | 8.0 ms | 8.8 ms | 5.4 MB | 181 |
| loja | 923 | 4.9 ms | 8.5 ms | 6.0 MB | 223 |
| transferencias | 1125 | 4.3 ms | 6.5 ms | 7.8 MB | 204 |
| vendas | 988 | 3.9 ms | 4.7 ms | 6.2 MB | 182 |
| admin | 737 | 2.9 ms | 4.1 ms | 4.9 MB | 172 |
| bi | 560 | 2.1 ms | 3.9 ms | 11.3 MB | 335 |
| usuarios | 387 | 2.1 ms | 3.3 ms | 5.3 MB | 180 |
| estrategia | 393 | 2.1 ms | 3.1 ms | 6.0 MB | 176 |
| lojas | 582 | 2.6 ms | 3.1 ms | 5.3 MB | 170 |
| historico | 337 | 1.5 ms | 1.9 ms | 5.0 MB | 174 |
| sincronizacao | 257 | 1.5 ms | 1.8 ms | 4.9 MB | 171 |
| loja-carrinho | 120 | 0.5 ms | 0.6 ms | 4.8 MB | 147 |

**Clicar em "Tema escuro" na tela de Alertas trava a interface por 735 ms.** Em Decisões, 201 ms; em Planejamento, 133 ms. Esse botão está na titlebar de **todas as telas** — é o controle mais universal do console, e nas três telas pesadas ele é o mais caro. Nenhuma outra rota passa de 29 ms. O mesmo custo aparece em qualquer coisa que invalide estilo global (mudar `--*` na raiz, alternar `data-tema`, aplicar `filter: grayscale` para conferir contraste).

## 8. Tamanho dos artefatos

| arquivo | bruto | gzip -9 |
|---|---:|---:|
| assets/BI-C8w1LyOQ.js | 1.070.858 B | 354.215 B |
| assets/index-COomjIA5.js | 949.970 B | 225.378 B |
| assets/glassesRenderer-BxBkqMCi.js | 568.395 B | 143.470 B |
| assets/mediapipeTracker-BEiapTDa.js | 126.539 B | 38.446 B |
| fonts/inter-var-latin-ext.woff2 | 85.068 B | — (já comprimido) |
| fonts/fraunces-var-latin.woff2 | 67.304 B | — (já comprimido) |
| fonts/fraunces-var-latin-ext.woff2 | 59.388 B | — (já comprimido) |
| fonts/inter-var-latin.woff2 | 48.256 B | — (já comprimido) |
| fonts/fraunces-italic-300-latin.woff2 | 41.824 B | — (já comprimido) |
| fonts/fraunces-italic-300-latin-ext.woff2 | 37.380 B | — (já comprimido) |
| fonts/jetbrains-mono-var-latin.woff2 | 31.432 B | — (já comprimido) |
| assets/index-ugr7cR_B.css | 28.196 B | 5.872 B |
| fonts/jetbrains-mono-var-latin-ext.woff2 | 11.624 B | — (já comprimido) |
| fonts/licencas/JetBrainsMono-OFL.txt | 4.399 B | 1.976 B |
| fonts/licencas/Fraunces-OFL.txt | 4.391 B | 1.976 B |
| fonts/licencas/Inter-OFL.txt | 4.380 B | 1.970 B |
| index.html | 1.642 B | 885 B |
| assets/tracker-CHG_kCJ7.js | 539 B | 413 B |

**dist total: 3 141 585 B (3,00 MiB)** em 18 arquivos.

| bloco | bruto | gzip | quando é baixado |
|---|---:|---:|---|
| `index-*.js` (app) | 949 970 B | 225 378 B | sempre |
| `index-*.css` | 28 196 B | 5 872 B | sempre |
| fontes pré-carregadas (3 × latin) | 146 992 B | — (woff2) | sempre (via `<link rel=preload>`) |
| **subtotal do caminho crítico** | **1 125 158 B** | **378 242 B** | **toda primeira visita** |
| `BI-*.js` | 1 070 858 B | 354 215 B | só em `/#/admin/bi` |
| `glassesRenderer-*.js` | 568 395 B | 143 470 B | só no provador virtual |
| `mediapipeTracker-*.js` | 126 539 B | 38 446 B | só no provador virtual |
| fontes latin-ext + itálico | 235 284 B | — | **nunca, em pt-BR** (excluídas por `unicode-range`) |
| licenças `.txt` | 13 170 B | — | nunca (não referenciadas) |

### Quanto as fontes acrescentam

- Diretório `fonts/` inteiro: **382 276 B em 8 woff2 (12,2 % do dist)**, mais 13 170 B de licenças.
- Realmente buscado numa carga em pt-BR: **3 arquivos, 146 992 B** — confirmado pelo `PerformanceResourceTiming` de todas as 17 rotas (`inter-var-latin` 48 256 B, `fraunces-var-latin` 67 304 B, `jetbrains-mono-var-latin` 31 432 B). Nenhum `latin-ext` foi requisitado em nenhuma rota.
- Como woff2 já é comprimido, as fontes representam **146 992 de 378 242 B = 38,9 % dos bytes comprimidos do caminho crítico**. São o segundo maior item depois do bundle da aplicação, e maior que o CSS por um fator de 25.
- A decisão de pré-carregar apenas as 3 faces `latin` está correta e está funcionando: 235 284 B de `latin-ext`/itálico ficam no disco sem nunca ser baixados. O que se pode ganhar ainda: `fraunces-var-latin` (67 304 B) é a maior das três e serve só títulos — atrasá-la (sem `preload`, com `font-display: swap`) tiraria 17,8 % dos bytes críticos.

### Observações de empacotamento

- O bundle principal de 949 970 B é servido **inteiro em toda rota**, inclusive nas 15 que não usam gráficos. O `BI-*.js` de 1 070 858 B está corretamente separado, mas é maior que o próprio app.
- `glassesRenderer` + `mediapipeTracker` (694 934 B) só entram no provador virtual — separação correta.
- O Vite avisa que 4 chunks passam de 500 KB. Nenhum `manualChunks` está configurado.

## 9. Reprovações, por gravidade

| # | rota | seletor / arquivo | medida | gravidade |
|---:|---|---|---|---|
| 1 | alertas | `.titlebar .btn.ghost` (botão de tema) · `AdminShell.tsx:304` | trocar o tema bloqueia a thread principal por **735,4 ms** (relayout forçado 326,2 ms; 63 991 nós CDP) | crítica |
| 2 | alertas | `tbody tr` · `Alerts.tsx:151` | **37 572 elementos**, 2 176 linhas sem paginação (mais 2 176 `<input>` e 2 190 `<button>`); 1 266 ms de long task na carga, tarefa única de 836 ms; 20,2 MB de heap; 113 293 px de altura | crítica |
| 3 | decisoes | `.grid.grid-3 > Card` · `Decisions.tsx:670` | **24 253 elementos, 382 cards, 948 botões, 2 485 svg** sem paginação; 690 ms de long task; 201 ms para trocar o tema | crítica |
| 4 | planejamento | 8 × `<table>` · `Planning.tsx` | **20 973 elementos** em 8 tabelas (583 linhas), a maior com 501 lin × 10 col exigindo 1 126 px; 642 ms de long task; 94 688 px de altura | crítica |
| 5 | planejamento | `.titlebar > div` (ScopePicker) · `scope.tsx:74` | chips do RECORTE pintados **sobre** "Dados ao vivo" a partir de **1 081 px**; a 768 px a caixa tem **2 px** e a sobreposição é de **314 px** | crítica |
| 5b | todas (14 admin) | `.segmented button` · `scope.tsx:88` | a **768 px a opção "Tudo" tem 0 % de visibilidade nas 14 telas** e "Lentes" 0 % em 13; a 1 024 px o chip ativo quebra em 2 linhas em 13 telas. O RECORTE deixa de ser operável. | crítica |
| 6 | planejamento | `.badge` · `styles.css:980` | **744 selos quebrados em 2 linhas a 1 440 px** (640 amber, 66 red, 35 green); 334 ainda a 1 920 px; falta `white-space:nowrap` | alta |
| 7 | planejamento | `.main` · `styles.css:440` | o corpo da página rola **de lado** já a **1 280 px** (+153 px), a 1 024 px +375 px — 8 tabelas sem wrapper `overflowX` | alta |
| 8 | todas (15 admin) | `.titlebar` · `styles.css:417` | compressão do RECORTE começa em **1 204 px**; nenhuma `@media` para `.titlebar` existe em `styles.css`; a faixa 721–1099 px não tem regra de casca | alta |
| 9 | decisoes | `.label` (rótulo de card) · `ui.tsx` | **382 rótulos** ("Capital a liberar", 114×30) quebram em 2 linhas a 1 024 px — um por card | média |
| 10 | todas (15 admin) | `.sidebar` · `styles.css:338` | coluna fixa de **244 px** até 720 px; a 768 px consome **31,8 % da viewport** e deixa 524 px para a tela toda | média |
| 11 | estoque | `.badge.green` · `Stock.tsx` | "Em estoque" quebra em 2 linhas **19 vezes a 1 440 px** (98×42 contra 25 px de 1 linha) — confirmado | média |
| 12 | transferencias | `.btn.sm` · `Movements.tsx` | "Criar movimentação" quebra em 2 linhas **30 vezes a 1 440 px** (152×42) | média |
| 13 | admin | `.badge.amber` · `Dashboard.tsx` | "14,5 meses · excesso" quebra em 2 linhas ×14 a partir de **1 280 px** (183×42) | média |
| 14 | transferencias | `table` 8 col · `Movements.tsx` | exige 947 px; `.main` rola de lado a partir de **1 180 px** (+74 px) | média |
| 15 | usuarios | `table` 7 col · `Usuarios.tsx` | exige 823 px; `.main` rola de lado a 1 024 px (+71) e a 768 px (+327) | baixa |
| 16 | — | `App.tsx:91` | `<Route path="*" element={<Navigate to="/" replace/>}/>` engole rota inválida em silêncio; foi o que fez uma passagem inteira desta auditoria medir o Launcher achando que media 16 telas | baixa (mas cara em diagnóstico) |


### O que passou

- Rolagem horizontal de **página**: 0 em 102 medições.
- Dock: 448 px × 9 itens, cabe em todas as larguras, `escapesViewport = 0`; escondido corretamente abaixo de 720 px.
- FCP 108–132 ms e LCP 108–328 ms em todas as 17 rotas; CLS 0 em todas.
- Rolagem a 60 fps (mediana 16,7 ms) em todas as rotas — o custo é o tamanho do documento, não o trabalho por quadro.
- Estratégia de fontes: só 3 faces `latin` são baixadas; 235 284 B de `latin-ext`/itálico nunca são requisitados em pt-BR. A decisão de preload documentada no `index.html` está correta e verificada.
- Code-splitting do BI e do provador virtual: correto — 1,7 MB não entram na carga das 15 telas restantes.
- Tabelas com wrapper `overflowX` (Estoque, Produtos, Vendas, Lojas, Relatórios) contêm o excesso dentro do cartão, como deveriam. Prova de que o padrão certo já existe no código e só não foi aplicado nas outras 8 páginas.

## 10. O problema mais caro de resolver

**Não é a titlebar. É a ausência de paginação em Alertas, Decisões e Planejamento.**

A titlebar é cara em *decisão de desenho* mas barata em código: `white-space:nowrap` no `.badge`, `flex:none` no ScopePicker e uma `@media (max-width:1200px)` que troque os três chips por um `<select>` resolvem as reprovações 5, 6, 8, 11, 12 e 13 em algo como 30 linhas de CSS e uma variante de componente. Idem para as tabelas: o wrapper `overflowX:auto` **já existe** em 5 páginas; copiá-lo para as outras 8 é mecânico e resolve 7, 14 e 15.

Paginar as três telas pesadas não é. O custo está em três camadas que se sustentam:

1. **Contrato de API.** `getAlerts`, `getDecisionBoard` e o plano de Planejamento devolvem a coleção inteira. Paginar de verdade exige `limit`/`offset`/`cursor` no servidor, ou aceitar paginar no cliente — o que reduz o DOM mas mantém o custo de rede, de heap (20,2 MB) e de parse.
2. **Os filtros são client-side.** `Alerts.tsx:54` filtra por nível em memória; `Decisions.tsx:574` filtra tipo e prioridade num `useMemo` sobre a coleção completa. Paginar no servidor obriga a mover esses filtros para o servidor também, senão o operador filtra só a página que está vendo — uma regressão funcional silenciosa e pior que o problema original.
3. **A ordenação é semântica.** Decisões se apresenta "ordenado pela prioridade e pelo maior impacto"; Alertas mistura ruptura e baixo estoque. Ordem estável entre páginas tem que ser garantida pelo servidor, com critério de desempate, ou os cards pulam de página entre recargas.

Ou seja: é uma mudança de API + estado de filtro + garantia de ordenação, atravessando front e back, com risco de regressão em telas que são exatamente as de decisão de compra. Virtualização por janela (`react-window` e afins) é mais barata e não mexe na API — resolve DOM, heap e o relayout de 735 ms —, mas quebra Ctrl+F, quebra a impressão (e `Reports.tsx` tem `@media print`), e não reduz um byte de rede.

Para efeito de ordem de ataque, o custo por defeito removido:

| correção | esforço | o que resolve |
|---|---|---|
| `white-space:nowrap` em `.badge` | 1 linha de CSS | 741 quebras em Planejamento + 19 em Estoque + 14 em Dashboard |
| `flex:none` no ScopePicker + `@media` da titlebar | ~30 linhas de CSS + 1 variante | a sobreposição de controles em 15 telas abaixo de 1 081 px |
| wrapper `overflowX:auto` nas 8 páginas que não têm | copiar padrão existente | rolagem lateral do corpo em 6 rotas |
| `<Icon>` → sprite `<use>` | refatoração isolada de 1 componente | 6,7 % do DOM em Alertas, 19,2 % em Decisões — **não resolve nada sozinho** |
| paginar/virtualizar as 3 telas | **API + filtros + ordenação, front e back** | **97 % do DOM, os 735 ms de tema, os 1 266 ms de long task, os 20,2 MB de heap** |


---

Dados brutos: `/tmp/aud/width-raw.json` (102 medições de geometria), `titlebar-raw.json`, `scope-raw.json` (165), `bisect-raw2.json` (bisseção px a px), `wrap-raw.json` (102), `perf-raw.json` (34), `cdp-raw.json` (17). Scripts em `/tmp/aud/`. Nenhum arquivo do projeto foi modificado.
