# SvelteKit migration plan

**Status:** approved in principle, not started.
**Shape:** full collapse — one SvelteKit app, no npm workspaces.
**Prerequisite:** ✅ done — Vitest is in place (`apps/web/vitest.config.ts`), which is
the runner SvelteKit uses anyway.

---

## 1. Why

The stack is already pure TypeScript on Vite 6 — 67 TS/Svelte files, 5 JS (all
config). Nothing needs "moving to TypeScript". What needs fixing is what's
**bespoke**, because bespoke is what neither of us should be spending thought on:

| Friction                                                                                    | Cost today                                                          | Fixed by                      |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------- |
| API runs on Node's native TS execution (`node src/server.ts`)                               | Forces `.ts` extensions in every import; outside mainstream tooling | Standard Vite/SvelteKit build |
| Two apps, two dev servers, `concurrently`, a Vite proxy, and `dev.mjs` pinning the API port | A port-collision hack exists purely to stop them fighting           | One dev server                |
| No router — one page with stacked overlays                                                  | A 3D menu would have to become _another overlay_                    | File-based routing            |
| Client/server split across an npm workspace                                                 | `packages/shared` exists only so two apps can agree                 | One project, `$lib/shared`    |

Be honest about what this **isn't**: a runtime improvement. We don't need SSR — this
is an offline-capable PWA, and the app routes will run `ssr = false`. The win is a
single mainstream toolchain, a router, and a documented testing story.

## 2. Target structure

```
cocktails/
├── src/
│   ├── routes/
│   │   ├── +layout.svelte            app shell: appbar, tabbar, dialogs
│   │   ├── +layout.ts                export const ssr = false, prerender = false
│   │   ├── +page.svelte              the drinks menu
│   │   ├── bar/+page.svelte          bartender queue — a real route
│   │   ├── menu-3d/+page.svelte      three.js, its own lazy chunk
│   │   └── api/…/+server.ts          the endpoints (§3)
│   ├── lib/
│   │   ├── server/                   db · auth · notify · push · ratelimit · http · config
│   │   ├── components/               OrderCard · Keypad · StaffGate · BarMenu · …
│   │   ├── stores/                   basket · view · session · favourites · push · staffRequest
│   │   └── shared/                   limits · orders · staff · api · sanitise
│   ├── app.css · neo.css             unchanged (neo.css stays a verbatim port)
│   └── service-worker.ts             SvelteKit's own SW entry point
├── static/                           icons, manifest assets
├── tests/                            unit + component (Vitest)
├── e2e/                              Playwright, optional (§7)
├── svelte.config.js                  adapter chosen by env (§5)
└── infra/                            Dockerfile + compose, largely unchanged
```

`$lib/server/*` is enforced by SvelteKit: importing it from client code is a build
error. That's a stronger guarantee than the current convention.

## 3. Endpoint map

25 endpoints. Hono `app.<verb>('/path')` → a `+server.ts` exporting `GET`/`POST`/
`PATCH`/`DELETE`. Params become `[id]` directories.

| Today                                               | Becomes                                             |
| --------------------------------------------------- | --------------------------------------------------- |
| `GET /api/health`                                   | `routes/api/health/+server.ts`                      |
| `GET /api/push/key`                                 | `routes/api/push/key/+server.ts`                    |
| `POST /api/auth/login` · `pin` · `logout`, `GET me` | `routes/api/auth/{login,pin,logout,me}/+server.ts`  |
| `GET,POST /api/orders`                              | `routes/api/orders/+server.ts`                      |
| `POST /api/orders/clear`                            | `routes/api/orders/clear/+server.ts`                |
| `PATCH,DELETE /api/orders/:id`                      | `routes/api/orders/[id]/+server.ts`                 |
| `POST /api/orders/:id/bump`                         | `routes/api/orders/[id]/bump/+server.ts`            |
| `PATCH /api/orders/:id/progress`                    | `routes/api/orders/[id]/progress/+server.ts`        |
| `GET /api/staff`                                    | `routes/api/staff/+server.ts`                       |
| `POST /api/staff/requests` · `claim` · `join`       | `routes/api/staff/{requests,claim,join}/+server.ts` |
| `POST,DELETE /api/staff/join-code`                  | `routes/api/staff/join-code/+server.ts`             |
| `POST /api/staff/revoke-all`                        | `routes/api/staff/revoke-all/+server.ts`            |
| `DELETE /api/staff/:id`                             | `routes/api/staff/[id]/+server.ts`                  |
| `POST /api/staff/:id/{approve,revoke}`              | `routes/api/staff/[id]/{approve,revoke}/+server.ts` |
| `POST,DELETE /api/subscriptions`                    | `routes/api/subscriptions/+server.ts`               |

**Middleware.** Hono's `app.use` chain has no direct equivalent per-route, so it
moves to `hooks.server.ts` (`handle`): CORS, body limit, security headers, request
logging. `requireStaff` / `requireAdmin` become small helpers called at the top of
each handler — more explicit than middleware, and it keeps the guard visible in the
file it protects. **`handleError`** replaces `app.onError`.

## 4. What moves unchanged

Roughly 80% of the code is untouched by this:

- **Every server module** — `db.ts`, `auth.ts`, `notify.ts`, `push.ts`, `ratelimit.ts`,
  `http.ts`, `config.ts`. They're already free of Hono except for `clientIp(c)`,
  which takes a context shape and needs one adapter for SvelteKit's `RequestEvent`.
- **Every component and rune store.** They're plain Svelte 5.
- **`neo.css`** — verbatim, as always. `app.css` likewise.
- **The shared package's contents**, moving from `packages/shared/src/*` to
  `src/lib/shared/*`. Import specifiers change from `@cocktails/shared` to
  `$lib/shared`; that's a mechanical find-and-replace.
- **SQLite via `node:sqlite`** — a Node built-in, fine under `adapter-node`.

What genuinely changes: 25 route wrappers, the middleware chain, the import
specifiers, and the API tests' entry point.

## 5. Two build targets

The current `build` / `build:native` split survives, and it's the one genuinely
fiddly part.

- **Web / NAS** → `@sveltejs/adapter-node`. Produces a Node server that serves both
  the app and `/api`. Same Docker container, same Caddy in front, same tunnel. Caddy
  no longer needs to route `/api` separately to a second service.
- **Capacitor** → `@sveltejs/adapter-static` with `fallback: 'index.html'` and
  `ssr = false`, built with `VITE_API_BASE` pointing at `https://cock.meridew.com/api`
  exactly as today. The `api/` routes are simply absent from that build.

Adapters are selected in `svelte.config.js` from an env var, so `npm run build` and
`npm run build:native` keep their current meaning.

**Service worker.** SvelteKit has first-class SW support (`src/service-worker.ts`
with `$service-worker` bindings). We currently use `vite-plugin-pwa` +
`injectManifest` + Workbox for precaching _and_ Web Push. Decision deferred to
implementation: either keep vite-plugin-pwa (it supports SvelteKit) or move to
SvelteKit's native SW and keep the Workbox imports. **Keeping vite-plugin-pwa is the
lower-risk default** — the push handler and the manifest both already work.

## 6. Porting the tests — the safety net

235 tests exist and they are what makes this tractable. Port them **first**, against
the new structure, and treat green as the definition of done.

- **Web (55, Vitest)** — unchanged apart from import paths. They already run under
  the runner SvelteKit uses.
- **API (180, `node:test` × 14 files)** — these drive Hono via `app.request()`, which
  disappears. Two options:
  1. **Recommended:** keep the handler bodies as exported functions in
     `$lib/server/handlers/*`, with `+server.ts` as a one-line wrapper. Tests call
     the handlers directly with a fake `RequestEvent`. Fast, no server, and it
     preserves the current in-process character.
  2. Run a real dev server and hit it over HTTP. More faithful, much slower, and it
     makes the suite stateful.

  Either way they move to Vitest for one runner, keeping `node:assert`.

- **Migration tests** (`db.test.ts` opens a pre-seeded file to exercise the SQLite
  migrations) must keep working — that's the guarantee that a NAS database from
  before the migration still opens afterwards. **Non-negotiable.**

## 7. Optional, once landed

- **Playwright** for the handful of genuinely end-to-end things (install prompt,
  service-worker update, push delivery). Small suite, run on demand, not in CI.
- **`npm run seed <scenario>`** — a dev fixture command. Deferred from this round;
  still worth it.
- **Dev-only capability overrides** (`?permission=default&platform=ios`) to make
  push/platform states drivable. Also deferred.

## 8. Phasing

Each phase ends green and committed. Work on `sveltekit` branched from `modernise`;
`modernise` stays deployable throughout.

1. **Scaffold** — SvelteKit project, adapters, both builds producing output. Nothing
   ported. _Deployable? No. Merge? No._
2. **Shared + server modules** — move `$lib/shared` and `$lib/server`, fix imports,
   port the API tests to handlers. _Gate: 180 API tests green._
3. **Routes** — the 25 `+server.ts` files plus `hooks.server.ts`. _Gate: same 180._
4. **UI** — layout, `/` and `/bar` routes, components, stores. Overlays that are
   genuinely routes (the bar) become routes; the rest stay dialogs. _Gate: 55 web
   tests green, plus new route tests._
5. **Service worker + manifest + Capacitor.** _Gate: both builds correct — web has a
   SW, native doesn't._
6. **Cutover** — deploy from the branch to the NAS, verify against §9, then merge.
7. **Delete** the old `apps/`, `packages/`, `dev.mjs`, proxy config, and the
   workspace wiring.

## 9. Cutover checklist

Verified against the live site before merging, same as previous deploys:

- `/api/health` responds; PIN sign-in issues a working admin session
- an order placed as a guest appears on the bar; status changes push correctly
- a join code mints, redeems, and expires
- **the existing NAS SQLite volume opens and keeps its data** — orders, staff,
  subscriptions, sessions
- the PWA still installs; an existing installed PWA updates rather than breaking
- `?bartender` deep link resolves (now `/bar` — keep a redirect, notifications
  already sent carry the old URL)

**Rollback:** the NAS deploys from a branch; reverting is redeploying `modernise`.
The database is untouched by the migration, which is what makes rollback safe — so
**no schema changes in the same PR.**

## 10. Out of scope

| Not doing              | Why                                                                        |
| ---------------------- | -------------------------------------------------------------------------- |
| Changing the design    | `neo.css` is a verbatim port and stays that way                            |
| Swapping to React/Next | Discards the design port and the runes code for an ecosystem we don't need |
| SSR for the app routes | It's an offline PWA; `ssr = false`                                         |
| Schema changes         | Rollback safety depends on the DB being untouched                          |
| Building the 3D menu   | This unblocks it (`/menu-3d` as a lazy route); it isn't part of it         |

## Appendix: three.js

Barely constrains the choice — it's a canvas and a render loop, identical in any
framework. Two things do matter, and both are arguments for this plan:

- **~600KB.** It wants lazy loading behind a route, which is the router argument.
- **[Threlte](https://threlte.xyz)** gives declarative three.js in Svelte, the way
  react-three-fiber does for React. Staying on Svelte keeps that available without
  discarding the design port.
