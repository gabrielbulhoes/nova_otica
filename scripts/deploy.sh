#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy da Nova Ótica na VPS.
#
# É ESTE script que o `authorized_keys` do usuário `deploy` executa como forced
# command. A chave que o GitHub Actions guarda não abre shell: o servidor
# ignora o comando recebido e roda só isto. Se a chave vazar, o que o atacante
# ganha é o direito de reimplantar a mesma branch — não uma sessão na máquina.
#
# Rodar à mão também funciona (é o mesmo caminho):
#   sudo -u deploy /srv/nova-otica/scripts/deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RAIZ="${NOVA_OTICA_DIR:-/srv/nova-otica}"
BRANCH="${NOVA_OTICA_BRANCH:-main}"
COMPOSE="docker compose -f docker-compose.prod.yml"

cd "$RAIZ"

echo "── Nova Ótica · deploy em $(date -Iseconds) ──"
echo "versão atual: $(git rev-parse --short HEAD)"

# Guarda o que está no ar AGORA: é para cá que o rollback volta.
ANTERIOR=$(git rev-parse HEAD)
echo "$ANTERIOR" > .ultima-versao-boa.tmp

echo "── Buscando $BRANCH ──"
git fetch --prune origin "$BRANCH"
# `reset --hard` e não `pull`: a VPS não é lugar de merge. O que vale é
# exatamente o que está no remoto, sem estado local para divergir.
git reset --hard "origin/$BRANCH"
echo "nova versão: $(git rev-parse --short HEAD)"

if [ ! -f .env ]; then
  echo "ERRO: falta o .env de produção em $RAIZ." >&2
  echo "      cp .env.production.example .env && chmod 600 .env && preencha." >&2
  exit 1
fi

echo "── Construindo a imagem ──"
$COMPOSE build app

echo "── Subindo (as migrações rodam no entrypoint) ──"
$COMPOSE up -d --remove-orphans

echo "── Esperando o /health responder ──"
ok=0
for i in $(seq 1 30); do
  if $COMPOSE exec -T app node -e "fetch('http://127.0.0.1:3333/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    ok=1
    break
  fi
  sleep 4
done

if [ "$ok" -ne 1 ]; then
  echo "── A nova versão NÃO ficou saudável. Voltando para $ANTERIOR ──" >&2
  $COMPOSE logs --tail=80 app >&2 || true
  # Rollback do código. Atenção: migração de banco NÃO volta — o Prisma aplica
  # só migrações aditivas em produção, e desfazer schema automaticamente seria
  # mais perigoso que o problema. Se a falha for de migração, é intervenção
  # manual, com o dump de /var/lib/docker/volumes/nova_otica_backups em mãos.
  git reset --hard "$ANTERIOR"
  $COMPOSE build app
  $COMPOSE up -d
  echo "rollback concluído para $ANTERIOR" >&2
  exit 1
fi

# Imagens antigas se acumulam e enchem o disco da droplet — que é o modo mais
# comum de uma VPS pequena parar sozinha semanas depois do deploy.
docker image prune -f >/dev/null 2>&1 || true

rm -f .ultima-versao-boa.tmp
echo "── Deploy concluído: $(git rev-parse --short HEAD) ──"
$COMPOSE ps
