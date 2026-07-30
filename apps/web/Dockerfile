# syntax=docker/dockerfile:1
# Cocktails web — serve the pre-built PWA via nginx.
#
# This image deliberately does NOT build the client. It used to: an `npm ci` +
# `vite build` stage ran inside the image, on the NAS. That box is a 4-core
# Synology sharing memory with two long-lived VMs, SQL Server and Plex, and it
# routinely has under 1 GB available — so BuildKit's frontend was being OOM-killed
# mid-build ("frontend grpc server closed unexpectedly"), and deploy times swung
# between 95s and 256s depending on what else the NAS happened to be doing.
#
# The build now happens wherever there's memory (CI's cloud runner, or a dev
# machine) and `dist/` is shipped in. This image is a file copy.
FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/dist /usr/share/nginx/html
EXPOSE 80
