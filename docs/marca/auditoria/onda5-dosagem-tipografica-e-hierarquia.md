# Onda 5 · Dosagem da monoespaçada e hierarquia de cartão

**Escopo:** `apps/web/src/styles.css` · `apps/web/src/components/ui.tsx`
(+ `pages/Dashboard.tsx` como implementação de referência e `lib/scope.tsx` como
conserto de build).

**Como foi medido.** Build real
(`VITE_DEMO=1 … npm run build -w @nova-otica/web`), servido por HTTP, Chromium
1440×940 @2x, pt-BR, `reducedMotion: reduce`. A linha de base é um **build
isolado**: cópia do repositório com `ui.tsx` e `Dashboard.tsx` restaurados do
commit `a51e263` (o último antes desta onda) e 14 propriedades do CSS revertidas
uma a uma, servido em paralelo. Cada número foi medido três vezes, com resultados
idênticos. Nada aqui é estimativa.

> **Nota sobre a nomenclatura.** O commit desta entrega saiu com o título
> "Onda 4"; os comentários no CSS a chamam de ONDA 5, para não se confundir com
> os blocos "ONDA 4 ·" já existentes, que são da auditoria de contraste e
> impressão. São duas passagens distintas no mesmo arquivo.

---

## 1. O que o cliente disse, e o que foi encontrado

> "Já aqui dentro acho que ficou mais confusa as informações. Essa fonte pra
> infos não é legal também e acho que temos que demarcar melhor as informações
> principais. Mas tudo isso é detalhe" — Galbe Maia

Não é detalhe. As duas frases apontam dois defeitos distintos, e os dois foram
confirmados por medida no Dashboard entregue:

| | linha de base medida |
|---|---|
| elementos com texto em JetBrains Mono | **87 de 178 · 48,9%** |
| caracteres em mono | **738 de 3.188 · 23,1%** |
| elementos em **caixa alta com 0.18em de entreletras** | **43** |
| **desses, com mais de 14 caracteres** | **24** |
| cartões com assinatura visual idêntica | **9 de 9** — mesmo fundo, mesmo filete, mesmo corpo de número |
| réguas hierárquicas em uso na tela (`.rule-section` / `.rule`) | **0 / 0** |

O relatório anterior registrava 78/149 = 52%, contando só a área `.main`. Os
48,9% desta auditoria cobrem a janela inteira e são estáveis em três medições.
Onde diverge, **vale o número medido aqui**.

**A causa raiz é nossa.** A regra do manual ("JetBrains Mono: rótulos, dados,
código, carimbos"; "rótulo em mono sempre em caixa alta com entreletras 0.18em")
foi escrita para uma página de marca, que tem dois ou três rótulos por seção.
Aplicada na mesma dose a um console operacional, que tem 40+ rótulos por tela,
ela deixa de ser assinatura e vira base. A regra não está errada; a **dose**
estava.

---

## 2. Resultado

### 2.1 Dosagem da mono — Dashboard

| | antes | depois |
|---|---|---|
| elementos em mono | 87 / 178 · **48,9%** | 18 / 204 · **8,8%** |
| caracteres em mono | 738 / 3.188 · **23,1%** | 162 / 3.294 · **4,9%** |
| elementos em mono carregando **palavra** (não só dígito) | 43 | 17 |
| elementos em **caixa alta com 0.18em** | **43** | **9** |
| **desses, com mais de 14 caracteres** | **24** | **0** |
| células numéricas em mono | 44 | 0 |
| texto mais longo em mono | "Transferências pendentes" — 24 car., caixa alta, 1,8px de entreletras | "31/07/2026, 16:45" — carimbo de data, caixa normal, **0** de entreletras |

**A linha que mais importa é a quinta.** O defeito nunca foi "existe mono demais"
— foi **mono em caixa alta espaçada carregando palavra longa**, e disso restou
zero. Os 24 casos da linha de base eram os rótulos de indicador ("Unidades em
estoque", "Transferências pendentes", "Última sincronização") e os 19 chips de
cobertura ("9,4 MESES · ALTA", repetido linha após linha). O único elemento com
mais de 14 caracteres que ainda leva entreletras é o cabeçalho
"VENDA MÉDIA/MÊS", a 0.08em — exatamente a faixa que o de-para prevê.

Varredura das 17 rotas do produto: **0 selos quebrados em duas linhas, 0 rolagem
horizontal de página, 0 erro de JS e 0 frase (>24 caracteres) em mono** — com um
caso isolado em `/loja` que não se reproduz em carga limpa.

### 2.2 Hierarquia — Dashboard

Os nove cartões idênticos viraram três níveis, separados por **quatro canais
geométricos**, nenhum deles cor:

| | filete de topo | superfície | corpo do número | altura | respiro |
|---|---|---|---|---|---|
| **nível 1** `.card.destaque` | **3px ouro** | papel 2 (`--panel-2`) | Fraunces **40px** | 181px | 22/20px, pode ocupar 2 colunas |
| **nível 2** `.card` (padrão) | 1px, igual à volta | papel | Fraunces 27px | 181px | 18px |
| **nível 3** `.card.contexto` | 1px, **só em cima** | nenhuma | Fraunces 20px | **102px** | 10px 0 |

Réguas em uso na tela: **0 → 2 `.rule-section`**, uma por seção, via
`<AberturaDeSecao>`.

**Prova sem cor** (`filter: grayscale(1)` — `evidencia-onda5/niveis-cinza.png`),
luminância medida em níveis de cinza 0–255:

| nível | superfície | filete de topo | separação |
|---|---|---|---|
| 1 | 220 | 160 | **Δ 60** |
| 2 | 242 | 212 | Δ 30 |
| 3 | 242 (transparente) | 212 | Δ 30 |

Os três continuam distintos porque a separação não depende só do filete: a
superfície (220 × 242), a altura (181 × 102) e o corpo do número (40 × 27 × 20)
são canais independentes que o cinza não apaga.

**No tema escuro** (`niveis-escuro.png`): nível 1 sobe para grafite com filete
`--ouro-lux` (Δ 181 em cinza), nível 2 em carvão (Δ 49), nível 3 sem superfície
(Δ 51). Sem as duas regras novas de override, os níveis 1 e 2 cairiam no mesmo
carvão — `[data-tema='escuro'] .card` vale o mesmo que `.card.destaque` e vem
depois na cascata.

**No papel P&B** (`@media print` + cinza — `papel-niveis.png`): a superfície morre
por regra (todo cartão é chapado em `#fff`, decisão da auditoria de impressão),
então sobram os canais geométricos — nível 1 = 3px **preto** no topo + número de
40px; nível 2 = moldura cinza 1px + 27px; nível 3 = só o filete de topo cinza +
20px.

### 2.3 Densidade — subiu

A hierarquia não pode custar linha: é ferramenta de trabalho, e o cliente opera
19 lojas por esta tela.

**Dashboard** — paridade exata no primeiro quadro:

| | antes | depois |
|---|---|---|
| topo da primeira tabela | 643px | **644px** (+1px) |
| linhas de loja no primeiro quadro | 2 | **2** |
| altura total do documento | 2.252px | 2.314px (+2,8%) |

O documento cresce 62px por causa das duas aberturas de seção. É o preço da
hierarquia, e ele é pago **fora** do primeiro quadro — o que o operador vê ao
abrir a tela não mudou de tamanho.

**Telas densas — altura média por linha de tabela:**

| tela | antes | depois | |
|---|---|---|---|
| **Estoque** (200 linhas) | 110,2px | **81,0px** | **−26,5%** · tabela inteira 22.049 → 16.196px |
| **Planejamento** (612 linhas, 7 tabelas) | 112,5px | **111,6px** | −0,8% |
| **Transferências** (31 linhas) | 82,1px | **81,5px** | −0,7% |
| **Produtos** (440 linhas) | 48,1px | **47,8px** | −0,6% |

O ganho do Estoque vem de dois lugares somados: a entreletras do cabeçalho de
coluna (0.18em → 0.08em devolve largura às colunas de texto) e o respiro lateral
da célula (14 → 12px, ver §3.6). O nome do produto para de quebrar em três
linhas e a linha inteira encolhe. Comparação lado a lado em
`evidencia-onda5/antes-grade.png` × `final-grade.png` — **3 linhas visíveis viram
5 no mesmo espaço.**

---

## 3. As decisões, e a medida que sustenta cada uma

### 3.1 Os três papéis da monoespaçada

A mono passa a significar **uma coisa só**: "isto é identificador ou etiqueta" —
nunca "isto é texto pequeno".

| papel | tratamento | onde |
|---|---|---|
| **etiqueta curta** (≤ ~14 caracteres) | mono · CAIXA ALTA · **0.18em** | `.carimbo` `.unidade` `.eyebrow` `.titlebar .title` `.titlebar .label` `.sidebar .label` |
| **etiqueta longa** (15 a ~24) | mono · CAIXA ALTA · **0.08em** | `th` |
| **identificador** | mono · caixa normal · **0** de entreletras | `.codigo` (SKU, código, ID, data/hora, protocolo) |

A 0.18em é medida de etiqueta de uma a duas palavras. Em "VENDA MÉDIA/MÊS" ou
"TRANSFERÊNCIAS PENDENTES" ela larga as letras a ponto de destruir o **contorno
da palavra** — que é a forma pela qual o olho a reconhece sem soletrar. É isso o
"essa fonte pra infos não é legal" do cliente.

### 3.2 Por que a QUANTIDADE saiu da mono

`td.num` era a maior massa de mono do produto: 140 ocorrências no JSX, 44 células
só no Dashboard. Três razões, nesta ordem:

1. **O sistema tinha três vozes numéricas para o mesmo significado.** "1.486"
   saía em Fraunces no indicador, em mono na célula e em Inter dentro da frase do
   banner. Agora são três vozes para três significados: Fraunces = número-herói ·
   Inter tabular = quantidade em linha ou frase · mono = identificador.
2. **O único argumento funcional da mono numa coluna é o alinhamento, e quem
   entrega alinhamento é `font-variant-numeric`, não a família.** Medido nesta
   build, a 13,5px: Inter **sem** `tabular-nums` põe "1111" em 21,97px e "0000"
   em 34,08px — 12,1px de desalinho, uma coluna que mente sobre a ordem de
   grandeza; **com** `tabular-nums`, as duas medem 35,02px. Por isso a
   propriedade não é enfeite na regra `td.num`: é a parte obrigatória.
3. **Não custa densidade.** "1.486" mede 38,66px em Inter tabular 13,5px contra
   39,02px em JetBrains Mono 13px — 0,9% mais estreito.

### 3.3 Por que o CHIP DE ESTADO saiu da mono caixa alta

O `.badge` era o maior consumidor de mono **por caractere** do Dashboard: 19
selos de cobertura, **~350 dos 738 caracteres**. E o que ele carrega não é
etiqueta, é frase curta — "9,4 meses · alta", "Aprovada/Pendente". Em caixa alta
espaçada isso vira "9,4 MESES · ALTA", repetido 19 vezes numa coluna: dos 24
elementos deformados da linha de base, **19 eram este chip**.

A Onda 4 já tinha registrado o sintoma sem tratar a causa — 744 selos partidos em
duas linhas no Planejamento, 19 no Estoque, 30 em Transferências — e a solução
foi `white-space: nowrap`, segurando a largura que a caixa alta inflava. Em Inter
11,5px caixa normal o mesmo texto ocupa ~28% menos largura: o chip fica **maior
de ler e menor na célula**.

Os três canais redundantes da WCAG 1.4.1 continuam inteiros (rótulo escrito +
ícone da grade 24 + filete esquerdo de espessura crescente) e **ganharam um
quarto**: o peso. Na JetBrains Mono deste projeto a faixa é 400..500, então "600
no crítico" virava negrito sintético — era o motivo declarado de o peso não ser
usado como canal até aqui. Em Inter a faixa é 300..600 e o 600 é uma face real. O
`CoverageBadge` passa a marcar o veredito (`Alta`, `Excesso`) em `<strong>`,
separando a medida do julgamento dentro do próprio chip.

### 3.4 A exceção da casca

`.label` dentro de `.titlebar` e `.sidebar` **continua em mono caixa alta**. Ali
ele não nomeia um dado — nomeia um controle ou uma pessoa ("Recorte", "Gestor da
rede"), tudo com até 14 caracteres. É a mesma função do `.eyebrow`. Manter a mono
na casca é o que preserva a assinatura carimbada da parte que o cliente
**aprovou** ("bem melhor", sobre a porta de entrada), enquanto o corpo do console
volta para Inter. A regra é por contexto, não por classe nova: nenhuma das 20
telas precisa saber da distinção.

### 3.5 Por que o nível 1 usa filete de TOPO, e não moldura mais grossa

Um retângulo mais encorpado compete com a tabela ao lado e engorda a tela
inteira. O filete de topo é a gramática que a janela do console já usa
(`.macos-window` abre com 2px de ouro em cima) e que o manual chama de régua: o
olho lê "isto abre". E o nível 3 **devolve** altura — abre mão da moldura e do
fundo e cai de 18px de respiro para 10px, que é o motivo de a hierarquia sair com
saldo neutro de densidade no primeiro quadro.

### 3.6 O efeito colateral que a medida pegou, e o conserto

Afinar a entreletras do `th` reduziu a largura MÍNIMA de cada coluna. Na tabela
de recomendação de compra do Planejamento (10 colunas, 440 linhas) a largura
natural caiu de 1.215px para 1.114px contra um cartão de 1.104px: em vez de rolar
de lado como sempre rolou, a tabela passou a ser **espremida** para caber, e a
folga economizada na horizontal voltou como altura — **128,6 → 144,9px por
linha**, isto é, +7.000px de rolagem vertical para economizar 10px de horizontal.
Péssimo negócio para quem opera.

Duas tentativas e um acerto, todas medidas:

* `th { white-space: nowrap }` — **não resolveu** (144,9 → 145,1). A largura
  mínima não vinha do cabeçalho. Revertido.
* `.hint` a 12,5px — **piorava** (144,9 → 152,7): meio pixel de corpo empurrava a
  segunda linha da célula para uma terceira. Voltou para 12px.
* **respiro lateral da célula de 14 → 12px** — resolveu. Dez colunas × 28px de ar
  são 280px gastos em espaço morto, e é essa largura que falta às colunas de
  TEXTO, que são as que quebram e definem a altura da linha. Resultado: a tabela
  volta a **129,5px por linha** (paridade com a base) e agora **cabe inteira nos
  1.104px do cartão, sem rolagem lateral nenhuma** — as 10 colunas passam a ser
  visíveis de uma vez. O respiro VERTICAL não se moveu: é ele que separa uma
  linha da outra.

O mesmo conserto é o que leva o Estoque de 110,2 para 81,0px por linha.

### 3.7 Onde a dose parou, e onde ela não chegou

O alvo pedido era 15–20% de elementos em mono no Dashboard. **A entrega parou em
8,8%, e isso é reportado como divergência, não como sucesso.**

A razão é aritmética. Dos 87 elementos em mono da linha de base, **44 eram
células numéricas** (51%) e 19 eram chips de estado (22%) — 72% do total nos dois
lugares de onde a mono precisava sair. O que **sobra elegível** no Dashboard é:
8 cabeçalhos de coluna + 3 sobretítulos + 2 carimbos de unidade + 1 carimbo de
data/hora + 4 etiquetas de casca = **18**. Não existem 15–20% a atingir nesta
tela sem devolver a mono para quantidade ou para frase.

Duas observações honestas sobre o número:

* **As telas de tabela medem 0,7–1,4% hoje porque o de-para ainda não foi
  aplicado.** Elas carregam identificador — o SKU "#12368 · OCULOS" em cada linha
  do Estoque, a coluna "Data" em Transferências e Histórico — que hoje está em
  Inter e **deve ir para `.codigo`**. Só no Estoque isso devolve ~200 elementos à
  mono, de 0,7% para ~10%. A dose de regime do console é da ordem de **8 a 12%**,
  uniforme, com a mono aparecendo nos mesmos quatro papéis em toda tela.
* **Se a direção quiser a faixa de 15–20%, existe uma alavanca única e
  reversível:** devolver `td.num` para `var(--font-mono)` — uma linha em
  `styles.css`. Isso põe o Dashboard em 30,3% (18 + 44 de 204), acima da faixa e
  não dentro dela, e reintroduz a terceira voz numérica. A recomendação é não
  fazer.

---

## 4. DE-PARA — a regra que os outros especialistas seguem

Sem interpretação. O que não estiver na tabela cai na **Regra de ouro**, ao final.

### 4.1 Tipografia

| o que é | classe | tratamento | exemplo |
|---|---|---|---|
| **rótulo de indicador** (StatCard) | `.label` | Inter 12px / 600, caixa normal, 0 entreletras | "Unidades em estoque" |
| **rótulo de campo de formulário** | `.field label` | Inter 12px / 600, caixa normal | "Quantidade a transferir" |
| **frase de apoio / explicação** | `.hint` | Inter 12px / 400, caixa normal | "Estoque ÷ média mensal de unidades vendidas" |
| **carimbo curto, em bloco** (≤ ~14 car.) | `.carimbo` | mono CAIXA ALTA 10px, 0.18em | "AMÉRICA/RECIFE", "ÚLTIMOS 30D" |
| **carimbo de unidade, colado ao número** | `.unidade` | mono CAIXA ALTA `max(10px, 0.34em)`, 0.18em | "un.", "meses", "/mês", "%" |
| **identificador** (SKU, código, ID, data/hora) | `.codigo` | mono **caixa normal** 12,5px, **0** entreletras, tabular | "#12368", "RB4446L", "31/07/2026, 16:31" |
| **sobretítulo de seção** (1–2 palavras) | `.eyebrow` | mono CAIXA ALTA 10,5px, 0.18em, ouro | "OPERAÇÃO", "COBERTURA" |
| **cabeçalho de coluna** | `th` | mono CAIXA ALTA 10,5px, **0.08em** | "VENDA MÉDIA/MÊS" |
| **quantidade em célula** | `td.num` | **Inter** 13,5px + `tabular-nums`, à direita | 1.486 |
| **chip de estado** | `<Selo>` / `.badge` | **Inter** 11,5px, caixa normal, veredito em `<strong>` | "9,4 meses · **Alta**" |
| **chip de controle segmentado** | `.segmented button` | **Inter** 12px, caixa normal | "Óculos e relógios" |
| **rótulo na casca** (titlebar / sidebar) | `.label`, sem mudança no JSX | mono CAIXA ALTA 10px, 0.18em — **automático por contexto** | "RECORTE", "GESTOR DA REDE" |

**Nunca:** mono em texto acima de ~24 caracteres · mono em caixa alta com 0.18em
acima de ~14 caracteres · `.label` para carimbo de unidade (use `.unidade`) ·
`.carimbo` para frase (use `.hint`) · `td.num` sem `tabular-nums`.

### 4.2 Hierarquia

| papel | como escrever | o que sai na tela |
|---|---|---|
| **indicador principal** — o que a tela existe para mostrar | `<StatCard nivel={1} …>` → `card stat destaque` | filete dourado de 3px no topo, superfície própria, número em Fraunces 40px |
| idem, com o dobro de largura | `<StatCard nivel={1} className="largo" …>` | ocupa 2 colunas do grid |
| **apoio** — padrão, não se declara | `<StatCard …>` | cartão de sempre, número 27px |
| **contexto / rodapé** | `<StatCard nivel={3} …>` → `card stat contexto` | sem moldura e sem fundo, só filete de topo, número 20px |
| **abertura de seção** | `<AberturaDeSecao eyebrow="…" titulo="…" descricao="…" />` | `.rule-section` dourada + sobretítulo em mono + título em Fraunces |
| **separador entre itens** | `<hr className="rule" />` | filete neutro de 1px |

**Teto do nível 1: UM por tela, dois no máximo** — mesma regra do
`<BotaoPrimario>`. Três destaques significam que a tela não decidiu qual é a
informação principal; isso se resolve no desenho, não promovendo mais cartões.
**O nível 2 é o padrão** justamente para que nenhuma tela nasça promovendo tudo.

### 4.3 Componentes novos em `components/ui.tsx`

* `StatCard` ganhou `nivel?: 1 | 2 | 3` (padrão 2), `unidade?: string` (carimbo
  colado ao número) e `className?: string` (hoje só `largo`).
* `<Codigo>` — identificador em mono caixa normal.
* `<Unidade>` — carimbo de unidade colado a um número.
* `<AberturaDeSecao>` — régua dourada + sobretítulo + título + descrição, como
  uma coisa só.

### 4.4 Regra de ouro, para o que não está na tabela

> **A mono é para o que se COMPARA ou se ETIQUETA. A Inter é para o que se LÊ.**
>
> Um SKU se compara caractere a caractere → mono. Um cabeçalho de coluna etiqueta
> a coluna → mono. "Transferências pendentes" se lê → Inter. Uma quantidade se lê
> como grandeza → Inter tabular. Na dúvida, conte os caracteres: acima de 24, é
> Inter, sem exceção.

---

## 5. Riscos e pendências

1. **O de-para ainda não foi aplicado às 19 telas restantes.** Enquanto isso não
   acontece, as telas de tabela ficam com a mono quase ausente (0,7–1,4%), porque
   os identificadores que deveriam carregá-la (`#12368` no Estoque, a coluna
   "Data" em Transferências e Histórico) seguem em Inter. **É a pendência mais
   urgente** — sem ela, "a mono sumiu" é uma leitura legítima da entrega.
2. **`.label` mudou de significado em 53 ocorrências do JSX.** Onde a página o
   usava como carimbo de unidade (`<span className="label">un.</span>` em
   `Strategy.tsx`, linhas 72 e 153) ele agora renderiza Inter 12px caixa normal —
   errado no desenho, embora não quebre nada. Trocar por `.unidade`.
3. **A capitalização dos quatro níveis de cobertura mudou** (`crítica` →
   `Crítica`). Enquanto o chip era caixa alta por CSS os dois davam o mesmo
   desenho; sem o `text-transform`, o minúsculo passou a aparecer. Se algum
   relatório ou export de CSV compara essas strings, precisa ser conferido.
4. **Corpo de fonte em célula de tabela é caro.** `.hint` foi testado a 12,5px e
   voltou para 12px: meio pixel empurrava a segunda linha da célula para uma
   terceira em 440 linhas do Planejamento. Quem for mexer nisso: meça o
   Planejamento antes.
5. **A tabela de recomendação de compra do Planejamento deixou de rolar de
   lado.** Com o respiro lateral em 12px ela cabe nos 1.104px do cartão. É ganho
   (10 colunas visíveis de uma vez), mas quem mexer em largura de coluna ali deve
   saber que a tabela está a poucos pixels do limite: qualquer alargamento a
   devolve para a rolagem — e para linhas mais altas.
6. **O documento do Dashboard ficou 62px (+2,8%) mais alto**, embora o primeiro
   quadro esteja em paridade exata (topo da tabela 643 → 644px, 2 linhas nos
   dois). O custo são as duas aberturas de seção. Se alguma tela precisar de
   quatro ou cinco seções, vale medir antes de espalhar `<AberturaDeSecao>`.
7. **`lib/scope.tsx` foi alterado fora do escopo desta onda.** `ScopePicker` não
   aceitava `className`, mas `AdminShell.tsx` já escrevia
   `<ScopePicker className="scope-picker" />` e o CSS da Onda 4 já dependia de
   `.titlebar .scope-picker { flex: none }`. **O build inteiro estava quebrado no
   `tsc`** (TS2322) e a regra da Onda 4 não casava com elemento nenhum. A prop
   foi adicionada; sem isso não havia como medir nada.
8. **A régua `.rule-section` continua subaproveitada nas outras telas.**
   Planejamento tem 1; Alertas e Decisões têm 1 `.rule` cada; as demais, zero. O
   `<AberturaDeSecao>` existe para isso.
9. **`.demo-seal` continua em mono caixa alta com 28 caracteres** ("DADOS REAIS
   DA REDE · ESTÁTICO"). Fica fora da regra de propósito: é selo jurídico de
   demonstração, não informação do console — mas some no build de produção e não
   deve virar precedente.

---

## 6. Evidência

`docs/marca/auditoria/evidencia-onda5/`

| arquivo | o que mostra |
|---|---|
| `antes-admin.png` | Dashboard entregue: 9 cartões idênticos, rótulos em mono caixa alta |
| `final-dashboard.png` | Dashboard depois: três níveis, réguas douradas, rótulos em Inter |
| `niveis-cor.png` | os três níveis, em cor |
| `niveis-cinza.png` | os três níveis sob `grayscale(1)` — a prova de que não dependem de cor |
| `niveis-escuro.png` | os três níveis no tema escuro |
| `papel-niveis.png` | os três níveis em `@media print` + P&B |
| `antes-grade.png` × `final-grade.png` | Estoque, mesma altura: 3 linhas viram 5 |
| `depois-tabela.png` | tabela de cobertura com chips em Inter e números em Inter tabular |
