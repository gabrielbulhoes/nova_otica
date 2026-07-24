-- AlterTable: filiais fora da matemática de planejamento (ex.: GMAIS = CD)
ALTER TABLE "Store" ADD COLUMN     "excludeFromPlanning" BOOLEAN NOT NULL DEFAULT false;

-- Marca centros de distribuição já existentes pelo nome (GMAIS), para não
-- entrarem no remanejamento/compra/ruptura. Ajuste o padrão se necessário.
UPDATE "Store" SET "excludeFromPlanning" = true WHERE "name" ILIKE '%GMAIS%';

-- Índice para os filtros de escopo (lojas planejáveis).
CREATE INDEX "Store_excludeFromPlanning_idx" ON "Store"("excludeFromPlanning");
