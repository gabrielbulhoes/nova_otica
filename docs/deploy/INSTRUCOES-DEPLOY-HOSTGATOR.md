# Publicar a demo da Nova Ótica no HostGator (gb.app.br)

Guia para o **Hermes** publicar o app (modo demonstração) num domínio/subdomínio
do HostGator. **Não precisa de servidor Node, banco de dados nem `.htaccess`** —
é um site **estático** que roda inteiro no navegador (dados fictícios de
demonstração; nenhum backend ou dado real é exposto).

Tempo estimado: ~10 minutos.

---

## O que você recebe

- **`novaotica-demo-hostgator.zip`** — o site já compilado (arquivos estáticos:
  `index.html` + pasta `assets/`).

O app usa rotas com `#` (ex.: `.../#/admin`) e caminhos **relativos**, então
funciona **em qualquer subdomínio ou subpasta** sem configuração extra de
servidor.

---

## Passo a passo (cPanel → Gerenciador de Arquivos)

Escolha **uma** das opções de endereço. A **Opção A (subdomínio)** é a mais
limpa.

### Opção A — Subdomínio (recomendado): `novaotica.gb.app.br`

1. No **cPanel** do HostGator, abra **Domínios → Subdomínios** (ou
   "Subdomains").
2. Em **Subdomínio**, digite `novaotica`; em **Domínio**, escolha `gb.app.br`.
   O campo **Document Root** será preenchido automaticamente (ex.:
   `public_html/novaotica` ou `novaotica.gb.app.br`). Anote esse caminho.
   Clique em **Criar**.
3. Abra **Arquivos → Gerenciador de Arquivos** e navegue até o **Document Root**
   criado no passo 2.
4. Clique em **Upload** e envie o `novaotica-demo-hostgator.zip`.
5. De volta ao Gerenciador de Arquivos, selecione o `.zip`, clique em **Extrair**
   (Extract) e confirme extrair **naquela mesma pasta**.
6. **Importante:** os arquivos `index.html` e `assets/` precisam ficar
   **diretamente** no Document Root — não dentro de uma subpasta extra. Se a
   extração criou uma pasta a mais (ex.: `dist/`), entre nela, selecione tudo e
   **mova** para o Document Root. Apague o `.zip` depois.
7. Acesse **https://novaotica.gb.app.br** no navegador.

### Opção B — Subpasta: `gb.app.br/novaotica`

1. **Gerenciador de Arquivos** → entre em `public_html`.
2. Crie a pasta `novaotica` (botão **+ Pasta**).
3. Entre em `novaotica`, faça **Upload** do `.zip` e **Extraia** ali (mesmos
   cuidados do passo 6 acima: `index.html` deve ficar em
   `public_html/novaotica/`).
4. Acesse **https://gb.app.br/novaotica/**.

### Opção C — Incorporar (hotlink) numa página existente de gb.app.br

Se você já tem uma página no site e quer só **embutir** o app, use um `iframe`
apontando para a URL publicada na Opção A ou B:

```html
<iframe
  src="https://novaotica.gb.app.br"
  style="width:100%;height:90vh;border:0"
  allow="camera"
  title="Nova Ótica"
></iframe>
```

> O atributo `allow="camera"` é necessário para o **provador virtual (AR)**
> funcionar dentro do iframe.

---

## HTTPS (obrigatório para o provador com câmera)

O provador virtual usa a câmera (`getUserMedia`), que **só funciona em HTTPS**.
O HostGator oferece **SSL grátis (AutoSSL)**:

1. cPanel → **Segurança → SSL/TLS Status**.
2. Marque o domínio/subdomínio e clique em **Run AutoSSL** (Executar AutoSSL).
3. Aguarde alguns minutos e acesse sempre pela URL **`https://`**.

---

## Como testar (validação)

1. Abra a URL publicada. Deve aparecer a tela inicial com duas opções:
   **Painel administrativo** e **Loja online**.
2. Clique em **Painel administrativo** → tela de login.
3. Entre com:
   - **E-mail:** `admin@novaotica.com`
   - **Senha:** qualquer coisa (ex.: `demo`) — é uma demo, aceita qualquer senha.
4. Você verá o dashboard com dados de exemplo, BI, estoque etc. Tem **modo claro
   e escuro** automático (segue o tema do sistema operacional).
5. Em **Loja online**, teste **Provar** (a câmera abre; peça permissão) e
   **Adicionar ao carrinho → Finalizar compra**.

---

## Problemas comuns

- **Página em branco / ícones sem estilo:** provavelmente os arquivos ficaram
  dentro de uma subpasta extra. Garanta que `index.html` está **na raiz** do
  Document Root (Opção A) ou de `public_html/novaotica/` (Opção B).
- **Câmera não abre:** acesse por **https://** (rode o AutoSSL) e permita a
  câmera quando o navegador pedir.
- **404 ao recarregar uma página interna:** não deve ocorrer (as rotas usam
  `#`). Se ocorrer, confirme que você não removeu o `index.html`.

---

## Observações importantes

- Isto é a **versão de demonstração**: os dados são **fictícios e vivem no
  navegador** (nada é salvo no servidor, não há banco de dados). É seguro
  publicar para qualquer pessoa acessar.
- Para o **sistema real** (com backend, banco e dados de verdade, integração com
  a API Sellbie) é preciso um ambiente com **Node.js + PostgreSQL** — o HostGator
  compartilhado geralmente **não** atende; recomenda-se um **VPS/Cloud**
  (ex.: um servidor com Docker). O repositório já tem `Dockerfile` e
  `docker-compose.prod.yml` prontos para isso.

---

## Como atualizar a demo no futuro

Quando houver uma nova versão, você recebe um novo `.zip`. Basta **apagar os
arquivos antigos** do Document Root e repetir o **Upload + Extrair**.
