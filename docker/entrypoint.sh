#!/bin/sh
set -e
# Aplica as MIGRAÇÕES versionadas no banco e sobe a API (que também serve o web).
#
# `prisma migrate deploy` aplica apenas migrações pendentes de forma segura em
# produção (nunca apaga dados, ao contrário de `db push`).
#
# Se o banco já tiver o schema mas sem histórico de migração (bancos criados
# antes com `db push`), o Prisma retorna P3005 ("schema não vazio"): nesse caso
# fazemos o baseline do 0_init uma única vez e repetimos o deploy.
echo "Aplicando migrações do banco (prisma migrate deploy)…"
if npm run prisma:deploy --workspace=@nova-otica/api 2>/tmp/migrate.err; then
  cat /tmp/migrate.err >&2 || true
elif grep -q 'P3005' /tmp/migrate.err; then
  echo "Banco pré-existente detectado (P3005); fazendo baseline do 0_init…"
  npm run prisma:resolve-init --workspace=@nova-otica/api
  npm run prisma:deploy --workspace=@nova-otica/api
else
  cat /tmp/migrate.err >&2
  exit 1
fi

echo "Iniciando a API…"
node apps/api/dist/server.js
