# syntax=docker/dockerfile:1
# Cocktails API — Hono on Node 24 with built-in node:sqlite.
FROM node:24-alpine

WORKDIR /app

# Install only the API's production deps (monorepo-aware install).
COPY package.json ./package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
RUN npm install --omit=dev --workspace @cocktails/api --include-workspace-root=false || \
    npm install --omit=dev --prefix apps/api

# Source (TypeScript is run directly by Node 24's type stripping).
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

ENV NODE_ENV=production
ENV PORT=8787
ENV DB_PATH=/data/cocktails.sqlite
EXPOSE 8787
VOLUME ["/data"]

WORKDIR /app/apps/api
CMD ["node", "src/server.ts"]
