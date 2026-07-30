# Cocktails — one image: the SvelteKit app and its /api, served by adapter-node.
#
# It used to be three (nginx + the client bundle, the API, Caddy). One Node process
# serves both now, which is also what `npm run preview` runs locally, so what gets
# tested and what ships are the same artifact.
#
# This image deliberately does NOT compile. `build/` comes from CI's cloud runner
# (or `npm run build` locally) and is copied in. The NAS is a 4-core Synology
# sharing memory with two VMs, SQL Server and Plex, routinely under 1 GB free —
# BuildKit was being OOM-killed part way through compiling here. The only work left
# on the box is `npm ci --omit=dev` and a file copy.
#
# No `# syntax=` directive on purpose: it makes BuildKit pull and run an external
# frontend container per Dockerfile, and those were dying on the NAS too.
# Debian rather than Alpine: better-sqlite3 is a native module and publishes
# prebuilt binaries for glibc but not musl, so Alpine would compile it from source
# here — on a box that was already being OOM-killed during builds. slim + prebuilds
# means no compiler on the NAS at all. Phase 4 of docs/PLATFORM-PLAN.md deletes this
# file entirely in favour of launchd on the Mac; this keeps it honest until then.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production

# Deps layer, cached across source changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Built elsewhere and downloaded as an artifact; see .github/workflows/nas-deploy.yml.
COPY build ./build

# The migrations are read at runtime, not baked into the bundle — createDb applies
# any outstanding ones on the first query. Without this the container boots and
# immediately fails looking for the folder.
COPY drizzle ./drizzle

# SQLite lives on a volume; the app creates the file on first boot.
ENV DB_PATH=/data/cocktails.sqlite
# Port 80 so the Cloudflare tunnel's existing ingress (http://caddy:80, which lives
# in the dashboard rather than this repo) keeps working — see infra/docker-compose.yml.
ENV PORT=80
EXPOSE 80

CMD ["node", "build/index.js"]
