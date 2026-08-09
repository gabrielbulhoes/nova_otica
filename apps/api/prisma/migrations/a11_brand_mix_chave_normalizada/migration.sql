-- A chave de BrandMix passa a ser a NORMALIZADA — a mesma que a leitura usa.
--
-- (Sobre o `a11` do nome: continua a série explicada no cabeçalho de
-- `a10_brand_mix`. O Prisma ordena as migrações pelo NOME DO DIRETÓRIO, em
-- ordem lexicográfica, e `11_` ordenaria antes de `1_`.)
--
-- O defeito: `listBrandMix` e `discontinuedBrandResolver` comparam por
-- `normBrandKey` (maiúscula, sem acento, espaços colapsados); `setBrandMix`
-- gravava e apagava pela string literal que veio da tela. Desmarcar uma grife
-- por outra forma do mesmo nome apagava zero linhas — sem erro, porque
-- `deleteMany` que não encontra nada é uma operação válida — e a grife
-- continuava fora do mix no motor enquanto a tela dizia que tinha voltado.
--
-- Esta migração alinha o que já está gravado. São três passos, nesta ordem,
-- porque `brand` é UNIQUE e o passo 2 criaria colisão sem o passo 1:
--
--   1. entre as linhas que colapsam na mesma chave, mantém UMA — a marcada
--      como fora do mix vence, e no empate a mais antiga. Manter a marcação é
--      o lado seguro: perder um `discontinued = true` reabre silenciosamente a
--      compra de uma grife que a rede decidiu não trabalhar mais; um
--      `false` a mais é uma linha inerte que a tela mostra e o gestor apaga.
--   2. reescreve `brand` na forma normalizada;
--   3. deixa registrado no comentário da coluna o que ela guarda, para a
--      próxima pessoa que abrir a tabela pelo psql não gravar "Ray-Ban" à mão.
--
-- `translate` em vez de `unaccent`: a extensão `unaccent` não está instalada
-- na produção e criá-la exige superusuário. O mapa abaixo cobre o português e
-- é exatamente o que `String.normalize('NFD')` faz do lado do Node para as
-- letras que aparecem em nome de grife.

-- 1. Dedupe: por chave normalizada, sobrevive a linha com maior prioridade
--    (discontinued primeiro, depois a mais antiga).
DELETE FROM "BrandMix" a
USING "BrandMix" b
WHERE a.id <> b.id
  AND upper(btrim(regexp_replace(
        translate(a."brand", 'àáâãäçèéêëìíîïñòóôõöùúûüýÀÁÂÃÄÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
                              'aaaaaceeeeiiiinooooouuuuyAAAAACEEEEIIIINOOOOOUUUUY'),
        '\s+', ' ', 'g')))
    = upper(btrim(regexp_replace(
        translate(b."brand", 'àáâãäçèéêëìíîïñòóôõöùúûüýÀÁÂÃÄÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
                              'aaaaaceeeeiiiinooooouuuuyAAAAACEEEEIIIINOOOOOUUUUY'),
        '\s+', ' ', 'g')))
  AND (
    (b."discontinued" AND NOT a."discontinued")
    OR (b."discontinued" = a."discontinued" AND b."createdAt" < a."createdAt")
    OR (b."discontinued" = a."discontinued" AND b."createdAt" = a."createdAt" AND b.id < a.id)
  );

-- 2. Normaliza o que sobrou.
UPDATE "BrandMix"
SET "brand" = upper(btrim(regexp_replace(
      translate("brand", 'àáâãäçèéêëìíîïñòóôõöùúûüýÀÁÂÃÄÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
                         'aaaaaceeeeiiiinooooouuuuyAAAAACEEEEIIIINOOOOOUUUUY'),
      '\s+', ' ', 'g')))
WHERE "brand" <> upper(btrim(regexp_replace(
      translate("brand", 'àáâãäçèéêëìíîïñòóôõöùúûüýÀÁÂÃÄÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
                         'aaaaaceeeeiiiinooooouuuuyAAAAACEEEEIIIINOOOOOUUUUY'),
      '\s+', ' ', 'g')));

-- 3. O contrato, onde quem abrir a tabela vai ler.
COMMENT ON COLUMN "BrandMix"."brand" IS
  'Chave NORMALIZADA da grife: maiúscula, sem acento, espaços colapsados (normBrandKey). Grave sempre por setBrandMix — a leitura compara por esta forma.';
