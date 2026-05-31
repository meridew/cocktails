# syntax=docker/dockerfile:1
# Cocktails API — Hono on Node 24 with built-in node:sqlite.
FROM node:24-alpine
WORKDIR /app

# Full monorepo context; .dockerignore keeps node_modules/dist out.
COPY . .
RUN npm install --omit=dev -w @cocktails/api

ENV NODE_ENV=production
ENV PORT=8787
ENV DB_PATH=/data/cocktails.sqlite
EXPOSE 8787
VOLUME ["/data"]

WORKDIR /app/apps/api
CMD ["node", "src/server.ts"]
