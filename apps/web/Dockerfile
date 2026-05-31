# syntax=docker/dockerfile:1
# Cocktails web — build the Svelte/Vite PWA, serve the static output via nginx.
FROM node:24-alpine AS build
WORKDIR /app

# --- deps layer: only manifests + lockfile, cached across source changes ---
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

# --- source + build ---
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN npm -w @cocktails/web run build

FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
