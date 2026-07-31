# Onda 6 · Dosagem tipográfica e hierarquia nas quatro telas de operação

**Telas:** Dashboard · Alertas · Estoque · Relatórios
**Data da medição:** 31/07/2026
**Método:** build de demonstração servido por HTTP, navegado com Chromium 1194 em
1440×1000 @2x, autenticado como `galbe@novaotica.com`. Todos os números vêm de
`getComputedStyle` sobre o DOM renderizado — nenhum foi lido do código-fonte.
Script em `scratchpad/medir.mjs`; capturas antes/depois em `scratchpad/shots/`.

---

## 1. O que o cliente disse, e o que a medição encontrou

> "Já aqui dentro acho que ficou mais confusa as informações. Essa fonte pra
> infos não é legal também e acho que temos que demarcar melhor as informações
> principais. Mas tudo isso é detalhe" — Galbe Maia

São **duas** queixas, não uma, e a medição mostra que elas estavam em estágios
muito diferentes de resolução.

### 1.1 A queixa da fonte ("essa fonte pra infos não é legal") — já resolvida

O diagnóstico herdado falava em 78 de 149 elementos em JetBrains Mono (52% da
tela) e 659 caracteres em mono no Dashboard. **Esses números não se confirmam no
build atual** — e a divergência é legítima: a onda 4 aplicou o de-para e a onda 5
mediu o resultado. O que sobrou hoje, medido:

| Tela | Elementos com texto | Em mono | % em mono | Caracteres em mono | Defeitos de mono longa |
|---|---:|---:|---:|---:|---:|
| Dashboard | 175 | 14 | 8,0% | 119 | **0** |
| Alertas | — | 10 | — | 71 | **0** |
| Estoque | — | 10 | — | 74 | **0** |
| Relatórios | 735 | 7 | 1,0% | 60 | **0** |

"Defeito de mono longa" = elemento em mono, caixa alta, entreletras > 1px,
carregando mais de 14 caracteres — que é a combinação que apaga o contorno da
palavra e a torna impossível de ler sem soletrar. É a causa mecânica da queixa
do cliente, e ela está **zerada nas quatro telas**, antes e depois desta onda.

**Conclusão honesta: a dosagem tipográfica não era mais o problema aberto.** O
que restava desta queixa era um punhado de erros de vocabulário pontuais
(seção 3), não um excesso sistêmico.

### 1.2 A queixa da hierarquia ("demarcar melhor as informações principais") — era o problema real

Aqui a medição confirma a queixa inteira, e em três das quatro telas ela estava
intocada:

| Tela | Cartões | Assinaturas visuais distintas | Nível 1 | Nível 3 | Aberturas de seção |
|---|---:|---:|---:|---:|---:|
| Dashboard | 9 | 5 | **2** | 4 | 2 |
| Alertas | 5 | 3 | **0** | 0 | **0** |
| Estoque | 1 | 1 | **0** | 0 | **0** |
| Relatórios | 5 | 2 | **0** | 0 | **0** |

Alertas, Estoque e Relatórios não tinham **nenhum** nível 1, **nenhum** nível 3 e
**nenhuma** régua de seção. Os indicadores eram `div.card.stat` escritos à mão,
todos com a mesma moldura, o mesmo fundo e o mesmo corpo de número. Nada na tela
dizia qual número importava — que é literalmente a frase do cliente.

E o Dashboard tinha o defeito oposto: **dois** níveis 1. O sistema permite dois
como teto, mas teto não é meta — com dois destaques de mesma superfície lado a
lado, o olho não escolhe, ele alterna.

---

## 2. A decisão de nível 1, tela por tela

O critério que usei em todas: **nível 1 é o número que provoca uma decisão, não o
maior número da tela.** Magnitude não é hierarquia.

### Dashboard → **Cobertura da rede** (21,9 meses)

Candidatos: cobertura da rede, unidades em estoque, rupturas.

- **Unidades em estoque (38.453 un.)** é magnitude, não veredito. Sozinho não diz
  se está bom ou ruim, e não muda de forma legível de um dia para o outro.
  Ninguém age por causa dele. Além disso é o **numerador** da cobertura: quem
  olha a cobertura já olhou as unidades, e o inverso não vale. Destacar os dois
  é destacar a mesma informação duas vezes, uma delas pela metade.
- **Rupturas (288)** é lista de exceção — resolve-se item a item, não se lê como
  estado da rede. E não perde espaço com a decisão: já tem banner próprio no topo
  do Dashboard e tela inteira em Alertas.
- **Cobertura da rede (21,9 meses)** é razão, e já vem julgada. O gestor sabe de
  cor qual é a faixa saudável da rede dele, então o número se lê como diagnóstico
  no mesmo movimento em que se lê como dado. É o único dos três que responde
  "como está o estoque da rede agora?" numa só leitura.

Resultado: **um** nível 1 (era 2). Unidades em estoque desceu para nível 2.

### Alertas → **Em falta (saldo 0)** (288 itens)

É o único dos três indicadores que representa **venda perdida agora**. "Estoque
baixo" é aviso — ainda há o que vender. "Total de alertas" é a soma dos outros
dois, ou seja, não é fato novo, é aritmética: desceu para nível 3, onde diz
apenas sobre que recorte os dois de cima foram contados.

Nota: o maior número da tela (2097) é justamente o que menos manda agir. É o
exemplo mais limpo de por que magnitude não pode comandar hierarquia.

### Relatórios (Curva ABC) → **Receita no recorte** (R$ 380.000,00)

É o número que ancora a leitura de todos os outros: 172/85/49 só significam
alguma coisa depois que se sabe sobre que receita foram repartidos — e é
exatamente esse o mal-entendido que a tela foi negociada para desfazer ("os
números da curva ABC estão muito baixos").

**Classes A, B e C ficaram todas em nível 2, e isso é deliberado:** são um
conjunto comparável. Destacar a classe A sobre as outras duas destruiria a única
leitura que o trio serve — a de proporção entre elas. Hierarquia separa famílias;
não elege membro dentro de uma família.

### Relatórios (Cobertura) → **Cobertura geral**; (Transferências) → **Unidades a mover**

Mesma lógica: a razão conciliada com o Dashboard numa; o tamanho do trabalho na
outra ("sugestões" conta linhas de plano e "lojas envolvidas" descreve alcance —
os dois são recorte do primeiro, e foram para nível 3).

### Estoque → **nenhum**, e é decisão, não omissão

Estoque é tela de **consulta**. Não existe um número da rede aqui; existe a linha
que o operador veio procurar. Inventar um destaque no topo seria demarcar como
principal algo que a tela não tem. A hierarquia aqui é a régua de seção separando
filtro de resultado — e a contagem de registros, que subiu para junto do título.

---

## 3. Correções de vocabulário aplicadas

Poucas, porque a dosagem já estava boa. Todas seguem o de-para sem reinterpretação.

1. **Estoque · contagem de registros** — estava em `.label` (`"1.234 de 21.683
   registros"`). É **frase**, não rótulo: sob a regra antiga saía em mono caixa
   alta com 0.18em, exatamente o tratamento de que o cliente reclamou. Virou
   `.hint`, dentro da abertura de seção.
2. **Estoque · código do produto** — estava em `.muted` (Inter), o mesmo
   tratamento de uma frase de apoio. É **identificador**: o operador o compara
   caractere a caractere com a etiqueta da armação. Virou `<Codigo>` — mono caixa
   normal, entreletras zero, tabular. O tipo (ARMACAO/OCULOS) ficou de fora do
   `<Codigo>`: é categoria, não identificador.
3. **Alertas e Relatórios · carimbos de unidade** — números que eram grandeza nua
   ganharam `unidade` (`itens`, `SKUs`, `un.`), que é mono caixa alta de até 8
   caracteres colada ao número. É a única mono dentro do cartão, por desenho.
4. **Alertas · título de seção do bloco de transferências** — era um `<h3>` com
   `<Icon>` ao lado. Virou `<AberturaDeSecao>`. O ícone saiu porque a régua
   dourada já é o marcador de seção; os dois juntos marcavam a mesma coisa duas
   vezes.

**Relatórios: nenhum texto foi alterado.** A tela foi negociada frase a frase com
o cliente nesta semana (reconciliação da curva ABC, cobertura na mesma base do
Dashboard, filtros que não somem). O que mudou ali é nível e vocabulário
tipográfico; as notas explicativas, os rótulos e os filtros estão literalmente
byte a byte como estavam.

---

## 4. Resultado medido

| Tela | Nível 1 | Nível 3 | Aberturas | Réguas | Assinaturas distintas |
|---|---|---|---|---|---|
| Dashboard | 2 → **1** | 4 → 4 | 2 → 2 | 2 → 2 | 5 → 5 |
| Alertas | 0 → **1** | 0 → **1** | 0 → **2** | 1 → **3** | 3 → **5** |
| Estoque | 0 → 0 *(decisão)* | 0 → 0 | 0 → **1** | 0 → **1** | 1 → 1 |
| Relatórios | 0 → **1** | 0 → 0 | 0 → 0 | 0 → 0 | 2 → **3** |

Defeitos de mono longa: **0 → 0** nas quatro telas (não havia o que corrigir).

Custo tipográfico assumido, e declarado: em Estoque a mono subiu de 74 para
**1.483 caracteres**, porque `<Codigo>` passou a marcar o SKU nas 200 linhas da
tabela. É um aumento de 20×, e é o caso em que a mono é **função e não
decoração** — largura fixa para comparar "RB4446L" com "RB4446I". Vai em caixa
normal e entreletras zero, então não produz nenhum defeito de legibilidade: os
`piores` continuam em zero.

---

## 5. A prova de que a hierarquia não depende da cor

O sistema promete quatro canais geométricos. Verifiquei os dois cenários hostis:

- **Tema escuro:** o nível 1 sobe para grafite com filete `--ouro-lux`; o nível 3
  fica sem superfície. Separação preservada.
- **Escala de cinza (`filter: grayscale(1)`, tema escuro):** capturado em
  `depois-alertas-cinza.png`. Com **zero informação de cor**, o cartão "Em falta"
  continua vencendo por quatro canais independentes — filete de topo de 3px,
  superfície própria, largura dupla e número de 40px — enquanto "Total de
  alertas" recua para só um filete e 20px.

É a prova que interessa para um console operacional: a hierarquia sobrevive ao
daltonismo, ao monitor ruim de loja e à impressão em preto e branco.

---

## 6. Teste dos 3 segundos

Comparação lado a lado em `scratchpad/shots/antes-*.png` × `depois-*.png`.

- **Dashboard:** antes, dois cartões bege de peso idêntico dividiam a atenção.
  Depois, há **um** retângulo preenchido com filete dourado e o maior número da
  tela — "Cobertura da rede · 21,9 meses". É o único objeto com superfície
  própria acima da dobra.
- **Alertas:** antes, três caixas brancas idênticas com 2097 / 288 / 1809.
  Depois, "288 ITENS · Em falta" ocupa duas colunas, preenchido e com filete;
  2097 virou texto sem moldura.
- **Relatórios:** antes, quatro caixas iguais. Depois, "R$ 380.000,00" é a única
  preenchida, e as três classes leem-se como o trio comparável que são.

Nas três, aponto o principal em menos de um segundo. Estoque não entra no teste
por decisão declarada (seção 2).

---

## 7. Riscos e pendências

1. **`npm run build -w @nova-otica/web` está quebrado** por dois erros de
   `tsc --noEmit` em `apps/web/src/pages/Decisions.tsx` (TS6133, importes
   `AberturaDeSecao` e `Rota` não usados) — arquivo de outro agente, em edição.
   Não toquei. Meus quatro arquivos passam limpo no `tsc`; medi com
   `npx vite build`, que não typecheca. **Precisa ser resolvido antes da entrega.**
2. **`fmtMonths` devolve "21,9 meses" como string única**, então em Relatórios ·
   Cobertura a palavra "meses" sai em Fraunces, enquanto no Dashboard o mesmo
   carimbo sai em mono via `unidade`. É inconsistência real, mas corrigi-la mexe
   num helper compartilhado com as tabelas — fora do escopo de vocabulário desta
   onda.
3. **`.card.largo` dentro de `grid-3`**: usei `grid-4` onde precisei de coluna
   dupla + dois cartões. Em viewport estreito o comportamento de quebra não foi
   medido — só verifiquei 1440px.
4. A contagem de "assinaturas visuais distintas" inclui a altura renderizada, então
   cartões que diferem só por quebra de linha do `hint` contam como assinaturas
   diferentes. O número serve para detectar uniformidade total (valor 1), não como
   medida fina.
