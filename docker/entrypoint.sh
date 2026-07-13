#!/bin/sh
set -e
# Aplica as migrações versionadas no banco e sobe a API (que também serve o
# frontend). `migrate deploy` é idempotente e seguro para produção — aplica
# apenas as migrações pendentes, sem drift destrutivo (diferente do db push).
echo "Aplicando migrações no banco (prisma migrate deploy)…"
npm run prisma:deploy --workspace=@nova-otica/api
echo "Iniciando a API…"
node apps/api/dist/server.js
