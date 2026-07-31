# Auditoria — Navegação por teclado e leitor de tela

Onda 4 · Nova Ótica / NANOFLOW · 31-07-2026

**Método.** Build de produção (`VITE_DEMO=1 VITE_HASH_ROUTER=1`) servido por HTTP em
`localhost:4173`, dirigido por Chromium 1194 via playwright-core. Toda rota foi carregada
com `reload()` (o roteador de hash NÃO reinicia a navegação sequencial de foco — sem o
reload o Tab retoma de onde parou na rota anterior e a medição sai falsa). Cada parada de
Tab foi identificada por **identidade de nó no DOM** (marca `__ax` gravada no elemento),
não por rótulo nem por posição: rótulos e coordenadas se repetem quando a tabela rola, e
essa foi a origem de dois falsos positivos descartados (ver "Não é defeito").

Scripts em `/tmp/pwtest/` · dados brutos em `/tmp/pwtest/{tab2,ordem,ax}.json`.

**Total de reprovações: 23.**

---

## 1. Ordem de foco por rota

Nenhuma rota usa `tabindex` positivo (medido: 0 ocorrências em `/admin`, `/admin/bi`,
`/admin/alertas`, `/admin/planejamento`, `/loja`). A ordem de Tab é a ordem do DOM em
todas as 17 rotas, e é estável:

`sidebar (16 paradas) → titlebar (4) → main (n) → dock (9)`

| Rota | Paradas até fechar o ciclo | Focáveis no `<main>` | Paradas até o dock |
|---|---|---|---|
| /admin | 33 | 4 | 24 |
| /admin/bi | 40 | 11 | 31 |
| /admin/estoque | 33 | 4 | 24 |
| /admin/produtos | 31 | 2 | 22 |
| /admin/transferencias | 63 | 34 | 54 |
| **/admin/alertas** | **4385** | **4356** | **4376** |
| /admin/relatorios | 40 | 11 | 31 |
| **/admin/decisoes** | **963** | **934** | **954** |
| /admin/historico | 33 | 4 | 24 |
| /admin/estrategia | 35 | 6 | 26 |
| **/admin/planejamento** | **109** | **80** | **100** |
| /admin/vendas | 41 | 12 | 32 |
| /admin/usuarios | 37 | 8 | 28 |
| /admin/lojas | 29 | 0 | 20 |
| /admin/sincronizacao | 30 | 1 | 21 |
| /loja | 82 | — | sem dock |
| /loja/carrinho | 6 | — | sem dock |

### R1 — `/admin/alertas`: 4376 paradas de Tab até o dock · GRAVE
A tabela de alertas renderiza **2176 linhas**, cada uma com um `<input>` e um botão
`Salvar`: 4356 elementos focáveis dentro do `<main>`. O dock vem depois no DOM. Um usuário
de teclado que queira sair para outra tela pelo dock precisa de **4376 pressionamentos de
Tab**. Na prática o dock é inalcançável por teclado nesta rota. O mesmo vale para
`/admin/decisoes` (954) e `/admin/planejamento` (100).

### R2 — Nenhuma rota tem link de pular para o conteúdo · GRAVE
Medido em 17/17 rotas: zero `skip link`. Em toda rota o usuário de teclado atravessa as
**20 paradas fixas da casca** (15 links da barra lateral + Sair + 3 botões de recorte +
alternador de tema) antes de tocar o conteúdo da tela. Falha 2.4.1 (Bypass Blocks).

### R3 — Salto de foco de 800px da base da barra lateral para a titlebar · MENOR
Parada #15 é `Sair` em `y=829` (rodapé da barra lateral); parada #16 é
`ÓCULOS E RELÓGIOS` em `y=27` (titlebar). O foco sobe 800px de uma parada para a outra.
É consequência da ordem do DOM (coluna esquerda inteira antes da barra de topo) e é
defensável como ordem de landmark, mas o olho que segue o anel de foco perde o fio.

### Foco invisível — não encontrado
Medido em todas as paradas de todas as rotas: **0 paradas sem indicador**. Links e botões
recebem `outline: 2px solid #74570f` (medido `outlineWidth: 2`). Campos de texto e
`select` usam `outline: none` mas trocam a borda para `#74570f` e ganham
`box-shadow: 0 0 0 3px rgba(201,162,39,.34)` (medido após a transição de 0,12s assentar —
ler antes disso devolve o valor intermediário e foi outro falso positivo descartado).

**Ressalva medida:** o halo de 3px compõe para `rgb(231,215,167)` sobre o papel `#f6f2e9`
— cerca de **1,15:1**. Ele não carrega contraste. Quem sinaliza o foco no campo é apenas a
troca de cor da borda de 1px (`rgba(13,11,8,.46)` → `#74570f`, 4,94:1 sobre o papel).
Passa em 2.4.7, mas o indicador é fino.

---

## 2. Dock que recolhe na rolagem — **APROVADO**

Era o risco sinalizado nesta onda. Medido em `/admin/estoque`, `/admin/alertas`,
`/admin/produtos`, `/admin/transferencias`, rolando `.main` até 1600px:

| Medida | Dock recolhido | Após receber foco |
|---|---|---|
| classe | `dock recolhido` | `dock` |
| altura do dock | 23px | 58px |
| altura do botão | 12px | 42px |
| `pointer-events` do botão | `none` | `auto` |
| anel de foco | — | `2px solid`, `:focus-visible` = true |
| `Enter` navega | — | sim (URL muda em 4/4 rotas) |

O Tab **chega** ao dock, ele **expande** ao receber foco (`onFocusCapture` → `setRecolhido(false)`),
o botão volta a 42px, recupera `pointer-events` e responde ao Enter. **Não é armadilha.**
A ressalva não é o dock em si: é R1 — em `/admin/alertas` o Tab só chega lá depois de 4376
paradas, então o alvo existe mas é inatingível.

---

## 3. MultiSelect (filtro de lojas/categorias) — **APROVADO**

Presente em `/admin/estoque` (2 instâncias). Contrato completo verificado passo a passo
com 19 opções de loja:

| Passo | Esperado | Medido | |
|---|---|---|---|
| Gatilho | nome acessível | `"Todas as lojas — filtro de lojas"`, `aria-haspopup=listbox`, `aria-expanded=false` | ok |
| `↓` | abre e foca a 1ª | abre, foco em `option "A GRACIOSA NATAL SHOP"`, `aria-expanded=true` | ok |
| `↓` | navega | foco em `option "A GRACIOSA JUAZEIRO"` | ok |
| `Espaço` | marca sem fechar | `aria-selected=true`, popover segue aberto | ok |
| `Fim` | última opção | foco em `"A GRACIOSA VARANDA"` | ok |
| `Esc` | fecha e devolve o foco | fecha, foco de volta no gatilho | ok |
| `Enter` | abre | abre (`aria-expanded=true`) | ok |
| `Tab` | sai do filtro | vai para o MultiSelect seguinte (`"Todas as categorias"`) | ok |

`role=listbox` com `aria-multiselectable=true` e `aria-label="Opções de lojas"`; tabindex
rotativo faz a lista inteira ser **uma** parada de Tab (19 lojas custariam 19 Tabs sem
isso). Nada a corrigir.

### R4 — `Enter` abre a lista mas não move o foco para dentro · MENOR
Medido no passo 6: após `Enter`, `aria-expanded=true` mas `document.activeElement` continua
no gatilho e nenhuma opção está focada. Com `↓` o foco entra. Quem abriu com `Enter`
precisa de um `↓` extra e, no leitor de tela, não recebe nada depois do "expandido".

---

## 4. Modais (Transferências, Usuários) — **REPROVADO EM TODOS OS CRITÉRIOS**

Ambos são `<div class="modal-overlay"><div class="card modal">` sem semântica de diálogo.

| Critério | `/admin/transferencias` "Nova movimentação" | `/admin/usuarios` "Novo usuário" |
|---|---|---|
| `role="dialog"` | **ausente** (`null`) | **ausente** (`null`) |
| `aria-modal="true"` | **ausente** | **ausente** |
| Nome acessível | **ausente** | **ausente** |
| Foco entra ao abrir | **NÃO** — fica no gatilho | sim (`autoFocus` no 1º campo) |
| Foco preso dentro | **NÃO** — saiu 37× em 45 Tabs | **NÃO** — saiu 38× em 45 Tabs |
| `Esc` fecha | **NÃO** | **NÃO** |
| Foco volta ao gatilho | **NÃO** | **NÃO** |
| Fundo inerte / `aria-hidden` | **NÃO** (63 focáveis fora) | **NÃO** (39 focáveis fora) |

### R5 — Transferências: o foco nunca entra no modal · GRAVE
Ao abrir com `Enter`, `document.activeElement` continua no botão gatilho. As 14 primeiras
paradas de Tab a partir dali:

```
0..13  [FORA] BUTTON "Criar movimentação"   (14 paradas seguidas)
```

São os **30 botões `Criar movimentação` das linhas da tabela**, que estão atrás do overlay
e visualmente obstruídos. O modal tem 9 controles focáveis (`Tipo`, `Produto`, 2 lojas, 3
campos, `Cancelar`, `Registrar`) e **nenhum deles é alcançado**. O usuário de teclado vê um
diálogo bloqueando a tela e opera a tabela por baixo dele às cegas.

### R6 — Usuários: o foco escapa para o dock em 6 Tabs · GRAVE
O modal tem 7 focáveis. Na 7ª parada o foco sai para `BUTTON "Dashboard"` — o dock, atrás
do overlay. Continuar tabulando percorre o dock e a barra lateral inteiros.

### R7 — `Esc` não fecha nenhum dos dois modais · GRAVE
Medido: após `Escape`, `aindaAberto: true` nos dois. Não há handler de teclado. A única
saída é o clique no overlay ou no `Cancelar` — o `Cancelar`, no caso de Transferências,
inalcançável (R5). Falha 2.1.2 (No Keyboard Trap) na prática: o único jeito de sair do
diálogo de Transferências pelo teclado é tabular 30+ vezes até achar o botão certo por
baixo.

### R8 — Sem `role="dialog"`/`aria-modal`, o leitor de tela não anuncia nada · GRAVE
Nada muda no contexto do leitor de tela quando o modal abre. O `<h3>Nova movimentação</h3>`
existe mas não está ligado por `aria-labelledby`. O usuário não é informado de que um
diálogo abriu, qual é ele, nem de que o resto da página deixou de valer.

---

## 5. Alternador de tema — nome sim, estado não

| Estado do produto | `data-tema` | Nome acessível | `aria-pressed` | `role` |
|---|---|---|---|---|
| claro (padrão) | ausente | `"Tema escuro"` | `null` | `button` |
| escuro | `escuro` | `"Tema claro"` | `null` | `button` |
| claro (volta) | ausente | `"Tema escuro"` | `null` | `button` |

Árvore de acessibilidade: `button "Tema escuro"` — sem `checked`, sem `pressed`.

### R9 — O estado atual do tema não é exposto · MÉDIO
O rótulo nomeia a **ação**, não o estado. `"Tema escuro, botão"` é ambíguo no leitor de
tela: pode ser lido como "o tema é escuro" ou "mudar para escuro". Não há `aria-pressed`
nem `role="switch"` com `aria-checked`. O usuário cego não tem como saber em que tema está
— e como o produto persiste a escolha em `localStorage`, ele herda um estado que não
consegue consultar.

### R10 — A troca não é anunciada · MÉDIO
Medido: **0 regiões `aria-live`/`role=status`/`role=alert` na página**. Ao acionar, o rótulo
do botão focado muda de `"Tema escuro"` para `"Tema claro"` sem qualquer anúncio. Leitores
de tela não relêem por conta própria o rótulo de um botão que já está focado: o usuário
aperta Enter e recebe **silêncio**.

---

## 6. Árvore de acessibilidade — achados por categoria

### Marca — **APROVADO** (era um risco conhecido)
`<Mark>` na barra lateral sai com `aria-hidden="true"` e `focusable="false"`, sem `<title>`.
Árvore de acessibilidade da casca: `text "Nova"` / `text "Ótica"` — **uma vez só**. A marca
NÃO é anunciada em duplicidade. Medido em 17 rotas: `"Nova Ótica"` aparece em **0** nomes
acessíveis de controle.

### NANOFLOW em tela de produto — **APROVADO**
Verificação específica pedida. Varredura de nós de texto folha, `aria-label`, `title`,
`alt`, `<svg><title>` e `document.title`:

| Rota | "NANOFLOW" |
|---|---|
| 17 rotas do console e da loja | **ausente** |
| `/loja/produto/pr_12368` | **ausente** |
| `/loja/produto/pr_59624` | **ausente** |

O leitor de tela **nunca** anuncia "NANOFLOW" numa tela de produto. O erro anterior não
voltou.

### R11 — `document.title` é o mesmo em todas as 17 rotas · GRAVE
Medido: `"Nova Ótica — Gestão de Estoque"` em `/admin`, `/admin/bi`, `/admin/estoque`,
`/admin/usuarios`, `/loja`, `/loja/carrinho` e `/loja/produto/pr_12368`. Numa SPA, o título
é o principal sinal de "mudei de tela" para o leitor de tela. O usuário navega 20 telas e
ouve sempre a mesma frase. Falha 2.4.2 (Page Titled).
Agrava na vitrine: a página pública de produto se anuncia como **"Gestão de Estoque"**, o
nome do sistema interno, para o cliente final.

### R12 — Salto de heading h1→h3 em 6 rotas · MÉDIO
Nenhuma rota do produto usa `<h2>`. Medido:

| Rota | Sequência | Salto |
|---|---|---|
| /admin | h1 h3 h3 | h1→h3 em "Cobertura de estoque por loja" |
| /admin/bi | h1 + 11×h3 | h1→h3 em "Taxa de ruptura" |
| /admin/alertas | h1 h3 | h1→h3 em "Transferências sugeridas…" |
| /admin/decisoes | h1 + **331×h3** | h1→h3 em "Reduzir excesso e liberar capital" |
| /admin/historico | h1 h3 h3 | h1→h3 em "Aprovações e recusas…" |
| /admin/vendas | h1 h3 | h1→h3 em "Venda por…" |

Quem navega por headings (tecla `H`) perde o nível intermediário: as seções da tela
aparecem todas como sub-sub-títulos de nada.

### R13 — 2176 botões com o nome `"Salvar"` em `/admin/alertas` · GRAVE
O `<input>` de cada linha tem rótulo bom (`"Estoque mínimo de VO5709 3293 57 ARMACAO VOGU…"`),
mas o botão ao lado é só `"Salvar"`. O leitor de tela lista **2176 botões idênticos**. Fora
do contexto da linha (navegação por botões, lista de elementos) não há como saber o que se
está salvando.

### R14 — Nomes de botão repetidos sem contexto em outras 3 rotas · GRAVE
Medido (nomes acessíveis com mais de 3 ocorrências visíveis):

| Rota | Nomes repetidos |
|---|---|
| /admin/decisoes | `"Recusar"` ×382 · `"Aprovar transferência"` ×282 · `"Aprovar"` ×100 · `"Abrir em Compras"` ×100 · `"Criar transferência"` ×62 |
| /admin/transferencias | `"Criar movimentação"` ×30 |
| /loja | `"Provar"` ×24 · `"Adicionar"` ×24 |

Em `/loja`, `"Adicionar, botão"` ×24 não diz qual armação vai para o carrinho — a compra
por teclado depende de contar posições.

### R15 — 5 `<select>` sem rótulo acessível · MÉDIO
Confirmado no DOM e na árvore de acessibilidade (`combobox` com `name: ""`):

| Rota | Quantos | Quais |
|---|---|---|
| /admin/bi | 2 | período ("Últimos 7 dias"), loja ("Toda a rede") |
| /admin/transferencias | 1 | status ("Todos os status") |
| /admin/usuarios | 2 | papel ("Rede (ADMIN)") |

Sem `<label>`, `aria-label` nem `title`. O leitor de tela anuncia só o valor corrente.
Falha 4.1.2 e 3.3.2.

### R16 — Todas as regiões estão sem rótulo · MÉDIO
Medido em 17/17 rotas: `aside`, `section`, `main`, `header` — **nenhum** com `aria-label`
ou `aria-labelledby`. A lista de landmarks do leitor de tela mostra regiões anônimas.
Em `/loja/carrinho` há **dois `header`** (dois landmarks `banner`), ambos sem rótulo.

### R17 — A navegação principal do console não é um landmark de navegação · MÉDIO
A barra lateral é `<aside>` (landmark `complementary`), sem `role="navigation"`, sem
`<nav>` interno e sem rótulo, contendo **15 links** — que são a navegação principal do
produto. Medido: `{tag: 'ASIDE', role: null, label: null, nLinks: 15, temNav: false}`.
Quem usa a tecla de landmark para achar o menu não acha o menu.

### R18 — Nenhuma tabela tem nome · MÉDIO
Medido em ~20 tabelas de 12 rotas: **0** com `<caption>`, **0** com `aria-label`.
`/admin/planejamento` tem **8 tabelas sem nome na mesma tela** (20, 30, 4, 1, 501, 16, 3 e
8 linhas). Na lista de tabelas do leitor de tela são oito entradas indistinguíveis.

### R19 — Nenhum `<th>` declara `scope` · MENOR
Medido: `th[scope]` = 0 em todas as tabelas. Os `<th>` estão dentro de `<thead>`, o que dá
escopo de coluna implícito e funciona na maioria dos leitores — mas em tabelas de 2176
linhas (`/admin/alertas`) e 501 linhas (`/admin/produtos`, `/admin/planejamento`) o escopo
explícito é o que garante a associação.

### R20 — 333 ícones decorativos anunciados em `/admin/planejamento` · MÉDIO
333 `<svg role="img" aria-label="Previsão por tendência">` dentro de células `<td class="num">`.
A própria célula ainda carrega
`title="Previsão tendencia — base 0.01/dia × índice sazonal 1 (mês 7)"`.
Cada célula numérica da tabela é lida como: **o número + "Previsão por tendência, imagem" +
o texto do `title`** — três anúncios por célula, 333 vezes. O ícone é reforço visual do
número que já está escrito ao lado; deveria ser `aria-hidden`.

### R21 — `/admin/lojas` não tem um único controle focável no conteúdo · MENOR
Medido: 0 focáveis no `<main>`, 20 linhas de tabela, 1 card. Toda a rota é leitura. Não é
defeito de teclado em si (não há ação escondida no mouse — medido: 0 elementos com
`cursor:pointer` e handler de clique fora da ordem de foco), mas as 20 paradas da casca
levam a uma tela onde o Tab não tem para onde ir.

### R22 — O halo de foco dos campos mede 1,15:1 · MENOR
Ver seção 1. `box-shadow: 0 0 0 3px rgba(201,162,39,.34)` compõe para `rgb(231,215,167)`
sobre `#f6f2e9`. O indicador efetivo é a borda de 1px.

### R23 — Sem `aria-live` em nenhuma rota · MÉDIO
Medido: 0 elementos `aria-live`/`role=status`/`role=alert` renderizados em `/admin`.
`components/ui.tsx` define `role="status"` e `role="alert"` (linhas 108–134) mas nenhum
deles estava montado em nenhuma das telas medidas. Toda mudança assíncrona — filtro
aplicado, tabela recarregada, tema trocado, salvamento concluído — acontece em silêncio.

---

## Não é defeito (falsos positivos verificados e descartados)

Registrados porque uma leitura apressada os transformaria em bug.

1. **`input[type=date]` em `/admin/vendas` parecia armadilha de foco.** A detecção de ciclo
   acusou `venda-de → venda-de`. Medido: o Chromium consome 3–4 Tabs por campo de data
   (segmentos dia/mês/ano) e `document.activeElement` não muda. Ao 4º Tab o foco sai para
   `venda-ate`, e ao 8º para os botões seguintes. **Comportamento nativo, não é armadilha.**

2. **Campos pareciam sem anel de foco (`outline: 0`, `box-shadow` transparente).** Medido
   cedo demais: há `transition: border-color .12s, box-shadow .12s`. Relendo após 500ms o
   valor correto aparece. **O anel existe.**

3. **"Ordem de Tab não segue a ordem visual em 33/33 paradas."** Artefato do meu próprio
   critério: ordenar por linha (y, depois x) trata um layout de **coluna lateral** como se
   fosse leitura em linhas, e declara a barra lateral inteira fora de ordem. A ordem real é
   coluna esquerda → barra de topo → conteúdo → dock, que é ordem de DOM e é defensável.
   Sobra apenas R3 (o salto de 800px).

4. **`div[role=button]` em `/admin/planejamento` (3 ocorrências).** Testado: `Enter` e
   `Espaço` alternam `aria-expanded` exatamente como o clique de mouse, e há `onKeyDown`.
   **Passa.**

5. **`/admin/alertas` e `/admin/decisoes` "sem ciclo de foco em 400 Tabs".** Não é
   armadilha: são 4385 e 963 focáveis reais. O ciclo existe, é só longo (R1).

---

## Resumo por critério pedido

| # | Item | Veredito |
|---|---|---|
| 1 | Ordem de foco / armadilha / elemento pulado / foco invisível | Ordem consistente, sem `tabindex` positivo, sem armadilha, sem elemento pulado, sem foco invisível. **Reprova em R1, R2, R3.** |
| 2 | Dock recolhido alcança e expande no foco | **APROVADO** (23→58px, `pointer-events` restaurado, Enter navega) |
| 3 | MultiSelect: abre, setas, Espaço, Esc, foco volta | **APROVADO** (R4 é ressalva menor) |
| 4 | Modais: foco entra, fica preso, volta ao gatilho no Esc | **REPROVADO EM TUDO** (R5–R8) |
| 5 | Alternador de tema: nome e estado | Nome **sim**; estado **não** (R9, R10) |
| 6 | Árvore de acessibilidade | Sem botão sem nome, sem imagem sem alt. **Reprova em R11–R20, R23.** |
| 7 | "NANOFLOW" em tela de produto | **APROVADO — ausente em 19/19 telas medidas** |
