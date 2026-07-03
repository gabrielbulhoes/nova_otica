#!/bin/sh
set -e
# Aplica as MIGRAÇÕES versionadas no banco e sobe a API (que também serve o web).
#
# `prisma migrate deploy` aplica apenas migrações pendentes de forma segura em
# produção (nunca apaga dados, ao contrário de `db push`).
#
# Banco PRÉ-EXISTENTE (criado antes com `db push`)? Faça o baseline UMA vez:
#   npx prisma migrate resolve --applied 0_init --schema apps/api/prisma/schema.prisma
echo "Aplicando migrações do banco (prisma migrate deploy)…"
npm run prisma:deploy --workspace=@nova-otica/api
echo "Iniciando a API…"
node apps/api/dist/server.js
