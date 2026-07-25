# Handoff do projeto — Nova Ótica (para continuar em outro Claude)

> Documento para quem vai **continuar o desenvolvimento**. Resume o que o
> sistema é, o que foi feito nesta rodada, onde está o código, como rodar/
> testar/publicar, o que depende do cliente e o backlog. Leia isto primeiro;
> os detalhes de deploy com dados reais estão em
> [`deploy/HANDOFF-ATUALIZAR-SNAPSHOT-REAL.md`](./deploy/HANDOFF-ATUALIZAR-SNAPSHOT-REAL.md).

---

## 1. O que é o projeto

Plataforma de **gestão inteligente de estoque** para uma rede de óticas (4
bandeiras, 19 lojas). O núcleo cruza **vendas × estoque por loja** e recomenda
**comprar / remanejar / liquidar**, respeitando prazo de fornecedor, sem lentes
no remanejamento e sem o centro de distribuição (GMAIS) nas contas. Tem também
loja online com **provador virtual (AR)**.

**Monorepo (npm workspaces):**
- `apps/api` — Express + Prisma (PostgreSQL) + Zod + TypeScript + vitest.
- `apps/web` — React 18 + Vite 5 + React Query + react-router + vitest.
- **`@planning`** — alias para `apps/api/src/modules/planning/planning.math.ts`:
  módulo **puro** compartilhado entre backend e a demo do front. **Toda a
  matemática de decisão vive aqui** e é testada em `apps/api/test/planning.test.ts`.

**Dois "sabores" do front:**
- **Demo** (`VITE_DEMO=1`): roda sem backend, dados no navegador (`apps/web/src/api/demo.ts`).
  - público: dados fictícios;
  - com `apps/web/src/api/demo-real-data.json` (gitignorado): mostra os dados REAIS
    agregados (snapshot estático — é o que roda no `novaotica.gb.app.br`).
- **Live**: front chama o backend em `/api`; backend sincroniza com a CDS/Sellbie.

---

## 2. Estado do repositório

- **Branch de trabalho:** `claude/frontend-project-access-vdaerz`.
- **`main`** já tem o PR #26 (marca/fornecedor, lentes por encomenda, confiança/
  explicação). **Todo o resto abaixo está na branch, aberto no PR #27**
  (https://github.com/gabrielbulhoes/nova_otica/pull/27) → `main`, CI verde
  (build-test + db-migrations). Até mergear, buildar/deployar a partir da **branch**.
- Typecheck (API+web) limpo; testes **53 (planning) / 24 (web)**; build OK.

```
72a6357 Catálogo de marcas: fornecedor canônico + mix premium por loja
b552755 Motor de estratégia comercial (piso · risco · janela)
b735794 Decisões: cards de remanejamento acionáveis (aprovar/dispensar)
a8a172d Portal de Decisões: cards unificados (compra + remanejamento + liquidação)
b8a79d7 Tira GMAIS (CD) da matemática e lentes do remanejamento
```
> **PR #27** consolida esta branch na `main` (CI verde). Mergear para o sócio
> pegar tudo com um `git pull` da `main`.

---

## 3. O que foi feito nesta rodada (feedback do cliente + benchmark do concorrente "Chico")

### 3.1 Ajustes de dados/regra
1. **Marca × fornecedor.** No ERP o campo "marca" é o **fornecedor**; a marca
   real (grife) vem na descrição. `extractBrand()` extrai a grife; relatórios
   separam por marca; compras agrupam por fornecedor.
2. **Lentes por encomenda** (grade da rede = 0, `isMadeToOrderLens`) saem da
   ruptura e dos relatórios de estoque; ficam só no faturamento.
3. **GMAIS fora da matemática.** Flag `Store.excludeFromPlanning` (migração
   `4_exclude_from_planning`), marcada no sync por `PLANNING_EXCLUDED_STORE_PATTERN`
   (padrão `GMAIS`). Escopo central em `modules/stores/store.scope.ts`, aplicado
   em remanejamento, insumos de compra, ruptura, cobertura, giro, análise e mix.
   Na demo, `demo.ts` filtra lojas com nome `/gmais/i`.
4. **Lentes não se transferem.** Operacional usa por padrão o recorte `principal`
   (óculos de grau/sol + relógio). Regra fixa: lente nunca é transferida.
5. **Explicação + confiança.** Cada decisão tem `friendlyReasonFor` (💡 texto) e
   `decisionConfidence` (%).

### 3.2 Paridade com o Chico (novas telas)
6. **Página Decisões (cards)** — `apps/web/src/pages/Decisions.tsx`, rota
   `/admin/decisoes`, API `GET /api/planning/decisions` (função pura
   `buildDecisionCards`). Unifica compra + remanejamento + liquidação em cards
   com tipo, prioridade, impacto R$, ID, explicação, confiança; KPIs e filtros.
   Remanejamento tem **Aprovar transferência** (executa via `createMovement`) e
   **Dispensar**.
7. **Página Estratégia comercial** — `Strategy.tsx`, rota `/admin/estrategia`,
   API `GET /api/planning/strategy` (`buildCommercialStrategy`). Piso · risco ·
   janela → valida contra a capacidade da rede e divide em best-seller /
   lançamento / aposta.

### 3.3 Catálogo de marcas (fornecedor + mix por loja) — da planilha real
8. Planilha `PDVs_Grifes` (Loja · Grife · Grupo · Fornecedor · Status): **103
   grifes, 18 fornecedores, mix 1:1 marca→fornecedor**, 19 lojas em 4 bandeiras
   (A Graciosa, Grand Optical, Oticalli, **ZVC**).
   - Funções puras: `supplierFor(marca)` e `storeCarriesBrand(marca, loja)`
     (grife premium só nas lojas listadas; marca fora do catálogo = todas).
   - Gerador `scripts/build-brand-catalog.mjs` (CSV → `apps/api/data/brand-catalog.json`,
     **gitignorado**). Apelidos confirmados pelo cliente: **Kalid 33/34 → Kalid**,
     **LTX → Moscott**.
   - Loader `modules/planning/brandCatalog.ts` (cache; ausente = permissivo).
   - Wiring: compras agrupam pelo fornecedor canônico; remanejamento respeita o mix.

---

## 4. Arquivos-chave

| Onde | O quê |
| --- | --- |
| `apps/api/src/modules/planning/planning.math.ts` | **Toda a matemática pura** (`@planning`): analyzeProduct, forecastDemand, buildRebalance, buildPurchaseOrders, buildSuggestions, buildDecisionCards, buildCommercialStrategy, extractBrand, isMadeToOrderLens, supplierFor, storeCarriesBrand, matchesProductGroup… |
| `apps/api/src/modules/planning/planning.service.ts` | Consultas Prisma + orquestração (aplica escopo de loja, catálogo, grupos). |
| `apps/api/src/modules/planning/planning.routes.ts` | Rotas `/api/planning/*`. |
| `apps/api/src/modules/planning/brandCatalog.ts` | Loader do catálogo de marcas. |
| `apps/api/src/modules/stores/store.scope.ts` | Escopo "lojas planejáveis" (exclui CDs). |
| `apps/web/src/pages/Decisions.tsx`, `Strategy.tsx` | Novas telas. |
| `apps/web/src/api/demo.ts` | Demo/snapshot (usa `@planning`; espelha a lógica do backend). |
| `apps/web/src/api/client.ts` | Tipos + fetchers do front. |
| `scripts/build-brand-catalog.mjs` | Gera o catálogo de marcas do CSV. |
| `scripts/build-demo-real-data.mjs` | Gera o snapshot real da demo dos fixtures da CDS. |

> **Regra de ouro:** lógica de decisão nova entra em `@planning` (pura, testada)
> e é consumida pelo backend **e** pela demo. Evita divergência entre os dois.

---

## 5. Como rodar, testar e publicar

```bash
npm install
npm run typecheck -w @nova-otica/api && npm run typecheck -w @nova-otica/web
npx vitest run --root apps/api          # 53 testes de planning + demais
npm run test -w @nova-otica/web         # 24 testes

# Demo local (dados fictícios)
VITE_DEMO=1 npm run dev -w @nova-otica/web
```

**Publicar no `novaotica.gb.app.br` (snapshot estático com dados reais):** siga
[`deploy/HANDOFF-ATUALIZAR-SNAPSHOT-REAL.md`](./deploy/HANDOFF-ATUALIZAR-SNAPSHOT-REAL.md)
— resumo: na máquina que tem o snapshot, `git checkout` da branch → garantir/
gerar `demo-real-data.json` → `VITE_DEMO=1 VITE_HASH_ROUTER=1 VITE_BASE=./ npm run build -w @nova-otica/web`
→ zipar o conteúdo de `apps/web/dist/` e subir no HostGator.

**Sistema real (Docker):** `docker compose -f docker-compose.prod.yml up --build -d`
(a API serve o front + `/api`; `SELLBIE_MODE=live` + credenciais no `.env`).
Rodar as migrações do Prisma (inclui `4_exclude_from_planning`).

---

## 6. Carregar o catálogo de marcas (fornecedor + mix)

1. Exportar a planilha `PDVs_Grifes` como **CSV** (Loja, Grife, Grupo, Fornecedor, Status).
2. `node scripts/build-brand-catalog.mjs caminho/PDVs_Grifes.csv`
   → gera `apps/api/data/brand-catalog.json` (gitignorado).
3. No **backend live**, deixar esse arquivo presente (ou apontar `BRAND_CATALOG_PATH`)
   e reiniciar. Sem o arquivo, tudo segue permissivo (comportamento anterior).
4. Efeito: compras agrupam pelo fornecedor canônico (Kering, Marcolin, Luxottica…)
   e o remanejamento não sugere uma grife premium para loja que não a trabalha.

> **Confirmar com o cliente:** a planilha cobre só as **grifes premium**; as
> marcas correntes (Ray-Ban, Oakley, Chilli Beans, Technos…) valem para **todas**
> as lojas — é assim que o código trata marcas fora do catálogo.

---

## 7. Segurança / dados sensíveis (não violar)

- **Credenciais da CDS** (`SELLBIE_*` / x_api_key / x_api_token / x_cliente_id):
  só no `.env` (gitignorado). Nunca em commit, PR, código ou artefato. Repo é público.
- **Gitignorados (dado comercial real):** `apps/web/src/api/demo-real-data.json`,
  `apps/api/data/brand-catalog.json`, `apps/api/tmp/` (fixtures da sonda).
  Não commitar; não publicar em endereço aberto (o snapshot tem faturamento/estoque).
- Não expor o identificador interno do modelo em nada versionado.

---

## 8. Pendências do cliente e backlog

**Aguardando o cliente:**
- Login/senha do **Chico** para o benchmark direto (task #43).
- Confirmar: **Kalid 33 = Kalid 34** (feito), **LTX = Moscott** (feito); a lista de
  grifes premium está completa? (mix por loja).

**Backlog (tasks):**
- **#42 Mix por bandeira** — núcleo pronto (catálogo + wiring). Falta: mostrar o
  **fornecedor nos relatórios do front** e **carregar o catálogo na demo/snapshot**
  (hoje o mix/fornecedor só vale no backend live).
- **#43 Benchmark Chico** — depende do acesso.
- **#46 Enriquecimento de dados** — formato de rosto/armação de fontes externas,
  alimentando o provador AR (o grande diferencial citado pelo cliente).
- **#47 Cards de decisão: aprovar/recusar com persistência** — hoje "Aprovar
  transferência" executa e "Dispensar" é local. Falta status persistente
  (aprovado/recusado/crítico >1mês) + gráfico aprovados×recusados (Dashboard
  Gerencial do Chico).

**Próximo passo sugerido:** mergear o PR #27 na `main`, depois #42
(fornecedor no relatório + catálogo na demo) ou #47 (persistência dos cards).

---

## 9. Contexto de negócio útil

- 4 bandeiras / 19 lojas; **GMAIS** é CD (fora das contas).
- Só se transfere **óculos de grau, óculos de sol e relógio** (lentes não).
- Fornecedores são os distribuidores (Luxottica, Marcolin, Kering, Safilo,
  Marchon, DeRigo, Kenerson, Prestige, Moscott, Kalid…), 1:1 com a grife.
- O concorrente "Chico" (chicoai.com.br) é a referência de UX: portal de cards
  de decisão + motor de estratégia + enriquecimento de dados.
