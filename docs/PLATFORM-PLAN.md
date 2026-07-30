# Platform plan — hosts, accounts and the cocktail generator

**Status:** approved, not started. Point a goal at this and work top-to-bottom.
**Prerequisite:** none — phase 0 is self-contained.

> **Read this first if you're a fresh session.** `HANDOFF.md` describes the stack as
> it is; this describes where it's going and why. `CLAUDE.md` has the shell rules —
> read those before running anything, they are not optional on Windows. The decisions
> in §2 were made deliberately after research; don't relitigate them without a reason,
> and if you do, record the reason here.

---

## 0. How to work this plan

This is written to be executed by an agent working alone, iterating until genuinely
blocked. The operating contract:

**This is a green field.** The app is not live, has no users, and no data worth
keeping. Nobody else works in this repo. So:

- **Make large changes in one go.** Don't stage a refactor across three commits to
  "keep things working" between them — nothing depends on the intermediate states.
- **No backwards compatibility. No deprecation cycles. No compatibility shims.**
- **Delete freely.** If code is replaced, remove it; don't leave the old path beside
  the new one.
- **The database may be dropped and recreated at will** — see the caveat in §3, which
  turns this off permanently the moment a real account exists.

**Decide, don't ask,** about: naming, file layout, test structure, minor library
choices, error copy, and anything else where two reasonable answers produce the same
product. Ambiguity is only worth a question when different readings produce a
_materially different app_.

**When you hit something that needs a human** (§8 lists them — all are browser logins
for external services), do not stop the whole plan. In order:

1. Put the dependency behind an interface with a working development implementation
   (e.g. an email sender that writes to the log instead of calling Graph).
2. Carry on to the end of the phase and every later phase that doesn't need it.
3. Record the outstanding step in `docs/OUTSTANDING.md` with exactly what's needed.
4. Report it at the end. **Only stop entirely when nothing else can proceed.**

**Every phase ends green and committed:**

```bash
npm run format && npm run check && npm test
```

Never mark a phase done on a green typecheck alone — the tests are the definition of
done. **Do not deploy between phases.** Pushes gate; deploying is manual and on Dan's
say-so.

## 1. What we're building

Dan bartends at friends' house parties. Today the app assumes **one bar, his** —
a single seeded admin, a shared PIN, and orders in one flat queue.

The idea: **hosts become accounts.** A host signs up, lists the spirits, mixers and
garnishes they actually have in, and the app generates the cocktail menu that stock
can support. Dan works their event, sometimes with helpers. Guests at that event
order from that host's generated menu.

That is **multi-tenancy**, and it invalidates several things we chose on purpose
when the app had exactly one user (see §3).

**Scale reality check:** this is a hobby project for friends' parties. A handful of
hosts, a few dozen emails a year. Design for correctness and low maintenance, _not_
for throughput. Where a decision trades scale for simplicity, take simplicity —
and say so in a comment.

## 2. Decisions already made

Researched July 2026. Sources at the bottom.

| Area            | Decision                                       | Why                                                                                                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database        | **SQLite — confirmed, not defaulted into**     | Asked and answered twice; see §2b. The triggers to leave it are writes above ~5k/sec, a second app server, or a dataset past ~10 GB. None will ever apply here.                                                                                                                                                      |
| Query layer     | **Drizzle ORM**                                | Reverses the earlier "no ORM" call — see §2c. `drizzle-kit` _is_ the migration runner phase 0 was going to hand-write, and phase 2's tenancy scope becomes a compile-time guarantee instead of a discipline.                                                                                                         |
| DB driver       | **`better-sqlite3`** (was `node:sqlite`)       | `drizzle-kit` does not support `node:sqlite` (drizzle-orm#5471). We rejected `better-sqlite3` because native modules need build tooling in an Alpine image — running natively on macOS there is no Alpine and no image, so the objection is gone.                                                                    |
| Runtime         | **Native Node under launchd. No Docker.**      | Docker on macOS means a Linux VM under everything. Native is faster, simpler to debug, and makes native modules a non-event. Costs reproducible builds; accepted.                                                                                                                                                    |
| Auth library    | **Better Auth**                                | Lucia was deprecated (Mar 2025) and the Auth.js team joined Better Auth (Sep 2025). SvelteKit-native, keeps every row in our own database, has a first-class Drizzle adapter, and makes Google/Apple sign-in configuration rather than a project.                                                                    |
| Hosting         | **The spare Mac mini M4, macOS (_not_ Asahi)** | Free, and it removes the contention that made a CI gate take 472s at load average 74 on the NAS. §2a covers the platform survey; §8 covers the box.                                                                                                                                                                  |
| Backups         | **Litestream → Cloudflare R2**                 | Streams the WAL continuously, so the recovery point is seconds rather than hours. Separate process, no code changes. R2's free tier covers it and the Cloudflare account already exists.                                                                                                                             |
| Email           | **Microsoft Graph `sendMail`, app-only**       | The M365 tenant is already on `meridew.com` with SPF/DKIM/DMARC configured and warm. Zero new vendors, zero new DNS, **zero new npm packages** (it's a `fetch` POST). At a few dozen emails a year the "don't use Exchange for transactional mail" guidance doesn't apply — that's a volume and reputation argument. |
| Email transport | **Graph, NOT SMTP AUTH**                       | SMTP AUTH basic auth is disabled by default from end of December 2026, unavailable for new tenants after, removal announced H2 2027. Building on it would have a five-month shelf life.                                                                                                                              |
| E2E tests       | **Playwright, after phase 3**                  | Writing them against today's single-tenant flows would mean rewriting them once accounts and events exist. The M4's 10 cores make parallel shards cheap when we get there.                                                                                                                                           |

### 2a. The "one stop shop" question — settled July 2026

Asked whether one platform could cover compute + database + email and stay free at
this scale, rather than hanging off a box at home. **Only Cloudflare comes close, and
it is ~$5/month, not free.** Recorded in full so nobody re-runs this survey.

**Cloudflare** — Workers + D1 (genuine SQLite) + R2 + Email Service (first-party
outbound, public beta April 2026, after MailChannels died in Aug 2024), on the account
that already holds the DNS and the tunnel. Three separate free-tier walls, each of
which this app hits specifically:

- Mail to **arbitrary** recipients needs Workers Paid; the free plan only sends to
  addresses already verified in your own account, so host signup verification is
  impossible by construction.
- Free caps CPU at **10 ms per request**. `auth.ts` runs scrypt at N=65536, which is
  ~100 ms _on purpose_. Password hashing simply cannot run there.
- Time Travel keeps 7 days on free vs 30 on paid.

**Cost in code, if it's ever done:** every synchronous query becomes async, plus every
caller; the in-memory rate limiter in `ratelimit.ts` stops meaning anything across
ephemeral isolates; the `init` boot seed has no equivalent (Workers don't boot); and
`web-push` needs a Web Crypto path. Adopting Drizzle (§2c) shrinks this considerably —
D1 is a Drizzle dialect — but the async conversion remains.

Rejected, with reasons:

| Option                 | Why not                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Supabase**           | Pauses free projects after 7 days idle — monthly parties means paused _every time_ — and free tier retains no backups at all |
| **Render**             | Free Postgres is **deleted** 30 days after creation; services cold-start ~1 min after 15 min idle                            |
| **Fly.io**             | Free tier gone (7-day trial), ~$2/mo — but near-zero code change. The fallback if self-hosting stops being fun               |
| **Oracle Always Free** | Genuinely free, but halved to 2 OCPU/12 GB on 15 June 2026 unannounced, reclaims idle instances, and is still a VM to manage |
| **Azure**              | Container Apps and SQL "free" are 12-month promos that roll silently to pay-as-you-go; the M365 tenant shares only billing   |

**Asahi Linux on the Mac mini M4: no.** Apple's SPTM must be addressed from EL2 with
the MMU already enabled, which breaks both Linux and the hypervisor Asahi uses to
reverse-engineer the hardware. No timetable. M3 only began booting in Jan 2026 and
still runs software rendering. **Run macOS instead** — everything we need ships
first-class arm64 macOS builds.

Email and offsite backup stay separate wherever this runs. Both are free at this
volume, so "one bill" was never worth buying.

### 2b. Why SQLite, having asked twice

The instinct that SQLite is "noddy" is about its _management surface_, not its
capability. It has no server, no port and no SSMS, which after years of SQL Server
reads as "not a real database". It is in fact the most-deployed database engine in
existence and does 10,000–50,000 writes/sec on hardware like this. A party peaks
around **one write per second**.

What Postgres would genuinely add: concurrent writers from multiple processes, richer
types and extensions (JSONB, full-text, `pgvector`), and a network endpoint for
external tools. None of those are needed by a single-process app serving one party at
a time.

What it would cost, concretely:

- A service to install, secure, tune, patch and keep running — one more thing that can
  be down at 9pm on party night.
- **Litestream stops working.** It is SQLite-only. A seconds-level recovery point
  becomes `pg_dump` on a timer or pgBackRest. Phase 4 gets worse.
- **The test suite gets slower and flakier.** 251 tests run in ~6 s because
  `DB_PATH=':memory:'` gives each test file a private database costing nothing to
  create or tear down. Postgres means testcontainers or per-test transaction rollback,
  and Docker has just been dropped from the host.
- The escape hatch in §2a is Cloudflare D1, which _is_ SQLite.

**Drizzle makes this reversible**, which is what settled it. Queries stop being
SQLite-flavoured strings and become dialect-agnostic Drizzle calls, so a later switch
is "change the schema definitions, swap the driver, fix the dialect-specific bits"
rather than a rewrite. Take the simple option now; the expensive option stays cheap.

**If it still feels wrong after living in it:** the answer is probably
`drizzle-kit studio`, a browser GUI over the database, not a different engine.

### 2c. Why an ORM now, having rejected one before

The earlier call — "`db.ts` is 640 lines of tested prepared statements; moving it to
an ORM is a big change with no functional gain" — was right at the time. Two things
changed:

1. **Phase 0 was going to hand-write a migration runner.** `drizzle-kit` is one,
   maintained, with schema diffing.
2. **Phase 2 rewrites every query anyway** to add the tenancy scope. §6 says the
   defence against cross-tenant leaks must be the type system rather than care — an
   ORM is how you actually get that. Doing both rewrites at once is one pass instead
   of two.

Drizzle is deliberately thin — closer to Dapper than to EF Core. No change tracking,
no lazy loading, no identity map. Typed query builder over SQL you can still read.

**It has no equivalent of EF's global query filters**, so the tenancy scope is
enforced by making the event a **required parameter** of every query function.
Forgetting it is a compile error. That is the whole point of the exercise.

## 3. What this overturns

Recorded because these were deliberate, documented choices and reversing them
quietly would be worse than reversing them loudly.

| Was                                                   | Now                                              | Trigger                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| No migrations; the database is disposable             | Migrations exist from phase 0, via `drizzle-kit` | Schema change is about to become constant, and hand-rolling a runner is wasted work       |
| Identity is an anonymous device id + one seeded admin | Real accounts with verified email                | Hosts must be able to sign in from any device and own their data                          |
| One flat `orders` table                               | Everything is scoped to an event                 | Two hosts must never see each other's party                                               |
| No ORM                                                | Drizzle — §2c                                    | Phase 0 and phase 2 were both about to hand-build what it provides                        |
| Docker containers on the NAS                          | Native Node under launchd on the Mac             | Docker on macOS is a Linux VM; the reason for containers (Alpine reproducibility) is gone |

> **The wipe permission, precisely.** The database may be deleted and recreated at
> will **right now** — nothing is live and no account exists. That ends the moment the
> first real account is created in phase 1: from then on the data belongs to someone
> else and migrations are forward-only. Build the migration machinery in phase 0
> regardless; the freedom is about _data_, not about skipping the tooling.

## 4. Target architecture

Where this lands, so the shape is clear before the work starts:

```
guest phone ──https──> Cloudflare edge
                            │  tunnel dials OUT — no inbound ports, no port-forward
                            ▼
                   Mac mini M4  ·  macOS  ·  launchd
                   ├── node            SvelteKit app + /api      (native, no Docker)
                   ├── cloudflared     the public route          (brew)
                   ├── litestream      continuous backup ──> Cloudflare R2
                   └── actions-runner  the CI gate
                            │
                        SQLite on local NVMe

app ──https──> Microsoft Graph sendMail   (M365 tenant, meridew.com)
```

Four small processes, one file, no VM, nothing to orchestrate.

The code keeps its current shape; the platform work adds nouns, not layers:

| Folder                | What lives there                                                    |
| --------------------- | ------------------------------------------------------------------- |
| `src/routes/`         | pages, and `/api` endpoints as `+server.ts`                         |
| `src/lib/components/` | UI pieces                                                           |
| `src/lib/stores/`     | client state (Svelte 5 runes)                                       |
| `src/lib/shared/`     | types, validation and **permissions** — used by _both_ sides        |
| `src/lib/server/`     | db, auth, push, email — the build blocks these reaching the browser |

## 5. Domain model

```
account       id · email · name · verified_at · created_at        (Better Auth owns credentials)
event         id · host_account_id · name · starts_at · status
event_member  event_id · account_id · role      (owner | bartender | helper)
inventory     event_id · ingredient · in_stock
order         event_id · guest_device_id · …    ← every existing column, plus scope
```

Two axes of permission rather than one, which is what makes it robust:

- **Account role** — `operator` (Dan) or `host` (a customer)
- **Event role** — `owner`, `bartender`, `helper`

Capabilities come from the _pair_. A host owns their event but can't touch another's;
an operator can act on any event they're a member of; a helper is scoped to one event
and evaporates afterwards. "Select a host and do the chore for them" falls out of
this: Dan is an operator with membership of their event.

## 6. Permission model

Today there are two roles and two guards (`requireStaff`, `requireAdmin`), and the
rule is encoded **twice** — server-side as `staff.role !== 'admin'`, client-side as
`canApproveStaff()`. They agree now; nothing makes them keep agreeing.

Replace with **capabilities derived from roles, in one shared table**:

```ts
// $lib/shared/permissions.ts
export type Capability =
  | 'orders:read' | 'orders:advance' | 'orders:delete' | 'orders:clear'
  | 'staff:read'  | 'staff:approve'  | 'staff:revoke'  | 'staff:invite'
  | 'inventory:read' | 'inventory:edit'
  | 'event:create' | 'event:edit';

export const can = (member: Membership | null, cap: Capability): boolean => …
```

- Server: `requireCapability(event, 'inventory:edit')` replaces `requireAdmin`
- Client: `can(...)` decides whether the control is rendered at all
- **One table, both sides.** The drift becomes impossible rather than unlikely.

## 7. Phases

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

### Phase 3 — inventory and the generator

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

## 8. Steps that need a human at a browser

Work around these per §0 — interface + dev implementation + a note in
`docs/OUTSTANDING.md` — rather than stopping the plan.

1. **Entra app registration** — new registration, client secret, `Mail.Send`
   _application_ permission with admin consent. _Blocks: real email in phase 1._
2. **Application Access Policy** restricting that app to a single mailbox
   (`bar@meridew.com`). Exchange Online PowerShell, `New-ApplicationAccessPolicy`.
   **Don't skip it** — see §9.
3. **Cloudflare R2 bucket** + an API token for Litestream. _Blocks: phase 4.6._
4. **OAuth client IDs** for Google and Apple, if that sign-in path is wanted.
5. **The tunnel's Public Hostname**, which lives in the Cloudflare dashboard rather
   than in this repo. It must point at the app's new address on the Mac.
6. ~~**Mac mini access**~~ — **done, 30 Jul 2026.** Recorded because it isn't
   discoverable from the repo:
   - `~/.ssh/mac_cocktails` (ed25519, no passphrase) → `dan@mac.home.meridew.com`
     (192.168.1.9), via the `Host mac` entry in `~/.ssh/config`.
   - Passwordless sudo via `/etc/sudoers.d/dan-claude`, so non-interactive sessions —
     which have no stdin and can never answer a prompt — can administer it.
   - Run scripts there with **`scripts/mac.ps1`**; read its header first.
   - Already server-ready: FileVault off, auto-login as `dan`, `autorestart 1`, sleep
     disabled, and sshd holds **Full Disk Access** — without which even root hits
     "Operation not permitted" on protected paths over SSH.
   - **Spec:** Apple M4, 10 cores, 16 GB, macOS 26.1, 55 GB free. Nothing installed
     but Apple's git.

Secrets go to `gh secret set` piped, **never echoed**, and reach the app through the
launchd job's environment.

## 9. Accepted risks

- **Availability.** Once a host has signed up and their event is tonight, Dan's home
  internet is in someone else's critical path. The dedicated Mac removes the
  _contention_ half of this — no more sharing four cores with two VMs, SQL Server and
  Plex — but not the connectivity half. Litestream protects the _data_, not the
  _uptime_. Dan chose this knowingly, and moving to Fly or Cloudflare later is a
  deploy-target change rather than a rewrite (§2a).
- **`Mail.Send` is tenant-wide by default.** A leaked client secret could send as any
  mailbox in the tenant. Mitigated by the Application Access Policy in §8.2.
- **Client secrets expire** (24 months maximum). It will need renewing, and nothing
  will remind us.
- **No reproducible builds** once Docker is gone. The Mac's toolchain versions become
  part of the deployment. Accepted for a single-host hobby project.

## 10. Guardrails

- `src/lib/neo.css` is a **verbatim** copy of the original design. It's in
  `.prettierignore`; keep it byte-identical. Additions go in `app.css`.
- `$lib/server/*` must never be imported from client code — the build enforces it.
- Tests own the definition of done. Don't call a phase complete on a green typecheck.
- Never echo a secret into the transcript.
- Deploy only when asked.
- Read `CLAUDE.md` before running shell commands. The Windows shell rules there exist
  because ignoring them cost three failed commands in one session.

## 11. Out of scope

| Not doing                 | Why                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| Payments / billing        | It's a hobby project for friends                                                                |
| Postgres or any server DB | Asked and answered twice — §2b                                                                  |
| A separate API service    | SvelteKit's server routes _are_ the backend; splitting them would undo the collapse we just did |
| Native app                | Capacitor was removed; see `HANDOFF.md`                                                         |
| Moving off self-hosting   | §2a. Fly is the documented fallback if it stops being fun                                       |

---

**Sources:** [SvelteKit issue: remove deprecated Lucia](https://github.com/sveltejs/kit/issues/12990) ·
[Better Auth](https://better-auth.com/docs/adapters/sqlite) ·
[drizzle-kit lacks node:sqlite support](https://github.com/drizzle-team/drizzle-orm/issues/5471) ·
[Drizzle SQLite drivers](https://orm.drizzle.team/docs/sqlite/get-started-sqlite) ·
[Litestream](https://litestream.io/) ·
[Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) ·
[Cloudflare Email Service](https://developers.cloudflare.com/email-service/) ·
[Asahi M4 support](https://asahilinux.org/docs/platform/feature-support/m4/) ·
[SMTP AUTH deprecation timeline](https://techcommunity.microsoft.com/blog/exchange/updated-exchange-online-smtp-auth-basic-authentication-deprecation-timeline/4489835)
