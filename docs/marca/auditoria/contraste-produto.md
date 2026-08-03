# Auditoria de contraste e daltonismo no produto renderizado

**Nova Ótica — console de estoque da rede A GRACIOSA · design system NANOFLOW**

| | |
|---|---|
| Data da medição | 2026-07-31, 17:40–17:55 UTC |
| Commit medido | `7d1dabc` |
| Build | `VITE_DEMO=1 VITE_HASH_ROUTER=1 VITE_BASE=./` — `apps/web/dist` servido em `http://127.0.0.1:8199/` |
| Motor | Chromium 1194 (`/opt/pw-browsers/chromium-1194`), viewport 1440×1000, DPR 1 |
| Sessão | `galbe@novaotica.com` (Galbe · Gestor da rede) |
| Rotas | 17 (`/#/admin` + 14 subrotas, `/#/loja`, `/#/loja/carrinho`) |
| Temas | claro (padrão) e escuro (`localStorage['novaotica.tema']='escuro'`) |
| Escopo | Contraste WCAG 2.x (1.4.3 / 1.4.6 / 1.4.11), grayscale, protanopia e deuteranopia (Machado 2009) |
| Autoria da medição | agente de auditoria — **nenhum arquivo de código foi editado** |

> **ESTA MEDIÇÃO VALE PARA O ESTADO QUE FOI MEDIDO.**
> No momento em que estes números foram colhidos havia outros seis agentes alterando
> tipografia e hierarquia no mesmo repositório. Qualquer commit posterior a `7d1dabc`
> pode mover cores, tamanhos e pesos e, com eles, todos os números abaixo.
> **O corretor final precisa revalidar.** Os scripts usados estão descritos na
> seção "Método reproduzível" para que a revalidação seja idêntica, não parecida.

---

## 1. Sumário executivo

Em **112.708 elementos com texto** medidos (17 rotas × 2 temas, cada elemento com sua cor
computada contra a pilha real de fundos, compondo alfa a cada camada até um fundo opaco):

| Métrica | Resultado |
|---|---|
| Reprovações WCAG AA (1.4.3) | **1** em 112.708 (0,0009%) |
| Reprovações WCAG AAA (1.4.6) | 24.536 (21,8%) — informativo, AAA não é o alvo contratado |
| Quase-reprovações AA únicas (aprovadas com folga < 0,5) | 4 combinações cor/fundo |
| Anel de foco (1.4.11) — combinações medidas | 42 |
| Anel de foco reprovando | **1** componente (`button.mselect-btn`, nos dois temas) |
| Pares de estado testados em grayscale / protanopia / deuteranopia | 38 |
| Pares de estado que dependem SÓ de matiz | **0** — todos têm canal redundante textual |

**Veredito.** O produto está essencialmente conforme em contraste de texto. As duas
falhas reais são pontuais e cirúrgicas: um badge verde a 4,47:1 (falta 0,03) e um botão
de multisseleção sem nenhum indicador de foco visível. O sistema de estados **não** falha
em daltonismo, mas não porque a paleta seja segura — e sim porque **todo estado no produto
carrega texto**. Essa é a rede de proteção, e ela precisa ser tratada como regra, não como
coincidência: as diferenças de matiz sozinhas, uma vez em grayscale, chegam a colapsar
para contraste 1,00:1 (seção 5).

**Nota sobre a dosagem de mono** (não é o meu escopo, mas foi medido no caminho e o número
manda): no Dashboard deste build medi **20 de 207 elementos com texto em JetBrains Mono
(9,7%, ~191 caracteres)**, não os 78 de 149 (52%, 659 caracteres) do diagnóstico anterior.
Duas leituras possíveis, e não posso decidir entre elas sem instrumentar as duas
metodologias: (a) as ondas em curso já reduziram a dose; (b) meu conjunto de elementos
(todo nó com filho de texto direto) é mais largo que o do diagnóstico anterior, o que dilui
o percentual. **O número absoluto de caracteres em mono — 191 contra 659 — é o menos
sensível à metodologia e indica redução real.** Registro e sigo; quem mede tipografia
fecha essa conta.

---

## 2. Método (normativo, e por que cada escolha)

### 2.1 Pilha de fundos
Para cada elemento com nó de texto direto, subo a árvore de ancestrais acumulando
`background-color`. Cada camada com `alpha < 1` é empilhada; a subida só para no primeiro
fundo **opaco** (alpha ≥ 0,999). As camadas são então compostas de trás para frente
(`over`) sobre esse fundo opaco, ou sobre o `background-color` do `<html>` se nenhum
ancestral for opaco. O resultado é a cor de fundo **efetiva** — não a do elemento, não a do
pai, a que o olho realmente vê. Isso importa muito aqui: o console empilha
`--vidro` translúcido sobre cartão sobre desktop, e medir só o pai imediato dá números
otimistas por 10–15%.

A cor do texto (`color`) com alpha < 1 é composta sobre essa mesma pilha antes do cálculo.

### 2.2 Luminância e razão
`L = 0,2126·R + 0,7152·G + 0,0722·B` com linearização sRGB
(`v ≤ 0,03928 ? v/12,92 : ((v+0,055)/1,055)^2,4`), razão `(L_claro+0,05)/(L_escuro+0,05)`.

### 2.3 Classificação por tamanho — definição normativa, sem arredondar a favor
Texto grande = **`font-size ≥ 24px`** OU **`font-size ≥ 18,66px` E `font-weight ≥ 700`**.
`bold` é normalizado para 700, `normal` para 400. Texto grande exige 3:1; o resto exige
4,5:1. Nenhum item foi promovido a "grande" por estar perto: 18,4px em 700 é texto normal
e foi cobrado a 4,5:1.

### 2.4 O que ficou de fora
Elementos com `display:none`, `visibility:hidden`, `opacity < 0,05` ou caixa menor que
1×1px. Elementos cujo fundo efetivo é uma **imagem/gradiente** e não uma cor sólida são
marcados e medidos contra a camada sólida mais próxima — no build medido isso ocorre
apenas em decorações sem texto, então não contamina a contagem.

---

## 3. Contraste de texto — resultado por rota

Contagem de elementos com texto direto e reprovações AA, tema claro / tema escuro
(os dois temas renderizam o mesmo DOM, daí a contagem idêntica):

| Rota | Elementos com texto | Reprov. AA (claro) | Reprov. AA (escuro) |
|---|---:|---:|---:|
| `/#/admin` (Dashboard) | 207 | 0 | 0 |
| `/#/admin/bi` | 92 | 0 | 0 |
| `/#/admin/estoque` | 2.252 | 0 | 0 |
| `/#/admin/produtos` | 2.243 | 0 | 0 |
| `/#/admin/transferencias` | 279 | 0 | 0 |
| `/#/admin/alertas` | 12.687 | 0 | 0 |
| `/#/admin/relatorios` | 770 | 0 | 0 |
| `/#/admin/decisoes` | 30.081 | 0 | 0 |
| `/#/admin/historico` | 60 | 0 | 0 |
| `/#/admin/estrategia` | 77 | **1** | 0 |
| `/#/admin/planejamento` | 6.885 | 0 | 0 |
| `/#/admin/vendas` | 264 | 0 | 0 |
| `/#/admin/usuarios` | 64 | 0 | 0 |
| `/#/admin/lojas` | 140 | 0 | 0 |
| `/#/admin/sincronizacao` | 56 | 0 | 0 |
| `/#/loja` | 185 | 0 | 0 |
| `/#/loja/carrinho` | 12 | 0 | 0 |
| **Total** | **56.354 × 2 = 112.708** | **1** | **0** |

As contagens altas em `alertas`, `decisoes`, `planejamento`, `estoque` e `produtos` refletem
tabelas e listas longas renderizadas por inteiro (sem virtualização de corte no DOM); são
repetições da mesma combinação cor/fundo, não 30 mil combinações distintas.

### 3.1 A reprovação (lista completa — é uma só)

| # | Rota | Tema | Seletor | Texto | Tam./peso | Fonte | Cor | Fundo efetivo | Razão | Exigido | Falta |
|---|---|---|---|---|---|---|---|---|---:|---:|---:|
| 1 | `/#/admin/estrategia` | claro | `span.badge.green > span` | "Viável" | 11,5px / 500 | Inter | `rgb(72,100,65)` | `rgb(211,214,200)` | **4,47:1** | 4,5:1 | 0,03 |

**Diagnóstico.** A cor do texto (`--verde-texto`, `#486441`) e o preenchimento do badge
verde estão calibrados e passam com folga sobre o papel do console (`rgb(225,225,213)` →
5,02:1). Nesta tela o badge está **dentro de um banner `banner ok`**, que empilha mais uma
camada esverdeada translúcida por baixo. O fundo efetivo escurece de `rgb(225,225,213)`
para `rgb(211,214,200)` e come exatamente os 0,55 de folga que existiam. **Não é a cor do
badge que está errada — é o badge colorido dentro do banner colorido.** É por isso que a
medição tinha de compor a pilha: quem medisse o badge contra o papel diria 5,02:1 e
fecharia o caso com um falso "passa".

Correção mínima (para quem edita, não fui eu): o `.badge.green` dentro de `.banner`
precisa de fundo próprio opaco, ou `--verde-texto` precisa descer ~4% de luminância só
nesse contexto. Uma linha, escopo `.banner .badge`.

### 3.2 Quase-reprovações — passam, mas sem margem para nenhuma mudança de tipografia

Estas quatro combinações estão **aprovadas** e devem ser vigiadas: qualquer alteração de
peso, tamanho ou tom de fundo nas ondas em curso as derruba.

| Rota | Tema | Seletor | Texto | Tam./peso | Cor | Fundo | Razão | Folga |
|---|---|---|---|---|---|---|---:|---:|
| `/#/admin/lojas` | claro | `span.badge.green > span` | "Ativa" | 11,5px / 500 | `rgb(72,100,65)` | `rgb(222,219,199)` | 4,76:1 | +0,26 |
| `/#/admin/estoque` (e +5 rotas, 568 ocorrências) | escuro | `span.badge.green > span` | "Em estoque" | 11,5px / 500 | `rgb(125,159,98)` | `rgb(39,42,28)` | 4,89:1 | +0,39 |
| `/#/admin/relatorios` | escuro | `td > span.badge.green` | "A" (classe ABC) | 11,5px / 500 | `rgb(125,159,98)` | `rgb(39,42,28)` | 4,89:1 | +0,39 |
| `/#/admin/estoque` (e +4 rotas, 566 ocorrências) | claro | `span.badge.green > span` | "Em estoque" | 11,5px / 500 | `rgb(72,100,65)` | `rgb(225,225,213)` | 5,02:1 | +0,52 |

**O padrão é inequívoco: o badge verde é o elemento mais frágil do sistema, nos dois temas.**
Todas as quatro quase-reprovações e a única reprovação são o mesmo componente. Se houver
uma única mudança de cor a fazer nesta onda por causa de contraste, é essa.

### 3.3 Contexto — os elementos mais apertados que ainda passam com folga confortável

Para calibrar o resto do sistema (nada aqui é ação, é referência):

| Tema | Seletor | Texto | Tam./peso | Fonte | Razão | Ocorrências |
|---|---|---|---|---|---:|---:|
| claro | `div > a` | "Ver alertas →" | 13,5px / 400 | Inter | 5,26:1 | 2 |
| claro | `div.value > span.unidade` | "meses" | 13,6px / 500 | JetBrains Mono | 5,51:1 | 5.163 |
| claro | `td > button.btn.sm` | "Transferir" | 12,5px / 500 | Inter | 5,70:1 | 1 |
| claro | `a.skip-link` | "Ir para o conteúdo" | 14px / 400 | Inter | 6,04:1 | 17 rotas |
| claro | `span.badge.amber > span` | "9,4 meses · Alta" | 11,5px / 500 | Inter | 6,12:1 | 2.018 |
| claro | `td > div.muted` | "· ARMACAO" | 12px / 400 | Inter | 6,36:1 | 6 |
| claro | `div.card > div.label` | "Gestor da rede" | 10px / 500 | JetBrains Mono | 6,73:1 | 9.489 |
| escuro | `div.value > span.unidade` | "meses" | 13,6px / 500 | JetBrains Mono | 6,96:1 | 5.163 |

Observação que interessa à onda de tipografia: **o rótulo de 10px em JetBrains Mono
(`div.card > div.label`, 9.489 ocorrências em 17 rotas) passa AA com folga — 6,73:1.**
Se ele for julgado ilegível, e é razoável que seja, o problema dele **não é contraste, é
tamanho e entreletras**. Trocar a cor não resolve nada; aumentar o corpo resolve. Quem
argumentar "aumentamos o contraste do rótulo mono" está tratando o sintoma errado.

---

## 4. Anel de foco (WCAG 2.4.11 / 1.4.11 — ≥ 3:1)

Percorri 30 paradas de `Tab` reais por rota e por tema (foco por teclado, para que
`:focus-visible` dispare de verdade — `element.focus()` programático **não** dispara a
heurística do Chromium e produz falsos "sem anel"; a primeira passada com `.focus()`
reportou 388 falsos negativos, descartados).

**O anel padrão do sistema:** `outline: 2px solid` com `outline-offset: 2px`.
Como o offset é positivo, o anel é separado do preenchimento do próprio controle por 2px
de fundo da página — logo **a cor adjacente normativa é o fundo da página**, não o
preenchimento do botão. Medi as duas e reporto as duas, mas a conformidade se decide pela
primeira.

| Tema | Cor do anel | vs. fundo da página (normativo) | vs. preenchimento do controle (informativo) | Veredito |
|---|---|---:|---:|---|
| claro | `rgb(116,87,15)` (`--ouro-texto`) | **6,04:1** | 2,28–6,04 | ✅ passa |
| escuro | `rgb(201,162,39)` (`--ouro`) | **8,12:1** | 1,00–6,92 | ✅ passa |

36 das 42 combinações controle×tema medidas ficam em 6,04:1 (claro) e 8,12:1 (escuro).
Os valores baixos da coluna informativa (1,00 em `button.btn.solid` no escuro) são o anel
dourado sobre o **preenchimento dourado do botão sólido** — irrelevante, porque os 2px de
offset garantem que o anel nunca encosta nesse preenchimento; ele é desenhado sobre o
fundo da página. Registro para que ninguém "corrija" um problema que não existe.

### 4.1 A reprovação de foco

| Rota | Tema | Componente | Estado medido | Problema |
|---|---|---|---|---|
| `/#/admin/estoque` | **claro e escuro** | `button.mselect-btn` (botão do MultiSelect / filtro de lojas) | `document.activeElement === el`, `el.matches(':focus-visible') === true` | `outline-width: 0px`, `outline-style: none`, `box-shadow: rgba(0,0,0,0) 0 0 0 0` — **nenhum indicador visível de foco**. Contraste efetivo do indicador: **0** (não há indicador). |

Confirmado por medição direta com foco de teclado nos dois temas. A borda do controle
(`1px solid rgba(13,11,8,0.46)`) é idêntica no estado focado e no não-focado, então não
serve como indicador. O comentário em `apps/web/src/components/MultiSelect.tsx:25`
descreve um anel de 2px em `--ouro-dark`; **esse anel não está sendo aplicado ao botão no
build medido** — ou o seletor não alcança `.mselect-btn`, ou foi sobrescrito por um
`outline: none` de reset. É a única violação de 2.4.11 no produto, e é bloqueante para
operação por teclado: quem filtra as 19 lojas por `Tab` perde a posição do cursor.

### 4.2 Falso positivo descartado (registrado para não voltar)
`input[type=date]` em `/#/admin/vendas` apareceu duas vezes como "sem anel" na varredura
por `Tab`. Reteste direto nos dois temas: **anel presente e correto** — claro
`2px solid rgb(116,87,15)`, escuro `2px solid rgb(201,162,39)`. A leitura anterior pegou o
elemento no meio da transição de `box-shadow` (largura medida de 0,489px). **Não é defeito.**

---

## 5. Grayscale — a prova de que nenhum estado depende só de matiz

Apliquei `filter: grayscale(1)` na raiz do documento e capturei as telas de estado
(evidência em `evidencia-contraste/*-cinza.png`). Em paralelo, calculei o valor de cinza
resultante de cada cor de estado pela matriz de luminância do CSS Filter Effects
(`0,2126·R + 0,7152·G + 0,0722·B` sobre os valores sRGB) e o contraste WCAG entre os pares.

### 5.1 O número desconfortável primeiro

| Tema | Par de estados | Canal | Cor A → cinza | Cor B → cinza | Δcinza | Contraste em cinza |
|---|---|---|---|---|---:|---:|
| claro | ruptura × baixo | **preenchimento do badge** | `rgb(231,218,209)` → 220 | `rgb(229,219,204)` → 220 | **0** | **1,00:1** |
| escuro | ruptura × baixo | preenchimento do badge | `rgb(54,44,37)` → 46 | `rgb(58,46,19)` → 47 | 1 | 1,01:1 |
| claro | ruptura × baixo | borda do badge | `rgb(189,152,141)` → 159 | `rgb(186,163,133)` → 166 | 7 | 1,09:1 |
| escuro | ruptura × baixo | borda do badge | `rgb(117,91,80)` → 96 | `rgb(121,92,27)` → 93 | 3 | 1,05:1 |
| claro | saudável × neutro | texto do badge | `rgb(72,100,65)` → 92 | `rgb(92,84,62)` → 84 | 8 | 1,13:1 |

**Em preto e branco, o preenchimento do badge de ruptura e o do badge de estoque baixo são
literalmente o mesmo cinza (220 e 220, 1,00:1).** Um gestor com acromatopsia, uma tela em
modo economia, uma impressão em laser preto — nesses três casos a *cor* do badge não
transmite absolutamente nada. Mesma coisa, em grau menor, para todas as bordas e
preenchimentos.

### 5.2 Por que ainda assim o produto passa: o canal redundante é **texto literal**

Todos os badges do console carregam a palavra do estado dentro deles, sempre, medido no
DOM em todas as 17 rotas:

| Família de estado | Canal redundante verificado | Evidência |
|---|---|---|
| Estoque: ruptura / baixo / saudável / excesso | **Texto dentro do badge**: "Em falta", "Em estoque", "Saudável", "Excesso", "Parado" | `span.badge.red > span` = "Em falta"; `span.badge.green > span` = "Em estoque" |
| Cobertura por loja (pontos coloridos) | **Rótulo textual adjacente, sempre** — o ponto nunca aparece sozinho | `/#/admin/planejamento`: `dot green` ao lado de "Saudável R$ 512.480,00"; `dot amber` ao lado de "Excesso R$ 128.940,00"; `dot red` ao lado de "Parado R$ 233.170,00" |
| Transferência: aprovado / recusado / solicitada | **Texto do badge** ("Solicitada", etc.) + posição na coluna de status | `span.badge.blue > span` = "Solicitada" |
| Prioridade: alta / média / baixa | **Texto do badge** | `/#/admin/decisoes`: `span.badge.gray > span` = "Baixa"; `span.badge.amber` = "9,4 meses · Alta" |
| Viabilidade: viável / inviável | **Texto do badge** | `/#/admin/estrategia`: `span.badge.green > span` = "Viável" |
| Sincronização: janela aberta / fechada | **Texto adjacente** | `/#/admin/sincronizacao`: `dot green` ao lado de "Aberta agora" |
| Alertas do Dashboard | **Frase completa**, não código de cor | "288 item(ns) em falta e 1809 item(ns) com estoque baixo" |

Também verifiquei o que **não** é canal redundante, para que ninguém conte com isso:
- **Forma não distingue estado.** Todos os pontos têm `border-radius: 0px` (quadrados) e
  todos os badges usam o mesmo raio. A forma é constante entre estados.
- **Tamanho não distingue estado.** Os pontos variam 8px/11px por *contexto* (banner vs.
  legenda), não por estado — `dot green` aparece em 11px e em 8px na mesma tela.
- **Nenhum ponto tem `aria-label` ou `title`.** Se um `dot` algum dia for renderizado sem o
  texto ao lado, ele fica mudo para leitor de tela *e* para daltônico ao mesmo tempo.

**Conclusão da seção.** O produto passa o teste do grayscale, e passa **inteiramente pelo
texto**. Isso é uma conformidade real, mas frágil por construção: ela sobrevive enquanto
ninguém "limpar" um badge para virar só um ponto colorido, e enquanto nenhuma tabela
compactar a coluna de status para caber. A onda de hierarquia que está rodando agora é
exatamente o tipo de mudança que faria isso sem perceber. **Recomendação para o corretor
final: tratar "todo estado tem palavra" como invariante do design system, escrito, e não
como propriedade emergente.**

---

## 6. Protanopia e deuteranopia (Machado 2009, severidade 1,0)

Matrizes de Machado, Oliveira & Fernandes (2009) aplicadas em **RGB linear** (é aí que elas
são definidas; aplicá-las em sRGB, como fazem várias ferramentas, exagera a separação e
produz um resultado falsamente tranquilizador). ΔE é CIE76 em L\*a\*b\* D65.

Referência de leitura: **ΔE < 5 = indistinguível na prática · 5–15 = distinção duvidosa a
distância de trabalho · > 20 = confortavelmente distinto.**

### 6.1 Tema claro

| Par de estados | Canal | ΔE normal | ΔE protanopia | ΔE deuteranopia | Leitura |
|---|---|---:|---:|---:|---|
| ruptura × saudável | texto do badge | 56,8 | 21,2 | 20,5 | ✅ distinto |
| aprovado × recusado | texto do badge | 56,8 | 21,2 | 20,5 | ✅ distinto |
| baixo × saudável | texto do badge | 40,7 | 22,2 | 24,4 | ✅ distinto |
| alta × baixa | texto do badge | 40,8 | 18,5 | 20,4 | ✅ distinto |
| ruptura × neutro | texto do badge | 40,8 | 18,5 | 20,4 | ✅ distinto |
| média × baixa | texto do badge | 29,9 | 25,7 | 25,6 | ✅ distinto |
| baixo × neutro | texto do badge | 29,9 | 25,7 | 25,6 | ✅ distinto |
| **ruptura × baixo** | **texto do badge** | 23,7 | 19,9 | **10,7** | ⚠️ duvidoso em deuteranopia |
| ruptura × saudável | borda do badge | 20,3 | 8,7 | 6,9 | ⚠️ duvidoso |
| **saudável × neutro** | **texto do badge** | 17,8 | **6,9** | **3,3** | ❌ indistinguível em deuteranopia |
| baixo × saudável | borda do badge | 15,0 | 10,0 | 11,2 | ⚠️ duvidoso |
| ruptura × baixo | borda do badge | 11,6 | 9,4 | 7,3 | ⚠️ duvidoso |
| ruptura × saudável | preenchimento | 5,2 | 1,8 | **1,2** | ❌ indistinguível |
| baixo × saudável | preenchimento | 4,3 | 2,8 | 3,3 | ❌ indistinguível |
| ruptura × baixo | preenchimento | 3,3 | 2,6 | 2,6 | ❌ indistinguível |

### 6.2 Tema escuro

| Par de estados | Canal | ΔE normal | ΔE protanopia | ΔE deuteranopia | Leitura |
|---|---|---:|---:|---:|---|
| baixo × neutro | texto do badge | 65,1 | 67,6 | 63,2 | ✅ distinto |
| média × baixa | texto do badge | 65,1 | 67,6 | 63,2 | ✅ distinto |
| baixo × saudável | texto do badge | 57,4 | 45,3 | 48,0 | ✅ distinto |
| ruptura × baixo | texto do badge | 54,6 | 60,8 | 51,0 | ✅ distinto |
| alta × média | texto do badge | 54,6 | 60,8 | 51,0 | ✅ distinto |
| ruptura × saudável | texto do badge | 45,9 | 23,7 | 22,7 | ✅ distinto |
| aprovado × recusado | texto do badge | 45,9 | 23,7 | 22,7 | ✅ distinto |
| baixo × saudável | borda do badge | 30,7 | 25,9 | 26,8 | ✅ distinto |
| saudável × neutro | texto do badge | 30,6 | 23,9 | 18,7 | ✅ distinto |
| ruptura × baixo | borda do badge | 29,7 | 32,8 | 27,7 | ✅ distinto |
| **alta × baixa / ruptura × neutro** | **texto do badge** | 24,2 | **13,8** | 19,0 | ⚠️ duvidoso em protanopia |
| ruptura × saudável | borda do badge | 22,1 | 11,3 | 11,0 | ⚠️ duvidoso |
| ruptura × baixo | preenchimento | 13,1 | 14,5 | 12,6 | ⚠️ duvidoso |
| baixo × saudável | preenchimento | 12,5 | 11,1 | 11,5 | ⚠️ duvidoso |
| ruptura × saudável | preenchimento | 8,4 | **4,4** | **3,2** | ❌ indistinguível |

### 6.3 Leitura dos dois temas juntos

1. **O tema escuro é sensivelmente mais seguro para daltônicos que o claro.** O âmbar do
   escuro (`rgb(240,180,41)`) é muito mais saturado e claro que o do claro
   (`rgb(113,67,10)`), e isso preserva separação de luminância — o canal que protanopia e
   deuteranopia *não* destroem. No claro, verde e âmbar e o cinza neutro caem quase no
   mesmo ponto do espaço de cor deficiente.
2. **O pior par do produto inteiro é `saudável × neutro/excesso` no tema claro**:
   ΔE 3,3 em deuteranopia. Verde `rgb(72,100,65)` e cinza-oliva `rgb(92,84,62)` viram
   praticamente a mesma cor. Como esses dois estados também colapsam no grayscale
   (Δcinza 8, contraste 1,13:1), **este par não tem nenhum canal cromático de reserva** —
   só o texto o separa.
3. **Preenchimentos e bordas de badge não são sinal em nenhum cenário deficiente**, nos dois
   temas. Devem ser tratados como decoração, nunca como portadores de informação.
4. **Nenhum desses achados é uma reprovação de WCAG**, porque 1.4.1 exige apenas que a cor
   não seja o *único* meio — e não é. São achados de robustez operacional: eles dizem
   exatamente quanto o produto ficaria degradado se alguém removesse o rótulo textual.

Evidência visual em `evidencia-contraste/` — 32 capturas: `{claro,escuro}` ×
`{admin, admin-planejamento, admin-estoque, admin-decisoes}` ×
`{normal, cinza, protanopia, deuteranopia}`.

---

## 7. As dez piores, em ordem de quanto custam ao Galbe

1. **`button.mselect-btn` sem anel de foco algum, nos dois temas** (`/#/admin/estoque`) —
   violação direta de WCAG 2.4.11. Operação por teclado no filtro de lojas fica cega.
2. **Badge "Viável" a 4,47:1** (`/#/admin/estrategia`, claro) — única reprovação AA de
   texto; causada por badge colorido dentro de banner colorido, não pela cor do badge.
3. **`saudável × neutro/excesso` no tema claro**: ΔE 3,3 em deuteranopia **e** 1,13:1 em
   grayscale — o único par do produto sem nenhuma reserva cromática.
4. **Preenchimento de badge ruptura vs. baixo idêntico em grayscale (1,00:1)** — a cor de
   fundo do badge é decoração pura; qualquer design que dependa dela quebra.
5. **Badge verde é o componente mais frágil do sistema**: concentra a única reprovação e
   todas as 4 quase-reprovações, nos dois temas, com folga entre +0,26 e +0,52.
6. **"Em estoque" no tema escuro a 4,89:1 em 568 ocorrências, 6 rotas** — passa por 0,39;
   qualquer clareamento de fundo de linha na onda de hierarquia o derruba em massa.
7. **`ruptura × baixo` (vermelho vs. âmbar) no claro: ΔE 10,7 em deuteranopia** — os dois
   estados mais críticos da operação são os mais parecidos para o tipo de daltonismo mais
   comum.
8. **`alta × baixa` no escuro: ΔE 13,8 em protanopia** — prioridade de decisão fica
   ambígua na tela onde o gestor decide o que comprar.
9. **Rótulo de 10px em JetBrains Mono (9.489 ocorrências, 17 rotas) passa a 6,73:1** — o
   problema dele é corpo e entreletras, não contraste; risco de a onda em curso "consertar"
   a cor e não resolver nada.
10. **Nenhum `dot` tem `aria-label` ou `title`** — os pontos coloridos dependem 100% do
    texto vizinho; se algum layout responsivo esconder esse texto, o estado fica mudo para
    daltônico e para leitor de tela ao mesmo tempo.

---

## 8. Método reproduzível

Scripts usados (em
`/tmp/claude-0/-home-user-nova-otica/35e8efec-6f37-56a9-9b8c-ee00e6ad82ab/scratchpad/`):

| Arquivo | O que faz | Saída |
|---|---|---|
| `audit.mjs` | Varredura de contraste + coleta de cores de estado, 17 rotas × 2 temas | `dados.json` |
| `focus.mjs` | 30 paradas de `Tab` por rota/tema, medindo o anel real | `focos.json` |
| `cores.mjs` | Grayscale CSS + Machado 2009 em RGB linear + ΔE CIE76 | `pares.json` |
| `shots.mjs` | 32 capturas normal/cinza/protanopia/deuteranopia | `evidencia-contraste/` |

Pré-requisitos: `dist` construído com as variáveis do briefing e servido em
`http://127.0.0.1:8199/`; Chromium em
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; playwright-core em
`/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.mjs`.

Armadilhas que custaram tempo e que a revalidação deve evitar:
- As rotas são **`/#/admin/estoque`**, não `/#/estoque`. `#/estoque` cai no Launcher e
  produz 9 elementos por tela e zero reprovações — um "tudo certo" completamente falso.
- `element.focus()` **não** ativa `:focus-visible` no Chromium. Só `Tab` real ativa. Medir
  foco programaticamente reporta ~388 falsos "sem anel".
- O tema é `localStorage['novaotica.tema'] = 'escuro'` **antes de um reload**; setar depois
  do mount não repinta os tokens.
- `outline-offset: 2px` significa que a cor adjacente ao anel é o **fundo da página**, não
  o preenchimento do controle. Medir contra o preenchimento gera falhas fantasma de 1,00:1
  em todos os botões sólidos do tema escuro.
