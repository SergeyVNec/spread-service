# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Копируем все package.json для npm workspaces
COPY package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json  ./packages/shared/
COPY packages/db/package.json      ./packages/db/
COPY services/cex-futures-engine/package.json ./services/cex-futures-engine/

RUN npm install

# Копируем исходники
COPY packages/shared  ./packages/shared/
COPY packages/db      ./packages/db/
COPY services/cex-futures-engine ./services/cex-futures-engine/

# tsconfig для каждого пакета
RUN printf '{"extends":"../../tsconfig.base.json","compilerOptions":{"outDir":"./dist","rootDir":"."},"include":["**/*.ts","!node_modules"]}' \
    > packages/shared/tsconfig.json
RUN printf '{"extends":"../../tsconfig.base.json","compilerOptions":{"outDir":"./dist","rootDir":"."},"include":["**/*.ts","!node_modules"]}' \
    > packages/db/tsconfig.json
RUN printf '{"extends":"../../tsconfig.base.json","compilerOptions":{"outDir":"./dist","rootDir":"./src"},"include":["src/**/*.ts"]}' \
    > services/cex-futures-engine/tsconfig.json

# Собираем последовательно: shared → db → engine
RUN cd packages/shared && npx tsc --project tsconfig.json
RUN cd packages/db && npx tsc --project tsconfig.json
RUN cd services/cex-futures-engine && npx tsc --project tsconfig.json

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

RUN apk add --no-cache dumb-init

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist      ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/db/dist          ./packages/db/dist
COPY --from=builder /app/packages/db/package.json  ./packages/db/
COPY --from=builder /app/services/cex-futures-engine/dist ./services/cex-futures-engine/dist
COPY --from=builder /app/services/cex-futures-engine/package.json ./services/cex-futures-engine/

ENV NODE_ENV=production

USER node

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "services/cex-futures-engine/dist/main.js"]
