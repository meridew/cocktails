# 🤝 Session Handoff — read this first

> Context snapshot so a fresh session (started in **this** folder,
> `C:\Users\danie\vscode-workspace\cocktails`) can continue seamlessly.
> Companion docs: **`PLAN.md`** (roadmap/phases), **`OUTSTANDING.md`** (parked decisions),
> **`APP-READINESS.md`** (design + roadmap for iOS/Android), **`MOBILE.md`** / **`CUTOVER.md`**
> (build + public-HTTPS runbooks), and **`QUALITY-PLAN.md`** (the tests/hardening/refactor plan —
> **all phases complete**; its standards and guardrails still apply to new work).

## TL;DR

The cocktails party-ordering app is **live at https://cock.meridew.com**, served entirely from the
NAS through a **Cloudflare Tunnel** (no open router ports), with **push-to-deploy CI/CD**. The
original **neo-brutalist design is intact** (`neo.css` is a verbatim port — keep it that way).
Guests order anonymously; staff sign in with email + password. **Web Push works**. The PWA is
installable from the site, and the **Android** Capacitor project exists (iOS needs a Mac).

Recently completed a full **quality pass** (`QUALITY-PLAN.md`): a four-angle audit, then
**129 tests** (`node:test`, zero new deps) where there were none, security hardening of the
now-public API, a shared validation module, ~10 correctness fixes, the push subsystem and service
worker rewritten, and a store/component refactor. `npm run check` is at **0 errors, 0 warnings** and
CI runs format → typecheck → tests → build as the gate.

⚠️ **`STAFF_PASSWORD` is not set**, so the live staff account is locked behind a random password.
Set the secret and redeploy to sign in to the live bar (see `CUTOVER.md`).
⚠️ **The runner drops out after a NAS reboot** — it authenticates with a short-lived _registration_
token, so once that expires the container can't re-register and silently vanishes from GitHub
(`total_count: 0`), leaving pushes CI-green but undeployed. §3 has the two-command fix. The durable
fix is to swap it for a fine-grained repo-scoped PAT, which lets the container mint its own
registration tokens and survive reboots.

---

## 1. Where things live

- **Repo:** `github.com/meridew/cocktails`. Working branch **`modernise`** (pushed; well ahead of
  `main`, which is untouched).
- **Legacy flat app** (still at repo ROOT: `index.html`, `app.js`, `styles.css`, `cocktails.json`,
  `config.js`, `nas/`, `favicon.svg`, `CNAME`) — **no longer the live site**; the tunnel serves the
  Svelte app now, so this is redundant and can be retired whenever you like.
  `apps/web/src/neo.css` is a **verbatim copy** of root `styles.css` — keep it byte-identical so the
  two stay diffable (it's excluded from Prettier for exactly this reason).
- **New monorepo** (the rebuild) under `apps/`, `packages/`, `infra/`, `.github/`, `docs/`.

```
apps/web   Svelte 5 (runes) + Vite + vite-plugin-pwa, bespoke neo-brutalist CSS (neo.css),
           canvas-confetti, self-hosted @fontsource fonts. Talks to /api (Vite proxy / Caddy).
           Also the Capacitor host: capacitor.config.ts + android/ (see MOBILE.md).
           src/lib/*.svelte.ts = rune stores (basket, favourites, session, push) — all
           persisted state goes through lib/storage.ts; only lib/api.ts calls fetch.
           src/lib/*.svelte  = components (they render state, they don't own it).
           tests/            = node:test suites (data engine, basket).
apps/api   Hono on Node 24 + built-in node:sqlite. Import direction is one-way:
           config → db → {auth, push} → app (routes) → server (bootstrap only).
           app.ts is exported without a listener so tests drive it via app.request().
           db.ts exposes createDb(path) + delegates, so ':memory:' works in tests.
           tests/ = auth, db (incl. migrations), routes, sanitise, ratelimit, push, config.
apps/caddy Dockerfile that bakes infra/Caddyfile into a caddy image (no host bind-mount under DooD).
packages/shared  One module per concern behind a barrel index: limits, orders
           (Order/OrderStatus/STATUS_META), push, api envelopes, and sanitise
           (cleanStr/cleanQty/cleanItems — used by BOTH sides, never duplicated).
infra/     docker-compose.yml, docker-compose.build.yml (build-locally override), Caddyfile
           (+ security headers), .env.example, runner/ (self-hosted Actions runner compose).
.github/workflows/  deploy.yml = legacy GitHub Pages (live).  nas-deploy.yml = the new CI/CD.
docs/      PLAN.md, OUTSTANDING.md, APP-READINESS.md, MOBILE.md, CUTOVER.md,
           QUALITY-PLAN.md (the tests/hardening/refactor plan — all phases done), handoff.md (this).
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
- **Identity:** anonymous device id in localStorage (`apps/web/src/lib/device.ts`) — no guest login,
  by design. Guests order instantly; notifications are keyed to the device, not an account.
- **Staff auth:** email + password → **scrypt** hash + a revocable **bearer session** (only the
  token's SHA-256 is stored). Seeded from `STAFF_EMAIL`/`STAFF_PASSWORD`; env is the source of truth,
  so changing the secret and redeploying rotates the password. The old shared PIN is **gone**.
- **Public entry:** **cloudflared → Caddy** (internal port) → web/api. No inbound router ports. Caddy
  also sets the security headers. Swapping the ingress again would still be zero app changes.

## 3. The NAS — how to operate it ⚠️ important gotchas

- **Host:** `sol.home.meridew.com` = **`192.168.1.1`**, SSH user **`dan`**, key **`~/.ssh/nas_cocktails`**.
  DSM 7.2.2, x86_64, 4 cores, 7.6 GB RAM. `dan` has **passwordless sudo** (`/etc/sudoers.d/99-dan-nopasswd`).
- **Gotchas (learned the hard way):**
  - The Bash/MSYS tool **cannot resolve `sol.home.meridew.com`** → always use **`192.168.1.1`**.
  - **scp/SFTP is disabled** on the NAS sshd → copy files by streaming: `ssh … dan@192.168.1.1 'cat > /path' < localfile`.
  - sudo has a **sanitized PATH** → call docker with the **full path**: `sudo -n /usr/local/bin/docker …`
    and `/usr/local/bin/docker-compose` (Compose **v2.9** standalone; the `docker compose` _plugin_ is NOT installed).
  - SSH prints a post-quantum warning to stderr — filter it: `2>&1 | grep -v -i "post-quantum\|store now\|may need\|openssh.com/pq\|Permanently added"`.
- **Docker:** ContainerManager (Docker 20.10.23). No `buildx`/BuildKit plugin, but the daemon's
  integrated BuildKit handles our Dockerfiles. No GHCR — we build images **locally on the NAS**.
- **Deployed stack:** `/volume1/docker/cocktails/` (source extracted there + `infra/.env`, written by
  CI from GitHub secrets: `PUBLIC_PORT`, `STAFF_EMAIL`/`STAFF_PASSWORD`, `VAPID_*`, `TUNNEL_TOKEN`).
  Containers: `cocktails-{web,api,caddy,cloudflared}-1` (`restart: unless-stopped`, api has a
  healthcheck, caddy waits for it). SQLite in volume `cocktails_cocktails-data`.
- **Live at:** **https://cock.meridew.com** (public, via the tunnel) and **http://192.168.1.1:8088**
  on the LAN. Bartender: 🍸 → staff email + password.
  ⚠️ The LAN `:8088` port bypasses Cloudflare, so the API can't trust `x-forwarded-for` from it —
  that's why `clientIp()` prefers `cf-connecting-ip` and falls back to the socket address.
- **Self-hosted runner:** `/volume1/docker/cocktails-runner/` — container `cocktails-runner-runner-1`
  (`myoung34/github-runner`, label **`nas`**), mounts the docker socket + the host `docker-compose` binary.
  ⚠️ It authenticates with a **short-lived registration token**, so after a **NAS reboot** it can't
  re-register and disappears from GitHub entirely. Symptom: pushes are CI-green but never deploy, and
  `gh api repos/meridew/cocktails/actions/runners` reports `total_count: 0` (the app stack keeps
  running — only deploys stop). Fix, and confirm it came back:

  ```sh
  # 1. mint a fresh registration token straight into the runner's .env (never printed)
  echo "RUNNER_TOKEN=$(gh api -X POST repos/meridew/cocktails/actions/runners/registration-token --jq .token)" \
    | ssh -i ~/.ssh/nas_cocktails dan@192.168.1.1 'cat > /volume1/docker/cocktails-runner/.env'
  # 2. recreate the container so it picks the token up (--force-recreate matters: a
  #    plain `up -d` sees no config change and leaves the old container running)
  ssh -i ~/.ssh/nas_cocktails dan@192.168.1.1 \
    'cd /volume1/docker/cocktails-runner && sudo -n /usr/local/bin/docker-compose up -d --force-recreate'
  # 3. verify — expect 1 runner, status "online" (it may already be busy on a queued job)
  gh api repos/meridew/cocktails/actions/runners --jq '.runners[] | "\(.name): \(.status)"'
  ```

  If a deploy sat queued while the runner was away it will start on its own once it registers. A run
  stuck in the `nas-deploy` concurrency group blocks later pushes from even reaching `check`, so
  cancel it (`gh run cancel <id> -R meridew/cocktails`) if you don't want it.

  **Durable fix (recommended):** give the container a **fine-grained, repo-scoped PAT** with
  _Administration: read & write_ on `meridew/cocktails` as `ACCESS_TOKEN` instead of `RUNNER_TOKEN` —
  `myoung34/github-runner` then mints its own registration tokens and survives reboots unattended.
  Do **NOT** write a classic/full-account PAT to the NAS.

## 4. CI/CD — how deploys work

- `gh` CLI is authed as **meridew** (scopes: repo, workflow) and can mint runner registration tokens.
- **GitHub secrets** (CI writes these into `infra/.env` on the NAS): `STAFF_EMAIL`, `TUNNEL_TOKEN`,
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`. ⚠️ **`STAFF_PASSWORD` is deliberately absent** — with it
  unset the API generates a random one in production rather than falling back to anything guessable,
  which is why nobody can currently sign in to the live bar. Set it to fix that.
- Workflow **`.github/workflows/nas-deploy.yml`**: on push to `modernise`/`main` (paths-ignore docs/*.md):
  1. **`check`** job on `ubuntu-latest` (free cloud): `npm ci` → `format:check` → `npm run check`
     (api typecheck + svelte-check) → `npm test` → `npm -w @cocktails/web run build`. **Gates prod.**
  2. **`deploy`** job on `[self-hosted, nas]`: checkout → write `infra/.env` from the secret →
     `docker-compose -f docker-compose.yml -f docker-compose.build.yml up -d --build` → scoped image prune.
  - Reproducible `npm ci` + dep-layer-cached Dockerfiles → deploys are ~**37s**.
- **Watch a run:** `gh run list -R meridew/cocktails -b modernise -L1 --json databaseId --jq '.[0].databaseId'`
  then `gh run watch <id> -R meridew/cocktails --exit-status --interval 6`.
- Deploys are **non-destructive on failure** (compose only recreates on a successful build).

## 5. Local dev

```
npm install
npm run dev          # concurrently runs api (:8787) + web (:5180, proxies /api → api)
# or separately: npm run dev:api  /  npm run dev:web
npm run check        # api typecheck + web svelte-check
npm test             # node:test suites in both workspaces (zero extra deps)
npm run format       # Prettier (format:check is what CI runs)

```

> **🎛️ Dev hub — the central place to test:** open **http://localhost:5180/dev.html**. Live API/push
> status badges + links to the app, bartender (`/?bartender`), order sheet (`/?order`), the local API
> endpoints, and the live NAS. Start the Claude preview with the **`cocktails`** launch config (runs the
> full stack on :5180). Web uses a **dedicated :5180** (not Vite's default :5173) so it never clashes
> with other projects (e.g. the old `dead-vector` session that squatted :5173). The API dev runner
> (`apps/api/dev.mjs`) pins :8787 even when the preview injects its own `PORT`.

## 6. Status by phase (see PLAN.md)

- ✅ **Phase 0** — full rebuild, feature-parity core (menu/configurator/basket/order/bartender, favourites, surprise, celebrate). Verified.
- ✅ **Phase 1** — live on the NAS behind Caddy (LAN). SQLite persisted, auto-restart.
- ✅ **Phase 2** — self-hosted-runner CI/CD; `git push` → ~37s auto-deploy.
- ✅ **Visual restoration** — original neo-brutalist design ported verbatim (`neo.css`) + components re-marked to original classes.
- ✅ **Code review** — multi-agent review (33 confirmed findings). **Batch 1** (DX/DRY/robustness) and
  **Batch 2** (a11y: focus-trap `dialog` action, alerts, touch targets, dead-nav fix) both shipped.
- ✅ **Phase 3 (auth + push)** — staff email/password sign-in (scrypt + revocable bearer sessions)
  replaced the shared PIN; Web Push live end-to-end (server sender + client subscribe + service worker).
- ✅ **Cutover** — `https://cock.meridew.com` public via Cloudflare Tunnel, no inbound ports.
- ✅ **Phase 5 groundwork** — Capacitor scaffolded, Android project generated, icon set from one SVG,
  PWA installable from the site. iOS pending a Mac.
- ✅ **Quality pass** (`QUALITY-PLAN.md`, all 9 phases) — 129 tests where there were none; security
  hardening (rate limits, SSRF allow-list, trusted client IP, an auth-bypass fix, security headers);
  observability (request logging + error handler, which did not exist); shared validation; ~10
  correctness fixes; push subsystem and service worker rewritten; store/component refactor.

## 7. What's next (pick up here)

**Blocking (do these first):**

1. **Bring the NAS runner back online** so the CI-green commits actually deploy (§3 has the
   token-refresh commands). Until then the live site serves an older build.
2. **Set `STAFF_PASSWORD`** (`gh secret set STAFF_PASSWORD -R meridew/cocktails`) and redeploy — the
   seed upserts it. Login stays `bar@meridew.com`.

**Then, in rough priority order:**

3. **Android build** — install the Android SDK via Android Studio's SDK Manager (Studio itself is
   installed but the SDK is missing, which is why `cap:android` hits a "Select SDKs" dialog), then
   `cd apps/web && npm run cap:android`. See `MOBILE.md`.
4. **iOS** — needs macOS (or a cloud-Mac CI) plus the Apple Developer Program; `cap add ios` can't run
   on Windows. The iPhone **PWA** already works today.
5. **Native push (APNs/FCM)** — the only notification path that works inside an iOS WebView. The
   server's subscription model is already transport-aware (`transport`/`platform`), so this is a new
   branch in `push.ts` plus client registration.
6. **Make-a-Drink + ingredient availability** — still needs a design discussion (see `OUTSTANDING.md`):
   the bartender marks what's in stock, which filters both the discovery engine (`cocktails.json`) and
   the menu.
7. **Retire the legacy flat app** at the repo root and optionally make the repo private — the tunnel
   owns the domain now, so GitHub Pages is redundant.
8. **Minor:** bump `actions/checkout`→v5 (Node-20 deprecation warning). Optional: OTA live-updates
   (Capgo) so store apps get UI changes without a review.

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
