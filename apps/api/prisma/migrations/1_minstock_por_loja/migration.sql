-- Estoque mínimo específico por loja×produto (sobrepõe Product.minStock).
ALTER TABLE "StockItem" ADD COLUMN "minStock" INTEGER;
