# 🤝 Session Handoff — read this first

> Context snapshot so a fresh session (started in **this** folder,
> `C:\Users\danie\vscode-workspace\cocktails`) can continue seamlessly.
> This and `OUTSTANDING.md` (parked decisions) are the only docs. The old planning documents —
> the modernisation roadmap, the quality programme, the Cloudflare cutover, the app-readiness
> design and the SvelteKit migration plan — all shipped and were deleted rather than left to rot;
> they're in git history if the reasoning is ever wanted (`git log -- docs/`).

## TL;DR

The cocktails party-ordering app is **live at https://cock.meridew.com**, served entirely from the
NAS through a **Cloudflare Tunnel** (no open router ports), with **push-to-deploy CI/CD**. The
original **neo-brutalist design is intact** (`neo.css` is a verbatim port — keep it that way).
Guests order anonymously; the host unlocks the bar with a **6-digit PIN**, and helpers get in with
a short-lived **join code** the host reads out (asking for approval remains as the fallback).
**Web Push works**, opted into once up front, and the PWA is installable from the site.

It is **one SvelteKit app** — `adapter-node` serves the pages and `/api` from a single Node
process, in a single container. **237 tests** (Vitest), `npm run check` at **0 errors**, and CI
runs format → typecheck → tests → build as the gate.

The **native app has not been started**: the Capacitor project and packages were removed during
the migration because nothing imported them and there was no project left to build.

⚠️ **The runner drops out after a NAS reboot** — it authenticates with a short-lived _registration_
token, so once that expires the container can't re-register and silently vanishes from GitHub
(`total_count: 0`), leaving pushes CI-green but undeployed. §3 has the two-command fix. The durable
fix is to swap it for a fine-grained repo-scoped PAT, which lets the container mint its own
registration tokens and survive reboots.

---

## 1. Where things live

- **Repo:** `github.com/meridew/cocktails`. Single branch: **`main`**. The old `modernise` and `claude/*` branches were fully
  contained in it and have been deleted.
- **One SvelteKit app**, no workspaces. Everything is under `src/`, `tests/`, `infra/`,
  `.github/`, `docs/`, `scripts/`, `static/`.

```
src/routes/         / (menu) · /bar · api/**/+server.ts — 25 endpoints, params as [id] dirs
src/hooks.server.ts CORS, body cap, security headers, request logging, and the boot-time
                    admin seed (init). Auth is NOT here — see $lib/server/guards.
src/lib/server/     db · auth · notify · push · ratelimit · guards · http · config.
                    Import direction is one-way: config → db → {auth, push} → routes.
                    db.ts exposes createDb(path) + delegates, so ':memory:' works in tests.
                    Compiler-enforced: importing this from client code fails the build.
src/lib/components/ they render state, they don't own it
src/lib/stores/     rune stores (basket, favourites, session, push, view, staffRequest).
                    All persisted state goes through lib/storage.ts; only lib/api.ts fetches.
src/lib/shared/     one module per concern behind a barrel: limits, orders
                    (Order/OrderStatus/STATUS_META), push, api envelopes, staff, and
                    sanitise (cleanStr/cleanQty/cleanItems — used by BOTH sides).
src/lib/neo.css     VERBATIM copy of the original hand-made design. Keep it byte-identical;
                    it's in .prettierignore for exactly that reason. Additions go in app.css.
tests/              Vitest. tests/app.ts is a test-only dispatcher (path+method → handler)
                    that runs requests through hooks.server.ts; routes.test.ts asserts every
                    +server.ts appears in its table, so a new endpoint can't go untested.
infra/              docker-compose.yml (app + cloudflared), docker-compose.build.yml,
                    runner/ (self-hosted Actions runner compose).
Dockerfile          copies a prebuilt build/ in — it deliberately compiles nothing.
scripts/db.js       db:reset and db:seed busy|helper
```

There is no legacy app any more: the flat GitHub Pages app at the repo root, the
`nas/` PHP backend, the Pages workflow and Pages itself are all gone. The
`cocktails.json` dataset the parked Make-a-Drink feature wants went with it — it's
in git history, see `OUTSTANDING.md` for the retrieval command.

## 2. The stack

**One SvelteKit app.** `src/routes` holds the pages _and_ the 25 `/api` endpoints;
`adapter-node` builds `build/index.js`, a single Node process serving both. That is
what the container runs and what `npm run preview` runs locally, so what gets tested
and what ships are the same artifact.

```
src/
├── routes/            / (menu) · /bar · api/**/+server.ts
├── lib/
│   ├── server/        db · auth · notify · push · ratelimit · guards · config
│   ├── components/    OrderCard · Keypad · StaffGate · BarMenu · …
│   ├── stores/        basket · view · session · favourites · push · staffRequest
│   └── shared/        limits · orders · staff · api · sanitise
├── hooks.server.ts    CORS · body cap · security headers · logging · boot seed
└── service-worker.ts  precache + Web Push
```

- `$lib/server/*` is compiler-enforced: importing it from client code fails the build.
- **Auth guards are not middleware.** `requireStaff`/`requireAdmin` are called on the
  first line of the handler they protect, so the guard is visible in the file it
  guards.
- **No SQLite migrations.** The schema is declared; a change means editing it and
  running `npm run db:reset`. Put a forward-only runner back **before the first
  party with real orders in it**.
- **`neo.css` is still a verbatim port.** Keep it that way.

Commands: `npm run dev` · `npm test` · `npm run check` · `npm run build` ·
`npm run preview` · `npm run db:reset` · `npm run db:seed busy|helper`.

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
  CI from GitHub secrets: `PUBLIC_PORT`, `STAFF_EMAIL`/`STAFF_PASSWORD`/`STAFF_PIN`, `VAPID_*`,
  `TUNNEL_TOKEN`).
  Containers: `cocktails-{app,cloudflared}-1` (`restart: unless-stopped`; the app has a
  healthcheck and cloudflared waits for it). SQLite in volume `cocktails_cocktails-data`.
  ⚠️ The app listens on **:80** and carries a `caddy` network alias — purely so the tunnel's
  ingress rule (`http://caddy:80`, held in the Cloudflare dashboard, not this repo) keeps working.
  Repoint the dashboard at `http://app:3000` and both can go.
- **Live at:** **https://cock.meridew.com** (public, via the tunnel) and **http://192.168.1.1:8088**
  on the LAN. Bartender: 🍸 → tap the PIN.
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

> **Pushes gate; they do not deploy.** Deploying is a deliberate act, because a
> ~110s NAS round-trip in the middle of iterating buys nothing when nobody is
> looking at the site between changes. Work locally (`npm run dev`, `npm test`,
> `npm run preview`), push freely, and deploy when it needs to be on a phone:
>
> ```sh
> gh workflow run "gate + deploy (NAS)" --ref main -f deploy=true
> ```

- `gh` CLI is authed as **meridew** (scopes: repo, workflow) and can mint runner registration tokens.
- **GitHub secrets** (CI writes these into `infra/.env` on the NAS): `STAFF_EMAIL`,
  `STAFF_PASSWORD`, `STAFF_PIN`, `TUNNEL_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`. If a
  credential secret is ever _unset_, production does not fall back to anything guessable: the password
  becomes a random string and the PIN door switches off entirely. That's a lockout, not a weakness —
  set the secret and redeploy.
- Workflow **`.github/workflows/nas-deploy.yml`**: on push to `main` (paths-ignore docs/*.md):
  1. **`check`** job on `ubuntu-latest` (free cloud): `npm ci` → `format:check` → `npm run check`
     → `npm test` → `npm run build`, then uploads `build/` as an artifact. **Gates prod.**
  2. **`deploy`** job on `[self-hosted, nas]`: checkout → download the `build/` artifact → write
     `infra/.env` from the secrets →
     `docker-compose -f docker-compose.yml -f docker-compose.build.yml up -d --build` → scoped image prune.
  - The NAS **compiles nothing** — the Dockerfile copies the prebuilt `build/` in. It shares a
    4-core box with two VMs, SQL Server and Plex, and BuildKit was being OOM-killed mid-compile;
    that is also why `DOCKER_BUILDKIT=0` is set. Deploys land in ~**110s**.
- **Watch a run:** `gh run list -R meridew/cocktails -b main -L1 --json databaseId --jq '.[0].databaseId'`
  then `gh run watch <id> -R meridew/cocktails --exit-status --interval 6`.
- Deploys are **non-destructive on failure** (compose only recreates on a successful build).

## 5. Local dev

```
npm install
npm run dev            # one server: the app AND /api, on :5173 (honours PORT)
npm run dev:lan        # same, exposed on the network (a phone can reach it)
npm run check          # svelte-check + typecheck
npm test               # Vitest — 237 tests
npm run preview        # build, then run the real production artifact
npm run db:reset       # empty the database
npm run db:seed busy   # a queue mid-service ('helper' = a pending request)
npm run format         # Prettier (format:check is what CI runs)
```

**Faking platform states.** `?permission=`, `?platform=`, `?installed=` and `?push=`
override capability detection in dev only — see the README. That's how the opt-in
modal gets tested in a browser whose real permission is permanently denied, and how
the iOS "install first" path is checked without an iPhone. Inert in production, and
a test asserts it.

There is no dev hub page and no proxy any more — one origin serves everything, so
`http://localhost:5173/bar` is the bar and `/api/health` is the API. `npm run preview` runs the
exact artifact the container runs, which is where to catch anything that only breaks in the build.

`.env` (gitignored) holds `STAFF_PIN`, the `VAPID_*` pair and optionally
`STAFF_EMAIL`/`STAFF_PASSWORD`. Note `config.ts` reads `.env` via `$env/dynamic/private` **merged
under** `process.env` — plain `process.env` is not populated for server modules under `vite dev`.

## 6. How it got here

Rebuilt from a flat GitHub Pages app, deployed to the NAS, given self-hosted CI/CD, had its
original design restored verbatim, gained staff auth and Web Push, went public through a Cloudflare
Tunnel, then took a nine-phase quality pass — tests where there were none, security hardening, a
shared validation module, ~10 correctness fixes, push and the service worker rewritten.

Finally the two-app monorepo collapsed into one SvelteKit app. The plans that drove all of that are
in git history; the decisions that still bind are in §7 and `OUTSTANDING.md`.

## 7. What's next (pick up here)

**Nothing is blocking.** The runner is registered and deploying, and `STAFF_EMAIL`,
`STAFF_PASSWORD` and `STAFF_PIN` are all set, so the live bar opens with the PIN.

**In rough priority order:**

1. **Native app** — not started, and the Capacitor scaffolding was removed. Restarting means
   reinstalling `@capacitor/{core,cli,android}`, adding `@sveltejs/adapter-static` behind an env
   switch in `svelte.config.js`, and pointing `VITE_API_BASE` at the public origin. Also needs the
   Android SDK (Studio is installed, the SDK isn't).
2. **iOS** — needs macOS (or a cloud-Mac CI) plus the Apple Developer Program; `cap add ios` can't run
   on Windows. The iPhone **PWA** already works today.
3. **Native push (APNs/FCM)** — the only notification path that works inside an iOS WebView. The
   server's subscription model is already transport-aware (`transport`/`platform`), so this is a new
   branch in `push.ts` plus client registration.
4. **Make-a-Drink + ingredient availability** — still needs a design discussion (see `OUTSTANDING.md`):
   the bartender marks what's in stock, which filters both the discovery engine and the menu. Its
   dataset is out of the tree now — `OUTSTANDING.md` has the one-line retrieval command.
5. **Database migrations** — there are none, by design. Put a forward-only runner back **before the
   first party with real orders in it**, or a schema change means wiping.
6. **Minor:** bump `actions/checkout`→v5 (Node-20 deprecation warning). Optional: OTA live-updates
   (Capgo) so store apps get UI changes without a review.

## 8. Parked / not-in-scope

- **Voice "Ask" finder** — DROPPED (dead MCP). Not ported.
- A LAN networking incident earlier in the session (devices couldn't get DHCP/DNS after a router reboot) was
  diagnosed as **name-resolution failing on the AD domain controller** (the router/DHCP-off-by-design were
  fine). Unrelated to the app; the user parked it.
