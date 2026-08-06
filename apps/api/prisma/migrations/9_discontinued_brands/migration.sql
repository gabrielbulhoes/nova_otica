-- Feedback 6.0 · item 03 — "sugestão de compra sugere grifes que vendemos
-- pouquíssimo e que inclusive não fazem mais parte de nosso mix de produto".
--
-- O piso de giro anual resolve a primeira metade ("vendemos pouquíssimo") por
-- medição. A segunda metade não é mensurável: que a rede parou de trabalhar
-- uma grife é uma decisão comercial, e nenhum dado do ERP a expressa. Precisa
-- ser declarada — e por isso vira um campo que a operação controla.
--
-- Fica em SupplierSetting porque ali já existe o registro de marca/fornecedor
-- com prazo de entrega e a tela que o edita: uma grife descontinuada é a mesma
-- entidade, com mais um atributo.
ALTER TABLE "SupplierSetting" ADD COLUMN "discontinued" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "SupplierSetting_discontinued_idx" ON "SupplierSetting"("discontinued");
