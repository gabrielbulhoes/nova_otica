# Auditoria de contraste e daltonismo — o PRODUTO renderizado

**Onda 4 · frente "contraste e daltonismo no DOM renderizado"**
**Data da medição:** 2026-07-31 · **Build:** `VITE_DEMO=1 VITE_HASH_ROUTER=1` sobre `apps/web/dist`
**Motor:** Chromium 1194 headless, viewport 1600×1000, DPR 1, `--force-color-profile=srgb`
**Norma:** WCAG 2.1 — 1.4.3 (contraste mínimo), 1.4.11 (não-textual), 1.4.1 (uso de cor), 2.4.7 (foco visível)

---

## O que esta auditoria é, e o que ela não é

O relatório da Onda 1 (`docs/marca/CONTRASTE-NANOFLOW.md`) mediu **a paleta**: pares de
token contra token. Este mede **o que o navegador pinta**. A diferença não é acadêmica:
um token reprovado que o produto nunca usa não é defeito, e um token aprovado aplicado
sobre a superfície errada é. Onde os dois divergem, o número medido aqui ganha —
está na seção "Divergências com a Onda 1".

### Método, para poder ser refeito

Para **cada nó de elemento com texto próprio** (nós de texto diretos, não herdados de
filhos), em cada uma das 17 rotas e nos dois temas:

1. `getComputedStyle` devolve `color`, `font-size`, `font-weight` e
   `-webkit-text-fill-color`.
2. O **fundo** não é lido do elemento: é montado subindo a árvore de ancestrais,
   acumulando cada `background-color` com alfa e parando no primeiro fundo opaco —
   exatamente o que o compositor do navegador faz. A tela cai em branco (`#ffffff`),
   que é o fundo do canvas.
3. A **opacidade** de cada ancestral é multiplicada em cadeia e aplicada tanto à tinta
   quanto a cada camada de fundo. Um texto preto dentro de um `opacity:.5` não é preto.
4. Onde há `linear-gradient`, todas as paradas de cor são extraídas e a auditoria
   reporta a **pior** delas.
5. Luminância relativa `L = 0.2126·R + 0.7152·G + 0.0722·B` sobre canais linearizados
   (`c/12.92` se `c ≤ 0.03928`, senão `((c+0.055)/1.055)^2.4`); razão
   `(L_claro + 0.05)/(L_escuro + 0.05)`.

**Limiar por tamanho REAL medido**, na definição normativa (18pt = 24px), que é a mais
restritiva: `≥ 4.5:1` abaixo de 24px; `≥ 3.0:1` a partir de 24px, ou a partir de
18.66px se `font-weight ≥ 700`; `≥ 3.0:1` para borda, filete, traço de ícone e anel de
foco (1.4.11).

### Validação do instrumento

Antes de medir o produto, a ferramenta foi rodada contra 11 controles de valor
conhecido. Ela precisa **reprovar** o que deve reprovar, senão o "0 reprovações" não
vale nada:

| controle | esperado | medido | veredito |
| --- | --- | --- | --- |
| `#C9A227` sobre `#F6F2E9` | 2.17 | **2.17** | reprova, correto |
| `#8A6914` sobre `#F6F2E9` | 4.57 | **4.57** | passa, correto |
| `rgba(232,237,247,.35)` sobre `#0E1116` | composição de alfa | **2.90** | reprova, correto |
| `#777` sobre `rgba(0,0,0,.06)` sobre papel | composição de camada | **3.51** (fundo `#e7e3db`) | reprova, correto |
| `#000` dentro de `opacity:.5` | cadeia de opacidade | **3.89** (α 0.5) | reprova, correto |
| texto sobre `linear-gradient(#F6F2E9,#1a1a1a)` | pior parada | **1.13** | reprova, correto |
| cinza `#8f8f8f` a 28px | limiar 3.0 | 2.89, **reprova** | classificação correta |
| cinza `#8f8f8f` a 19px/700 | limiar 3.0 | 2.89, **reprova** | classificação correta |
| cinza `#8f8f8f` a 19px/400 | limiar 4.5 | 2.89, **reprova** | classificação correta |

O instrumento compõe alfa, encadeia opacidade, resolve gradiente e classifica tamanho
corretamente. Os números abaixo podem ser lidos como medida, não como estimativa.

### Armadilhas encontradas na própria coleta (registradas para quem repetir)

- **As rotas do briefing estão erradas.** O `App.tsx` aninha as telas administrativas
  sob `/admin`: o endereço real é `/#/admin/bi`, não `/#/bi`. Navegar para `/#/bi` cai
  no `<Route path="*">` e volta ao launcher. Uma primeira passada mediu 14 launchers
  achando que media 14 telas — e teria reportado "0 reprovações" com folga.
- **`page.goto` com hash recarrega o documento e derruba a sessão.** A navegação tem de
  ser `window.location.hash = ...` dentro da página.
- **Ler o foco 80 ms depois do `Tab` mede a transição pela metade.** `styles.css` tem
  `transition: border-color .12s, box-shadow .12s`. Todas as medidas de foco aqui foram
  tomadas 420 ms após o `Tab`.
- **`el.focus()` por script não dispara `:focus-visible`.** Toda a varredura de foco foi
  feita por `Tab` de teclado, que é o caminho real do usuário.

---

## RESUMO EXECUTIVO

**68.916 nós de texto** e **93.434 medidas de componente** (borda, filete, traço de
ícone), em 17 rotas × 2 temas. Mais 84 pseudo-elementos e placeholders, 66 paradas de
`Tab` e 24 telas de gráfico amostradas pixel a pixel.

| critério | medidas | reprovações | defeitos distintos | veredito |
| --- | --- | --- | --- | --- |
| **1.4.3** texto vs fundo | 68.916 nós | 4 instâncias | **4** | o corpo do produto está limpo |
| **1.4.11** borda/filete informativo | 3.406 instâncias | 31 assinaturas | **11** | falha concentrada em botões (claro) e action-cards (escuro) |
| **1.4.11** filete decorativo | 61.468 instâncias | 77 assinaturas | 0 | **isento** — separador de tabela e moldura de cartão não carregam informação |
| **2.4.7 / 1.4.11** anel de foco | 66 paradas de `Tab` | 6 instâncias | **4** | campo de texto e multi-select ficaram sem anel |
| **1.4.1** uso de cor / daltonismo | 12 conjuntos, 130 pares | 35 pares frágeis | **12** | 11 pares graves de gráfico + 1 ícone duplicado |
| pseudo-elemento / placeholder | 84 | 20 instâncias / 5 assinaturas | (contado em 1.4.11) | filete `--ouro` puro a 2.17:1 |

**Total de defeitos distintos verificados: 31.**

O "defeito distinto" é a causa única, não a instância: os 2.808 botões fantasma do tema
claro que reprovam a 1.72:1 são **um** defeito, numa linha de CSS. A contagem de
instâncias está na tabela de cobertura (seção 1) e na de assinaturas (seção 3.6).

### O veredito em três frases

1. **O texto do produto está bom.** De 68.916 nós medidos, 4 reprovam — e os 4 estão no
   tema escuro, todos na mesma causa raiz: quatro tokens de estado do tema claro que
   ninguém trocou quando o escuro foi escrito. Isso é uma correção de seis linhas de CSS.
2. **O que reprova de verdade não é texto — é contorno.** No tema claro, o limite de
   **todo botão** do console fica entre 1.72:1 e 2.17:1; o botão não tem fundo, então a
   borda é a única coisa que diz onde ele começa. No tema escuro, os quatro filetes do
   centro de ação de Planejamento ficam entre 1.61:1 e 2.78:1.
3. **O anel de foco desaparece exatamente no controle mais usado do console.** O campo
   de busca e o seletor de lojas perdem o `outline` global por um acidente de
   especificidade e ficam com um brilho de 1.28:1 (claro) / 2.30:1 (escuro).

---

## 1 · Cobertura — o que foi medido, rota por rota

Toda linha abaixo foi confirmada carregada (o `<h1>` da tela foi lido e comparado; nenhuma
rota caiu no launcher).

| rota | tela | tema | nós de texto medidos | reprovam 1.4.3 | componentes medidos | bordas/traços < 3:1 |
| --- | --- | --- | --- | --- | --- | --- |
| `/#/admin` | Dashboard | claro | 178 | 0 | 200 | 163 |
| `/#/admin` | Dashboard | escuro | 178 | 0 | 200 | 158 |
| `/#/admin/bi` | BI | claro | 69 | 0 | 64 | 40 |
| `/#/admin/bi` | BI | escuro | 69 | 0 | 64 | 26 |
| `/#/admin/estoque` | Estoque | claro | 2045 | 0 | 2232 | 2014 |
| `/#/admin/estoque` | Estoque | escuro | 2045 | 0 | 2232 | 2009 |
| `/#/admin/produtos` | Produtos | claro | 2545 | 0 | 3536 | 3521 |
| `/#/admin/produtos` | Produtos | escuro | 2545 | 0 | 3536 | 3516 |
| `/#/admin/transferencias` | Transferências | claro | 296 | 0 | 255 | 206 |
| `/#/admin/transferencias` | Transferências | escuro | 296 | 0 | 255 | 168 |
| `/#/admin/alertas` | Alertas | claro | 13149 | 0 | 24007 | 17459 |
| `/#/admin/alertas` | Alertas | escuro | 13149 | 0 | 24007 | 15277 |
| `/#/admin/relatorios` | Relatórios | claro | 760 | 0 | 744 | 726 |
| `/#/admin/relatorios` | Relatórios | escuro | 760 | **1** | 744 | 718 |
| `/#/admin/decisoes` | Decisões | claro | 7823 | 0 | 5040 | 2558 |
| `/#/admin/decisoes` | Decisões | escuro | 7823 | 0 | 5040 | 810 |
| `/#/admin/historico` | Histórico | claro | 52 | 0 | 41 | 25 |
| `/#/admin/historico` | Histórico | escuro | 52 | 0 | 41 | 16 |
| `/#/admin/estrategia` | Estratégia | claro | 69 | 0 | 47 | 25 |
| `/#/admin/estrategia` | Estratégia | escuro | 69 | 0 | 47 | 19 |
| `/#/admin/planejamento` | Planejamento | claro | 6797 | 0 | 9789 | 7223 |
| `/#/admin/planejamento` | Planejamento | escuro | 6797 | **2** | 9789 | 7112 |
| `/#/admin/vendas` | Vendas | claro | 256 | 0 | 261 | 243 |
| `/#/admin/vendas` | Vendas | escuro | 256 | 0 | 261 | 235 |
| `/#/admin/usuarios` | Usuários | claro | 61 | 0 | 71 | 46 |
| `/#/admin/usuarios` | Usuários | escuro | 61 | 0 | 71 | 34 |
| `/#/admin/lojas` | Lojas | claro | 137 | 0 | 201 | 168 |
| `/#/admin/lojas` | Lojas | escuro | 137 | **1** | 201 | 162 |
| `/#/admin/sincronizacao` | Sincronização | claro | 49 | 0 | 38 | 24 |
| `/#/admin/sincronizacao` | Sincronização | escuro | 49 | 0 | 38 | 18 |
| `/#/loja` | Vitrine | claro | 160 | 0 | 182 | 100 |
| `/#/loja` | Vitrine | escuro | 160 | 0 | 182 | 50 |
| `/#/loja/carrinho` | Carrinho | claro | 12 | 0 | 9 | 3 |
| `/#/loja/carrinho` | Carrinho | escuro | 12 | 0 | 9 | 2 |
| **TOTAL** | | | **68916** | **4** | **93434** | **64874** |

> **Leitura da última coluna.** As 64.874 "bordas < 3:1" são, em 95% dos casos, o filete
> de linha de tabela (`td`, 49.780 instâncias) e a moldura de cartão. Filete de tabela
> não é componente de interface no sentido do 1.4.11: ele não identifica um controle
> nem comunica estado, e o dado da célula continua legível sem ele. A seção 3 separa o
> que é decorativo do que carrega informação — e lá sobram **3.406 instâncias**.

---

## 2 · CRITÉRIO 1.4.3 — texto

### 2.1 As 4 reprovações, com endereço

| # | tema | rota | seletor | texto | px / peso | tinta | fundo composto | medido | exigido |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | escuro | `/#/admin/planejamento` | `.action-card.red > .action-count` | `35` | 28 / 400 | `#6e1c0e` | `#17140f` | **1.61:1** | 3.0 |
| T2 | escuro | `/#/admin/planejamento` | `.action-card.green > .action-count` | `35` | 28 / 400 | `#486441` | `#17140f` | **2.78:1** | 3.0 |
| T3 | escuro | `/#/admin/relatorios` | `td > span.badge.green` | `A` | 10.5 / 500 | `#7d9f62` | `#39391f` | **3.96:1** | 4.5 |
| T4 | escuro | `/#/admin/lojas` | `td > span.badge.green > span` | `Ativa` | 10.5 / 500 | `#7d9f62` | `#39391f` | **3.96:1** | 4.5 |

### 2.2 Causa raiz de T1 e T2 — o tema escuro esqueceu duas das quatro variantes

`styles.css` define, no tema claro:

```css
.action-card.red   .action-count { color: var(--terra); }   /* #6e1c0e */
.action-card.green .action-count { color: var(--verde); }   /* #486441 */
.action-card.blue  .action-count { color: var(--ouro-texto); }
.action-card.amber .action-count { color: var(--ambar); }
```

E no tema escuro, **duas** delas — e só duas:

```css
[data-tema='escuro'] .action-card.blue  .action-count { color: var(--ouro-lux); }
[data-tema='escuro'] .action-card.amber .action-count { color: var(--ambar-claro); }
```

`--terra` e `--verde` são, por definição do próprio arquivo, as versões **para fundo
claro** (`#6e1c0e` é comentado como "crítico · claro · 10.1:1"). As versões escuras
existem e estão ali ao lado — `--terra-claro #f6bea9` e `--verde-claro #7d9f62` — e são
usadas corretamente pelos badges. Só o `action-count` ficou de fora. O resultado é o
número "35" de **RISCO DE RUPTURA** escrito em óxido sobre carvão, a 1.61:1: é o
indicador mais importante da tela de compras e ele está, na prática, apagado.

### 2.3 Causa raiz de T3 e T4 — o chip verde sobre linha listrada

O `.badge.green` do tema escuro usa `--verde-claro #7d9f62` sobre um fundo de chip a 16%
de alfa. Sobre a linha **par** da tabela o fundo compõe `#272a1c` e o par mede 4.87:1
(passa). Sobre a linha **ímpar** (zebra) compõe `#39391f` e cai para **3.96:1**. É o
mesmo chip, na mesma coluna: passa numa linha e reprova na de baixo. A auditoria de
paleta não podia ver isto, porque a listra só existe no DOM.

### 2.4 As menores razões medidas — a folga real do sistema


#### Tema claro — as 25 menores razões medidas

| razão | limiar | rota | seletor | texto | px / peso | tinta | fundo composto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4.76:1 | 4.5 | `admin/relatorios` | `td > span.badge.green` | "A" | 10.5 / 500 | `#486441` | `#dedbc7` |
| 4.76:1 | 4.5 | `admin/lojas` | `span.badge.green > span` | "Ativa" | 10.5 / 500 | `#486441` | `#dedbc7` |
| 5.02:1 | 4.5 | `admin/estoque` | `span.badge.green > span` | "Em estoque" | 10.5 / 500 | `#486441` | `#e1e1d5` |
| 5.02:1 | 4.5 | `admin/relatorios` | `td > span.badge.green` | "A" | 10.5 / 500 | `#486441` | `#e1e1d5` |
| 5.02:1 | 4.5 | `admin/planejamento` | `span.badge.green > span` | "Alto giro" | 10.5 / 500 | `#486441` | `#e1e1d5` |
| 5.02:1 | 4.5 | `admin/usuarios` | `span.badge.green > span` | "Ativo" | 10.5 / 500 | `#486441` | `#e1e1d5` |
| 5.02:1 | 4.5 | `admin/lojas` | `span.badge.green > span` | "Ativa" | 10.5 / 500 | `#486441` | `#e1e1d5` |
| 5.26:1 | 4.5 | `admin` | `div > a` | "Ver alertas →" | 13.5 / 400 | `#74570f` | `#eae2d5` |
| 5.38:1 | 4.5 | `admin/estrategia` | `span.badge.amber > span` | "Atenção" | 10.5 / 600 | `#71430a` | `#dacebb` |
| 5.70:1 | 4.5 | `admin/transferencias` | `td > button.btn.sm` | "Criar movimentação" | 12.5 / 500 | `#74570f` | `#f2ecd9` |
| 5.92:1 | 3.0 | `admin/historico` | `div.value > span` | "0" | 27 / 400 | `#486441` | `#f6f2e9` |
| 5.92:1 | 3.0 | `admin/planejamento` | `button.card.action-card.green > div.action-count` | "35" | 28 / 400 | `#486441` | `#f6f2e9` |
| 6.04:1 | 4.5 | `admin` | `div.brand > span` | "Ótica" | 15 / 600 | `#74570f` | `#f6f2e9` |
| 6.04:1 | 4.5 | `admin` | `div.value > a` | "Ver no BI →" | 20 / 400 | `#74570f` | `#f6f2e9` |
| 6.04:1 | 4.5 | `admin` | `p > a` | "Ver todas as 282 sugestões no Plan" | 14 / 400 | `#74570f` | `#f6f2e9` |
| 6.04:1 | 4.5 | `admin` | `span > strong` | "estático" | 9.5 / 500 | `#74570f` | `#f6f2e9` |
| 6.04:1 | 4.5 | `admin/bi` | `div.brand > span` | "Ótica" | 15 / 600 | `#74570f` | `#f6f2e9` |
| 6.04:1 | 4.5 | `admin/bi` | `span > strong` | "estático" | 9.5 / 500 | `#74570f` | `#f6f2e9` |
| 6.04:1 | 4.5 | `admin/estoque` | `div.brand > span` | "Ótica" | 15 / 600 | `#74570f` | `#f6f2e9` |
| 6.04:1 | 4.5 | `admin/estoque` | `header > p.eyebrow` | "Consulta" | 10 / 500 | `#74570f` | `#f6f2e9` |
| 6.04:1 | 4.5 | `admin/estoque` | `span > strong` | "estático" | 9.5 / 500 | `#74570f` | `#f6f2e9` |
| 6.04:1 | 4.5 | `admin/produtos` | `div.brand > span` | "Ótica" | 15 / 600 | `#74570f` | `#f6f2e9` |
| 6.04:1 | 4.5 | `admin/produtos` | `header > p.eyebrow` | "Consulta" | 10 / 500 | `#74570f` | `#f6f2e9` |
| 6.04:1 | 4.5 | `admin/produtos` | `span > strong` | "estático" | 9.5 / 500 | `#74570f` | `#f6f2e9` |
| 6.04:1 | 4.5 | `admin/transferencias` | `div.brand > span` | "Ótica" | 15 / 600 | `#74570f` | `#f6f2e9` |

#### Tema escuro — as 25 menores razões medidas

| razão | limiar | rota | seletor | texto | px / peso | tinta | fundo composto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **1.61:1** | 3.0 | `admin/planejamento` | `button.card.action-card.red > div.action-count` | "35" | 28 / 400 | `#6e1c0e` | `#17140f` |
| **2.78:1** | 3.0 | `admin/planejamento` | `button.card.action-card.green > div.action-count` | "35" | 28 / 400 | `#486441` | `#17140f` |
| **3.96:1** | 4.5 | `admin/relatorios` | `td > span.badge.green` | "A" | 10.5 / 500 | `#7d9f62` | `#39391f` |
| **3.96:1** | 4.5 | `admin/lojas` | `span.badge.green > span` | "Ativa" | 10.5 / 500 | `#7d9f62` | `#39391f` |
| 4.87:1 | 4.5 | `admin/estoque` | `span.badge.green > span` | "Em estoque" | 10.5 / 500 | `#7d9f62` | `#272a1c` |
| 4.87:1 | 4.5 | `admin/relatorios` | `td > span.badge.green` | "A" | 10.5 / 500 | `#7d9f62` | `#272a1c` |
| 4.87:1 | 4.5 | `admin/planejamento` | `span.badge.green > span` | "Alto giro" | 10.5 / 500 | `#7d9f62` | `#272a1c` |
| 4.87:1 | 4.5 | `admin/usuarios` | `span.badge.green > span` | "Ativo" | 10.5 / 500 | `#7d9f62` | `#272a1c` |
| 4.87:1 | 4.5 | `admin/lojas` | `span.badge.green > span` | "Ativa" | 10.5 / 500 | `#7d9f62` | `#272a1c` |
| 5.54:1 | 4.5 | `admin/estrategia` | `span.badge.amber > span` | "Atenção" | 10.5 / 600 | `#f0b429` | `#503e16` |
| 6.13:1 | 3.0 | `admin/historico` | `div.value > span` | "0" | 27 / 400 | `#7d9f62` | `#17140f` |
| 6.48:1 | 4.5 | `admin/estoque` | `td > div.muted` | "#70316 · RELOGIO" | 12 / 400 | `#e4dcc9` α0.72 | `#2c2512` |
| 6.48:1 | 4.5 | `admin/transferencias` | `td > div.muted` | "LUXOTTICA BRASIL PRODUTOS OTICOS E" | 11.5 / 400 | `#e4dcc9` α0.72 | `#2c2512` |
| 6.48:1 | 4.5 | `admin/transferencias` | `td > span.muted` | "→" | 12.5 / 400 | `#e4dcc9` α0.72 | `#2c2512` |
| 6.48:1 | 4.5 | `admin/transferencias` | `tr > td.muted` | "Está parado em OTICALLI MIDWAY e v" | 12 / 400 | `#e4dcc9` α0.72 | `#2c2512` |
| 6.48:1 | 4.5 | `admin/relatorios` | `td > div.muted` | "— · RELOGIO" | 12 / 400 | `#e4dcc9` α0.72 | `#2c2512` |
| 6.48:1 | 4.5 | `admin/vendas` | `tr > td.num` | "R$ 41.250,00" | 13 / 400 | `#e4dcc9` α0.72 | `#2c2512` |
| 6.68:1 | 4.5 | `admin/estoque` | `span.badge.red > span` | "Ruptura" | 10.5 / 600 | `#f6bea9` | `#493a27` |
| 6.68:1 | 4.5 | `admin/alertas` | `span.badge.red > span` | "Ruptura" | 10.5 / 600 | `#f6bea9` | `#493a27` |
| 7.16:1 | 4.5 | `admin` | `span.badge.amber > span` | "9,4 meses · alta" | 10.5 / 500 | `#f0b429` | `#3a2e13` |
| 7.16:1 | 4.5 | `admin` | `span.badge.amber > span` | "14,5 meses · excesso" | 10.5 / 600 | `#f0b429` | `#3a2e13` |
| 7.16:1 | 4.5 | `admin/alertas` | `span.badge.amber > span` | "Baixo" | 10.5 / 500 | `#f0b429` | `#3a2e13` |
| 7.16:1 | 4.5 | `admin/decisoes` | `span.badge.amber > span` | "Média" | 10.5 / 500 | `#f0b429` | `#3a2e13` |
| 7.16:1 | 4.5 | `admin/planejamento` | `span.badge.amber > span` | "63%" | 10.5 / 500 | `#f0b429` | `#3a2e13` |
| 7.40:1 | 4.5 | `admin` | `div.card > div.label` | "Gestor da rede" | 10 / 500 | `#e4dcc9` α0.72 | `#17140f` |

> A margem mais apertada do tema claro é **4.76:1** (`.badge.green` sobre linha zebrada
> em Relatórios): passa por 0,26. É a mesma construção que reprova no escuro. Qualquer
> escurecimento futuro da zebra do tema claro derruba esta linha primeiro.

---

## 3 · CRITÉRIO 1.4.11 — borda, filete e traço

### 3.1 A separação entre decorativo e informativo

Das 108 assinaturas únicas de reprovação, **77 são decorativas** e estão isentas:
filete de linha de tabela (`td`/`th`, `#0d0b08` α0.13 no claro a 1.32:1, `#f6f2e9` α0.22
no escuro a 1.92:1), moldura de `article.card`, e a borda de reforço dos badges — que é
redundante, porque o chip já tem fundo próprio, texto e ícone.

**31 assinaturas carregam informação e reprovam.** Elas se agrupam em três defeitos.

### 3.2 DEFEITO C1 — no tema claro, nenhum botão tem contorno visível

Medido no botão real, com fundo composto:

| tema | controle | fundo próprio | borda | largura | razão da borda | veredito |
| --- | --- | --- | --- | --- | --- | --- |
| claro | `.btn.ghost` | **nenhum** (α 0) | `#0d0b08` α0.24 | 1px | **1.72:1** | reprova |
| claro | `.btn` (sólido) | **nenhum** (α 0) | `#c9a227` | 1px | **2.17:1** | reprova |
| claro | `.segmented button` | **nenhum** (α 0) | `#0d0b08` α0.13 | 1px | **1.32:1** | reprova |
| escuro | `.btn.ghost` | nenhum | `#f6f2e9` α0.38 | 1px | 3.33:1 | passa |
| escuro | `.btn` (sólido) | nenhum | `#c9a227` | 1px | 7.59:1 | passa |
| escuro | `.segmented button` | nenhum | `#f6f2e9` α0.22 | 1px | 1.84:1 | reprova |

O ponto que torna isto grave: a coluna "fundo próprio" é **nenhum** em todos eles. O
`.btn` do NANOFLOW é um botão de contorno — não tem preenchimento. A borda não é
decoração sobre um botão que já se vê; **a borda é o botão**. A 1.72:1 sobre papel, o
usuário vê um rótulo solto, não um controle. São 2.808 instâncias de `.btn.ghost.sm` e
459 de `.btn.sm` só nas telas medidas.

O tema escuro acerta os dois botões (3.33 e 7.59) e erra o segmentado. O claro erra os
três. Isto é sintoma de que a régua de 3:1 foi aplicada ao escuro e não ao claro — que é
justamente o tema **padrão** do produto.

### 3.3 DEFEITO C2 — no tema escuro, os quatro filetes do centro de ação

`/#/admin/planejamento`, `.action-card`, filete lateral de 3px que é o código de cor do
cartão:

| variante | filete | tema claro | tema escuro | número (28px) claro | número escuro |
| --- | --- | --- | --- | --- | --- |
| `.red` — Risco de ruptura | `#6e1c0e` | 10.24:1 ✓ | **1.61:1** ✗ | 10.24:1 ✓ | **1.61:1** ✗ |
| `.green` — Pedidos a fazer | `#486441` | 5.92:1 ✓ | **2.78:1** ✗ | 5.92:1 ✓ | **2.78:1** ✗ |
| `.blue` — Transferências | `#74570f` | 6.04:1 ✓ | **2.72:1** ✗ | 6.04:1 ✓ | 12.63:1 ✓ |
| `.amber` — Excesso & parados | `#71430a` | 7.49:1 ✓ | **2.19:1** ✗ | 7.49:1 ✓ | 9.85:1 ✓ |

O padrão confirma o diagnóstico da seção 2.2 e o estende: no tema escuro a correção foi
aplicada **só à cor do número, e só em duas das quatro variantes**. O
`border-left-color` não foi tocado em **nenhuma** das quatro. Os quatro filetes do
centro de ação de Planejamento estão pintados com tokens de tema claro sobre `#17140f`.

### 3.4 DEFEITO C3 — o indicador de "ativo" no tema claro

| indicador | canal | tema claro | tema escuro |
| --- | --- | --- | --- |
| dock, aba ativa | fundo `#e4dcc9` vs `#f6f2e9` | **1.22:1** | 1.17:1 |
| dock, aba ativa | filete `::after` `#c9a227` 14×2px | **2.17:1** | 8.12:1 ✓ |
| `.nav-link.active` | fundo `#e4dcc9` vs `#f6f2e9` | **1.22:1** | 1.10:1 |
| `.nav-link.active` | filete esquerdo `#c9a227` 2px | **1.77:1** | 6.92:1 ✓ |
| `.nav-link.active` | peso 600 vs 500 | canal não-cromático ✓ | ✓ |

No tema claro **nenhum** dos canais cromáticos do estado "ativo" chega a 3:1. O que
salva o critério 1.4.1 é o peso da fonte (600 contra 500), que é um canal não-cromático
legítimo — mas é um canal fraco para quem lê de longe, e o 1.4.11 continua reprovado
para o indicador em si. No escuro o filete resolve (8.12:1).

### 3.5 Pseudo-elementos — o `--ouro` puro voltou como filete

| tema | rota | pseudo | cor | fundo | razão | papel |
| --- | --- | --- | --- | --- | --- | --- |
| claro | `/#/admin` | `.dock button.active::after` | `#c9a227` | `#e4dcc9` | **1.77:1** | **indicador de aba ativa** |
| claro | `/#/admin/estoque` | `p.eyebrow::before` | `#c9a227` | `#f6f2e9` | 2.17:1 | régua decorativa |
| claro | `/#/admin/estrategia` | `.card p.eyebrow::before` | `#c9a227` | `#f6f2e9` | 2.17:1 | régua decorativa |
| claro | `/#/admin/planejamento` | `p.eyebrow::before` | `#c9a227` | `#f6f2e9` | 2.17:1 | régua decorativa |
| claro | `/#/loja` | `.store-hero .eyebrow::before` | `#c9a227` | `#f6f2e9` | 2.17:1 | régua decorativa |

As quatro réguas de `eyebrow` são decorativas — o texto ao lado carrega o significado —
e ficam isentas. A primeira linha **não é**: é o único filete que diz qual aba do dock
está aberta, e mede 1.77:1.

No tema escuro nenhum destes reprova: o mesmo `#c9a227` sobre `#17140f` mede 7.59:1.
Este é o padrão que se repete no relatório inteiro — **o ouro da marca funciona no
escuro e não funciona no papel.**

### 3.6 Tabela completa de assinaturas de componente

Todas as 108 assinaturas únicas de reprovação, com contagem de instâncias e
classificação.

| instâncias | tema | tipo | cor | px | razão | dentro | fora | alvo | classificação |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 13101 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `td` | decorativo · filete de tabela |
| 13101 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#17140f` | `td` | decorativo · filete de tabela |
| 11789 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `td.num` | decorativo · filete de tabela |
| 11789 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#17140f` | `td.num` | decorativo · filete de tabela |
| 3103 | claro | borda | `#71430a` α0.45 | 1 | 2.16:1 | `#e5dbcc` | `#f6f2e9` | `span.badge.amber` | decorativo · reforço de chip (chip tem fundo+texto+ícone) |
| 3103 | escuro | borda | `#f0b429` α0.45 | 1 | 2.93:1 | `#3a2e13` | `#17140f` | `span.badge.amber` | decorativo · reforço de chip (chip tem fundo+texto+ícone) |
| 2808 | claro | borda | `#0d0b08` α0.24 | 1 | 1.72:1 | `#f6f2e9` | `#f6f2e9` | `button.btn.ghost.sm` | **INFORMATIVO · limite de controle** |
| 1188 | claro | borda | `#6e1c0e` α0.42 | 1 | 2.34:1 | `#e7dad1` | `#f6f2e9` | `span.badge.red` | decorativo · reforço de chip (chip tem fundo+texto+ícone) |
| 1188 | escuro | borda | `#f6bea9` α0.42 | 1 | 2.95:1 | `#362c25` | `#17140f` | `span.badge.red` | decorativo · reforço de chip (chip tem fundo+texto+ícone) |
| 490 | claro | borda | `#0d0b08` α0.24 | 1 | 1.72:1 | `#e4dcc9` | `#f6f2e9` | `span.badge.blue` | decorativo · reforço de chip (chip tem fundo+texto+ícone) |
| 459 | claro | borda | `#c9a227` | 1 | 2.17:1 | `#f6f2e9` | `#f6f2e9` | `button.btn.sm` | **INFORMATIVO · limite de controle** |
| 406 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `article.card` | decorativo · moldura de cartão |
| 406 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#0d0b08` | `article.card` | decorativo · moldura de cartão |
| 352 | claro | borda | `#0d0b08` α0.24 | 3 | 1.72:1 | `#f6f2e9` | `#f6f2e9` | `article.card` | decorativo · moldura de cartão |
| 211 | claro | borda | `#486441` α0.42 | 1 | 1.88:1 | `#e1e1d5` | `#f6f2e9` | `span.badge.green` | decorativo · reforço de chip (chip tem fundo+texto+ícone) |
| 211 | escuro | borda | `#7d9f62` α0.42 | 1 | 2.08:1 | `#272a1c` | `#17140f` | `span.badge.green` | decorativo · reforço de chip (chip tem fundo+texto+ícone) |
| 81 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `th` | decorativo · filete de tabela |
| 81 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#17140f` | `th` | decorativo · filete de tabela |
| 59 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `div.card` | decorativo · moldura de cartão |
| 51 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `th.num` | decorativo · filete de tabela |
| 51 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#17140f` | `th.num` | decorativo · filete de tabela |
| 44 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `td.muted` | decorativo · filete de tabela |
| 44 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#17140f` | `td.muted` | decorativo · filete de tabela |
| 38 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#0d0b08` | `div.card` | decorativo · moldura de cartão |
| 36 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `td.right` | decorativo · filete de tabela |
| 36 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#17140f` | `td.right` | decorativo · filete de tabela |
| 33 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `div.card.stat` | decorativo · moldura de cartão |
| 30 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `button` | **INFORMATIVO · limite de controle** |
| 30 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#0d0b08` | `div.card.stat` | decorativo · moldura de cartão |
| 26 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#2a2416` | `#f6f2e9` | `button.active` | **INFORMATIVO · limite de controle** |
| 25 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f2ecd9` | `#f2ecd9` | `td` | decorativo · filete de tabela |
| 25 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.84:1 | `#0d0b08` | `#0d0b08` | `button` | **INFORMATIVO · limite de controle** |
| 25 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.96:1 | `#2c2512` | `#2c2512` | `td` | decorativo · filete de tabela |
| 24 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#e4dcc9` | `#f6f2e9` | `div` | decorativo · separador |
| 24 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.96:1 | `#221d15` | `#17140f` | `div` | decorativo · separador |
| 23 | claro | borda | `#0d0b08` α0.24 | 2 | 1.72:1 | `#f6f2e9` | `#f6f2e9` | `article.card` | decorativo · moldura de cartão |
| 21 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#17140f` | `div.card` | decorativo · moldura de cartão |
| 21 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.84:1 | `#e4dcc9` | `#0d0b08` | `button.active` | **INFORMATIVO · limite de controle** |
| 18 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f2ecd9` | `#f2ecd9` | `td.num` | decorativo · filete de tabela |
| 18 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.96:1 | `#2c2512` | `#2c2512` | `td.num` | decorativo · filete de tabela |
| 17 | claro | borda | `#c9a227` α0.32 | 1 | 1.26:1 | `#f6f2e9` | `#f6f2e9` | `div.demo-seal` | decorativo · separador |
| 15 | claro | borda | `#c9a227` | 2 | 2.17:1 | `#f6f2e9` | `#f6f2e9` | `div.macos-window` | decorativo · separador |
| 15 | claro | borda | `#c9a227` α0.32 | 1 | 1.26:1 | `#f6f2e9` | `#f6f2e9` | `div.macos-window` | decorativo · separador |
| 15 | claro | borda | `#c9a227` α0.32 | 1 | 1.26:1 | `#f6f2e9` | `#f6f2e9` | `aside.sidebar` | decorativo · separador |
| 15 | claro | borda | `#c9a227` | 2 | 2.17:1 | `#e4dcc9` | `#f6f2e9` | `a.nav-link.active` | decorativo · separador |
| 15 | claro | borda | `#c9a227` α0.32 | 1 | 1.26:1 | `#f6f2e9` | `#f6f2e9` | `div.titlebar` | decorativo · separador |
| 15 | claro | borda | `#0d0b08` α0.24 | 1 | 1.72:1 | `#f6f2e9` | `#f6f2e9` | `div.segmented.sm` | decorativo · separador |
| 15 | claro | borda | `#c9a227` α0.32 | 1 | 1.26:1 | `#f6f2e9` | `#f6f2e9` | `div.dock` | decorativo · separador |
| 15 | escuro | borda | `#c9a227` α0.32 | 1 | 1.80:1 | `#0d0b08` | `#0d0b08` | `div.macos-window` | decorativo · separador |
| 15 | escuro | borda | `#c9a227` α0.32 | 1 | 1.85:1 | `#17140f` | `#0d0b08` | `aside.sidebar` | decorativo · separador |
| 15 | escuro | borda | `#c9a227` α0.32 | 1 | 1.80:1 | `#0d0b08` | `#0d0b08` | `div.titlebar` | decorativo · separador |
| 15 | escuro | borda | `#c9a227` α0.32 | 1 | 1.80:1 | `#0d0b08` | `#0d0b08` | `div.dock` | decorativo · separador |
| 15 | escuro | borda | `#c9a227` α0.32 | 1 | 1.80:1 | `#0d0b08` | `#f6f2e9` | `div.demo-seal` | decorativo · separador |
| 11 | claro | borda | `#0d0b08` α0.24 | 1 | 1.72:1 | `#f6f2e9` | `#f6f2e9` | `div.segmented` | decorativo · separador |
| 7 | claro | borda | `#0d0b08` α0.24 | 1 | 1.72:1 | `#f6f2e9` | `#f6f2e9` | `article.card` | decorativo · moldura de cartão |
| 7 | claro | borda | `#0d0b08` α0.24 | 1 | 1.72:1 | `#f6f2e9` | `#f6f2e9` | `span.badge.gray` | decorativo · reforço de chip (chip tem fundo+texto+ícone) |
| 5 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#e4dcc9` | `#17140f` | `button.active` | **INFORMATIVO · limite de controle** |
| 5 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#17140f` | `button` | **INFORMATIVO · limite de controle** |
| 4 | claro | borda | `#71430a` α0.3 | 1 | 1.63:1 | `#eae2d5` | `#f6f2e9` | `div.banner.warn` | decorativo · separador |
| 3 | claro | borda | `#c9a227` | 1 | 2.17:1 | `#c9a227` | `#f6f2e9` | `button.btn.solid` | **INFORMATIVO · limite de controle** |
| 3 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `th.right` | decorativo · filete de tabela |
| 3 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#17140f` | `div.card.stat` | decorativo · moldura de cartão |
| 3 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#17140f` | `th.right` | decorativo · filete de tabela |
| 2 | claro | borda | `#486441` α0.3 | 1 | 1.54:1 | `#e6e5da` | `#f6f2e9` | `div.banner.ok` | decorativo · separador |
| 2 | claro | borda | `#6e1c0e` α0.42 | 1 | 2.30:1 | `#e4d5c3` | `#f2ecd9` | `span.badge.red` | decorativo · reforço de chip (chip tem fundo+texto+ícone) |
| 2 | claro | borda | `#c9a227` | 1 | 2.17:1 | `#f6f2e9` | `#f6f2e9` | `a.btn.sm` | **INFORMATIVO · limite de controle** |
| 2 | claro | borda | `#0d0b08` α0.24 | 1 | 1.72:1 | `#f6f2e9` | `#f6f2e9` | `button.btn.ghost` | **INFORMATIVO · limite de controle** |
| 2 | claro | borda | `#486441` α0.42 | 1 | 1.85:1 | `#dedbc7` | `#f2ecd9` | `span.badge.green` | decorativo · reforço de chip (chip tem fundo+texto+ícone) |
| 2 | claro | borda | `#c9a227` α0.32 | 1 | 1.26:1 | `#f6f2e9` | `#f6f2e9` | `header.store-nav` | decorativo · separador |
| 2 | escuro | borda | `#f0b429` α0.34 | 1 | 2.20:1 | `#281f0c` | `#0d0b08` | `div.banner.warn` | decorativo · separador |
| 2 | escuro | borda | `#f6bea9` α0.42 | 1 | 2.84:1 | `#493a27` | `#2c2512` | `span.badge.red` | decorativo · reforço de chip (chip tem fundo+texto+ícone) |
| 2 | escuro | borda | `#7d9f62` α0.42 | 1 | 2.01:1 | `#39391f` | `#2c2512` | `span.badge.green` | decorativo · reforço de chip (chip tem fundo+texto+ícone) |
| 2 | escuro | borda | `#f0b429` α0.34 | 1 | 2.19:1 | `#312712` | `#17140f` | `div.banner.warn` | decorativo · separador |
| 2 | escuro | borda | `#c9a227` α0.32 | 1 | 1.80:1 | `#0d0b08` | `#0d0b08` | `header.store-nav` | decorativo · separador |
| 2 | escuro | borda | `#c9a227` α0.32 | 1 | 1.80:1 | `#0d0b08` | `#0d0b08` | `div.demo-seal` | decorativo · separador |
| 1 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f2ecd9` | `#f2ecd9` | `td.muted` | decorativo · filete de tabela |
| 1 | claro | borda | `#c9a227` | 1 | 2.04:1 | `#f2ecd9` | `#f2ecd9` | `button.btn.sm` | **INFORMATIVO · limite de controle** |
| 1 | claro | borda | `#0d0b08` α0.24 | 1 | 1.72:1 | `#f2ecd9` | `#f2ecd9` | `button.btn.ghost.sm` | **INFORMATIVO · limite de controle** |
| 1 | claro | borda | `#c9a227` | 1 | 2.17:1 | `#c9a227` | `#f6f2e9` | `button.btn.solid.no-print` | **INFORMATIVO · limite de controle** |
| 1 | claro | borda | `#0d0b08` α0.24 | 1 | 1.72:1 | `#486441` | `#f6f2e9` | `span` | decorativo · separador |
| 1 | claro | borda | `#0d0b08` α0.24 | 1 | 1.72:1 | `#f6f2e9` | `#f6f2e9` | `span` | decorativo · separador |
| 1 | claro | borda | `#71430a` α0.45 | 1 | 2.08:1 | `#dacebb` | `#eae2d5` | `span.badge.amber` | decorativo · reforço de chip (chip tem fundo+texto+ícone) |
| 1 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `div` | decorativo · separador |
| 1 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `button.card.action-card.red` | **INFORMATIVO · limite de controle** |
| 1 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `button.card.action-card.blue` | **INFORMATIVO · limite de controle** |
| 1 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `button.card.action-card.green` | **INFORMATIVO · limite de controle** |
| 1 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `button.card.action-card.amber` | **INFORMATIVO · limite de controle** |
| 1 | claro | borda | `#0d0b08` α0.24 | 1 | 1.72:1 | `#f6f2e9` | `#f6f2e9` | `button.btn.solid` | **INFORMATIVO · limite de controle** |
| 1 | claro | borda | `#0d0b08` α0.322 | 1 | 2.13:1 | `#f6f2e9` | `#f6f2e9` | `select` | **INFORMATIVO · limite de campo** |
| 1 | claro | borda | `#0d0b08` α0.13 | 1 | 1.32:1 | `#f6f2e9` | `#f6f2e9` | `div.banner` | decorativo · separador |
| 1 | claro | borda | `#0d0b08` α0.24 | 3 | 1.72:1 | `#f6f2e9` | `#f6f2e9` | `div.banner` | decorativo · separador |
| 1 | claro | borda | `#c9a227` | 1 | 2.17:1 | `#f6f2e9` | `#f6f2e9` | `button.btn` | **INFORMATIVO · limite de controle** |
| 1 | claro | borda | `#c9a227` | 1 | 2.17:1 | `#c9a227` | `#f6f2e9` | `a.btn.solid` | **INFORMATIVO · limite de controle** |
| 1 | escuro | borda | `#7d9f62` α0.32 | 1 | 1.71:1 | `#1a1d13` | `#0d0b08` | `div.banner.ok` | decorativo · separador |
| 1 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.96:1 | `#2c2512` | `#2c2512` | `td.muted` | decorativo · filete de tabela |
| 1 | escuro | borda | `#f0b429` α0.45 | 1 | 2.77:1 | `#503e16` | `#312712` | `span.badge.amber` | decorativo · reforço de chip (chip tem fundo+texto+ícone) |
| 1 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#17140f` | `div` | decorativo · separador |
| 1 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#0d0b08` | `button.card.action-card.red` | **INFORMATIVO · limite de controle** |
| 1 | escuro | borda | `#6e1c0e` | 3 | 1.72:1 | `#17140f` | `#0d0b08` | `button.card.action-card.red` | **INFORMATIVO · limite de controle** |
| 1 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#0d0b08` | `button.card.action-card.blue` | **INFORMATIVO · limite de controle** |
| 1 | escuro | borda | `#74570f` | 3 | 2.91:1 | `#17140f` | `#0d0b08` | `button.card.action-card.blue` | **INFORMATIVO · limite de controle** |
| 1 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#0d0b08` | `button.card.action-card.green` | **INFORMATIVO · limite de controle** |
| 1 | escuro | borda | `#486441` | 3 | 2.97:1 | `#17140f` | `#0d0b08` | `button.card.action-card.green` | **INFORMATIVO · limite de controle** |
| 1 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#0d0b08` | `button.card.action-card.amber` | **INFORMATIVO · limite de controle** |
| 1 | escuro | borda | `#71430a` | 3 | 2.35:1 | `#17140f` | `#0d0b08` | `button.card.action-card.amber` | **INFORMATIVO · limite de controle** |
| 1 | escuro | borda | `#7d9f62` α0.32 | 1 | 1.70:1 | `#232519` | `#17140f` | `div.banner.ok` | decorativo · separador |
| 1 | escuro | borda | `#f6f2e9` α0.266 | 1 | 2.28:1 | `#1f1a13` | `#17140f` | `select` | **INFORMATIVO · limite de campo** |
| 1 | escuro | borda | `#f6f2e9` α0.22 | 1 | 1.92:1 | `#17140f` | `#0d0b08` | `div.banner` | decorativo · separador |

---

## 4 · CRITÉRIO 2.4.7 / 1.4.11 — o anel de foco

66 paradas de `Tab` (4 rotas × 2 temas), cada medida 420 ms após a tecla, para deixar a
transição de 120 ms terminar.

### 4.1 O resultado

| tema | alvo | `outline` | anel medido | veredito |
| --- | --- | --- | --- | --- |
| claro | `a.nav-link`, `.btn`, `.btn.ghost`, `a.brand`, `select` | 2px `#74570f` | **6.04:1** | ✓ |
| claro | `input` (busca) | **0px `none`** | `box-shadow` `#c9a227` α0.34 → **1.28:1** | ✗ |
| claro | `.mselect-btn` (seletor de lojas) | **0px `none`** | `box-shadow` `#c9a227` α0.34 → **1.28:1** | ✗ |
| escuro | `a.nav-link`, `.btn`, `.btn.ghost`, `a.brand`, `select` | 2px `#c9a227` | **7.59 – 8.12:1** | ✓ |
| escuro | `input` (busca) | **0px `none`** | `box-shadow` `#c9a227` α0.42 → **2.30:1** | ✗ |
| escuro | `.mselect-btn` | **0px `none`** | `box-shadow` `#c9a227` α0.42 → **2.30:1** | ✗ |

### 4.2 Por que só o campo de texto — um acidente de especificidade

`styles.css:219` instala o anel global:

```css
:focus-visible { outline: 2px solid var(--ouro-texto); outline-offset: 2px; }
```

Especificidade **(0,1,0)**. E `styles.css:634` zera o `outline` na base dos campos:

```css
input:not([type='checkbox']):not([type='radio']):not([type='range']),
select,
textarea { … outline: none; … }
```

Este seletor é uma lista. Para `select` e `textarea` a especificidade é **(0,0,1)** —
perde para `:focus-visible`, e por isso **o `select` conserva o anel** (medido: 2px
`#74570f`, 6.04:1). Para `input`, cada `:not()` herda a especificidade do argumento
(`[type='…']` vale (0,1,0)), somando **(0,3,1)** — que **ganha** de `:focus-visible` e
apaga o anel.

Ou seja: ninguém decidiu tirar o foco do campo de busca. Os três `:not()` que existem
para impedir que checkbox e radio recebam padding de campo de texto empurraram a
especificidade para cima e derrubaram o anel junto. A prova está no `select`, que passa
pela mesma regra sem os `:not()` e mantém o anel.

O `.mselect-btn` é o outro caso, e este é explícito (`styles.css:695`):
`.mselect-btn:focus-visible { … outline: none; }` — (0,2,0), ganha de propósito.

### 4.3 O que resta, honestamente

Não é verdade que o campo focado fique sem nenhum sinal. A borda troca de
`rgba(13,11,8,.46)` para `#74570f` no claro (6.04:1 contra o fundo adjacente) e para
`#c9a227` no escuro (8.12:1). Então:

- **Contra 1.4.11 lido ao pé da letra**, existe um indicador de 1px com contraste
  suficiente, e o critério sobrevive.
- **Contra 2.4.7 na prática**, o anel *projetado* — o brilho de 3px, que é o que dá área
  visível ao foco — mede 1.28:1 e é invisível sobre papel. O que sobra é uma troca de
  matiz num filete de 1px, na mesma geometria de antes: nada muda de forma, só de cor.
  Isso reprova o 2.4.13 (Focus Appearance) da WCAG 2.2 e é frágil para quem tem baixa
  visão.
- **E é inconsistente**: no mesmo formulário, o `select` ao lado do campo ganha um anel
  de 2px a 6.04:1 e o campo não. A inconsistência é a prova de que é defeito, não decisão.

O `--ring` é `rgba(201,162,39,0.34)` no claro e `rgba(201,162,39,0.42)` no escuro. Mesmo
a 100% de alfa, `#c9a227` sobre `#f6f2e9` dá 2.17:1 — **este ouro não consegue ser anel
de foco sobre papel em nenhuma opacidade.**

---

## 5 · CRITÉRIO 1.4.1 — daltonismo

### 5.1 Método

Simulação numérica sobre as cores **colhidas do DOM renderizado** (não da paleta):
matrizes de **Machado, Oliveira & Fernandes (2009)**, severidade 1.0, aplicadas em RGB
**linear**; Viénot–Brettel–Mollon (1999) usado como segunda opinião. A distância
perceptual é reportada em **ΔE2000** (a métrica correta; a Onda 1 usou ΔE76, que
superestima diferença em tons escuros e saturados) e a diferença acromática em **Δcinza
(0–255)**, que é o que sobra na impressão P&B — e `Reports.tsx` tem `@media print`.

Limiar adotado: **ΔE2000 < 11** entre dois estados, no observador simulado, é frágil.
(ΔE2000 ≈ 2 é o limiar de "duas cores diferentes" em condição ideal; num badge de 10,5px
numa tabela densa, a margem precisa ser muito maior.)

### 5.2 O canal redundante, verificado no DOM (e não presumido)

Para cada estado, a auditoria abriu o badge e leu o que há dentro além da cor:

| tela | estado | palavra | ícone (assinatura do `path`) | peso | redundância |
| --- | --- | --- | --- | --- | --- |
| Estoque | verde | `EM ESTOQUE` | escudo + tique `M7 12l3 3 6-6` | 500 | **palavra + ícone** ✓ |
| Estoque / Alertas | vermelho | `RUPTURA` | triângulo `M12 3.5L2 20.5h20z` | 500 | **palavra + ícone** ✓ |
| Alertas | âmbar | `BAIXO` | escudo + relógio `M12 4v8l5 3` | 500 | **palavra + ícone** ✓ |
| Planejamento | vermelho | `ENVIAR HOJE` | triângulo | 500 | **palavra + ícone** ✓ |
| Planejamento | verde | `ALTO GIRO` | seta ascendente `M3 17l6-6 4 4 7-7` | 500 | **palavra + ícone** ✓ |
| Planejamento | âmbar | `63%` | círculo + `i` | 500 | **valor + ícone** ✓ |
| Decisões | vermelho | `33 ATRASADOS` | escudo + relógio | 500 | **palavra** ✓ / **ícone ✗** |
| Decisões | âmbar | `MÉDIA` | escudo + relógio | 500 | **palavra** ✓ / **ícone ✗** |
| Decisões | cinza | `BAIXA` | lista `M4 6h16M4 12h10` | 500 | palavra + ícone ✓ |
| Relatórios | verde | `A` | **nenhum** | 500 | **só a letra** ⚠ |

**Achado D1 — em Decisões, prioridade alta e média usam o mesmo ícone.** O `path` é
byte a byte idêntico (`M12 4v8l5 3|M12 3h9v9a9 9 0 0 1-9 9H3v-9a9 9 0 0 1 9…`). Para o
par vermelho×âmbar dessa tela o ícone **não** é canal redundante; sobra a palavra. E o
par vermelho×âmbar é justamente o mais frágil sob deuteranopia (ΔE2000 6.7 no claro).

**Achado D2 — o badge de nota em Relatórios não tem ícone.** Os canais são a letra e a
cor. Se as notas variam (A/B/C) a letra basta; na base medida só apareceu `A` em 100
instâncias, então não foi possível provar que existe variação de letra. Fica registrado
como não verificado, não como aprovado.

Nos demais casos a redundância é real e verificada: **palavra + forma de ícone**. É por
isso que os pares de fundo de chip abaixo, apesar de ΔE 0.8, não são defeito de 1.4.1.

### 5.3 Os pares frágeis, por gravidade


| # | ΔE2000 pior observador | Δcinza | lum. entre os dois | conjunto | par | gravidade |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.6 | 3 | 1.04:1 | Gráfico · escala CATEGÓRICA (tema escuro) | 5 terracota × 8 âmbar | **GRAVE** — sem canal redundante no gráfico |
| 2 | 0.8 | 4 | 1.04:1 | Badge · estado de estoque (tema claro) — FUNDO composto do chip | saudável/verde × ruptura/terra | isento — chip tem palavra + ícone |
| 3 | 0.8 | 0 | 1:1 | Badge · estado de estoque (tema claro) — FUNDO composto do chip | atenção/âmbar × info/azul | isento — chip tem palavra + ícone |
| 4 | 1.7 | 12 | 1.18:1 | Gráfico · escala CATEGÓRICA (tema escuro) | 1 ouro × 7 oliva | **GRAVE** — sem canal redundante no gráfico |
| 5 | 2.0 | 4 | 1.04:1 | Badge · estado de estoque (tema claro) — FUNDO composto do chip | saudável/verde × atenção/âmbar | isento — chip tem palavra + ícone |
| 6 | 2.0 | 0 | 1:1 | Badge · estado de estoque (tema claro) — FUNDO composto do chip | atenção/âmbar × ruptura/terra | isento — chip tem palavra + ícone |
| 7 | 2.2 | 5 | 1.08:1 | Badge · estado de estoque (tema escuro) — FUNDO composto do chip | saudável/verde × ruptura/terra | isento — chip tem palavra + ícone |
| 8 | 2.6 | 9 | 1.14:1 | Badge · estado de estoque (tema claro) — cor do TEXTO | saudável/verde × neutro/cinza | atenção |
| 9 | 2.7 | 0 | 1:1 | Badge · estado de estoque (tema claro) — FUNDO composto do chip | ruptura/terra × info/azul | isento — chip tem palavra + ícone |
| 10 | 3.0 | 4 | 1.04:1 | Badge · estado de estoque (tema claro) — FUNDO composto do chip | saudável/verde × info/azul | isento — chip tem palavra + ícone |
| 11 | 3.6 | 12 | 1.19:1 | Gráfico · cores de ESTADO (tema claro) | atenção × crítico | **GRAVE** — sem canal redundante no gráfico |
| 12 | 3.8 | 11 | 1.14:1 | Badge · estado de estoque (tema escuro) — FUNDO composto do chip | saudável/verde × info/azul | isento — chip tem palavra + ícone |
| 13 | 4.6 | 13 | 1.24:1 | Action-card · NÚMERO herói (tema claro) | transf/blue × excesso/amber | atenção — rótulo do cartão distingue |
| 14 | 4.9 | 21 | 1.24:1 | Gráfico · cores de ESTADO (tema escuro) | bom × atenção | **GRAVE** — sem canal redundante no gráfico |
| 15 | 5.1 | 16 | 1.23:1 | Badge · estado de estoque (tema escuro) — FUNDO composto do chip | ruptura/terra × info/azul | isento — chip tem palavra + ícone |
| 16 | 5.2 | 4 | 1.05:1 | Gráfico · escala CATEGÓRICA (tema claro) | 5 terracota × 7 oliva | **GRAVE** — sem canal redundante no gráfico |
| 17 | 5.5 | 28 | 1.37:1 | Gráfico · cores de ESTADO (tema escuro) | bom × crítico | **GRAVE** — sem canal redundante no gráfico |
| 18 | 5.9 | 18 | 1.29:1 | Gráfico · escala CATEGÓRICA (tema claro) | 1 ouro × 7 oliva | **GRAVE** — sem canal redundante no gráfico |
| 19 | 6.0 | 22 | 1.22:1 | Badge · estado de estoque (tema escuro) — cor do TEXTO | neutro/cinza × info/azul | atenção |
| 20 | 6.4 | 18 | 1.2:1 | Badge · estado de estoque (tema escuro) — cor do TEXTO | ruptura/terra × neutro/cinza | atenção |
| 21 | 6.4 | 18 | 1.2:1 | Prioridade de decisão (tema escuro) | alta/terra × baixa/cinza | atenção |
| 22 | 6.7 | 20 | 1.37:1 | Badge · estado de estoque (tema claro) — cor do TEXTO | atenção/âmbar × ruptura/terra | atenção |
| 23 | 6.7 | 20 | 1.37:1 | Prioridade de decisão (tema claro) | alta/terra × média/âmbar | atenção |
| 24 | 6.7 | 20 | 1.37:1 | Action-card · NÚMERO herói (tema claro) | risco/red × excesso/amber | atenção — rótulo do cartão distingue |
| 25 | 6.8 | 7 | 1.1:1 | Badge · estado de estoque (tema escuro) — FUNDO composto do chip | saudável/verde × atenção/âmbar | isento — chip tem palavra + ícone |
| 26 | 6.8 | 20 | 1.34:1 | Gráfico · escala CATEGÓRICA (tema claro) | 1 ouro × 8 âmbar | **GRAVE** — sem canal redundante no gráfico |
| 27 | 7.0 | 5 | 1.08:1 | Gráfico · cores de ESTADO (tema claro) | bom × atenção | **GRAVE** — sem canal redundante no gráfico |
| 28 | 7.1 | 7 | 1.11:1 | Gráfico · cores de ESTADO (tema claro) | bom × crítico | **GRAVE** — sem canal redundante no gráfico |
| 29 | 7.6 | 21 | 1.35:1 | Badge · estado de estoque (tema claro) — cor do TEXTO | ruptura/terra × info/azul | atenção |
| 30 | 7.7 | 22 | 1.36:1 | Gráfico · escala CATEGÓRICA (tema claro) | 1 ouro × 5 terracota | **GRAVE** — sem canal redundante no gráfico |
| 31 | 7.9 | 2 | 1.02:1 | Badge · estado de estoque (tema escuro) — FUNDO composto do chip | atenção/âmbar × ruptura/terra | isento — chip tem palavra + ícone |
| 32 | 9.0 | 32 | 1.57:1 | Gráfico · escala CATEGÓRICA (tema escuro) | 5 terracota × 7 oliva | tolerável |
| 33 | 9.2 | 24 | 1.28:1 | Action-card · NÚMERO herói (tema escuro) | transf/blue × excesso/amber | atenção — rótulo do cartão distingue |
| 34 | 10.0 | 18 | 1.26:1 | Badge · estado de estoque (tema escuro) — FUNDO composto do chip | atenção/âmbar × info/azul | isento — chip tem palavra + ícone |
| 35 | 10.9 | 2 | 1.02:1 | Action-card · NÚMERO herói (tema claro) | pedidos/green × transf/blue | atenção — rótulo do cartão distingue |

### 5.4 DEFEITO D3 (GRAVE) — a escala categórica do gráfico colapsa

A escala de 8 cores de `PALETA_DADOS` é usada em barras empilhadas, pizza e Sankey
(`Fluxo de vendas — Categoria → Loja`, `Transferências entre lojas`). Nesses gráficos o
segmento **não tem rótulo próprio**: a legenda está fora, e para saber o que é um
pedaço de barra o usuário tem de casar a cor com a legenda. Aí a cor é o único canal, e
o 1.4.1 morre se duas cores colidirem.

| tema | par | hex | ΔE2000 normal | protanopia | deuteranopia | Δcinza |
| --- | --- | --- | --- | --- | --- | --- |
| **escuro** | 5 terracota × 8 âmbar | `#a44f02` × `#8f5801` | 10.1 | **0.6** | 3.6 | **3** |
| **escuro** | 1 ouro × 7 oliva | `#b48f0a` × `#5b9600` | 23.6 | **1.7** | 8.3 | 12 |
| claro | 5 terracota × 7 oliva | `#cf653f` × `#5d8d2d` | 34.6 | **5.2** | 8.9 | 4 |
| claro | 1 ouro × 7 oliva | `#8a6914` × `#5d8d2d` | 24.9 | 12.9 | **5.9** | 18 |
| claro | 1 ouro × 8 âmbar | `#8a6914` × `#824f02` | 10.5 | 8.5 | **6.8** | 20 |
| claro | 1 ouro × 5 terracota | `#8a6914` × `#cf653f` | 22.6 | **7.7** | 12.8 | 22 |
| escuro | 5 terracota × 7 oliva | `#a44f02` × `#5b9600` | 32.7 | **9.0** | 15.4 | 32 |

O caso do tema escuro é o pior que esta auditoria encontrou: **ΔE2000 0.6 sob
protanopia com Δcinza 3**. As séries 5 e 8 viram literalmente a mesma cor — e também
viram a mesma cor na impressão P&B, para todo mundo. Um Sankey com essas duas séries
adjacentes é ilegível para o observador protanope.

### 5.5 DEFEITO D4 — as cores de ESTADO do gráfico

| tema | par | hex | ΔE2000 normal | protan. | deuteran. | Δcinza | lum. entre os dois |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claro | bom × crítico | `#3e5e32` × `#8e2f1e` | 43.3 | 7.5 | **7.1** | **7** | **1.11:1** |
| claro | bom × atenção | `#3e5e32` × `#7e5111` | 27.2 | **7.0** | 9.9 | **5** | 1.08:1 |
| claro | atenção × crítico | `#7e5111` × `#8e2f1e` | 15.6 | 6.0 | **3.6** | 12 | 1.19:1 |
| escuro | bom × atenção | `#a8cc85` × `#f0d482` | 25.3 | **4.9** | 12.9 | 21 | 1.24:1 |
| escuro | bom × crítico | `#a8cc85` × `#e39074` | 28.3 | 8.1 | **5.5** | 28 | 1.37:1 |

Os três estados do gráfico no tema claro têm **Δcinza de 5, 7 e 12** numa escala de 256
e razão de luminância entre si de 1.08 a 1.19:1. Em preto e branco eles são o mesmo
tom. "Saudável" e "crítico" — os dois extremos opostos do sistema — ficam a 1.11:1 um
do outro.

Aqui o canal redundante depende do gráfico: num medidor com número impresso ao lado, o
número salva. Numa faixa colorida sem rótulo, não há salvação. Esta auditoria mediu as
cores; **quais gráficos imprimem o valor ao lado da cor não foi verificado nesta
frente** e fica como pendência explícita.

### 5.6 O que NÃO é defeito, e por quê

Os pares mais extremos da tabela 5.3 são **fundos de chip**: `saudável × ruptura` no
tema claro tem ΔE2000 **0.8** sob deuteranopia e Δcinza **4**. À primeira vista é
catastrófico. Não é: o fundo do chip é uma lavagem a 11–16% de alfa que existe só para
destacar o chip da linha. A informação está na **cor do texto** (ΔE2000 12.5 no mesmo
par), na **palavra** (`EM ESTOQUE` × `RUPTURA`) e no **ícone** (tique × triângulo),
todos verificados no DOM na seção 5.2. Reportar o fundo do chip como falha de 1.4.1
seria medir o canal errado — e é exatamente o tipo de falso positivo que uma auditoria
de paleta produz e uma auditoria de produto tem de evitar.

### 5.7 Prova em escala de cinza

As telas de estado foram capturadas nos dois temas com `filter: grayscale(1)` aplicado à
raiz do documento, o que remove **todo** canal cromático de uma vez — é um teste mais
duro que qualquer simulação de daltonismo. Arquivos em
`docs/marca/auditoria/evidencias/`, pares `<tema>__<rota>.png` e
`<tema>__<rota>__cinza.png`, para Dashboard, Estoque, Alertas, Decisões, Relatórios e
Planejamento (24 imagens).

Nas versões em cinza os badges continuam legíveis porque a palavra e o ícone
sobrevivem ao filtro; o que desaparece é a distinção entre as fatias do gráfico de
categoria e entre as cores de estado do medidor — que é precisamente o que os defeitos
D3 e D4 preveem numericamente.

---

## 6 · Gráficos — amostragem de pixel no `<canvas>`

Os 12 `<canvas>` do BI foram lidos com `getImageData` e o histograma de cor extraído
(quantização de 6 bits por canal), nos dois temas.

| tema | evidência | veredito |
| --- | --- | --- |
| claro | tintas dominantes de rótulo: `#282414`, `#282014`, `#5c503c`, `#58503c` | escuro sobre papel — **correto** |
| escuro | tintas dominantes de rótulo: `#f4f0e8`, `#e4dcc8` | claro sobre carvão — **correto** |
| claro | séries: `#843094` ametista, `#0088b8` azul, `#886814` ouro, `#3c5c30` verde | dentro da paleta NANOFLOW |
| escuro | séries: `#b48c08`, `#3098c8`, `#884894`, `#a8cc80`, `#e08c74`, `#f0d080` | dentro da paleta NANOFLOW |

Nenhum pixel de `#e8edf7` ou `#9aa9c7` foi encontrado em nenhum dos 24 canvas. **A
paleta azul-escura antiga não está mais nos gráficos.**

Contraste de cada série contra a superfície do cartão:

| série | hex claro | claro sobre `#f6f2e9` | hex escuro | escuro sobre `#17140f` |
| --- | --- | --- | --- | --- |
| 1 ouro | `#8a6914` | 4.57:1 ✓ | `#b48f0a` | 6.01:1 ✓ |
| 2 azul | `#0289b8` | 3.56:1 ✓ | `#339bc9` | 5.84:1 ✓ |
| 3 ametista | `#843296` | 6.53:1 ✓ | `#894a97` | **3.05:1** ✓ |
| 4 verde-mar | `#069488` | 3.36:1 ✓ | `#1d9c90` | 5.43:1 ✓ |
| 5 terracota | `#cf653f` | 3.36:1 ✓ | `#a44f02` | 3.23:1 ✓ |
| 6 vinho | `#8d3743` | 6.81:1 ✓ | `#d0557f` | 4.62:1 ✓ |
| 7 oliva | `#5d8d2d` | 3.54:1 ✓ | `#5b9600` | 5.08:1 ✓ |
| 8 âmbar | `#824f02` | 6.13:1 ✓ | `#8f5801` | 3.12:1 ✓ |

**As 8 séries passam os 3:1 nos dois temas**, mas por pouco: a ametista do tema escuro
mede **3.05:1** e o âmbar **3.12:1** — folga de 0,05 e 0,12. Qualquer clareamento futuro
da superfície `#17140f` derruba essas duas primeiro.

O problema da escala categórica não é contraste contra o fundo — é distinção **entre
si** sob daltonismo (seção 5.4).

---

## 7 · Divergências com o relatório da Onda 1

`docs/marca/CONTRASTE-NANOFLOW.md` mediu a paleta. Onde os números discordam, vale o
medido no produto.

| # | Onda 1 afirmou | Medido no produto | Veredito |
| --- | --- | --- | --- |
| 1 | "52 pares REPROVADOS (<3.0); **63 pares reprovam para texto normal**" | **4 nós de texto reprovam** em 68.916 medidos | **A Onda 1 superestimou.** Os pares reprovados existem na paleta, mas o produto não os aplica como texto. A auditoria de paleta mediu combinações que ninguém usa. |
| 2 | "`transforms.ts` ainda define `TEXT = '#e8edf7'` e `AXIS_COLOR = '#9aa9c7'`; o rótulo é literalmente invisível" | Zero pixels dessas cores em 24 canvas. `PALETA_DADOS` agora tem `tinta`/`tintaSuave` por tema | **Corrigido.** A Onda 1 estava certa no diagnóstico; a Onda 3 consertou. |
| 3 | "Nenhuma das 7 cores de série chega a 3.0:1 sobre o branco-papel (melhor `#4f8cff` com 2.88:1)" | 8 séries, **todas ≥ 3.29:1** nos dois temas | **Corrigido.** A paleta `#4f8cff` foi substituída. |
| 4 | "`--ouro-dark #8A6914` dá 4.57:1 sobre `#F6F2E9` (passa AA por 0.07 de margem)" | Confirmado 4.57:1 — mas o produto **não usa esse token para texto**. O texto usa `--ouro-texto #74570f` a **6.04:1** | **Divergência de escopo.** A margem apertada da Onda 1 não existe no produto; `#8a6914` sobrou como série 1 do gráfico, onde o limiar é 3.0. |
| 5 | "`#C9A227` sobre branco-papel dá 2.17:1" | Confirmado **2.17:1** — e o produto **usa** este ouro como borda de `.btn`, filete de aba ativa do dock e anel de foco no tema claro | **A Onda 1 subestimou o impacto.** Tratou como problema de texto; é um problema de 1.4.11 e 2.4.7, e está em produção. |
| 6 | "`--verde #3E5E32` × `--terra #8E2F1E`: ΔE 61.3 normal, **ΔE 8.8 na deuteranopia**" | ΔE76 deuteranopia **15.8**; ΔE2000 **7.1** | **Número corrigido.** A Onda 1 reportou ΔE76 e errou o valor; em ΔE2000 (métrica correta) a fragilidade é ainda maior do que o rótulo "8.8" sugeria. A conclusão dela estava certa. |
| 7 | "a razão de luminância entre os dois estados é **1.11:1**" | **1.11:1**, exato | **Confirmado.** É o achado mais sólido da Onda 1. |
| 8 | (não mediu) | Tema escuro deixou 4 tokens de tema claro em `.action-card` | **Novo.** Invisível para auditoria de paleta: o defeito é qual token foi aplicado onde. |
| 9 | (não mediu) | `input` perde o anel de foco por especificidade de `:not()` | **Novo.** Só aparece com `Tab` de teclado no DOM. |
| 10 | (não mediu) | `.badge.green` passa na linha par (4.87) e reprova na ímpar (3.96) | **Novo.** A zebra da tabela só existe no DOM. |

---

## 8 · As 10 reprovações mais graves, em ordem

| # | rota · tema | seletor | medida | por quê é grave |
| --- | --- | --- | --- | --- |
| 1 | `/#/admin/planejamento` · escuro | `.action-card.red .action-count` + filete 3px | **1.61:1** (exige 3.0) | O número de "RISCO DE RUPTURA", 28px, é o indicador mais importante da tela de compras. Token de tema claro (`--terra`) sobre `#17140f`. |
| 2 | claro · todas as rotas | `.btn`, `.btn.ghost` (borda 1px, sem preenchimento) | **1.72:1** / **2.17:1** | A borda **é** o botão — não há fundo. 3.267 instâncias medidas. O tema padrão do produto. |
| 3 | `/#/admin/estoque`, `/#/loja` · claro | `input:focus-visible` | anel **1.28:1** | Campo de busca sem anel de foco. `:not()` triplo (0,3,1) derrota `:focus-visible` (0,1,0). |
| 4 | BI · escuro | série 5 `#a44f02` × série 8 `#8f5801` | **ΔE2000 0.6** protanopia, Δcinza **3** | Duas séries do gráfico viram a mesma cor. Sem canal redundante em barra empilhada/Sankey. |
| 5 | `/#/admin/planejamento` · escuro | `.action-card.amber/.blue/.green` filete 3px | **2.19 / 2.72 / 2.78:1** | O `border-left-color` não foi trocado em **nenhuma** das 4 variantes no tema escuro. |
| 6 | `/#/admin` · claro | `.dock button.active::after` + fundo | **1.77:1** e **1.22:1** | Nenhum canal cromático do estado "aba ativa" chega a 3:1. |
| 7 | `/#/admin/estoque`, `/#/loja` · escuro | `input`, `.mselect-btn` `:focus-visible` | anel **2.30:1** | Mesmo defeito no escuro; `--ring` a 42% ainda não alcança 3:1. |
| 8 | BI · claro | estado `bom #3e5e32` × `crítico #8e2f1e` | **ΔE2000 7.1**, Δcinza **7**, lum **1.11:1** | Os dois estados opostos do sistema, indistinguíveis em P&B (`Reports.tsx` imprime). |
| 9 | `/#/admin/relatorios`, `/#/admin/lojas` · escuro | `.badge.green` sobre linha ímpar | **3.96:1** (exige 4.5) | Mesmo chip: passa na linha par (4.87), reprova na ímpar. Só visível no DOM. |
| 10 | `/#/admin/decisoes` · ambos | `.badge.red` e `.badge.amber` | ícone `path` **idêntico** | Prioridade alta e média compartilham o ícone; o par é o mais frágil sob deuteranopia (ΔE 6.7). |

---

## 9 · Pendências desta frente (o que NÃO foi provado)

Registrado para não virar aprovação por omissão:

- **Estados de interação além do foco.** `:hover` e `:active` não foram varridos.
- **Formulários em erro.** Nenhuma tela foi levada a estado de validação inválida.
- **Modais, menus abertos e `<select>` nativo aberto** não entraram na varredura.
- **`/#/loja/produto/:id`** (página de produto) não está nas 17 rotas do briefing e não
  foi medida.
- **Quais gráficos imprimem o valor numérico ao lado da cor** — determina se D4 é
  defeito de 1.4.1 ou só de estética. Precisa de inspeção gráfico a gráfico.
- **Variação de nota em Relatórios** (A/B/C): só `A` apareceu na base medida.
- **Texto dentro de `<canvas>`** foi verificado por histograma de cor, não por OCR: a
  auditoria prova que a tinta é escura no claro e clara no escuro, não mede o contraste
  de cada rótulo individual contra o que está imediatamente atrás dele.

---

## 10 · Artefatos

| arquivo | conteúdo |
| --- | --- |
| `evidencias/*.png` | 24 capturas: 6 telas de estado × 2 temas × (normal + `grayscale(1)`) |
| `evidencias/reprovacoes.json` | toda reprovação de texto e de componente, com seletor e cor |
| `evidencias/raw3.json` | cores de estado colhidas do DOM + amostragem dos 24 canvas |
| `evidencias/foco.json` | 66 paradas de `Tab` com anel, borda e sombra medidos |
| `evidencias/cor.md` | 12 conjuntos, 130 pares, ΔE2000/ΔE76/Δcinza em 3 simulações |
| `evidencias/comp.json`, `comp2.json` | contraste de limite por tipo de controle |
| `evidencias/lib.js`, `lib2.js` | o instrumento (injetado no DOM) |
| `evidencias/run.mjs`, `run2.mjs`, `foco.mjs`, `cor.mjs` | os arranjos de medição, para refazer a auditoria |
| `evidencias/redund.json` | ícone e palavra de cada badge de estado, por tela |


---

## Anexo A · Tabela completa de simulação de daltonismo

Todos os 12 conjuntos de cor colhidos do DOM, com simulação Machado 2009 (severidade
1.0) e todos os pares. `Δcinza` é a distância em luminância relativa mapeada de volta a
sRGB (0–255) — o que sobra na impressão em preto e branco.

### Badge · estado de estoque (tema claro) — cor do TEXTO

Superfície: `#f6f2e9`

| cor | hex | vs superfície | cinza (0-255) | protan. Machado | deuteran. Machado | tritan. |
| --- | --- | --- | --- | --- | --- | --- |
| saudável/verde | `#486441` | 5.92:1 | 93 | `#665e3f` | `#625c43` | `#47625b` |
| atenção/âmbar | `#71430a` | 7.49:1 | 78 | `#524700` | `#5d520b` | `#7c3839` |
| ruptura/terra | `#6e1c0e` | 10.24:1 | 58 | `#352e0b` | `#49400a` | `#7a001a` |
| neutro/cinza | `#5c543e` | 6.73:1 | 84 | `#59533d` | `#5b553f` | `#61504e` |
| info/azul | `#2a2416` | 13.80:1 | 37 | `#272415` | `#292516` | `#2d2220` |

| par de estados | ΔE2000 normal | ΔE2000 protan. | ΔE2000 deuteran. | ΔE76 deuteran. | Δcinza | razão de lum. entre os dois |
| --- | --- | --- | --- | --- | --- | --- |
| saudável/verde × atenção/âmbar | 28.3 | 11.8 | 11.3 | 24.3 | 15 | 1.27:1 |
| saudável/verde × ruptura/terra | 41.4 | 16.2 | 12.5 | 20.5 | 35 | 1.73:1 |
| saudável/verde × neutro/cinza | 15.3 | 4.9 | 2.6 | 3.3 | 9 | 1.14:1 | **FRÁGIL**
| saudável/verde × info/azul | 24.7 | 19.9 | 18.4 | 24.8 | 56 | 2.33:1 |
| atenção/âmbar × ruptura/terra | 16.7 | 10.7 | 6.7 | 10.7 | 20 | 1.37:1 | **FRÁGIL**
| atenção/âmbar × neutro/cinza | 15.5 | 12.2 | 11.7 | 25.6 | 6 | 1.11:1 |
| atenção/âmbar × info/azul | 21.0 | 17.6 | 19.9 | 35.0 | 41 | 1.84:1 |
| ruptura/terra × neutro/cinza | 24.9 | 13.1 | 11.5 | 20.4 | 26 | 1.52:1 |
| ruptura/terra × info/azul | 23.3 | 7.6 | 13.9 | 24.6 | 21 | 1.35:1 | **FRÁGIL**
| neutro/cinza × info/azul | 15.9 | 15.6 | 15.9 | 21.7 | 47 | 2.05:1 |

### Badge · estado de estoque (tema escuro) — cor do TEXTO

Superfície: `#17140f`

| cor | hex | vs superfície | cinza (0-255) | protan. Machado | deuteran. Machado | tritan. |
| --- | --- | --- | --- | --- | --- | --- |
| saudável/verde | `#7d9f62` | 6.13:1 | 149 | `#a4975e` | `#9f9465` | `#7e9a90` |
| atenção/âmbar | `#f0b429` | 9.85:1 | 190 | `#cdb500` | `#dbc431` | `#ffa29b` |
| ruptura/terra | `#f6bea9` | 11.24:1 | 202 | `#ccc4a8` | `#d9cfa9` | `#ffb6b8` |
| neutro/cinza | `#e4dcc9` | 13.45:1 | 220 | `#e1dbc8` | `#e3ddca` | `#e9d9d6` |
| info/azul | `#f6f2e9` | 16.44:1 | 242 | `#f4f2e9` | `#f5f3e9` | `#f9f0ef` |

| par de estados | ΔE2000 normal | ΔE2000 protan. | ΔE2000 deuteran. | ΔE76 deuteran. | Δcinza | razão de lum. entre os dois |
| --- | --- | --- | --- | --- | --- | --- |
| saudável/verde × atenção/âmbar | 29.6 | 15.6 | 19.6 | 48.0 | 41 | 1.61:1 |
| saudável/verde × ruptura/terra | 36.2 | 15.2 | 16.7 | 22.7 | 53 | 1.83:1 |
| saudável/verde × neutro/cinza | 25.8 | 21.5 | 21.7 | 31.5 | 71 | 2.19:1 |
| saudável/verde × info/azul | 30.6 | 27.6 | 27.3 | 40.6 | 93 | 2.68:1 |
| atenção/âmbar × ruptura/terra | 23.5 | 20.3 | 16.9 | 51.0 | 12 | 1.14:1 |
| atenção/âmbar × neutro/cinza | 23.3 | 24.3 | 22.4 | 61.8 | 30 | 1.37:1 |
| atenção/âmbar × info/azul | 27.7 | 29.2 | 26.6 | 68.2 | 52 | 1.67:1 |
| ruptura/terra × neutro/cinza | 17.7 | 6.4 | 6.9 | 11.4 | 18 | 1.20:1 | **FRÁGIL**
| ruptura/terra × info/azul | 19.6 | 12.8 | 12.6 | 19.8 | 40 | 1.46:1 |
| neutro/cinza × info/azul | 6.3 | 6.5 | 6.0 | 9.1 | 22 | 1.22:1 | **FRÁGIL**

### Badge · estado de estoque (tema claro) — FUNDO composto do chip

Superfície: `#f6f2e9`

| cor | hex | vs superfície | cinza (0-255) | protan. Machado | deuteran. Machado | tritan. |
| --- | --- | --- | --- | --- | --- | --- |
| saudável/verde | `#e1e1d5` | 1.18:1 | 224 | `#e3e0d4` | `#e4e0d5` | `#e3dfdd` |
| atenção/âmbar | `#e5dbcc` | 1.23:1 | 220 | `#dfdbcb` | `#e2ddcc` | `#ead8d7` |
| ruptura/terra | `#e7dad1` | 1.22:1 | 220 | `#dedbd0` | `#e1ddd1` | `#ecd8d7` |
| info/azul | `#e4dcc9` | 1.22:1 | 220 | `#e1dbc8` | `#e3ddca` | `#e9d9d6` |

| par de estados | ΔE2000 normal | ΔE2000 protan. | ΔE2000 deuteran. | ΔE76 deuteran. | Δcinza | razão de lum. entre os dois |
| --- | --- | --- | --- | --- | --- | --- |
| saudável/verde × atenção/âmbar | 4.8 | 2.0 | 2.5 | 3.3 | 4 | 1.04:1 | **FRÁGIL**
| saudável/verde × ruptura/terra | 7.1 | 1.2 | 0.8 | 1.2 | 4 | 1.04:1 | **FRÁGIL**
| saudável/verde × info/azul | 4.2 | 3.0 | 3.2 | 4.4 | 4 | 1.04:1 | **FRÁGIL**
| atenção/âmbar × ruptura/terra | 3.6 | 2.0 | 2.0 | 2.6 | 0 | 1.00:1 | **FRÁGIL**
| atenção/âmbar × info/azul | 2.2 | 1.3 | 0.8 | 1.1 | 0 | 1.00:1 | **FRÁGIL**
| ruptura/terra × info/azul | 5.9 | 3.2 | 2.7 | 3.7 | 0 | 1.00:1 | **FRÁGIL**

### Badge · estado de estoque (tema escuro) — FUNDO composto do chip

Superfície: `#17140f`

| cor | hex | vs superfície | cinza (0-255) | protan. Machado | deuteran. Machado | tritan. |
| --- | --- | --- | --- | --- | --- | --- |
| saudável/verde | `#272a1c` | 1.25:1 | 41 | `#2c281b` | `#2c291d` | `#282826` |
| atenção/âmbar | `#3a2e13` | 1.38:1 | 48 | `#342e10` | `#373114` | `#3f2a28` |
| ruptura/terra | `#362c25` | 1.35:1 | 46 | `#2f2d25` | `#312f25` | `#392a2a` |
| info/azul | `#221d15` | 1.10:1 | 30 | `#1f1d14` | `#201e15` | `#241c1b` |

| par de estados | ΔE2000 normal | ΔE2000 protan. | ΔE2000 deuteran. | ΔE76 deuteran. | Δcinza | razão de lum. entre os dois |
| --- | --- | --- | --- | --- | --- | --- |
| saudável/verde × atenção/âmbar | 10.4 | 6.8 | 7.2 | 11.5 | 7 | 1.10:1 | **FRÁGIL**
| saudável/verde × ruptura/terra | 10.7 | 3.2 | 2.2 | 3.2 | 5 | 1.08:1 | **FRÁGIL**
| saudável/verde × info/azul | 7.7 | 4.1 | 3.8 | 5.7 | 11 | 1.14:1 | **FRÁGIL**
| atenção/âmbar × ruptura/terra | 9.2 | 9.2 | 7.9 | 12.6 | 2 | 1.02:1 | **FRÁGIL**
| atenção/âmbar × info/azul | 9.9 | 10.0 | 10.1 | 15.7 | 18 | 1.26:1 | **FRÁGIL**
| ruptura/terra × info/azul | 6.1 | 5.1 | 5.4 | 8.1 | 16 | 1.23:1 | **FRÁGIL**

### Gráfico · cores de ESTADO (tema claro)

Superfície: `#f6f2e9`

| cor | hex | vs superfície | cinza (0-255) | protan. Machado | deuteran. Machado | tritan. |
| --- | --- | --- | --- | --- | --- | --- |
| bom | `#3e5e32` | 6.59:1 | 86 | `#61582f` | `#5c5535` | `#3d5b53` |
| atenção | `#7e5111` | 6.12:1 | 91 | `#605404` | `#6b5f13` | `#8a4645` |
| crítico | `#8e2f1e` | 7.30:1 | 79 | `#4a421b` | `#62571a` | `#9d142c` |

| par de estados | ΔE2000 normal | ΔE2000 protan. | ΔE2000 deuteran. | ΔE76 deuteran. | Δcinza | razão de lum. entre os dois |
| --- | --- | --- | --- | --- | --- | --- |
| bom × atenção | 27.2 | 7.0 | 9.9 | 22.6 | 5 | 1.08:1 | **FRÁGIL**
| bom × crítico | 43.3 | 7.5 | 7.1 | 15.8 | 7 | 1.11:1 | **FRÁGIL**
| atenção × crítico | 19.0 | 9.3 | 3.6 | 7.2 | 12 | 1.19:1 | **FRÁGIL**

### Gráfico · cores de ESTADO (tema escuro)

Superfície: `#17140f`

| cor | hex | vs superfície | cinza (0-255) | protan. Machado | deuteran. Machado | tritan. |
| --- | --- | --- | --- | --- | --- | --- |
| bom | `#a8cc85` | 10.18:1 | 193 | `#d2c380` | `#cdc089` | `#aac6ba` |
| atenção | `#f0d482` | 12.63:1 | 214 | `#e5d17b` | `#ecd985` | `#ffc8c0` |
| crítico | `#e39074` | 7.44:1 | 165 | `#a59a72` | `#b9ac73` | `#f58389` |

| par de estados | ΔE2000 normal | ΔE2000 protan. | ΔE2000 deuteran. | ΔE76 deuteran. | Δcinza | razão de lum. entre os dois |
| --- | --- | --- | --- | --- | --- | --- |
| bom × atenção | 17.8 | 4.9 | 8.1 | 16.9 | 21 | 1.24:1 | **FRÁGIL**
| bom × crítico | 40.1 | 12.8 | 5.5 | 7.5 | 28 | 1.37:1 | **FRÁGIL**
| atenção × crítico | 27.5 | 17.4 | 12.4 | 20.7 | 49 | 1.70:1 |

### Gráfico · escala CATEGÓRICA (tema claro)

Superfície: `#f6f2e9`

| cor | hex | vs superfície | cinza (0-255) | protan. Machado | deuteran. Machado | tritan. |
| --- | --- | --- | --- | --- | --- | --- |
| 1 ouro | `#8a6914` | 4.57:1 | 110 | `#776900` | `#7f7119` | `#965e59` |
| 2 azul | `#0289b8` | 3.56:1 | 127 | `#7188ba` | `#5c79b7` | `#009699` |
| 3 ametista | `#843296` | 6.53:1 | 86 | `#125199` | `#3a5994` | `#854360` |
| 4 verde-mar | `#069488` | 3.36:1 | 132 | `#8c8b88` | `#7b7f89` | `#009890` |
| 5 terracota | `#cf653f` | 3.36:1 | 132 | `#82753b` | `#9b8d3d` | `#e3505c` |
| 6 vinho | `#8d3743` | 6.81:1 | 84 | `#4a4943` | `#605a41` | `#9a2a3c` |
| 7 oliva | `#5d8d2d` | 3.54:1 | 128 | `#938220` | `#8c7f35` | `#5e8779` |
| 8 âmbar | `#824f02` | 6.13:1 | 90 | `#605300` | `#6c5f04` | `#8f4342` |

| par de estados | ΔE2000 normal | ΔE2000 protan. | ΔE2000 deuteran. | ΔE76 deuteran. | Δcinza | razão de lum. entre os dois |
| --- | --- | --- | --- | --- | --- | --- |
| 1 ouro × 2 azul | 48.0 | 47.2 | 48.1 | 83.9 | 17 | 1.28:1 |
| 1 ouro × 3 ametista | 55.9 | 52.8 | 48.9 | 84.4 | 24 | 1.43:1 |
| 1 ouro × 4 verde-mar | 36.3 | 26.3 | 30.0 | 53.5 | 22 | 1.36:1 |
| 1 ouro × 5 terracota | 24.8 | 7.7 | 10.7 | 11.4 | 22 | 1.36:1 | **FRÁGIL**
| 1 ouro × 6 vinho | 35.2 | 24.0 | 15.7 | 33.2 | 26 | 1.49:1 |
| 1 ouro × 7 oliva | 24.3 | 10.0 | 5.9 | 8.1 | 18 | 1.29:1 | **FRÁGIL**
| 1 ouro × 8 âmbar | 10.6 | 8.2 | 6.8 | 7.3 | 20 | 1.34:1 | **FRÁGIL**
| 2 azul × 3 ametista | 41.7 | 21.8 | 12.2 | 13.0 | 41 | 1.83:1 |
| 2 azul × 4 verde-mar | 21.7 | 19.9 | 15.4 | 30.8 | 5 | 1.06:1 |
| 2 azul × 5 terracota | 49.0 | 40.8 | 47.7 | 80.8 | 5 | 1.06:1 |
| 2 azul × 6 vinho | 50.7 | 33.0 | 36.6 | 53.7 | 43 | 1.91:1 |
| 2 azul × 7 oliva | 47.6 | 45.7 | 46.4 | 77.9 | 1 | 1.01:1 |
| 2 azul × 8 âmbar | 48.8 | 47.9 | 48.8 | 83.7 | 37 | 1.72:1 |
| 3 ametista × 4 verde-mar | 45.7 | 33.5 | 20.9 | 34.3 | 46 | 1.95:1 |
| 3 ametista × 5 terracota | 41.5 | 48.2 | 51.4 | 83.0 | 46 | 1.94:1 |
| 3 ametista × 6 vinho | 23.1 | 28.0 | 34.6 | 52.1 | 2 | 1.04:1 |
| 3 ametista × 7 oliva | 74.6 | 55.4 | 48.6 | 79.3 | 42 | 1.85:1 |
| 3 ametista × 8 âmbar | 49.1 | 49.6 | 47.8 | 83.0 | 4 | 1.07:1 |
| 4 verde-mar × 5 terracota | 50.3 | 19.6 | 30.3 | 50.1 | 0 | 1.00:1 |
| 4 verde-mar × 6 vinho | 56.4 | 25.3 | 23.0 | 26.2 | 48 | 2.03:1 |
| 4 verde-mar × 7 oliva | 23.7 | 22.9 | 29.1 | 47.3 | 4 | 1.05:1 |
| 4 verde-mar × 8 âmbar | 42.9 | 30.1 | 31.8 | 54.0 | 42 | 1.82:1 |
| 5 terracota × 6 vinho | 24.4 | 22.9 | 23.4 | 34.9 | 48 | 2.02:1 |
| 5 terracota × 7 oliva | 48.0 | 8.0 | 5.2 | 6.0 | 4 | 1.05:1 | **FRÁGIL**
| 5 terracota × 8 âmbar | 22.3 | 13.1 | 18.2 | 18.4 | 42 | 1.82:1 |
| 6 vinho × 7 oliva | 56.6 | 30.2 | 18.1 | 29.8 | 44 | 1.93:1 |
| 6 vinho × 8 âmbar | 27.8 | 19.6 | 13.1 | 31.0 | 6 | 1.11:1 |
| 7 oliva × 8 âmbar | 34.6 | 18.1 | 12.5 | 13.8 | 38 | 1.73:1 |

### Gráfico · escala CATEGÓRICA (tema escuro)

Superfície: `#17140f`

| cor | hex | vs superfície | cinza (0-255) | protan. Machado | deuteran. Machado | tritan. |
| --- | --- | --- | --- | --- | --- | --- |
| 1 ouro | `#b48f0a` | 6.01:1 | 147 | `#a18e00` | `#aa9818` | `#c4817a` |
| 2 azul | `#339bc9` | 5.84:1 | 145 | `#8499cb` | `#708bc8` | `#00a7aa` |
| 3 ametista | `#894a97` | 3.05:1 | 99 | `#3d5f9a` | `#506595` | `#8a5569` |
| 4 verde-mar | `#1d9c90` | 5.43:1 | 140 | `#949390` | `#838691` | `#00a098` |
| 5 terracota | `#a44f02` | 3.23:1 | 103 | `#685b00` | `#7d6e00` | `#b53b43` |
| 6 vinho | `#d0557f` | 4.62:1 | 128 | `#6b7180` | `#8c887c` | `#e04965` |
| 7 oliva | `#5b9600` | 5.08:1 | 135 | `#9d8900` | `#95851c` | `#5c8f7f` |
| 8 âmbar | `#8f5801` | 3.12:1 | 100 | `#6a5c00` | `#776904` | `#9d4a4a` |

| par de estados | ΔE2000 normal | ΔE2000 protan. | ΔE2000 deuteran. | ΔE76 deuteran. | Δcinza | razão de lum. entre os dois |
| --- | --- | --- | --- | --- | --- | --- |
| 1 ouro × 2 azul | 50.9 | 48.1 | 51.2 | 97.6 | 2 | 1.03:1 |
| 1 ouro × 3 ametista | 60.7 | 54.7 | 52.1 | 93.6 | 48 | 1.97:1 |
| 1 ouro × 4 verde-mar | 37.0 | 25.1 | 33.7 | 69.0 | 7 | 1.11:1 |
| 1 ouro × 5 terracota | 26.2 | 20.8 | 15.7 | 18.9 | 44 | 1.86:1 |
| 1 ouro × 6 vinho | 50.0 | 37.1 | 22.2 | 55.6 | 19 | 1.30:1 |
| 1 ouro × 7 oliva | 23.8 | 1.7 | 6.8 | 10.9 | 12 | 1.18:1 | **FRÁGIL**
| 1 ouro × 8 âmbar | 21.5 | 20.3 | 18.1 | 22.1 | 47 | 1.93:1 |
| 2 azul × 3 ametista | 41.3 | 22.9 | 15.3 | 16.2 | 46 | 1.91:1 |
| 2 azul × 4 verde-mar | 21.2 | 19.7 | 15.1 | 28.9 | 5 | 1.07:1 |
| 2 azul × 5 terracota | 50.8 | 50.4 | 50.1 | 88.6 | 42 | 1.80:1 |
| 2 azul × 6 vinho | 53.0 | 18.1 | 27.4 | 42.2 | 17 | 1.26:1 |
| 2 azul × 7 oliva | 51.1 | 47.8 | 49.3 | 89.4 | 10 | 1.15:1 |
| 2 azul × 8 âmbar | 50.3 | 50.1 | 50.0 | 86.2 | 45 | 1.87:1 |
| 3 ametista × 4 verde-mar | 44.2 | 30.3 | 18.2 | 26.3 | 41 | 1.78:1 |
| 3 ametista × 5 terracota | 43.0 | 47.4 | 46.3 | 82.0 | 4 | 1.06:1 |
| 3 ametista × 6 vinho | 20.2 | 14.7 | 28.8 | 38.8 | 29 | 1.52:1 |
| 3 ametista × 7 oliva | 74.0 | 53.7 | 48.3 | 84.3 | 36 | 1.66:1 |
| 3 ametista × 8 âmbar | 47.4 | 47.4 | 45.6 | 79.2 | 1 | 1.02:1 |
| 4 verde-mar × 5 terracota | 48.6 | 30.9 | 32.7 | 59.9 | 37 | 1.68:1 |
| 4 verde-mar × 6 vinho | 56.7 | 15.9 | 12.2 | 13.4 | 12 | 1.17:1 |
| 4 verde-mar × 7 oliva | 26.9 | 25.0 | 31.6 | 60.5 | 5 | 1.07:1 |
| 4 verde-mar × 8 âmbar | 43.2 | 30.7 | 32.8 | 57.6 | 40 | 1.74:1 |
| 5 terracota × 6 vinho | 33.9 | 33.0 | 22.1 | 46.9 | 25 | 1.43:1 |
| 5 terracota × 7 oliva | 45.2 | 18.9 | 9.0 | 9.1 | 32 | 1.57:1 | **FRÁGIL**
| 5 terracota × 8 âmbar | 8.4 | 0.6 | 2.1 | 3.4 | 3 | 1.04:1 | **FRÁGIL**
| 6 vinho × 7 oliva | 68.6 | 36.4 | 19.9 | 47.2 | 7 | 1.10:1 |
| 6 vinho × 8 âmbar | 39.7 | 32.9 | 22.6 | 44.8 | 28 | 1.48:1 |
| 7 oliva × 8 âmbar | 36.0 | 18.4 | 11.1 | 11.8 | 35 | 1.63:1 |

### Prioridade de decisão (tema claro)

Superfície: `#f6f2e9`

| cor | hex | vs superfície | cinza (0-255) | protan. Machado | deuteran. Machado | tritan. |
| --- | --- | --- | --- | --- | --- | --- |
| alta/terra | `#6e1c0e` | 10.24:1 | 58 | `#352e0b` | `#49400a` | `#7a001a` |
| média/âmbar | `#71430a` | 7.49:1 | 78 | `#524700` | `#5d520b` | `#7c3839` |
| baixa/cinza | `#5c543e` | 6.73:1 | 84 | `#59533d` | `#5b553f` | `#61504e` |

| par de estados | ΔE2000 normal | ΔE2000 protan. | ΔE2000 deuteran. | ΔE76 deuteran. | Δcinza | razão de lum. entre os dois |
| --- | --- | --- | --- | --- | --- | --- |
| alta/terra × média/âmbar | 16.7 | 10.7 | 6.7 | 10.7 | 20 | 1.37:1 | **FRÁGIL**
| alta/terra × baixa/cinza | 24.9 | 13.1 | 11.5 | 20.4 | 26 | 1.52:1 |
| média/âmbar × baixa/cinza | 15.5 | 12.2 | 11.7 | 25.6 | 6 | 1.11:1 |

### Prioridade de decisão (tema escuro)

Superfície: `#17140f`

| cor | hex | vs superfície | cinza (0-255) | protan. Machado | deuteran. Machado | tritan. |
| --- | --- | --- | --- | --- | --- | --- |
| alta/terra | `#f6bea9` | 11.24:1 | 202 | `#ccc4a8` | `#d9cfa9` | `#ffb6b8` |
| média/âmbar | `#f0b429` | 9.85:1 | 190 | `#cdb500` | `#dbc431` | `#ffa29b` |
| baixa/cinza | `#e4dcc9` | 13.45:1 | 220 | `#e1dbc8` | `#e3ddca` | `#e9d9d6` |

| par de estados | ΔE2000 normal | ΔE2000 protan. | ΔE2000 deuteran. | ΔE76 deuteran. | Δcinza | razão de lum. entre os dois |
| --- | --- | --- | --- | --- | --- | --- |
| alta/terra × média/âmbar | 23.5 | 20.3 | 16.9 | 51.0 | 12 | 1.14:1 |
| alta/terra × baixa/cinza | 17.7 | 6.4 | 6.9 | 11.4 | 18 | 1.20:1 | **FRÁGIL**
| média/âmbar × baixa/cinza | 23.3 | 24.3 | 22.4 | 61.8 | 30 | 1.37:1 |

### Action-card · NÚMERO herói (tema claro)

Superfície: `#f6f2e9`

| cor | hex | vs superfície | cinza (0-255) | protan. Machado | deuteran. Machado | tritan. |
| --- | --- | --- | --- | --- | --- | --- |
| risco/red | `#6e1c0e` | 10.24:1 | 58 | `#352e0b` | `#49400a` | `#7a001a` |
| pedidos/green | `#486441` | 5.92:1 | 93 | `#665e3f` | `#625c43` | `#47625b` |
| transf/blue | `#74570f` | 6.04:1 | 91 | `#635700` | `#6a5f13` | `#7f4e4a` |
| excesso/amber | `#71430a` | 7.49:1 | 78 | `#524700` | `#5d520b` | `#7c3839` |

| par de estados | ΔE2000 normal | ΔE2000 protan. | ΔE2000 deuteran. | ΔE76 deuteran. | Δcinza | razão de lum. entre os dois |
| --- | --- | --- | --- | --- | --- | --- |
| risco/red × pedidos/green | 41.4 | 16.2 | 12.5 | 20.5 | 35 | 1.73:1 |
| risco/red × transf/blue | 26.1 | 16.2 | 11.2 | 16.4 | 33 | 1.70:1 |
| risco/red × excesso/amber | 16.7 | 10.7 | 6.7 | 10.7 | 20 | 1.37:1 | **FRÁGIL**
| pedidos/green × transf/blue | 21.8 | 10.9 | 11.6 | 26.5 | 2 | 1.02:1 | **FRÁGIL**
| pedidos/green × excesso/amber | 28.3 | 11.8 | 11.3 | 24.3 | 15 | 1.27:1 |
| transf/blue × excesso/amber | 9.4 | 5.8 | 4.6 | 5.9 | 13 | 1.24:1 | **FRÁGIL**

### Action-card · NÚMERO herói (tema escuro)

Superfície: `#17140f`

| cor | hex | vs superfície | cinza (0-255) | protan. Machado | deuteran. Machado | tritan. |
| --- | --- | --- | --- | --- | --- | --- |
| risco/red | `#6e1c0e` | 1.61:1 | 58 | `#352e0b` | `#49400a` | `#7a001a` |
| pedidos/green | `#486441` | 2.78:1 | 93 | `#665e3f` | `#625c43` | `#47625b` |
| transf/blue | `#f0d482` | 12.63:1 | 214 | `#e5d17b` | `#ecd985` | `#ffc8c0` |
| excesso/amber | `#f0b429` | 9.85:1 | 190 | `#cdb500` | `#dbc431` | `#ffa29b` |

| par de estados | ΔE2000 normal | ΔE2000 protan. | ΔE2000 deuteran. | ΔE76 deuteran. | Δcinza | razão de lum. entre os dois |
| --- | --- | --- | --- | --- | --- | --- |
| risco/red × pedidos/green | 41.4 | 16.2 | 12.5 | 20.5 | 35 | 1.73:1 |
| risco/red × transf/blue | 64.5 | 65.1 | 55.0 | 60.7 | 156 | 7.87:1 |
| risco/red × excesso/amber | 59.5 | 55.3 | 52.0 | 65.0 | 132 | 6.14:1 |
| pedidos/green × transf/blue | 43.6 | 39.1 | 42.1 | 55.5 | 121 | 4.55:1 |
| pedidos/green × excesso/amber | 44.2 | 35.9 | 40.3 | 68.6 | 97 | 3.55:1 |
| transf/blue × excesso/amber | 11.6 | 10.9 | 9.2 | 28.4 | 24 | 1.28:1 | **FRÁGIL**