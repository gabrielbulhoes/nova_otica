-- A VENDA QUE VOLTOU NÃO É VENDA — rodada final final · contagem geral.
--
-- Aditiva e reversível de fato: duas colunas com valor padrão e um índice.
-- Nenhuma linha existente muda de significado — `devolvido` nasce `false`, que
-- é exatamente o que a plataforma assumia até aqui. O efeito só aparece quando
-- a sincronização regravar os itens com o status do ERP.
ALTER TABLE "SaleItem" ADD COLUMN IF NOT EXISTS "statusItem" TEXT;
ALTER TABLE "SaleItem" ADD COLUMN IF NOT EXISTS "devolvido" BOOLEAN NOT NULL DEFAULT false;

-- "Itens de venda de um produto que não voltaram" é a consulta quente de todo
-- o motor (giro, cobertura, curva ABC, sugestão de compra).
CREATE INDEX IF NOT EXISTS "SaleItem_devolvido_productId_idx" ON "SaleItem"("devolvido", "productId");

-- E o mesmo um nível acima: a venda inteira cancelada. O faturamento sem
-- recorte de produto soma `Sale.total`, não os itens — sem esta coluna o
-- cabeçalho do BI contaria uma venda que a tabela abaixo dele não conta.
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "cancelada" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "Sale_cancelada_idx" ON "Sale"("cancelada");
