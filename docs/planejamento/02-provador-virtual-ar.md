# Feature 2 — Provador Virtual de Óculos (AR)

> Metodologia Qodo: **spec-first · incrementos revisáveis · testes de 1ª classe
> · portões de revisão · feedback contínuo.**

## 1. Objetivo

Permitir que o cliente **abra a câmera** e veja, **em tempo real**, a projeção
de cada armação/óculos do catálogo posicionada e dimensionada sobre o seu
rosto — para provar peças do **estoque** e concluir a **venda online**.

### Jornada do usuário (happy path)
1. Cliente abre um produto elegível → botão **"Provar agora"**.
2. Consentimento de câmera/LGPD → abre a câmera (frontal).
3. Rosto é detectado; a armação 3D é renderizada alinhada (nariz/orelhas),
   acompanhando movimento e rotação em tempo real (~24–30 FPS).
4. Cliente troca de cor/modelo, compara, tira foto.
5. Vê **disponibilidade em estoque** e **reserva/compra** (venda online).
6. Evento de "prova" e "conversão" é enviado ao **BI**.

## 2. Critérios de aceite (nível feature)
- [ ] Funciona **sem instalar app** no fluxo principal (web/mobile browser).
- [ ] Detecção e render em **tempo real** (≥ 24 FPS em aparelho mediano).
- [ ] O óculos acompanha rotação da cabeça (yaw/pitch/roll) e escala com a
  distância; oclusão básica (some atrás do rosto ao virar).
- [ ] Só oferece "provar/reservar" para produtos **com saldo** (estoque ao vivo).
- [ ] **Nenhum dado biométrico é armazenado**; processamento **no dispositivo**;
  consentimento explícito registrado (LGPD).
- [ ] Cada prova gera evento de telemetria (produto, duração, conversão).

## 3. Decisão de tecnologia (a mais importante)

### Opções
| Abordagem | Como | Prós | Contras |
| --------- | ---- | ---- | ------- |
| **A. Web AR (recomendada p/ MVP)** | MediaPipe **FaceLandmarker** (468 pts, WASM/GPU) + **Three.js** (render GLB) no navegador; ou **Jeeliz VTO** (lib open-source especializada em óculos) | Sem instalar; multiplataforma; roda no app atual; on-device (privacidade); custo baixo | Precisão depende de calibração; performance em aparelho fraco; quirks do Safari iOS |
| **B. App nativo** | ARKit *Face Tracking* (iOS/TrueDepth) + ARCore *Augmented Faces* (Android), via React Native/Unity | Melhor precisão (profundidade) e performance; recursos de app | Duas bases nativas; distribuição em lojas; muito mais esforço |
| **C. SDK comercial de ótica** | Fittingbox / Ditto / Wanna / DeepAR / Banuba | Qualidade "de prateleira", assets e fit prontos | Licença recorrente (custo); menos controle; lock-in |

### Recomendação — caminho faseado
- **Fase 1 (MVP):** **Web AR (A)**. Avaliar no *spike* **Jeeliz VTO** (já é
  especializado em óculos e open-source) vs. **MediaPipe + Three.js** (mais
  flexível). Entrega valor rápido, dentro do app atual, sem app store.
- **Fase 2 (escala/qualidade):** se a precisão/negócio exigir, avaliar **SDK
  comercial (C)** ou **app nativo (B)** — a spec do módulo isola o "provider"
  de AR atrás de uma interface, para trocar sem reescrever o resto.

## 4. O gargalo real: assets 3D das armações

Para "projeção **exata** de cada peça", cada SKU precisa de um **modelo 3D
(glTF/GLB)** em escala real, com metadados de fit. **Este é o maior custo
operacional da feature** e precisa de estratégia própria.

### Estratégia de assets (decisão)
- **3D por SKU** (exato): via CAD do fabricante, **fotogrametria** ou serviço
  de **escaneamento 3D**. Preciso, porém caro/demorado por peça.
- **Overlay 2D** (aproximado): PNG frontal da armação alinhado aos olhos.
  Barato e cobre 100% do catálogo, mas sem vista lateral/rotação real.
- **Recomendação — híbrido:** 3D nos **carros-chefe / mais vendidos** (curva A
  do ABC!) e **2D** como *fallback* no restante, evoluindo a cobertura 3D com
  base no que o BI mostrar que mais vende/prova.

### Metadados de fit (por asset)
`frameWidth`, `bridgeWidth`, `templeLength`, `lensHeight`, ponto de ancoragem,
escala de referência — usados para dimensionar corretamente sobre o rosto.

## 5. Precisão e calibração
- **Escala real:** estimar Distância Interpupilar (DIP) pelos landmarks e/ou
  calibrar com objeto de referência (ex.: cartão) — para o óculos não ficar
  grande/pequeno demais.
- **Alinhamento:** ancorar na ponte do nariz; hastes seguindo em direção às
  orelhas; aplicar rotação (yaw/pitch/roll) da cabeça.
- **Oclusão:** máscara do rosto (depth/segmentation) para o óculos sumir ao
  virar de perfil.
- **Iluminação:** *tone mapping* simples p/ o material do óculos combinar com a cena.

## 6. Arquitetura

```
[Câmera do navegador] → getUserMedia
        │ frames
        ▼
[Face tracking on-device]  (MediaPipe FaceLandmarker / Jeeliz)  ← WASM+GPU
        │ landmarks + pose
        ▼
[Render 3D]  Three.js  →  carrega GLB do produto (CDN)  →  compõe sobre o vídeo
        │
        ▼
[UI]  trocar modelo/cor · foto · disponibilidade · reservar/comprar
        │  eventos (prova, conversão)                     ▲ estoque ao vivo
        ▼                                                 │ catálogo + GLB
[Backend Nova Ótica]  /api/ar/*   ── EventBus → BI ──┘
```

### Backend — namespace `/api/ar/*`
- Novo model Prisma **`ProductAsset`**: `productId`, `type` (`GLB_3D`|`OVERLAY_2D`),
  `url`, `fit` (JSON com os metadados), `status`, `version`.
- `GET /api/ar/products` — produtos elegíveis (com asset **e** saldo).
- `GET /api/ar/products/:id/asset` — URL do modelo + metadados de fit.
- `POST /api/ar/tryon-events` — telemetria de prova (alimenta o BI).
- `POST /api/ar/reserve` — reserva a peça provada (reusa `InventoryMovement`
  como reserva) e/ou cria pedido de venda online.
- Upload/gestão de assets (ADMIN): `POST /api/ar/products/:id/asset`.
- Assets 3D servidos por **object storage/CDN** (não pelo app).

### Frontend — módulo `web/src/ar/`
- Provider abstrato `FaceTracker` (implementações: `MediaPipeTracker`,
  `JeelizTracker`) para permitir troca de tecnologia sem reescrever a UI.
- Componente `<VirtualTryOn productId=… />` aberto a partir do catálogo.
- Carregamento *lazy* (a lib de AR só entra no bundle sob demanda).

## 7. Integração com estoque e venda online
- "Provar" só aparece se `availableNow > 0` (estoque ao vivo já existente).
- "Reservar" cria uma **reserva** (movimentação PENDING) segurando a peça.
- "Comprar" inicia o fluxo de **venda online** (novo, escopo relacionado):
  carrinho, checkout/pagamento, e baixa de estoque via movimentação `SALE`.
  *→ Observação: o e-commerce completo é um épico à parte; o AR só precisa do
  gancho de reserva/checkout.*

## 8. Privacidade & LGPD (obrigatório)
- Processamento de imagem **100% no dispositivo**; frames **não** sobem ao servidor.
- **Consentimento** explícito antes de abrir a câmera, com texto claro.
- **Não** armazenar rosto/biometria; telemetria guarda só evento anônimo
  (produto, duração, conversão) — sem imagem.
- Política de privacidade e opção de revogar consentimento.

## 9. Plano incremental (Qodo)

**AR-0 · Spike de tecnologia** *(time-boxed)*
- Escopo: PoC comparando MediaPipe+Three.js × Jeeliz com 1 armação; medir FPS
  e qualidade de fit em iOS Safari e Android Chrome.
- Saída: decisão registrada (ADR) do provider e do formato de asset.

**AR-1 · Modelo de assets + endpoints**
- Escopo: `ProductAsset`, `/api/ar/products`, `/asset`, upload (ADMIN).
- Testes: unit de validação de fit/metadata; contrato dos endpoints; elegibilidade
  (asset + saldo) coberta.

**AR-2 · Módulo AR web (MVP 1 SKU)**
- Escopo: câmera → tracking → render GLB alinhado, com 1 produto real.
- Testes: unit da matemática de fit (landmark→transform); E2E Playwright com
  **câmera mock** (vídeo de amostra) validando pipeline e overlay; budget de FPS.

**AR-3 · Escala do catálogo + fallback 2D**
- Escopo: N produtos; overlay 2D quando não houver 3D; troca de cor/modelo; foto.
- Testes: seleção de provider por asset; regressão visual básica.

**AR-4 · LGPD + provar→reservar/comprar**
- Escopo: consentimento, telemetria `tryon-events`, reserva/checkout.
- Testes: fluxo de consentimento; reserva cria movimentação PENDING; evento chega ao BI.

**AR-5 · Qualidade em dispositivos**
- Escopo: matriz de dispositivos, performance, oclusão/iluminação, acessibilidade.
- Testes: QA em aparelhos reais; medições de FPS/latência; casos de baixa luz.

## 10. Riscos e mitigação
| Risco | Mitigação |
| ----- | --------- |
| **Produção de assets 3D** (custo/tempo) | Híbrido 3D+2D; começar pela curva A; pipeline/serviço de escaneamento |
| Performance em aparelho fraco | Budget de FPS; degradar p/ 2D; resolução adaptativa |
| Precisão de fit | Calibração de DIP; metadados por asset; spike valida antes de escalar |
| iOS Safari (getUserMedia/WebGL) | Testar cedo; provider isolado; fallback |
| LGPD/biometria | On-device, consentimento, zero armazenamento de imagem |
| Manutenção de modelos | Versionar `ProductAsset`; processo de curadoria |

## 11. Definição de pronto (DoD)
Provider de AR isolado atrás de interface; ≥ 24 FPS no aparelho de referência;
elegibilidade por estoque; consentimento LGPD; telemetria no BI; testes
(unit+E2E com câmera mock) verdes; revisão de segurança/privacidade aprovada.

## 12. Decisões que preciso de você
1. **Entrega:** web-first (recomendado) × app nativo × SDK comercial?
2. **Assets:** híbrido 3D+2D (recomendado) × só 2D (rápido/barato) × 3D total?
3. **Venda online:** escopo agora (carrinho/checkout/pagamento) ou só
   **reserva** no MVP e e-commerce depois?
