-- Mix por loja: quais lojas trabalham cada grife.
--
-- Substitui o `premiumStores` do brand-catalog.json — arquivo gitignorado que
-- nunca chegou ao contêiner de produção, deixando a regra de mix permissiva
-- desde sempre (`/health` → `mix.ativo: false`).
--
-- Grife sem nenhuma linha aqui = universal (linhas correntes). Grife com pelo
-- menos uma linha = restrita às lojas listadas.
CREATE TABLE "StoreBrandMix" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreBrandMix_pkey" PRIMARY KEY ("id")
);

-- Uma linha por (grife, loja). O par único é o que torna a gravação da tela
-- idempotente: reenviar a mesma seleção não duplica.
CREATE UNIQUE INDEX "StoreBrandMix_brand_storeId_key" ON "StoreBrandMix"("brand", "storeId");

-- `brand`: o motor carrega o mix inteiro agrupado por grife.
-- `storeId`: a tela de uma loja pergunta o que ela trabalha.
CREATE INDEX "StoreBrandMix_brand_idx" ON "StoreBrandMix"("brand");
CREATE INDEX "StoreBrandMix_storeId_idx" ON "StoreBrandMix"("storeId");

-- CASCADE: loja removida do cadastro leva embora as linhas de mix dela. Sem
-- isso, a grife ficaria restrita a uma loja que não existe mais — ou seja,
-- restrita a lugar nenhum, barrando a rede inteira em silêncio.
ALTER TABLE "StoreBrandMix" ADD CONSTRAINT "StoreBrandMix_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
