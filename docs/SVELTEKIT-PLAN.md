# SvelteKit migration plan

**Status:** approved, not started.
**Shape:** full collapse — one SvelteKit app, no npm workspaces, no separate API.
**Prerequisite:** ✅ done — Vitest is in place, which is the runner SvelteKit uses.

> **Operating assumptions.** The app has no users, downtime is free, and one person
> works in this repo. So this plan optimises for the **simplest end state**, not for a
> safe transition — there is nothing to transition. Where an earlier draft hedged to
> protect a live service, it now doesn't. See §12 for what that specifically buys.

---

## 1. Why

The stack is already pure TypeScript on Vite 6 — 67 TS/Svelte files, 5 JS (all
config). Nothing needs "moving to TypeScript". What needs fixing is what's
**bespoke**, because bespoke is what shouldn't need thinking about:

| Friction                                                                | Fixed by                   |
| ----------------------------------------------------------------------- | -------------------------- |
| API on Node's native TS execution — forces `.ts` extensions             | Standard Vite build        |
| Two apps, two dev servers, `concurrently`, a proxy, `dev.mjs` port hack | One dev server             |
| No router — one page with stacked overlays                              | File-based routing         |
| `packages/shared` workspace so two apps can agree                       | One project, `$lib/shared` |
| Two test runners                                                        | Vitest only                |
| Four containers (web · api · caddy · cloudflared)                       | Two (§6)                   |
| 110 lines of in-place SQLite migration machinery                        | Deleted (§5)               |

This is a DX play, not a runtime one. No SSR is needed — it's an offline-capable
PWA, so app routes run `ssr = false`.

## 2. Target structure

```
cocktails/
├── src/
│   ├── routes/
│   │   ├── +layout.svelte            shell: appbar, tabbar, dialogs
│   │   ├── +layout.ts                ssr = false
│   │   ├── +page.svelte              drinks menu
│   │   ├── bar/+page.svelte          bartender queue — a real route
│   │   ├── menu-3d/+page.svelte      three.js, lazy chunk (later)
│   │   └── api/…/+server.ts          endpoints (§3)
│   ├── lib/
│   │   ├── server/                   db · auth · notify · push · ratelimit · config
│   │   ├── components/               OrderCard · Keypad · StaffGate · …
│   │   ├── stores/                   basket · view · session · favourites · push · staffRequest
│   │   └── shared/                   limits · orders · staff · api · sanitise
│   ├── app.css · neo.css             unchanged (neo.css stays a verbatim port)
│   └── service-worker.ts
├── static/ · tests/ · infra/
└── svelte.config.js
```

`$lib/server/*` is compiler-enforced: importing it from client code is a build
error. Stronger than the current convention.

## 3. Endpoint map

25 endpoints. Hono `app.<verb>('/path')` → `+server.ts` exporting `GET`/`POST`/
`PATCH`/`DELETE`. Params become `[id]` directories.

| Today                                               | Becomes                                      |
| --------------------------------------------------- | -------------------------------------------- |
| `GET /api/health`                                   | `api/health/+server.ts`                      |
| `GET /api/push/key`                                 | `api/push/key/+server.ts`                    |
| `POST /api/auth/login` · `pin` · `logout`, `GET me` | `api/auth/{login,pin,logout,me}/+server.ts`  |
| `GET,POST /api/orders`                              | `api/orders/+server.ts`                      |
| `POST /api/orders/clear`                            | `api/orders/clear/+server.ts`                |
| `PATCH,DELETE /api/orders/:id`                      | `api/orders/[id]/+server.ts`                 |
| `POST /api/orders/:id/bump`                         | `api/orders/[id]/bump/+server.ts`            |
| `PATCH /api/orders/:id/progress`                    | `api/orders/[id]/progress/+server.ts`        |
| `GET /api/staff`                                    | `api/staff/+server.ts`                       |
| `POST /api/staff/requests` · `claim` · `join`       | `api/staff/{requests,claim,join}/+server.ts` |
| `POST,DELETE /api/staff/join-code`                  | `api/staff/join-code/+server.ts`             |
| `POST /api/staff/revoke-all`                        | `api/staff/revoke-all/+server.ts`            |
| `DELETE /api/staff/:id`                             | `api/staff/[id]/+server.ts`                  |
| `POST /api/staff/:id/{approve,revoke}`              | `api/staff/[id]/{approve,revoke}/+server.ts` |
| `POST,DELETE /api/subscriptions`                    | `api/subscriptions/+server.ts`               |

**No handler extraction.** An earlier draft split each endpoint into a handler plus
a thin wrapper so the existing tests could keep calling them in-process. That
protected the tests at the cost of the end state — two files per endpoint is more
indirection, not less. `+server.ts` exports plain functions; tests import and call
them with a constructed `RequestEvent` (§7).

**Middleware** moves to `hooks.server.ts`: CORS, body limit, security headers,
request logging, and `handleError` in place of `app.onError`. `requireStaff` /
`requireAdmin` become helpers called at the top of each handler — more explicit than
a middleware chain, and the guard stays visible in the file it protects.

## 4. What moves unchanged

Roughly 80% of the code:

- **Server modules** — `db.ts` (minus §5), `auth.ts`, `notify.ts`, `push.ts`,
  `ratelimit.ts`, `config.ts`. Hono-free already, except `clientIp()` which needs
  one adapter for `RequestEvent`.
- **Every component and rune store** — plain Svelte 5.
- **`neo.css`** — verbatim, as always.
- **Shared contents** — `packages/shared/src/*` → `src/lib/shared/*`, with
  `@cocktails/shared` → `$lib/shared` as a mechanical find-and-replace.
- **SQLite via `node:sqlite`** — a Node built-in, fine under `adapter-node`.

## 5. Schema: rewritten, not migrated

**The single biggest simplification.** `db.ts` carries ~110 lines of idempotent
migration machinery — `addColumn`, `tableColumns`, `primaryKeyColumns`, `isNotNull`,
and two full table-rebuild blocks — plus tests that open a pre-seeded file to prove a
deployed database still opens. All of it exists to upgrade a **live** database in
place. Production currently holds one admin row and two test orders.

So: **delete the machinery, write the schema as it would be written today.**

- `staff` — a clean `CREATE TABLE` instead of nullable columns reached via table
  rebuild. Replace the `approved_by = 'join-code'` sentinel (a hack from this
  session) with a real `joined_via` column.
- `orders` — drop `user_id`, added for an accounts feature that isn't happening.
- `subscriptions` — the `(device_id, endpoint, role)` primary key is already correct;
  it just gets declared directly rather than reached by rebuild.

**Standing permission:** the database may be wiped at any time, without asking,
until Dan says otherwise. So there is no migration mechanism at all — a schema
change is a `CREATE TABLE` edit plus `npm run db:reset` (§9).

**The trigger to undo this:** the first party with real orders in it. At that point a
forward-only numbered migration runner goes in — far simpler than the detect-then-act
code being deleted here. Until then, migrations are pure cost.

## 6. Infrastructure: four containers → two

`adapter-node` serves the app **and** `/api` from one process, so `web` and `api`
merge. Once that's true, **Caddy stops earning its place**: it was doing static file
serving (adapter-node does that) and security headers (`hooks.server.ts` does that).
`cloudflared` points straight at the Node server.

```
before:  cloudflared → caddy → { web, api }        4 containers, 2 caddy volumes
after:   cloudflared → app                         2 containers
```

The Caddyfile, its two volumes, and the LAN `:8088` port mapping go. Keeping the LAN
port is optional — if kept, `clientIp()` must still prefer `cf-connecting-ip`,
because that path bypasses Cloudflare and can't be trusted to set `x-forwarded-for`.

## 7. Tests

**One runner: Vitest.** `node:test` goes entirely. Assertions stay on
`node:assert/strict`, so nothing about how they read changes.

- **Web (55)** — already Vitest. Import paths only.
- **API (180, 14 files)** — rewritten to call the exported route functions with a
  constructed `RequestEvent` (`{ request, params, url, getClientAddress, locals }`).
  A small `tests/event.ts` helper builds one. Same in-process character, no server.
- **`db.test.ts`'s migration cases are deleted** along with the machinery they cover.
  The schema tests (PK shape, nullability, constraints) stay — they now assert the
  declared schema rather than the result of a rebuild.

**Green is the definition of done for each phase.**

## 8. Deferred: the Capacitor build

`build:native` has never been exercised end to end — there's no Android SDK
installed and no Mac. Carrying an unverifiable second adapter through the migration
is exactly the fiddliness this plan is meant to remove.

So `adapter-node` only, for now. The Capacitor deps stay in place; adding
`adapter-static` with `fallback: 'index.html'` is a five-line change whenever the
native build is actually attempted, and `VITE_API_BASE` already exists for it.

## 9. The local loop

The point of all this: **deploying should not be part of iterating.** Deploy when Dan
wants it on his phone; do everything else locally.

`npm run dev` already runs against the real SQLite file, with real VAPID keys and the
real PIN, on `localhost` — a secure context, so service workers and Web Push both
work. That was already true and under-used. Two gaps close it:

| Command                      | What it's for                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run db:reset`           | Empty schema, seeded admin. One command instead of a pile of hand-written `fetch` calls.           |
| `npm run db:seed <scenario>` | A known state: `busy` (orders across all four statuses), `helper-pending`, `join-code`.            |
| `npm run preview`            | The **built** output, served by `node build/index.js` — the production artifact, minus the tunnel. |

That last row is the one the migration unlocks. Today the built bundle can only be
checked by deploying, because production is nginx + a separate API + Caddy and Docker
isn't installed on the dev machine. After the migration it's one Node process, and
running it locally is identical to running it on the NAS.

**Dev-only capability overrides** go in at the same time: `?permission=default` and
`?platform=ios`, honoured only under `import.meta.env.DEV`, so push and install
states that a desktop browser can't otherwise produce become drivable. (The test
browser has notifications permanently denied — that cost a lot of round-trips this
session before it was recognised as an environment limit.)

## 10. CI

Deploys average ~150s and swing between 95s and 256s. The variance is **not** the
workflow — it's the hardware. The NAS is a 4-core Synology that also runs two
long-lived QEMU VMs (72% and 41% CPU, up 35 days), SQL Server and Plex, with almost
no free RAM and `kswapd0` visibly thrashing. Baseline load average is ~70.

Two conclusions follow, one of them learned the hard way:

**Do not run the gate on the NAS.** Merging the check job into the deploy job was
tried, to save a second checkout and ~15s of cloud VM provisioning. It failed the
run outright: `npm ci` + typecheck + 235 tests (the auth suite is scrypt at N=65536,
96 MiB per hash) on top of a three-image Docker build, on a box already at load 70.
The GitHub-hosted runner does the same gate in ~35s on idle hardware while the NAS
does nothing. **The two jobs are not duplication — they are the point.**

**Stop compiling on the NAS.** This is the real fix, and the migration enables it.
Today a deploy runs `docker compose up --build`, which means `npm ci` and `vite
build` inside three images, on the swapping box. After the migration the deployable
artifact is `build/` plus production `node_modules` — so a deploy becomes:

```
rsync the build output  →  docker restart cocktails-app
```

Seconds, with all compilation done on the dev machine or a cloud runner. That also
makes `npm run deploy:nas` genuinely fast (ssh path verified: key present, docker at
`/usr/local/bin/docker`, sudo required).

| Change                                                   | Status                         |
| -------------------------------------------------------- | ------------------------------ |
| `cancel-in-progress: true` — supersede rather than queue | ✅ done                        |
| Merge gate into the deploy job                           | ❌ tried, reverted — see above |
| Three images → one                                       | with the migration             |
| Ship a built artifact instead of building on the NAS     | with the migration             |

Note the gate job is the only _billed_ Actions usage; the NAS runner is self-hosted
and free. Billing was never the thing worth optimising — wall-clock was, and the
answer turned out to be "use the cloud runner more, not less".

## 11. Phases

Branch `sveltekit` off `modernise` — **only** so the NAS doesn't collect twenty
failed deploys, not to keep anything alive. Merge when it works.

1. **Scaffold** — SvelteKit, `adapter-node`, both dev and build producing output.
2. **Shared + server** — move `$lib/shared` and `$lib/server`, rewrite the schema
   (§5), fix imports. _Gate: db/auth/notify/push tests green._
3. **Routes** — 25 `+server.ts` files + `hooks.server.ts`, tests rewritten. _Gate:
   all API tests green._
4. **UI** — layout, `/` and `/bar`, components, stores. The bar becomes a route; the
   rest stay dialogs. Change the push deep-link from `/?bartender` to `/bar`. _Gate:
   web tests green._
5. **Service worker + manifest.** _Gate: build output has a SW; push still fires._
6. **Infra** — single container, drop Caddy (§6), deploy, verify (§13), merge.
7. **Delete** `apps/`, `packages/`, `dev.mjs`, the proxy config, the Caddyfile, and
   the workspace wiring.

## 12. What the "no users" assumption actually buys

Recorded so it's obvious what to re-add if the assumption stops holding:

| Dropped                                 | Because                                             | Re-add when        |
| --------------------------------------- | --------------------------------------------------- | ------------------ |
| In-place SQLite migrations              | Nothing in the DB is worth keeping                  | There's real data  |
| "Each phase stays deployable"           | Downtime is free                                    | Never, probably    |
| Rollback plan                           | Reverting is `git revert` and a redeploy            | Never              |
| Handler/wrapper split to preserve tests | Rewriting 180 tests is cheaper than the indirection | Never              |
| `/?bartender` → `/bar` redirect         | No notifications are in flight                      | Never              |
| Capacitor build target                  | Never been exercised; no SDK, no Mac                | First native build |

## 13. Verification before merge

Not a gated ceremony — just the list of things that must work:

- PIN sign-in issues a working admin session; a join code mints and redeems
- an order placed as a guest reaches the bar; a status change pushes to the guest
- the PWA installs and an installed one updates
- `/bar` loads directly and on refresh
- both `npm run check` and the full test suite are clean

## 14. Out of scope

| Not doing            | Why                                                                             |
| -------------------- | ------------------------------------------------------------------------------- |
| Changing the design  | `neo.css` is a verbatim port and stays that way                                 |
| React/Next           | Discards the design port and the runes code for nothing                         |
| SSR for app routes   | It's an offline PWA                                                             |
| A validation library | `cleanStr`/`cleanItems` coerce rather than reject, deliberately, and are tested |
| Building the 3D menu | This unblocks it (`/menu-3d` as a lazy route); it isn't part of it              |

## Appendix: three.js

Barely constrains the choice — a canvas and a render loop, identical in any
framework. Two things matter, both arguments for this plan: it's **~600KB**, so it
wants lazy loading behind a route; and **[Threlte](https://threlte.xyz)** gives
declarative three.js in Svelte, the way react-three-fiber does for React.
