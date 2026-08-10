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
# A SEGUNDA DISTÂNCIA: A VERSÃO DO NODE.
#
# A CI roda Node 20, e roda de propósito — é o que o `Dockerfile` usa
# (`node:20-bookworm`), então a CI só vale como prova sobre a produção se o
# runtime for o mesmo.
#
# Consequência prática, já paga uma vez também: o harness de tela entrou com
# `jsdom@30`, que exige Node `^22.22.2 || ^24.15.0 || >=26`. Passou verde na
# máquina de quem escreveu (Node 22.22.2, satisfazendo por um fio) e quebrou na
# CI com `webidl.util.markAsUncloneable is not a function`. O Node 20 estava
# instalado nessa mesma máquina o tempo todo, e não foi usado.
#
# Este script agora prefere o Node 20 quando ele existe. Quando não existe, ele
# DIZ que está rodando noutro runtime, em vez de deixar a diferença muda — que
# é o que transformou as duas lições acima em incidentes.
#
# Rodar `npm test --workspace=apps/web` antes de dar push, sozinho, NÃO é
# equivalente ao que a CI roda. Este script é.
set -eu

# Caminhos onde um Node 20 costuma estar. O primeiro que existir vence.
for candidato in /opt/node20/bin "$HOME/.nvm/versions/node/v20"*/bin; do
  if [ -x "$candidato/node" ]; then
    PATH="$candidato:$PATH"
    export PATH
    break
  fi
done

VERSAO_NODE="$(node -v)"
case "$VERSAO_NODE" in
  v20.*)
    echo "── Node $VERSAO_NODE — o mesmo da CI e da imagem de produção ──"
    ;;
  *)
    echo "── ATENÇÃO: Node $VERSAO_NODE, e a CI roda v20 ──"
    echo "   A suíte pode passar aqui e quebrar lá (foi o que aconteceu com o"
    echo "   jsdom@30). Instale um Node 20 em /opt/node20 ou via nvm para que"
    echo "   este script possa usá-lo."
    ;;
esac
echo

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
