#!/usr/bin/env bash
#
# Roda a suíte do web DUAS vezes: com e sem `demo-real-data.json`.
#
# POR QUE ISTO EXISTE
#
# `apps/web/src/api/demo-real-data.json` é a fotografia do catálogo real da
# rede. Ele é gitignored — contém números comerciais — e por isso **a CI nunca
# o tem**. Quem desenvolve, tem. As duas execuções não são a mesma coisa: sem o
# arquivo, a demonstração cai no catálogo fictício, e o `import.meta.glob` que
# o embarca resolve isso em tempo de build, não em tempo de teste.
#
# Consequência prática, já paga uma vez: um teste que exige "o remanejamento
# nunca transfere lentes" passou verde em toda máquina de desenvolvimento e
# quebrou na CI, porque a lente que violava a regra só existia no catálogo
# fictício. O código estava errado dos dois lados; só um dos lados mostrava.
#
# Rodar `npm test --workspace=apps/web` antes de dar push, sozinho, NÃO é
# equivalente ao que a CI roda. Este script é.
set -eu

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
AMOSTRA="$RAIZ/apps/web/src/api/demo-real-data.json"
GUARDADO="$(mktemp -d)/demo-real-data.json"

restaurar() {
  [ -f "$GUARDADO" ] && mv "$GUARDADO" "$AMOSTRA"
  rmdir "$(dirname "$GUARDADO")" 2>/dev/null || true
}
# Restaura mesmo se a suíte falhar ou o script for interrompido: deixar o
# desenvolvedor sem a amostra seria pior que o problema que viemos resolver.
trap restaurar EXIT INT TERM

echo "── 1/2 · com a amostra real (o que você vê na sua máquina) ──"
if [ -f "$AMOSTRA" ]; then
  npm test --workspace=@nova-otica/web
else
  echo "   (amostra ausente — pulando; esta máquina só consegue rodar o passo 2)"
fi

echo
echo "── 2/2 · SEM a amostra real (o que a CI vê) ──"
[ -f "$AMOSTRA" ] && mv "$AMOSTRA" "$GUARDADO"
npm test --workspace=@nova-otica/web

echo
echo "✓ verde nos dois catálogos"
