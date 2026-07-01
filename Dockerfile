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
ENV NODE_ENV=production \
    SERVE_WEB=true \
    WEB_DIST_DIR=/app/apps/web/dist \
    API_PORT=3333

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
