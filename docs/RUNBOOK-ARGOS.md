# RUNBOOK — Go-live da Nova Ótica com dados reais (CDS)

**Para:** Argos (operação de infraestrutura)
**Repositório:** `gabrielbulhoes/nova_otica` (branch `main`)
**Objetivo:** colocar a plataforma no ar no servidor da rede, conectada à API CDS real, com sincronização diária, e devolver ao time de engenharia o material que falta para fechar a integração (amostras da sonda + 3 respostas da CDS).

**Estado do código quando este runbook foi escrito:** PRs #15 e #16 mesclados; 116 testes verdes no CI; cliente CDS completo (12 rotas GET + `inserirvenda`); write-back de vendas online com trilha de auditoria por pedido. A única parte que ainda depende de informação externa são os **normalizadores** (mapeamento campo a campo das respostas reais) — é exatamente o que os passos 3 e 9 destravam.

---

## 0. Pré-requisitos (confira antes de começar)

- [ ] Servidor Linux com **Docker + Docker Compose v2** e **Node 20+ com npm** (a sonda roda fora do Docker).
- [ ] O servidor **alcança o conector CDS** (host interno HTTP em porta alta — teste no passo 2). Se não alcançar, nada mais funciona: pare e reporte.
- [ ] Credenciais da CDS em mãos: **base URL** (`http://<host>:<porta>/conectorCDS`) e os três valores `x_api_key`, `x_api_token`, `x_cliente_id`. Foram enviados por canal privado (WhatsApp do Gabriel). **Nunca** colocá-los em arquivo versionado, print, log ou ticket.
- [ ] Domínio/DNS apontado para o servidor (para TLS), se o painel for exposto para fora da rede local.

---

## 1. Clonar e configurar o ambiente

```bash
git clone https://github.com/gabrielbulhoes/nova_otica.git
cd nova_otica
cp .env.example .env
```

Edite o `.env` (ele é gitignorado — as credenciais vivem só aqui):

| Variável | Valor | Observação |
| --- | --- | --- |
| `NODE_ENV` | `production` | ativa as guardas de configuração |
| `DATABASE_URL` | `postgresql://nova_otica:<senha-forte>@db:5432/nova_otica?schema=public` | `db` é o serviço do compose |
| `JWT_SECRET` | string aleatória **≥ 24 chars** | `openssl rand -hex 32` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | e-mail real + senha própria | a senha padrão é recusada em produção |
| `WEB_ORIGIN` | `https://painel.<dominio>` | origens explícitas, sem `*` |
| `SELLBIE_MODE` | `mock` por enquanto | **só vira `live` no passo 6** |
| `SELLBIE_BASE_URL` | `http://<host-cds>:<porta>/conectorCDS` | |
| `SELLBIE_API_KEY` / `SELLBIE_API_TOKEN` / `SELLBIE_CLIENT_ID` | os 3 valores da CDS | são os headers `x_api_key` / `x_api_token` / `x_cliente_id` |
| `SELLBIE_IGNORE_WINDOW` | `true` | a doc da CDS não define janela; revisado no passo 4 |
| `SELLBIE_EXPORT_SELLER` | `ECOMMERCE` | precisa existir como funcionário no CDS (passo 8) |
| `SYNC_CRON` | `0 6 * * *` | sincronização diária às 06:00 |
| `TRUST_PROXY` | `true` se houver proxy/NGINX na frente | senão `false` |
| `ALERT_WEBHOOK_URL` | webhook Slack/Discord/n8n | falha do sync avisa aqui — configure |

Variáveis de pagamento (`PAYMENT_PROVIDER`, `MP_*`) e fiscais (`FISCAL_*`): deixe os padrões (`mock`) — a ativação de Mercado Pago e Focus NFe é uma etapa própria, fora deste runbook.

---

## 2. Teste de alcance da CDS (30 segundos)

```bash
curl -sS -m 15 -o /dev/null -w 'HTTP:%{http_code} em %{time_total}s\n' \
  -H "x_api_key: $SELLBIE_API_KEY" \
  -H "x_api_token: $SELLBIE_API_TOKEN" \
  -H "x_cliente_id: $SELLBIE_CLIENT_ID" \
  "$SELLBIE_BASE_URL/cds/lojas"
```

| Resultado | Significado | Ação |
| --- | --- | --- |
| `HTTP:200` | conectividade e autenticação OK | siga ao passo 3 |
| `HTTP:401/403` | credenciais erradas/incompletas | confira os 3 valores (sem espaços/quebras — o `x_cliente_id` veio quebrado em duas linhas no WhatsApp) |
| `HTTP:000` timeout | rede não alcança o conector | firewall/rota/VPN até o host da CDS; resolver antes de continuar |
| `HTTP:404` | base URL errada | confirme o sufixo `/conectorCDS` |

---

## 3. Sonda da CDS — o passo mais importante deste runbook

A sonda chama cada rota GET, salva as respostas brutas e imprime os campos reais de cada uma.

> **Estado (14/07/2026):** a primeira sonda foi executada e os normalizadores
> JÁ estão calibrados com as amostras reais (PR #18). Rodar a sonda de novo no
> servidor definitivo continua útil — a versão atual também captura `/estoque`
> (faltou na 1ª rodada) e `contasPagar` (abertos+pagos) — mas não é mais
> bloqueador de nada.

```bash
npm ci
npm run cds:probe --workspace=@nova-otica/api
```

- Saída esperada: `✅` por rota com `registros=N` e a lista `campos do 1º registro`.
- Amostras ficam em `apps/api/tmp/cds-fixtures/*.json` (pasta gitignorada — pode conter dados de clientes; **não** anexar em lugar público).

**Devolver ao time (canal privado):** o resumo do console **e** os arquivos de `cds-fixtures/`. Sem isso os normalizadores seguem no palpite.

Se alguma rota falhar, registre qual e com que erro — isso também é resultado.

---

## 4. Janela da CDS — RESOLVIDO (13/07/2026)

Verificado ao vivo (HTTP 200 às 22h50 BRT): **não há janela de horário — a API
responde 24h**. Mantenha `SELLBIE_IGNORE_WINDOW=true`. Se a CDS um dia impuser
janela, configure `SELLBIE_WINDOW_START/END` e volte para `false`.

---

## 5. Subir a plataforma (ainda em modo mock)

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

O entrypoint aplica as migrações sozinho (inclusive baseline em banco pré-existente). Verifique:

```bash
curl -s http://localhost:<porta-api>/health        # esperado: {"ok":true,...}
docker compose -f docker-compose.prod.yml logs api | tail -20
```

- [ ] `/health` respondendo (ele valida o banco com SELECT 1).
- [ ] Login no painel com o admin do seed; **troque a senha** no primeiro acesso.
- [ ] Crie os usuários reais (ADMIN + gerentes por loja) em **Usuários**; o sistema impede a rede de ficar sem ADMIN ativo.

---

## 6. Virar a chave: `SELLBIE_MODE=live` + primeira sincronização

> Só depois do passo 3 concluído e dos normalizadores confirmados/ajustados pelo time com base nos fixtures. Se os campos reais divergirem do esperado, o time entrega um ajuste antes desta virada.

1. No `.env`: `SELLBIE_MODE=live`.
2. `docker compose -f docker-compose.prod.yml up -d` (recria a api com a nova env).
3. Sincronização avulsa para validar de ponta a ponta:

```bash
docker compose -f docker-compose.prod.yml exec api npm run sync:once --workspace=@nova-otica/api
# ou, logado como ADMIN no painel: Sincronização → "Sincronizar agora"
```

Verificação:

- [ ] Tela **Sincronização**: run com status SUCESSO, contadores por entidade, sem erros.
- [ ] **Estoque** mostra as lojas e saldos reais; **Dashboard** com vendas do período.
- [ ] Se falhar: o alerta chega no webhook configurado; o erro detalhado fica no run. Erros de *formato* (campo inesperado) → mandar o log ao time junto com os fixtures.

A partir daqui o cron das 06:00 roda sozinho (`SYNC_CRON`).

4. **Carga histórica** (uma vez, após o primeiro sync completo) — alimenta a
   previsão de demanda com 24 meses de vendas; idempotente, pode repetir:

```bash
docker compose -f docker-compose.prod.yml exec api npm run sync:backfill --workspace=@nova-otica/api -- 24
```

---

## 7. Backup — antes de qualquer dado importante existir

```bash
# teste manual agora:
POSTGRES_HOST=localhost ./docker/backup.sh
# agendar (crontab do host), diariamente às 03:00:
0 3 * * * cd /caminho/do/projeto && ./docker/backup.sh >> /var/log/nova-otica-backup.log 2>&1
```

- [ ] Backup manual gerado e **restore testado uma vez** em banco vazio (backup sem restore ensaiado não é backup).
- [ ] Dump diário indo para storage fora do servidor (rclone/S3/etc. — sua escolha).

---

## 8. Preparar o write-back de vendas online (não exige ação de código)

O write-back manda os pedidos **pagos** do site para o ERP (`POST /cds/inserirvenda`) automaticamente no fim de cada sync em modo live, com `pedidoSite` = número do pedido.

- [ ] **Criar no CDS o funcionário `ECOMMERCE`** (ou o valor escolhido em `SELLBIE_EXPORT_SELLER`) — é como as vendas do site ficam identificadas no ERP.
- [ ] Monitoramento: pedidos com `erpExportError` aparecem no alerta do sync. Rejeição respondida pelo ERP tenta de novo sozinha (até 5×); **envio ambíguo (timeout) fica retido de propósito** — confira no ERP pelo `pedidoSite` e, se a venda não entrou, reprocesse com:

```bash
curl -X POST https://<api>/api/sync/export-orders \
  -H "Authorization: Bearer <token-admin>" -H "Content-Type: application/json" \
  -d '{"retryStuck": true}'
```

> Nunca use `retryStuck` sem conferir antes no ERP — a CDS não documenta idempotência e o reenvio cego pode duplicar venda.

---

## 9. Chamado à CDS — resta UMA pergunta

1. O `POST /cds/inserirvenda` **deduplica por `pedidoSite`**? (Se sim, avisem o time — o reprocesso de envios ambíguos pode virar automático.)

Já respondidas em 13/07/2026: ~~janela de horário~~ (não há — 24h, testado ao
vivo) e ~~parâmetros do contasPagar~~ (`situacao` é obrigatória na prática,
apesar de a doc da CDS dizer opcional — já tratado no código). Paginação: as
rotas devolveram volumes grandes sem truncar (21.683 na grade); se a CDS
confirmar algum limite, avise a engenharia.

---

## 10. Cadastros que só a rede pode fornecer (no painel)

- [ ] **Prazos de fornecedores** (marca × dias de entrega) em *Planejamento & Compras → Prazos dos fornecedores*. Sem isso, vale o padrão de 14 dias e o "pedir até" fica impreciso.
- [x] ~~Custo dos produtos~~ **resolvido pelos fixtures**: o conector envia `valor_compra` real por produto — nada a cadastrar.
- [ ] **Estoque mínimo por loja** nos itens críticos (tela de Alertas) — o padrão da rede é `DEFAULT_MIN_STOCK`.

---

## 11. O que NÃO fazer

- **Não** commitar/versionar `.env`, credenciais ou os arquivos de `cds-fixtures/`.
- **Não** expor a porta do Postgres para fora do host (o compose de produção já não expõe; não "destrave").
- **Não** rodar **duas réplicas da API** — o tempo real (SSE) é in-memory nesta fase; réplicas são a Fase 2 com Redis.
- **Não** usar `retryStuck` sem conferência prévia no ERP (risco de venda duplicada).
- **Não** editar os normalizadores (`apps/api/src/integrations/sellbie/types.ts` / `mappers.ts`) por conta própria — mande os fixtures; o time ajusta com teste.

---

## 12. Critérios de conclusão (o que reportar de volta)

| # | Entregável | Como comprovar |
| --- | --- | --- |
| 1 | Resumo da sonda + arquivos `cds-fixtures/` | mensagem privada ao time |
| 2 | Resposta sobre janela real (passo 4) | teste prático + resposta da CDS |
| 3 | Plataforma no ar com `/health` OK e admin com senha trocada | URL + screenshot da tela Sincronização |
| 4 | Primeira sync live SUCESSO com dados reais nas telas | screenshot do run + Estoque |
| 5 | Backup diário agendado e restore testado | linha do cron + log do teste |
| 6 | Funcionário `ECOMMERCE` criado no CDS | confirmação |
| 7 | Respostas das 3 perguntas à CDS (passo 9) | resposta do chamado |
| 8 | Prazos de fornecedores + custos + mínimos cadastrados | confirmação no painel |

Com os itens 1, 2 e 7 em mãos, o time de engenharia fecha os normalizadores e a carga histórica de 12–24 meses (alimenta a previsão de demanda) — esses dois itens ficam do lado do código, não deste runbook.

---

*Referências no repositório: `docs/CONECTAR-CDS.md` (conexão e write-back em detalhe), `README.md` (visão geral), `.env.example` (todas as variáveis comentadas).*
