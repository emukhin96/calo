# Образ собирается в GitHub Actions (на VPS 1 ГБ RAM сборка Next.js не поместится)
# и доставляется на сервер через docker save | ssh docker load — см. deploy/VPS.md.

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 \
    # instrumentation.ts при сборке применяет миграции — пусть к одноразовой PGlite
    DATABASE_URL=pglite:/tmp/build-pg
RUN pnpm build

FROM node:22-alpine AS run
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_VERSION=$APP_VERSION \
    # 1 ГБ RAM на сервере: держим кучу Node в узде (лимит контейнера 384 МБ)
    NODE_OPTIONS=--max-old-space-size=256
# Пользователь node (uid 1000) совпадает с deploy на сервере — тома с фото без chown.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
RUN mkdir -p /app/data/photos && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
