# Backlog do cliente — o que depende da A GRACIOSA

Itens que **não são código**: dependem de dado, acesso ou decisão do lado do
cliente. Cada um trava alguma coisa do nosso lado, então o custo de ficar
parado está declarado aqui em vez de virar surpresa na próxima reunião.

Atualizado em 30/07/2026 (segunda leva do dia).

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

## 6. A regra de desconto agora é da rede — e o que ainda falta para ela andar

| | |
|---|---|
| **Responsável** | Galbe (regra) · Gabriel/Sellbie (os dois dados) |
| **Trava** | A variação do desconto sugerido nos cards de liquidação |
| **Situação** | Regra implementada; dois dados pendentes |

Galbe mandou o parâmetro em 30/07 e ele **substituiu** a nossa conta de custo
de carregamento:

> *"Nossa regra atual pra promocionar são as peças fora de coleção do
> fornecedor. E o desconto aumenta 10% a cada 90 dias. Os descontos iniciam com
> 20% ou 30%, depende do preço cheio. Se for abaixo de 1.000 eu coloco 20%,
> acima de 1.000 eu inicio com 30%."*

É o que está na tela hoje: base 20% ou 30% pela faixa de preço, +10 pontos
percentuais a cada 90 dias parada, limitado pelo desconto que zera a margem.

Faltam **três coisas** para a regra funcionar inteira:

**a) A marcação de "fora de coleção".** A regra dele vale para peça fora de
coleção do fornecedor, e esse dado não existe no que consumimos do ERP. O
gatilho hoje é o nosso card de LIQUIDAÇÃO (estoque sem giro), e a tela declara
isso. Se o CDS tiver o campo — ou se vier nos catálogos dos fornecedores —, o
gatilho passa a ser o certo.

**b) Data de entrada da peça em estoque.** É o que move a peça de degrau. Hoje
o "tempo parada" é medido desde a primeira aparição do card, e esse histórico
começou este mês: com 7 a 26 dias, todos os cards ficam no degrau inicial (20%
ou 30%). Com a data real do ERP, os degraus de 90, 180 e 270 dias aparecem no
mesmo dia.

**c) Custo de compra real.** Só **23%** dos produtos têm `valor_compra`. Nos
outros, o custo é estimado em 55% do preço, a margem sai 45% e é ela que vira o
TETO. Isso já **corta** a regra: uma peça acima de R$ 1.000 parada há 180 dias
pediria 50%, e o teto estimado a limita em 45%. A tela avisa quando o teto veio
de custo estimado — mas o número certo depende do ERP.

---

## 7. Ações da plataforma escrevendo no ERP

| | |
|---|---|
| **Responsável** | Gabriel, junto à Sellbie/CDS |
| **Trava** | O pedido de "entrega de excelência" do feedback 05 |
| **Situação** | Pendente de contrato de API |

Galbe: *"idealmente as ações tomadas dentro de nossa plataforma deveriam
movimentar dentro do ERP"*. Concordamos, e metade do caminho já existe: venda
online paga é exportada para o CDS via `inserirvenda`. Falta o equivalente
para **movimentação de estoque entre lojas** — a transferência que o card de
liquidação e a tela de Transferências agora criam.

O que precisamos da Sellbie/CDS:
1. Existe endpoint de **transferência/movimentação** entre filiais? Nome,
   payload e resposta.
2. Ele é **idempotente**? (Precisamos de chave própria para não duplicar em
   retentativa.)
3. Aceita **estorno/cancelamento** de uma movimentação já enviada?

Sem esse contrato, a transferência aprovada aqui continua sendo uma **ordem**
que alguém executa no ERP — que é como a rede opera hoje, só com a decisão
documentada e rastreável.

---

## 8. Decisões de produto ainda em aberto

| Assunto | Pergunta | Quem decide |
|---|---|---|
| Curva ABC por SKU | O recorte de produto vale hoje nas telas de **operação** (Estoque, Produtos, Alertas). Em **Relatórios**, a visão por marca já exclui lente e a visão por SKU ainda cobre tudo. Uma curva ABC sem lente é outro relatório — 57,1% da receita a menos. Aplicar o recorte lá também? | Galbe |
| Módulo de laboratório | Lente e tratamento saíram da análise de marca e terão módulo próprio. Qual o escopo mínimo dele? | Galbe |
| SKUs a R$ 0,01 | Há SKUs com preço simbólico que distorcem as faixas de preço. Corrigir no ERP ou tratar como exceção no nosso lado? | Galbe |
| Razão social como rótulo | Fornecedores aparecem com razão social longa nos gráficos. Manter, ou cadastrar nome curto? | Galbe |

---

## Já respondido — não repetir a pergunta

| Assunto | Resposta | Quando |
|---|---|---|
| ZEISS na análise de marca | Fora. Lente e tratamento são do laboratório e terão módulo próprio | 28/07 · Galbe |
| Origem do lote de geração | Nasce do **cron das 6h**. Sync manual também gera lote, marcado como MANUAL | 29/07 · Gabriel |
| Lente nas telas de operação | Sai por padrão de Estoque, Produtos e Alertas, com seletor no topo do console para trazer de volta. **Não foi apagada**: é estoque real (o print mostrava 56 un. de um antirreflexo) e o módulo do laboratório vai precisar dela | 29/07 · Galbe |
| Categorias vazias no filtro | Removidas. O filtro de tipo de produto só oferece **ARMACAO, OCULOS e RELOGIO** dentro do recorte principal — clicar em "Lentes" e ver 0 produtos era o defeito | 30/07 · Galbe |
| Régua do desconto de liquidação | É a **da rede**: 20% abaixo de R$ 1.000, 30% de R$ 1.000 para cima, +10 p.p. a cada 90 dias parada, com teto na margem. Substituiu a nossa conta de custo de carregamento | 30/07 · Galbe |
| Curva ABC "muito baixa" | Não estava baixa: o recorte de óculos, armação e relógio é **43%** da receita da rede no período. Faltava o denominador na tela, que agora aparece ao lado do total | 30/07 · Gabriel |
