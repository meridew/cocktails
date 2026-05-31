# syntax=docker/dockerfile:1
# Cocktails API — Hono on Node 24 with built-in node:sqlite.
FROM node:24-alpine
WORKDIR /app

# --- deps layer: only manifests + lockfile, so it caches across source changes ---
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --omit=dev

# --- source ---
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

ENV NODE_ENV=production
ENV PORT=8787
ENV DB_PATH=/data/cocktails.sqlite
EXPOSE 8787
VOLUME ["/data"]

WORKDIR /app/apps/api
CMD ["node", "src/server.ts"]
