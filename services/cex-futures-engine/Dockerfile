# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Turborepo pruning — копируем только нужные пакеты
COPY package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json  ./packages/shared/
COPY packages/db/package.json      ./packages/db/
COPY services/cex-futures-engine/package.json ./services/cex-futures-engine/

RUN npm install --frozen-lockfile

# Копируем исходники
COPY packages/shared  ./packages/shared/
COPY packages/db      ./packages/db/
COPY services/cex-futures-engine ./services/cex-futures-engine/

# Собираем все зависимые пакеты + сервис
RUN npx turbo run build --filter=@spread/cex-futures-engine...

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Только prod зависимости
RUN apk add --no-cache dumb-init

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist  ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/db/dist      ./packages/db/dist
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/services/cex-futures-engine/dist ./services/cex-futures-engine/dist
COPY --from=builder /app/services/cex-futures-engine/package.json ./services/cex-futures-engine/

ENV NODE_ENV=production

USER node

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "services/cex-futures-engine/dist/main.js"]
