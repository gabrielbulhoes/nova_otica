# Publicar a demo da Nova Ótica no HostGator (gb.app.br)

Guia para o **Hermes** publicar o app (versão de **demonstração**) num
domínio/subdomínio do HostGator. **Não precisa de servidor Node, banco de dados
nem, na prática, de `.htaccess`** — é um site **estático** que roda inteiro no
navegador, com **dados fictícios** (nenhum backend ou dado real é exposto).

Tempo estimado: ~10–15 minutos (fora a espera do certificado SSL na 1ª vez).

---

## Antes de começar (pré-requisitos)

- [ ] Acesso ao **cPanel** do HostGator (URL de login + usuário e senha).
- [ ] O domínio **gb.app.br** já ativo/apontado nessa conta HostGator.
- [ ] O arquivo **`novaotica-demo-hostgator.zip`** baixado no seu computador.
- [ ] Um navegador atualizado (Chrome, Edge ou Safari) para testar a câmera.

### Glossário rápido (1 linha cada)

- **Document Root** = a pasta onde ficam os arquivos do site daquele endereço.
  O cPanel mostra o caminho ao criar o subdomínio.
- **Provador virtual (AR)** = recurso que usa a **câmera** para experimentar as
  armações no rosto. A câmera do navegador **só liga em páginas `https://`**.
- **assets** = a pasta com os arquivos de código/estilo do site (JS/CSS).

---

## Sobre este pacote (importante)

O `.zip` foi gerado especificamente para **hospedagem estática simples**: as
rotas usam `#` (ex.: `.../#/admin`) e os caminhos são **relativos**. É isso que
permite publicar **em qualquer subdomínio ou subpasta sem `.htaccess`** e sem
dar erro 404 ao recarregar.

> ⚠️ Essa facilidade vem do **build correto** — não do build padrão do projeto.
> Se um dia alguém regerar o pacote, o comando é:
> ```bash
> VITE_DEMO=1 VITE_HASH_ROUTER=1 VITE_BASE=./ npm run build -w @nova-otica/web
> ```
> (o resultado fica em `apps/web/dist/`).

**Confira o pacote antes de subir:** abra o `index.html` do zip num editor de
texto — os scripts devem começar com `./assets/…` (com o ponto). Depois, ao
abrir o app, a URL deve conter `#` (ex.: `.../#/admin`). Se **não** houver `#` e
a página quebrar ao recarregar, o pacote foi gerado errado — peça um novo zip.

---

## Passo a passo (cPanel → Gerenciador de Arquivos)

Escolha **uma** opção de endereço. A **Opção A (subdomínio)** é a mais limpa.

### Opção A — Subdomínio (recomendado): `novaotica.gb.app.br`

1. No **cPanel**, procure **Subdomínios (Subdomains)**. Em cPanel mais novos
   (Jupiter) pode não existir essa seção separada — nesse caso abra
   **Domínios (Domains) → Criar um novo domínio / Create A New Domain** e
   informe `novaotica.gb.app.br`.
2. O campo **Document Root** será preenchido automaticamente (ex.:
   `public_html/novaotica`). **Anote exatamente o texto que aparecer** — é onde
   você vai subir os arquivos. O formato pode variar; use literalmente o que o
   cPanel mostrar. Clique em **Criar**.
3. Abra **Arquivos → Gerenciador de Arquivos (File Manager)** e navegue até esse
   Document Root.
4. Clique em **Upload** e envie o `novaotica-demo-hostgator.zip`. Volte à pasta.
5. Selecione o `.zip`, clique em **Extrair (Extract)** e confirme extrair
   **nessa mesma pasta**. Apague o `.zip` depois.
6. **Resultado esperado:** `index.html` e a pasta `assets/` devem aparecer
   **diretamente** no Document Root — este zip **não** contém uma pasta `dist/`
   interna; você deve ver `index.html` e `assets/` lado a lado.
   *Só* se por acaso surgir uma subpasta única extra: entre nela, use
   **Selecionar Tudo** (incluindo a pasta `assets/` inteira), clique em
   **Mover (Move)** e informe o caminho do Document Root; confira que `assets/`
   **e** `index.html` chegaram juntos.
7. **Ative o HTTPS** (veja a seção **HTTPS** abaixo) e acesse
   **https://novaotica.gb.app.br**.
8. **Deu certo?** Você deve ver a tela inicial da Nova Ótica com dois botões:
   **Painel administrativo** e **Loja online**. Se aparecer página em branco ou
   uma lista de arquivos, veja **Problemas comuns**.

### Opção B — Subpasta: `gb.app.br/novaotica`

1. **Gerenciador de Arquivos** → entre em `public_html`.
2. Crie a pasta `novaotica` e entre nela.
3. **Upload** do `.zip` e **Extrair** ali (mesmos cuidados do passo 6 da Opção
   A: `index.html` deve ficar em `public_html/novaotica/`, ao lado de `assets/`).
4. Ative o HTTPS (seção abaixo) e acesse **https://gb.app.br/novaotica/**
   — **sempre com a barra final**. O Apache normalmente redireciona para a barra
   e serve o `index.html` automaticamente; se a versão sem barra falhar, use a
   URL com a barra.
5. **Deu certo?** Mesma tela inicial da Opção A (dois botões).

### Opção C — Incorporar (via iframe) numa página existente de gb.app.br

Se você já tem uma página e quer só **embutir** o app, use um `iframe`
apontando para a URL publicada na Opção A ou B:

```html
<iframe
  src="https://novaotica.gb.app.br"
  style="width:100%;height:90vh;border:0"
  allow="camera https://novaotica.gb.app.br"
  title="Nova Ótica (demonstração)"
></iframe>
```

Cuidados (senão a câmera/o app não funcionam):

- **A página onde você cola o iframe também precisa ser acessada por
  `https://`** (não `http://`). Em `http`, o navegador bloqueia o app embutido
  (mixed content) e a câmera não abre, mesmo com `allow="camera"`.
- O `allow="camera <origem>"` **delega a permissão de câmera** à origem do app —
  troque `https://novaotica.gb.app.br` pela URL real onde você publicou (na
  Opção B a origem é `https://gb.app.br`). Áudio não é usado.
- Este site estático **permite** ser embutido (não envia `X-Frame-Options`/CSP
  `frame-ancestors`). Se o iframe aparecer em branco com **"refused to
  connect"**, verifique se um `.htaccess` herdado do `public_html` adicionou
  `X-Frame-Options`/`frame-ancestors` — ajuste-o.
- Se a página hospedeira tiver **Content-Security-Policy**, libere `frame-src`
  para o app e `connect-src`/`script-src` para `cdn.jsdelivr.net` e
  `storage.googleapis.com` (o provador baixa o modelo de IA desses CDNs).

---

## HTTPS (AutoSSL) — faça isto **antes** de acessar por `https://`

O provador virtual usa a câmera, que **só funciona em `https://`**. O HostGator
oferece **SSL grátis (AutoSSL)**:

1. cPanel → **Segurança (Security) → SSL/TLS Status**.
2. Marque o domínio/subdomínio e clique em **Run AutoSSL** (Executar AutoSSL).
   Em muitas contas ele **já roda sozinho** (pode aparecer como *AutoSSL Domain
   Validated*).
3. A emissão pode levar de **alguns minutos a algumas horas na primeira vez**.
   Se o navegador reclamar do certificado, aguarde, recarregue e tente de novo.
4. Acesse sempre pela URL **`https://`**.

---

## Como testar (validação)

1. Abra a URL publicada (por `https://`). Deve aparecer a tela inicial com
   **Painel administrativo** e **Loja online**.
2. Clique em **Painel administrativo** → tela de login.
3. Entre com **qualquer e-mail e qualquer senha** (ex.: `demo@exemplo.com` /
   `demo`). É uma demonstração **sem autenticação**: a senha não é validada, só
   não pode ficar vazia. *(A tela mostra `admin@novaotica.com` / `admin123`
   apenas como exemplo — não é uma credencial real.)*
4. Você verá o dashboard com dados de exemplo, BI, estoque etc.
5. Em **Loja online**, teste **Provar** (a câmera abre; permita o acesso) e
   **Adicionar ao carrinho → Finalizar compra**.

> Observação: o app segue o tema (claro/escuro) do **seu sistema operacional**
> automaticamente — não é preciso configurar nada, e não é item de teste.

---

## Problemas comuns

- **Página em branco / sem estilo:** quase sempre os arquivos ficaram numa
  subpasta extra. Garanta que `index.html` está **na raiz** do Document Root
  (Opção A) ou de `public_html/novaotica/` (Opção B), ao lado de `assets/`.
- **Corrigi os arquivos e ainda vejo página em branco:** é cache do navegador.
  Recarregue sem cache (**Ctrl+F5** / **Cmd+Shift+R**) ou abra numa aba anônima.
- **Erro 403 Forbidden:** (a) confirme que `index.html` está na raiz do Document
  Root; (b) verifique permissões — pastas **755** e arquivos **644**
  (Selecionar Tudo → **Permissions** no File Manager).
- **Tela branca com erro de "MIME type / Failed to load module script" no
  console:** caso raro. Crie um `.htaccess` no Document Root com a linha:
  `AddType text/javascript .js` — é o **único** cenário em que `.htaccess` é
  necessário.
- **A câmera abre, mas a armação não encaixa:** o provador baixa o modelo de IA
  de CDNs externos (`cdn.jsdelivr.net` e `storage.googleapis.com`) e precisa de
  internet aberta a esses domínios. Verifique firewall/adblock/CSP.
- **A câmera não abre:** acesse por **`https://`** (rode o AutoSSL) e permita a
  câmera quando o navegador pedir. Em iframe, veja os cuidados da Opção C.
- **404 ao recarregar uma página interna:** não deve ocorrer (as rotas usam
  `#`). Se ocorrer, o pacote foi gerado sem a configuração correta (veja
  **Sobre este pacote**) — peça um novo zip.

---

## Observações importantes (segurança)

- **Publique apenas o conteúdo do `novaotica-demo-hostgator.zip`** (`index.html`
  + `assets/`). **Nunca** envie a pasta do projeto, arquivos `.env`, o código da
  API ou o `Dockerfile` ao Document Root — não são necessários para a demo e não
  devem ficar públicos.
- Isto é a **versão de demonstração**: os dados são **fictícios e vivem no
  navegador** (nada é salvo no servidor; não há banco). É seguro publicar para
  qualquer pessoa acessar.
- A tela de login **aceita qualquer e-mail e senha** de propósito: **não há
  backend nem usuários** para validar — não é uma falha nem um "backdoor".
  Nenhuma credencial é verificada, armazenada ou transmitida.
- Como o painel parece "de produção", ao divulgar o link deixe claro que é uma
  **demonstração com dados fictícios** (no texto do link/da página).

---

## Atualizar a demo no futuro

Ao receber um novo `.zip`, **apague os arquivos antigos** do Document Root e
repita **Upload + Extrair**. Dica: no File Manager, clique em **Settings** (canto
superior direito) e marque **Show Hidden Files (dotfiles)** para não deixar
arquivos ocultos para trás.

---

## E o sistema real (com backend e dados de verdade)?

A demo é estática. O **sistema real** (API + banco + integração com a API
Sellbie) precisa de **Node.js + PostgreSQL**, que o HostGator compartilhado
geralmente **não** oferece — recomenda-se um **VPS/Cloud com Docker**. O
repositório já traz `Dockerfile` e `docker-compose.prod.yml` prontos:

```bash
docker compose -f docker-compose.prod.yml up --build -d
```
