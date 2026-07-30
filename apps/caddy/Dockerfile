# Caddy with the Caddyfile baked in — so no host bind-mount is needed
# (the deploy runs docker-out-of-docker, where host paths don't line up).
# No `# syntax=` directive on purpose: it makes BuildKit pull and run an external
# frontend container for every Dockerfile, and on the NAS those were dying with
# "frontend grpc server closed unexpectedly" — even for this file, which only
# copies a config in. Nothing here needs a newer frontend than the built-in one.
FROM caddy:2-alpine
COPY infra/Caddyfile /etc/caddy/Caddyfile
