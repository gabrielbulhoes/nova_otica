# Missão Argos — extrair as fixtures do CDS

**Escopo:** só isto. Nada mais deste documento é trabalho seu — o resto da
cadeia (gerar o dataset, buildar, empacotar, verificar) roda no Claude.

Esta é a **única** etapa bloqueada: o ambiente do Claude não tem rota de saída
para o conector CDS (403 no CONNECT do proxy). Você tem. As credenciais já
existem em `apps/api/.env`; o que falta é alguém do lado certo da rede.

---

## O que entregar

Seis arquivos JSON, numa pasta só:

```
lojas.json
produtos.json
estoquegrade.json
vendas.json
detalhesVendas.json
pagamentosVendas.json
```

Entregue a pasta compactada para o Gabriel. Fim da missão.

---

## Como buscar

**Base e credenciais:** `SELLBIE_BASE_URL`, `SELLBIE_API_KEY` e as demais chaves
em `apps/api/.env`. Não copie esses valores para lugar nenhum além da chamada.

**Cabeçalhos obrigatórios em toda requisição:**

```
x_api_key     x_api_token     x_cliente_id
```

**As seis rotas, com os parâmetros que cada uma exige:**

| arquivo | rota | parâmetros |
|---|---|---|
| `lojas.json` | `GET cds/lojas` | nenhum |
| `produtos.json` | `GET cds/produtos` | `date_start`, `date_end` |
| `vendas.json` | `GET cds/vendas` | `date_start`, `date_end` |
| `detalhesVendas.json` | `GET cds/detalhesVendas` | `date_start`, `date_end` |
| `pagamentosVendas.json` | `GET cds/pagamentosVendas` | `date_start`, `date_end` |
| `estoquegrade.json` | `GET cds/estoquegrade` | `only_disp=1` |

**Janela de datas: 30 dias.** `date_end` = hoje, `date_start` = hoje − 30, no
formato `aaaa-mm-dd`. A demonstração inteira é construída sobre 30 dias de
venda; janela menor deixa buracos nos relatórios, janela maior infla a
cobertura porque o denominador continua sendo 30.

Se quiser reaproveitar código pronto, `apps/api/src/integrations/sellbie/probe.ts`
já faz exatamente essas chamadas — mas ele usa 7 dias e grava em
`apps/api/tmp/cds-fixtures`. Ajuste a janela para 30.

---

## Três detalhes que fazem a entrega falhar

### 1. Cada arquivo tem que ser um ARRAY no topo

O gerador faz `JSON.parse(arquivo).filter(...)` direto. Se o conector devolver
envelope — `{ "data": [...] }`, `{ "registros": [...] }` — **desembrulhe antes
de salvar**. Salvar a resposta crua quebra a etapa seguinte com um erro que não
diz o que houve.

Confira com uma linha antes de entregar:

```bash
for f in lojas produtos estoquegrade vendas detalhesVendas pagamentosVendas; do
  node -e "const a=require('./$f.json');console.log('$f', Array.isArray(a)?'array '+a.length:'NAO E ARRAY')"
done
```

Os seis têm que dizer `array` com contagem > 0. `produtos` deve vir na casa dos
20 mil (a rede tinha 21.683 na última extração) e `estoquegrade` na casa dos
milhares. Número muito menor = janela errada ou resposta truncada.

### 2. NÃO baixe `cds/clientes`

Esse endpoint traz CPF, nome e contato de cliente. O gerador **nunca** lê esse
arquivo — por construção, não por acidente. Baixá-lo só cria PII parada na VPS
sem nenhum uso. Se já baixou por hábito, apague.

Vendedor é diferente e pode vir: do time entra só o ranking agregado (nome e
vendas do período), que é dado de gestão da própria rede.

### 3. Nenhuma credencial sai do `.env`

Nem em log, nem em print, nem em nome de arquivo, nem em mensagem de commit.
**O repositório é público.** As fixtures também não vão para o Git — só a pasta
compactada, direto para o Gabriel.

---

## Se algo não responder

| sintoma | causa provável |
|---|---|
| HTTP 400 em uma rota específica | falta parâmetro obrigatório — confira a tabela acima |
| HTTP 401 / 403 | credencial errada ou IP não liberado no conector |
| resposta vazia com HTTP 200 | janela de datas fora do período com movimento |
| `NAO E ARRAY` na verificação | envelope não desembrulhado (detalhe 1) |

Não invente contorno: registre o que aconteceu, entregue os arquivos que
saíram e diga qual falhou.

---

## O que acontece depois (não é sua parte)

O Gabriel repassa a pasta ao Claude, que roda o gerador, refaz o build da
demonstração e devolve o zip. O ganho concreto: hoje a tela de Lojas conta os
SKUs sobre uma **amostra** de 1.631 do catálogo e avisa isso na tela; com as
fixtures, o número passa a ser o da rede inteira, por filial, e o aviso some.
