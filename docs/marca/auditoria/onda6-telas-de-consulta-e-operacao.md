# Onda 6 · Dosagem tipográfica e hierarquia nas seis telas de consulta e operação

Produtos · Lojas · Vendas · Transferências · Usuários · Sincronização

Medido em build própria (`VITE_DEMO=1`, hash router), Chromium 1194, viewport
1440×1000, sessão autenticada como Galbe (gestor da rede). Todos os números
deste documento foram lidos do DOM renderizado, não do JSX. Evidência em
`evidencia-onda6/`.

---

## O que o cliente disse

> "Já aqui dentro acho que ficou mais confusa as informações. Essa fonte pra
> infos não é legal também e acho que temos que demarcar melhor as informações
> principais. Mas tudo isso é detalhe"

Três queixas, não uma: **confusão** (não se sabe onde um assunto termina),
**fonte errada para informação** (mono onde se lê) e **falta de demarcação do
principal** (tudo com o mesmo peso). Ele chamou de detalhe. Nestas seis telas
não é: são as telas em que ele confere catálogo, filial, venda, transferência,
conta de acesso e a própria confiabilidade dos números.

---

## O que a medição encontrou nestas seis telas

A Onda 5 já havia corrigido a maior parte da dosagem no CSS global — `.label`
voltou para Inter, `td.num` saiu da mono, o `th` caiu de 0.18em para 0.08em. Por
isso a medição de partida aqui **não** repetiu os 52% do Dashboard. O que sobrou
é mais específico, e em dois sentidos opostos.

### Achado 1 · A mono estava SOBRANDO em um lugar só, mas era o pior

| tela | elemento | medida |
|---|---|---|
| Sincronização | `America/Sao_Paulo` em `.carimbo` | **17 caracteres** em mono CAIXA ALTA a 0,18em |

Único ofensor da regra em seis telas — e ofende a regra que este próprio projeto
escreveu: carimbo é etiqueta de **até ~14 caracteres**. A 0,18em, 17 caracteres
em caixa alta medem mais largura que o valor que o carimbo deveria estar
carimbando.

### Achado 2 · A mono estava FALTANDO em todo o resto — e é o achado maior

| tela | `.codigo` antes | o que saía em Inter proporcional |
|---|---|---|
| Produtos | **0** | 440 SKUs |
| Lojas | **0** | 19 códigos de filial |
| Vendas | **0** | 20 datas + 20 números de venda |
| Transferências | **0** | carimbos de data/hora |
| Usuários | **0** | data/hora do último acesso |
| Sincronização | **0** | data/hora, entidade, expressão cron |

**Zero `.codigo` em seis telas.** Este é o outro lado da dosagem, e é o que a
leitura só da queixa não revela: a mono não estava apenas sobrando onde se LÊ —
estava faltando exatamente onde ela é **função**. `RB4446L` contra `RB4446I` é
comparação caractere a caractere, e é a largura fixa que faz a diferença saltar.
Uma expressão cron (`0 6 * * *`) só se lê contando posições, e contar posição em
fonte proporcional é o pior caso que existe.

A regra de ouro do de-para — *mono para o que se compara ou se etiqueta, Inter
para o que se lê* — estava sendo cumprida pela metade: tinha-se tirado a mono do
que se lê, sem devolvê-la ao que se compara.

### Achado 3 · Zero hierarquia e zero demarcação de seção

| tela | cartões | assinaturas visuais distintas | réguas de seção |
|---|---|---|---|
| Sincronização | 4 indicadores | **1** | **0** |
| Vendas | 2 blocos empilhados | 1 | **0** |
| Transferências | 2 blocos empilhados | 1 | **0** |

Quatro fatos com a mesma superfície, a mesma borda e o mesmo corpo de número. E
nas telas de dois blocos, dois retângulos idênticos empilhados sem régua nem
título entre eles — em Vendas, o título do primeiro bloco ainda morava *dentro*
do cartão, espremido na mesma linha dos controles segmentados. É literalmente
"ficou mais confusa as informações": nada diz onde a análise termina e o registro
começa.

### Achado 4 · Três defeitos de largura, que são defeitos de legibilidade

O briefing mandou resolver o `EM / ESTOQUE` partido em duas linhas. Não havia
selo partido nestas seis telas — havia três defeitos da mesma família:

| tela | defeito | medida antes |
|---|---|---|
| Transferências | botão `Criar movimentação` partido em duas linhas | **30 de 30** botões, 42px contra ~25px |
| Transferências | segunda linha da célula de produto contendo só `—` | **24 de 30** linhas |
| Produtos | coluna MARCA com a razão social do fabricante | **118 de 440** linhas com altura dupla |

O terceiro merece explicação. A coluna chamada MARCA não traz "Ray-Ban": traz
`LUXOTTICA BRASIL PRODUTOS OTICOS E ESPORTIVOS LTDA`, 50 caracteres. Ela ocupava
**367px** — praticamente o mesmo que DESCRIÇÃO, com 375px, que é a coluna que se
lê — e quebrava 118 linhas em duas.

---

## O que foi feito

### Tipografia — o de-para aplicado

- **Identificadores para `<Codigo>`** (mono caixa normal, entreletras zero,
  tabular): SKU e código de filial, número e data da venda, carimbo de data/hora
  da movimentação, último acesso do usuário, data/hora e entidade da carga,
  expressão cron e fuso horário. De 0 para 503 ocorrências nas seis telas.
- **Frases de rodapé de `.label` para `.hint`** em Produtos, Lojas, Vendas e
  Transferências. `.label` **nomeia** um dado e vem em Inter 600; "440 de 4.000
  produtos" não nomeia nada — é frase, e em 600 pesava o mesmo que o rótulo de um
  indicador.
- **`America/Sao_Paulo` saiu do `.carimbo`** e virou `<Codigo>` dentro de uma
  frase em Inter ("Fuso `America/Sao_Paulo`"). Fuso é identificador, não etiqueta.
- **Célula a célula, não coluna a coluna**: em Usuários a data/hora vai em mono
  tabular, mas o `nunca` da mesma coluna fica em Inter — porque é palavra. É o
  que mantém a regra honesta.
- **E-mail continua em Inter, de propósito**: 20 a 35 caracteres, lido inteiro,
  nunca conferido caractere a caractere.

### Hierarquia — Sincronização, os quatro níveis

Esta é a tela em que o gestor decide se pode confiar nos números das outras
dezenove; era a que menos demarcava.

| nível | cartão | superfície | filete | corpo | altura | largura |
|---|---|---|---|---|---|---|
| **1** | Janela da API | 220 | **3px ouro** (161) | Fraunces **40px** | 143px | **545px** (2 colunas) |
| 2 | Modo · Agendamento | 242 | 1px (Δ30) | Fraunces 27px | 143px | 265px |
| 3 | Execuções registradas | — | 1px só no topo | Fraunces 20px | **55px** | 265px |

Quatro canais independentes e todos geométricos: superfície, espessura de filete,
corpo do número e altura. Nenhum depende da cor, então o nível sobrevive ao
cinza, ao daltonismo e ao papel.

A janela é nível 1 porque é o único fato que muda de hora em hora e o único que
responde "posso sincronizar agora?". Recebeu `largo` porque o valor é uma faixa
de horário (`06:00-07:00`) e não um número de três dígitos. "Execuções
registradas" é nível 3 porque é a legenda da tabela logo abaixo — literalmente
conta as linhas dela — e é ele que **paga a conta da hierarquia**: 55px contra
143px, devolvendo em altura o que o nível 1 consome.

**Tema escuro verificado**: o filete de 3px em ouro do nível 1 é o elemento mais
luminoso da página; o nível 2 fica com contorno cinza discreto e o nível 3 sem
moldura. A hierarquia se inverte em tinta e se mantém em ordem.

### Demarcação de seção — cinco `<AberturaDeSecao>` novas

De **0** para **5** réguas de seção nas telas de dois blocos:

- **Vendas** · `ANÁLISE / Venda por dimensão` e `REGISTRO / Vendas sincronizadas`.
  O `<h3>` saiu de dentro do cartão: título de seção não disputa a linha com um
  filtro.
- **Transferências** · `REMANEJAMENTO / Transferências sugeridas pelo motor` e
  `REGISTRO / Movimentações registradas`. O segundo importa: o filtro de status
  aparecia solto no meio da página, sem dizer o que filtrava.
- **Sincronização** · `HISTÓRICO / Últimas execuções`.

Régua dourada + sobretítulo em mono (1 palavra, que é onde a mono caixa alta a
0,18em está no lugar dela) + título em Fraunces, como uma coisa só.

### Largura e legibilidade

- `Criar movimentação` → **`Transferir`**. A correção certa não é alargar a
  coluna — o espaço viria das colunas de texto, que são as que já quebram — e sim
  encurtar o rótulo até o verbo. A sugestão é sempre uma transferência entre
  lojas, então "Transferir" diz mais que "Criar" e cabe em uma linha. A frase
  inteira ficou no `title`.
- Marca `—` deixou de renderizar como segunda linha, e a marca que apenas repete
  o fim da descrição (`... OCULOS RAY BAN`) também não repete.
- Coluna MARCA de Produtos: uma linha, reticências, teto de 220px, nome completo
  no `title`. **O dado não foi tocado** — corrigir o mapeamento fabricante ×
  marca é assunto da camada de integração, e inventar aqui um "Ray-Ban" que a
  fonte não mandou seria mentir sobre o catálogo. O que se corrigiu foi a
  largura.

---

## Antes e depois, medido

| medida | antes | depois |
|---|---|---|
| Ofensores da regra de dosagem (6 telas) | 1 | **0** |
| `.codigo` (identificadores em mono funcional) | **0** | **503** |
| Réguas de seção | **0** | **5** |
| Assinaturas visuais em Sincronização | 1 | **3** |
| Botões partidos em duas linhas (Transferências) | 30 de 30 | **0** |
| Linhas com `—` órfão (Transferências) | 24 de 30 | **0** |
| Altura média da linha (Transferências) | 82px | **69px** (−16%) |
| Linhas de altura dupla (Produtos) | 118 de 440 | **0** |
| Largura da coluna DESCRIÇÃO (Produtos) | 375px | **462px** (+23%) |
| Altura média da linha (Produtos) | 48px | **43px** |

Uma observação de honestidade sobre o percentual de mono: ele **subiu** em cinco
das seis telas (Produtos, de 0% para 20%). Isso é o resultado pretendido, não uma
regressão. O percentual bruto nunca foi a métrica — a métrica é *onde* a mono
está. Antes: 8 elementos, todos cabeçalhos de coluna, e nenhum identificador.
Depois: os mesmos cabeçalhos mais 440 SKUs de 5 caracteres em média, em caixa
normal e sem entreletras. Não há um único caractere a mais de mono em texto que
se lê — o número de ofensores é zero. A mono deixou de ser uniforme e passou a
ser dosada.

---

## O que ficou de fora, e por quê

- **O mapeamento fabricante × marca em Produtos.** É defeito de dado, na camada
  de integração. Aqui foi contido, não corrigido. Vale abrir com o cliente: a
  coluna que ele chama de "marca" não mostra marca, e isso vale mais que qualquer
  ajuste tipográfico desta onda.
- **Produtos, Lojas e Usuários não ganharam régua de seção.** São telas de bloco
  único; o `PageHeader` já abre a única seção que existe. Régua sem segundo bloco
  para separar é ruído — foi exatamente o erro de dosagem que esta onda veio
  desfazer.
- **Nenhum indicador foi inventado.** Produtos e Lojas são espelho da fonte e não
  têm indicador principal; criar um `<StatCard nivel={1}>` ali seria fabricar
  hierarquia onde não há fato hierárquico.
