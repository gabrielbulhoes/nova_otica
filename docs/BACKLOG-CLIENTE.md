# Backlog do cliente — o que depende da A GRACIOSA

Itens que **não são código**: dependem de dado, acesso ou decisão do lado do
cliente. Cada um trava alguma coisa do nosso lado, então o custo de ficar
parado está declarado aqui em vez de virar surpresa na próxima reunião.

Atualizado em 29/07/2026.

---

## 1. Dicionário de atributos dos 500 SKUs mais relevantes

| | |
|---|---|
| **Responsável** | Gabriel (com apoio do Galbe) |
| **Formato** | Planilha — uma linha por SKU |
| **Trava** | Onda 3 inteira (célula de sortimento) |
| **Situação** | Não iniciado |

### O que é
Para cada SKU: **categoria · gênero · formato · material · faixa de preço**.

### Por que é o caminho crítico
Nosso catálogo tem **~0% de atributos estruturados**; o concorrente opera com
98,4%. Sem atributo não existe "célula de sortimento", e sem célula não existe
teto de absorção, lastro nem rota de realização — que é o núcleo do que o
benchmark mostrou.

### O atalho que já mapeamos
**70,8% das descrições** decodificam em `MODELO + CÓDIGO DE COR + CALIBRE`.
Isso dá chave de junção com catálogo de fabricante: se os catálogos EAN
(item 2) chegarem, boa parte do dicionário se preenche sozinha e a planilha
manual cobre só o resto. **Vale esperar o item 2 antes de digitar 500 linhas
à mão.**

---

## 2. Catálogos EAN — Luxottica e os 3 maiores fornecedores

| | |
|---|---|
| **Responsável** | Galbe ("Vou correr com os catálogos") |
| **Formato** | O que o fornecedor mandar (xlsx, csv, pdf) |
| **Trava** | Reduz drasticamente o item 1 |
| **Situação** | Em andamento pelo Galbe |

Com EAN + descrição do fabricante, cruzamos pelo código decodificado da
descrição e importamos atributo de verdade em vez de heurística. É o item de
maior alavancagem da lista: **destrava o 1 quase inteiro**.

---

## 3. VPS + SSH + DNS

| | |
|---|---|
| **Responsável** | Gabriel |
| **Trava** | Sair da demo estática e ir para produção real |
| **Situação** | Pendente |

Precisamos de:
- VPS provisionada e acesso SSH para o Argos
- DNS `app.novaotica.gb.app.br` apontado

Enquanto não existir, tudo que entregamos roda como **demo estática no
HostGator** — sem sync de verdade, sem cron das 6h e, portanto, sem lote de
geração real (as idades dos cards na demo são derivadas, e a tela declara
isso).

---

## 4. Rotação das credenciais do CDS + allowlist de IP

| | |
|---|---|
| **Responsável** | Gabriel, junto à Sellbie/CDS |
| **Trava** | Requisito de segurança para ir a produção |
| **Situação** | Pendente |

As credenciais atuais circularam durante o desenvolvimento. Antes de subir:
1. **Rotacionar** `x_api_key`, `x_api_token` e `x_cliente_id`
2. **Restringir por IP** o acesso ao conector, liberando só o IP da VPS

As novas credenciais vivem apenas em `apps/api/.env` na VPS — nunca em
arquivo versionado, print ou log. O repositório é **público**.

---

## 5. Publicação da demo no HostGator

| | |
|---|---|
| **Responsável** | Gabriel |
| **Trava** | Nada — é o passo de entrega de cada versão |
| **Situação** | Recorrente |

Descompactar o zip na pasta do site, mantendo a senha de diretório.
Login da demo: Galbe / Gabriel / Victor.

---

## 6. Decisões de produto ainda em aberto

| Assunto | Pergunta | Quem decide |
|---|---|---|
| Módulo de laboratório | Lente e tratamento saíram da análise de marca e terão módulo próprio. Qual o escopo mínimo dele? | Galbe |
| SKUs a R$ 0,01 | Há SKUs com preço simbólico que distorcem as faixas de preço. Corrigir no ERP ou tratar como exceção no nosso lado? | Galbe |
| Razão social como rótulo | Fornecedores aparecem com razão social longa nos gráficos. Manter, ou cadastrar nome curto? | Galbe |

---

## Já respondido — não repetir a pergunta

| Assunto | Resposta | Quando |
|---|---|---|
| ZEISS na análise de marca | Fora. Lente e tratamento são do laboratório e terão módulo próprio | 28/07 · Galbe |
| Origem do lote de geração | Nasce do **cron das 6h**. Sync manual também gera lote, marcado como MANUAL | 29/07 · Gabriel |
