#!/bin/sh
# Backup do PostgreSQL da Nova Ótica: dump comprimido (formato custom) com
# carimbo de data e expurgo dos antigos. Idempotente e seguro para agendar.
#
# Uso direto (no host, com o compose de produção rodando):
#   POSTGRES_HOST=localhost ./docker/backup.sh
# Ou sem instalar cliente no host, via container do banco:
#   docker compose -f docker-compose.prod.yml exec -T db \
#     sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > backup-$(date +%F).dump
#
# Agendamento sugerido (crontab do host) — diariamente às 03:00:
#   0 3 * * * cd /caminho/do/projeto && ./docker/backup.sh >> /var/log/nova-otica-backup.log 2>&1
set -e

BACKUP_DIR="${BACKUP_DIR:-/var/backups/nova-otica}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PGUSER="${POSTGRES_USER:-nova_otica}"
PGDB="${POSTGRES_DB:-nova_otica}"
PGHOST="${POSTGRES_HOST:-db}"
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/nova-otica-$STAMP.dump"

# Autenticação não-interativa (para cron/CI): use DATABASE_URL completo OU
# POSTGRES_PASSWORD; sem nenhum dos dois, cai no ~/.pgpass. Assim o pg_dump
# nunca fica travado esperando senha.
[ -n "${POSTGRES_PASSWORD:-}" ] && export PGPASSWORD="$POSTGRES_PASSWORD"

echo "Gerando backup em $FILE…"
if [ -n "${DATABASE_URL:-}" ]; then
  pg_dump -Fc "$DATABASE_URL" > "$FILE"
else
  pg_dump -h "$PGHOST" -U "$PGUSER" -Fc "$PGDB" > "$FILE"
fi

echo "Expurgando backups com mais de $RETENTION_DAYS dias…"
find "$BACKUP_DIR" -name 'nova-otica-*.dump' -type f -mtime +"$RETENTION_DAYS" -delete

echo "Backup concluído: $FILE"
# Restauração:
#   pg_restore -h "$PGHOST" -U "$PGUSER" -d "$PGDB" --clean --if-exists "$FILE"
