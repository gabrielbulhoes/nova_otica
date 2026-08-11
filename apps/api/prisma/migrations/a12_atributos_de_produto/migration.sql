-- Atributos de catálogo de fornecedor + teto de desconto do CDS.
--
-- (Sobre o `a12` do nome: continua a série explicada em `a10_brand_mix`. O
-- Prisma ordena as migrações pelo NOME DO DIRETÓRIO, em ordem lexicográfica, e
-- `12_` ordenaria antes de `1_`.)
--
-- POR QUE UMA TABELA, E NÃO COLUNAS EM Product
--
-- `Product` é escrito pela sincronização, por upsert em `externalId`. Estes
-- campos não vêm de lá: vêm de planilha, entram por importador manual e podem
-- estar ausentes para metade do catálogo. Misturá-los com o que o ERP escreve
-- criaria a pergunta "quem venceu" a cada sync, e a resposta errada apagaria o
-- dado do fornecedor em silêncio.
--
-- DUAS FONTES, DUAS CHAVES, DUAS PROCEDÊNCIAS
--
--  · cadastro de fornecedor: casa por `Referência + Código da Cor + Tamanho`,
--    decomposto da descrição do produto. Medido contra o catálogo real: 68% do
--    que tem descrição no formato esperado, e 85% quando a marca está coberta
--    pela planilha. Não casa por GTIN nem por Barra CDS — os dois dão ZERO.
--  · promoção do CDS: casa direto por `externalId` (`codigo_base`).
--
-- Um produto pode ter só uma das duas, e por isso a procedência é por fonte.
-- Uma coluna `importadoEm` única mentiria sobre a metade ausente.

CREATE TABLE "ProductAttribute" (
    "productId"      TEXT NOT NULL,
    "barraCds"       TEXT,
    "referencia"     TEXT,
    "gtin"           TEXT,
    "marcaCatalogo"  TEXT,
    "genero"         TEXT,
    "formato"        TEXT,
    "material"       TEXT,
    "cor"            TEXT,
    "codigoCor"      TEXT,
    "tamanhoLente"   INTEGER,
    "alturaLente"    INTEGER,
    "tamanhoPonte"   INTEGER,
    "tamanhoHaste"   INTEGER,
    "bestSeller"     BOOLEAN NOT NULL DEFAULT false,
    "imagemUrl"      TEXT,
    "fonteCadastro"  TEXT,
    "cadastroEm"     TIMESTAMP(3),
    "maxDiscountPct" DECIMAL(5,2),
    "fonteDesconto"  TEXT,
    "descontoEm"     TIMESTAMP(3),

    CONSTRAINT "ProductAttribute_pkey" PRIMARY KEY ("productId")
);

CREATE INDEX "ProductAttribute_bestSeller_idx"    ON "ProductAttribute"("bestSeller");
CREATE INDEX "ProductAttribute_genero_idx"        ON "ProductAttribute"("genero");
CREATE INDEX "ProductAttribute_marcaCatalogo_idx" ON "ProductAttribute"("marcaCatalogo");

ALTER TABLE "ProductAttribute"
  ADD CONSTRAINT "ProductAttribute_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON COLUMN "ProductAttribute"."marcaCatalogo" IS
  'Marca como o FORNECEDOR a escreve. NÃO é a grife de análise (analysisBrand, extraída da descrição) nem o fornecedor do CDS (Product.brand). Três espaços de nome distintos — confundi-los já custou uma entrega.';
COMMENT ON COLUMN "ProductAttribute"."maxDiscountPct" IS
  'Teto COMERCIAL de desconto definido pelo CDS. Distinto do maxPct que o motor calcula da margem: aquele diz até onde a conta fecha, este até onde a rede pode ir.';
