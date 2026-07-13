-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "erpExportAttemptedAt" TIMESTAMP(3),
ADD COLUMN     "erpExportAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "erpExportError" TEXT,
ADD COLUMN     "erpExportedAt" TIMESTAMP(3);

