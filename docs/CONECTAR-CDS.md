# Conectar a plataforma à API CDS (dados reais)

Passo a passo para ligar a sincronização real. Rode **no ambiente onde a
plataforma alcança a CDS** (o servidor de vocês) — o host do conector é um
endereço interno, que não é acessível de qualquer rede.

## 1. Configurar as credenciais (no `.env`, nunca no Git)

No `.env` do backend (`apps/api/.env`), preencha:

```env
SELLBIE_MODE=live
SELLBIE_BASE_URL=http://<host-cds>:<porta>/conectorCDS
SELLBIE_API_KEY=<x_api_key>
SELLBIE_API_TOKEN=<x_api_token>
SELLBIE_CLIENT_ID=<x_cliente_id>
SELLBIE_IGNORE_WINDOW=false
SELLBIE_WINDOW_START=06:00
SELLBIE_WINDOW_END=07:00
TZ=America/Recife
```

> Os valores reais de host/porta e das três chaves foram enviados
> separadamente (fora do repositório).

> As três chaves são os cabeçalhos `x_api_key`, `x_api_token` e `x_cliente_id`
> da CDS. O `.env` é ignorado pelo Git (`.gitignore`) — as credenciais nunca
> vão para o repositório.
>
> **Janela de horário — 06:00 às 07:00, e ela é real.** Este documento afirmava
> que a CDS não definia janela e mandava `SELLBIE_IGNORE_WINDOW=true`. Estava
> errado: a documentação de filtros enviada pela Sellbie (04/08/2026) termina com
> *"Horário permitido para uso: 06:00 até 07:00"*.
>
> `TZ=America/Recife` não é detalhe: sem fuso explícito o container roda em UTC e
> a janela cai às 03h em Natal, antes de a rede abrir.
>
> **Consequência operacional:** o sync fora da janela é recusado — o run vai a
> `FAILED` com o motivo registrado, e nada é lido. Isso vale também para a
> primeira sincronização manual (`runOnce.js`). **A virada para `live` tem que
> acontecer entre 06:00 e 07:00**, não "quando estiver pronto".

## 1.1 Filtros de cada rota, e o que acontece sem eles

Da documentação da Sellbie. Os padrões importam mais que os filtros:

| Rota | Filtros | Sem filtro, devolve |
|---|---|---|
| `lojas`, `cores`, `tamanhos` | nenhum | tudo |
| `produtos` | `date_start`, `date_end` (`dataInclusao`) | **só o último mês** |
| `clientes` | `date_start`, `date_end`, `cod_client` | tudo |
| `vendedores` | `date_start`, `date_end`, `seller` | tudo |
| `vendas`, `detalhesVendas`, `pagamentosVendas` | `date_start`, `date_end` (`dataVenda`) | **só o último mês** |
| `estoque` | `cod_loja` **obrigatório**, `cod_prod`, `only_disp` | — |

Datas em `aaaa-mm-dd`. Informar só uma das duas filtra **aquele dia**, não um
intervalo aberto.

Três coisas que decorrem disso:

1. **O catálogo inteiro exige data explícita.** `syncProducts` passa
   `date_start: '2000-01-01'` de propósito. Sem isso viriam só os produtos
   cadastrados nos últimos 30 dias, e a curva ABC nasceria pela metade — sem
   erro nenhum aparecendo.
2. **O padrão de vendas é um mês.** É a explicação mais provável para a amostra
   de 7 dias que apareceu na fotografia de 13/07: ou a rede vendeu só naqueles
   dias, ou a sonda passou filtro. O primeiro sync real resolve a dúvida — se
   vier um mês inteiro, era da extração.
3. **Estoque é uma chamada por loja.** São 22 lojas, dentro de uma janela de uma
   hora. Vale cronometrar o primeiro sync completo.

## 2. Sondar a CDS (captura de amostras + teste de conexão)

```bash
npm run cds:probe --workspace=@nova-otica/api
```

O script chama cada endpoint GET (`lojas`, `vendedores`, `cores`, `tamanhos`,
`produtos`, `clientes`, `vendas`, `detalhesVendas`, `pagamentosVendas`,
`estoque`) e imprime um resumo com status, nº de registros e os **campos do
primeiro registro** de cada rota. As respostas brutas ficam em
`apps/api/tmp/cds-fixtures/*.json` (pasta ignorada pelo Git).

- **Tudo ✅:** a conexão e a autenticação estão corretas.
- **Os normalizadores já estão calibrados com amostras reais** (sonda de
  13/07/2026): rotas em snake_case, `estoquegrade` em MAIÚSCULAS com estoque
  aninhado por filial, datas com placeholder `1900-01-01`, typo `categora`,
  `codigo_venda` repetido entre lojas (identidade composta loja-venda) e
  `contasPagar` exigindo `situacao` na prática. Se uma nova sonda mostrar
  campo divergente, envie os fixtures que ajustamos com teste.

## 3. Importar o histórico e sincronizar

Sincronização avulsa (uma rodada completa agora):

```bash
# Em desenvolvimento (com `src` presente):
npm run sync:once --workspace=@nova-otica/api

# Em produção (a imagem só tem `dist` — ver RUNBOOK-ARGOS.md §6):
docker compose -f docker-compose.prod.yml exec app node apps/api/dist/sync/runOnce.js
```

Isso lê a CDS, faz upsert por `externalId` (idempotente) e reconcilia o
estoque. Em produção, o agendador (`SYNC_CRON`, padrão 06:00) roda sozinho;
`SYNC_ON_BOOT=true` dispara uma sincronização ao subir a API.

> **Histórico para a previsão de demanda:** após o primeiro sync completo,
> rode a carga histórica por faixas mensais (idempotente — pode repetir):
>
> ```bash
> npm run sync:backfill --workspace=@nova-otica/api        # 24 meses
> npm run sync:backfill --workspace=@nova-otica/api -- 12  # 12 meses
> ```

## Como os dados alimentam a plataforma

| Endpoint CDS | Alimenta |
| --- | --- |
| `lojas`, `vendedores`, `cores`, `tamanhos` | Cadastros base |
| `produtos` (com `precoCusto`) | Catálogo + custo do capital imobilizado |
| `estoquegrade` (1 chamada, rede inteira) | Saldo por loja (redistribuição inteligente) |
| `vendas` + `detalhesVendas` | Demanda por loja (sugestões de compra e giro) |
| `pagamentosVendas` | BI de formas de pagamento |
| `clientes` | Base de clientes |

## Write-back: vendas online entram no ERP

Pedidos **pagos** na loja online são enviados de volta à CDS pelo
`POST /cds/inserirvenda`:

- automaticamente, como último passo de cada sincronização (`SELLBIE_MODE=live`);
- ou sob demanda: `POST /api/sync/export-orders` (ADMIN).

Regras de segurança do envio (semântica de outbox):

- **`pedidoSite` = número do pedido** (ex.: `NO-XXXX-000`) — referência de
  deduplicação; sucesso carimba `erpExportedAt` e o pedido nunca é reenviado;
- cada envio é **reservado atomicamente** antes do POST: o sync agendado e a
  rota manual nunca enviam o mesmo pedido em duplicidade, mesmo em paralelo;
- **rejeição respondida pelo ERP** (`erpExportError` guarda o status e o corpo
  da resposta) volta à fila automaticamente, até **5 tentativas** — depois o
  pedido sai da fila (evita um pedido "veneno" tentando para sempre) e exige
  correção manual;
- **envio ambíguo** — timeout/queda de rede sem resposta, ou crash entre o
  POST e o carimbo — NUNCA é reenviado automaticamente (a venda pode ter
  entrado no ERP): confira pelo `pedidoSite` e, se não entrou, reprocesse com
  `POST /api/sync/export-orders {"retryStuck": true}`;
- a rota manual exige `SELLBIE_MODE=live` (em demo/mock nada é exportado — e
  nada é carimbado);
- desconto/acréscimo são calculados pela diferença itens × total (a conta
  fecha no ERP mesmo com cupom/frete);
- o vendedor registrado é `SELLBIE_EXPORT_SELLER` (padrão `ECOMMERCE`) — crie
  esse funcionário no CDS para as vendas do site ficarem identificadas;
- CPF/endereço vão vazios (consumidor final) até o checkout coletá-los.

> Confirme com a CDS se o `inserirvenda` deduplica por `pedidoSite`. Se sim,
> reenvios após falha ambígua são 100% seguros e o `retryStuck` pode virar
> automático; se não, mantenham a conferência manual antes de reprocessar.

## Ainda pendente do cliente (fora da API)

- **Prazos de fornecedores** (marca × dias de entrega): cadastrar em
  Planejamento & Compras → Prazos dos fornecedores. Sem isso, vale o padrão
  de 14 dias.
- ~~Custo dos produtos~~ **resolvido**: o conector envia `valor_compra` real
  por produto — o custo do capital imobilizado usa o valor verdadeiro.
