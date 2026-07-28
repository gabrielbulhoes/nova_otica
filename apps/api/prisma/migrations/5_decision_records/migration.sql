-- Governança da decisão: trilha de auditoria dos cards do Planejamento.
CREATE TYPE "DecisionOutcome" AS ENUM ('APPROVED', 'REJECTED');

CREATE TABLE "DecisionRecord" (
    "id"         TEXT NOT NULL,
    "cardId"     TEXT NOT NULL,
    "cardType"   TEXT NOT NULL,
    "outcome"    "DecisionOutcome" NOT NULL,
    "note"       TEXT,
    "impact"     DECIMAL(14,2) NOT NULL,
    "cardSeenAt" TIMESTAMP(3),
    "productId"  TEXT,
    "storeId"    TEXT,
    "decidedBy"  TEXT NOT NULL,
    "decidedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DecisionRecord_cardId_idx" ON "DecisionRecord"("cardId");
CREATE INDEX "DecisionRecord_decidedAt_idx" ON "DecisionRecord"("decidedAt");
CREATE INDEX "DecisionRecord_decidedBy_idx" ON "DecisionRecord"("decidedBy");
CREATE INDEX "DecisionRecord_outcome_decidedAt_idx" ON "DecisionRecord"("outcome", "decidedAt");

ALTER TABLE "DecisionRecord" ADD CONSTRAINT "DecisionRecord_decidedBy_fkey"
  FOREIGN KEY ("decidedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DecisionRecord" ADD CONSTRAINT "DecisionRecord_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DecisionRecord" ADD CONSTRAINT "DecisionRecord_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
