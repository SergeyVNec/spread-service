FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json     ./packages/db/
COPY services/api-server/package.json ./services/api-server/

RUN npm install --workspace=packages/shared \
                --workspace=packages/db \
                --workspace=services/api-server

COPY packages/shared ./packages/shared
COPY packages/db     ./packages/db
COPY services/api-server ./services/api-server

RUN npm run build --workspace=packages/shared && \
    npm run build --workspace=packages/db && \
    npm run build --workspace=services/api-server

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json     ./packages/db/
COPY services/api-server/package.json ./services/api-server/

RUN npm install --workspace=packages/shared \
                --workspace=packages/db \
                --workspace=services/api-server \
                --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/db/dist     ./packages/db/dist
COPY --from=builder /app/services/api-server/dist ./services/api-server/dist

EXPOSE 3000
CMD ["node", "services/api-server/dist/main.js"]
