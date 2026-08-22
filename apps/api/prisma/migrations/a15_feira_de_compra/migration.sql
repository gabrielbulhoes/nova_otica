-- A FEIRA: o evento de compra de uma coleção junto a um fornecedor.
--
-- O modo contínuo planeja sobre o catálogo que a rede já vende. A feira é o
-- contrário: quase toda peça da oferta nunca foi vendida aqui, porque é coleção
-- nova. A evidência vem do PERFIL da peça, não do histórico dela.
--
-- O concorrente guarda o registro da compra no navegador do comprador
-- ("seus lançamentos ficam neste navegador durante a feira"). É localStorage:
-- monousuário, sem histórico, e some se alguém limpar o cache no meio de uma
-- compra de seis dígitos. Aqui persiste.
CREATE TABLE "PurchaseFair" (
    "id" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    -- A janela de venda como o comprador pensa: quando chega e até quando gira.
    -- O contínuo usa meses; a feira usa datas, porque é evento com calendário.
    "arrivesAt" TIMESTAMP(3),
    "targetAt" TIMESTAMP(3),
    -- Guardados no evento para que reabrir a feira devolva o MESMO plano, e
    -- não o de hoje sobre a oferta de outrora.
    "floorUnits" INTEGER NOT NULL DEFAULT 0,
    "risk" TEXT NOT NULL DEFAULT 'equilibrado',
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseFair_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseFair_status_idx" ON "PurchaseFair"("status");
CREATE INDEX "PurchaseFair_supplier_idx" ON "PurchaseFair"("supplier");

-- A oferta do fornecedor, e o que o comprador de fato levou de cada linha.
CREATE TABLE "PurchaseFairOffer" (
    "id" TEXT NOT NULL,
    "fairId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    -- A GRIFE, nunca o fornecedor — a mesma regra do resto do motor.
    "brand" TEXT NOT NULL,
    "tipo" TEXT,
    "genero" TEXT,
    "formato" TEXT,
    "cor" TEXT,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    -- O dado mais caro do evento: o plano se recalcula a qualquer momento a
    -- partir da oferta, mas o que o comprador decidiu levar não se recalcula.
    "bought" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseFairOffer_pkey" PRIMARY KEY ("id")
);

-- O SKU identifica a peça DENTRO da feira: a mesma referência pode voltar numa
-- coleção seguinte com outro preço. É também o que torna o import idempotente —
-- reenviar a planilha corrige a oferta sem duplicar linha.
CREATE UNIQUE INDEX "PurchaseFairOffer_fairId_sku_key" ON "PurchaseFairOffer"("fairId", "sku");
CREATE INDEX "PurchaseFairOffer_fairId_brand_idx" ON "PurchaseFairOffer"("fairId", "brand");

-- CASCADE: apagar a feira leva a oferta junto. Oferta órfã não tem sentido —
-- ela só existe no contexto do evento que a recebeu.
ALTER TABLE "PurchaseFairOffer" ADD CONSTRAINT "PurchaseFairOffer_fairId_fkey"
    FOREIGN KEY ("fairId") REFERENCES "PurchaseFair"("id") ON DELETE CASCADE ON UPDATE CASCADE;
