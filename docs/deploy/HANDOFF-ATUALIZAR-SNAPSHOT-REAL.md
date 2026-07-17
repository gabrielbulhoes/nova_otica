# Handoff — publicar as 3 alterações no `novaotica.gb.app.br` (snapshot real)

> **Para o Claude/dev que tem os dados reais** (a máquina/sessão que rodou a
> sonda CDS e gerou o `demo-real-data.json`). Este documento é autocontido:
> contexto, o que mudou, os comandos exatos para reconstruir o snapshot
> estático **com dados reais + as novas alterações**, e como verificar.

---

## 1. Contexto — como o `novaotica.gb.app.br` funciona

O site é um **build estático em modo demo** (`VITE_DEMO=1`), **não** é
full-stack. Ele mostra dados reais porque, no momento do build, existe o
arquivo:

```
apps/web/src/api/demo-real-data.json
```

- `apps/web/src/api/demo.ts` faz `import.meta.glob('./demo-real-data.json')`.
  Se o arquivo existe → a demo estática exibe os **dados reais** da rede
  (agregados, **sem nenhum dado de cliente** por construção). Se não existe →
  cai nos dados fictícios do site público.
- Esse JSON é gerado por `scripts/build-demo-real-data.mjs` a partir dos
  fixtures da sonda CDS (`apps/api/tmp/cds-fixtures/*.json`).
- **`demo-real-data.json` e `apps/api/tmp/` são gitignorados** (`.gitignore`
  linhas 43–44) — contêm números comerciais reais (estoque, faturamento).
  Nunca são commitados. **Só existem na sua máquina.**

Consequência: o snapshot é **congelado**. Qualquer atualização — de **dados**
ou de **código** — exige refazer o build. Não é tempo real.

> Contexto de por que este handoff existe: as 3 alterações foram desenvolvidas
> num ambiente **sem** acesso à CDS e **sem** o `demo-real-data.json` (é
> gitignorado). Lá só dá para gerar o zip com dados fictícios. O build com
> dados reais precisa acontecer **aqui, na sua máquina**, que tem o snapshot.

---

## 2. O que mudou (pedido do cliente)

Três ajustes, todos na branch **`claude/frontend-project-access-vdaerz`**
(PR **#26** → https://github.com/gabrielbulhoes/nova_otica/pull/26):

1. **Marca vs. fornecedor nos relatórios.** A marca real do produto passa a
   ser **extraída da descrição** (`extractBrand`) e usada em todos os
   relatórios (ABC, cobertura, giro, análise de vendas). Nas **sugestões de
   compra**, os itens seguem **agrupados por fornecedor** (o campo `marca` que
   vem do ERP), mas cada item mostra a **marca real** — na tabela, no
   cabeçalho do pedido e no CSV.

2. **Lentes por encomenda.** Lentes sem posição de estoque na rede
   (`isMadeToOrderLens` — soma da grade da rede = 0) saem dos **alertas de
   ruptura** e dos **relatórios de estoque/cobertura/giro**; permanecem
   **apenas no faturamento consolidado**.

3. **Explicação + confiança.** Cada decisão (comprar / remanejar / não
   comprar / liquidar) ganha um **texto curto e amigável** do porquê
   (`friendlyReasonFor`, exibido com 💡) e uma **% de confiabilidade**
   (`decisionConfidence`), mostrada como selo colorido por faixa.

### Arquivos tocados (diff vs `main`)
```
apps/api/src/modules/planning/planning.math.ts     (funções puras: extractBrand, isMadeToOrderLens, decisionConfidence, friendlyReasonFor)
apps/api/src/modules/planning/planning.routes.ts
apps/api/src/modules/planning/planning.service.ts
apps/api/src/modules/reports/reports.service.ts     (relatórios por marca; exclui lentes por encomenda)
apps/api/src/modules/alerts/alerts.service.ts        (exclui lentes por encomenda da ruptura)
apps/api/test/planning.test.ts                       (testes das novas funções)
apps/web/src/api/client.ts                           (novos campos nas interfaces)
apps/web/src/api/demo.ts                             (propaga campos; usa @planning)
apps/web/src/pages/Planning.tsx                      (selos de confiança + notas 💡 + coluna Marca)
```
Estado no ambiente de origem: typecheck (API + web) limpo, testes 40 (planning)
+ 22 (web) passando, build de produção OK, verificação visual na demo OK.

> `extractBrand` é um **heurístico** calibrado para descrições no formato
> "Categoria Marca Cor/Modelo". Ao rodar com os dados reais, **confira** se as
> marcas saem corretas nos relatórios; se algum fornecedor usar outro padrão
> de descrição, ajuste as listas `CATEGORY_WORDS`/`COLOR_WORDS` em
> `planning.math.ts` (perto da função `extractBrand`).

---

## 3. Passo a passo do deploy

Rode **na sua máquina** (a que tem o snapshot / alcança a CDS), na raiz do repo.

### 3.1 Trazer o código novo
Se o PR #26 **já foi mergeado** em `main`:
```bash
git checkout main && git pull
```
Se **ainda não foi mergeado**, use a branch direto:
```bash
git fetch origin claude/frontend-project-access-vdaerz
git checkout claude/frontend-project-access-vdaerz && git pull
```

### 3.2 Garantir o snapshot com dados reais
- Se você **ainda tem** `apps/web/src/api/demo-real-data.json` da carga
  anterior, pode reusá-lo (dados congelados daquele momento) — **pule** para
  3.3.
- Para **dados frescos**, regenere (precisa alcançar a CDS):
  ```bash
  npm run cds:probe -w @nova-otica/api                              # atualiza apps/api/tmp/cds-fixtures/
  node scripts/build-demo-real-data.mjs apps/api/tmp/cds-fixtures   # gera apps/web/src/api/demo-real-data.json
  ```
  > As credenciais da CDS (`SELLBIE_*`) ficam **só no `apps/api/.env`**
  > (gitignorado). **Nunca** commite `.env`, os fixtures, nem o
  > `demo-real-data.json`.

Confirme que o arquivo existe antes de buildar:
```bash
ls -la apps/web/src/api/demo-real-data.json
```

### 3.3 Build do snapshot estático (dados reais + 3 alterações)
```bash
VITE_DEMO=1 VITE_HASH_ROUTER=1 VITE_BASE=./ npm run build -w @nova-otica/web
```
`VITE_DEMO=1` + `demo-real-data.json` presente = dados reais. `VITE_HASH_ROUTER=1`
e `VITE_BASE=./` = compatível com hospedagem estática em qualquer
subpasta/subdomínio (sem `.htaccess`).

**Confira que o snapshot entrou no bundle** (não pode cair no fictício):
```bash
grep -l "" apps/web/dist/index.html >/dev/null && echo "index ok"
# abra o site após subir e cheque os totais reais (faturamento, nº de lojas)
```

### 3.4 Empacotar e subir no HostGator
Zipe o **conteúdo** de `apps/web/dist/` (o `index.html` na **raiz** do zip,
com a pasta `assets/` ao lado — **sem** uma pasta `dist/` por fora):
```bash
cd apps/web/dist && zip -rq ../../../novaotica-real-hostgator.zip . -x '.*' && cd -
```
No cPanel do HostGator, no Document Root do `gb.app.br`:
1. **Apague os arquivos antigos** (`index.html` + `assets/` da versão atual).
2. **Upload** do zip → **Extrair** nessa mesma pasta → apague o zip.

O passo a passo detalhado do cPanel (com prints e troubleshooting de MIME/type)
está em [`INSTRUCOES-DEPLOY-HOSTGATOR.md`](./INSTRUCOES-DEPLOY-HOSTGATOR.md).

> **Proteção de acesso:** o snapshot real tem números comerciais. Mantenha o
> site atrás de senha (`.htaccess`/`.htpasswd`), como já orientado no doc de
> deploy. Não publique o snapshot real em endereço aberto.

---

## 4. Verificação pós-deploy (abrir o site e conferir)

Aba **Planejamento & Compras**:
- [ ] Tabela **"O que comprar"** tem a coluna **Confiança** (selo %) e, sob a
      recomendação, a nota **💡** com o texto amigável.
- [ ] **Redistribuir entre lojas** mostra selo de confiança e nota 💡 por linha.
- [ ] No **pedido por fornecedor**, o cabeçalho traz "Fornecedor: …" e a linha
      "marcas: …"; cada item tem a coluna **Marca** e **Confiança**; o CSV
      exportado tem a coluna **Marca**.

Aba **Relatórios**:
- [ ] A coluna que antes mostrava o **fornecedor** agora mostra a **marca**
      (extraída da descrição). Confira alguns produtos reais.

Aba **Alertas** / ruptura:
- [ ] **Lentes por encomenda** (grade da rede = 0) **não** aparecem mais na
      ruptura nem nos relatórios de estoque/cobertura/giro — só no
      faturamento consolidado.

Se algo divergir por causa das descrições reais, ajuste `extractBrand`
(§2) e refaça 3.3–3.4.

---

## 5. Restrições de segurança (não violar)

- **Credenciais da CDS** (`x_api_key` / `x_api_token` / `x_cliente_id`, URL
  base) vivem **só** em `apps/api/.env` (gitignorado). **Nunca** em commit, PR,
  código, comentário ou artefato publicado. O repositório é público.
- **`demo-real-data.json`** e **`apps/api/tmp/cds-fixtures/`** são gitignorados
  e contêm dados de negócio reais — **não commite** e **não publique aberto**.
- O snapshot **não tem dados de cliente** (o gerador nunca lê `clientes.json`;
  de vendas só entram agregados; de vendedores só o ranking) — mas tem
  estoque/faturamento reais: trate como confidencial.
