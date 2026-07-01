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

## Roadmap consolidado (sprints de ~2 semanas)

| Sprint | BI Dashboard                                   | Provador AR                                          |
| ------ | ---------------------------------------------- | ---------------------------------------------------- |
| **S1** | Infra de agregação `/api/bi/*` + testes        | Spike de tecnologia (MediaPipe/Jeeliz) + PoC de fit  |
| **S2** | Canal SSE + KPIs/gauges + colunas/pizza        | Modelo `ProductAsset` + pipeline de 1 SKU 3D         |
| **S3** | Sankey de transferências + timelines + heatmap | Módulo AR web (câmera→landmarks→render) MVP 1 SKU     |
| **S4** | Filtros, escopo por papel, export, perf        | Escala p/ catálogo + fallback 2D + LGPD/consentimento |
| **S5** | Telemetria do AR no BI (provas/conversão)      | Fluxo provar→disponibilidade→reservar/comprar        |
| **S6** | Hardening, cache/materialized views, QA        | Matriz de dispositivos, performance (FPS), QA        |

Cada célula é decomposta em incrementos Qodo nos documentos de cada feature.

---

## Decisões pendentes (bloqueiam o início da implementação)

Estas escolhas mudam materialmente o esforço e o custo — ver detalhes e
recomendações em cada documento:

1. **Entrega do AR:** web no app atual (sem instalar) × app nativo × SDK
   comercial de ótica. → *Recomendação: web-first (MediaPipe/Jeeliz).*
2. **Fidelidade/assets do AR:** 3D por SKU (exato, caro) × overlay 2D (barato,
   aproximado) × híbrido. → *Recomendação: híbrido (3D nos carros-chefe, 2D no resto).*
3. **Biblioteca de BI:** Apache ECharts (tudo-em-um) × embutir Metabase/Superset.
   → *Recomendação: ECharts custom (controle + integração).*
4. **Transporte de tempo real:** SSE/polling × WebSockets.
   → *Recomendação: SSE + React Query.*
