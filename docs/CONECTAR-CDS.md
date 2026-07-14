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
SELLBIE_IGNORE_WINDOW=true
```

> Os valores reais de host/porta e das três chaves foram enviados
> separadamente (fora do repositório).

> As três chaves são os cabeçalhos `x_api_key`, `x_api_token` e `x_cliente_id`
> da CDS. O `.env` é ignorado pelo Git (`.gitignore`) — as credenciais nunca
> vão para o repositório.
>
> **Janela de horário:** a documentação da CDS não define janela de consumo,
> por isso `SELLBIE_IGNORE_WINDOW=true`. Se a CDS impuser uma janela, ajuste
> `SELLBIE_WINDOW_START`/`_END` e volte para `false`.

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
npm run sync:once --workspace=@nova-otica/api
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
