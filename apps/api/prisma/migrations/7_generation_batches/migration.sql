-- Lote de geração dos cards de decisão.
-- O motor recalcula tudo a cada sincronização; sem registrar o lote não há
-- como responder "quando isso foi calculado?" nem "o que apareceu de novo?".

CREATE TYPE "BatchSource" AS ENUM ('CRON', 'MANUAL');

CREATE TABLE "GenerationBatch" (
    "id" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "BatchSource" NOT NULL,
    "trigger" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "cardsTotal" INTEGER NOT NULL,
    "cardsNew" INTEGER NOT NULL,
    "compra" INTEGER NOT NULL,
    "remanejamento" INTEGER NOT NULL,
    "liquidacao" INTEGER NOT NULL,
    "impactTotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "GenerationBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GenerationBatch_generatedAt_idx" ON "GenerationBatch"("generatedAt");

-- Uma linha por CARD distinto (o id do card é determinístico), não por
-- aparição: guardar a primeira aparição é o que mede a idade real do card.
CREATE TABLE "CardSighting" (
    "cardId" TEXT NOT NULL,
    "cardType" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timesSeen" INTEGER NOT NULL DEFAULT 1,
    "batchId" TEXT NOT NULL,

    CONSTRAINT "CardSighting_pkey" PRIMARY KEY ("cardId")
);

CREATE INDEX "CardSighting_firstSeenAt_idx" ON "CardSighting"("firstSeenAt");
CREATE INDEX "CardSighting_lastSeenAt_idx" ON "CardSighting"("lastSeenAt");

ALTER TABLE "CardSighting" ADD CONSTRAINT "CardSighting_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "GenerationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
