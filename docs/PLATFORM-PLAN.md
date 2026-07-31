# Platform plan — Dan's bar, as a service for hosts

> **Read this first if you're a fresh session.** `HANDOFF.md` describes the stack as
> it is. `HISTORY.md` records how it got here and why things are shaped the way they
> are. `CLAUDE.md` has the shell rules — read those before running anything, they are
> not optional on Windows. The decisions in §2 were made deliberately after research;
> don't relitigate them without a reason, and if you do, record the reason here.

## Where this actually stands — 31 Jul 2026

**This plan was rewritten on 31 Jul 2026 after Dan reviewed what had been built and
found it wasn't what he'd asked for.** The phases below supersede the old ones; the
completed work is recorded in `HISTORY.md`.

The short version of what went wrong: the plan described a permission model with two
axes — account role × event role — and it was never built. Everything therefore hung
off a **staff session scoped to one party**, obtained by "opening the bar". So each
new feature got built wherever that credential already worked, rather than where it
belonged. The host's stock screen ended up inside the bartender's screen. That is a
symptom; the missing axis is the cause, and §8 phase 0 fixes the cause first.

**Phases 0, 2, 3, 4, 5 and 6 are done.** The app now does what §1 has always said it
does: a host records what they have in, and their guests get a menu generated from
it — 60 drinks from 30 bottles rather than six curated ones filtered down. A
Playwright suite walks the whole party in a real browser and gates on the Mac. **Every
scheduled phase is done**; what remains is 7 and 8, both deferred by Dan.

**Phase 1 was withdrawn, not skipped.** Its premise — that the look was broken — was
a claim in a document rather than an observed fact, and it was false.

**The wipe happened — 31 Jul 2026.** The old database held one unverified test
account and nothing else, and the phase-0 restructure changed the schema beyond
migrating, so it was deleted rather than migrated. The live database is now empty and
on the new schema:

```
users 0 · events 0 · orders 0 · stock 0 · event_menu 0
```

`ADMIN_EMAILS` is set on the Mac, and `STAFF_EMAIL` / `STAFF_PASSWORD` / `STAFF_PIN`
were removed from its environment in the same pass — the actor model replaced all
three, nothing had read them since phase 0, and one of them had been echoed into a
transcript.

**The wipe permission narrows from here.** Wiping now costs Dan a re-registration.
Once a host who is _not_ Dan signs up it costs somebody else their data, and that is
the same moment Litestream stops being optional (§10).

**`f33c7c0` is deployed** — the Mac serves it, verified over the tunnel. Deploying
stays manual and on Dan's say-so:

```bash
gh workflow run "gate + deploy (Mac)" --ref main -f deploy=true
```

**Dan is registered and is admin**, through the real front door with a real
verification email from Graph. `users 1 · events 0`: the next thing that has never
been done on the live service is creating a party.

---

## 0. How to work this plan

Written to be executed by an agent working alone, iterating until genuinely blocked.

**This is still a green field**, per the counts above. So:

- **Make large changes in one go.** Don't stage a refactor across three commits to
  "keep things working" between them — nothing depends on the intermediate states.
- **No backwards compatibility. No deprecation cycles. No compatibility shims.**
- **Delete freely.** If code is replaced, remove it. §3 lists what dies; if something
  there is still present at the end of its phase, the phase isn't done.
- **The database may be dropped and recreated at will**, until the first real host.

**Decide, don't ask,** about: naming, file layout, test structure, minor library
choices, error copy, and anything where two reasonable answers produce the same
product. Ambiguity is only worth a question when different readings produce a
_materially different app_.

**Do not build where the plumbing happens to work.** Build where the thing belongs,
and if the plumbing isn't there yet, that is the work. This sentence exists because
ignoring it is what caused this rewrite.

**When you hit something that needs a human** (§9 lists them — all are browser logins
for external services), do not stop the whole plan. In order:

1. Put the dependency behind an interface with a working development implementation.
2. Carry on to the end of the phase and every later phase that doesn't need it.
3. Record the outstanding step in `docs/OUTSTANDING.md` with exactly what's needed.
4. Report it at the end. **Only stop entirely when nothing else can proceed.**

**Every phase ends green and committed:**

```bash
npm run format && npm run check && npm test
```

Never mark a phase done on a green typecheck alone — the tests are the definition of
done, and **a phase that ships a screen is not done until it has been walked in a
browser.** Two of the three worst mistakes in `HISTORY.md` were caught by opening the
app, and neither would have been caught by a test. **Do not deploy between phases.**

## 1. What we're building

**Dan bartends at friends' house parties. This is the app he runs it on, and the
thing his hosts use to prepare for it.**

That sentence is the whole product, and it settles most arguments. It is _Dan's
service_, not a party-planning tool that Dan happens to use. Three kinds of person
touch it, plus the guests:

| Who       | Is                    | Does                                                                             |
| --------- | --------------------- | -------------------------------------------------------------------------------- |
| **Admin** | Dan                   | Everything. Sees every host and every party, creates parties, works the bar      |
| **Host**  | a friend, a customer  | Registers, optionally says what they've got in, watches their queue on the night |
| **Staff** | a helper on the night | Takes orders. Joins with a code, has no account, evaporates afterwards           |
| _Guest_   | anyone at the party   | Anonymous. Scans a QR code, orders a drink                                       |

**A host is a customer, not an operator.** They do not take orders — Dan does, with
helpers. Their whole job is: register, tick their cupboard, and watch.

**Dan creates the parties.** A booking is a conversation, so the event is made by Dan
against a host's account. A host who has registered but has no party yet is a
perfectly normal state.

**The cupboard belongs to the host, not the party.** A home bar is fairly stable, and
re-ticking 173 bottles for every party would be a chore nobody does twice. Every party
a host has reads their one cupboard.

**The menu is generated from that cupboard.** Not a fixed list filtered by it — a
menu the 270-recipe engine produces from what they actually have. Guests land on a
**short list** somebody curated, and can also browse everything or be walked through
a choice. This is the promise the old plan made in its first paragraph and never kept.

**Scale reality check:** a handful of hosts, a few parties a year. Design for
correctness and low maintenance, _not_ throughput. But sign-up is open on a machine
in Dan's house, so build the parts a stranger can reach as though a stranger will
reach them (§10).

## 2. Decisions already made

Researched July 2026. Sources at the bottom.

| Area            | Decision                                       | Why                                                                                                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database        | **SQLite — confirmed, not defaulted into**     | Asked and answered twice; see §2b. The triggers to leave it are writes above ~5k/sec, a second app server, or a dataset past ~10 GB. None will ever apply here.                                                                                                                                                      |
| Query layer     | **Drizzle ORM**                                | Reverses the earlier "no ORM" call — see §2c. `drizzle-kit` _is_ the migration runner phase 0 was going to hand-write, and phase 2's tenancy scope becomes a compile-time guarantee instead of a discipline.                                                                                                         |
| DB driver       | **`better-sqlite3`** (was `node:sqlite`)       | `drizzle-kit` does not support `node:sqlite` (drizzle-orm#5471). We rejected `better-sqlite3` because native modules need build tooling in an Alpine image — running natively on macOS there is no Alpine and no image, so the objection is gone.                                                                    |
| Runtime         | **Native Node under launchd. No Docker.**      | Docker on macOS means a Linux VM under everything. Native is faster, simpler to debug, and makes native modules a non-event. Costs reproducible builds; accepted.                                                                                                                                                    |
| Auth library    | **Better Auth**                                | Lucia was deprecated (Mar 2025) and the Auth.js team joined Better Auth (Sep 2025). SvelteKit-native, keeps every row in our own database, has a first-class Drizzle adapter, and makes Google/Apple sign-in configuration rather than a project.                                                                    |
| Hosting         | **The spare Mac mini M4, macOS (_not_ Asahi)** | Free, and it removes the contention that made a CI gate take 472s at load average 74 on the NAS. §2a covers the platform survey; §9 covers the box.                                                                                                                                                                  |
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

### 2d. Decisions added by the 31 Jul rewrite

Each was asked and answered explicitly. Don't reopen without a reason.

| Area              | Decision                                               | Why                                                                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles             | **Admin · Host · Staff**, from two axes underneath     | Three words to the user. Underneath it stays account-role × event-role, because a host _is_ staff at their own party and Dan is Admin globally _and_ behind the bar locally — §6                                                                                                                           |
| Admin identity    | **`ADMIN_EMAILS` env lists admin accounts**            | Config is the source of truth, so it survives a database wipe and a bad edit in the app can't lock Dan out of his own service. Same pattern the old `STAFF_EMAIL` used                                                                                                                                     |
| Admin plumbing    | ~~Better Auth's `admin` plugin~~ **our own endpoints** | **Reversed 31 Jul before writing any code — see §2e.** The plugin's endpoints land behind Better Auth's catch-all, which `capabilities.test.ts` declares `public` because its guards are inside the library. Every admin power would ship ungoverned by the one test whose entire job is that nothing does |
| Role storage      | **Columns on `user` that Better Auth never sees**      | Declared in our Drizzle schema only — **not** in `user.additionalFields`. The plan first said `input: false`; not declaring them at all is stricter, because there is then no input path to exclude. Better Auth reads and writes neither. `accounts.test.ts` proves a sign-up cannot name its own role    |
| Permission source | **`$lib/shared/permissions.ts` is the only authority** | One table, both sides, and now genuinely only one — there is no second access-control system in the build at all                                                                                                                                                                                           |
| Cupboard          | **On the host account, not the event**                 | A home bar is stable; per-party re-ticking is a chore nobody repeats. One cupboard per host, read by every party they have                                                                                                                                                                                 |
| Party creation    | **Admin only, and the host must already exist**        | A booking is a conversation. `event.hostUserId` becomes NOT NULL, which kills the seeded ownerless event and every "which party is live?" guess with it                                                                                                                                                    |
| Registration      | **Open sign-up**                                       | A friend can join without Dan doing admin. Costs the hardening in §10 — the door faces the internet                                                                                                                                                                                                        |
| The menu          | **Generated from the cupboard**                        | What §1 always promised. The curated six become the first entries of a short list rather than the whole menu                                                                                                                                                                                               |
| Menu curation     | **Short list, curated by Admin or Host; empty = all**  | A well-stocked bar yields 40+ drinks including six margaritas. Nobody is forced to curate: with no short list the guest simply sees everything                                                                                                                                                             |
| Recipe model      | **Base drink + stackable variants**                    | "Chili unlocks a Spicy Margarita; Tajín as well unlocks the spicy rim." The six margaritas become one drink with upgrades. Deferred to phase 7 — it needs research, and it needs the data redesigned                                                                                                       |
| The keypad        | **A PIN on your own account**                          | Set in the app, stored hashed against the user. Sign in properly once per device, keypad thereafter. Replaces the shared `STAFF_PIN` secret, which had no owner and could not be rotated                                                                                                                   |
| Party lifecycle   | **Dan opens and closes by hand**                       | A date that opens a party on its own means a mistyped date locks guests out on the night                                                                                                                                                                                                                   |
| The look          | **Restore the original, don't redesign it**            | `neo.css` is the verbatim original and has _never actually rendered as designed_ — the display fonts are referenced in CSS variables and never loaded. It stays byte-identical                                                                                                                             |
| Front end         | **Structure rebuilt, styling restored**                | The current component tree was built for one bar and one screen of admin. Four audiences need four shapes                                                                                                                                                                                                  |

### 2e. The admin plugin, reversed before a line was written

This plan named Better Auth's `admin` plugin, and the first act of executing it was to
check the claim rather than install it. The claim doesn't hold.

The plugin's endpoints — `listUsers`, `setRole`, `banUser`, `removeUser`,
`impersonateUser` — mount under Better Auth's catch-all route, and
`tests/capabilities.test.ts` declares that route:

```ts
// Better Auth's catch-all: these are how someone *becomes* authenticated, so a
// capability gate would be circular. Its own guards are inside the library.
'GET /api/account/[...all]': 'public',
```

That reasoning is right for sign-in and wrong for user administration. Adopting the
plugin would put **every** admin power behind a route the enumeration test calls
public — so the one test whose whole job is "nothing ships ungoverned" would be
blind to the most dangerous endpoints in the app. It would also add impersonation,
which nobody asked for and which is a session-as-another-person on a box facing the
internet.

What the plugin actually saves is four endpoints of about a hundred lines. What it
costs is the safety property the plan is built on. So: **our own endpoints, under our
own guard, enumerated by the same test as everything else.** The `role` and ban
columns still live on `user` — `additionalFields` extends Better Auth's model without
adopting its endpoints.

Recorded here rather than quietly done because §0 says a reversed decision gets its
reason written down, and because "use the thing that already exists" is exactly the
instinct that put the stock screen inside the bar.

## 3. What this rewrite overturns

Recorded because these were deliberate, documented choices, and reversing them
quietly would be worse than reversing them loudly. **Several are my own work from
30–31 July.** They were built correctly against a plan that was wrong.

| Was                                                  | Now                                                         | Why                                                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `can()` keys off `staff.role` alone                  | Keys off the account-role × event-role pair                 | The promise §6 made and never kept. Everything else here follows from it                                                           |
| A capability check needs a bar session               | One actor resolution accepting either credential            | This is what forced the stock screen into the bar                                                                                  |
| Stock screen lives inside the bartender's screen     | Lives in the host's own area, on their account              | A cupboard is filled in on Tuesday for a party on Saturday                                                                         |
| `inventory` is scoped to an event                    | `stock` is scoped to a host                                 | §2d                                                                                                                                |
| Hosts create their own parties                       | Dan creates parties for them                                | §2d                                                                                                                                |
| Hosts get a `staff` row with `role: 'admin'`         | Hosts are not staff at all; they get read-only order access | A host is a customer                                                                                                               |
| `event.hostUserId` is nullable for the boot seed     | NOT NULL; the boot seed is deleted                          | The seed only existed so the app worked before anyone signed up. With a real front door and Dan creating parties, nothing needs it |
| `liveEvent()` picks the newest live party            | Deleted. A guest always arrives via `/e/<id>`               | It was a guess that is wrong the moment two parties run, which is now the normal case                                              |
| `STAFF_PIN` — one shared secret in the Mac's env     | A PIN each account sets on itself                           | A shared secret with no owner that can't be rotated without editing a file and restarting                                          |
| `POST /api/auth/login` — email+password for staff    | Deleted. Dan signs in with his account                      | It existed as break-glass for a PIN throttle that no longer guards a shared PIN                                                    |
| `staff.role` (`admin \| bartender`)                  | Deleted. Everyone in the `staff` table is staff             | The distinction moved up to the account role where it belonged                                                                     |
| The guest menu is six curated drinks, gated by stock | Generated from the cupboard, with a curated short list      | §1                                                                                                                                 |
| `src/lib/data.ts` — six drinks with option axes      | Folded into the recipe data as variants (phase 7)           | The axes _are_ a modifier system, hand-built for six drinks. Generalising them is phase 7                                          |

> **The wipe permission, precisely.** The database may be deleted and recreated at
> will **right now** — see the counts at the top. That ends the moment the first real
> host account is created: from then the data belongs to someone else, migrations are
> forward-only, and Litestream comes off the back burner the same day.

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
user            id · email · name · emailVerified                 ← Better Auth
                role          'admin' | 'host'                    ← admin plugin
                banned · banReason · banExpires                   ← admin plugin
session · account · verification                                  ← Better Auth, untouched

user_pin        user_id (PK) · pin_hash · created_at              the keypad, owned by one person
stock           user_id · ingredient · in_stock                   PK (user_id, ingredient)
event           id · host_user_id NOT NULL · name · starts_at
                status  'draft' | 'live' | 'done' · created_at
                        **only `live` takes orders** — see §5a
event_menu      event_id · recipe_id                              the short list. No rows = show everything
staff           id · event_id · user_id? · display_name
                device_id? · status · joined_via · approved_by    no role column: staff are staff
staff_sessions  token_hash (PK) · staff_id · expires_at
join_codes      code_hash (PK) · expires_at · created_by
orders          id · event_id · … unchanged
subscriptions   … unchanged
```

Three things worth stating because they are easy to get wrong:

**`stock` hangs off the user, `event_menu` off the event.** What a host _owns_ is
stable and personal; what a party _offers_ is a decision made per night. A host who
buys mezcal changes their cupboard once and every future party benefits; a short list
curated for a birthday doesn't leak into their Christmas do.

**`staff` has no role column.** It is a membership list for one party, and everyone on
it does the same job. The distinction that used to live there — admin vs bartender —
is an _account_ fact now, and Dan is the only admin.

**`event_menu` being empty is meaningful.** No rows means "nobody has curated this",
which shows the full generated list. That is the same "never asked ≠ answered no"
rule as the cupboard (§13), and it is the reason curation can be optional without
every uncurated party looking broken.

### 5a. Party status — decided 31 Jul 2026

**Only a `live` party takes orders.** `draft` answers "this party isn't open yet",
`done` answers "the bar has closed", both **409** — the caller and their request are
fine; the party is in a state that doesn't accept one. A 403 would say "you may not",
which sends a guest looking for permission they don't need.

This was decided because it wasn't true. `POST /api/orders` resolved which party was
meant and never looked at `status`, so `Open` and `Close` on the admin screen changed
a label and nothing else — a party still in draft accepted drinks, and so did one
closed hours ago. **Found the first time a real party existed:** Dan created one on
the live service, it sat in `draft`, and its link worked.

Two consequences worth stating:

- **The guest is told at the top of the menu, not at send time.** `GET
/api/events/[id]/menu` returns `event.status` for exactly this. Refusing only on
  send would mean choosing drinks, typing a name, and then learning none of it
  counted. The menu itself stays readable — knowing what you would have had is the
  friendly half of being told you can't.
- **Closing does not touch the queue.** The bar has to finish what it started, so
  `Close` stops new orders and nothing else. It is not a way to clear the night.

It also exposed a gap in `host-loop.test.ts`, which created parties through the real
API — born `draft` — and had guests order at them without ever opening one. Nothing
noticed, because nothing checked.

## 6. Permission model

**One table, both sides**, as before — but the actor is finally the pair.

```ts
// $lib/shared/permissions.ts
export interface Actor {
  /** Who they are, globally. Null for a device-only helper with no account. */
  account: { id: string; role: 'admin' | 'host' } | null;
  /** What they are at the party in scope. Null when no party is in scope. */
  party: { id: string; role: 'owner' | 'staff' } | null;
}

/** What the capability is being asked *about*. A capability without a subject is a bug. */
export type Scope =
  | { kind: 'platform' }
  | { kind: 'party'; eventId: string }
  | { kind: 'host'; userId: string };

export const can = (actor: Actor, cap: Capability, scope: Scope): boolean => …
```

The `Scope` is the part the old model lacked, and its absence is exactly why stock
editing could only be expressed as "holds a bar session". `stock:edit` is a question
about a **host**; `orders:advance` is a question about a **party**; `host:suspend` is
a question about the **platform**. Three different subjects, one predicate.

| Capability                                                | Admin | Host            | Staff           |
| --------------------------------------------------------- | ----- | --------------- | --------------- |
| `orders:read`                                             | any   | **own party**   | **their party** |
| `orders:advance` · `orders:delete` · `orders:clear`       | any   | —               | **their party** |
| `staff:read` · `:approve` · `:revoke` · `:invite`         | any   | —               | —               |
| `stock:read` · `stock:edit`                               | any   | **own account** | —               |
| `party:create` · `:edit` · `:open` · `:close` · `:delete` | any   | —               | —               |
| `menu:curate`                                             | any   | **own party**   | —               |
| `host:list` · `host:suspend` · `host:delete`              | ✓     | —               | —               |
| `admin:grant`                                             | ✓     | —               | —               |

A host reading their own queue is the whole of "watch the queue, nothing more". They
cannot advance a drink, approve a helper, or end their own party — Dan does all three.

**Guests hold nothing.** They are anonymous by design: a device id, no account, no
capability. The endpoints they use — the menu and placing an order — are public, and
`tests/capabilities.test.ts` records that as a deliberate declaration rather than an
omission.

### The guard

One entry point, and endpoints call nothing else:

```ts
requireCapability(event, 'stock:edit', { kind: 'host', userId });
```

It resolves the caller from **either** credential — a Better Auth cookie or a bearer
staff token — into an `Actor`, then asks `can()`. Endpoints stop knowing which kind
of caller they have, which is the property that was missing: today an endpoint is
account-authenticated or staff-authenticated and its location in the app follows from
that accident.

Refusals stay **404 rather than 403 when the id is the secret** — another host's party
must not be confirmed to exist — and 403 when the caller is legitimately in scope but
under-powered, so a host learns they are signed in and not permitted rather than
mistaking it for an expired session.

## 7. The four audiences, and the screens they get

The old plan described endpoints and scheduled no screens, and both times that
produced a working API nobody could reach. So the screens are named here.

**Guest** — anonymous, arrives at `/e/<id>` from a QR code.

- The party's menu: a **short list** by default, `Show everything` to browse the full
  generated list, `Help me choose` for the Make-a-Drink walk
- Their basket, their order, and notification of it being poured

**Staff** — a helper on the night, joins with a code, no account.

- `/bar` — the queue, unchanged in spirit: tabs, cards, progress, handoff
- Nothing else. No stock, no settings, no party management

**Host** — a customer.

- `/` when signed in — their parties, and their cupboard
- **My cupboard**: the full 173 ingredients across ten shelves, ticked or not, with
  what it can pour and what one more bottle would unlock
- **A party**: its date, its guest link and QR code, its short list to curate, and a
  read-only view of the queue on the night

**Admin** — Dan.

- `/admin` — every host, every party
- **A host**: their cupboard (editable), their parties, suspend or delete, promote
- **A party**: create against a host, name and date, open and close, curate the short
  list, and `Open the bar` — which is a staff session at any party, no invitation

## 8. Phases

Sequenced deliberately: **identity first, because it is the blocker for everything
else, and the menu last, because it is the part that can be got wrong cheaply.** The
guest menu keeps working exactly as it does today until phase 5 replaces it.

### Phase 0 — the actor model

Server only. No new screens. This is the phase the last three were quietly blocked on.

1. **`role` and ban columns on `user`** — declared in `schema.auth.ts` **and nowhere
   else**. **No admin plugin** (§2e), and no `additionalFields` either.

   > **Amended while building it.** This said to declare them to Better Auth with
   > `input: false`. Not declaring them at all turned out to be both simpler and
   > stricter: Better Auth neither reads nor writes columns it doesn't know about, so
   > there is no input path to exclude and nothing to get wrong in a later version.
   > They are ours; only our code touches them. `accounts.test.ts` proves a sign-up
   > body containing `role: 'admin'` is ignored — with open registration that is the
   > difference between a hobby project and handing the platform to a stranger.

2. **`ADMIN_EMAILS`.** A comma-separated list in config. Any account whose verified
   email is on it resolves as `role: 'admin'`, re-asserted every time a session is
   resolved rather than written once, so the file is the truth and nothing can lock
   Dan out. `daniel.meridew@gmail.com` is the first entry.
3. **`Actor`, `Scope`, `can()`** per §6, in `$lib/shared/permissions.ts`.
4. **One guard.** `requireCapability(event, cap, scope)` resolving either credential.
   Every endpoint moves onto it. `requireStaff` and `requireAccount` go.

   > **Route paths stay where they are until phase 4.** The tidy end state is
   > `/api/events/[id]/orders` — the scope in the path, where it can't be forgotten.
   > But phase 4 rebuilds the bar and every client call with it, so moving fourteen
   > routes now means moving them, rewriting the client, and then rewriting both
   > again. Deferred for that reason and no other.
   >
   > **The scope is still explicit today.** Each endpoint names the party it is
   > acting on — from the bar session, the route, or the body — and passes it to the
   > guard. What is fixed now is the thing that actually mattered: an account-holder
   > can act without holding a bar session, so no screen has to live in the wrong
   > place to find a credential.

5. **Stock moves to the host.** `inventory(event_id, …)` becomes `stock(user_id, …)`.
   `GET /api/events/[id]/menu` resolves event → host → stock.
6. **`event.hostUserId` NOT NULL.** `POST /api/events` becomes admin-only and takes a
   `hostUserId`. Party status gains explicit `draft | live | done` transitions.
7. **The PIN becomes personal.** `user_pin`, set by the signed-in account.

   > **Amended while building it.** The plan said the PIN should mint an _account_
   > session. Better Auth has **no supported API for creating a session without a
   > credential** — only `internalAdapter.createSession`, which is undocumented and
   > carries no stability guarantee. Depending on a private API for the auth path,
   > on a dependency that updates itself, is not a trade worth making.
   >
   > So the PIN mints a **staff session whose row is linked to the user**, and the
   > actor resolver reads the account role _through_ that link. Same outcome where it
   > matters — the keypad gets Dan back behind the bar as himself, with his
   > capabilities — using no private APIs and no second session system. What it does
   > not do is open `/admin`, which is a desk activity and can afford a password.

8. **Delete, and check they are gone:** `staff.role`, `liveEvent()`,
   `ensureLiveEvent()`, the boot-seeded event, `seedStaff()`, `STAFF_EMAIL`,
   `STAFF_PASSWORD`, `STAFF_PIN`, `POST /api/auth/login`, `eventsForHost()`, and the
   stock screen's home inside `Bartender.svelte`.

_Gate: a **capability matrix test** — every capability × every actor shape × every
scope, asserted against a table written from §6 rather than from the implementation.
The cross-tenant isolation suite rewritten against the new actor, still driving host
A's real credential at host B's real ids and still expecting 404. `capabilities.test.ts`
still failing any endpoint that declares no capability. Database wiped and recreated._

### ~~Phase 1 — the look, delivered at last~~ ❌ withdrawn, 31 Jul 2026 — its premise was false

**This phase existed because of a claim that turned out not to be true.** It said
`neo.css` "has never once rendered as designed" because the display fonts were
"referenced in CSS variables and never loaded". That came from a stale note in
`OUTSTANDING.md`, and it was written into this plan as a whole phase's justification
without anyone opening the app.

Checked in a running browser before starting the work:

| Claimed                         | Actually                                                                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display fonts never loaded      | All three imported in `+layout.svelte`; `document.fonts.check()` true for each; headings compute to Archivo Black, buttons to Bungee                              |
| Falls back to system fonts      | It does not. `--bg` computes to `#ffe600`; the palette is in force                                                                                                |
| Confetti cannon needs restoring | Running. The canvas reads `0×0` from the main thread because `useWorker: true` hands it to an OffscreenCanvas — it measures 1280×720 by `getBoundingClientRect()` |
| Celebrate burst needs restoring | Fires from `+page.svelte` on a sent order                                                                                                                         |
| Playfair needs loading          | `neo.css` never mentions Playfair                                                                                                                                 |

**What was genuinely useful in this phase — the shared component vocabulary — moves
into phase 2.** Extracting an app bar, a panel, a list row and a form field _before_
any of the three areas exist would be guessing at an abstraction with no consumers.
Phase 2 builds the first area against `neo.css` directly; whatever repeats by the end
of it gets extracted then, with evidence.

`neo.css` stays byte-identical regardless — that guardrail is unaffected.

> The lesson is recorded in `OUTSTANDING.md` and it is the same one this whole
> rewrite is about: **a document saying something is broken is a claim, not a fact.**
> This plan was written by reading notes rather than running the app, and that is how
> a phase got scheduled to fix something that already worked.

### Phase 2 — the front door and the admin area

1. **`/` is the front door.** Signed out: sign in, or register. Signed in: the host's
   own area (phase 3) or, for Dan, `/admin`. Guests never see it — they arrive at
   `/e/<id>`.
2. **Sign-up hardening**, because this door faces the internet: rate limit by IP,
   require a verified email before anything can be created, and make an unverified
   account able to do precisely nothing.
3. **`/admin` — hosts.** List, search, open. Per host: their cupboard (editable by
   Dan), their parties, ban/unban with a reason, delete, promote to admin.
4. **`/admin` — parties.** Create against a host, name and date, open and close,
   delete. The guest link and its QR code. `Open the bar`.
5. **Extract the shared vocabulary, at the end** — app bar, panel, list row, form
   field, empty state, danger action. Built against `neo.css` first and pulled out
   once this area shows what actually repeats, rather than guessed at up front with
   no consumers. Additions go in `app.css`; `neo.css` stays byte-identical.

_Gate: walked in a browser end to end — register a host from a private window, then
as Dan find them, fill their cupboard, create their party, open it, and open its bar._

### ~~Phase 3 — the host area~~ ✅ done, 31 Jul 2026

1. **My cupboard.** All 173 ingredients, ten shelves, search, and the live count of
   what it pours. Optional: a host who never opens it is a normal host (§13).
2. **My parties.** Read-only except for the short list and the guest link — Dan owns
   the rest.
3. **Watch the queue.** A read-only view of the night, at `/host/<id>`.

> **The short list moved to phase 5, where the plan already had it.** Curating it
> now would mean building a picker over a menu of six fixed drinks — there is nothing
> to curate until the menu is generated from the cupboard. The capability
> (`menu:curate`) and the table (`event_menu`) exist and are unused, which is the
> honest state: the mechanism is ready and the screen waits for something worth
> choosing from.

_Gate: **met.** Walked as a real registered host — signed up, verified, signed in
through the form — with every trace of the admin session scrubbed from the browser
first: cookie cleared, `localStorage` and `sessionStorage` emptied. Not a separate
browser profile, which the in-app browser can't give me, but the same property: no
state a previous admin left behind._

**The bit worth keeping.** The watch screen has **two buttons on it** — copy the
link, and see the menu — and neither touches an order. That restraint is checked
against the server rather than trusted: driving the host's own session at their own
party returns `200` for reading the queue and **403 for every one of** advance,
delete, clear, bump, list staff, mint a join code, close the party, and take a bar
session. A control appearing here by accident would still be refused.

### ~~Phase 4 — the bar, rebuilt~~ ✅ done, 31 Jul 2026

Same job, new foundations. The queue, tabs, cards, per-drink progress, bump, handoff
and join codes all survive; what changes is that the bar is now **only** the bar.

1. **It admits on the actor, not on a token.** This was the whole of the phase. The
   gate was `session.signedIn`, which means "holds a bearer token" — right when a bar
   session was the only way to be anybody, and wrong afterwards: Dan holds an account
   cookie and passes every capability at every party, and would have been shown the
   sign-in keypad at his own bar. A helper gets in with a code and holds a token; Dan
   gets in because of who he is; both resolve to an actor and the screen asks the same
   question of the same object the server does.
2. Staff join with a code; Dan approves. Verified there is **no stock, no party
   management and no staff admin** in a helper's bar — and that the server refuses
   each of them anyway, so the menu is short because the powers are absent rather
   than merely hidden.
3. Dan opens any party's bar from `/admin` without an invitation.

_Gate: **met, with one honest gap.** A helper joined with a code through the real
keypad, with no account, and took all three orders New → Making → Serving → Done
through the actual UI. The final state and the actor that produced it were read back
from the server._

**What the walk found, which no test had:** `/api/auth/me` asks a _platform_-scoped
question, and `resolveActor` only fills the party half for a party scope — so it
answered `party: null` to a helper holding a perfectly valid token, and the bar
showed them the keypad they had just come through. A bar session names exactly one
party by construction, so `whoami` now resolves it. Both that and the
admin-on-a-cookie case are in `host-loop.test.ts`.

**Two things the walk could not prove, stated rather than glossed:**

- **It was one device used twice, not two.** The in-app browser gives tabs that share
  cookies and `localStorage`, so clearing storage for the "second device" also signed
  the first one out. The helper path itself is honest — no account, code through the
  keypad — but "on a second device" is simulated.
- **"And the guest is notified" is unverified.** The browser profile has notification
  permission blocked, so the push never left. The code path runs; that it arrives is
  untested here and wants a real device.

### ~~Phase 5 — the generated menu~~ ✅ done, 31 Jul 2026

The promise §1 has made since the beginning.

1. **`GET /api/events/[id]/menu` returns the generated list** from the host's
   cupboard, not the curated six filtered by it.
2. **The short list.** `event_menu` rows, curated by Dan or the host. **No rows means
   show everything** — curation is optional and its absence is not a broken menu.
3. **Three doors for the guest**: the short list (default), `Show everything`
   (grouped by base spirit, searchable), and `Help me choose` — the Make-a-Drink walk
   over `reachable()`, which has been ported and tested since phase 3 and never used.
4. `src/lib/data.ts`'s six drinks become the seed of a short list rather than the menu.

_Gate: a host with a real cupboard yields a menu a person would actually order from,
checked by eye; a host with an empty cupboard still gets a working party (§13); and
the walk reaches a drink the browse list also offers._

**Gate met.** 30 bottles yields 60 drinks across six base spirits; walked on a phone
viewport and looked at. An unrecorded cupboard still serves the house six. The walk
Gin → Sweet Vermouth → Campari lands on the Negroni, which the browse list also
offers under Gin.

**What it cost, and what it changed:**

- `ChooseADrink.svelte` does **not** use the engine's `exactMatch()`. That function
  asks whether the picks _are_ the ingredient list, and an ingredient list includes
  the `method` — which the walk deliberately never asks about, because nobody chooses
  whether their drink is shaken. Against a Negroni it compared two picks to three
  ingredients, decided the walk wasn't finished, and offered "any of these: Negroni".
  The walk is finished when nothing is left to ask and one drink is left standing.
- **Two card defects that only 270 names could expose.** The title reserved a 44px
  gutter for the favourite star on _every_ line, and sized itself off the viewport —
  so "Cosmopolitan" in a half-width phone card had ~90px and ran under the star. The
  gutter is now the star's own line and the size comes from the card (`cqi`). Four
  chips also don't fit a phone in one row; `.menubar` wraps on the guest menu.
- `scripts/db.js` grew a **`stocked`** scenario, because the menu is only worth
  looking at with a real cupboard behind it, and `show` was reading a `staff.role`
  column that the phase-0 restructure removed — it threw on every invocation.

**Said out loud, as §13 requires:** phase 5 has shipped before phase 8, so a
generated menu currently offers a non-drinker nothing. Every one of the 270 is a
cocktail. A host with a well-stocked bar and a pregnant guest has a problem the app
does not know about.

### ~~Phase 6 — end to end~~ ✅ done, 31 Jul 2026

Playwright over the flows that now exist, sharded across the M4's ten cores: register
→ cupboard → Dan creates a party → guest orders from the generated menu → helper
serves it → guest notified. Plus the negative ones: a host cannot advance an order, a
banned host cannot sign in, one party's guest cannot see another's menu.

_Gate: the suite runs in CI on the Mac runner._ **Met** — run `30628097272`, 13
passed in 9.5s, whole job 66s including the Chromium download.

13 specs in `e2e/`, green in about ten seconds. `npm run test:e2e` builds the app and
drives `build/index.js` — the same artefact launchd runs — against a SQLite file that
is deleted on every start.

- **Four browser contexts, because that is four devices**, and guests and helpers get
  a phone viewport. Above 900px neo.css hides the tab bar and pins the order rail
  open, so a desktop guest never touches the sheet every real guest uses.
- **`EMAIL_OUTBOX`** writes outbound mail to a file as JSON. Verification is not
  skippable — an unverified account is refused everywhere — so "register through the
  front door" is only walkable if the link is readable from outside the server. It
  outranks Graph, and says so in the log, because setting it stops mail being sent.
- **The push leg is not asserted.** Headless Chromium has no push service and the run
  disables VAPID, so the guest's phone buzzing is a code path that runs and an arrival
  nobody can observe. Same conclusion phase 4 reached: it wants a real device.

**It found a real defect on its first run.** Better Auth does not know about
`bannedAt` — the ban lives in `resolveActor` — so a suspended host's password is still
correct and they still get a session. They landed back on the sign-in form having
successfully signed in, with nothing said and no idea why: the exact dead end
`awaitingConfirmation` exists to prevent for sign-up. The front door now says the
account is closed, and does not say why, because that reason is Dan's note to himself.

**Also found:** `/e/<id>` remembers the party during hydration, which is later than
`page.goto` resolves — so a device could reach `/bar` with no party remembered. A
person cannot lose that race; a test can, and did, once in three runs.

### Phase 7 — the variant model _(deferred, needs research)_

**Not scheduled yet, and deliberately so.** Dan's example: chili in the cupboard
unlocks a Spicy Margarita; Tajín as well unlocks the spicy rim. The first half already
works — `Spicy Margarita` is its own recipe requiring `Fresh Chili`. The second half
cannot: its Tajín rim lives in a free-text `garnish` string with no connection to the
`Tajín Rim` ingredient a host can tick.

The target is **a base drink plus stackable modifiers driven by stock**, which
collapses the six margaritas into one drink with upgrades and generalises the
Boozy/Boring axes from six drinks to all 270.

Before any code: **research how this is modelled elsewhere** — cocktail databases,
recipe ontologies, the IBA classifications, and how ordering systems represent
modifier groups. Then design the data model, then transform the 270. It is a data
redesign, not a field addition, and doing it badly would be worse than not doing it.

Two rules it must preserve, both learned the hard way:

- **A missing garnish never blocks a drink.** An absent olive must not hide a Martini.
- **A present garnish may add a variant.** That is the whole point.

### Phase 8 — mocktails and the rest of the bar _(deferred)_

The 270 are all cocktails. Wine, beer, soft drinks and non-alcoholic versions are not
in the data, so a generated menu currently offers a non-drinker nothing (§13). Extend
the recipe data rather than bolting on a second list.

## 9. Steps that need a human at a browser

Work around these per §0 — interface + dev implementation + a note in
`docs/OUTSTANDING.md` — rather than stopping the plan.

1. ~~**Entra app registration**~~ and ~~**Application Access Policy**~~ — **done,
   30 Jul 2026.** Recorded because none of it is discoverable from the repo:

   |                   |                                                                                          |
   | ----------------- | ---------------------------------------------------------------------------------------- |
   | Tenant            | `122521bd-12ea-4515-acc6-cf8d44a8dae7` (`meridew.com`)                                   |
   | App (client) id   | `5c0fbbe4-aa85-4313-8938-4914437baee7`                                                   |
   | Credential        | **certificate**, not a secret — see §2d                                                  |
   | Private key       | `~/.config/cocktails/graph-key.pem` on the Mac, mode 600, expires Jul 2029               |
   | Thumbprint        | `B58F26CB039EAADF2E3CDAEDA199E13EECAD9B5E`                                               |
   | Sends as          | `bar@meridew.com` — a **shared mailbox**, so no licence is consumed                      |
   | Scope group       | `Cocktails App Mailboxes`, guid `62ebf848-1fd2-4c5d-9629-cc8b5b973f5b`                   |
   | Dan's own mailbox | `dan@meridew.com` — **not** `daniel.meridew@`, which is a guess that wasted a round trip |

   Verified the way it should be: `Test-ApplicationAccessPolicy` returns **Granted**
   for `bar@meridew.com` and **Denied** for `dan@meridew.com`. The second is the one
   that matters — `Mail.Send` is tenant-wide by default, so without the policy that
   app could send as anyone in the tenant.

   Two things that cost a round trip each, so they're written down:
   `New-DistributionGroup` takes the **default accepted domain**, so the group landed
   on `@meridew.onmicrosoft.com` rather than `@meridew.com` — pass the **guid** to
   `PolicyScopeGroupId` and the question never arises. And a 404 from `sendMail`
   means the mailbox doesn't exist, not that the credential is wrong.

2. **Cloudflare R2 bucket** + an API token for Litestream. _Blocks: phase 4.6._
3. **OAuth client IDs** for Google and Apple, if that sign-in path is wanted.
4. ~~**The tunnel's Public Hostname**~~ — **confirmed working, 31 Jul 2026.**
   `https://cock.meridew.com` serves the front door from the Mac.
5. ~~**Registering the admin account**~~ — **done, 31 Jul 2026.** Through the real
   front door, with a real verification email delivered by Graph from
   `bar@meridew.com`. That is the whole sign-up path proven against the live service
   rather than against the memory sender.
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

## 10. Accepted risks

- **Availability.** Once a host has signed up and their event is tonight, Dan's home
  internet is in someone else's critical path. The dedicated Mac removes the
  _contention_ half of this — no more sharing four cores with two VMs, SQL Server and
  Plex — but not the connectivity half. Litestream protects the _data_, not the
  _uptime_. Dan chose this knowingly, and moving to Fly or Cloudflare later is a
  deploy-target change rather than a rewrite (§2a).
- **`Mail.Send` is tenant-wide by default.** A leaked client secret could send as any
  mailbox in the tenant. Mitigated by the Application Access Policy in §9.2.
- **Client secrets expire** (24 months maximum). It will need renewing, and nothing
  will remind us.
- **No reproducible builds** once Docker is gone. The Mac's toolchain versions become
  part of the deployment. Accepted for a single-host hobby project.

- **Open sign-up faces the internet.** `cock.meridew.com` resolves to a Mac in Dan's
  house, and anyone who finds it can create an account. Mitigated in phase 2 by
  per-IP rate limiting, mandatory email verification before anything can be created,
  and Dan's ability to ban. Accepted rather than solved: the door is deliberately open.
- **Other people's data, on one SSD.** From the first real host, the database holds
  someone else's name, email and evening. Litestream is parked (`OUTSTANDING.md`),
  which is fine while the counts at the top of this file hold and stops being fine
  that same day.

## 11. Guardrails

- `src/lib/neo.css` is a **verbatim** copy of the original design. It's in
  `.prettierignore`; keep it byte-identical. Additions go in `app.css`.
- `$lib/server/*` must never be imported from client code — the build enforces it.
- Tests own the definition of done. Don't call a phase complete on a green typecheck.
- Never echo a secret into the transcript.
- Deploy only when asked.
- Read `CLAUDE.md` before running shell commands. The Windows shell rules there exist
  because ignoring them cost three failed commands in one session.
- **Build where the thing belongs, not where the plumbing already works.** If the
  credential, the guard or the route doesn't exist yet, that is the work — §0.
- **Screens are deliverables.** A phase that adds an endpoint without the screen that
  reaches it is not done. Twice now that has produced an API nobody could use.
- **Build the parts a stranger can reach as though a stranger will reach them** — §10.
- **`ADMIN_EMAILS` is the only route to admin that cannot be revoked from inside the
  app.** Keep it that way; an in-app mistake must never lock Dan out of his own service.

## 12. Out of scope

| Not doing                 | Why                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| Payments / billing        | Not now. It is Dan's mates — but the role model no longer forbids it, and §10 says build like a product |
| Postgres or any server DB | Asked and answered twice — §2b                                                                          |
| A separate API service    | SvelteKit's server routes _are_ the backend; splitting them would undo the collapse already done        |
| Native app                | Capacitor was removed; see `HANDOFF.md`                                                                 |
| Moving off self-hosting   | §2a. Fly is the documented fallback if it stops being fun                                               |
| Guest accounts            | Guests stay anonymous. A device id is enough to notify someone their drink is ready                     |
| Apple sign-in             | A judgement, not an omission — see `OUTSTANDING.md`                                                     |

## 13. Gaps carried on purpose

Written down so nobody has to discover them, and so nobody "fixes" one by accident.

- **A generated menu offers a non-drinker nothing.** The 270 recipes are all
  cocktails. Until phase 8, a host with a well-stocked bar and a pregnant guest has a
  problem the app doesn't know about. Dan accepted this to get the generated menu
  sooner. **If phase 5 ships before phase 8, say so out loud at the time.**
- **Nothing recorded is not nothing in stock.** A host who has never opened their
  cupboard gets a menu offering everything, not a menu offering nothing. Same rule for
  an uncurated short list. Absence of an answer is not a "no", and the `false` rows
  written on unticking are what make the distinction real.
- **A drink we know nothing about is now off the menu.** ⚠️ _Changed by phase 5._ This
  used to say the opposite: a curated name with no matching recipe reported pourable,
  so wine stayed on. A generated list starts from the recipes, so a drink with no
  recipe cannot be generated — Wine and Pom & Elderflower survive only on the **house
  list**, which is what an unrecorded cupboard falls back to. The moment a host ticks
  one bottle, they lose the ability to offer a glass of wine. Nobody has asked for it
  back yet; when they do, the answer is probably a recipe-less "always on" entry
  rather than undoing the generation.
- **Six margaritas.** Until phase 7 the generated list shows recipe families as
  separate drinks. Known, ugly, temporary.
- **The `staff` table is `event_member`.** The old plan named a separate membership
  table; one table with a nullable `user_id` is what actually works, because helpers
  deliberately have no account. See `HISTORY.md`.
- **`staffByIdUnscoped` is guarded by its name, not the type system.** The plan's own
  principle is that the type system is the defence and a name is care. A branded
  `TrustedStaffId` would make it real.

---

**Sources:** [SvelteKit issue: remove deprecated Lucia](https://github.com/sveltejs/kit/issues/12990) ·
[Better Auth](https://better-auth.com/docs/adapters/sqlite) ·
[Better Auth admin plugin](https://www.better-auth.com/docs/plugins/admin) ·
[drizzle-kit lacks node:sqlite support](https://github.com/drizzle-team/drizzle-orm/issues/5471) ·
[Drizzle SQLite drivers](https://orm.drizzle.team/docs/sqlite/get-started-sqlite) ·
[Litestream](https://litestream.io/) ·
[Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) ·
[Cloudflare Email Service](https://developers.cloudflare.com/email-service/) ·
[Asahi M4 support](https://asahilinux.org/docs/platform/feature-support/m4/) ·
[SMTP AUTH deprecation timeline](https://techcommunity.microsoft.com/blog/exchange/updated-exchange-online-smtp-auth-basic-authentication-deprecation-timeline/4489835)
