# 🤝 Session Handoff — read this first

> Context snapshot so a fresh session (started in **this** folder,
> `C:\Users\danie\vscode-workspace\cocktails`) can continue seamlessly.
> Companion docs: **`PLAN.md`** (roadmap/phases), **`OUTSTANDING.md`** (parked decisions),
> and **`APP-READINESS.md`** (locked design + plan for getting to iOS/Android-app-ready).

## TL;DR
The cocktails party-ordering app has been **fully rebuilt** on a modern self-hosted stack and is
**live on the NAS** (LAN only) with a working **push-to-deploy CI/CD pipeline**. The original
**neo-brutalist design has been faithfully restored**, and a **multi-agent code review** was run
with **two batches of fixes shipped**. All work is on git branch **`modernise`** (pushed to GitHub).
`main` + the legacy flat app are untouched and still serve the live public site until cutover.

The very last thing we were doing: trying to show a **local preview screenshot** — blocked only by a
port clash with the *previous* session's project (this repo was mistakenly opened inside a
`dead-vector` session). That's why we're moving to a new session in the right folder.

---

## 1. Where things live

- **Repo:** `github.com/meridew/cocktails`. Working branch **`modernise`** (pushed; ~13 commits ahead of `main`).
- **Legacy flat app** (still at repo ROOT: `index.html`, `app.js`, `styles.css`, `cocktails.json`,
  `config.js`, `nas/`, `favicon.svg`, `CNAME`) — the *current live public site* via GitHub Pages.
  **Do not break it**; it stays until cutover. `apps/web/src/neo.css` is a **verbatim copy** of root `styles.css`.
- **New monorepo** (the rebuild) under `apps/`, `packages/`, `infra/`, `.github/`, `docs/`.

```
apps/web   Svelte 5 (runes) + Vite + vite-plugin-pwa, bespoke neo-brutalist CSS (neo.css),
           canvas-confetti, self-hosted @fontsource fonts. Talks to /api (Vite proxy / Caddy).
apps/api   Hono on Node 24 + built-in node:sqlite. server.ts / db.ts / config.ts. Dockerfile.
apps/caddy Dockerfile that bakes infra/Caddyfile into a caddy image (no host bind-mount under DooD).
packages/shared  TS contracts: Order, OrderStatus, ORDER_STATUSES, STATUS_META, LIMITS, response envelopes.
infra/     docker-compose.yml, docker-compose.build.yml (build-locally override), Caddyfile,
           .env.example, runner/ (self-hosted GitHub Actions runner compose).
.github/workflows/  deploy.yml = legacy GitHub Pages (live).  nas-deploy.yml = the new CI/CD.
docs/      PLAN.md, OUTSTANDING.md, HANDOFF.md (this).
```

## 2. The stack / key decisions
- **Frontend:** Svelte 5 runes + Vite + vite-plugin-pwa (offline SW + manifest). Bespoke neo-brutalist
  design (bright-yellow hatch bg, cyan/lime/pink cards, thick black borders, hard offset shadows,
  tri-colour text-shadow, Archivo Black/Bungee). **canvas-confetti** (background emoji cannon + order
  celebrate) and **@fontsource** (self-hosted fonts, no Google CDN) are the only "modern swap-ins".
- **Backend:** **Hono on Node 24** (NOT Bun — Node 24 ships built-in `node:sqlite`, zero new tooling).
  Prepared statements, WAL, flock-free. Data in a Docker volume.
- **Menu model** (`apps/web/src/lib/data.ts`): `DRINKS` + reusable option **axes** + `buildLine()`.
  Adding a drink/axis is a one-place edit. (This is the nicest piece of the codebase.)
- **Identity:** anonymous device id in localStorage (`apps/web/src/lib/device.ts`) — no guest login.
- **Bartender auth:** shared PIN **`1337`** (to be replaced by a real staff login in Phase 3).
- **Cloudflare-later seam:** all public traffic enters through **Caddy** on an internal port; today via
  the router port-forward, later via `cloudflared` → same Caddy, zero app changes.

## 3. The NAS — how to operate it  ⚠️ important gotchas
- **Host:** `sol.home.meridew.com` = **`192.168.1.1`**, SSH user **`dan`**, key **`~/.ssh/nas_cocktails`**.
  DSM 7.2.2, x86_64, 4 cores, 7.6 GB RAM. `dan` has **passwordless sudo** (`/etc/sudoers.d/99-dan-nopasswd`).
- **Gotchas (learned the hard way):**
  - The Bash/MSYS tool **cannot resolve `sol.home.meridew.com`** → always use **`192.168.1.1`**.
  - **scp/SFTP is disabled** on the NAS sshd → copy files by streaming: `ssh … dan@192.168.1.1 'cat > /path' < localfile`.
  - sudo has a **sanitized PATH** → call docker with the **full path**: `sudo -n /usr/local/bin/docker …`
    and `/usr/local/bin/docker-compose` (Compose **v2.9** standalone; the `docker compose` *plugin* is NOT installed).
  - SSH prints a post-quantum warning to stderr — filter it: `2>&1 | grep -v -i "post-quantum\|store now\|may need\|openssh.com/pq\|Permanently added"`.
- **Docker:** ContainerManager (Docker 20.10.23). No `buildx`/BuildKit plugin, but the daemon's
  integrated BuildKit handles our Dockerfiles. No GHCR — we build images **locally on the NAS**.
- **Deployed stack:** `/volume1/docker/cocktails/` (source extracted there + `infra/.env` with
  `PUBLIC_PORT=8088`, `BARTENDER_KEY=1337`). Containers: `cocktails-{web,api,caddy}-1`
  (`restart: unless-stopped`, api has a healthcheck, caddy waits for it). SQLite in volume `cocktails_cocktails-data`.
- **Live at:** **http://192.168.1.1:8088** (LAN only; deliberately not public yet). Bartender: 🍸 → PIN `1337`.
- **Self-hosted runner:** `/volume1/docker/cocktails-runner/` — container `cocktails-runner-runner-1`
  (`myoung34/github-runner`, label **`nas`**), mounts the docker socket + the host `docker-compose` binary.
  ⚠️ It registered with a **short-lived registration token**; after a **NAS reboot** it must be refreshed:
  ```sh
  echo "RUNNER_TOKEN=$(gh api -X POST repos/meridew/cocktails/actions/runners/registration-token --jq .token)" \
    | ssh -i ~/.ssh/nas_cocktails dan@192.168.1.1 'cat > /volume1/docker/cocktails-runner/.env'
  ssh -i ~/.ssh/nas_cocktails dan@192.168.1.1 'cd /volume1/docker/cocktails-runner && sudo -n /usr/local/bin/docker-compose up -d'
  ```
  (Long-term: swap for a fine-grained repo-scoped PAT. Do NOT write a full account PAT to the NAS.)

## 4. CI/CD — how deploys work
- `gh` CLI is authed as **meridew** (scopes: repo, workflow). GitHub secret **`BARTENDER_KEY`** is set.
- Workflow **`.github/workflows/nas-deploy.yml`**: on push to `modernise`/`main` (paths-ignore docs/*.md):
  1. **`check`** job on `ubuntu-latest` (free cloud): `npm ci` → `npm run check` (api typecheck + svelte-check) → `npm -w @cocktails/web run build`. **Gates prod.**
  2. **`deploy`** job on `[self-hosted, nas]`: checkout → write `infra/.env` from the secret →
     `docker-compose -f docker-compose.yml -f docker-compose.build.yml up -d --build` → scoped image prune.
  - Reproducible `npm ci` + dep-layer-cached Dockerfiles → deploys are ~**37s**.
- **Watch a run:** `gh run list -R meridew/cocktails -b modernise -L1 --json databaseId --jq '.[0].databaseId'`
  then `gh run watch <id> -R meridew/cocktails --exit-status --interval 6`.
- Deploys are **non-destructive on failure** (compose only recreates on a successful build).

## 5. Local dev
```
npm install
npm run dev        # concurrently runs api (:8787) + web (:5173, proxies /api → api)
# or separately: npm run dev:api  /  npm run dev:web
npm run check      # api typecheck + web svelte-check  (same gate CI runs)
```
> NOTE: the failed preview earlier was only because the *previous* `dead-vector` session was
> squatting :5173 on this machine. In a clean session this is a non-issue. (There may be **stray
> background node processes** from this session — API on :8787, Vite on :5173/:5199 — kill them if they get in the way.)

## 6. Status by phase  (see PLAN.md)
- ✅ **Phase 0** — full rebuild, feature-parity core (menu/configurator/basket/order/bartender, favourites, surprise, celebrate). Verified.
- ✅ **Phase 1** — live on the NAS behind Caddy (LAN). SQLite persisted, auto-restart.
- ✅ **Phase 2** — self-hosted-runner CI/CD; `git push` → ~37s auto-deploy.
- ✅ **Visual restoration** — original neo-brutalist design ported verbatim (`neo.css`) + components re-marked to original classes.
- ✅ **Code review** — multi-agent review (33 confirmed findings). **Batch 1** (DX/DRY/robustness) and
  **Batch 2** (a11y: focus-trap `dialog` action, alerts, touch targets, dead-nav fix) both shipped.

## 7. What's next (pick up here)
1. **Local preview** the user asked for — just `npm run dev` and open `http://localhost:5173` (or screenshot it; freeze the confetti rAF loop first or the screenshotter waits for "idle" forever).
2. **Cutover** (the big one, needs explicit go-ahead): point the router port-forward / `cock.meridew.com`
   at **Caddy :8088**, migrate existing orders out of the legacy PHP (`/volume1/web/cocktails/orders.data.php`)
   into SQLite, retire the PHP, and **make the repo private** — *only at cutover* (private repo kills GitHub Pages, so the legacy public site must move first).
3. **Make-a-Drink + ingredient availability** — design discussion required (see OUTSTANDING.md): bartender
   marks in-stock ingredients → filters both the Make-a-Drink engine (`cocktails.json`) and the menu.
4. **Phase 3** — PWA Web Push notifications ("your drink is being served / INCOMING") sent from the NAS via
   `web-push` (VAPID); replace the bartender PIN with a real staff login.
5. **Phase 5 (later)** — wrap the same web build with **Capacitor** for iOS/Android store apps.
6. **Minor/optional:** bump `actions/checkout`→v5 (Node-20 deprecation warning); extract `OrderSheet.svelte`
   + a `favs` rune store; add a request-id guard to the bartender poll (review classed the race as a self-healing flicker).

## 8. Parked / not-in-scope
- **Voice "Ask" finder** — DROPPED (dead MCP). Not ported.
- A LAN networking incident earlier in the session (devices couldn't get DHCP/DNS after a router reboot) was
  diagnosed as **name-resolution failing on the AD domain controller** (the router/DHCP-off-by-design were
  fine). Unrelated to the app; the user parked it.

## 9. Recent commit trail on `modernise` (newest first, approx)
review batch 2 (a11y) · review batch 1 (DX/DRY/robustness) · faithful neo-brutalist design ·
visual restoration (fonts+confetti) · device-id non-secure-context fix · CI self-hosted runner +
workflow · Caddyfile baked into image · first NAS bring-up · Phase 0 web app · Phase 0-2 backbone ·
docs (PLAN/OUTSTANDING).
