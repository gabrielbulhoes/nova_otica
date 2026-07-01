# Planejamento — BI em tempo real & Provador Virtual (AR)

Este diretório contém o planejamento **spec-first** das próximas duas grandes
funcionalidades da plataforma Nova Ótica, conduzido pela **metodologia Qodo**.

- [`01-bi-dashboard.md`](./01-bi-dashboard.md) — Dashboard de BI em tempo real.
- [`02-provador-virtual-ar.md`](./02-provador-virtual-ar.md) — Provador virtual (AR) de óculos.

---

## Metodologia Qodo aplicada

A metodologia Qodo trata **integridade de código** ao longo de todo o ciclo,
de forma agêntica e orientada a testes. Aplicamos cinco pilares a cada
funcionalidade:

1. **Spec-first** — antes de qualquer código, definimos comportamento esperado
   e **critérios de aceite** verificáveis. Cada documento aqui é a fonte da
   verdade da feature.
2. **Incrementos pequenos e revisáveis** — o trabalho é quebrado em unidades
   (PRs) que entregam valor observável e cabem numa revisão. Nada de PRs gigantes.
3. **Testes como cidadãos de 1ª classe** — cada incremento nasce com testes
   (unitários, contrato e E2E) cobrindo o comportamento e os casos de borda.
   Cobertura é meta, não subproduto.
4. **Portões de revisão automatizados** — todo PR passa por revisão de
   correção, segurança e cobertura (ex.: `/code-review`, `/security-review`)
   antes do merge.
5. **Feedback contínuo** — telemetria e testes fecham o ciclo; o que a produção
   revela vira spec do próximo incremento.

Cada fase abaixo declara: **Objetivo · Escopo · Critérios de aceite · Testes ·
Portão de revisão**.

---

## Como as duas features se conectam

```
        ┌───────────────────────────────────────────────┐
        │            Plataforma Nova Ótica               │
        │  (estoque ao vivo = sync 06h + movimentações)  │
        └───────────────┬───────────────────┬───────────┘
                        │                   │
             eventos de movimentação/venda  │ disponibilidade + catálogo
                        ▼                   ▼
        ┌───────────────────────┐   ┌───────────────────────────┐
        │  BI em tempo real     │   │  Provador Virtual (AR)     │
        │  (ECharts + SSE)      │   │  câmera → face → óculos 3D │
        └───────────┬───────────┘   └───────────┬───────────────┘
                    │  ◀── métricas de try-on / conversão ──┘
                    │      (o AR alimenta o BI: provas, conversão, heatmap)
                    ▼
             decisões de compra, reposição e mix
```

- O **AR** consome catálogo + **estoque ao vivo** (só provar/reservar o que há
  em estoque) e **gera eventos** (provas, tentativas, conversão).
- O **BI** consome esses eventos e os de estoque/venda para gráficos em tempo real.
- Ambos reaproveitam a **infra de tempo real** (canal SSE) e o **escopo por
  papel** (ADMIN vê a rede; STORE_MANAGER vê a própria loja) já existentes.

---

## "Tempo real": o que é possível hoje (honestidade de arquitetura)

A fonte (Sellbie/CDS) só abre das **06:00–07:00**. Portanto:

| Dado                                   | Frescor real                                  |
| -------------------------------------- | --------------------------------------------- |
| Movimentações internas (transferências, ajustes, reservas) | **Tempo real** (nós controlamos) |
| Provas de AR / eventos de app          | **Tempo real** (nós controlamos)              |
| Estoque da fonte / vendas do ERP       | Atualizado **1×/dia** (última sync das 06h)   |

**Conclusão:** o BI é *genuinamente* em tempo real para tudo que acontece
dentro da plataforma (estoque ao vivo, transferências, provas, reservas). Para
vendas do ERP, o "tempo real" é intradiário limitado à última sincronização —
a menos que integremos captura de venda em tempo real (POS/webhook), fora do
escopo atual da API. O painel deixará explícito o *timestamp da fonte* em cada
visão para não induzir a erro.

---

## Roadmap consolidado (sprints de ~2 semanas) — revisado pós-decisões

Com **3D total (D2)** e **checkout completo (D4)**, o programa ganha uma trilha
de **pipeline de assets 3D** (contínua, paralela) e um **épico de e-commerce**.

| Sprint | BI Dashboard | Provador AR | E-commerce / Assets 3D |
| ------ | ------------ | ----------- | ---------------------- |
| **S1** | Agregação `/api/bi/*` + testes | Spike + ADR do provider | Gateway (Mercado Pago?) + **pipeline de ingestão 3D** |
| **S2** | SSE + KPIs/gauges + colunas/pizza | `ProductAsset` + render 3D de 1 SKU | Ingestão dos primeiros SKUs (curva A) |
| **S3** | Sankey + timelines + heatmap | Módulo AR web (câmera→landmarks→render) | Model `Order`/`Cart` + carrinho |
| **S4** | Filtros + escopo + export + perf | Calibração (DIP/escala) + oclusão + foto | Checkout + pagamento (PIX/cartão) |
| **S5** | Telemetria do AR no BI | Provar→disponibilidade→**comprar** | Baixa de estoque na venda + confirmação |
| **S6** | Hardening + materialized views + QA | Matriz de dispositivos + FPS | Conciliação de pagamento + estorno |
| **S7+**| — | Cobertura 3D do catálogo (contínua) | Fretes, cupons, pós-venda |

> A produção de **3D para todos os SKUs** é um trabalho **contínuo** (trilha
> própria), não um sprint único — o app degrada graciosamente para SKUs ainda
> sem modelo (placeholder "em breve") enquanto a cobertura 3D cresce.

Cada célula é decomposta em incrementos Qodo nos documentos de cada feature.

---

## Decisões travadas (ADR)

| # | Decisão | Escolha | Implicação |
| - | ------- | ------- | ---------- |
| D1 | Entrega do AR | **Web-first** (MediaPipe/Jeeliz + Three.js, no app atual) | Sem app store; on-device (LGPD); menor esforço inicial |
| D2 | Assets do AR | **3D total por SKU** | Máxima fidelidade, porém **pipeline de assets vira caminho crítico** de todo o catálogo (ver §Assets) |
| D3 | Biblioteca de BI | **Apache ECharts** (custom) | Uma lib cobre todos os gráficos; integrada ao auth/tema/tempo real |
| D4 | Venda online no MVP | **Checkout completo** (carrinho + pagamento + baixa) | Adiciona um **épico de e-commerce** e a escolha de **gateway de pagamento** |
| D5 | Transporte de tempo real | **SSE + React Query** (recomendação técnica) | Simples, unidirecional; fallback de polling |

> **Consequência de D2 + D4:** o escopo cresceu em duas frentes pesadas —
> produção de **3D para 100% dos SKUs** e um **e-commerce transacional**. O
> roadmap abaixo já reflete isso (sprints extras de pipeline 3D e de checkout).

### Decisão derivada em aberto — gateway de pagamento (por causa de D4)
Checkout completo exige um provedor de pagamento. **Recomendação: Mercado Pago**
(forte no Brasil, PIX + cartão + boleto, SDK maduro) — alternativas: Pagar.me,
Stripe, PagSeguro. *A confirmar antes do épico de e-commerce.*
