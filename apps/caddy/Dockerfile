# syntax=docker/dockerfile:1
# Caddy with the Caddyfile baked in — so no host bind-mount is needed
# (the deploy runs docker-out-of-docker, where host paths don't line up).
FROM caddy:2-alpine
COPY infra/Caddyfile /etc/caddy/Caddyfile
