-- Permissão granular por tipo de card de decisão.
-- Default [] = "todos os tipos", então nenhum usuário existente perde acesso.
ALTER TABLE "User" ADD COLUMN "allowedCardTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
