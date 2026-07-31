# How the platform got here

The record of work already done, moved out of `PLATFORM-PLAN.md` on 31 Jul 2026 so
that file can be a forward plan rather than a diary. **Nothing here is an
instruction.** Read it when you want to know why something is shaped the way it is,
or before overturning a decision that looks arbitrary.

The rewrite that follows this record supersedes several of these decisions on
purpose. Where it does, `PLATFORM-PLAN.md` §3 says so explicitly.

## What was true when this was written

Phases 0, 1, 2, 2.5, 2.6, 3 and 4 were done; 361 tests green, 0 type errors. The
live database on the Mac held one unverified test account, one boot-seeded event,
and **no real host data** — which is what made the rewrite affordable.

## The lessons, extracted

Kept out of the phase write-ups because they generalise:

- **A deliverable narrowed without asking is a deliverable dropped.** Phase 1 was
  marked done with Google OAuth quietly moved to "optional". Dan noticed. Say it out
  loud and let him decide.
- **Read the plan before asking a question it answers.** Dan was asked to choose
  whether the generated list replaces the curated menu; the plan already said
  "gated".
- **Endpoints are not a feature.** Phase 1's gate was met entirely through the API,
  so accounts existed with no screen to reach them. Phase 2.6 exists because of it.
  The same mistake recurred in phase 3.
- **Building where the plumbing already works is how you end up in the wrong place.**
  The phase 3 stock screen went inside the bar because a bar session was the only
  credential `requireCapability` understood — not because that is where a host's
  cupboard belongs. The fix was not to move the screen; it was to build the actor
  model that should have existed first.

---

## The phases, as they were completed

### ~~Phase 0 — Drizzle, migrations, capabilities~~ ✅ done, 30 Jul 2026

1. **Adopt Drizzle.** Add `drizzle-orm`, `drizzle-kit`, `better-sqlite3`; drop
   `node:sqlite`. Declare the current schema in `src/lib/server/schema.ts`.
2. **Rewrite `db.ts` against Drizzle.** All ~96 prepared statements. Delete the raw
   SQL as you go — don't leave both. Keep the exported function names so callers and
   their tests move unchanged where possible.
3. **Generate the baseline migration** with `drizzle-kit generate`, applied at boot.
4. **Capability model** per §6, replacing `requireAdmin` / `canApproveStaff`.
5. **An enumeration test** walking every `+server.ts`, failing if it declares no
   capability — the same trick that already guards the test dispatcher, so a new
   endpoint can't ship ungoverned.

_Gate: **met** — 261 tests green (251 + 10 new), 820 files 0 type errors. The baseline
migration was generated from the schema and produces the same five tables, defaults,
composite key and unique index as the old declared DDL; the app was booted to confirm
it applies at first query and round-trips an order._

**Two things worth knowing before phase 1:**

- Migrations are applied by `createDb`, not a separate boot step, so one code path
  covers the server, the dev loop and every `createDb(':memory:')` in the tests.
- A database created **before** this phase has the tables but no
  `__drizzle_migrations` row, so the baseline collides with "table orders already
  exists". Deliberately not solved with adoption code — see `OUTSTANDING.md`.

### ~~Phase 1 — accounts~~ ✅ done, 30 Jul 2026

Better Auth on the Drizzle handle; email + password with verification; Google/Apple
OAuth as configuration.

> **Google was left out and later put back.** This phase was marked done with OAuth
> quietly moved to OUTSTANDING as "optional" — a deliverable narrowed without asking.
> Built on 30 Jul 2026 once Dan noticed. Apple stays out on a stated judgement, not
> silently: it needs a paid developer membership and a client secret that expires
> every six months, which is four times faster than the Entra secret we avoided by
> using a certificate.

**Email is an interface.** Define `EmailSender` with a development implementation that
logs to the console, so this phase completes without the Entra registration (§8.1).
Wiring Graph `sendMail` behind it is then a small, separate task.

**The PIN survives.** Typing an email and password behind a bar mid-party is exactly
the misery the keypad removed. Accounts are for hosts and for signing in from a new
device; the PIN and join codes stay as the fast door into an event.

_Gate: **met** — 270 tests green, 1360 files 0 type errors. `tests/accounts.test.ts`
drives sign up → verify → sign in → reset through the real HTTP surface, reading the
verification link out of the captured message the way a person reads their inbox._

**Worth knowing:**

- Mounted at **`/api/account`**, not Better Auth's default `/api/auth` — that path is
  already the staff PIN/session routes, which survive.
- Better Auth's tables live in `schema.auth.ts`, apart from ours, because their shape
  is the library's to dictate: it looks properties up by name, so a rename breaks at
  runtime rather than at compile time.
- `tests/accounts.test.ts` runs under **node, not jsdom**: Better Auth signs tokens
  with `jose`, which checks `instanceof Uint8Array`, and jsdom's is a different realm.
  `tests/setup.ts` now guards its DOM cleanup so node-environment files can exist.
- Real email needs the Entra registration — see `OUTSTANDING.md`. It is _not_ blocking:
  the sender is an interface and the dev implementation logs.

### ~~Phase 2 — tenancy~~ ✅ done, 30 Jul 2026

`account`, `event`, `event_member`, `inventory`. Every existing query gains a scope.

**The scope must be a required parameter of every query function**, so omitting it is
a _type error_ rather than a silent cross-tenant leak. This is the phase where a
mistake is invisible and expensive; the type system is the defence, not care.

_Gate: **met** — `tests/tenancy.test.ts`, 282 tests total, 0 type errors._

**Two corrections to §5's domain model, made while building it:**

- **There is no separate `account` table.** Better Auth's `user` already is one, and
  it owns a different table literally named `account` for provider credentials.
  `event.hostUserId` points at `user`.
- **`staff` _is_ `event_member`.** A separate membership table only works if every
  participant has an account, and helpers deliberately don't — a join code gets them
  in with nothing to invent. Two membership tables would then have to be kept in
  agreement about who may do what, which is the exact bug §6 exists to kill. So one
  table, with a nullable `userId` for the rows that do have an account.

**`event.hostUserId` is nullable**, for exactly one case: the default event seeded at
boot, before anybody has signed up. Making it NOT NULL would mean inventing a user
account to satisfy a foreign key.

**The gate caught three real leaks**, which is the argument for writing it before
believing the refactor. Orders were correctly isolated, but `staffById` was a global
lookup, so a host could approve, revoke or delete another host's helper. Fixed by
splitting it into `staffInEvent(eventId, id)` and `staffByIdUnscoped(id)` — the latter
is genuinely needed when resolving a session, and its name now makes misuse obvious.

### ~~Phase 2.5 — close the loop~~ ✅ done, 30 Jul 2026

**Not in the original plan.** Added after phases 1 and 2 turned out not to join up:
accounts existed, events existed, and nothing connected them — signing up led
nowhere, and a guest's order went to whichever event happened to be live.

Taken _before_ phase 3 deliberately. The generator's whole point is a menu per host
from their own stock, so building it first would have meant `listInventory(ensureLiveEvent())`
everywhere and testing the interesting part against a singleton. Same argument as
doing Drizzle before tenancy: do the structural work while already in there.

- `requireAccount()` resolves a Better Auth session in our own routes — the missing
  bridge between phase 1 and phase 2.
- `POST /api/events` creates a party and makes the host its owner behind the bar,
  writing `staff.userId` so that column stops being dead.
- `POST /api/events/[id]/bar` trades an account session for a bar session, so the bar
  endpoints don't have to learn a second kind of caller.
- Orders name their party; `/e/<id>` is the link behind the QR code. `liveEvent()`
  survives only as the single-party fallback.

_Gate: `tests/host-loop.test.ts` — sign up → verify → create → open the bar → guests
order, with **two events live at once**, which the isolation suite cannot set up._

### ~~Phase 2.6 — the missing door: auth and host UI~~ ✅ done, 30 Jul 2026

**A gap in this plan, spotted by Dan on 30 Jul 2026.** Every phase here is written in
terms of endpoints, and phase 1's gate — "sign up → verify → sign in → reset, end to
end" — was met through the API. The plan never scheduled the _screens_. The only UI
it mentions anywhere is phase 3's stock screen.

The result: guests, helpers and Dan-via-PIN all have working doors, and the **host —
the entire point of the overhaul — has none.** Signing up requires curl. Building the
stock screen first would have meant designing for a person who cannot yet exist.

So, before phase 3:

1. **Graph `sendMail` behind the existing `EmailSender`** — writable and testable now
   against a faked `fetch`; the Entra registration (§8.1) becomes the last 5% rather
   than a prerequisite.
2. **Sign up / sign in / verification landing.**
3. **Create your party**, and **open its bar** — the two endpoints from phase 2.5,
   with a face.

_Gate: **met**, and walked in a browser rather than asserted — sign up → follow the
emailed link → verified and signed in → create a party → open its bar → a guest order
at that party's link appears in it._

**One thing the walk caught that no test would have.** Sign-up with verification
required deliberately issues no session, so the screen fell straight back to "signed
out" and redrew the form the host had just submitted — the same "it dumped me back at
the login screen with no idea what happened" that made the ask-to-help flow feel
broken. Signing up is a thing that _happened_; the screen has to say so, and now does,
without depending on a session that by design doesn't exist yet.

`/host` is reachable from the bar door ("It's my party"), because it was otherwise
findable only by typing the URL.

### ~~Phase 3 — inventory and the generator~~ ✅ done, 31 Jul 2026

- Restore the data: `git show 5a41824:cocktails.json` — **270 recipes**, an 11-step
  `categoryOrder` (liquor → citrus → juice → sweetener → bitters → texture → herb →
  top → aromatic → finish → method), plus an ingredients table.
- Port `reachable()` from the deleted `app.js` (~200 lines of ES5, around line 900 at
  the same commit) to typed TS **with tests first**, checked against known recipes.
- Host's stock screen → the makeable list. The main menu is then gated by stock.

**The inventory feature and Make-a-Drink are the same engine.** "What can I make from
this cupboard" is one `reachable()` call with the stock as the picked set;
Make-a-Drink is the interactive walk over the same function. Port once, use twice —
which is why the interactive flow should come _after_ the inventory proves the port.

_Gate: the ported engine agrees with the old one on a fixture set of ingredient
combinations._

**Two things this phase turned up that the plan didn't predict, both in
`tests/stock.test.ts`:**

1. **The two screens were already disagreeing.** `GET /api/inventory` computed
   `makeable(stock)` and `GET /api/events/[id]/menu` computed
   `makeable(stock, { ignore: ['finish'] })`, so a Dry Martini counted at the bar and
   not on the menu. Nothing failed — the numbers were just different, on two screens
   nobody sees side by side. The rule is now `OPTIONAL_CATEGORIES` in `$lib/shared`,
   read by both, with a test asserting the two agree.
2. **An unrecorded cupboard is not an empty one.** Gating on "no stock rows" greyed
   out four of six drinks for every brand-new party, before the host had been asked a
   single question. `rows.length === 0` now means "never asked" and offers everything;
   the `false` rows the PUT already writes are what make the first tick real.

Make-a-Drink — the interactive walk over `reachable()` — is still unbuilt. The port is
done and tested, which is the precondition the plan set for it.

### Phase 4 — move to the Mac, natively — ⏳ mostly done, 30 Jul 2026

No code change; this is the host move, and it can be done any time after phase 0.

1. Homebrew, Node 24, `cloudflared`, `litestream`, `tmux`.
2. The app as a **launchd** job with `RunAtLoad` + `KeepAlive`. Auto-login is on, so a
   LaunchAgent survives reboot; a LaunchDaemon wouldn't need the login session at all.
3. `cloudflared` likewise. Repoint the tunnel's Public Hostname at the app's port —
   the ingress rule lives in the Cloudflare dashboard, not this repo (§8.5).
4. Move the GitHub Actions runner off the NAS. **Record the gate time** — the NAS
   managed 472 s; this is the number the move was made for.
5. **Delete `infra/` and the Docker build** from the workflow. Don't leave both paths.
6. Litestream → R2, **and a restore drill**. An untested backup is not a backup:
   restore to a scratch path and diff it against the live database.

_Needs a human for the R2 bucket and the tunnel ingress rule (§8)._

### Phase 5 — end-to-end tests

Playwright over the real flows now that they're stable: guest orders → bar sees it →
advances it → guest is notified; host defines stock → menu reflects it; a helper joins
and is scoped to one event. Shard across cores.

_Gate: the suite runs in CI on the Mac runner._
