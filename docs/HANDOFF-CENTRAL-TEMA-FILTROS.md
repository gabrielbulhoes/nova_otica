# Handoff — Central de Operações, tema e coerência dos filtros

> Rodada de **03/08/2026**. Documento para quem vai continuar (inclusive em
> outro Claude). Descreve o que mudou, **por quê**, o que ficou provado por
> teste e onde estão as armadilhas.
>
> Contexto geral do produto (o que é, monorepo, `@planning`, integração CDS):
> [`HANDOFF-PROJETO.md`](./HANDOFF-PROJETO.md).
> Como atualizar o snapshot real: [`deploy/HANDOFF-ATUALIZAR-SNAPSHOT-REAL.md`](./deploy/HANDOFF-ATUALIZAR-SNAPSHOT-REAL.md).

---

## 1. Onde está o código

| | |
|---|---|
| Branch local | `nanoflow` |
| Remoto | `origin/claude/optical-inventory-system-qafpfr` — **PR #35** |
| Base | a versão que o cliente chama de **V12** |
| Testes | **web 102** · **API 220** (40 skipped) — todos verdes |
| Typecheck | limpo (API + web) |

Commits desta rodada, do mais antigo para o mais novo:

```
7578d8c  Central de Operações: a entrada do console vira uma coleção de módulos
f37cfaf  Tema claro fixo do NANOFLOW em todas as páginas          (revertido por e595a80)
e595a80  Alternador de tema de volta, com o claro garantido em toda abertura
c67d682  Filtro de período passa a oferecer só o que a amostra responde
8afe149  Recorte de datas dentro da amostra: mudar o filtro muda o dado
f2892b6  Reconstrução por loja deixa de mentir em amostras maiores que 7 dias
3623f75  Corrige soma do BI: nenhuma quebra pode ser maior que a rede
```

> `f37cfaf` fixava o tema claro e **removia** o alternador. O cliente pediu o
> alternador de volta; `e595a80` o restaurou mantendo o claro como ponto de
> partida. Os dois estão no histórico de propósito — a regra atual é a de
> `e595a80`.

**Nada de regra de negócio, API, rota ou permissão mudou nesta rodada.** O que
mudou foi organização da interface e a **honestidade dos números da demo**.

---

## 2. As quatro frentes

### 2.1 Central de Operações (`7578d8c`)

A entrada do console era uma lista de 15 links de texto que, no celular, ocupava
cinco linhas antes de qualquer conteúdo e não dizia a que área cada tela
pertencia. Virou **sete cartões** agrupados por categoria.

- `apps/web/src/lib/modulos.ts` — **fonte única da navegação**. Sete módulos com
  `id / nome / icone / categoria / descricao / destino / paginas / adminOnly`.
- `apps/web/src/pages/Central.tsx` — a tela. Cabeçalho com saudação por hora,
  papel do usuário, total de pendências e **busca global** (sem acento, casa
  nome do módulo, descrição, categoria e nome das páginas internas).
- `AdminShell` perdeu o array de 15 links; a barra lateral virou **contextual**:
  na Central mostra uma dica, dentro de um módulo mostra só as telas dele mais o
  caminho de volta.
- `App.tsx`: `<Route index element={<Central />} />` e o Painel ganhou rota
  própria (`/admin/dashboard`). **As 15 rotas antigas continuam idênticas** —
  link salvo não quebra.

Decisão de design que vale registrar: o pedido original falava em cantos
arredondados e sombra. O manual NANOFLOW manda o contrário (raio 0, sem sombra —
"superfície é papel, não vidro"). A elevação do cartão é feita com **filete
dourado + lavagem + `scale(1.02)` em 200ms**, e o arredondado aparece só no
**corte assimétrico** da placa do ícone, que é a assinatura da marca.

Rede de proteção: `lib/modulos.test.ts` (7 testes) garante que **nenhuma tela
fica órfã** — toda rota pertence a exatamente um módulo, nenhuma é declarada
duas vezes, o gestor de loja não enxerga as telas de admin, e prefixo mais longo
ganha (`/admin/estrategia` não é capturado por `/admin/estoque`).

### 2.2 Tema: claro por padrão, com o alternador de volta (`e595a80`)

O botão claro/escuro continua na barra de título, igual ao que era (mesmo
rótulo-ação, mesmo `aria-pressed`). **O que mudou é onde a escolha mora.**

Antes ia para `localStorage` — e era isso que fazia o escuro sobreviver ao
fechamento do navegador: bastava alguém clicar uma vez, em qualquer momento,
para a demonstração seguinte naquela máquina abrir preta.

Agora o estado vive **em memória**, em `apps/web/src/lib/tema.ts`:

- o usuário troca quando quiser, e vale enquanto estiver usando;
- **toda abertura começa no claro** — recarregar, aba nova, dia seguinte;
- console e vitrine (`/loja`) leem a **mesma fonte**, então a loja acompanha.

Por que `useSyncExternalStore` e não `useState` no `AdminShell`: as duas cascas
são **irmãs no roteador**, não mãe e filha. Um estado no console não alcançaria
`/loja` — era exatamente esse o buraco que fazia a vitrine abrir clara com o
console escuro.

Nada consulta `prefers-color-scheme`. O tema do sistema operacional do gerente
nunca decidiu a aparência do produto.

`lib/tema.test.ts` (4 testes). O que guarda a regra: depois de
`vi.resetModules()` (o equivalente a recarregar a página) o tema **volta a
claro** — reintroduzir storage quebra o teste.

> Se um dia a preferência precisar durar entre sessões, o lugar é
> `lib/tema.ts`: três funções passam a ler/gravar no navegador e nenhuma tela
> precisa saber. Aí o teste acima falha de propósito, e é a hora de decidir
> conscientemente.

### 2.3 O filtro de período passa a dizer a verdade (`c67d682`, `8afe149`)

**O defeito.** A fotografia estática do CDS cobre **7 dias** (07/07 a
13/07/2026) e as telas ofereciam 7, 30, 90 e 180. A matemática já usava a janela
medida, então escolher "30 dias" devolvia exatamente os números de 7 — com o
rótulo de 30. Quem operava concluía, com razão, que o filtro estava quebrado; e
quem confiava no rótulo lia sete dias de receita como se fossem um mês.

**Verificação que fundamentou tudo:** a série diária soma **exatamente** o total
declarado (R$ 1.095.377,24 em 503 vendas). Não havia 30 dias escondidos no
arquivo — a amostra inteira, agregados inclusive, é dos mesmos 7 dias.

**A correção, em duas partes:**

1. **O seletor passa a ser montado a partir da cobertura** (`lib/periodo.ts`).
   O que cabe fica normal; o que não cabe fica **desabilitado, com o motivo no
   rótulo** ("Últimos 30 dias — fora da amostra"). Preferimos isso a apagar as
   opções: some o filtro que mentia sem sumir a informação de que aquele recorte
   existe e volta quando a extração crescer.
2. **Recorte real dentro da amostra.** `effectiveDays` virou
   `min(pedido, medido)`: pedir menos é recorte legítimo. Com isso o filtro
   oferece **1, 3 e 7 dias** e move os números de verdade.

Resultado medido no build, recorte "Óculos":

| janela | faturamento | un. vendidas | giro mensal |
|---|---|---|---|
| 1 dia | R$ 55.069,69 | 42 | 0,26 |
| 3 dias | R$ 177.616,12 | 143 | 0,09 |
| 7 dias | R$ 427.704,66 | 329 | 0,04 |

`<LegendaDaAmostra days={days} />` (em Relatórios, BI, Vendas e Planejamento)
escreve o limite **logo abaixo dos filtros**, onde a conclusão é tirada — não
numa nota de rodapé. Ela some sozinha quando não há limite a declarar (backend
ao vivo ou dados fictícios).

### 2.4 Coerência dos números (`f2892b6`, `3623f75`)

Duas correções da mesma família, ambas encontradas por medição.

**a) A reconstrução por loja em amostras maiores que 7 dias** (`f2892b6`)

O faturamento por loja é reconstruído do balde `loja × dia da semana`. Numa
amostra de 7 dias **cada dia da semana identifica uma data** — a conta é exata
(conferida ao centavo nos sete dias). Numa de 30, "quinta" agrega ~4 datas no
mesmo balde, e a primeira versão somava o balde inteiro sempre que aquele dia
caísse na janela: um recorte de 7 dias sobre 30 devolvia **R$ 4.530.902** (os 30
dias) enquanto o KPI ao lado mostrava **R$ 1.076.927**.

Correção: cada balde entra na proporção das suas ocorrências **dentro** da
janela sobre as ocorrências na amostra inteira. Com até 7 dias a razão é 1 ou 0
e o resultado segue exato; acima disso ela reparte o balde entre as datas que
agrega. Depois da correção, no snapshot de 30 dias: 7 dias → desvio de 0,85%;
14 dias → 0,9%; 30 dias → exato.

A cobertura declara `lojaPorDataExata`, e a legenda muda com ela — a interface
para de prometer medição onde há projeção.

**b) A soma do BI: nenhuma quebra pode ser maior que a rede** (`3623f75`)

**Relatado pelo cliente**, e era regressão introduzida em `8afe149`: ao fazer o
KPI acompanhar a janela, as quebras ficaram congeladas no período inteiro.
Recorte "Óculos", 1 dia: rede **R$ 55.069,69**, A GRACIOSA MIDWAY sozinha
**R$ 78.829,04**. A parte ficou maior que o todo.

Nenhuma quebra tem dia na amostra (loja com recorte de produto, marca,
categoria, forma de pagamento, curva ABC, análise de vendas). Todas passaram a
cair na **mesma escala do KPI** — a fatia medida que a janela ocupa no
faturamento da amostra. O único caminho que não escala é o medido dia a dia
(loja sem recorte de produto).

Dois irmãos foram junto, senão entregaríamos o BI certo e o resto errado:
**curva ABC** (Relatórios) e **análise de vendas**. Na ABC as classes A/B/C não
se movem — classificação ABC é participação relativa, e escala não muda
proporção.

---

## 3. A amostra estática: o que ela mede e o que não mede

Esta tabela é a chave para entender qualquer número da demo.

| Dado | Tem data? | Comportamento no recorte |
|---|---|---|
| Faturamento e nº de vendas da rede (`dailySales`) | **sim, por dia** | medido |
| Faturamento por loja (`weekdayStore`) | **sim** (exato até 7 dias) | medido até 7 dias; proporcional acima |
| Estoque, ruptura, cobertura | n/a (é posição, não período) | não depende da janela |
| Por marca, categoria, produto, vendedor, pagamento | **não** | acompanha em proporção |

"Acompanha em proporção" = o total **medido** da janela vezes a fatia **medida**
do recorte. É projeção, e a tela declara isso (`vendasAproximadas`, notas
"proporcional", e a legenda). **Não é número inventado — mas também não vale
como medição de um dia específico**, e a legenda diz exatamente isso.

---

## 4. Quando o snapshot crescer

Pergunta que o cliente fez e que está **respondida por teste**: se a extração
passar a cobrir 30/60/90 dias, os filtros voltam sozinhos?

**Sim.** A cobertura é medida do próprio arquivo. Provado com um snapshot
sintético de 30 dias:

- o seletor passou a oferecer **1, 3, 7, 14 e 30**, abriu em 30, e manteve
  90/180 bloqueados;
- com 90 dias, o rateio de feira reabre os 90.

Testes que fixam isso: `lib/periodo.test.ts` → *"amostra maior reabre os
recortes SOZINHA"*.

**O que revisar quando isso acontecer** (não quebra, mas melhora):

1. `ESCADA` em `lib/periodo.ts` define os degraus oferecidos
   (`1, 3, 7, 14, 30, 60, 90, 180, 365`). Com uma janela grande talvez você
   queira menos degraus.
2. Acima de 7 dias o desempenho por loja vira proporcional. Se a sonda passar a
   trazer **loja × data**, dá para voltar a ser exato — o ponto de mudança é
   `salesByStoreNaJanela()` em `demo.ts`.
3. As quebras por marca/produto continuam sem data. Se a sonda passar a trazer
   **produto × data**, o ganho é grande: a curva ABC e a análise de vendas viram
   medição em vez de projeção.

Como refazer a extração (na máquina que tem as credenciais):

```bash
node scripts/extrair-fixtures-cds.mjs ./apps/api/tmp/cds-fixtures --dias=30
node scripts/build-demo-real-data.mjs
```

O gerador **mede a janela e avisa** se ela vier curta. As credenciais do CDS não
estão neste repositório (ver §7).

---

## 5. Os três módulos novos

| Arquivo | Papel | Regra que ele guarda |
|---|---|---|
| `lib/modulos.ts` | fonte única da navegação | nenhuma tela órfã; permissões respeitadas |
| `lib/tema.ts` | store do tema (memória) | toda abertura começa no claro |
| `lib/periodo.ts` | opções e legenda do período | o filtro só oferece o que a base responde |

Os três são **puros e testados**, e é onde mexer primeiro — as telas só
consomem. `components/LegendaDaAmostra.tsx` é o único componente novo.

Em `api/client.ts`, `coberturaDaAmostra()` é a porta: devolve `null` fora do
modo demonstração. O gate existe porque o dataset real é embarcado por
`import.meta.glob` sempre que o arquivo existe na árvore — sem ele, um build
ligado ao backend herdaria o limite de uma fotografia que nem usa.

---

## 6. Rodar, testar, publicar

```bash
npm install

# testes
npm run test -w @nova-otica/web     # 102
npm run test -w @nova-otica/api     # 220 (40 skipped)
npx tsc -p apps/web/tsconfig.json --noEmit

# demo local
npm run dev -w @nova-otica/web      # com VITE_DEMO=1 no .env local
```

**Zip da HostGator** (é o que vai para o cliente):

```bash
cd apps/web
VITE_DEMO=1 VITE_HASH_ROUTER=1 VITE_BASE=./ \
  VITE_DEMO_LABEL="Dados reais da rede" \
  npx vite build
cd dist && zip -r ../../../nova-otica-hostgator.zip . -x '.*'
```

Descompactar o **conteúdo** direto em `public_html` — o `index.html` fica na
raiz, junto de `assets/` e `fonts/`.

- `VITE_DEMO_LABEL` é o que faz o selo dizer **"Dados reais da rede · estático"**.
  Sem ele o selo diz "Dados fictícios", que é falso quando o pacote leva o
  snapshot real. Isto já passou despercebido uma vez.
- `VITE_DEMO_USERS="Nome:senha,..."` fixa o login em contas nomeadas. **Sem
  ele a tela de login mostra `admin@novaotica.com / admin123`** — decidir com o
  cliente antes de publicar.

---

## 7. Armadilhas conhecidas

1. **Os testes rodam com e sem o snapshot real.** `demo-real-data.json` é
   gitignorado: no CI ele não existe e a demo usa dados fictícios; na máquina de
   quem tem o arquivo, os mesmos testes exercitam a amostra real. Asserções
   novas precisam valer nos **dois** casos — foi assim que a série passou a ser
   testada por `points.length <= days` em vez de `=== days`.
2. **Dia da semana só identifica a data em amostras de até 7 dias.** Já causou
   um defeito (§2.4a). Antes de usar `weekdayStore` para qualquer coisa nova,
   confira `lojaPorDataExata`.
3. **`totals.revenue30d` mente pelo nome.** É o total da amostra, tenha ela os
   dias que tiver. Use `vendasNaJanela(days)`.
4. **A resposta de `timeseries` devolve `days` = pontos que ela cobre**, não o
   pedido. Quem monta rótulo com esse campo está certo; quem espera o valor
   pedido, não.
5. **O arquivo real é insubstituível aqui.** Ele não está no Git e não dá para
   regerar sem as credenciais. Ao experimentar com snapshots sintéticos, faça
   backup e confira o `md5` na volta (foi o que fizemos: `54151290f04087c3…`).

---

## 8. Segurança — o que **nunca** entra no repositório

O repositório é **público**.

- Credenciais do CDS (`x_api_key`, `x_api_token`, `x_cliente_id`, URL base):
  só em `apps/api/.env` (gitignorado). `.env.example` usa placeholders.
- Dados comerciais reais, todos gitignorados:
  `apps/web/src/api/demo-real-data.json`, `apps/api/data/brand-catalog.json`,
  `apps/api/tmp/cds-fixtures/`.

Neste ambiente as credenciais do CDS estão **vazias** (`SELLBIE_MODE=mock`), por
isso a reextração de 30 dias não pôde ser feita aqui.

---

## 9. Pendências

| # | Item | Estado |
|---|---|---|
| 42 | Mix por bandeira: fornecedor no front + catálogo de marcas na demo | núcleo pronto no backend |
| 43 | Benchmark vs "Chico" | bloqueado — depende de login do cliente |
| 46 | Enriquecimento de dados (formato de armação/rosto) | não iniciado |
| 47 | Cards de decisão: aprovar/recusar persistente + gráfico | parcialmente feito na PR #35 |
| — | Reextrair o CDS com a janela cheia | **depende das credenciais** — é o que destrava tudo do §4 |
| — | Decidir `VITE_DEMO_USERS` antes da próxima publicação | depende do cliente |

---

## 10. Se você é o próximo Claude

Leia nesta ordem: §3 (o que a amostra mede), §7 (armadilhas), depois o código de
`lib/periodo.ts` e a função `salesByStoreNaJanela` em `demo.ts`. Os comentários
nesses dois lugares explicam as decisões com os números que as motivaram.

E a regra que organiza o resto: **a interface nunca promete um recorte que o
dado não fez.** Quando não der para medir, projete — e diga que projetou.
