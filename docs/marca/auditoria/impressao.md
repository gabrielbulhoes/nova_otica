# Auditoria de impressão — NANOFLOW / Nova Ótica

**Data:** 2026-07-31 · **Frente:** impressão (papel, PDF, P&B)
**Build auditado:** `VITE_DEMO=1 VITE_HASH_ROUTER=1 VITE_BASE=./` servido em `http://localhost:8899`
**Motor:** Chromium 1194 (`/opt/pw-browsers/chromium-1194`), `page.pdf()` A4, margens 10 mm
**CSS sob teste:** `apps/web/src/styles.css`, linhas **1826–1879** (bloco `@media print` — o único do produto)

**Resultado: 30 reprovações. 6 delas destroem a informação no papel.**

---

## 0. Duas premissas do briefing que a medição derrubou

| Premissa | Medido | Veredito |
|---|---|---|
| "Reports.tsx tem `@media print`" | `grep -c print apps/web/src/pages/Reports.tsx` = **0**. O único `@media print` do produto está em `styles.css:1828`. | **Falso** |
| "há classes `.no-print` espalhadas" | `.no-print` aparece **1 vez** em todo o código (`History.tsx:145`), num `<button>` que já é escondido por `button{display:none}`. Elementos `.no-print` no DOM: **0** em 8 das 9 telas, **1** em Histórico. | **Falso** — a classe é decorativa |

O comentário em `styles.css:1846-1852` diz *"Reports.tsx imprime, então isto não é hipótese"*. Reports.tsx não imprime nada: não tem CSS de impressão nem botão de impressão. O comentário aponta para um arquivo que não participa.

---

## 1. Método

1. **Medição no DOM em `media: print`**, com a viewport na **largura imprimível real**: A4 (210 mm) − 2×10 mm de margem = **190 mm = 718 px @96 dpi**. Um primeiro passe usou 718→794 px e subestimou o corte; o número de 718 px é o que vale. Scripts em `/tmp/print-audit.mjs`, `/tmp/pass2.mjs`, `/tmp/pass3.mjs`, `/tmp/pass4.mjs`.
2. **Três PDFs por tela**: colorido (`printBackground:true`), **sem fundo** (`printBackground:false` — a configuração **padrão** do navegador) e **escala de cinza** (filtro `grayscale(100%)` sobre `.badge,.dot,.banner,.chip,svg`).
3. **Leitura visual dos PDFs** rasterizando cada folha no visualizador PDF do próprio Chromium (`/tmp/rast2.mjs`) — não em captura de tela da página, porque a casca tem contêiner de rolagem e `fullPage` fica preso em 1 123 px (uma folha). Toda captura de página inteira desta casca é enganosa; só o PDF mostra a paginação.
4. **Cinza calculado**, não estimado: cor computada lida do DOM vivo → composição alfa sobre o fundo real do papel → luminância Rec.709 (`0,2126R + 0,7152G + 0,0722B`) e razão de contraste WCAG.

**Entregáveis:** `docs/marca/impressao/` — 27 PDFs (9 telas × 3 variantes) + `provas/` com 11 folhas rasterizadas.

---

## 2. Paginação — quantas folhas cada tela cospe

Contagem real de objetos `/Type /Page` nos PDFs gerados.

| Tela | Linhas / cards | **Páginas A4** | Altura do conteúdo | Folhas de conteúdo | Sobra |
|---|---|---|---|---|---|
| Relatórios · Curva ABC | 100 | **10** | 8 994 px | 8,6 | +16 % |
| Relatórios · Giro | 150 | **13** | 11 236 px | 10,7 | +21 % |
| Relatórios · Cobertura | 86 | **6** | 4 967 px | 4,7 | +27 % |
| Relatórios · Transferências | **200** | **22** | 20 380 px | 19,5 | +13 % |
| Relatórios · Marcas × bandeiras | 40 | **5** | 3 633 px | 3,5 | +43 % |
| Histórico | — | **2** | 1 123 px | 1,1 | — |
| Decisões | 382 cards | **140** | 133 462 px | 127,5 | +10 % |
| Alertas | **2 176** | **171** | 165 380 px | 158,0 | +8 % |
| Planejamento | 501 + 20 + 30 + … | **65** | 101 404 px | 96,9 | — |
| **TOTAL** | | **434 folhas A4** | | | |

**Resposta direta à pergunta 4 do briefing:** a tabela de **200 linhas** (Relatórios → Transferências, 4 colunas) gera **22 páginas** — 9,5 linhas por folha, com altura de linha de até 134 px.

Imprimir Alertas uma vez = **171 folhas**. Não há limite, recorte de impressão, paginação de tela nem aviso. O botão que dispara isso não existe (§7), mas `Ctrl+P` existe.

---

## 3. A tabela cabe na folha? Colunas cortadas

Área imprimível = **718 px**. Elemento com `right > 718 px` é cortado — Chromium **não** encolhe para caber em `page.pdf(scale:1)`; ele **clipa**.

### 3.1 Cabe (8 tabelas)

| Tela | Largura | Colunas | Veredito |
|---|---|---|---|
| Relatórios · ABC | 684 px | 6 | cabe |
| Relatórios · Giro | 684 px | 6 | cabe |
| Relatórios · Cobertura | 684 px | 4 | cabe |
| Relatórios · Transferências | 684 px | 4 | cabe |
| Relatórios · Marcas | 684 px | 6 | cabe |
| Alertas (principal) | 684 px | 6 | cabe |
| Alertas (secundária) | 648 px | 4 | cabe |
| Planejamento (3 tabelas menores) | 648 px | 4 | cabe |

### 3.2 **NÃO cabe — Planejamento** (4 tabelas)

| Tabela | Largura | Cols | Cortadas | Fora da folha inteiramente |
|---|---|---|---|---|
| **Recomendação de compra** | **1 126 px** (+425 px) | 10 | **5** | **4**: `Confiança`, `Comprar`, `Pedir até`, `Capital` |
| Transferências sugeridas | 756 px (+73 px) | 5 | 2 | 1: `Ação` |
| Compras por fornecedor | 833 px (+151 px) | 8 | 2 | 1: `Confiança` |
| Fornecedor (resumo) | 763 / 743 px | 8 | 1 | 0 (`Confiança` parcial) |

**Prova visual:** `provas/planejamento-p14-colunas-cortadas.png`. A folha termina no meio da palavra **"CONFIANÇ"**. As colunas `Comprar`, `Pedir até` e `Capital` — **a quantidade a comprar e o dinheiro** — simplesmente não existem no papel. É um relatório de compras impresso sem o número de compra.

---

## 4. Quebra de página

### 4.1 O cabeçalho da tabela repete — **funciona**

`thead { display: table-header-group }` (styles.css:1877) está correto e foi verificado nas 9 telas: `getComputedStyle(thead).display === 'table-header-group'` em 100 % das tabelas, e visualmente em `provas/relatorios-abc-p2-cabecalho-repete.png` e `provas/planejamento-p15-linha-partida-ao-meio.png`.

### 4.2 O cabeçalho do **relatório** não repete — reprovado

A partir da folha 2 nenhuma folha tem título, data, recorte, filtro ou loja. Em Alertas são **170 folhas anônimas**. Cai uma no chão e não há como saber de que relatório é.

### 4.3 A linha quebra no meio — reprovado

`tr` tem `break-inside: auto` (medido nas 12 tabelas). Não há regra nenhuma para isso.

**Prova:** `provas/planejamento-p15-linha-partida-ao-meio.png`. A folha 15 abre com o cabeçalho repetido (`PRODUTO | GIRO | …`) e imediatamente abaixo dele aparece **o rabo de uma linha partida na folha 14**: `ESPORTIVOS LTDA · entrega em 14d`, sem SKU, sem produto, sem nenhum número. Lido no papel, parece uma linha própria — um fornecedor sem produto.

Onde a linha é baixa (Transferências, 134 px máx.) a quebra sai limpa entre linhas e sobra uma faixa creme no pé (`provas/transferencias-p3-quebra-limpa-entre-linhas.png`). Onde a linha é alta — Planejamento tem linhas de até **523 px**, metade de uma folha — ela racha.

### 4.4 `.card { break-inside: avoid }` num bloco de 156 folhas

O `.card` que **envolve a tabela inteira** herda `break-inside: avoid` (styles.css:1841):

| Tela | Altura do card | Em folhas |
|---|---|---|
| Alertas | **163 818 px** | **156,5** |
| Planejamento | 9 869 px | 9,4 |
| Relatórios ABC | 8 148 px | 7,8 |

Pedir a um bloco de 156 folhas que "não quebre" é uma contradição. O Chromium honra o pedido até onde dá: **empurra o bloco para o começo da folha seguinte** e deixa o resto da folha 1 em branco — e então quebra o bloco assim mesmo.

**Consequência medida (folha 1 quase vazia):**
- `provas/planejamento-p1-85pct-vazia.png` — título, dois `<select>` e um rótulo. **~85 % da folha é creme vazio.**
- `provas/alertas-p1-folha-metade-vazia.png` — 3 indicadores. **~50 % vazio.**

Nenhuma regra `orphans` / `widows` / `break-before` / `break-after` / `@page` existe no arquivo (`grep` = 0 ocorrências).

---

## 5. O fundo creme foi impresso?

**Depende da caixinha "Gráficos de plano de fundo" do navegador — e as duas respostas são ruins de jeitos diferentes.**

`.macos-window` e `.window-main` têm `background: rgb(246,242,233)` (`#F6F2E9`) e **cobrem 100 % da área de conteúdo fluída**, em todas as 9 telas:

| Tela | Área de creme (px²) |
|---|---|
| Alertas | 118 742 627 |
| Decisões | 95 825 694 |
| Planejamento | 72 808 274 |
| Transferências | 14 632 750 |

A regra `body { background: #fff !important }` (styles.css:1857) **não alcança**: `.macos-window` está por dentro do `body` e declara o próprio fundo.

### Cenário A — "imprimir cores de fundo" **LIGADO** (`alertas.pdf`)
As **434 folhas** saem inundadas de creme de borda a borda. `provas/alertas-p1-folha-metade-vazia.png`: a folha inteira é um retângulo creme, e mais da metade dele não tem uma letra em cima. Em área: 434 × (190×277 mm) ≈ **22,8 m² de creme sólido**.

### Cenário B — **DESLIGADO**, o padrão de fábrica (`alertas--sem-fundo.pdf`)
O creme some e a folha fica branca e limpa — `provas/alertas-p1-SEM-FUNDO-padrao-do-navegador.png`.

**E aqui uma coisa que passa:** o `print-color-adjust: exact` das linhas 1853-1855 **funciona**. Mesmo com fundos desligados, o preenchimento do selo `.badge` sobrevive — `provas/alertas-p2-SEM-FUNDO-selo-sobrevive.png` mostra o `RUPTURA` ainda com o fundo rosado enquanto o creme do card desapareceu. Essa é a única parte do bloco `@media print` que faz exatamente o que o comentário promete.

**O problema:** o produto não escolhe. O mesmo CSS produz um retângulo creme de 22 m² ou uma folha branca conforme uma caixinha que o cliente não sabe que existe.

---

## 6. Escala de cinza — onde a cor não existe

Cinza = luminância Rec.709 da cor computada, composta em alfa sobre o fundo real. Papel creme (`#F6F2E9`), que é o cenário A.

| Estado | Fundo do selo (cinza 0-255) | Texto (cinza) | Contraste texto/selo | Filete esquerdo |
|---|---|---|---|---|
| **verde** · saudável | 224,1 | 91,5 | 8,10 : 1 | 1 px |
| **âmbar** · atenção | 220,2 | 72,6 | 9,88 : 1 | 2 px |
| **vermelho** · crítico | 220,4 | 44,4 | 13,53 : 1 | 3 px |
| **azul** · neutro/novo | 220,3 | 36,3 | 11,29 : 1 | 1 px |
| **cinza** · baixa | 255,0 (transparente) | 84,1 | 7,52 : 1 | 1 px |

### 6.1 O preenchimento do selo carrega **zero** informação — reprovado

Âmbar **220,2** · vermelho **220,4** · azul **220,3**. **Amplitude de 0,2 nível de cinza em 255.** Verde a 224,1, a 3,7 de distância.

Nenhum olho, nenhuma impressora e nenhuma fotocopiadora separa isso. Prova visual: `provas/alertas-p2-CINZA-selo-sem-cor.png` — o `RUPTURA` em cinza tem o preenchimento indistinguível do creme ao redor. Só a palavra e o triângulo sobrevivem.

### 6.2 Dois pares de estados colapsam no mesmo tom — reprovado

Os 10 pares ordenados por distância do **texto** em cinza:

| Par | Δ fundo | Δ texto |
|---|---|---|
| **verde (saudável) × cinza (baixa)** | 18,1 | **7,4** ← colapsa |
| **vermelho (crítico) × azul (neutro/novo)** | **0,1** | **8,1** ← colapsa |
| âmbar × cinza | 22,0 | 11,4 |
| verde × âmbar | 3,9 | 18,8 |
| âmbar × vermelho | 0,2 | 28,3 |
| âmbar × azul | 0,1 | 36,4 |
| vermelho × cinza | 21,8 | 39,7 |
| verde × vermelho | 3,7 | 47,1 |
| azul × cinza | 21,9 | 47,8 |
| verde × azul | 3,8 | 55,2 |

Em Decisões, `Alta` (vermelho) e `Novo` (azul) ficam **do mesmo tom** no papel P&B. `Saudável` (verde) e `Baixa` (cinza) idem.

### 6.3 O que a Onda 1 consertou **funcionou** — e o que ela não viu

`styles.css:78-91` conta que os três estados tinham luminância quase igual (razão 1,08 a 1,19) e foram reseparados. **Verificado: funcionou.** Verde 91,5 / âmbar 72,6 / vermelho 44,4 — razões 1,26 e 1,63, bem separados.

Mas o comentário promete **três canais** ("rótulo escrito, filete esquerdo com espessura crescente e a luminância separada dos tons"). Medido:

- **luminância do fundo:** não separa nada (§6.1);
- **filete:** verde, azul e cinza compartilham **1 px**. O canal separa 3 de 5 estados, e mesmo assim exige dois selos lado a lado para comparar espessura — o que nunca acontece numa coluna de tabela;
- **luminância do texto:** falha em 2 dos 10 pares (§6.2);
- **rótulo escrito:** **este sim sobrevive sempre.**

Ou seja: no papel P&B o produto está de pé por **um** canal, não por três. O comentário superestima a própria defesa.

### 6.4 `.dot` — informação exclusivamente por cor — reprovado

`.dot` mede **11 × 3 px**, tem `background` sólido e **texto vazio**. Presente nas 9 telas (o traço verde do selo `DADOS AO VIVO`). Não tem rótulo, não tem filete, não tem forma distintiva neste uso. E por causa do `print-color-adjust: exact` ele **sobrevive até com fundos desligados** — vira um tracinho cinza no papel, sem significado nenhum.

---

## 7. Cromo de navegação: escondeu o que não serve no papel?

Medido em `media: print`, viewport 718 px, contando elementos com `display ≠ none` e retângulos de layout.

### 7.1 Escondeu corretamente

| Seletor | Elementos no DOM | Visíveis no papel |
|---|---|---|
| `.sidebar` | 1 em 9/9 telas | **0** |
| `.dock` | 1 em 9/9 telas | **0** |
| `.demo-seal` | 1 em 9/9 telas | **0** |
| `.segmented` | 1 a 4 por tela | **0** |
| `button` | 18 a **2 190** por tela | **0** |

### 7.2 Não escondeu — reprovado

| O que | Onde | Por quê |
|---|---|---|
| **`.titlebar`** — a barra `ALERTAS · RECORTE · ─ DADOS AO VIVO` | **9/9 telas** | **`.topbar` do `@media print` casa com 0 elementos em 9/9 telas.** A classe não existe no produto. A barra real é `.titlebar` (`AdminShell.tsx:273`), e ela nunca foi escondida. |
| **`<select>`** com a seta de dropdown | 3 em Alertas, 3 em Relatórios, 4 em Planejamento, 1 em Transferências | não está na regra |
| **`<input>`** — caixas de texto editáveis | **2 176** em Alertas (coluna `Ajustar mínimo`, uma por linha, ao longo de 171 folhas), 17 em Planejamento | não está na regra |
| `.toolbar` | 2 em quase todas | não está na regra |
| `a[href]` | 1 em Alertas | sem indicação de destino no papel |
| `svg` (ícones dentro dos selos) | 2 500 em Planejamento, 2 180 em Alertas, 1 543 em Decisões | traçado vetorial por ícone; é o que faz o PDF em cinza estourar |

**Prova:** `provas/alertas-p2-campos-editaveis-impressos.png` — 171 folhas de campos de formulário vazios impressos em papel.

### 7.3 O efeito colateral de `button { display: none }`

`.segmented` é o seletor de aba de Relatórios, e ele é escondido por ser `<button>`. As **cinco abas imprimem com o mesmo `<header>`**: "Relatórios" + o subtítulo genérico *"Curva ABC (SKU ou marca), giro, cobertura de estoque e transferências sugeridas — todos exportáveis em CSV."*

**Nada no papel diz qual das cinco você está segurando.** Compare `relatorios-abc.pdf` e `relatorios-giro.pdf`: folha 1 idêntica no cabeçalho; só os indicadores mudam.

### 7.4 Nenhuma tela de relatório tem botão de imprimir

`window.print()` aparece **uma vez** no produto: `History.tsx:147`. Histórico é a única tela com botão de impressão — e é a única que **não** é um relatório. As cinco abas de Relatórios, Decisões, Alertas e Planejamento não têm nenhum caminho de impressão na interface. O comentário em `History.tsx:139` já admite que esse botão leva a página inteira, indicadores e tudo.

---

## 8. Tabela completa de reprovações

| # | Gravidade | Seletor / arquivo | Reprovação | Medida |
|---|---|---|---|---|
| 01 | **crítica** | `table` em Planning.tsx | Tabela de 10 colunas não cabe; 4 colunas caem fora da folha | 1 126 px vs 718 px (+425) |
| 02 | **crítica** | `tr` (todas as tabelas) | Linha parte ao meio na quebra de página | `break-inside: auto` |
| 03 | **crítica** | `.badge` (fundo) | Preenchimento não distingue estado em P&B | Δ 0,2 / 255 entre âmbar, vermelho e azul |
| 04 | **crítica** | `.macos-window`, `.window-main` | Creme `#F6F2E9` inunda 100 % de 434 folhas | 118,7 M px² só em Alertas |
| 05 | **crítica** | `.card > table` (Alertas) | 171 folhas A4 numa impressão | 2 176 linhas |
| 06 | **crítica** | `.topbar` em `styles.css:1834` | Seletor morto; a barra real `.titlebar` imprime | 0 elementos em 9/9 telas |
| 07 | alta | `input` | 2 176 campos editáveis impressos | Alertas, col. `Ajustar mínimo` |
| 08 | alta | `.badge red` × `.badge blue` | Crítico e neutro no mesmo tom em P&B | texto cinza 44,4 vs 36,3 (Δ 8,1) |
| 09 | alta | `.badge green` × `.badge gray` | Saudável e baixa no mesmo tom em P&B | texto cinza 91,5 vs 84,1 (Δ 7,4) |
| 10 | alta | `@page` (ausente) | Sem numeração, sem tamanho, sem margem declarada | 0 ocorrências no arquivo |
| 11 | alta | `header` / cabeçalho do relatório | Folhas 2+ sem título, data, recorte ou loja | 170 folhas anônimas em Alertas |
| 12 | alta | `.segmented` via `button{display:none}` | As 5 abas de Relatórios imprimem com cabeçalho idêntico | comparação `abc.pdf` × `giro.pdf` |
| 13 | alta | `.card { break-inside: avoid }` | `avoid` num bloco de 156,5 folhas; empurra e esvazia a folha 1 | card de 163 818 px |
| 14 | alta | folha 1 de Planejamento | ~85 % da folha em creme vazio | prova visual |
| 15 | alta | folha 1 de Alertas | ~50 % da folha vazia | prova visual |
| 16 | alta | `.dot` | 11×3 px, sem texto: informação só por cor; sobrevive ao "sem fundo" | `print-color-adjust: exact` |
| 17 | alta | `table` de Transferências (Planning) | Colunas `Cobertura no destino` e `Ação` cortadas | right 791 px vs 718 |
| 18 | alta | `table` de Compras por fornecedor | Colunas `Pedir até` e `Confiança` cortadas | right 869 px vs 718 |
| 19 | média | `select` | Controle de formulário impresso com seta de dropdown | 3+3+4+1 elementos |
| 20 | média | Decisões | 140 folhas por impressão, sem recorte | 382 cards |
| 21 | média | Planejamento | 65 folhas por impressão | — |
| 22 | média | `.badge` filete | 1 px compartilhado por verde, azul e cinza | 3 de 5 estados sem separação |
| 23 | média | `Reports.tsx` | Nenhuma ação de impressão nas 5 telas que o cliente imprime | `window.print()` = 0 |
| 24 | média | `History.tsx:139-147` | Único botão de imprimir leva a tela inteira, sem recorte | admitido no próprio comentário |
| 25 | média | `.toolbar` | Impresso em 8/9 telas | 2 por tela |
| 26 | média | `svg` | 2 500 / 2 180 / 1 543 ícones sem tratamento de impressão | Planejamento / Alertas / Decisões |
| 27 | baixa | `.no-print` | Classe existe em 1 lugar e é redundante com `button{display:none}` | 1 ocorrência |
| 28 | baixa | `a[href]` | Link impresso sem destino visível | 1 em Alertas |
| 29 | baixa | `orphans` / `widows` | Ausentes | 0 ocorrências |
| 30 | baixa | `.card { border: 1px solid #ccc }` | Única cor literal do bloco de impressão, fora do sistema de tokens | `styles.css:1843` |

---

## 9. O que mudar no `@media print` — seletor e regra

Substituir o bloco `styles.css:1828-1879`.

### 9.1 Folha, margem e numeração — não existe hoje

```css
@page {
  size: A4;
  margin: 14mm 12mm 16mm;
}
/* Retrato não cabe a tabela de 10 colunas de Planejamento. */
@page landscape { size: A4 landscape; }
```

Numeração real exige um contador de página; como `content: counter(page)` só funciona dentro de margin boxes (que o Chromium ainda não implementa), a saída honesta é **imprimir o rodapé pelo diálogo do navegador** (`headerTemplate`/`footerTemplate` quando o PDF for gerado pelo servidor) **ou** repetir a identificação via `tfoot`/`thead` (§9.4).

### 9.2 Matar o creme — o `body{background:#fff}` de hoje não alcança

```css
@media print {
  /* O fundo creme está em .macos-window e .window-main, não no body.
     Sem isto o papel recebe 22 m² de creme sólido quando o usuário deixa
     "gráficos de plano de fundo" ligado. */
  html, body, .macos-window, .window-main, .shell, .content,
  .card, .card.stat, article.card, .table, thead, tbody tr {
    background: #fff !important;
    box-shadow: none !important;
  }
  /* O selo de estado é a exceção: ele PRECISA do preenchimento.
     Isto já existe e funciona — manter. */
  .badge, .dot, .banner {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
```

### 9.3 Esconder o cromo que sobrou — trocar o seletor morto

```css
@media print {
  .demo-seal,
  .sidebar,
  .dock,
  .titlebar,          /* ← ERA .topbar, que casa com 0 elementos */
  .toolbar,
  .no-print,
  .segmented,
  button,
  input,              /* ← 2.176 campos editáveis impressos em Alertas */
  textarea {
    display: none !important;
  }

  /* <select> não pode sumir: o valor escolhido É o recorte do relatório.
     Some com a moldura de controle e deixa só o texto. */
  select {
    appearance: none !important;
    -webkit-appearance: none !important;
    border: 0 !important;
    background: none !important;
    padding: 0 !important;
    font: inherit !important;
    color: #000 !important;
  }
}
```

### 9.4 Quebra de página

```css
@media print {
  /* A linha não pode rachar. Provado na folha 14→15 de Planejamento. */
  table tr, table td, table th { break-inside: avoid !important; }

  /* break-inside:avoid num card de 156 folhas empurra o bloco e esvazia a
     folha 1. Só cards CURTOS podem pedir para não quebrar. */
  .card { break-inside: auto !important; }
  .card.stat { break-inside: avoid !important; }
  article.card { break-inside: avoid !important; }

  thead { display: table-header-group; }   /* já existe e funciona — manter */
  tfoot { display: table-footer-group; }   /* rodapé de identificação por folha */

  h1, h2, h3, .page-title { break-after: avoid !important; }
  p, li { orphans: 3; widows: 3; }
}
```

### 9.5 Tabela larga — o corte de Planejamento

Regra de CSS só resolve metade; a outra metade é decidir o que sai. As três saídas, em ordem de preferência:

```css
@media print {
  /* a) tipografia menor + layout fixo devolve ~30 % de largura */
  .table, table { font-size: 8.5pt !important; table-layout: fixed !important; }
  .table td, .table th { padding: 4px 6px !important; word-break: break-word; }

  /* b) colunas que não são dado: fora do papel.
        A coluna de ação/checkbox não tem função impressa. */
  .table .col-acao, .table .col-selecao { display: none !important; }
}
```

**c)** Para Planejamento, 10 colunas × 718 px não fecha nem a 8,5 pt: `Comprar`, `Pedir até` e `Capital` são o produto do relatório e não podem ser as cortadas. A decisão tem de ser tomada no componente, não no CSS — paisagem para essa tela (`@page landscape`) ou uma versão de impressão com as colunas que decidem a compra e sem `Recomendação` (o texto longo que consome 132 px por linha).

### 9.6 Identificação em toda folha

Nenhuma folha a partir da 2 diz de que relatório é. O `@media print` sozinho não cria conteúdo; é preciso um `<tfoot>` (ou `<thead>` de segunda linha) no componente com título + recorte + data, e então:

```css
@media print {
  tfoot .print-id { display: table-row !important; font-size: 7pt; color: #000; }
}
```

### 9.7 Cor: o que precisa mudar fora do CSS de impressão

Nenhuma regra de `@media print` conserta §6. Os selos precisam de um segundo canal **de forma**, não de tom:

- **`.dot`**: dar forma por estado (círculo cheio / anel / quadrado) ou um rótulo `aria`+visível. Hoje é 11×3 px de cor pura.
- **`.badge`**: o preenchimento é inútil em P&B (Δ 0,2/255). Trocar o preenchimento por **trama** (`repeating-linear-gradient` com ângulo distinto por estado) dentro do `@media print`, mantendo `print-color-adjust: exact`.
- **`.badge blue` × `.badge red`** e **`.badge green` × `.badge gray`**: separar a luminância do texto — hoje Δ 8,1 e Δ 7,4, indistinguíveis. Ou dar filete distinto (azul e cinza dividem 1 px com o verde).

---

## 10. O que já funciona — para não quebrar sem querer

1. **`thead { display: table-header-group }`** repete o cabeçalho da tabela em todas as 12 tabelas medidas, em todas as folhas. Verificado no DOM e visualmente.
2. **`print-color-adjust: exact`** em `.badge/.dot/.banner` sobrevive à configuração padrão do navegador ("gráficos de plano de fundo" desligado). O selo mantém o preenchimento enquanto o creme desnecessário some. É a única linha do bloco que entrega o que o comentário promete.
3. **A reseparação de luminância da Onda 1** (`styles.css:78-91`) funcionou para os três estados centrais: verde 91,5 / âmbar 72,6 / vermelho 44,4, razões 1,26 e 1,63. O que ficou de fora foram os estados **azul** e **cinza**, que entraram depois e colidem.
4. **Oito das doze tabelas cabem** em 718 px sem corte nenhum.
5. `.sidebar`, `.dock`, `.demo-seal`, `.segmented` e todos os 2 190 `<button>` de Alertas somem corretamente.

---

## 11. Arquivos

```
docs/marca/impressao/
  <tela>.pdf                 fundos LIGADOS  (cenário A: creme impresso)
  <tela>--sem-fundo.pdf      fundos DESLIGADOS (padrão do navegador)
  <tela>--cinza.pdf          escala de cinza sobre .badge/.dot/.banner/svg
  provas/                    11 folhas rasterizadas, uma por achado
```

Telas: `relatorios-abc`, `relatorios-giro`, `relatorios-cobertura`, `relatorios-transferencias`, `relatorios-marcas`, `historico`, `decisoes`, `alertas`, `planejamento`.

Scripts de medição (descartáveis): `/tmp/print-audit.mjs`, `/tmp/pass2.mjs`, `/tmp/pass3.mjs`, `/tmp/pass4.mjs`, `/tmp/rast2.mjs`, `/tmp/cinza.mjs`.
Dados brutos: `/tmp/print-medidas.json`, `/tmp/pass2.json`, `/tmp/pass3.json`.
