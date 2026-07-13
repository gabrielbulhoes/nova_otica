-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "erpExportError" TEXT,
ADD COLUMN     "erpExportedAt" TIMESTAMP(3);

