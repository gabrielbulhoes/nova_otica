-- Feedback 6.0 · item 01 — as lojas ZEISS VISION CENTER rodam em OUTRO ERP e o
-- CDS não as atualiza em tempo real. "Por enquanto vamos operar sem elas."
--
-- Deliberadamente NÃO reaproveitamos `excludeFromPlanning`: aquele campo diz
-- "unidade de retaguarda da rede" (GMAIS, ASSISTENCIA, ESTOQUE COMPRAS), e o
-- painel soma essas unidades num indicador rotulado "retaguarda". Marcar a
-- ZEISS ali faria 3 lojas de varejo aparecerem como centro de distribuição —
-- trocaria um erro por outro. São dois motivos diferentes de exclusão, e por
-- isso são dois campos.
ALTER TABLE "Store" ADD COLUMN     "externalErp" BOOLEAN NOT NULL DEFAULT false;

-- Marca as filiais já cadastradas. Mantido em sincronia com
-- EXTERNAL_ERP_STORE_PATTERN (env) — ajuste os dois juntos.
UPDATE "Store" SET "externalErp" = true WHERE "name" ILIKE '%ZEISS%';

-- O escopo planejável passa a filtrar pelos DOIS campos; o índice composto é o
-- que serve às consultas de planejamento, BI e relatórios.
CREATE INDEX "Store_externalErp_idx" ON "Store"("externalErp");
CREATE INDEX "Store_excludeFromPlanning_externalErp_idx" ON "Store"("excludeFromPlanning", "externalErp");
