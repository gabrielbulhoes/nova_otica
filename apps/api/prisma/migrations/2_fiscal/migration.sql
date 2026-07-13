-- CreateEnum
CREATE TYPE "FiscalDocType" AS ENUM ('NFE', 'NFCE');

-- CreateEnum
CREATE TYPE "FiscalDocStatus" AS ENUM ('PROCESSING', 'AUTHORIZED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "FiscalDocument" (
    "id" TEXT NOT NULL,
    "type" "FiscalDocType" NOT NULL,
    "status" "FiscalDocStatus" NOT NULL DEFAULT 'PROCESSING',
    "ref" TEXT NOT NULL,
    "orderId" TEXT,
    "movementId" TEXT,
    "provider" TEXT NOT NULL,
    "accessKey" TEXT,
    "number" TEXT,
    "series" TEXT,
    "danfeUrl" TEXT,
    "xmlUrl" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_ref_key" ON "FiscalDocument"("ref");

-- CreateIndex
CREATE INDEX "FiscalDocument_orderId_idx" ON "FiscalDocument"("orderId");

-- CreateIndex
CREATE INDEX "FiscalDocument_movementId_idx" ON "FiscalDocument"("movementId");

-- CreateIndex
CREATE INDEX "FiscalDocument_status_idx" ON "FiscalDocument"("status");

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "InventoryMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

