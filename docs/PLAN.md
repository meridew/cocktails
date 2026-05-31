# 🍸 Cocktails — Modernisation & Self-Hosting Plan

> Living document. We tick phases off as we go. Status legend: ☐ todo · ◐ in progress · ☑ done

## 1. Vision & principles
Rebuild the cocktail app as a **modern, self-sufficient system the Synology NAS hosts end-to-end**, with push notifications, an installable PWA, and a clean path to native apps later — **reusing existing design & logic, not reinventing wheels.**

- **NAS hosts; GitHub builds.** No reliance on third-party SaaS.
- **One codebase → website + PWA → (later) native apps** via Capacitor. ~90% reuse.
- **Cloudflare-ready, not Cloudflare-dependent** — one swap away when chosen.
- **No inbound holes** — the NAS dials *out*; nothing reaches in.

## 2. Target architecture

```
 DEV  ──git push──►  GitHub (repo + Actions, free cloud build)
                        │  build Svelte + API → package Docker images → push to GHCR
                        ▼
 NAS (Synology · Container Manager · one docker-compose)
   self-hosted runner ─► docker compose up -d
     ├─ caddy   reverse proxy · single public entry · internal :8443   ◄── the "seam"
     ├─ web     Svelte 5 + Vite + vite-plugin-pwa (static PWA build)
     ├─ api     Hono on Node 24 + node:sqlite · Web Push sender
     └─ data    SQLite volume (orders + push subscriptions)
            │
   NOW: router port-forward → caddy      LATER: cloudflared → caddy  (app unchanged)
```

## 3. Decided stack
TypeScript end-to-end · **Svelte 5 + Vite + vite-plugin-pwa** · **bespoke CSS + Open Props** ·
**Hono + Node 24 + built-in `node:sqlite`** · **shared TS types** · **Caddy** ·
**GitHub (private repo) → Actions → GHCR → NAS self-hosted runner** · **Web Push (VAPID)**.

> **Runtime note:** plan originally said Bun; switched to **Node 24** because it's already installed
> and ships a built-in SQLite module — zero new tooling, "play it safe". Hono is runtime-agnostic,
> so swapping to Bun later is a one-line change.

## 4. Repo layout (monorepo, transformed in place)
```
cocktails/
├─ apps/
│  ├─ web/        Svelte 5 + Vite (UI, PWA, service worker)
│  └─ api/        Hono on Node (orders, subscriptions, web-push)
├─ packages/
│  └─ shared/     TS types: Order, OrderStatus, MenuSection… (one source of truth)
├─ infra/         docker-compose.yml · Caddyfile · Dockerfiles · .env.example
├─ .github/workflows/   build → GHCR → trigger NAS deploy
├─ docs/PLAN.md
└─ (legacy flat app: index.html, app.js, styles.css … stays live until Phase 1 cutover)
```

## 5. Data model (SQLite — replaces the PHP flat file)
```
orders         id, name, items(json), note, status, created_at, updated_at
                status: pending → making → serving → done
subscriptions  device_id, role(guest|bartender), subscription(json), created_at
                anonymous device_id (localStorage) routes "your drink" pushes
```

## 6. Phases
| # | Phase | Needs | Delivers | Status |
|---|---|---|---|---|
| 0 | **Modern rebuild** — monorepo; typed `shared`; Hono+SQLite API (parity with PHP); Svelte 5 + Vite + PWA + Open Props; port UI; runs locally | dev box | Whole app local, feature-parity, modern stack | ◐ |
| 1 | **NAS hosting** — dockerise (caddy·web·api); SQLite volume; stand up via Container Manager behind Caddy; point port-forward at Caddy; retire PHP | NAS root | App served 100% from NAS | ☐ |
| 2 | **CI/CD** — Actions build→GHCR; self-hosted runner pulls + `compose up`; repo private; drop Pages/CNAME; secrets | NAS root + repo admin | `git push` → auto-deploy, nothing inbound | ☐ |
| 3 | **PWA + Web Push** — manifest/icons/offline; VAPID; subscribe + send; "🔔 Notify me"; wire `making→serving→INCOMING`; new-order→bartender; replace PIN with staff login; harden | — | Installable app; live "your drink" notifications | ☐ |
| 4 | **Harden & Cloudflare-ready** — security pass, backups, health/logs; documented Cloudflare Tunnel cutover | optional | Robust, self-sufficient, one-command Cloudflare switch | ☐ |
| 5 | **Native apps** *(future)* — Capacitor wraps same build; native FCM/APNs branch; cloud iOS builds; stores | later | iOS/Android store apps from one codebase | ☐ |

**Critical path:** 0 → 1 → 2 → 3. Phase 4 slots in anytime; Phase 5 whenever stores are wanted.

## 7. Baked-in assumptions (change anytime)
- **Anonymous device ID** for routing pushes (no guest login).
- Keep **`cock.meridew.com`**; keep the existing **router port-forward** as the temporary public path until the Cloudflare switch.
- **Node 24** API runtime (vs Bun).
- Repo goes **private** at Phase 2 (we leave GitHub Pages then).
- Right-size to the **actual NAS model/RAM** at Phase 1 (stack is featherweight).

## 8. What's needed from the human (at Phase 1+)
1. Root SSH to the NAS.
2. GitHub repo admin (self-hosted runner, GHCR, secrets, make private).
3. Confirm: NAS model, port-forward → new Caddy port, bartender-login approach.

## 9. Risks & mitigations
- *Dev-server pushes to `main`* → we work on a **branch**, keep `main` deployable, reconcile before cutover.
- *Don't break the live party app mid-rebuild* → legacy PHP + flat app stay live until Phase 1 parity is proven, then retire.
- *Synology Docker port 80/443 grab* → Caddy on alt ports + Cloudflare-later → we never fight DSM for 80/443.

## 10. Progress log
- **Branch `modernise`** holds the rebuild; `main` + the live flat app are untouched.
- **Phase 0 (core) ☑** — monorepo (npm workspaces); `@cocktails/shared` typed contracts;
  `apps/api` (Hono + Node 24 + `node:sqlite`) with full PHP parity + `serving` status +
  subscription plumbing — **smoke-tested + typechecks**; `apps/web` (Svelte 5 + Vite + PWA +
  Open Props) core order loop (menu → configurator → basket → order) + bartender — **builds,
  svelte-check 0 errors, verified web→proxy→API→SQLite end-to-end**.
- **Phase 0 (remaining)** — port advanced flows: Make-a-Drink engine (`cocktails.json`),
  voice/NL Ask finder, favourites, full background confetti.
- **Phase 1 ☑ — live on the NAS.** `api · web · caddy` containers via ContainerManager
  behind Caddy on `:8088` (LAN-only for now); SQLite in a Docker volume; auto-restart on boot.
  Verified end-to-end. Old PHP left untouched.
- **Phase 2 ☑ — CI/CD live.** Self-hosted `myoung34/github-runner` on the NAS (label `nas`,
  registration-token auth, host docker socket + host compose binary mounted). Push to
  `modernise`/`main` → runner checks out, writes `infra/.env` from the `BARTENDER_KEY` secret,
  `docker-compose up -d --build`. No GHCR, nothing inbound. Caddyfile baked into a `caddy`
  image (no host bind-mount under docker-out-of-docker).
- **Still pending:** cutover (point `cock.meridew.com` at the NAS, migrate orders, retire PHP,
  make repo private — only at cutover so Pages stays up); visual restoration; Make-a-Drink.
- **Known niggles:** `actions/checkout` Node-20 deprecation warning (bump later); runner needs
  its registration token refreshed after a NAS reboot (or swap for a fine-grained PAT).

### Run it locally
```
npm install
npm run dev:api      # Hono API on :8787  (BARTENDER_KEY defaults to 1337)
npm run dev:web      # Vite on :5173, proxies /api → the API
```
