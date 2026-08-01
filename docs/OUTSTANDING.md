# 🧊 Outstanding / parked

Things deliberately deferred — revisit before they block a phase.

> ## ⚠️ Start with [`HANDOFF-2026-08-01.md`](HANDOFF-2026-08-01.md)
>
> The 1 Aug session supersedes parts of the 31 Jul section below. Two things there
> are live hazards this file does not mention: **`EVACUATE` is switched on in the
> service worker** and must be turned back off, and **"which party?" on the bar is an
> open bug with the audit half-finished**. Read that first.

## 📍 Where the session of 31 Jul 2026 (evening) left things

Written for whoever picks this up next, because none of it is discoverable from the
code.

### ~~Deployed vs. on `main` — they differ~~ — resolved 1 Aug 2026

All four of those commits deployed long ago. As of `18df8f6`, **live, `main` and
`origin/main` are the same**. Deploying is still manual and on Dan's say-so:

```bash
gh workflow run "gate + deploy (Mac)" --ref main -f deploy=true
```

### The stale-version bug had three causes, not one

Reported as "I refresh and still get the old version", on Android, in both the
installed PWA and Chrome. Worth keeping together because each was invisible from
the others and only the third is fixed in code:

1. **Nothing had been deployed for hours.** The live site sat on `5e32e82` while
   `main` ran seventeen commits ahead. Pushing gates; it does not deploy.
2. **Cloudflare was edge-caching `/service-worker.js` for four hours.** It caches by
   file extension and `.js` is on the default list, so a fresh registration could be
   handed the _previous_ worker — which deletes the current cache on `activate` and
   then serves its own, origin-wide. Fixed by a **Cache Rule in the dashboard**, not
   in this repo — see `PLATFORM-PLAN.md` §9, and the deploy job asserts it survives.
   `updateViaCache: 'none'` in `svelte.config.js` is the browser half and measured
   _not_ sufficient on its own: Cloudflare honours those directives on an origin
   response, not on a request.
3. **Rendered HTML went out with no caching directives at all** — no
   `Cache-Control`, no `ETag`, no `Last-Modified`. Browsers may then reuse it
   heuristically, and the service worker's network-first `fetch()` reads that same
   HTTP cache, so a stale document came back looking like a fresh one and was written
   into Cache Storage as current. Fixed in `hooks.server.ts` (`b16deb9`).

**Still open, and the better question:** the service worker does two jobs — precache
the shell, and receive Web Push. Push needs it. Precaching does not, and precaching
caused every failure above. Everything the app does needs the API, so an offline
shell renders a UI that cannot do anything. Chrome dropped the fetch-handler
requirement for installability in 108/112, so **stripping the worker back to push-only
is available and would delete more code than it adds.** Proposed, not decided.

### ~~Tests are on disk but out of the gate~~ — partly reversed, 1 Aug 2026

`npm test` **is back in the CI gate** ("Format, typecheck and test"), along with an
explicit build step. `npm run test:e2e` is still **out** of the gate and run by hand;
it passed 14/14 against a real build at `18df8f6`.

The standing "do not write tests" rule has softened to: **`npm test` gates, e2e is by
hand, and do not write _new_ tests unless asked.** The original note follows.

### Tests are on disk but out of the gate — Dan's call, 31 Jul 2026

`npm test` and `npm run test:e2e` no longer run in CI; two commented lines in
`.github/workflows/deploy.yml` turn them back on. `npm run build` was added as an
explicit step because `test:e2e` used to build as its first act, and removing it
removed the only proof in CI that the app compiles.

**What that costs:** `tests/capabilities.test.ts` and `tests/tenancy.test.ts` were
what stood between a change and one party's guest seeing another party's queue.
Nothing watches for that now.

**Also standing: do not write or run tests until Dan says otherwise.** Verify in a
browser instead — screenshots and DOM measurement caught every bug worth finding
that evening, and cost nothing.

### ~~Next up: navigation~~ ✅ done, 31 Jul – 1 Aug 2026

Audited and rebuilt: `AppBar` (three-slot grammar), `Gate` (never redirects),
`SignInSheet`, real routes for `/admin/p/[id]`, `/admin/h/[id]`, `/bar/[id]`,
`/host/[id]`, `/e/[id]/choose`. Written up in [`NAVIGATION.md`](NAVIGATION.md),
including the §6.6 journeys table — which exists because reporting progress as
_components built_ rather than as _things a person still cannot do_ hid a real gap
from Dan for a whole session. Report journeys.

### Live data, so nobody is surprised by it

**Updated 1 Aug** — see [`HANDOFF-2026-08-01.md`](HANDOFF-2026-08-01.md) §6 for the
current state, including a party that pours zero drinks and the fact that outbound
email is not actually configured on the box.

- **Owain's Big Bash** (`7a0f0cd2bec1`) is hosted by **Owain**, not Dan — the
  cupboard hangs off the host, so that is whose 29 ticks were filled from photos.
  Now `live`, with 12 guests and orders taken.
- **Today** (`3d4ecfa7627f`, Dan's) is still `draft` with a 3-bottle cupboard —
  and that cupboard makes **nothing**.
- A `.bak-before-cupboard` copy of the live database sits beside it on the Mac.

### The local dev database is dirty

Not production, but it will confuse: it holds a throwaway admin `audit@local.test`,
Owain's cupboard mirrored onto _Ana's birthday_, three overlapping runs of
`npm run db:seed busy`, and a hand-inserted nine-drink order for "Rosalind" used to
measure card heights. `npm run db:seed reset` clears it.

### Parked with enough context to resume

- **Drink options / the variant model** (the old phase 7). Investigated in full, not
  built. The findings: option axes — Boozy/Boring, Single/Double, Spicy, ice, garnish
  — exist for **6 drinks out of 286**, in `src/lib/data.ts`. They **never consult the
  cupboard**, and could not: six of the seven `adds` values are free text
  (`Extra shot`, `Watermelon`, `1 ice cube`) rather than catalogue ingredients. Worse,
  the configurator opens on **exact name equality**, so on a generated menu they
  mostly vanish — Owain's 33 drinks contain exactly one configurable drink, and his
  margarita is _Tommy's Margarita_, which does not match. Meanwhile the matrix
  encodes the same ideas as separate recipes (Margarita, Tommy's, Spicy, Cadillac,
  Strawberry, Mezcal). The fork to decide first: do duplicate variant recipes collapse
  into axes, or stay as rows? Note also that axes split cleanly into ones with an
  ingredient implication (Boring, Spicy) which _should_ be cupboard-gated, and ones
  without (strength, ice, glass) which could apply to all 286 tomorrow.
- **The 3D menu** at `/e/[id]/3d` works, but `src/lib/three/rack.ts` and
  `glassware.ts` are **unrouted and dead** since the grid replaced them. Kept
  deliberately; delete if that idea is not revisited.
- **Frameworks** were considered and declined, 31 Jul 2026. SvelteKit stays; a styled
  component library would fight `neo.css`, which is frozen and is the product's
  personality. Headless primitives (Melt/Bits) are the only real candidate and would
  mostly duplicate `src/lib/dialog.ts`, which is good. The real finding was that a new
  overlay had skipped that existing action — `tests/overlays.test.ts` now guards it.

## ~~🩹 Concessions made in phases 0–2~~ — superseded, 31 Jul 2026

**This section listed six concessions. Five described code that no longer exists**,
and they are removed rather than struck through, because a list of holes is only
useful if every entry is still a hole. The rewrite in `PLATFORM-PLAN.md` — one actor
model, one guard, the party named in the path — closed them as a side effect of
being a rewrite:

- _"A guest cannot choose their party."_ `liveEvent()` is gone. A guest arrives at
  `/e/<id>` and the id rides on the order; there is no such thing as "the" live party.
- _"Signing up leads nowhere."_ Already marked fixed in 2.5.
- _"The capability model was not widened as promised."_ `can(actor, capability,
scope)` is the account-role × party-role pair, and `tests/permissions.test.ts`
  transcribes the matrix from the plan rather than from the implementation.
- _"The seeded default event is owned by nobody."_ There is no boot seed. A fresh
  database has no events, and party creation is admin-only.
- _"`inventory` exists and nothing reads it", "no UI for events or sign-up", the
  hand-collapsed migrations._ All gone with the schema restructure; `drizzle/` is one
  baseline migration against an empty database.

**One survives**, and it is in the plan's §13 too:

### `staffByIdUnscoped` is guarded by its name, not by the type system

The unscoped lookup is genuinely needed when resolving a session from a token we
already trust. But the plan's principle is "the type system is the defence, not
care", and a name is care. A branded `TrustedStaffId` type would make it real.

## ⛔ Waiting on a human

Per [`PLATFORM-PLAN.md`](PLATFORM-PLAN.md) §0, work that needs a browser login is
stubbed behind an interface and logged here rather than stopping the plan. Each entry
says what is needed, who can do it, and what it unblocks.

### ~~Cloudflare tunnel~~ ✅ cut over, 30 Jul 2026

`cock.meridew.com` is served by the Mac. `cloudflared` runs there as a LaunchAgent
reading its token from `~/.config/cocktails/tunnel-token`, and the NAS's `app`,
`cloudflared` and runner containers are stopped. Nothing of ours runs on the NAS.

Verified by what only the new build answers — `/api/inventory` and `/api/events`
return 401 rather than 404 — not merely by a 200, because the _old_ build returned a
200 too.

### 🧊 Litestream → R2 — parked, 30 Jul 2026

**Dan's call: back burner.** Litestream 0.5.15 is installed on the Mac and configured
with nothing, so **there are currently no backups of anything.**

That is a fine trade _today_ — the database is empty, so losing the disk would cost
an afternoon of re-running migrations. It stops being fine at exactly the moment the
wipe permission does: **the first host account that isn't Dan's.** From then the data
belongs to someone else, and a single SSD is the only copy of their evening.

When it comes off the back burner: an R2 bucket and API token from the Cloudflare
dashboard, then `litestream replicate` as a third LaunchAgent beside the app and the
tunnel. Not done until a restore into a scratch path has been diffed against the
live database — the plan is explicit that an untested backup is not a backup.

### ~~Real email~~ ✅ done, 30 Jul 2026

Microsoft Graph, authenticated with a **certificate** rather than a client secret, so
nothing secret ever passed through a clipboard or this repo. Proven end to end
against the live tenant: certificate → token → `sendMail` → shared mailbox. Details
and identifiers in [`PLATFORM-PLAN.md`](PLATFORM-PLAN.md) §9.1.

### ~~`STAFF_PIN` on the Mac~~ ✅ moot, 31 Jul 2026

This used to say "still unset — set it and restart". **There is no such variable any
more.** The actor model replaced a single shared PIN in the environment with a
per-account one in `user_pin`, which a host sets from their own screen; a shared
secret had no way to say who had just used it. `STAFF_EMAIL`, `STAFF_PASSWORD` and
`STAFF_PIN` were deleted from `~/.config/cocktails/env` when the database was wiped.

Recorded rather than deleted because **`STAFF_PIN`'s value was echoed into a
transcript** in an earlier session. Removing it is the rotation that was owed.

### Google sign-in — needs credentials

**I was wrong to file this as "optional".** Phase 1 of the plan lists "Google/Apple
OAuth as configuration" as a deliverable; demoting it was scope-narrowing without
asking. The code is now written and tested — only the credentials are missing.

From the **Google Cloud Console** → APIs & Services → Credentials → OAuth client ID
(type: Web application):

- **Authorised redirect URI:** `https://cock.meridew.com/api/account/callback/google`
- For local testing, add `http://localhost:5173/api/account/callback/google` too.

Then two lines in `~/.config/cocktails/env` on the Mac and a restart:

```
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
```

Unlike Graph, this genuinely needs a _secret_ — the OAuth authorization-code flow has
no certificate option. Until both are set, Better Auth registers no Google routes and
the button doesn't render; `tests/accounts.test.ts` asserts both halves of that, so
the app can never offer a door that opens onto a 500.

### Apple sign-in — not recommended at this scale

Deliberately not built, and this is a judgement worth recording rather than a task.
Apple requires **membership of the Apple Developer Program (~£79/year)**, and its
"client secret" is a JWT you must regenerate **at least every six months** — the plan
already lists an expiring credential with no reminder as an accepted risk, and this
one expires four times faster than the Entra secret we avoided. For a hobby project
serving friends, Google plus email covers it.

## ⚠️ Any pre-31-Jul database must be deleted, not migrated

`drizzle/` is **one baseline migration** describing the actor model. A database
created by any earlier build has the old tables and no matching
`__drizzle_migrations` row, so the baseline collides with `table orders already
exists` at boot.

Deliberately **not** solved with adoption code — that would be a compatibility shim
for a single transition, and `PLATFORM-PLAN.md` §0 rules those out while the data is
still disposable. The live database was deleted on 31 Jul 2026 for exactly this
reason. The NAS volume (`cocktails-data`) still holds an old one; nothing of ours
runs there any more, and if anything ever does, delete it first.

## Voice / NL "Ask" finder — ❌ DROPPED

The legacy voice/natural-language "Ask the bar" finder relied on a now-dead
MCP / external service. **Not being ported** to the rebuild.

It lived only in the legacy flat app, which has been deleted along with GitHub
Pages. Nothing to strip.

## ~~Make-a-Drink + live ingredient availability~~ — ✅ built, 31 Jul 2026

Phase 5. The open questions are answered by what shipped:

- **Granularity** — per ingredient, not per brand. `STOCK_GROUPS` is the tick list.
- **Who owns it** — the **host**, not the party and not the bartender. `stock` is
  keyed on `user_id`, so a host with three parties fills one list in, and
  `Cupboard.svelte` is the same component on `/host` and `/admin`.
- **Live sync** — none, and deliberately. The menu is generated when the guest loads
  it. A host restocking mid-party is not a thing that happens.
- **The axes model** — untouched. The six house drinks keep their configurator; a
  generated recipe has no options and goes straight into the round.

The dataset came back with it: `src/lib/shared/data/cocktails.json`, 270 recipes,
read by `$lib/shared/recipes.ts`. The old note about retrieving it from `5a41824` is
obsolete.

What did **not** happen is the second half of the old "gates the main menu" idea —
nothing is greyed out, because the list _is_ what's pourable. A greyed card would be
a drink the host never claimed to be able to make.

## ~~Visual restoration / polish pass~~ — ✅ mostly already true, verified 31 Jul 2026

**This entry was stale, and it did damage before anyone checked it.** It claimed the
display fonts were "referenced in CSS vars but never linked", and that claim was
copied straight into `PLATFORM-PLAN.md` as the entire justification for a phase.
Verified in a running browser instead of read:

- **The fonts load and render.** `@fontsource/bungee`, `@fontsource/archivo-black`
  and `@fontsource/space-grotesk` are imported in `+layout.svelte`;
  `document.fonts.check()` is true for all three, and headings compute to
  `Archivo Black` with buttons on `Bungee`. (Playfair is named nowhere in
  `neo.css` — that part was never true either.)
- **The background cannon runs.** `startBackgroundCannon` is wired in the layout and
  the canvas is a full-viewport fixed layer. Its `width`/`height` read `0` from the
  main thread, which looks broken and isn't: `useWorker: true` transfers the canvas
  to an OffscreenCanvas, so the worker owns the buffer and `getContext` throws by
  design. Check `getBoundingClientRect()` instead.
- **The celebrate burst fires** on a sent order, from `+page.svelte`.
- The palette is in force: `--bg` computes to `#ffe600`.

What is genuinely left is subjective and unscheduled: louder neon glow, favicon in
the bar, layout density. Not a phase — a pass to make when someone dislikes
something specific.

> **The lesson, since it cost a phase's justification:** a doc that says a thing is
> broken is a _claim_, not a fact. This one was wrong for long enough to be quoted
> as a reason. Check the running app before scheduling work off the back of a note.
