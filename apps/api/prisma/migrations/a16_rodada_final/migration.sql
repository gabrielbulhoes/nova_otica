-- RODADA FINAL DE AJUSTES — a base que os nove itens do feedback dividem.
--
-- Três mudanças, nenhuma destrutiva: coluna nova com padrão, tipo novo, índice
-- novo. Nada é apagado nem renomeado, e as colunas de texto livre `formato` e
-- `material` de ProductAttribute continuam existindo — são o registro de como
-- cada fonte escreveu, e a auditoria da padronização precisa delas.

-- ── Item 01 · preferência de navegação por usuário ──────────────────────────
-- JSON de propósito: cada preferência nova não pode custar uma migração. A
-- tela trata chave ausente como padrão, então `{}` é o mesmo que "nunca mexeu".
ALTER TABLE "User" ADD COLUMN "preferences" JSONB NOT NULL DEFAULT '{}';

-- ── Item 03 · formato da lente e material da armação em lista fechada ───────
-- "Não identificado" é valor de verdade (a peça foi olhada e não deu para
-- dizer), distinto de NULL (ninguém olhou ainda). As duas situações pedem
-- reações diferentes — rodar o padronizador × pedir a ficha ao fornecedor.
CREATE TYPE "FormatoLente" AS ENUM ('RETANGULAR', 'QUADRADA', 'REDONDA', 'OVAL', 'AVIADOR', 'GATINHO', 'GEOMETRICA', 'WAYFARER', 'MASCARA', 'OUTROS', 'NAO_IDENTIFICADO');
CREATE TYPE "MaterialArmacao" AS ENUM ('ACETATO', 'METAL', 'TITANIO', 'ACO_INOX', 'ALUMINIO', 'INJETADO', 'TR90', 'NYLON', 'MADEIRA', 'COMBINADO', 'OUTROS', 'NAO_IDENTIFICADO');

ALTER TABLE "ProductAttribute"
    ADD COLUMN "formatoLente"    "FormatoLente",
    ADD COLUMN "materialArmacao" "MaterialArmacao",
    -- Procedência POR CAMPO: numa mesma peça o formato pode vir da ficha do
    -- fornecedor e o material da descrição do ERP.
    ADD COLUMN "fonteFormato"    TEXT,
    ADD COLUMN "fonteMaterial"   TEXT,
    -- Quando a sincronização com o ERP escreveu aqui pela última vez. Separado
    -- de `cadastroEm` (ficha do fornecedor) porque são fontes distintas.
    ADD COLUMN "erpEm"           TIMESTAMP(3);

-- O perfil que compõe o mix agrupa por estes dois campos; a tela de compras
-- filtra por eles.
CREATE INDEX "ProductAttribute_formatoLente_idx" ON "ProductAttribute"("formatoLente");
CREATE INDEX "ProductAttribute_materialArmacao_idx" ON "ProductAttribute"("materialArmacao");

-- ── Item 05 · a oferta da feira traz o material ─────────────────────────────
-- O perfil é gênero + formato + material + faixa de preço; a oferta tinha três.
ALTER TABLE "PurchaseFairOffer" ADD COLUMN "material" TEXT;
