# syntax=docker/dockerfile:1
# Cocktails web — build the Svelte/Vite PWA, serve the static output via nginx.
FROM node:24-alpine AS build
WORKDIR /app
COPY . .
RUN npm install
RUN npm -w @cocktails/web run build

FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
