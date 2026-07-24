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

## 2. O que mudou

Onde pegar o código: **tudo está na branch
`claude/frontend-project-access-vdaerz`** (é a mais completa). O PR #26 já foi
mergeado na `main`; os itens 4–6 abaixo são commits **posteriores**, ainda na
branch. Faça o build a partir da branch (ver §3.1).

**Já na `main` (PR #26):**
1. **Marca vs. fornecedor.** Marca real **extraída da descrição**
   (`extractBrand`) nos relatórios; compras seguem agrupadas por fornecedor,
   mas cada item mostra a marca real (tabela, cabeçalho e CSV).
2. **Lentes por encomenda** (grade da rede = 0) saem da ruptura e dos
   relatórios de estoque; ficam só no faturamento.
3. **Explicação + confiança** em cada decisão (💡 `friendlyReasonFor` +
   `decisionConfidence`).

**Novo, na branch (feedback do Galbe + benchmark Chico):**
4. **GMAIS fora da matemática.** Centro de distribuição não entra em
   remanejamento, compra, ruptura, cobertura, giro nem relatórios. No
   **snapshot estático** a exclusão é automática — `demo.ts` filtra lojas cujo
   nome casa `/gmais/i` (nenhuma ação sua). No **backend vivo**, há a coluna
   `Store.excludeFromPlanning` (migração `4_exclude_from_planning`) marcada no
   sync por `PLANNING_EXCLUDED_STORE_PATTERN` (padrão `GMAIS`).
5. **Lentes não se transferem.** O operacional (remanejamento/compra) usa por
   padrão o recorte **`principal`** (óculos de grau/sol + relógio). Regra fixa:
   lente nunca é transferida.
6. **Página "Decisões" (cards).** Nova aba no estilo do concorrente: compra +
   remanejamento + liquidação viram cards com prioridade, impacto em R$, ID,
   explicação e confiança; filtros e KPIs; remanejamento com **Aprovar
   transferência** (executa de verdade) e **Dispensar**. Com dados reais é que
   aparecem os cards de **comprar** e **liberar capital com R$** (a base
   fictícia só gera remanejamento).

Estado na origem: typecheck (API+web) limpo, testes **44 planning / 24 web**
passando, build OK, verificação visual OK.

> `extractBrand` é um **heurístico** ("Categoria Marca Cor/Modelo"). Com os
> dados reais, **confira** as marcas nos relatórios; se um fornecedor usar
> outro padrão, ajuste `CATEGORY_WORDS`/`COLOR_WORDS` em `planning.math.ts`.

---

## 3. Passo a passo do deploy

Rode **na sua máquina** (a que tem o snapshot / alcança a CDS), na raiz do repo.

### 3.1 Trazer o código novo
Use a **branch** — ela tem tudo (os itens 4–6 ainda não estão na `main`):
```bash
git fetch origin claude/frontend-project-access-vdaerz
git checkout claude/frontend-project-access-vdaerz && git pull
```
(Se/quando essa branch for mergeada na `main`, aí sim `git checkout main && git pull` basta.)

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
