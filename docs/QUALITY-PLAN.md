# 🧭 Quality Plan — tests, hardening, and refactors

> **Goal:** take the working app from "shipped, untested" to "professional, tested, hardened".
> Derived from a four-angle audit (architecture · dependency leverage · correctness · test strategy)
> run on 2026-06-01 against commit `39650bc`. Every finding below was verified against source; the
> ones marked ✅**ran** were confirmed by executing code.
>
> **How to use this doc:** work top-to-bottom. Phases are ordered by dependency — do not skip ahead.
> Tick boxes as you go and append to the Progress Log at the bottom. A phase is done only when its
> **Exit criteria** pass. When the whole doc is ticked, the goal is complete.
>
> Companion docs: `APP-READINESS.md` (mobile roadmap) · `MOBILE.md` · `CUTOVER.md` · `handoff.md`

---

## 0. Engineering standards (the bar for every change in this doc)

**DRY**

- One source of truth per concept. If a rule exists in two places, extract it — don't sync it.
- Shared rules (validation, limits, status transitions) live in `packages/shared` and are consumed by
  _both_ client and server. Never re-declare a constant that `@cocktails/shared` already exports.
- No parallel per-status/per-role maps beside `STATUS_META`. Extend the table instead.

**Separation of concerns**

- `packages/shared` — contracts, schemas, limits. No I/O, no framework imports.
- `apps/api` — `config` → `db` (persistence only) → `auth`/`push` (domain) → `app` (HTTP) → `server`
  (process bootstrap). Imports point one way only; never upward.
- `apps/web` — `lib/api.ts` is the **only** module that calls `fetch`. State lives in `lib/*.svelte.ts`
  stores; `.svelte` components render state and dispatch intent. No business rules in components,
  no persistence policy (storage keys, TTLs) declared in UI files.
- Persistence goes through the `storage` seam — never touch `localStorage` directly.

**Professional code**

- Type-safe: no new `any`; avoid `as` casts that discard validation (`as never` is a smell).
- Errors are handled at a deliberate layer and are either surfaced to the user or logged — never
  silently swallowed. `catch {}` requires a comment justifying the swallow.
- Every behaviour fix gets a regression test that fails before the fix and passes after.
- Comments explain _why_, not _what_. Delete stale comments; they are worse than none.
- Keep public surface minimal — delete dead exports rather than leaving them "in case".
- Match surrounding style. Prettier is authoritative once Phase 0 lands.

---

## 1. Guardrails (non-negotiable)

- 🚫 **Do not redesign the visuals.** `apps/web/src/neo.css` is a verbatim port of the original
  hand-made design. Style changes only where a bug requires it.
- 🚫 **Do not break the live site.** `https://cock.meridew.com` is deployed from `modernise` on every
  push. Keep every commit deployable; the CI `check` job gates prod.
- 🚫 **Do not change the deployment contract**: `apps/api/src/server.ts` stays the entrypoint
  (`package.json` `main`/`start`, `dev.mjs`, and the Dockerfile all reference it).
- ✅ **Behaviour-preserving unless fixing a listed bug.** Refactors must not change observable output.
- ✅ **Small, focused commits.** Reformatting is its own commit, separate from logic.
- ✅ **Verify before moving on** — run the gate after each phase.
- ⚠️ **Never commit secrets.** VAPID/staff/tunnel values live in GitHub secrets + gitignored `.env`.
- ⚠️ **LAN DNS gotcha:** if `cock.meridew.com` resolves to GitHub Pages locally, the AD DC cached the
  old record. Verify prod with
  `curl --resolve cock.meridew.com:443:104.21.41.29 https://cock.meridew.com/api/health`.

---

## 2. Verification commands

```sh
npm run check                 # api tsc --noEmit + web svelte-check   (CI gate)
npm test                      # all workspace tests (after Phase 0)
npm -w @cocktails/web run build          # web/PWA build (must still emit sw.js)
npm -w @cocktails/web run build:native   # native build (must NOT emit sw.js)
```

Deploy + verify:

```sh
git push origin modernise
gh run list -R meridew/cocktails -b modernise -L1 --json databaseId --jq '.[0].databaseId'
gh run watch <id> -R meridew/cocktails --exit-status --interval 8
curl --resolve cock.meridew.com:443:104.21.41.29 https://cock.meridew.com/api/health
```

---

## Phase 0 — Foundations · unblocks everything else ✅ DONE

Goal: make the code testable, add the test runner, add the formatter. No behaviour change.

### 0.1 Testability refactor (behaviour-preserving)

Module-load side effects currently make the API untestable: `db.ts` opens SQLite + migrates at import,
`config.ts` freezes env at import, `server.ts` calls `seedStaff()` + `serve()` at import.

- [x] **`apps/api/src/db.ts` → `createDb(dbPath)` factory.** Move the existing body (currently
      lines ~19–end) inside the factory verbatim; return the query functions. Keep **every current named
      export as a one-line delegate** over a lazy singleton (`let singleton; const d = () => (singleton ??= createDb(config.dbPath))`)
      so **no call site in `auth.ts`/`push.ts`/`app.ts` changes**. Also export `raw: db` for migration tests.
      Side benefit: the DB opens lazily on first query instead of at import.
- [x] **Fix `:memory:`** — currently `resolve(process.cwd(), config.dbPath)` mangles it, so
      `DB_PATH=':memory:'` fails with `ERR_SQLITE_ERROR: unable to open database file` ✅**ran**.
      Special-case it (and skip `mkdirSync`/WAL for in-memory).
- [x] **`apps/api/src/config.ts`** — `export` `resolveStaffPassword` / `resolveAllowedOrigin` and give
      each an `env: NodeJS.ProcessEnv = process.env` parameter. The `config` literal stays untouched.
- [x] **Split `apps/api/src/app.ts` from `server.ts`.** `app.ts` holds the Hono app and routes
      (lines 1–~207 moved verbatim, `export const app`). `server.ts` becomes ~7 lines: import `app`, call
      `seedStaff()`, call `serve()`. Deployment contract unchanged.

### 0.2 Test runner — `node:test` (zero dependencies)

Chosen over Vitest: no new deps, matches the "Node built-ins" ethos, and tests run through the _same
loader that ships in Docker_. Vitest's unique wins (Svelte component tests, `import.meta.env`) are out
of scope (§Out of scope). Revisit only if component tests are ever wanted.

- [x] Create `apps/api/tests/` and `apps/web/tests/` — **plural**. A dir named `test/` makes Node
      execute _every_ file in it, so helper modules would run as tests ✅**ran**.
- [x] `apps/api/tests/setup.ts`: `process.env.DB_PATH ??= ':memory:';` — must be in an `--import` file,
      not at the top of a test, because static imports are hoisted and `config.ts` would freeze first.
- [x] `apps/web/tests/setup.ts`: 2-line `$state` shim (`globalThis.$state = v => v`) so
      `basket.svelte.ts` is importable under plain Node ✅**ran**.
- [x] Scripts: root `"test": "npm run test --workspaces --if-present"`; each workspace
      `"test": "node --test --import ./tests/setup.ts \"tests/**/*.test.ts\""` (double quotes — Node
      expands the glob itself, portable across pwsh/cmd/bash).
- [x] tsconfig `include` += `tests/**/*.ts` in both apps; add `"node"` to `apps/web` tsconfig `types`
      and `@types/node` to its devDependencies (resolves via hoisting today, but be explicit for `npm ci`).
- [x] **CI:** add a `Test` step to the existing `check` job in `.github/workflows/nas-deploy.yml`,
      after `npm run check`. `deploy` already has `needs: check`, so tests gate prod with no new job.
      Do **not** set `VAPID_*` on that job — with keys unset, `push.ts` is inert and the suite makes zero
      outbound requests.

### 0.3 Prettier

- [x] Add `prettier` + `prettier-plugin-svelte` (devDeps) and a `.prettierrc` matching current style
      (~100 col, single quotes, trailing commas). Add `.prettierignore` (`dist`, `dev-dist`, `android`, `ios`, `package-lock.json`).
- [x] Scripts: `"format"` and `"format:check"`. Add `format:check` to the CI `check` job.
- [x] **Commit the repo-wide reformat on its own**, with no logic changes, so later diffs stay reviewable.

**Exit criteria:** `npm run check` clean · `npm test` runs (even with 0 tests) · both build modes correct
(default emits `sw.js`, `--mode native` does not) · `npm run format:check` clean · deploy green.

---

## Phase 1 — Tier-1 tests · the safety net ✅ DONE

Write tests for **current** behaviour first (pure logic), so later phases are verifiable. Regression
tests for specific bugs are written in the phase that fixes them.

- [x] **`apps/web/tests/data.test.ts` — the menu axes engine.** Highest value in the repo; pure, no
      refactor needed. Cover: `axesFor` (Margarita prepends BOOZE; Old Fashioned `boozeChoice:false` has
      spirits but no booze axis; Wine has neither); `visibleAxes` (`booze:'Boring'` hides `strength`;
      Wine `colour:'Red'` hides `ice`, White/Rosé show it; **Old Fashioned with `{}` shows `strength`**
      because `undefined !== 'Boring'` — lock in this non-obvious correct behaviour); `defaultConfig`
      (order-dependence: an axis hidden by an earlier axis's default is omitted entirely) plus the
      invariant `Object.keys(defaultConfig(d))` equals `visibleAxes(d, defaultConfig(d)).map(a=>a.key)`
      for all `DRINKS`; `buildLine` — **most valuable single test: hidden axes must not leak** (Boring +
      `strength:'Double'` ⇒ no `Double` tag, no `Extra shot` add, no spirits in `recipe`), tag/add ordering
      follows axis order, unknown choice values are skipped without throwing.
- [x] **`apps/api/tests/shared.test.ts` — contracts.** `isOrderStatus` accept/reject sets;
      `Object.keys(STATUS_META)` is exactly `ORDER_STATUSES`; ranks unique + ascending; walking `next` from
      `pending` visits all four exactly once and terminates (no cycle/orphan); `next === null` iff
      `nextLabel === null`; all `LIMITS` are positive integers.
- [x] **`apps/api/tests/auth.test.ts`.** Hash shape + salt randomness; round-trip; wrong password;
      malformed stored hashes (`''`, `'nocolon'`, `':'`, `'aa:'`) → false. Sessions: round-trip, expiry
      boundary, `undefined`/garbage → null, **raw token never stored** (row equals `sha256(token)`).
      `login`: email normalisation (`'  BAR@LOCAL  '`), wrong password creates no session row, unknown
      email → null (assert the _outcome_, never timing — timing assertions are the top CI flake source),
      `purgeExpiredSessions` fires on success. `seedStaff`: creates, is idempotent (hash byte-identical on
      second call), rotates when the env password differs. Rate limiter with
      `mock.timers.enable({ apis:['Date'] })` ✅**ran**: 9 fails not blocked, 10th blocks, success resets,
      window expiry unblocks and restarts at 1. ⚠️ `loginHits` is module-level — give every test a unique IP.
- [x] **`apps/api/tests/db.test.ts`.** **Migrations** (the reason for 0.1): hand-build an old-schema DB
      in a temp file (no `user_id`, no `transport`/`platform`) with pre-existing rows → `createDb(path)` →
      assert columns added, defaults applied (`'webpush'`, `'web'`), **rows survived**; call again → no
      throw. Orders CRUD; corrupt `items` JSON → `[]` and no throw; `listOrders` ordering; unknown-id
      returns (`null`/`false`); `clearOrders` both modes; `orderDeviceId`. Subscription upsert (same
      device+endpoint ⇒ 1 row; different endpoint ⇒ 2), `deleteSubscription`.
      ⚠️ `node:sqlite` returns null-prototype rows — spread (`{...row}`) before `deepStrictEqual` ✅**ran**.
      ⚠️ Don't assert _which_ order the `maxOrders` eviction removed — all rows share a millisecond, so it's
      non-deterministic today (Phase 2 makes it deterministic). Assert the count invariant instead.
- [x] **`apps/api/tests/routes.test.ts` via `app.request()`** — in-process, no port ✅**ran**.
      Auth gate: every staff route 401s with no header / garbage / `Basic`, and accepts lowercase `bearer`.
      Login flow incl. non-JSON body → 401 not 500, and 429 after 10 fails (different IP still 401).
      `POST /api/orders` validation matrix (`{}`→422, empty items→422, whitespace name→422, `items:'nope'`→422;
      `qty` coercion 0→1, `'abc'`→1, `1000`→99, `2.7`→2, nameless item dropped, 60 items→50);
      body limit 300 KB → 413. `PATCH` bad status → 422, unknown id → 404, full `pending→making→serving→done`
      chain. `clear` both modes. **`POST /api/subscriptions` role downgrade** (bartender role without a
      token stores `guest`; with a valid staff token stores `bartender`; expired token downgrades).
- [x] **`apps/web/tests/basket.test.ts`** (needs the `$state` shim). Dedupe by name, qty clamp to
      `LIMITS.maxQty`, `setQty(0|-1)` removes, unknown name no-ops, `basketCount()` sums quantities not
      lines, `clearBasket` in `beforeEach` (module-level singleton).
- [x] **`apps/api/tests/config.test.ts`.** Prod + no `STAFF_PASSWORD` ⇒ random (never `'cocktails'`);
      prod + set ⇒ uses it; prod + no `ALLOWED_ORIGIN` ⇒ capacitor origins (never `'*'`);
      `'a, b ,'` ⇒ `['a','b']`.

**Exit criteria:** `npm test` green locally and in CI · ~90+ assertions · suite runs in well under a
second · no stray `apps/api/data/*.sqlite` artifacts created by the run.

---

## Phase 2 — Observability + Security ✅ DONE

The API is publicly reachable. Do observability first — it is what makes everything else debuggable.

### 2.1 Observability (zero new dependencies — all already installed)

- [x] `hono/logger` — there is currently **no request logging at all**.
- [x] `app.onError` — there is currently **no error handler**; an unexpected throw returns a bare 500
      with nothing in `docker logs`.
- [x] `hono/secure-headers`.
- [x] `push.ts`: `console.warn` the endpoint host + `statusCode` for non-404/410 failures. Today every
      such failure is swallowed, so e.g. a mismatched `VAPID_SUBJECT` ⇒ **zero notifications delivered,
      nothing logged**, while the API still returns `{ok:true}`.

### 2.2 Rate limiting (HIGH)

`POST /api/orders` and `POST /api/subscriptions` are unauthenticated with **no throttle** — only
`/api/auth/login` is limited. Combined with 2.3, 500 requests wipe the live queue.

- [x] Generalise the existing `loginHits` window (`auth.ts`) into **one** reusable rate-limit helper
      (DRY — do not write a second limiter) and apply it as middleware to `/api/orders` and
      `/api/subscriptions`. Do **not** add `hono-rate-limiter`; its value is a Redis store we don't want.
- [x] **Trusted IP derivation.** `server.ts` reads raw `x-forwarded-for`, which is client-controlled;
      the LAN `:8088` port bypasses Cloudflare entirely, so a random XFF per request defeats the brake.
      Prefer `cf-connecting-ip`, else the **first hop** of XFF, else `getConnInfo` from
      `@hono/node-server/conninfo` (already installed). Extract as a single `clientIp(c)` helper.
- [x] **Bound the limiter Map.** The current prune only deletes _expired_ entries, so it does nothing
      when all are fresh — evict oldest-`resetAt` unconditionally past the cap.

### 2.3 Order eviction (HIGH — data loss)

`createOrder` deletes the oldest order once `LIMITS.maxOrders` (500) is reached, regardless of status.

- [x] Prefer `done` rows, then oldest, and make it **deterministic**:
      `ORDER BY (status='done') DESC, created_at ASC, rowid ASC`.
- [x] Regression test: 500 orders + 1 more ⇒ count stays 500, a `done` row goes before a `pending` one.

### 2.4 Subscription endpoint validation — SSRF (HIGH)

`endpoint` is only checked `typeof === 'string'`, then `web-push` POSTs to it; `keys.p256dh` is never
validated; the row is cast `as never`.

- [x] Require `new URL(endpoint).protocol === 'https:'` **and** an allow-list of push-service hosts
      (`*.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`).
- [x] Require `keys.p256dh` (Phase 3's schema makes this structural).
- [x] Cap rows per `device_id` so random device ids can't fill the volume.
- [x] Regression tests: `http://`, an internal IP, and a missing `p256dh` all 422.

### 2.5 Password hardening

- [x] **`verifyPassword` empty-hash bypass** — `verifyPassword('anything', 'aa:zz')` returns **`true`**
      ✅**ran** (`Buffer.from('zz','hex')` is empty ⇒ `scryptSync(...,0)` is empty ⇒ `timingSafeEqual` passes).
      Guard `if (expected.length === 0) return false;`. Test first, then fix.
- [x] **scrypt cost** — currently Node defaults (N=2^14), **8× under the OWASP floor** (2^17). Raise N
      and lift `maxmem` accordingly; switch to the async (non-blocking) form. Existing hashes self-heal
      because `seedStaff` re-derives from env and rewrites on mismatch. Consider embedding params in the
      stored string before a second account exists.

### 2.6 Transport / session

- [x] Security headers in `infra/Caddyfile` (CSP, `frame-ancestors 'none'`, `X-Content-Type-Options`,
      `Referrer-Policy`, HSTS) — currently none anywhere in the chain, next to a 30-day bearer token in
      `localStorage`.
- [x] Shorten `SESSION_TTL_MS` (30d is long for a party app) and refresh on use.

**Exit criteria:** all 2.x tests green · flood test cannot evict a `pending` order · SSRF cases rejected ·
prod `/api/health` 200 after deploy · logs show request lines and a caught error.

---

## Phase 3 — Validation, rewritten as a shared schema

Replace hand-rolled `cleanStr`/`cleanItems` in `app.ts` + hand-maintained `NewOrderInput`/`OrderItem`
interfaces with **one** schema in `packages/shared` consumed by both sides. This is the design to pick
from scratch, and it closes several bugs by construction.

- [ ] Add `valibot` (~2 kB tree-shaken; chosen over Zod's ~14 kB because the PWA ships it) and
      `@hono/valibot-validator`.
- [ ] Define schemas in `packages/shared` (order, order item, subscription) with `LIMITS` applied;
      **infer** the TS types from them (deleting the duplicated interfaces — DRY).
- [ ] API validates via middleware; drop the `as never` cast.
- [ ] Client reuses the same limits: add `maxlength={LIMITS.maxFieldLen}` to the name/note inputs —
      today a 200-char note is silently truncated to 140 with a `200 OK` and no feedback.
- [ ] **Fix truncation by code point, not UTF-16 unit.** `cleanStr` iterates code points but then
      slices code units, so a 140-char boundary **splits an emoji** into a lone surrogate that reaches
      SQLite. Cap on `[...s]`.
- [ ] **Preserve line breaks.** Control chars are dropped with no replacement, so
      `"No ice!\nExtra lime!"` is stored as `"No ice!Extra lime!"`. Map to a space (and collapse runs), or
      allow `\n` in the note field.

**Exit criteria:** validation exists in exactly one place · emoji at the boundary survives intact ·
multi-line notes readable on the bar card · client prevents over-long input · route tests still green.

---

## Phase 4 — Correctness bugs

Each item: write the failing test first (where testable), then fix.

- [ ] **Bartender logout race (HIGH).** `fetchOrders` unconditionally sets `unlocked = true`; an
      in-flight poll resolving _after_ `signedOut()` re-shows the queue with an empty token, so every
      button then fails. Guard on identity (capture the token / bump a generation counter and drop stale
      responses).
- [ ] **Poll clobbers the optimistic merge.** `orders = r.orders` replaces the array with a snapshot
      taken before the PATCH committed, so a status can visibly revert for up to 4 s (and the guest gets an
      "INCOMING" push while the bar shows "Making"). Skip the poll while `busy.size > 0`, or version the store.
      The existing comment overstates what the merge defends against — update it.
- [ ] **Mobile tap-outside-to-close is dead (MED, primary platform).** `.order-backdrop` is a _sibling_
      of `.order-rail`, so `lockBackground(orderRail)` marks it `inert` and its `onclick` never fires —
      even though `neo.css` deliberately gives it `pointer-events: auto`. Exclude the backdrop from the
      lock (extra keep-node, or move it inside the kept wrapper).
- [ ] **`DELETE /api/orders/:id` returns `200 {ok:false}`** for a missing id, so the client renders
      _"Something went wrong (HTTP 200)."_ and leaves the row on screen. Return `404 {ok:false,error:'not found'}`
      (matching PATCH) and treat 404-on-delete as success client-side.
- [ ] **`InstallButton.svelte`** declares `role="dialog" aria-modal="true"` but never applies
      `use:dialog` — no focus trap, no Escape, no background inerting. One directive.
- [ ] **`dialog.ts` focusable filter** uses `el.offsetParent !== null`, which is `null` for
      `position: fixed`, silently excluding fixed controls from the trap. Use `checkVisibility()`.
- [ ] **`Configurator.svelte` `state_referenced_locally`.** `config` captures only the first `drink`
      while `axes`/`line` are `$derived` — latent wrong-order-line if `drink` ever changes in place
      (reachable where `inert` is unsupported, e.g. iOS < 15.5). Fix with `{#key}` remount or an explicit
      `$effect` reset.
- [ ] **`basket.svelte.ts` `addLine`** increments without a cap while `setQty` clamps to
      `LIMITS.maxQty` — 100 taps yields qty 100 client-side, silently clamped to 99 server-side. Clamp both
      (reuse one helper — DRY).

**Exit criteria:** every bug has a regression test (or a documented manual check for the two DOM ones) ·
tap-outside closes the sheet on a mobile viewport · no status flicker under a mutate-during-poll test.

---

## Phase 5 — Push subsystem, rewritten

Patching here would paper over a wrong model, so replace it.

- [ ] **Schema: a device can only hold one role.** PK is `(device_id, endpoint)` and the upsert does
      `role = excluded.role`, so enabling guest notifications **silently kills bartender alerts** on the
      same phone (the host's normal usage). Migrate to `(device_id, endpoint, role)` via the existing
      idempotent-migration helper; de-dupe by endpoint in `pushToDevice`.
- [ ] **`lib/push.svelte.ts` store — one state machine, resolved from truth.** Both `App.svelte` and
      `Bartender.svelte` currently seed `notify = 'on'` from `Notification.permission`, which says nothing
      about whether _this device+role_ is registered — so the UI claims "🔔 On" while no subscription
      exists. Resolve from `reg.pushManager.getSubscription()` **and** a persisted role, re-register when
      either is missing, and expose `enable(role, token)`. Collapses two divergent state unions
      (`'idle'|'working'|'on'|'denied'|'unavailable'` vs `'idle'|'working'|'on'|'off'`) into one (DRY).
- [ ] **VAPID rotation.** The client reuses an existing `getSubscription()` unconditionally, so after a
      key rotation that device silently never receives another push. Compare
      `subscription.options.applicationServerKey` and re-subscribe on mismatch.
- [ ] Server: set `PushPayload.url` (currently never set) **or** delete the dead deep-link plumbing —
      `notificationclick` computes `target` then returns before using it.

**Exit criteria:** enabling guest notifications does not disable bartender alerts (tested at the DB
layer) · the chip reflects real subscription state · one push state machine in the codebase.

---

## Phase 6 — Service worker → Workbox

- [ ] Replace the hand-rolled `sw.ts` cache logic with `precacheAndRoute(self.__WB_MANIFEST)` +
      `NavigationRoute`/`createHandlerBoundToURL`. `workbox-precaching@7.4.1` and `workbox-routing@7.4.1`
      are **already hoisted** via `vite-plugin-pwa` — zero new downloads; declare them as devDeps.
      Keep the push/`notificationclick` handlers (they're fine).
- [ ] Fixes the real defect: `CACHE = 'cocktails-shell-v1'` never changes, so `activate` never prunes
      and obsolete hashed bundles accumulate across every deploy until the storage quota is hit — at which
      point `addAll` rejects and `.catch(() => self.skipWaiting())` hides it, leaving the offline shell broken.
- [ ] ~40 lines → ~15. **Verify manually** (install the PWA, go offline, reload) — this is the offline
      path and is out of unit-test scope.

**Exit criteria:** default build still emits `sw.js` · native build still omits it · installed PWA works
offline after a redeploy · only one shell cache generation present.

---

## Phase 7 — Architecture & DRY cleanup

- [ ] **`lib/session.svelte.ts`** — own `token`/`staff`, `signIn`/`signOut`, and the storage key.
      Today `TOKEN_KEY` (an auth-persistence policy) is declared in a UI file, `token` is hand-threaded
      through 6 API signatures, and `Unauthorized` is handled in 4 places with 4 different messages.
      `api.ts` should read the session inside `req()` and invoke an `onUnauthorized` hook — the `token`
      parameter then disappears from every signature.
- [ ] **`lib/favourites.svelte.ts`** — favourites currently have load/parse/validate/persist logic
      inline in `App.svelte` while the structurally identical basket lives in `lib/*.svelte.ts`. Make the
      rule uniform: state in stores, components render.
- [ ] **Persist the basket** — the one piece of state a guest would actually mourn is the one that
      isn't saved; a phone lock + reload mid-party loses the round. Use the existing `storage` seam.
- [ ] **Extract `StaffGate.svelte`** from `Bartender.svelte` (263 lines doing three jobs: auth gate,
      poll loop, order queue). The sign-in form shares nothing with the queue but `unlocked`. Leaves a
      coherent ~140-line queue component.
- [ ] **Extract `OrderRail.svelte`** and **`SentCelebration.svelte`** from `App.svelte` (252 lines).
      The rail owns `name`/`note`/`errMsg`/`sending`/`send()` + ~48 lines of markup; the celebration owns
      the push opt-in. Leaves App as shell + menu + orchestration (~110 lines).
      🚫 **Do not** extract the menu grid — it's a 15-line `#each`; a `DrinkCard` would only add prop plumbing.
- [ ] **`ACT_CLASS` → `STATUS_META`.** A parallel `Record<OrderStatus, string>` in `Bartender.svelte` is
      exactly what `STATUS_META` exists to prevent. Add the field to the shared table (or reuse the
      `s-{status}` class already on the card). Also: `STATUS_META.label` is defined and never used — use or delete.
- [ ] **`clearDone()` duplicates `withBusy`'s error handling** because it has no order id. Make the id
      optional (`withBusy(id = '__bulk', fn)`) and call it.
- [ ] **Delete dead code** (all verified zero call sites): `api.ts` `health`; `db.ts` `getOrder`;
      shared `ApiError`, `MenuItem`, `MenuSection` (superseded by `data.ts`'s `Drink`/`Axis` — the menu is
      legitimately client-only, so delete rather than move); the stale _"Menu (filled with data during the
      UI port)"_ comment. Either use `api.ts` `me()` for session validation on mount (it's the right tool —
      `Bartender` open-codes it with `fetchOrders()`) or delete it.
- [ ] **`device.ts`** — delete the unreachable `Math.random` branch. The comment conflates two things:
      `crypto.randomUUID` is secure-context-gated, but `crypto.getRandomValues` is **not**, so the fallback
      never runs in any targeted browser. Removing it also drops the only non-CSPRNG path. Fix the comment.
- [ ] Consider `PRAGMA busy_timeout` beside `journal_mode = WAL` if more than one process ever writes.

**Exit criteria:** no `localStorage` outside `storage.ts` · no `fetch` outside `api.ts` · no storage keys
or TTLs declared in `.svelte` files · no parallel per-status maps · `App.svelte` and `Bartender.svelte`
each under ~150 lines · zero unused exports · full suite + gate green.

---

## Phase 8 — Close out

- [ ] `npm run check` · `npm test` · both build modes · `format:check` — all green.
- [ ] Deploy and verify prod (`/api/health`, `/`, `/api/push/key`, a login, a full order → status → push).
- [ ] Manual pass on a phone: install the PWA, place an order, enable notifications, drive it from the
      bar, confirm both pushes arrive, tap-outside-to-close works, offline reload works.
- [ ] Update `handoff.md` (test/format commands, new file layout) and tick the relevant
      `APP-READINESS.md` items.
- [ ] Fill in the Progress Log below.

---

## Out of scope (deliberate — do not add)

| Not doing                                                 | Why                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Svelte **component** tests                                | Needs jsdom + Testing Library + Vitest — the whole dependency argument reversed for the least stable code. The logic worth asserting already lives in `data.ts` / stores / `shared`. `svelte-check` covers template/prop/type errors.                                                 |
| Testing `dialog.ts` in jsdom                              | Concretely untestable: `focusables()` filters on `offsetParent`, which is always `null` without layout, so tests would only ever exercise the empty branch and "pass" while asserting the opposite of production. `inert` is also unimplemented. Verify with a real Tab/Escape press. |
| Testing `sw.ts`, `confetti.ts`, CSS, Capacitor shells     | Need a real SW scope / browser / device. Mostly library behaviour, nothing meaningful to assert.                                                                                                                                                                                      |
| Unit-testing `api.ts`                                     | `import.meta.env` is `undefined` under plain Node, and "fixing" it risks breaking Vite's static replacement in the `--mode native` build (the app would silently point at `/api`). Not worth it.                                                                                      |
| E2E (Playwright/Cypress)                                  | Slowest, flakiest, highest maintenance; one human path you'll walk yourself.                                                                                                                                                                                                          |
| Coverage thresholds                                       | Invites writing tests for `confetti.ts` to hit a number. Judge the suite by whether it would have caught a real bug.                                                                                                                                                                  |
| ORM / query builder (Drizzle, Kysely)                     | Prepared statements at module scope are already the fastest and most injection-safe form. `node:sqlite` driver support is community-maintained — the exact risk `node:sqlite` was chosen to avoid.                                                                                    |
| Auth libraries (Better Auth, Lucia, argon2)               | Better Auth drags in an ORM; Lucia is no longer a library; `@node-rs/argon2` is a native module. All three violate stated constraints. `node:crypto` scrypt is correct once the params are raised.                                                                                    |
| `localforage` / `idb-keyval` / `uuid` / `nanoid` / `pino` | Solve problems this app doesn't have. `storage.ts` (54 lines, try/caught) and `device.ts`'s UUID are correct; `hono/logger` is the right altitude for reading `docker logs` on a NAS.                                                                                                 |
| Redesigning the visuals                                   | `neo.css` is a verbatim port of the original design.                                                                                                                                                                                                                                  |

---

## Progress Log

| Date       | Phase | Commit(s) | Notes                                                                                                                                                                                            |
| ---------- | ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-06-01 | Audit | —         | Four-angle audit against `39650bc`; findings captured in this doc. HIGH items verified against source; `verifyPassword` bypass and the `:memory:`/`node:test` behaviours confirmed by execution. |

</content>
