# Nova Ótica — Gestão de Estoque (E2E)

Plataforma **online, integrada e em tempo real** para gestão de estoque de uma
rede de óticas, com foco em **transferência/troca de produtos entre filiais**,
vendas, clientes e dashboards consolidados.

A fonte dos dados é a **API Sellbie/CDS**, que só pode ser consumida na janela
diária **06:00–07:00**. Por isso a arquitetura combina:

1. **Sincronização diária** (06:00) que espelha todos os dados da fonte no
   banco local; e
2. **Movimentação interna em tempo real** durante o dia (transferências,
   baixas, ajustes), reconciliada na sincronização da manhã seguinte.

O estoque exibido é sempre **"ao vivo"**:
`saldo = base sincronizada + movimentações internas confirmadas − reservas`.

---

## Arquitetura

```
┌────────────────────┐      06:00–07:00       ┌──────────────────────────┐
│  API Sellbie / CDS │  ───────────────────▶  │  Job de sincronização    │
│  (sellbie/*)       │   (pull, 1x ao dia)    │  (node-cron 0 6 * * *)    │
└────────────────────┘                        └────────────┬─────────────┘
                                                            │ upsert idempotente
                                                            ▼
                          ┌──────────────────────────────────────────────┐
   tempo real durante     │           PostgreSQL (Prisma)                │
   o dia (transferências) │  lojas · produtos · estoque · vendas ·       │
        ─────────────────▶│  clientes · movimentações · auditoria        │
                          └────────────────────┬─────────────────────────┘
                                               │ REST  /api/*
                                               ▼
                                  ┌────────────────────────┐
                                  │  Frontend React (Vite) │
                                  │  dashboard · estoque · │
                                  │  transferências · ...  │
                                  └────────────────────────┘
```

### Monorepo

```
nova_otica/
├── apps/
│   ├── api/   # Backend  — Express + TypeScript + Prisma (PostgreSQL)
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   │       ├── integrations/sellbie/   # cliente da API (mock + live), janela, mappers
│   │       ├── sync/                    # motor de sincronização + agendador
│   │       ├── modules/                 # rotas REST (estoque, vendas, movimentações…)
│   │       └── server.ts
│   └── web/   # Frontend — React + Vite + React Query
├── docker-compose.yml   # PostgreSQL
└── .env.example
```

---

## Como rodar (desenvolvimento)

Pré-requisitos: Node 20+, Docker (para o Postgres).

```bash
# 1. Configure o ambiente
cp .env.example .env
cp .env apps/api/.env        # o backend lê o .env da própria pasta

# 2. Instale as dependências (workspaces)
npm install

# 3. Suba o banco
npm run db:up

# 4. Crie o schema no banco
npm run db:migrate           # ou: npm run prisma:push -w @nova-otica/api

# 5. Popule dados de demonstração (modo mock, sem credenciais)
npm run db:seed

# 6. Rode API + Web
npm run dev
#   API → http://localhost:3333   (health: /health)
#   Web → http://localhost:5173
```

> **Modo mock:** com `SELLBIE_MODE=mock` (padrão), o sistema gera um catálogo de
> demonstração e ignora a janela 06:00–07:00 — ideal para desenvolver sem as
> credenciais reais.

### Trocar para a API real (modo live)

No `.env`, defina:

```env
SELLBIE_MODE=live
SELLBIE_BASE_URL=https://<host-da-cds>
SELLBIE_API_KEY=<token>            # ou SELLBIE_USERNAME / SELLBIE_PASSWORD
SELLBIE_IGNORE_WINDOW=false        # respeita a janela 06:00–07:00
```

Em modo live, as chamadas à API só são executadas dentro da janela. Fora dela,
a sincronização registra falha e o app continua servindo a última base
sincronizada + movimentações internas.

---

## Rotas da API (resumo)

| Método | Rota                              | Descrição                                  |
| ------ | --------------------------------- | ------------------------------------------ |
| GET    | `/api/dashboard/summary`          | Indicadores gerais da rede                 |
| GET    | `/api/dashboard/sales-by-store`   | Vendas (30d) por loja                      |
| GET    | `/api/dashboard/low-stock`        | Produtos com saldo baixo                   |
| GET    | `/api/stock`                      | Estoque consolidado (saldo ao vivo)        |
| GET    | `/api/stock/by-product`           | Saldo somado por produto na rede           |
| GET    | `/api/products`                   | Catálogo de produtos                       |
| GET    | `/api/stores`                     | Lojas/filiais                              |
| GET    | `/api/sales`                      | Vendas (filtro por loja/período)           |
| GET    | `/api/customers`                  | Clientes                                   |
| GET    | `/api/movements`                  | Movimentações internas                     |
| POST   | `/api/movements`                  | Cria transferência/baixa/entrada/ajuste    |
| POST   | `/api/movements/:id/confirm`      | Confirma (efetiva no estoque)              |
| POST   | `/api/movements/:id/cancel`       | Cancela                                    |
| GET    | `/api/sync/status`                | Estado da integração e da janela           |
| POST   | `/api/sync/run`                   | Dispara sincronização manual               |

---

## Mapeamento da API Sellbie/CDS

As rotas e filtros da fonte estão em `apps/api/src/integrations/sellbie/`. Como
os **payloads exatos das respostas ainda não foram fornecidos**, os tipos
(`types.ts`) e os normalizadores (`mappers.ts`) foram modelados de forma
tolerante. Ao receber exemplos reais de resposta, ajuste **apenas** esses dois
arquivos — o restante do sistema permanece igual.

Rotas cobertas: `lojas`, `vendedores`, `cores`, `tamanhos`, `produtos`,
`clientes`, `vendas`, `detalhesVendas`, `pagamentosVendas`, `estoque`
(esta exige `cod_loja` por filial).

---

## Próximos passos sugeridos

- Autenticação/perfis de usuário (gerente da rede × gerente de loja).
- Ordem de transferência com fluxo de aprovação e comprovante.
- Relatórios de giro de estoque e curva ABC.
- Notificações de ruptura/estoque mínimo por loja.
- Testes automatizados (Vitest) para mappers e motor de sincronização.
