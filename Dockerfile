# ── Build ────────────────────────────────────────────────────────────────────
FROM node:20-bookworm AS build
WORKDIR /app

COPY package*.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
# Gera o Prisma Client + compila a API e builda o frontend (base "/").
RUN npm run build --workspace=@nova-otica/api \
 && npm run build --workspace=@nova-otica/web

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# A VERSÃO PUBLICADA, carimbada na imagem em tempo de build.
#
# Sem isto, "isso já está no ar?" não tem resposta conferível de fora — e a
# pergunta importa: em 8/8/2026 um parecer afirmou ao cliente que dois
# consertos estavam publicados enquanto a esteira de deploy estava quebrada
# havia dois dias. Ninguém percebeu porque não havia onde olhar.
#
# Fica vazia quando alguém constrói a imagem à mão sem passar o argumento; o
# `/health` responde `null` nesse caso, que é honesto. Inventar "desconhecida"
# ou cair no `package.json` daria a impressão de resposta.
ARG GIT_SHA=""
ENV NODE_ENV=production \
    SERVE_WEB=true \
    WEB_DIST_DIR=/app/apps/web/dist \
    API_PORT=3333 \
    GIT_SHA=$GIT_SHA

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY docker/entrypoint.sh ./entrypoint.sh

EXPOSE 3333
CMD ["sh", "./entrypoint.sh"]
