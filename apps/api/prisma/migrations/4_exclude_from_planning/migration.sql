-- AlterTable: filiais fora da matemática de planejamento (ex.: GMAIS = CD,
-- ASSISTENCIA e ESTOQUE COMPRAS = unidades não-varejo sem venda ao cliente)
ALTER TABLE "Store" ADD COLUMN     "excludeFromPlanning" BOOLEAN NOT NULL DEFAULT false;

-- Marca centros de distribuição e unidades não-varejo já existentes pelo
-- nome (GMAIS, ASSISTENCIA, ESTOQUE COMPRAS), para não entrarem no
-- remanejamento/compra/ruptura. Mantido em sincronia com
-- PLANNING_EXCLUDED_STORE_PATTERN (env) — ajuste os dois juntos se necessário.
UPDATE "Store" SET "excludeFromPlanning" = true
  WHERE "name" ILIKE '%GMAIS%' OR "name" ILIKE '%ASSISTENCIA%' OR "name" ILIKE '%ESTOQUE COMPRAS%';

-- Índice para os filtros de escopo (lojas planejáveis).
CREATE INDEX "Store_excludeFromPlanning_idx" ON "Store"("excludeFromPlanning");
