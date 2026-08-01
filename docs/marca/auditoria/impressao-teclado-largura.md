# Auditoria · Impressão, teclado e largura

Console Nova Ótica (A GRACIOSA, 19 lojas) · build `VITE_DEMO=1` servido por HTTP em
`localhost:8899` · Chromium 1194 headless via Playwright · 31/07/2026.

Três eixos que nenhuma onda anterior mediu de ponta a ponta: **o papel**, **o teclado**
e **a largura da janela**. Tudo aqui foi medido no produto construído, não lido no
código. Onde um número diverge de relatório anterior, o número desta auditoria manda —
está dito no lugar.

Evidência em PDF: `/home/user/nova_otica/docs/marca/impressao/` (18 arquivos novos,
`*-cor.pdf` e `*-cinza.pdf`, mais `decisoes-fundos-ligados.pdf`).

---

## Antes de tudo: o que JÁ está resolvido

Comecei assumindo que não havia folha de estilo de impressão. Havia. `styles.css`
2415–2643 traz um `@media print` completo, e ele **funciona**. Medi e confirmo:

| O que se temia | Medido | Veredito |
| --- | --- | --- |
| Fundo creme #F6F2E9 impresso | área não-branca sob `media=print` = **0,7%** da página (só fiozinhos `hr.rule` a 13% de opacidade) | **resolvido** |
| Sidebar / dock / titlebar / botões no papel | 0 sidebars, 0 docks, 0 botões visíveis sob `media=print` | **resolvido** |
| Cabeçalho não repete na quebra | `thead{display:table-header-group}` — confirmado no texto extraído das págs. 2 e 5 do Curva ABC e da pág. 2 do Planejamento | **resolvido** |
| Linha racha na virada de página | `tr{break-inside:avoid}` — nenhuma linha partida em 12 tabelas | **resolvido** |
| Tabela larga estoura a folha | a 718px (A4 − 2×10mm) **nenhuma** das 12 tabelas ultrapassa a caixa: `scrollWidth` = `clientWidth` em todas | **resolvido** |
| Campo editável impresso como caixa | `input/select/textarea` viram texto — a coluna "Ajustar mínimo" de Alertas sai como `3`, não como caixa | **resolvido** |
| `@page` implícito | `@page{size:A4;margin:10mm}` presente | **resolvido** |

Isso muda o enquadramento desta onda: os defeitos de impressão que restam **não são de
ausência de regra, são de dosagem e de escopo da regra que existe** — exatamente a
mesma doença que o Galbe apontou na tela.

---

## A · IMPRESSÃO

### A.1 — O número em reais quebra no meio. Em 100% das linhas de moeda. `[CRÍTICO]`

O achado mais grave do eixo. Extraído do texto real de `relatorios-1-curva-abc-cor.pdf`,
pág. 1:

```
A SRC056M 0700 54 OCULOS ROBERTO CAVALLI   2   R$ 6.714,
                                               00          1.6%   1.6%
A MU52WV 5AK1O1 53 ARMACAO MIU MIU         2   R$ 5.017,
                                               03          1.2%   2.7%
```

`R$ 6.714,00` é impresso como `R$ 6.714,` numa linha e `00` na seguinte. Não é um caso
de borda: acontece em **toda** linha da coluna RECEITA das 5 abas de Relatórios, e o
mesmo mecanismo parte cabeçalhos — `CLASSE` vira `CLASS`/`E`, `DISPONÍVEL` vira
`DISPONÍV`/`EL`, `COBERTURA NO DESTINO` vira `COBERTU`/`RA NO`/`DESTINO`, e no
Planejamento a coluna `AÇÃO` sai como `AÇ`/`ÃO`.

**Causa.** Bloco 4 do `@media print`:

```css
th, td {
  overflow-wrap: anywhere;   /* ← aplicado a TODAS as células */
  word-break: normal;
}
```

`overflow-wrap:anywhere` foi colocado ali para uma razão social sem espaços
(`LUXOTTICA BRASIL PRODUTOS OTICOS E ESPORTIVOS LTDA`) não travar a largura mínima da
coluna. Correto para essa célula. Aplicado a **todas** as células, ele autoriza o
navegador a quebrar dentro de um valor monetário e dentro de um rótulo de cabeçalho.
É a regra certa na dose errada — a mesma causa raiz da mono.

Agrava: `table-layout:auto` dá à coluna PRODUTO ~55% da folha e espreme RECEITA em
~70px, o que faz o navegador *precisar* quebrar.

**Regra que falta** (dentro do `@media print`):

```css
th, td { overflow-wrap: normal; word-break: normal; }   /* volta ao padrão */
th { hyphens: none; }                                    /* cabeçalho não parte */
td.num, th.num, .codigo, .valor { white-space: nowrap; } /* moeda e SKU inteiros */
/* a exceção fica onde o problema realmente estava: */
td.produto, td.fornecedor, td.marca { overflow-wrap: anywhere; }
/* e a folga vem da largura, não da quebra: */
table { table-layout: fixed; }
td.produto { width: 38%; }
```

### A.2 — Cinco relatórios diferentes imprimem a mesma capa `[CRÍTICO]`

Os cinco PDFs de Relatórios (`relatorios-1..5-cor.pdf`) começam com **texto
idêntico**:

```
Ir para o conteúdo
CONSULTA
Relatórios
Curva ABC (SKU ou marca), giro, cobertura de estoque e transferências sugeridas —
todos exportáveis em CSV.
Últimos 30 dias  Toda a rede  Todos os tipos
```

Nada na folha diz se aquilo é a Curva ABC, o Giro, a Cobertura, as Transferências ou
Marcas × Bandeiras. O nome do relatório está no `.segmented`, e o bloco 1 esconde
`.segmented` e `button`. Quem imprime cinco relatórios numa reunião fica com cinco
maços cuja única diferença é o cabeçalho da tabela, na página 1, no meio da folha.

Some-se: **não há carimbo de data/hora, não há identificação da rede, não há numeração
de páginas própria**. Um maço de 271 folhas (Decisões) sem número de página é um maço
que não pode ser recomposto se cair no chão.

**Regra que falta:**

```css
@media print {
  /* a aba escolhida deixa de ser botão e vira o subtítulo do documento */
  .segmented { display: block !important; }
  .segmented button { display: none !important; }
  .segmented button.active {
    display: block !important;
    border: 0 !important; padding: 0 !important;
    font-family: var(--font-titulo); font-size: 13pt;
  }
}
```
E um `.print-only` no topo do `<main>` com "A GRACIOSA · <título> · <recorte> ·
impresso em <data>", visível só em print.

### A.3 — Decisões imprime 271 folhas A4; Alertas, 76; Planejamento, 54 `[ALTO]`

Medido com pypdf sobre os PDFs gerados (A4, margens do `@page`):

| Tela | Páginas | Registros na página |
| --- | --- | --- |
| Decisões | **271** | 1.380 cards |
| Alertas | **76** | 2.097 linhas |
| Planejamento | **54** | tabela de 440 linhas + 6 outras |
| Relatórios · Transferências | 14 | 200 linhas |
| Relatórios · Giro | 7 | 150 linhas |
| Relatórios · Curva ABC | 5 | 100 linhas |
| Relatórios · Cobertura | 4 | 82 linhas |
| Relatórios · Marcas × Bandeiras | 3 | 40 linhas |
| Histórico | 1 | — |

O `@media print` resolveu a *tinta* (0,7% de área colorida) e não resolveu o *papel*.
Ctrl+P em Decisões, hoje, é meia resma. Não é defeito de CSS: falta um recorte de
impressão. Mínimo viável: um `.print-only` com "imprimindo N de M — refine o filtro
para reduzir", e um limite (`.card-decisao:nth-of-type(n+51){display:none}` em print +
aviso), ou o botão "Imprimir os 50 primeiros" que a tela de Histórico já insinua ter
("Abre o diálogo de impressão — escolha 'Salvar como PDF'").

### A.4 — O selo sobrevive ao P&B; o estado "saudável" não se distingue do neutro `[MÉDIO]`

Verifiquei em `pb-*.png` (render sob `media=print` com `grayscale(1)`) e nos
`*-cinza.pdf`. Os `.badge` saem como caixa preta vazada com rótulo escrito
("Em falta", "Liquidar", "Alta", "Crítica", "1.00 · gira") — **legíveis sem cor**, como
o bloco 6 prometeu. O canal geométrico funciona: `red` 3px sólido, `amber` 2px,
`blue` 3px duplo, `gray` 1px tracejado.

Só que `.badge.green` recebe `border-left:1px solid #000` — **exatamente a borda que as
outras três faces já têm**. No papel, "saudável" e um badge sem classe de cor são o
mesmo desenho. Dos cinco estados prometidos, quatro se distinguem; o quinto não.

**Regra que falta:** `.badge.green{border-left:3px dotted #000!important}` (ponteado é
o único estilo ainda não usado, e não colide com o duplo do `blue` a 8pt).

### A.5 — O link "Ir para o conteúdo" imprime em toda primeira página `[BAIXO]`

Presente no texto extraído dos 9 PDFs. É um atalho de teclado; no papel é ruído no topo
do documento, acima do próprio título. **Falta:** incluir `.skip-link` na lista de
`display:none` do bloco 1.

### A.6 — Nota de método

Os `*-cinza.pdf` foram gerados com `body{filter:grayscale(1)}` sob `media=print`. A
paginação bate exatamente com a dos `*-cor.pdf` (76/76, 271/271, 54/54, 5/5, 7/7, 4/4,
14/14, 3/3, 1/1), o que confirma que o filtro não alterou o layout. Os arquivos em
cinza são 30–70× maiores porque o filtro força rasterização — artefato do método, não
do produto.

---

## B · TECLADO

Tab do começo ao fim das 17 rotas (`/admin` × 15, `/loja`, `/loja/carrinho`), até 160
paradas por rota.

### O que passou

- **Nenhum botão ou link sem nome acessível** em nenhuma das 16 rotas medidas.
- **Nenhum elemento fora da tela** recebendo foco. Nenhuma armadilha na navegação normal.
- **O dock recolhido funciona.** Medido: após rolagem, `.dock.recolhido` fica com 23px de
  altura; ao receber foco de teclado a classe cai para `.dock` e o botão focado
  (`Dashboard`) volta a 42px em `y=839`. Ele expande e trava aberto enquanto o foco
  estiver dentro — exatamente o que o `useDockDaRolagem` promete.
- **O MultiSelect funciona.** Sequência medida em `/admin/estoque`:
  `Enter` abre o popover · `ArrowDown` entra na lista · `Home`/`End` vão ao primeiro e
  ao último · `Enter` marca (`aria-selected`, contador vai a 1) sem fechar ·
  `Esc` fecha **e devolve o foco ao botão**, cujo nome acessível já reflete a escolha
  (`"A GRACIOSA VARANDA — filtro de lojas"`). `role=listbox`/`role=option`/
  `aria-multiselectable` corretos.
- **Landmarks corretos** no admin: `ASIDE` + `MAIN(aria-label="Conteúdo — <tela>")` + `HEADER`.
- **Nenhum ícone decorativo anunciado**: 0 `<svg>` sem `aria-hidden` em 15 das 16 rotas.

### B.1 — Os modais não são modais. Nem para o teclado, nem para o leitor de tela. `[CRÍTICO]`

Vale para "Nova movimentação" (`/admin/transferencias`) e "Novo usuário"
(`/admin/usuarios`). Markup medido:

```
DIV.modal-overlay   role=null  aria-modal=null  aria-labelledby=null  tabindex=null
DIV.card modal      role=null  aria-modal=null  aria-labelledby=null  tabindex=null
```

Quatro falhas somadas, todas confirmadas na execução:

1. **Sem `role="dialog"` / `aria-modal="true"` / `aria-labelledby`.** Nenhum leitor de
   tela anuncia que um diálogo abriu. Não há como saber que a tela mudou.
2. **O foco não entra no diálogo.** Em Transferências, depois do clique o
   `activeElement` continua sendo o próprio botão `Nova movimentação` (`y=127`), atrás
   do scrim.
3. **Não há armadilha de foco — e é o inverso do que se quer.** Apertei Tab 18 vezes com
   o modal aberto e o foco percorreu a **página de trás**, batendo em botões
   `Transferir` da tabela coberta pelo scrim (`y=368, 430, 492, 554, 616, 679, 741,
   803`), todos com `closest('.card.modal') === null`. O usuário de teclado navega — e
   pode **acionar** — controles que não consegue ver. Os 9 focáveis reais do diálogo
   (4 `select`, 3 `input`, `Cancelar`, `Registrar`) nunca são alcançados.
4. **`Esc` não fecha.** Medido nas duas telas: depois de `Escape`, `.card.modal` ainda
   está no DOM. Só o clique do mouse fora fecha. Combinado com (2) e (3): **quem abre o
   modal pelo teclado não tem como fechá-lo nem como preenchê-lo.**

**O que falta:** `role="dialog" aria-modal="true" aria-labelledby="<id do h3>"` no
`.card.modal`; `inert` (ou `aria-hidden="true"`) no `.macos-window` enquanto o modal
estiver aberto; foco no primeiro campo ao abrir e devolução ao gatilho ao fechar;
handler de `Escape` no overlay. O `MultiSelect.tsx` já faz o Esc certo na linha 64 — o
padrão existe na casa e não foi aplicado aos modais.

### B.2 — `input[type=date]` sem nenhum indicador de foco `[ALTO]`

Em `/admin/vendas`, dois campos de data recebem foco com
`outlineStyle:"none"`, `outlineWidth:0px`, `boxShadow:"none"`. São os **únicos** dois
focáveis sem anel em todo o console. Falha WCAG 2.4.7 (Focus Visible) e 2.4.11
(Focus Appearance). O anel dourado (`box-shadow:0 0 0 3px var(--ring)`) existe na regra
`input:not(...):focus` mas não chega neles.

**Falta:** `input[type="date"]:focus, input[type="date"]:focus-within { border-color: var(--ouro-texto); box-shadow: 0 0 0 3px var(--ring); }`

### B.3 — Salto de h1 para h3 em 11 das 16 rotas `[MÉDIO]`

Não existe um único `<h2>` no console. Sequências medidas: `/admin` = `1,3,3` ·
`/admin/bi` = `1,3×15` · `/admin/planejamento` = `1,3×8` · `/admin/decisoes` = `1` seguido
de **1.380 `h3`**. Quem navega por cabeçalhos (o atalho mais usado por usuário de leitor
de tela) recebe uma lista plana onde deveria haver a hierarquia de seções que o Galbe
justamente pediu para ver melhor demarcada. Os títulos de seção (`.section-title`,
"QUADRO", "RITMO", "LISTA") são os `h2` que faltam.

### B.4 — 108 gráficos anunciam a mesma frase em Planejamento `[MÉDIO]`

`/admin/planejamento` tem 108 `<svg role="img">` com `<title>Previsão sazonal</title>`,
um por linha da tabela, nenhum com `aria-hidden`. Um leitor de tela lê "Previsão
sazonal, imagem" 108 vezes seguidas, sem nunca dizer *de qual produto* nem *o que a
curva mostra*. Um sparkline de linha de tabela é decorativo (o dado está nas colunas ao
lado): **falta** `aria-hidden="true"` neles — ou, se forem informativos, um `<title>`
que inclua o SKU e a tendência.

### B.5 — A marca é anunciada duas vezes em `/loja` `[BAIXO]`

Dois elementos com o texto exato "NovaÓtica": `A.brand` (cabeçalho) e `SPAN.brand`
(rodapé). No admin há apenas um. **Falta:** `aria-hidden="true"` no do rodapé, ou trocar
o texto por "Nova Ótica · A GRACIOSA".

### B.6 — Três `select` sem rótulo acessível `[MÉDIO]`

Sem `aria-label`, sem `<label for>`, sem `<label>` envolvente, sem `title`: 2 em
`/admin/bi`, 2 em `/admin/usuarios`, 1 em `/admin/transferencias` (e mais 3 `input`
dentro do modal de Nova movimentação). O rótulo existe como texto solto ao lado, que o
leitor de tela não associa. Anunciam só "caixa de combinação".

### Uma suspeita que a medição derrubou

A ordem de tabulação **segue o visual**. As "quebras" que o detector de ordem apontou
(`Sair(y849) → Óculos(y46)`) são a passagem legítima da coluna da barra lateral para o
topo da coluna de conteúdo — layout de duas colunas, não defeito. Idem em `/loja`, onde
o salto é entre cartões de uma grade. Nenhum elemento é pulado.

---

## C · LARGURA

Medido em 1920, 1440, 1280, 1180, 1024 e 768, nas 16 rotas (96 medições).

### C.1 — A hipótese sobre a titlebar está errada. Ela sobra. `[não é defeito]`

A titlebar carrega título + RECORTE + 3 chips + "Dados ao vivo" + botão de tema num
flex `nowrap`. Medi a soma das larguras dos filhos contra a largura disponível:

| Largura | Titlebar | Soma dos filhos | Folga |
| --- | --- | --- | --- |
| 1920 | 1642px | 769–932px | 710–873px |
| 1440 | 1162px | 769–932px | 230–393px |
| 1280 | 1002px | 826–930px | 72–176px |
| 1024 | 780px | 652–732px | 48–128px |
| **768** | **524px** | **493px** | **quebra — ver C.2** |

De 1024 para cima ela cabe com folga, sem `wrap`, sem estouro (`estoura:false`,
`ultimoRight` sempre ≤ `right`). O único truncamento acima de 1024 é o `.title` do
Planejamento, `180px` de conteúdo em `178px` de caixa a 1280 e `154px` a 1024 — 2px e
26px, com reticências. Registro para não repetirmos a suspeita: **a titlebar não é o
problema de largura deste console.**

### C.2 — A 768 a titlebar colapsa e a janela ganha barra horizontal `[ALTO]`

Medido em `/admin` a 768px:

```
.title        w=0     x=256  right=256   ← o título ("DASHBOARD"/"Dashboard") some
.scope-picker w=427   x=268  right=695
(ações)       w=66    x=707  right=773   ← 5px ALÉM da janela de 768
.macos-window scrollWidth=773  clientWidth=768
```

Duas coisas ao mesmo tempo: o bloco de título é espremido a **largura zero** — o nome da
tela desaparece por completo, junto com o chip "Dados ao vivo" (confirmado visualmente
em `w-768.png`: sobram só as abas de recorte e o botão de tema) — e o último grupo
ultrapassa a borda em 5px, produzindo **barra de rolagem horizontal em `.macos-window`
em todas as 15 rotas do admin**. Barra horizontal na casca é sempre defeito.

**Falta:** `.titlebar{flex-wrap:wrap; row-gap:8px}` mais `@media (max-width:900px){
.titlebar .title{flex:1 1 100%; min-width:0} .titlebar .scope-picker{overflow-x:auto} }`
— e `min-width:0` no `.title` para que ele encolha com reticências em vez de a zero.

### C.3 — A grade não colapsa a 768 `[ALTO]`

`/admin/decisoes`: `MAIN.main` com `scrollWidth 742 > clientWidth 524`, e dentro dele
`.grid.grid-3` com `714 > 468`. `/admin/estrategia`: `MAIN.main 736 > 524` e
`.grid.grid-2 708 > 468`. O `main` inteiro rola na horizontal — não é uma tabela larga
dentro de um cartão, é a área de conteúdo. Falta o breakpoint que leva `.grid-3` e
`.grid-2` a uma coluna abaixo de ~900px.

### C.4 — Tabelas largas: rolagem interna começa já em 1280 `[MÉDIO]`

O padrão do console é `overflow-x` no `.card` que embrulha a tabela, o que é a solução
certa (a barra fica na tabela, não na página). Mas ela é acionada cedo demais:

| Rota | 1280 | 1180 | 1024 | 768 |
| --- | --- | --- | --- | --- |
| `/admin/planejamento` | 1074 > 944 | 1074 > 844 | 1074 > 722 | 885 > 466 |
| `/admin/estoque` | 965 > 944 | 965 > 844 | 965 > 722 | 965 > 466 |
| `/admin/transferencias` | 959 > 944 | 959 > 844 | 959 > 722 | 959 > 466 |
| `/admin/usuarios` | — | 854 > 844 | 854 > 722 | 854 > 466 |

Num notebook de 1280 (a máquina de loja mais comum), a tabela de recomendação de compra
do Planejamento já exige rolagem lateral: 130px escondidos, que são as colunas de
decisão à direita. A folga existe — o `@media print` provou que a mesma tabela cabe em
**718px** quando o respiro cai de 28px para 8px por célula. Falta trazer parte dessa
compressão para a tela abaixo de 1400px.

### C.5 — A razão social é cortada em 119 células, em todas as larguras `[MÉDIO]`

`/admin/produtos`, coluna MARCA: 119 `<td>` com `scrollWidth 422 > clientWidth 243`
a 1440 — e ainda `422 > 349` a **1920**, a maior largura testada. O texto é
`LUXOTTICA BRASIL PRODUTOS OTICOS E ESPORTIVOS LTDA`. Há `text-overflow:ellipsis`
(o corte é sinalizado, não silencioso), mas o usuário nunca vê a marca completa em
nenhuma largura, e não há `title` para revelar no hover. Falta: `title={marca}` na
célula, ou exibir o nome curto ("LUXOTTICA") com a razão social no `title`.

### C.6 — Nenhuma barra horizontal no documento

`document.scrollWidth === document.clientWidth` nas 96 medições. O estouro de C.2 e C.3
acontece **dentro** da casca (`.macos-window`, `.main`), que é onde a rolagem aparece
para o usuário. Registrado para precisão: a página não rola; a janela do console rola.

---

## Ordem de ataque

1. **B.1** modais sem `role`, sem foco, sem trap, sem Esc — bloqueia o teclado por completo.
2. **A.1** `R$ 6.714,` / `00` — o relatório impresso mente sobre o número.
3. **A.2** cinco relatórios com a mesma capa, sem data e sem identificação.
4. **C.2** titlebar colapsa e a casca ganha barra horizontal a 768.
5. **A.3** 271 folhas em Decisões.
6. **C.3** grade não colapsa a 768.
7. **B.2** `input[type=date]` sem anel de foco.
8. **B.3** salto h1→h3 em 11 rotas (e é o mesmo problema de hierarquia que o cliente viu).
9. **C.4 / C.5** tabelas rolando a 1280; razão social cortada em toda largura.
10. **A.4 / A.5 / B.4 / B.5 / B.6** acabamento: `badge.green`, skip-link no papel,
    108 sparklines anunciados, marca dobrada, `select` sem rótulo.
