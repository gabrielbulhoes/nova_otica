# Onda 5 · As quatro telas de decisão

Decisões · Planejamento & Compras · Estratégia comercial · Histórico Geral

Auditoria e correção da dosagem tipográfica e da hierarquia, a partir do retorno de
Galbe Maia sobre o console: *"Já aqui dentro acho que ficou mais confusa as
informações. Essa fonte pra infos não é legal também e acho que temos que demarcar
melhor as informações principais."*

Ele chamou de detalhe. São as telas por onde ele decide o que fazer com 19 lojas
todo dia, e a confusão que ele descreveu tem endereço medido.

---

## 1 · O que a medição mostrou (e onde ela contrariou a hipótese)

Medido no pacote entregue, com Chromium a 1440×1000, contando **elementos com nó de
texto próprio e visíveis** dentro de `<main>` — o mesmo método da auditoria do
Dashboard.

| | Decisões | Planejamento | Estratégia | Histórico |
|---|---|---|---|---|
| caracteres em mono | 11.040 | 366 | 26 | 0 |
| caracteres totais | 497.484 | 102.062 | 719 | 515 |
| **mono como fração do texto** | **2,2 %** | **0,4 %** | **3,6 %** | **0 %** |
| violações do de‑para | 1 | 1 | 0 | 0 |

**A hipótese de entrada estava errada para estas quatro telas, e o número ganhou.**
O diagnóstico do Dashboard (78 de 149 elementos em mono, 52 % da tela) não se
reproduz aqui: nas telas de decisão a mono já era minoria. O que a mesma medição
encontrou no lugar foi um problema de **hierarquia**, e ele é severo:

| | Decisões | Planejamento | Estratégia | Histórico |
|---|---|---|---|---|
| `.rule-section` (aberturas de seção) | **0** | 1 | **0** | **0** |
| cartões nível 1 | **0** | 0 | **0** | **0** |
| cartões nível 3 | **0** | 0 | **0** | **0** |
| assinaturas visuais distintas entre cartões | **1** | **1** | 4 | **1** |
| `.codigo` (identificadores) | 0 | 0 | 0 | 0 |
| `.unidade` (carimbos de unidade) | 0 | 0 | 0 | 0 |

Três das quatro telas tinham **uma única assinatura visual** para todos os cartões, e
as quatro juntas somavam **1 régua de seção** para **21 blocos de conteúdo**. As duas
classes que a Onda 5 criou para o vocabulário tipográfico — `.codigo` e `.unidade` —
não eram usadas **nenhuma vez** nas quatro telas.

Ou seja: a queixa dele sobre "a fonte pra infos" era real, mas a dose de mono nestas
telas não era a causa. A causa era que **nada distinguia o principal do acessório** —
que é exatamente a segunda metade da frase dele, e a metade que ele mesmo pôs por
último.

### As duas violações tipográficas reais

Critério de violação, direto do de‑para (`NUNCA`): mono acima de ~24 caracteres, ou
mono caixa alta a 0.18em acima de ~14 caracteres.

| tela | texto | car. | tamanho | entreletras | classe |
|---|---|---|---|---|---|
| Planejamento | `O QUE FAZER HOJE` | 16 | 10,5px | 0.18em | `.eyebrow` |
| Estratégia | `DECISÃO DO MOTOR` | 16 | 10,5px | 0.18em | `.eyebrow` |

Nos dois casos o sobretítulo tomava a frase inteira em vez de uma etiqueta de 1–2
palavras. Acima de ~14 caracteres o 0.18em deixa de separar letras e passa a
desmanchar a palavra: o olho soletra em vez de reconhecer o contorno.

**Falso positivo descartado por medição.** O detector inicial acusou mais 4 casos, todos
cabeçalhos de coluna (`COBERTURA NO DESTINO`, `FORNECEDOR (MARCA)`, `PRAZO DE ENTREGA`,
`PRODUTO · POR QUÊ`). Medidos, estão a **0,84px sobre 10,5px = 0.08em** — exatamente o
que o de‑para prescreve para `th`, e não os 0.18em da regra de carimbo. Não são
violações; o critério do detector é que estava grosso demais. Corrigido para
`entreletras/corpo > 0.15`.

---

## 2 · O que foi feito

### 2.1 · Decisões — a hierarquia dentro do card

O card de decisão carrega duas coisas de naturezas diferentes:

- **a ação** — o desconto a aplicar, a rota da transferência. É o que a pessoa executa.
- **a justificativa** — margem, degraus, dias parado, o texto da regra do motor.

As duas chegavam com **exatamente a mesma assinatura**: mesmo fundo, mesma régua,
mesmo peso. A única forma de saber qual era qual era ler as duas. Numa grade de três
cards por linha, com 1.380 cards no quadro, é aí que "ficou mais confusa" dói.

**Nova classe `.acao-do-card`** (styles.css). Toma emprestada a gramática do cartão
nível 1, para que o console tenha *um* jeito de dizer "isto é o principal":
superfície própria (`--panel-2`), filete de 3px em ouro e respiro maior. O filete vai
à **esquerda**, e não no topo como no cartão: dentro do card o vizinho de cima é
conteúdo do mesmo card, e um filete horizontal ali leria como separador de seção — o
papel que `hr.rule` já cumpre — em vez de promoção.

Os três canais são geométricos e independentes (superfície, filete, respiro), então
a promoção sobrevive ao cinza, ao daltonismo e à impressão. Verificado: em `@media
print` a superfície morre por regra e sobra o filete, em preto.

Medido no tema escuro: fundo `rgb(34,29,21)` (grafite), filete `rgb(240,212,130)`
(`--ouro-lux`) a 3px — a mesma inversão que o nível 1 já fazia.

Dentro da zona promovida:
- o desconto subiu de **Fraunces 20px para 27px**, o corpo do cartão nível 2. A 20px
  ele ficava **menor que o impacto do rodapé do próprio card** — o número que a tela
  existe para entregar era o terceiro em tamanho.
- a rota ganhou componente próprio (`<Rota>`), com origem e destino em `<strong>` e a
  quantidade colada ao carimbo `.unidade`.
- **o card de remanejamento não mostrava a rota em lugar nenhum** a não ser dentro da
  frase corrida do campo "Alvo", a três blocos de distância do botão que a executa.
  Agora a rota é a zona promovida do card, e o "Alvo" duplicado saiu.

Fora da zona, sob o rótulo **"Por que este número"**: a razão da regra e os
parâmetros. A linha de parâmetros trocou de lado — tinha o *rótulo* em `.label`
(Inter 12/600, escuro) e o *valor* em Inter regular, ou seja, o nome do parâmetro
pesava mais que o número. Agora o rótulo recua para Inter 12 `--muted` e o valor vai
para `.codigo`. Mono aqui é função, não decoração: `45%`, `0 de 10 p.p.`, `15 dias`
são exatamente o que se compara de um card para o outro, lado a lado.

**Identificador do card** (`#L3L.MV4`): saiu de `.carimbo` (mono CAIXA ALTA, 0.18em)
para `.codigo` (mono caixa normal, entreletras zero). A caixa alta apagava a diferença
entre `0` e `O`, e o 0.18em separava tanto os glifos que a cadeia deixava de se ler
como uma unidade. É o caso em que a mono é função — e função pede a caixa e o
espaçamento da leitura, não os da etiqueta. Mesmo tratamento no carimbo de data/hora
do lote.

**Grade de indicadores.** Três `.card.stat` idênticos viraram três níveis:

- nível 1 (`largo`, 2 colunas) — *Cards em aberto*, o tamanho da fila.
- nível 2 — *Críticos (~7 dias)* e *Alta prioridade*, o recorte com prazo.
- nível 3 — *A comprar · A remanejar · A liquidar*. Estavam espremidos como frase de
  60 caracteres dentro do `hint` do cartão de cima (`"126 comprar · 1203 remanejar ·
  51 liquidar"`), onde três números diferentes chegavam como texto corrido. Como três
  cartões de contexto voltam a ser números — e custam **55px de altura contra os 143px**
  de um cartão normal (medido no navegador). A hierarquia aqui não cobra densidade:
  ela paga.

E a grade de cards ganhou a abertura de seção que ela não tinha: os filtros vinham
soltos e a grade começava sem título.

### 2.2 · Planejamento — seis blocos que competiam

Era o pedido explícito: 1.324 linhas, sete blocos de conteúdo, **uma** régua de seção.
Todos os outros seis abriam com um `.section-title` dentro de um `.card` — seis caixas
idênticas empilhadas, sem nada dizendo que são assuntos diferentes.

Cada um passou a abrir com `<AberturaDeSecao>` (régua dourada + sobretítulo em mono +
título em Fraunces + descrição em Inter), **acima** do cartão e não dentro dele — que
é onde a separação custa zero altura de conteúdo:

| bloco | sobretítulo |
|---|---|
| O que fazer hoje | `HOJE` |
| Redistribuir entre lojas (antes de comprar) | `REMANEJAR` |
| Pedidos por fornecedor (rascunho) | `COMPRAR` |
| Histórico de pedidos (enviado → recebido) | `TRILHA` |
| O que comprar (e o que não) | `ITEM A ITEM` |
| Prazos dos fornecedores (lead time) | `PRAZOS` |
| Modo Feira — como distribuir uma compra nova | `FEIRA` |
| Onde o capital está parado | `PANORAMA` |

Os selos e botões que ficavam à direita do título de cada bloco passaram para a
propriedade `acoes` da abertura, sem perder posição.

Régua de seção: **1 → 8**.

Os quatro cartões de ação do topo ficaram deliberadamente **no mesmo nível**: são
quatro atalhos de navegação que já se separam pelo filete esquerdo de severidade, e
promover um deles diria que uma das quatro frentes do dia importa mais — o que a tela
não sabe.

### 2.3 · Estratégia — a violação que o de‑para nomeia por escrito

Dois carimbos de unidade estavam em `.label`:

```
<div className="kpi">{fmt(floor)}<span className="label">un.</span></div>
```

Desde esta onda `.label` é Inter 12px/600 caixa normal — ou seja, o carimbo `un.`
tinha virado um rótulo do tamanho e do peso de um nome de campo, colado a um número
de 34px. É o item que o de‑para proíbe nominalmente: *"NUNCA `.label` para carimbo de
unidade (use `.unidade`)"*. Trocados por `<Unidade>`, que dimensiona em relação ao
número (0.34em) e volta à mono caixa alta — o papel legítimo dela: etiquetar, não
nomear. Mais três ocorrências corrigidas nos cartões de segmento e no banner de
lastro.

Os três números que sustentam o veredito (*Capacidade na janela · Uso da capacidade ·
Com lastro*) eram `<div>` soltos com `.label` + `.kpi` num flex — a mesma informação
que o resto do console entrega em `<StatCard>`, desenhada à mão e sem nível. São
**contexto do banner de veredito logo acima** (a conta que o motor fez para dizer
"viável"), e contexto é literalmente o papel do nível 3. Viraram `<StatCard nivel={3}>`.

Os dois `.eyebrow` soltos viraram aberturas completas. `DECISÃO DO MOTOR` (16 car.)
desceu para o título em Fraunces e o sobretítulo ficou com `MOTOR`.

Os três cartões de segmento (*Best‑seller · Lançamento · Aposta*) seguem **no mesmo
nível**, e isso é decisão: são as três fatias de uma divisão, e promover uma seria
mentir sobre a decisão do motor. O que os separa é o filete de topo de 3px na cor da
fatia — o mesmo canal geométrico do nível 1, usado aqui para **identidade** e não para
hierarquia, na mesma ordem da barra empilhada acima.

### 2.4 · Histórico — o parâmetro que se fazia passar por indicador

Quatro indicadores idênticos, e dois deles não eram indicadores: o **SLA de decisão**
é um *parâmetro* da rede (não mede nada, declara a régua), e o *tempo médio até
decidir* é a leitura desse parâmetro. O SLA foi para nível 3.

Nível 1 (largo) ficou com *Aprovados (30 dias)* — não por ser o maior número, e sim
porque é a pergunta que a tela responde: o que a equipe deixou passar no mês. A recusa
é o contraponto e fica no nível 2, ao lado.

As três seções (série, equipe, trilha) eram três `.card` empilhados. Ganharam abertura:
`RITMO`, `EQUIPE`, `REGISTRO`.

Na tabela da trilha, **data/hora e id do card** foram para `.codigo`. Numa trilha de
auditoria essas duas colunas são lidas verticalmente, uma linha contra a outra: a
largura fixa é o que faz `31/07, 06:12` e `31/07, 16:12` alinharem dígito com dígito.
É o único motivo de a mono estar ali — e a segunda linha de cada célula, que é frase,
ficou em Inter.

---

## 3 · Depois

| | Decisões | Planejamento | Estratégia | Histórico |
|---|---|---|---|---|
| régua de seção | 0 → **1** | 1 → **8** | 0 → **2** | 0 → **2** |
| cartões nível 1 | 0 → **1** | 0 | 0 | 0 → **1** |
| cartões nível 3 | 0 → **3** | 0 | 0 → **3** | 0 → **1** |
| assinaturas distintas | 1 → **3** | 1 | 4 → **5** | 1 → **3** |
| `.codigo` | 0 → **1.581** | 0 | 0 | 0 |
| `.unidade` | 0 → **1.428** | 0 | 0 → **5** | 0 → **1** |
| violações do de‑para | 0 | 1 → **0** | 0 | 0 |

Violações tipográficas nas quatro telas: **2 → 0**.

A fração de texto em mono em Decisões subiu de 2,2 % para 3,2 % — e subiu **de
propósito**. O que entrou foram 1.581 identificadores e 1.428 carimbos de unidade, ou
seja, mono nos dois papéis que o de‑para reserva para ela: o que se **compara** e o que
se **etiqueta**. O que saiu foram os rótulos descritivos. A dose não é o alvo; a
alocação é.

### Os três canais da hierarquia, medidos no navegador

| | superfície (cinza 0‑255, tema escuro) | filete de topo | altura | corpo do número |
|---|---|---|---|---|
| nível 1 | 30 | **211** (Δ181) | 143px | 40px |
| nível 2 | 20 | — | 143px | 27px |
| nível 3 | 0 (sem superfície) | 1px | **55px** | 20px |

Os três canais são independentes: mesmo perdendo a superfície (impressão P&B) ou a
cor (daltonismo, monitor descalibrado da loja), sobram a altura e o corpo do número.
E o nível 3 ocupa **38 % da altura** do nível 2 — o que confirma, com número, que a
hierarquia devolve mais linha do que consome.

---

## 4 · Verificação

- `tsc --noEmit` limpo nos quatro arquivos.
- Build de produção reproduzido com o comando de entrega.
- Tema claro e tema escuro conferidos com captura em `/#/admin/decisoes`,
  `planejamento`, `estrategia`, `historico`.
- `filter: grayscale(1)` aplicado sobre a tela de Decisões: a zona de ação e os três
  níveis continuam separáveis, porque nenhum dos canais é cromático.
- Detector de violações reescrito para o critério correto (`entreletras/corpo > 0.15`
  em caixa alta acima de 14 caracteres, ou qualquer mono acima de 24). Script em
  `decisao-medir.mjs`.

## 5 · O que ficou de fora, e por quê

- **Os quatro cartões de ação do topo de Planejamento** seguem no mesmo nível. São
  quatro frentes do dia sem ordem intrínseca, e o filete esquerdo de severidade já os
  separa. Promover um exigiria uma regra de negócio que a tela não tem.
- **Os três cartões de segmento de Estratégia** idem: são fatias de uma divisão.
- **A tabela de Decisões não existe** — a tela é uma grade de cards. Onde há tabela
  (Planejamento, Histórico), os `th` já estavam em 0.08em, medido, e não foram tocados.
