-- O "fora do mix" sai de SupplierSetting e ganha tabela própria.
--
-- Sobre o `a10` do nome da pasta: o Prisma ordena as migrações pelo NOME DO
-- DIRETÓRIO, em ordem lexicográfica — não pelo número. Com o esquema sem
-- zeros à esquerda que este projeto usa (`0_`, `1_`, … `9_`), a décima
-- migração chamada `10_brand_mix` ordenaria logo depois de `0_init` e ANTES
-- de `1_minstock_por_loja`. Foi o que aconteceu na primeira tentativa: esta
-- migração rodou em segundo lugar e falhou lendo uma coluna que a `9_` ainda
-- não tinha criado. A letra na frente devolve a ordem correta, porque
-- qualquer letra ordena depois de qualquer dígito.
--
-- A PRÓXIMA CONTINUA A SÉRIE: `a11_`, `a12_`. Não voltar para `11_`, que cairia
-- na mesma armadilha. E não renomear as pastas antigas — os nomes já estão
-- gravados em `_prisma_migrations` na produção, e renomear faria o Prisma
-- tratá-las como migrações novas e tentar aplicá-las de novo.
--
-- A migração 9 pôs `discontinued` em SupplierSetting com este argumento:
-- "uma grife descontinuada é a mesma entidade, com mais um atributo". O
-- argumento estava errado, e a medição no catálogo real mostra onde:
--
--   · SupplierSetting é chaveada por `Product.brand`, que no CDS é o
--     FORNECEDOR — "LUXOTTICA BRASIL PRODUTOS OTICOS E ESPORTIVOS LTDA";
--   · o motor procura a marcação por `analysisBrand`, que é a GRIFE extraída
--     da descrição — "RAY BAN", "ARNETTE", "MIU MIU".
--
-- São dois espaços de nome. Das 16 linhas que a tela oferecia, 7 nunca
-- casariam com nada no motor, e são exatamente as de moda (Danyselle,
-- Luxottica, Technos, Marcolin, Safilo, Marchon — 160 produtos). As 9 que
-- casavam eram de laboratório, por acidente: lente não tem grife na
-- descrição, então `analysisBrand` cai no fornecedor e os nomes coincidem.
-- As 63 grifes que o motor de fato conhece não apareciam na tela.
--
-- Resultado: o recurso do item 03 estava entregue e inerte para o único caso
-- que importa. Separar os dois é o que torna a marcação alcançável.
CREATE TABLE "BrandMix" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "discontinued" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandMix_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrandMix_brand_key" ON "BrandMix"("brand");

CREATE INDEX "BrandMix_discontinued_idx" ON "BrandMix"("discontinued");

-- O que já estava marcado vem junto.
--
-- Em produção esta consulta não move linha nenhuma: a lista está vazia de
-- propósito, porque marcar grife é decisão comercial do cliente e ele ainda
-- não a tomou. Ela existe assim mesmo — a migração precisa estar certa para
-- QUALQUER banco que a receba, e um ambiente de teste com linhas marcadas
-- perderia a marcação em silêncio.
--
-- `gen_random_uuid()` e não cuid: o cuid é do lado do Prisma, e aqui estamos
-- em SQL puro. A coluna é TEXT, então o formato do id não importa para nada
-- além de ser único.
-- Colunas qualificadas pela tabela de origem: sem isso, o Postgres tenta
-- resolver `"discontinued"` contra a tabela de DESTINO do INSERT e recusa a
-- consulta com uma mensagem que aponta para o lugar errado.
INSERT INTO "BrandMix" ("id", "brand", "discontinued", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."brand", true, s."createdAt", s."updatedAt"
FROM "SupplierSetting" s
WHERE s."discontinued" = true;

DROP INDEX "SupplierSetting_discontinued_idx";

ALTER TABLE "SupplierSetting" DROP COLUMN "discontinued";
