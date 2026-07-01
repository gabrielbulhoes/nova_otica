#!/bin/sh
set -e
# Aplica o schema no banco e sobe a API (que também serve o frontend).
echo "Aplicando schema no banco (prisma db push)…"
npm run prisma:push --workspace=@nova-otica/api
echo "Iniciando a API…"
node apps/api/dist/server.js
