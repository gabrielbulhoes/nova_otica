# Contraste e acessibilidade — Design System NANOFLOW no Nova Ótica

**Fonte de verdade da paleta:** `/docs/marca/nanoflow-manual.html`
**Escopo:** console Nova Ótica (`apps/web`), tema claro (padrão) e tema escuro (opção).
**Norma:** WCAG 2.1 — critérios 1.4.3 (Contraste mínimo), 1.4.11 (Contraste de elementos não textuais) e 1.4.1 (Uso de cor).
**Data do cálculo:** 2026-07-31.

---

## Como estes números foram obtidos

Nada aqui foi estimado a olho. Cada razão foi calculada pela fórmula da WCAG 2.1:

1. Cada canal sRGB é normalizado (`c/255`) e linearizado
   (`c/12.92` se `c ≤ 0.03928`, senão `((c+0.055)/1.055)^2.4`).
2. Luminância relativa `L = 0.2126·R + 0.7152·G + 0.0722·B`.
3. Razão `(L_claro + 0.05) / (L_escuro + 0.05)`.

Cores com alfa (`--linha`, `--hover`, fundos de badge, `opacity`) **não têm contraste próprio**:
foram compostas sobre o fundo real em que aparecem antes do cálculo, exatamente como o
navegador faz. O hex composto está indicado em cada linha — é ele que o olho vê.

A simulação de daltonismo usa o método Viénot–Brettel–Mollon (1999) e a diferença perceptual
é reportada em ΔE\*ab (CIE76), que mede distância de cor no espaço Lab — a métrica correta
para "dá para separar estes dois estados?", já que a razão WCAG só mede claro/escuro.

### Limiares usados

| Classe | Limiar | Onde se aplica |
| --- | --- | --- |
| **AA texto normal** | ≥ 4.5:1 | Todo texto abaixo de 24px, ou abaixo de 18.66px em negrito. É a régua padrão do produto: corpo, tabela, badge, rótulo em mono, `.hint`, link. |
| **AA texto grande** | ≥ 3.0:1 | Somente ≥ 24px em peso normal, ou ≥ 18.66px em negrito. No Nova Ótica isso cobre `h1` (26px), `.stat .value` (27px) e `.kpi` (27px). **Não cobre** `h2` (20px), `h3`/`.section-title` (18px) nem nada em mono. |
| **AA componente** | ≥ 3.0:1 | Borda, filete, traço de ícone, indicador de foco, contorno de campo — tudo que carrega informação sem ser texto. |
| **AAA** | ≥ 7.0:1 | Não é meta do projeto, mas está marcado onde acontece, porque dá folga para uso em fonte pequena. |
| **REPROVA** | < 3.0:1 | Não pode carregar informação em nenhum tamanho nem como componente. Só decoração pura, sobreposta a algo que já comunica. |

> Observação sobre a régua de "texto grande": o briefing da equipe escreveu
> "≥18.66px / bold ≥14px". A definição normativa da WCAG é **18pt (≈24px) normal ou
> 14pt (≈18.66px) negrito**. Este documento usa a definição normativa, que é a mais
> restritiva — o que passa aqui passa em auditoria.

---

## RESUMO EXECUTIVO

Foram avaliados **140 pares únicos** de cor de texto × superfície, mais 20 pares de
borda/filete e 15 combinações compostas reais do produto (badge, banner, botão).

| Resultado | Pares |
| --- | --- |
| AAA (≥7.0) | 43 |
| AA texto normal (4.5 – 6.99) | 34 |
| Só texto grande / componente (3.0 – 4.49) | 11 |
| **REPROVADOS (< 3.0)** | **52** |

**63 pares reprovam para texto normal** (tudo abaixo de 4.5:1) — é este o número que
importa no dia a dia, porque quase todo texto do console é menor que 24px.

### Os três riscos mais graves

**1. As cores de estado operacional colapsam sob deuteranopia — e colapsam justamente
entre "saudável" e "crítico".**
`--verde #3E5E32` (saudável) e `--terra #8E2F1E` (crítico) têm ΔE 61.3 na visão tricromática
e **ΔE 8.8 na deuteranopia**: viram praticamente a mesma cor. São os dois estados
*opostos* do sistema. Um gerente de loja deuteranope olhando a coluna de cobertura vê
o mesmo tom em "cobertura crítica" e em "cobertura saudável". Cerca de 8% dos homens
têm alguma deficiência de visão de cores; com 19 lojas isso é uma quase certeza estatística
na base de usuários. Agrava: a razão de luminância **entre** os dois estados é 1.11:1,
ou seja, o problema também existe em impressão P&B (e `Reports.tsx` tem `@media print`).

**2. Os gráficos de BI estão com a paleta antiga, calibrada para fundo azul-escuro, sobre
o novo fundo branco-papel.**
`transforms.ts` ainda define `TEXT = '#e8edf7'` (rótulo de série, rótulo de gauge, rótulo de
pizza) e `AXIS_COLOR = '#9aa9c7'`. Sobre `#F6F2E9`: **1.05:1** e **2.12:1**. O rótulo é
literalmente invisível. Nenhuma das 7 cores de série da `PALETTE` chega a 3.0:1 sobre o
branco-papel (a melhor é `#4f8cff` com 2.88:1). Além do contraste, é paleta fora da marca.

**3. O ouro puro `#C9A227` sobre o branco-papel dá 2.17:1 — e o `--ouro-dark` que o
substitui só passa sobre o fundo branco puro.**
`--ouro-dark #8A6914` dá 4.57:1 sobre `#F6F2E9` (passa AA por 0.07 de margem), mas cai para
**3.74:1 sobre `--panel-2 #E4DCC9`** e **4.32:1 sobre a lavagem de hover** — e reprova nos dois.
Como `--accent` é `--ouro-dark` e é a cor de todo link e de todo `.btn` contornado, qualquer
link ou botão que caia dentro de um painel elevado ou de uma linha em hover perde a
conformidade sem ninguém perceber.

---

## 1. Paleta de referência

Tokens do manual (camada 1). **Só estes carregam valor de marca.**

| Token | Hex | Papel no manual |
| --- | --- | --- |
| `--preto` | `#0D0B08` | Fundo de casos específicos: papelaria, editorial, painel denso |
| `--carvao` | `#17140F` | Card sobre preto · elevação 1 |
| `--grafite` | `#221D15` | Elevação 2, borda sobre preto |
| `--branco` | `#F6F2E9` | **Fundo preferencial · padrão da interface** |
| `--branco2` | `#E4DCC9` | Superfície secundária |
| `--ouro` | `#C9A227` | Marca, CTA, decisão — preenchimento, traço, filete |
| `--ouro-lux` | `#F0D482` | Realce sobre fundo escuro |
| `--ouro-dark` | `#8A6914` | Hover · **texto de ênfase sobre branco** |
| `--tinta` | `#2A2416` | Texto principal sobre claro |
| `--tinta-suave` | `#5C543E` | Texto secundário sobre claro |
| `--linha` | `rgba(201,162,39,.32)` | Filete dourado |
| `--linha2` | `rgba(246,242,233,.10)` | Filete neutro sobre escuro |
| `--linha-clara` | `rgba(13,11,8,.13)` | Filete neutro sobre claro |

### Cores que NÃO estão no manual — precisam de decisão de marca

O manual da NANOFLOW **não define cor de estado operacional**. O `styles.css` derivou seis
tons do eixo terroso para atender às páginas. Eles funcionam em contraste (ver tabelas), mas
são invenção do time, não da marca. Precisam de aprovação explícita de quem responde pela
identidade antes de virarem canônicos:

| Token derivado | Hex | Estado |
| --- | --- | --- |
| `--verde` / `--verde-claro` | `#3E5E32` / `#A8CC85` | saudável |
| `--ambar` / `--ambar-claro` | `#7E5111` / `#F0D482` | atenção |
| `--terra` / `--terra-claro` | `#8E2F1E` / `#E39074` | crítico / ruptura |
| `--accent-press` | `#6D520F` | estado pressionado do botão |

**Problema já identificado:** `--ambar-claro` é literalmente o mesmo hex que `--ouro-lux`
(`#F0D482`). No tema escuro, o estado "atenção" e a cor de marca são a mesma cor. Ou o
estado ganha tom próprio, ou o manual precisa dizer que atenção e marca compartilham o
mesmo dourado — mas isso tem que ser decisão, não coincidência.

---

## 2. TEMA CLARO — texto sobre branco-papel `#F6F2E9`

É a superfície padrão de todo o console.

| Cor de texto | Hex | Razão | Veredito | Para que serve |
| --- | --- | ---: | --- | --- |
| `--preto` | `#0D0B08` | **17.59** | AAA | Texto sobre superfície dourada e impressão. Evitar como corpo: o manual reserva a tinta. |
| `--carvao` | `#17140F` | **16.44** | AAA | Superfície escura, não texto. Passa se usado. |
| `--grafite` | `#221D15` | **14.98** | AAA | Superfície escura, não texto. Passa se usado. |
| `--tinta` | `#2A2416` | **13.80** | AAA | **Corpo, título, tabela, valor de indicador.** Padrão do produto. |
| `--terra` | `#8E2F1E` | **7.30** | AAA | Texto de estado crítico / ruptura. Livre em qualquer tamanho. |
| `--tinta-suave` | `#5C543E` | **6.73** | AA | **Texto secundário, `.muted`, `.hint`, rótulo em mono 9.5px.** Folga suficiente para 9.5px. |
| `--verde` | `#3E5E32` | **6.59** | AA | Texto de estado saudável. |
| `--accent-press` | `#6D520F` | **6.56** | AA | Estado pressionado; serve como texto se preciso. |
| `--ambar` | `#7E5111` | **6.12** | AA | Texto de estado atenção. |
| `--ouro-dark` | `#8A6914` | **4.57** | AA (margem de 0.07) | **`--accent`: link, `.eyebrow`, `.btn` contornado, contorno de foco.** Passa, mas sem folga — ver §4.1. |
| placeholder `rgba(92,84,62,.7)` | `#8A8371` | **3.36** | Só componente | Reprova como texto. Placeholder é texto. Ver Onda 2, item 6. |
| `--terra-claro` | `#E39074` | **2.21** | **REPROVA** | Só tema escuro. Nunca sobre claro. |
| `--ouro` | `#C9A227` | **2.17** | **REPROVA** | **Nunca como texto sobre claro.** Preenchimento, filete, traço de ícone grande, superfície. |
| `--verde-claro` | `#A8CC85` | **1.61** | **REPROVA** | Só tema escuro. |
| `--ouro-lux` | `#F0D482` | **1.30** | **REPROVA** | Só tema escuro. Sobre branco é praticamente invisível. |
| `--branco2` | `#E4DCC9` | **1.22** | **REPROVA** | É superfície, não texto. |

---

## 3. TEMA CLARO — texto sobre as outras superfícies claras

### 3.1 Sobre `--panel-2` / `--branco2` `#E4DCC9`

Aparece em `.badge.blue`, `.segmented` ativo e cards elevados.

| Cor de texto | Hex | Razão | Veredito | Para que serve |
| --- | --- | ---: | --- | --- |
| `--preto` | `#0D0B08` | **14.39** | AAA | Livre. |
| `--tinta` | `#2A2416` | **11.29** | AAA | **Padrão desta superfície.** É o que `.badge.blue` já usa. |
| `--terra` | `#8E2F1E` | **5.97** | AA | Estado crítico sobre painel elevado. |
| `--tinta-suave` | `#5C543E` | **5.51** | AA | Texto secundário. |
| `--verde` | `#3E5E32` | **5.39** | AA | Estado saudável. |
| `--accent-press` | `#6D520F` | **5.37** | AA | OK. |
| `--ambar` | `#7E5111` | **5.01** | AA | Estado atenção. |
| `--ouro-dark` | `#8A6914` | **3.74** | **REPROVA texto normal** — só ≥24px | **Armadilha.** É a cor de link e de `.btn` contornado. Link dentro de painel elevado reprova. |
| `--terra-claro` | `#E39074` | **1.81** | **REPROVA** | Só escuro. |
| `--ouro` | `#C9A227` | **1.77** | **REPROVA** | Nunca texto. |
| `--verde-claro` | `#A8CC85` | **1.32** | **REPROVA** | Só escuro. |
| `--ouro-lux` | `#F0D482` | **1.06** | **REPROVA** | Invisível. |

### 3.2 Sobre a lavagem de hover `--hover` = `rgba(201,162,39,.08)` sobre branco → `#F2ECD9`

É o fundo de linha de tabela em hover e de `.tile:hover`.

| Cor de texto | Razão | Veredito |
| --- | ---: | --- |
| `--tinta` `#2A2416` | **13.03** | AAA |
| `--terra` `#8E2F1E` | **6.89** | AA |
| `--tinta-suave` `#5C543E` | **6.36** | AA |
| `--verde` `#3E5E32` | **6.22** | AA |
| `--accent-press` `#6D520F` | **6.20** | AA |
| `--ambar` `#7E5111` | **5.78** | AA |
| `--ouro-dark` `#8A6914` | **4.32** | **REPROVA texto normal** |
| `--ouro` `#C9A227` | **2.04** | **REPROVA** |

**Consequência prática:** um link ou botão contornado em uma linha de tabela sai de
conforme (4.57) para não conforme (4.32) **só por passar o mouse**. Sob o dedo do usuário
o texto não some, mas a auditoria falha e a legibilidade real cai.

### 3.3 Sobre superfície dourada `--ouro` `#C9A227`

`.btn.solid`, chips de marca, faixas.

| Cor de texto | Razão | Veredito | Para que serve |
| --- | ---: | --- | --- |
| `--preto` `#0D0B08` | **8.12** | AAA | **Único texto recomendado sobre ouro.** É o que `.btn.solid` já usa — está correto. |
| `--carvao` `#17140F` | **7.59** | AAA | Alternativa válida. |
| `--grafite` `#221D15` | **6.92** | AA | Válido. |
| `--tinta` `#2A2416` | **6.37** | AA | Válido. |
| `--terra` `#8E2F1E` | **3.37** | Só ≥24px / componente | Ícone sobre botão dourado, não texto. |
| `--tinta-suave` `#5C543E` | **3.11** | Só ≥24px / componente | Evitar. |
| `--verde` `#3E5E32` | **3.04** | Só ≥24px / componente | Evitar. |
| `--ambar` `#7E5111` | **2.83** | **REPROVA** | Nunca. |
| `--branco` `#F6F2E9` | **2.17** | **REPROVA** | **Nunca texto claro sobre ouro.** Erro comum — parece legível e não é. |
| `--ouro-dark` `#8A6914` | **2.11** | **REPROVA** | Nunca. |
| `--branco2` `#E4DCC9` | **1.77** | **REPROVA** | Nunca. |
| `--ouro-lux` `#F0D482` | **1.66** | **REPROVA** | Nunca. |

### 3.4 Sobre `--ouro-lux` `#F0D482` (fundo de `.btn.solid:hover`)

| Cor de texto | Razão | Veredito |
| --- | ---: | --- |
| `--preto` `#0D0B08` | **13.52** | AAA — é o que o CSS já usa, correto |
| `--tinta` `#2A2416` | **10.60** | AAA |
| `--terra` `#8E2F1E` | **5.61** | AA |
| `--tinta-suave` `#5C543E` | **5.17** | AA |
| `--verde` `#3E5E32` | **5.06** | AA |
| `--ambar` `#7E5111` | **4.70** | AA |
| `--ouro-dark` `#8A6914` | **3.51** | Só ≥24px |
| `--ouro` `#C9A227` | **1.66** | **REPROVA** |
| `--branco` `#F6F2E9` | **1.30** | **REPROVA** |

---

## 4. TEMA ESCURO — texto sobre preto, carvão e grafite

O manual autoriza o escuro em painel de alta densidade (a tela de BI) e como escolha do
usuário. As três superfícies escuras são quase idênticas em luminância, então as tabelas
convergem — o que muda é a margem.

### 4.1 Sobre `--preto` `#0D0B08`

| Cor de texto | Hex | Razão | Veredito | Para que serve |
| --- | --- | ---: | --- | --- |
| `--branco` | `#F6F2E9` | **17.59** | AAA | **Corpo e título no escuro.** |
| `--branco2` | `#E4DCC9` | **14.39** | AAA | Texto secundário forte. |
| `--ouro-lux` | `#F0D482` | **13.52** | AAA | **Ênfase, número-herói, link no escuro.** |
| `--ambar-claro` | `#F0D482` | **13.52** | AAA | Idêntico ao anterior — ver pendência de marca. |
| `--verde-claro` | `#A8CC85` | **10.89** | AAA | Estado saudável. |
| `--ouro` | `#C9A227` | **8.12** | AAA | **Passa como texto no escuro** (ao contrário do claro). Ainda assim, o manual prefere o ouro como traço; use `--ouro-lux` para texto. |
| `--terra-claro` | `#E39074` | **7.96** | AAA | Estado crítico. |
| `--muted` `rgba(228,220,201,.72)` | `#A8A193` | **7.69** | AAA | Texto secundário, `.hint`. Folga boa para 9.5px. |
| placeholder `rgba(228,220,201,.45)` | `#6E695F` | **3.60** | **REPROVA texto normal** | Placeholder é texto. Ver Onda 2, item 6. |
| `--ouro-dark` | `#8A6914` | **3.85** | Só ≥24px / componente | **Não usar como texto no escuro.** Serve de borda. |
| `--ambar` | `#7E5111` | **2.88** | **REPROVA** | Só tema claro. |
| `--verde` | `#3E5E32` | **2.67** | **REPROVA** | Só tema claro. |
| `--tinta-suave` | `#5C543E` | **2.61** | **REPROVA** | Só tema claro. |
| `--terra` | `#8E2F1E` | **2.41** | **REPROVA** | Só tema claro. |
| `--tinta` | `#2A2416` | **1.28** | **REPROVA** | Só tema claro. |

### 4.2 Sobre `--carvao` `#17140F` (card, elevação 1)

| Cor de texto | Razão | Veredito |
| --- | ---: | --- |
| `--branco` `#F6F2E9` | **16.44** | AAA |
| `--branco2` `#E4DCC9` | **13.45** | AAA |
| `--ouro-lux` `#F0D482` | **12.63** | AAA |
| `--verde-claro` `#A8CC85` | **10.18** | AAA |
| `--ouro` `#C9A227` | **7.59** | AAA |
| `--terra-claro` `#E39074` | **7.44** | AAA |
| `--muted` → `#ABA495` | **7.18** | AAA |
| `--ouro-dark` `#8A6914` | **3.60** | Só componente |
| `--ambar` `#7E5111` | **2.69** | **REPROVA** |
| `--verde` `#3E5E32` | **2.49** | **REPROVA** |
| `--tinta-suave` `#5C543E` | **2.44** | **REPROVA** |
| `--terra` `#8E2F1E` | **2.25** | **REPROVA** |
| `--tinta` `#2A2416` | **1.19** | **REPROVA** |

### 4.3 Sobre `--grafite` `#221D15` (elevação 2)

É a superfície escura mais clara — as margens encolhem, mas nada muda de veredito.

| Cor de texto | Razão | Veredito |
| --- | ---: | --- |
| `--branco` `#F6F2E9` | **14.98** | AAA |
| `--branco2` `#E4DCC9` | **12.26** | AAA |
| `--ouro-lux` `#F0D482` | **11.51** | AAA |
| `--verde-claro` `#A8CC85` | **9.28** | AAA |
| `--ouro` `#C9A227` | **6.92** | AA |
| `--terra-claro` `#E39074` | **6.78** | AA |
| `--muted` → `#AEA797` | **6.55** | AA |
| `--ouro-dark` `#8A6914` | **3.28** | Só componente |
| `--ambar` `#7E5111` | **2.45** | **REPROVA** |
| `--verde` `#3E5E32` | **2.27** | **REPROVA** |
| `--tinta-suave` `#5C543E` | **2.23** | **REPROVA** |
| `--terra` `#8E2F1E` | **2.05** | **REPROVA** |

**Regra de bolso que resume as três tabelas:** no escuro, use **apenas** os tons claros
(`--branco`, `--branco2`, `--ouro-lux`, `--verde-claro`, `--terra-claro`, `--ouro`).
Todo tom escuro da paleta clara (`--tinta`, `--tinta-suave`, `--verde`, `--ambar`, `--terra`,
`--ouro-dark`) reprova em todas as três superfícies escuras. Não há exceção.

---

## 5. Bordas, filetes, traços e foco (limiar 3.0:1)

Aqui mora o problema estrutural do tema: **os filetes do manual são decorativos por
luminância, não informativos.** O manual desenha para densidade visual e refinamento;
a WCAG 1.4.11 exige 3.0:1 para qualquer elemento não textual que carregue informação.

| Elemento | Cor composta | Sobre | Razão | Veredito | Consequência |
| --- | --- | --- | ---: | --- | --- |
| Contorno de foco `:focus-visible` (claro) | `#8A6914` | `#F6F2E9` | **4.57** | **PASSA** | Foco visível está correto no tema claro. |
| Traço de ícone neutro | `#5C543E` | `#F6F2E9` | **6.73** | **PASSA** | Ícone em `--tinta-suave` é seguro. |
| Traço de ícone dourado (escuro) | `#C9A227` | `#0D0B08` | **8.12** | **PASSA** | Ícone em ouro só funciona no escuro. |
| Traço de ícone dourado (escuro) | `#C9A227` | `#17140F` | **7.59** | **PASSA** | — |
| Traço de ícone dourado (escuro) | `#C9A227` | `#221D15` | **6.92** | **PASSA** | — |
| **Traço de ícone dourado (claro)** | `#C9A227` | `#F6F2E9` | **2.17** | **REPROVA** | Ícone de 1,3px em ouro puro sobre branco-papel **não é percebido**. Ícone que carrega significado precisa de `--ouro-dark` ou `--tinta-suave`. |
| `--border-strong` (claro) | `#BEBBB3` | `#F6F2E9` | **1.72** | **REPROVA** | Borda de campo de formulário. Campo sem borda perceptível é falha de 1.4.11. |
| `--border` / `--linha-clara` (claro) | `#D8D4CC` | `#F6F2E9` | **1.32** | **REPROVA** | Separador de item. Aceitável só como decoração — não pode ser a única marcação de estrutura. |
| Anel de foco `--ring` | `#E7D7A7` | `#F6F2E9` | **1.28** | **REPROVA** | O `box-shadow` de foco no campo é invisível. Quem segura o foco é o `border-color: --ouro-dark` (4.57) — mantenha-o. |
| Filete dourado `--linha` (claro) | `#E8D8AB` | `#F6F2E9` | **1.26** | **REPROVA** | Régua hierárquica. Decorativa por natureza — ver nota abaixo. |
| `--border-strong` (escuro) | `#48453F` | `#17140F` | **1.92** | **REPROVA** | Borda de campo no escuro. Mesmo problema. |
| `--border-strong` (escuro) | `#403E3A` | `#0D0B08` | **1.84** | **REPROVA** | — |
| Filete dourado (escuro) | `#504117` | `#17140F` | **1.85** | **REPROVA** | — |
| Filete dourado (escuro) | `#493B12` | `#0D0B08` | **1.80** | **REPROVA** | — |
| `--border` / `--linha2` (escuro) | `#2D2A25` | `#17140F` | **1.29** | **REPROVA** | — |
| `--border` / `--linha2` (escuro) | `#24221F` | `#0D0B08` | **1.24** | **REPROVA** | — |
| `--panel-2` contra fundo (claro) | `#E4DCC9` | `#F6F2E9` | **1.22** | **REPROVA** | Card elevado não se distingue do fundo por luminância. Precisa de filete ou de espaço. |
| Grafite contra preto | `#221D15` | `#0D0B08` | **1.17** | **REPROVA** | Elevação 2 quase não existe. |
| Grafite contra carvão | `#221D15` | `#17140F` | **1.10** | **REPROVA** | Elevação 2 vs elevação 1: indistinguíveis. |
| Carvão contra preto | `#17140F` | `#0D0B08` | **1.07** | **REPROVA** | Elevação 1 quase não existe. |

**Nota sobre a régua hierárquica.** Não estou pedindo que o filete dourado suba para 3.0:1
— isso destruiria a linguagem do manual, e um filete que só *abre e fecha seção* é decoração
no sentido da WCAG (o título já comunica a seção). O que **não pode** é o filete ser a única
coisa que informa. Sempre que uma borda distinguir um estado (campo com erro, card
selecionado, linha ativa), ela precisa de 3.0:1 **ou** de um segundo sinal: rótulo, ícone,
mudança de peso, preenchimento.

**Nota sobre elevação.** O manual constrói hierarquia por **filete de 1px, não por sombra**
(o `styles.css` já respeita isso: `--shadow-card: none`). Mas as três superfícies escuras
diferem em no máximo 1.17:1 entre si, e o filete que deveria separá-las dá 1.24:1. No tema
escuro, o resultado é uma superfície visualmente única. Isso não é violação de WCAG por si
só, mas destrói a leitura da tela de BI, que é justamente a tela mais densa do produto.
Ver Onda 2, item 5.

---

## 6. Componentes reais do produto (pares compostos)

Estes são os pares que existem hoje no `styles.css`, com o alfa já resolvido. **Todos passam.**
Esta parte do sistema está correta e não deve ser mexida sem recalcular.

| Componente | Texto | Fundo composto | Razão | Veredito |
| --- | --- | --- | ---: | --- |
| `.badge.blue` informativo (claro) | `#2A2416` | `#E4DCC9` | **11.29** | AAA |
| `.badge.red` crítico (claro) | `#8E2F1E` | `#EBDDD3` | **6.12** | AA |
| `.badge.gray` inerte (claro) | `#5C543E` | `#F6F2E9` | **6.73** | AA |
| `.banner.ok` (claro) | `#3E5E32` | `#E5E5D9` | **5.79** | AA |
| `.banner.warn` (claro) | `#7E5111` | `#F2EAD6` | **5.69** | AA |
| `.badge.green` saudável (claro) | `#3E5E32` | `#E0E0D3` | **5.54** | AA |
| `.badge.amber` atenção (claro) | `#7E5111` | `#EFE5CA` | **5.45** | AA |
| `.badge.blue` informativo (escuro) | `#F6F2E9` | `#221D15` | **14.98** | AAA |
| `.badge.amber` atenção (escuro) | `#F0D482` | `#2F260E` | **10.28** | AAA |
| `.badge.green` saudável (escuro) | `#A8CC85` | `#23261A` | **8.54** | AAA |
| `.badge.gray` inerte (escuro) | `#A8A193` | `#0D0B08` | **7.69** | AAA |
| `.badge.red` crítico (escuro) | `#E39074` | `#2B1E17` | **6.56** | AA |
| `.btn.solid` primário | `#0D0B08` | `#C9A227` | **8.12** | AAA |
| `.btn.solid:hover` | `#0D0B08` | `#F0D482` | **13.52** | AAA |
| `.btn.danger:hover` | `#F6F2E9` | `#8E2F1E` | **7.30** | AAA |
| `.btn:active` | `#F6F2E9` | `#6D520F` | **6.56** | AA |
| `.btn` contornado (repouso) | `#8A6914` | `#F6F2E9` | **4.57** | AA sem folga — ver §3.1 e §3.2 |

### A exceção: `opacity` em estado desabilitado

`.btn:disabled { opacity: 0.5 }` compõe o texto com o fundo e derruba o contraste:

| Variante desabilitada | Cor efetiva | Sobre | Razão | Veredito |
| --- | --- | --- | ---: | --- |
| `.btn` contornado desabilitado | `#C0AE7F` | `#F6F2E9` | **1.97** | **REPROVA** |
| `.btn.ghost` desabilitado | `#908B80` | `#F6F2E9` | **3.04** | Limítrofe |

A WCAG 2.1 isenta controles desabilitados do 1.4.3, então isto **não é não conformidade**.
Mas 1.97:1 significa que o operador não consegue *ler o rótulo* do botão para entender o que
está indisponível — e no console de estoque há vários botões que só ficam disponíveis
condicionalmente. É problema de usabilidade, não de norma. Ver Onda 2, item 7.

---

## 7. Os casos sensíveis, nomeados

### 7.1 Ouro `#C9A227` sobre branco-papel `#F6F2E9` → **2.17:1**

**Reprova por larga margem** — precisaria de 4.5 e tem menos da metade. Reprova até o
limiar de componente (3.0).

**Consequência prática, em ordem de gravidade:**

1. **Texto em ouro puro sobre claro é proibido, em qualquer tamanho.** Não existe tamanho
   que salve: o limiar de texto grande também é 3.0 e o par dá 2.17.
2. **Ícone de traço 1,3px em ouro puro sobre branco-papel também está proibido** se o ícone
   carregar significado (status, ação, navegação). A grade de ícones do manual é desenhada
   sobre `--carvao` — lá o ouro dá 7.59:1 e funciona. Sobre o branco-papel, não.
   Ícone informativo no tema claro: `--ouro-dark` (4.57) ou `--tinta-suave` (6.73).
3. **O ouro puro continua sendo o ouro da marca no tema claro** — apenas em papéis onde
   a WCAG não se aplica: preenchimento de superfície (`.btn.solid`, que é o caso correto),
   filete de abertura de seção, malha Nano, e o traço do símbolo em tamanho grande onde
   ele é logotipo, não informação.
4. A substituição `--ouro-dark #8A6914` (4.57) resolve o texto, **mas só sobre o branco puro**
   — ver 7.2.

### 7.2 `--ouro-dark #8A6914`: passa, mas por 0.07

| Sobre | Razão | Veredito |
| --- | ---: | --- |
| `--branco` `#F6F2E9` | **4.57** | AA — margem de 0.07 |
| `--hover` `#F2ECD9` | **4.32** | **REPROVA** |
| `--branco2` `#E4DCC9` | **3.74** | **REPROVA** |
| `--ouro-lux` `#F0D482` | **3.51** | **REPROVA** |
| `--ouro` `#C9A227` | **2.11** | **REPROVA** |

Como `--accent: var(--ouro-dark)` é a cor de **todo link** (`a { color: var(--accent) }`) e do
`.btn` contornado, o token está a um `background` de distância de reprovar. Ele é seguro
**exclusivamente sobre `#F6F2E9`**.

**Falha concreta já existente no produto** (não é hipótese — está na tela hoje):

| Onde | Par | Razão | Veredito |
| --- | --- | ---: | --- |
| `Dashboard.tsx` linha 65 — link "Ver alertas →" dentro de `.banner.warn` | `#8A6914` sobre `#F2EAD6` | **4.25** | **REPROVA** |
| Qualquer link dentro de `.banner.ok` | `#8A6914` sobre `#E5E5D9` | **4.02** | **REPROVA** |

É o banner de ruptura do painel principal — a informação mais importante do console, com o
link para a ação. Ver Onda 2, item 2.

### 7.3 `--ouro-lux #F0D482` — é cor de tema escuro, ponto

| Sobre | Razão |
| --- | ---: |
| `--preto` | **13.52** AAA |
| `--carvao` | **12.63** AAA |
| `--grafite` | **11.51** AAA |
| `--branco` | **1.30** REPROVA |
| `--branco2` | **1.06** REPROVA |

1.30:1 sobre o branco-papel é essencialmente invisível — amarelo claro sobre creme.
Excelente no escuro, catastrófico no claro. Como o `styles.css` só o usa dentro de
`[data-tema='escuro']`, hoje está correto; o risco é alguém copiar uma regra do bloco escuro
para o claro. Ver Onda 2, item 3.

### 7.4 `--tinta-suave #5C543E` sobre branco → **6.73:1**

**Passa AA com folga confortável** e chega perto de AAA. É o token mais bem calibrado do
sistema: sustenta `.muted`, `.hint` e `.stat .hint` mesmo em 9.5px em mono caixa alta.

Duas ressalvas:
- Sobre `--branco2` cai para **5.51** — ainda passa.
- O **placeholder** o dilui a 70% (`rgba(92,84,62,.7)` = `#8A8371`), o que derruba para
  **3.36:1** e reprova. Placeholder é texto e conta para 1.4.3.

### 7.5 Neutros sobre preto / carvão / grafite

| Neutro | sobre preto | sobre carvão | sobre grafite | Leitura |
| --- | ---: | ---: | ---: | --- |
| `--branco` `#F6F2E9` | **17.59** | **16.44** | **14.98** | AAA em todas. Texto principal do escuro. |
| `--branco2` `#E4DCC9` | **14.39** | **13.45** | **12.26** | AAA em todas. Texto secundário forte. |
| `--muted` (branco2 @72%) | **7.69** | **7.18** | **6.55** | AAA / AA. Sustenta 9.5px. |
| `--tinta-suave` `#5C543E` | **2.61** | **2.44** | **2.23** | **REPROVA em todas.** |
| `--tinta` `#2A2416` | **1.28** | **1.19** | **1.09** | **REPROVA em todas.** |

Os neutros claros são folgados nas três superfícies — o tema escuro tem margem de sobra
para texto. O que não tem margem nenhuma é a **separação entre as superfícies** (1.07 a 1.17),
tratada em §5.

---

## 8. Daltonismo: a paleta quente monocromática é um risco real aqui

O produto usa cor para carregar significado operacional — ruptura, estoque baixo, saudável,
excesso. Uma paleta quente monocromática (verde-oliva, bronze, óxido, ouro) tem todos os
tons no mesmo setor do espectro, que é exatamente o setor que a deuteranopia e a protanopia
comprimem.

### 8.1 Como as cores de estado são vistas

| Estado | Cor real | Deuteranopia | Protanopia |
| --- | --- | --- | --- |
| saudável | `#3E5E32` | `#555533` | `#5A5A32` |
| atenção | `#7E5111` | `#5E5E10` | `#565611` |
| **crítico / ruptura** | `#8E2F1E` | `#4B4B1C` | `#3A3A1E` |
| marca (ouro) | `#C9A227` | `#ADAD26` | `#A6A627` |

Repare: saudável `#555533` e crítico `#4B4B1C` sob deuteranopia. São o mesmo verde-oliva
escuro com 10 pontos de diferença em cada canal.

### 8.2 Distância perceptual entre estados (ΔE\*ab, CIE76)

| Par | Visão tricromática | Deuteranopia | Protanopia |
| --- | ---: | ---: | ---: |
| **saudável × crítico** | 61.3 | **8.8** | 15.4 |
| saudável × atenção | 40.2 | 21.9 | **14.3** |
| atenção × crítico | 28.0 | 16.0 | 23.9 |
| saudável × marca | 58.1 | 56.1 | 47.9 |
| crítico × marca | 59.4 | 53.2 | 62.0 |

E no tema escuro:

| Par | Visão tricromática | Deuteranopia | Protanopia |
| --- | ---: | ---: | ---: |
| **saudável × crítico** | 54.0 | **9.4** | 22.2 |
| saudável × atenção | 27.7 | 17.4 | **10.0** |
| atenção × crítico | 37.9 | 25.0 | 31.9 |

**Leitura:** ΔE ≈ 2.3 é o limiar de percepção de diferença em condições ideais; para
elementos pequenos e separados na tela (um badge aqui, outro três linhas abaixo), a
literatura de sinalização trabalha com ΔE ≳ 20 para separação confiável **sem comparação
lado a lado**. Sob esse critério:

- **saudável × crítico falha nos dois temas** (8.8 e 9.4 na deuteranopia). É o pior caso
  possível: os dois estados que exigem ações opostas.
- **saudável × atenção falha na protanopia** (14.3 claro, 10.0 escuro).
- **atenção × crítico é limítrofe** (16.0 na deuteranopia claro).
- O ouro da marca permanece bem separado de tudo (ΔE 38–62 em todos os cenários) — o ouro
  não é o problema. O problema são os três estados entre si.

### 8.3 O agravante da luminância

A razão WCAG **entre** as cores de estado (não contra o fundo, mas uma contra a outra) é:

| Par | Tema claro | Tema escuro |
| --- | ---: | ---: |
| saudável × atenção | 1.08 | 1.24 |
| saudável × crítico | 1.11 | 1.37 |
| atenção × crítico | 1.19 | 1.70 |

Todas próximas de 1.0, o que significa que os três estados têm **praticamente a mesma
luminância**. Consequências: em escala de cinza (impressão, `@media print` de `Reports.tsx`,
captura de tela em P&B, monitor mal calibrado de loja) eles são **o mesmo tom**. Isso não é
efeito colateral do daltonismo — é uma propriedade da paleta que atinge todo mundo.

### 8.4 Redundância obrigatória (WCAG 1.4.1 — Uso de cor)

A norma é direta: cor nunca pode ser o único meio de transmitir informação. Boa notícia:
**o produto já está parcialmente certo** — todo `.badge` carrega rótulo escrito
("Ruptura", "Baixo", "saudável", "excesso"), e o `styles.css` documenta isso explicitamente.
O que falta é fechar os pontos em que a cor ficou sozinha.

**Camadas de redundância exigidas, em ordem de prioridade:**

1. **Rótulo textual — obrigatório, sem exceção.** Todo indicador de estado precisa da palavra.
   Já vale para os badges; precisa valer também para pontos, segmentos de gráfico e
   contagens coloridas.
2. **Forma — o segundo canal mais forte.** O manual dá a ferramenta pronta: o botão tem
   corte assimétrico e o chip é reto; o `.dot` é quadrado. Estender a mesma lógica aos
   estados: marcador **quadrado cheio** = crítico, **quadrado vazado** (só filete) = atenção,
   **traço horizontal** = saudável. São três formas distinguíveis sem cor nenhuma, coerentes
   com uma iconografia de terminais retos e junções vivas.
3. **Ícone da grade 24 do manual.** Existem ícones já definidos: "Aprovado" para saudável,
   "Atenção/risco operacional" (`Icon.tsx`) para ruptura. Traço 1,3px, terminais retos.
4. **Posição e ordem.** Numa tabela de alertas, ordenar por gravidade já comunica gravidade
   sem cor. Numa barra empilhada, manter sempre a mesma ordem de segmentos (crítico →
   atenção → saudável, sempre nessa direção) permite ler por posição.
5. **Peso e caixa.** Estado crítico em `font-weight: 600`; os demais em 400. É um canal
   ortogonal à cor e sobrevive ao P&B.
6. **Padrão de preenchimento em gráfico.** Onde o segmento é grande (barra, pizza, mapa de
   calor), hachura ou densidade de trama separa o que a cor não separa — e a Malha Nano do
   manual já é vocabulário de trama da marca.

**Regra mínima que fecha a conformidade:** *nenhuma tela pode depender da distinção entre
`--verde` e `--terra` para ser operada.* Se em algum lugar a única diferença entre "está tudo
bem" e "está em ruptura" for o tom do badge, essa tela está quebrada para 8% dos usuários
homens e para toda impressão em P&B.

---

## 9. Achados de coerência semântica (não são contraste, mas quebram a leitura)

Encontrados ao mapear onde a cor carrega significado. Não são violações de WCAG, são
inconsistências que fazem a cor mentir:

1. **`CoverageBadge` usa `red` para `CRITICAL` e para `EXCESS`** (`components/ui.tsx`, linhas
   65 e 68). Cobertura crítica (falta produto) e excesso (sobra capital parado) são problemas
   opostos, com ações opostas, pintados da mesma cor. Só o texto os separa — o que satisfaz
   1.4.1, mas induz erro de leitura rápida.
2. **`HEALTHY` é `green` em `ui.tsx` (linha 66) e `blue` em `Planning.tsx` (linha 38).**
   O mesmo estado, duas cores, dependendo da tela.
3. **`.dot.amber` usa `var(--ouro)` `#C9A227`, mas `.badge.amber` usa `--ambar` `#7E5111`.**
   Em `Planning.tsx` (linhas 1040-1047) a legenda desenha `.dot.amber` (ouro) ao lado de um
   segmento de gráfico pintado com `var(--amber)` (bronze). Legenda e gráfico não batem.
4. **`--purple` e `--teal` foram absorvidos** para `--tinta` e `--ouro-dark`. Onde as páginas
   usavam roxo e ciano para *distinguir séries*, agora há colisão silenciosa de cor.
5. **`--ambar-claro` === `--ouro-lux`** (`#F0D482`). No escuro, "atenção" e "marca" são a
   mesma cor.

---

## O QUE CORRIGIR NA ONDA 2

Numerado, específico, executável sem interpretação. Cada item diz o arquivo, a mudança e o
critério de aceite.

### 1. Refazer a paleta dos gráficos de BI — **bloqueante**
**Arquivo:** `apps/web/src/bi/transforms.ts`
`TEXT = '#e8edf7'` dá **1.05:1** sobre `#F6F2E9` (invisível) e `AXIS_COLOR = '#9aa9c7'` dá
**2.12:1**. Nenhuma das 7 cores de `PALETTE` chega a 3.0:1 sobre o branco-papel.
**Fazer:** trocar os literais por cores lidas dos tokens, com dois conjuntos (claro/escuro).
Valores que já estão verificados neste documento:
- claro: texto de gráfico `--tinta` `#2A2416` (13.80), eixo `--tinta-suave` `#5C543E` (6.73),
  grade `--linha-clara` (decorativa, sem exigência), séries em `--ouro-dark`, `--terra`,
  `--verde`, `--ambar`, `--tinta`, `--accent-press` — todas ≥ 4.5:1 sobre `#F6F2E9`.
- escuro: texto `--branco` (17.59), eixo `--muted` (7.69), séries em `--ouro-lux`,
  `--terra-claro`, `--verde-claro`, `--ouro`, `--branco2` — todas ≥ 7:1 sobre `#0D0B08`.
Remover também o `backgroundColor: '#1b2945'` do `getDataURL` em `components/EChart.tsx`
(linha 20): a exportação PNG sai com fundo azul-marinho do tema antigo.
**Aceite:** nenhum literal hexadecimal de cor fora dos tokens em `transforms.ts`; toda cor de
série ≥ 4.5:1 contra o fundo do tema em que é renderizada.

### 2. Blindar `--ouro-dark` como texto sobre superfície que não seja `#F6F2E9`
**Arquivo:** `apps/web/src/styles.css`
`--ouro-dark` dá 4.57 sobre `--branco`, mas **3.74 sobre `--branco2`** e **4.32 sobre a
lavagem de hover**. Como `--accent` é `--ouro-dark` e pinta todo link e todo `.btn` contornado,
qualquer link em painel elevado ou linha em hover reprova.
**Fazer:** escolher **uma** das duas saídas e aplicar em todo o arquivo:
- (a) escurecer `--accent` para `#7A5C10`. Verificado: **5.58** sobre `#F6F2E9`,
  **4.57** sobre `#E4DCC9`, **5.27** sobre a lavagem de hover — passa AA nas três. Custo:
  afasta-se um pouco mais do ouro da marca, e `--ouro-dark` deixa de ser o token de ênfase
  (viraria só hover), o que exige aval de marca; ou
- (b) manter `--ouro-dark` como `--accent` no fundo branco e redefinir `--accent` dentro dos
  escopos `.badge.blue`, `.segmented`, `tr:hover`, `.tile:hover` e qualquer regra que use
  `--panel-2` como fundo, apontando para `--accent-press` `#6D520F` (**5.37** sobre
  `#E4DCC9`, **6.20** sobre o hover — ambos passam). Custo: mais seletores, mas nenhum
  token de marca muda de valor. **É a saída recomendada.**
**Aceite:** nenhum link, `.btn` contornado ou `.eyebrow` com razão < 4.5:1 contra o fundo em
que efetivamente renderiza, incluindo estados de hover.

### 3. Impedir vazamento de cor entre temas
**Arquivo:** `apps/web/src/styles.css`
`--ouro-lux` (1.30 sobre branco), `--verde-claro` (1.61), `--terra-claro` (2.21) e
`--ambar-claro` só existem para o escuro; `--tinta` (1.28 sobre preto), `--tinta-suave`
(2.61), `--verde` (2.67), `--ambar` (2.88) e `--terra` (2.41) só existem para o claro.
**Fazer:** comentar cada um dos doze tokens de estado com o tema em que é válido e a razão
medida, no formato já usado no arquivo. Nenhum token `-claro` pode aparecer fora de um
seletor `[data-tema='escuro']`, e nenhum token escuro dentro dele.
**Aceite:** busca por `--ouro-lux`, `--verde-claro`, `--terra-claro` e `--ambar-claro` no CSS
retorna somente ocorrências dentro de `[data-tema='escuro']` ou na declaração do `:root`.

### 4. Fechar a redundância não cromática dos estados operacionais
**Arquivos:** `apps/web/src/styles.css`, `apps/web/src/components/ui.tsx`
Sob deuteranopia, saudável × crítico têm ΔE 8.8 (claro) e 9.4 (escuro): são a mesma cor.
**Fazer, nesta ordem:**
- 4.1 Dar **forma** ao `.dot`: `.dot.red` quadrado cheio; `.dot.amber` quadrado vazado
  (`background: transparent; border: 1.5px solid`); `.dot.green` traço horizontal
  (`height: 3px; width: 10px`). Três formas separáveis sem cor. Manter o quadrado — o
  sistema não tem canto redondo fora da forma da marca.
- 4.2 Dar **peso** ao badge crítico: `.badge.red { font-weight: 600 }`, os demais em 500.
- 4.3 Garantir que **todo** `.dot` no produto tenha texto adjacente. `Planning.tsx`
  (linhas 1046-1047) já tem; verificar as demais ocorrências.
- 4.4 Subir `.badge` de `font-size: 9.5px` para `10.5px` quando carregar estado operacional.
  10.5px é a medida que o próprio manual usa em `.eyebrow` e `.spec .k` — está dentro do
  sistema, não é invenção.
**Aceite:** desligando a cor (filtro `grayscale(1)` no navegador), ainda é possível dizer qual
badge é ruptura, qual é atenção e qual é saudável em qualquer tela.

### 5. Dar separação real às superfícies do tema escuro
**Arquivo:** `apps/web/src/styles.css`
Carvão × preto = 1.07:1, grafite × carvão = 1.10:1, e o filete `--linha2` que deveria
separá-los dá 1.24:1. No tema escuro as três superfícies são uma só — e é nele que roda a
tela mais densa do produto.
**Fazer:** no escopo `[data-tema='escuro']`, subir `--border` de `rgba(246,242,233,.10)` para
`rgba(246,242,233,.22)` — o valor que `--border-strong` já usa. Verificado: passa de
1.24/1.29/1.32 para **1.84/1.92/1.96** sobre preto/carvão/grafite, ~50% mais separação.
Continua abaixo de 3.0, e isso é aceitável enquanto o filete for estrutura e não estado.
Usar `--linha` (filete dourado, 1.80 sobre preto / 1.85 sobre carvão) para delimitar card
contra fundo. Onde a borda distinguir **estado** (card selecionado, linha ativa), exigir
3.0:1: `--ouro` sobre `--carvao` dá **7.59** e resolve com folga.
**Aceite:** todo card, painel e linha de tabela no tema escuro é delimitado por um filete
com razão ≥ 1.8:1 contra o fundo; toda borda que indica estado tem ≥ 3.0:1.

### 6. Corrigir os placeholders
**Arquivo:** `apps/web/src/styles.css`
Claro: `rgba(92,84,62,.7)` → `#8A8371` → **3.36:1**. Escuro: `rgba(228,220,201,.45)` →
`#6E695F` → **3.60:1**. Placeholder é texto e conta para 1.4.3.
**Fazer:** claro → `rgba(92,84,62,.92)`, verificado em **5.54:1** (ou `--tinta-suave` sólido,
6.73). Escuro → `rgba(228,220,201,.62)`, verificado em **5.92:1** sobre preto e **5.78:1**
sobre carvão (a 72% já mede 7.69).
**Aceite:** ambos os placeholders ≥ 4.5:1 contra o fundo do campo no respectivo tema.

### 7. Rever `opacity` no estado desabilitado
**Arquivo:** `apps/web/src/styles.css`
`.btn:disabled { opacity: .5 }` leva o `.btn` contornado a **1.97:1** — o rótulo fica ilegível.
Não é violação (controles desabilitados são isentos), mas o operador precisa ler o que está
indisponível.
**Fazer:** trocar a opacidade global por cor explícita: `color: var(--tinta-suave)` (6.73) e
`border-color: var(--border-strong)`, mantendo `cursor: not-allowed`. A desabilitação passa a
ser comunicada por cor neutra + cursor + `aria-disabled`, não por apagamento.
**Aceite:** rótulo de botão desabilitado ≥ 4.5:1 em ambos os temas.

### 8. Não deixar ícone informativo herdar ouro puro no tema claro
**Arquivos:** `apps/web/src/styles.css` e as páginas (Onda 3)
`--ouro` sobre `#F6F2E9` dá **2.17:1**. Um traço de 1,3px nessa razão não é percebido. A grade
de ícones do manual é desenhada sobre `--carvao`, onde o ouro dá 7.59:1 — no branco-papel, não.
`brand/Icon.tsx` **já está correto**: usa `stroke="currentColor"` e o próprio arquivo
documenta "nunca dourado no path" (linha 19). O risco não está no componente — está em quem
define o `color` do contexto em que ele é renderizado.
**Fazer:** auditar todo container que envolve um `<Icon>` no tema claro. Se o ícone carrega
significado (status, ação, navegação), o `color` do contexto tem que ser `--ouro-dark` (4.57)
ou `--tinta-suave` (6.73) — nunca `--ouro`. O ouro puro fica para o tema escuro (8.12 sobre
preto), para preenchimento de superfície, e para o símbolo da marca em tamanho grande, onde
é logotipo e não informação.
**Aceite:** nenhum `<Icon>` funcional renderiza dentro de um contexto com `color: var(--ouro)`
no tema claro. Verificação rápida: `grep -rn "color: var(--ouro)" styles.css` fora do bloco
`[data-tema='escuro']` não retorna regra que envolva ícone.

**Caso concreto:** `.dot.amber` usa `var(--ouro)` e, dentro do `.banner.warn` do Dashboard,
fica em **2.02:1** contra `#F2EAD6` — praticamente invisível. Ali é tolerável porque o texto
ao lado diz a mesma coisa (o ponto é decorativo no sentido da WCAG), mas confirma que o ouro
puro não sustenta marcador pequeno sobre claro. Resolver junto com o item 9.3.

### 9. Unificar a semântica das cores de estado
**Arquivos:** `apps/web/src/components/ui.tsx`, `apps/web/src/pages/Planning.tsx`
- 9.1 `CoverageBadge`: `CRITICAL` e `EXCESS` são ambos `red` (`ui.tsx`, linhas 65 e 68). São
  problemas opostos. Dar `amber` ou uma quarta classe a `EXCESS`, ou — se a paleta não
  comportar um quarto tom — diferenciar por **forma** (item 4.1), mantendo o texto.
- 9.2 `HEALTHY` é `green` em `ui.tsx` (linha 66) e `blue` em `Planning.tsx` (linha 38).
  Padronizar em `green`.
- 9.3 `.dot.amber` usa `var(--ouro)` e `.badge.amber` usa `--ambar`: em `Planning.tsx`
  (linhas 1040-1047) a legenda não bate com o segmento do gráfico. Fazer `.dot.amber` usar
  `var(--ambar)`.
**Aceite:** cada estado operacional tem exatamente uma classe de badge, uma cor de ponto e
uma cor de segmento de gráfico, iguais em todas as telas.

### 10. Ligar o seletor de tema — o escuro hoje é código morto
**Arquivos:** casca da aplicação (`AdminShell.tsx` / `StoreShell.tsx`) — dono da Onda 2
Busca por `data-tema` em `apps/web/src` **não retorna nenhuma ocorrência em TSX**: o bloco
`[data-tema='escuro']` do `styles.css` (linhas 1397-1627) nunca é ativado. Duas decisões do
briefing dependem disso: o escuro ser escolha explícita do usuário, e a tela de BI ser o
painel de alta densidade em preto.
**Fazer:** escrever `data-tema` em `document.documentElement`, persistir a escolha, **não**
seguir `prefers-color-scheme` (o claro é o padrão sempre) e aplicar `data-tema="escuro"` na
rota de BI independentemente da preferência.
**Aceite:** o tema escuro é alcançável pela interface; recarregar a página preserva a escolha;
o BI abre em preto mesmo com o console em claro.

### 11. Verificação final da onda
**Fazer:** com as correções aplicadas, revalidar contra este documento e registrar o
resultado. Checagem mínima, tela a tela:
- nenhum texto < 4.5:1 (exceto `h1`, `.stat .value` e `.kpi`, que podem operar em 3.0:1);
- nenhuma borda que indique **estado** < 3.0:1;
- foco visível em todo controle interativo (hoje correto: 4.57 no claro, `--ouro` no escuro);
- toda tela legível com `filter: grayscale(1)`;
- `Reports.tsx` impresso em P&B continua distinguindo os estados.

---

## Perguntas em aberto para quem responde pela marca

Não inventei valor nenhum. Estes pontos não têm resposta no manual e precisam de decisão:

1. **O manual não define cor de estado operacional.** `--verde`, `--ambar`, `--terra` e suas
   variantes claras foram derivadas pelo time. Precisam ser canonizadas ou substituídas.
2. **`--ambar-claro` e `--ouro-lux` são o mesmo hex.** Atenção e marca compartilham cor no
   tema escuro. Coincidência ou decisão?
3. **O manual dá 6 cores de superfície e 3 de ouro — não dá paleta categórica para gráfico
   de múltiplas séries.** O BI precisa de 5 a 7 cores mutuamente distinguíveis (inclusive sob
   deuteranopia). Isso não existe numa paleta monocromática quente. Ou o manual ganha uma
   escala categórica aprovada, ou os gráficos passam a separar séries por **padrão de trama +
   posição + rótulo direto**, usando cor apenas para destacar uma série por vez.
4. **A régua hierárquica dourada (1.26:1 sobre branco) é decorativa por desenho.** Confirmo
   que ela pode permanecer assim desde que nunca seja a única marcação de estrutura — mas
   quero registrado que essa é uma escolha consciente, não um descuido.
