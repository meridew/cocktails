# Platform plan — hosts, accounts and the cocktail generator

**Status:** approved, not started. Point a goal at this and work top-to-bottom.
**Prerequisite:** none — phase 0 is self-contained.

> **Read this first if you're a fresh session.** `handoff.md` describes the stack as
> it is. This describes where it's going and why. The decisions in §2 were made
> deliberately after research; don't relitigate them without a reason, and if you
> do, record the reason here.

---

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

| Area            | Decision                                                                        | Why                                                                                                                                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth library    | **Better Auth**                                                                 | Lucia was deprecated (Mar 2025, now a learning resource) and the Auth.js team joined Better Auth (Sep 2025). It's the SvelteKit-native choice, keeps every row in our own database, and makes Google/Apple sign-in configuration rather than a project.                                                               |
| DB driver       | **stay on `node:sqlite`**                                                       | Better Auth supports it (RC status; needs Node ≥22.5, we run 24). Their default `better-sqlite3` is a native module needing build tooling in an Alpine image, for no gain.                                                                                                                                            |
| Auth schema     | **Better Auth CLI**                                                             | `generate` emits SQL; `migrate` applies it and works specifically with the built-in Kysely adapter that SQLite uses.                                                                                                                                                                                                  |
| Our schema      | **hand-rolled forward-only runner**                                             | ~50 lines. `db.ts` is 640 lines of tested prepared statements; moving it to an ORM is a big change with no functional gain. Drizzle stays an option if the SQL gets painful — revisit, don't assume.                                                                                                                  |
| Hosting         | **self-hosted SQLite, moving NAS → the spare Mac mini M4 (macOS, _not_ Asahi)** | Free, zero code change, and it removes the contention that made a CI gate take 472s at load average 74. See §2a for the platform survey and why Asahi is not an option.                                                                                                                                               |
| Backups         | **Litestream → Cloudflare R2**                                                  | Streams the WAL continuously, so the recovery point is seconds. Separate process, no code changes. R2's free tier covers this and the Cloudflare account already exists.                                                                                                                                              |
| Email           | **Microsoft Graph `sendMail`, app-only**                                        | The M365 tenant is already on `meridew.com` with SPF/DKIM/DMARC configured and warm. Zero new vendors, zero new DNS, **zero new npm packages** (it's a `fetch` POST). At a few dozen emails a year, the "don't use Exchange for transactional mail" guidance doesn't apply — that's a volume and reputation argument. |
| Email transport | **Graph, NOT SMTP AUTH**                                                        | SMTP AUTH basic auth is disabled by default from end of December 2026, unavailable for new tenants after, removal announced H2 2027. Building on it would have a five-month shelf life.                                                                                                                               |

## 2a. The "one stop shop" question — settled July 2026

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

**Cost in code, if it's ever done:** all **96 synchronous prepared-statement call
sites** in `db.ts` become async, plus every caller; the in-memory rate limiter in
`ratelimit.ts` stops meaning anything across ephemeral isolates; the `init` boot seed
has no equivalent (Workers don't boot); and `web-push` needs a Web Crypto path.
**If it happens, it must happen _before_ phase 2** — that phase already rewrites every
query to add the tenancy scope, so the sync→async conversion rides along for almost
nothing. Afterwards means touching all 96 sites twice.

Rejected, with reasons:

| Option                 | Why not                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Supabase**           | Pauses free projects after 7 days idle — monthly parties means paused _every time_ — and free tier retains no backups at all |
| **Render**             | Free Postgres is **deleted** 30 days after creation; services cold-start ~1 min after 15 min idle                            |
| **Fly.io**             | Free tier gone (7-day trial), ~$2/mo — but **zero code change**. The fallback if self-hosting stops being fun                |
| **Oracle Always Free** | Genuinely free, but halved to 2 OCPU/12 GB on 15 June 2026 unannounced, reclaims idle instances, and is still a VM to manage |
| **Azure**              | Container Apps and SQL "free" are 12-month promos that roll silently to pay-as-you-go; the M365 tenant shares only billing   |

**Asahi Linux on the Mac mini M4: no.** Apple's SPTM must be addressed from EL2 with
the MMU already enabled, which breaks both Linux and the hypervisor Asahi uses to
reverse-engineer the hardware. No timetable. M3 only began booting in Jan 2026 and
still runs software rendering. **Run macOS instead** — Node 24 runs `node:sqlite`
natively on arm64, and `cloudflared`, Litestream and the GitHub Actions runner all
ship first-class macOS arm64 builds. Docker becomes optional rather than required.

Email and offsite backup stay separate wherever this runs (Graph `sendMail`,
Litestream → R2). Both are free at this volume, so "one bill" was never worth buying.

## 3. What this overturns

Recorded because these were deliberate, documented choices and reversing them
quietly would be worse than reversing them loudly.

| Was                                                                        | Now                                                                             | Trigger                                                                                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No migrations; the database is disposable and may be wiped at any time** | Migrations are mandatory from phase 0. **Do not wipe the production database.** | The old doc said "revisit before the first party with real orders in it". A host signing up _is_ that moment — the data stops being Dan's to destroy. |
| Identity is an anonymous device id + one seeded admin                      | Real accounts with verified email                                               | Hosts must be able to sign in from any device and own their data                                                                                      |
| One flat `orders` table                                                    | Everything is scoped to an event                                                | Two hosts must never see each other's party                                                                                                           |

## 4. Domain model

```
account       id · email · password_hash · name · verified_at · created_at
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

## 5. Permission model

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

## 6. Phases

Each ends green (`npm run check` + `npm test`) and committed. **Do not deploy
between phases** — pushes gate only; deploy is manual and on Dan's say-so.

### Phase 0 — foundations _(no user-visible change)_

1. **Forward-only migration runner.** Numbered SQL files, a `schema_migrations`
   table, applied in order at boot, each in a transaction. Baseline migration =
   today's schema exactly as `db.ts` declares it, so an existing database adopts
   cleanly rather than being recreated.
2. **Capability model** per §5, replacing `requireAdmin`/`canApproveStaff`.
3. **An enumeration test** that walks every `+server.ts` and fails if it declares no
   capability — the same trick that already guards the test dispatcher, so a new
   endpoint can't ship ungoverned.

_Gate: 251 tests still green, plus new tests for the runner and the capability table.
Prove the baseline migration is a no-op against a database created by the current
`db.ts`._

### Phase 1 — accounts

Better Auth on the existing SQLite handle; email + password with verification;
Graph `sendMail` for the emails; Google/Apple OAuth as configuration.

**The PIN survives.** Typing an email and password behind a bar mid-party is exactly
the misery the keypad removed. Accounts are for hosts and for signing in from a new
device; the PIN and join codes stay as the fast door into an event.

_Needs a human at a browser (§8). Gate: sign up → verify → sign in → reset, all
end-to-end against a real inbox._

### Phase 2 — tenancy

`account`, `event`, `event_member`, `inventory`. Every existing query gains a scope.

**The scope must be a required parameter of every query function**, so omitting it is
a _type error_ rather than a silent cross-tenant leak. Add a test asserting no
order/inventory query is callable without one. This is the phase where a mistake is
invisible and expensive; the type system is the defence, not care.

_Gate: a test proving host A cannot read, mutate or even count host B's orders,
through every endpoint that touches them._

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

### Phase 4 — ops

Litestream sidecar streaming to R2, **and a restore drill**. An untested backup is
not a backup: restore into a scratch container and diff it against the live database
before calling this done.

_Needs a human for the R2 bucket and credentials (§8)._

## 7. Accepted risks

- **Availability.** Once a host has signed up and their event is tonight, Dan's home
  internet is in someone else's critical path. Moving to a dedicated Mac mini removes
  the _contention_ half of this risk — no more sharing four cores with two VMs, SQL
  Server and Plex — but not the connectivity half. Litestream protects the _data_, not
  the _uptime_. Dan chose this knowingly. The app is a standard Node server, so moving
  to Fly or Cloudflare later is a deploy-target change, not a rewrite (§2a).
- **`Mail.Send` is tenant-wide by default.** A leaked client secret could send as any
  mailbox. Mitigated with an Application Access Policy scoping it to one mailbox —
  see §8, and don't skip it.
- **Client secrets expire** (24 months maximum). It will need renewing, and nothing
  will remind us.

## 8. Steps that need a human at a browser

Flag these and stop; don't guess around them.

1. **Entra app registration** — new registration, client secret, `Mail.Send`
   _application_ permission with admin consent.
2. **Application Access Policy** restricting that app to a single mailbox
   (`bar@meridew.com`). Exchange Online PowerShell, `New-ApplicationAccessPolicy`.
3. **Cloudflare R2 bucket** + an API token for Litestream.
4. **OAuth client IDs** for Google and Apple, if that sign-in path is wanted.
5. **Mac mini as the host** — physical setup, and three settings that are easy to miss
   and each silently break unattended operation:
   - **FileVault off.** With it on, the disk stays locked after a reboot until someone
     logs in physically, so the app never comes back on its own.
   - **Never sleep** — `sudo pmset -a sleep 0 disablesleep 1`.
   - **Start up automatically after a power failure**, in Energy Saver.

   Then: Node 24, `cloudflared`, and the GitHub Actions runner, each as a launchd
   service with `RunAtLoad` + `KeepAlive`. The runner belongs here rather than on the
   NAS — that is the whole point of the move.

Secrets go to `gh secret set` piped, never echoed, and reach the container through
`infra/.env` like `STAFF_PIN` and the VAPID keys.

## 9. Guardrails

- `src/lib/neo.css` is a **verbatim** copy of the original design. It's in
  `.prettierignore`; keep it byte-identical. Additions go in `app.css`.
- `$lib/server/*` must never be imported from client code — the build enforces it.
- Tests own the definition of done. Don't mark a phase complete on a green typecheck.
- Never echo a secret into the transcript.
- Deploy only when asked.

## 10. Out of scope

| Not doing              | Why                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| Payments / billing     | It's a hobby project for friends                                                                |
| Moving off the NAS     | Decided in §2; revisit only if it becomes real                                                  |
| An ORM                 | `db.ts` works and is tested; §2                                                                 |
| A separate API service | SvelteKit's server routes _are_ the backend; splitting them would undo the collapse we just did |
| Native app             | Capacitor was removed; see `handoff.md` §7                                                      |

---

**Sources:** [SvelteKit issue: remove deprecated Lucia](https://github.com/sveltejs/kit/issues/12990) ·
[Better Auth SQLite adapter](https://better-auth.com/docs/adapters/sqlite) ·
[Better Auth CLI](https://better-auth.com/docs/concepts/cli) ·
[Litestream](https://litestream.io/) ·
[Exchange Online to retire Basic auth for SMTP AUTH](https://techcommunity.microsoft.com/blog/exchange/exchange-online-to-retire-basic-auth-for-client-submission-smtp-auth/4114750) ·
[Updated SMTP AUTH deprecation timeline](https://techcommunity.microsoft.com/blog/exchange/updated-exchange-online-smtp-auth-basic-authentication-deprecation-timeline/4489835)
