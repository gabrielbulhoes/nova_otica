# Onda 6 · Dosagem tipográfica e hierarquia no BI, na vitrine e dentro dos gráficos

Escopo desta auditoria: `apps/web/src/pages/BI.tsx`, `apps/web/src/pages/Loja.tsx`,
`apps/web/src/pages/ProductPage.tsx`, `apps/web/src/pages/Cart.tsx` e
`apps/web/src/bi/transforms.ts`.

O que comanda a onda é o retorno do cliente (Galbe Maia, dono da rede), sobre o
console: *"Já aqui dentro acho que ficou mais confusa as informações. Essa fonte
pra infos não é legal também e acho que temos que demarcar melhor as informações
principais."* — e, sobre a porta de entrada, *"Bem melhor"*.

Ele chamou de detalhe. Não é: é a diferença entre uma ferramenta de trabalho e
uma peça bonita, e ele opera 19 lojas por esta tela todo dia.

---

## 1 · O que a medição achou, e onde o defeito estava escondido

As ondas anteriores já haviam tirado a monoespaçada dos rótulos **do HTML**. A
medição desta onda mostrou que isso deixou o problema inteiro de pé no lugar
onde nenhum auditor de DOM olha: **dentro do `<canvas>`**.

Medido nesta build, sobre os oito gráficos que `transforms.ts` produz
(instrumentação: percorre a `option` do ECharts e classifica todo slot que
declara `fontFamily`):

| | antes | depois |
|---|---|---|
| slots tipográficos em mono | **19 de 34 (56%)** | 15 de 34 (44%) |
| slots em mono que carregam NOME PRÓPRIO | 6 | **0** |

E no DOM das quatro telas (contagem de elementos com nó de texto próprio e
computed style real, viewport 1440×1000):

| tela | mono antes | mono depois | infrações¹ antes | depois | assinaturas de cartão |
|---|---|---|---|---|---|
| `/admin/bi` | 0/40 | 9/60 (15%) | 0 | 0 | **2 → 5** |
| `/loja` | 1/152 | 49/177 (28%) | **1** | 0 | 1 (grade de pares) |
| `/loja/produto/:id` | 1/9 | 2/17 | 0 | 0 | 2 |
| `/loja/carrinho` | 0/4 | 0/4 | 0 | 0 | — |

¹ Infração = mono em caixa alta com entreletras acima de 14 caracteres, que é o
ponto em que o carimbo deixa de ser lido de relance e passa a ser soletrado.

A contagem de mono no `/admin/bi` **subiu** de 0 para 9, e isso é o resultado
correto: as nove ocorrências são seis sobretítulos de seção (`Operação`,
`Faturamento`, `Composição`, `Remanejamento`, `Calendário`, `Provador` — 1
palavra cada) e três carimbos de unidade colados a números (`un.`, `un.`, `%`).
A onda anterior tinha zerado a mono no corpo do console; zero também é dose
errada, porque tira a assinatura da marca junto com o ruído. O que se buscava
não era menos mono, era mono **no papel dela**.

---

## 2 · As dez piores, na ordem em que doíam

1. **Eixo de barras escrevia `ÓTICA A GRACIOSA CENT…`** — 22 caracteres, mono,
   caixa alta forçada por `toUpperCase()` no formatter. É o nome da loja, o dado
   que o gestor procura primeiro em "Vendas por loja", e em caixa alta
   monoespaçada ele perde o contorno da palavra: some a ascendente, some a
   descendente, sobra um retângulo. Com dez lojas no eixo, soletrar dez vezes.
2. **Eixo do heatmap escrevia `CASA AMARELA`** — mesmo defeito, e o caso que
   prova que contar caracteres não basta: "Casa Amarela" tem 12 e passaria como
   carimbo. Nome próprio não vira caixa alta em nenhum tamanho.
3. **Título do arco do medidor escrevia `UN. VENDIDAS / ESTOQUE`** — 22
   caracteres em mono caixa alta, sob um número em Fraunces de 30px. Frase
   inteira tratada como etiqueta.
4. **Topo do tooltip carimbava tudo** — `tituloTooltip` aplicava
   `text-transform:uppercase` em mono a qualquer texto: nome de categoria
   (`OCULOS DE SOL`), rota de sankey (`ARMACAO → Casa Amarela`), célula do
   heatmap (`Casa Amarela · Sábado`).
5. **Os quatro indicadores do BI tinham UMA assinatura só** — mesmo fundo, mesmo
   filete, mesmo corpo de número. Nada dizia qual deles a tela existe para
   mostrar. Numa tela de BI a resposta é óbvia e nunca estava escrita: a
   pergunta que traz o dono da rede aqui é *quanto a rede faturou*.
6. **O BI não tinha nenhuma abertura de seção** — nove blocos empilhados sem
   régua, sem sobretítulo e sem enunciado. A ferramenta que o manual prevê para
   separar seção de item estava no CSS e não na tela; o olho recebia a página
   como uma pilha só. É literalmente "ficou mais confusa as informações".
7. **O hero da vitrine trazia `A GRACIOSA · REDE DE ÓTICAS`** — 27 caracteres em
   mono caixa alta com 1,89px de entreletras (medido). Era a **única** infração
   da tela que o cliente elogiou, e estava na primeira linha dela.
8. **`Máximo: 1` / `12 disponíveis` no carrinho iam de `.label`** — Inter 12/600.
   Não é rótulo (que nomeia um dado), é apoio (que explica o que o campo
   aceita), e em 600 competia em peso com o próprio número dentro do campo.
9. **Código do produto e número do pedido saíam sem tratamento de identificador**
   — `12368` como texto comum e `NO-DEMO-1000` como título em Fraunces. São as
   duas cadeias que cliente e balconista comparam caractere a caractere ao
   telefone, e é exatamente onde a largura fixa da mono é função e não enfeite.
10. **`Provador virtual (AR)` repetia o próprio nome duas vezes** — o mesmo se
    dava em "Faturamento diário": título de seção e título de card diziam a
    mesma frase, um em cima do outro, gastando duas linhas de altura numa tela
    que o cliente rola o dia inteiro.

---

## 3 · A causa raiz, e ela é nossa

O manual (`docs/marca/nanoflow-manual.html`) diz *"JetBrains Mono: rótulos,
dados, código, carimbos de data"* — e está certo, **para o contexto dele**: uma
página de marca com dois ou três rótulos por seção. Aplicamos a regra
uniformemente. Um console operacional tem 40+ rótulos por tela e um gráfico tem
até seis slots de texto; a mesma regra, na mesma dose, vira ruído.

A regra não estava errada. A **dosagem** estava.

Dentro do `transforms.ts` isso tinha um agravante próprio: a linha do cabeçalho
do arquivo dizia *"JetBrains Mono: rótulo de eixo, legenda, valor, carimbo de
unidade"*, e **"rótulo de eixo" carregava o defeito inteiro**. Rótulo de eixo
não é uma categoria tipográfica: às vezes é `R$` (carimbo), às vezes é `31/07`
(identificador) e às vezes é `Ótica A Graciosa Boa Viagem` (nome próprio). Uma
palavra na documentação misturou três papéis, e o código obedeceu.

---

## 4 · A regra que passou a valer

Codificada em `papelDoRotulo` / `estiloDeRotulo` / `textoNoPapel`, em
`transforms.ts`, e travada por teste:

| papel | quando | tratamento |
|---|---|---|
| **carimbo** | etiqueta de até 14 caracteres — `R$`, `UN.`, `%`, `SEG` | mono **CAIXA ALTA** |
| **identificador** | SKU, código, número de pedido, data | mono caixa normal, entreletras zero, tabular |
| **nome** | loja, categoria, produto, frase | **Inter** caixa normal |

Regra de ouro, para o que não está na lista: *a mono é para o que se **compara**
ou se **etiqueta**; a Inter é para o que se **lê**.*

**E por que a contagem de caracteres não basta sozinha.** "Casa Amarela" tem 12
e a contagem a mandaria para carimbo. Então a regra de ouro vale para quem **não
sabe** o que vai receber, e quem **sabe** declara: um eixo de dimensão do BI —
loja, categoria, produto — é sempre nome próprio, independentemente do tamanho,
e passa `papel: 'nome'`. O eixo semanal do heatmap e o nome do arco do medidor
não sabem, e ficam na contagem. É por isso que `eixoCategoria` e `tituloTooltip`
ganharam um parâmetro de papel opcional em vez de só um heurístico.

**Um eixo nunca fica meio a meio.** `eixoCategoria` adota o papel do rótulo mais
exigente da série: basta um nome próprio para o eixo inteiro sair de mono. Um
eixo com metade em mono caixa alta e metade em Inter seria pior que qualquer um
dos dois puros — a diferença de família passaria a parecer diferença de
**significado** ("estas três lojas são de outro tipo"), que é o que o canal
tipográfico não pode dizer aqui.

**O eixo de VALOR não foi tocado.** Continua inteiramente em mono, e deve
continuar: ali a largura fixa é função, é o que alinha `1.111` com `9.999` na
mesma coluna. Idem rótulo de ponta de barra, rótulo de célula do heatmap, régua
do `visualMap` e o valor no tooltip.

---

## 5 · A hierarquia no BI

Quatro canais, todos geométricos, para o nível sobreviver ao cinza, ao
daltonismo e à impressão P&B. Medido nesta build, na própria tela do BI:

| | superfície (cinza 0–255) | filete de topo | número | altura |
|---|---|---|---|---|
| nível 1 (`Faturamento`) | 220 | **3px** `#c9a227` | 40px | 143px |
| nível 2 (apoio) | 242 | 1px a 13% | 27px | 143px |
| nível 3 (contexto) | sem superfície | 1px a 13% | 20px | **55px** |

No tema escuro (medido, alternando pelo próprio botão da casca): nível 1 sobe
para superfície 29 com filete `rgb(240,212,130)` — luminância ~211, Δ182 —
enquanto o nível 2 fica em 20 com filete a 22%. O nível 1 não depende da
superfície em nenhum dos dois temas: quem carrega a separação é o filete de 3px
e o corpo do número.

**A hierarquia não custou altura.** O nível 3 ocupa 55px contra os 143px dos
outros dois: o que o faturamento ganha em corpo e respiro, a linha de contexto
devolve. Foi por isso que "Transferências pendentes" e "Unidades vendidas no
período" desceram para contexto em vez de sumirem.

Um nível 1 por tela — a mesma regra do botão primário sólido. Se há três, a tela
não decidiu.

Além dos cartões, seis seções passaram a abrir com `<AberturaDeSecao>` (régua
dourada + sobretítulo em mono + título em Fraunces como uma coisa só):
Operação · Faturamento · Composição · Remanejamento · Calendário · Provador. Nos
dois casos em que a abertura passou a nomear o bloco, o `<h3>` interno do card
saiu — e o botão de CSV subiu para a faixa de ações da própria abertura, que é
onde o manual põe a ação de uma seção.

---

## 6 · A vitrine: o que foi mexido, e o que não foi

O cliente elogiou a porta de entrada. A instrução era não estragar o que está
funcionando — e aqui a mono **pode** aparecer mais que no console, porque a
densidade é baixa e é ela que carrega a marca na única tela que o consumidor
final vê.

Mexido:

* o hero — `A Graciosa` fica carimbado (10 caracteres, dentro do limite) e
  `Rede de óticas` desceu para Inter. A assinatura continua sendo a primeira
  coisa lida, sem a fita de 27 caracteres;
* a categoria do card foi de `.label` (Inter, desde a onda 5) para `.carimbo` —
  "Armação" (7) e "Óculos de sol" (13) cabem folgados, é **um por card**, e é
  onde a mono paga o que custa;
* o saldo saudável passou a ser `16` + `un.` em `.unidade` + `na rede` em Inter,
  em vez da frase inteira num tratamento só.

Deliberadamente **não** mexido: a grade de 24 cards continua com uma assinatura
visual só. São pares — 24 produtos comparáveis entre si —, e promover um deles
seria inventar uma hierarquia que o dado não tem. Hierarquia de nível é para
cartões que dizem coisas **diferentes**, que é o caso do BI, não da vitrine.

O `<p className="hint">` do hero virou `<div>` pela mesma razão já registrada no
arquivo para o `.eyebrow`: `.store-hero p` é (0,1,1) e venceria `.hint` (0,1,0),
devolvendo o descritivo a 19px, do tamanho do subtítulo que vem depois do `<h1>`.

---

## 7 · Verificações

* **`NANOFLOW` não é desenhado nem anunciado em nenhuma tela de produto.**
  Varredura em runtime (texto visível, `document.title` e **todos os atributos**
  de todos os elementos, que é onde um `aria-label` se esconderia) em: launcher,
  `/loja`, `/loja/produto/:id`, `/loja/carrinho`, `/loja/carrinho` pós-checkout e
  `/admin/bi` — **limpo nas seis**. No `index.html` a palavra só aparece dentro
  de um comentário HTML; no bundle, só como o rótulo acessível padrão do
  `<Signature>`, componente que nenhuma dessas telas monta.
* **Suíte**: 64 testes passando (eram 59). Os 5 novos travam a dosagem dentro do
  canvas — nome de loja em Inter no eixo e no heatmap, dia da semana ainda
  carimbado, eixo de valor intacto em mono, nome do arco por tamanho, e tooltip
  sem carimbar nome próprio. Existem porque a regra é fácil de reverter sem
  querer: basta alguém "padronizar" um eixo de volta para mono caixa alta
  achando que assim fica mais parecido com o manual.
* **`tsc --noEmit`** limpo.
* **Tema escuro** conferido na tela do BI: os três níveis continuam separados.

---

## 8 · O que fica de risco, e é decisão de quem manda

**Os dados do ERP chegam em CAIXA ALTA.** Consertamos a *nossa* caixa alta; a do
dado permanece. Nos eixos do BI ainda se lê `A GRACIOSA MIDWAY`,
`GRAND OPTICAL NATAL S…`, `LENTES`, `OCULOS`, `ARMACAO` — agora em Inter, que já
devolve alguma medida de contorno por ser proporcional, mas ainda em versal.

Isso está **fora do escopo desta onda de propósito**: a onda 3 decidiu, por
escrito, que o console interno mostra a string do ERP como ela é, e a tradução
(`nomeCategoria`, em `Loja.tsx`) existe só para a vitrine, porque *"esta é a
única tela que o CONSUMIDOR vê: caixa alta sem acento ali não é padrão de dado,
é erro de português"*.

Se o cliente disser que o console também deveria ler `A Graciosa Midway` em vez
de `A GRACIOSA MIDWAY`, é uma linha de conversão em `transforms.ts` — mas é uma
mudança de **apresentação de dado**, não de tipografia, e por isso não foi
tomada aqui sem ele pedir.
