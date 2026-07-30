# 🧊 Outstanding / parked

Things deliberately deferred — revisit before they block a phase.

## 🩹 Concessions made in phases 0–2

Written down because each one is a place the code is quieter than the truth.
Ordered by how much it would cost to be wrong.

### 1. A guest cannot choose their party — `ensureLiveEvent()`

`POST /api/orders` puts the drink in whatever event is `status = 'live'`, newest
first. With **two live events, guests order into the wrong party**, and nothing
errors.

This is a real hole in the thing phase 2 claimed to close. The isolation suite
passes because it only ever has one live event while each host is being built, so it
proves the _staff_ side and not the guest side. Phase 2's honest claim is "two hosts
cannot see each other's data", not "two parties can run at once".

**Fix:** the guest's entry point has to name the event — a code in the QR link — with
`liveEvent()` only as the single-party fallback. Do this before two hosts ever run
simultaneously; until then the behaviour is correct by accident.

### ~~2. Signing up leads nowhere~~ ✅ fixed in 2.5

`POST /api/events` creates a party and writes the host's `staff` row as owner with
`userId` set, so that column is no longer dead. `POST /api/events/[id]/bar` trades an
account session for a bar session, because the bar endpoints all consume a staff
session and most people behind a bar have no account at all.

The owner's staff row deliberately carries **no email**: `staff.email` is UNIQUE
because it is a login identity, and a host running two parties would collide with
themselves.

### 3. The capability model was not widened as promised

`permissions.ts` says the actor becomes an event membership in phase 2 and the call
sites won't change. The call sites didn't change — but the widening didn't happen
either. `can()` still keys off `staff.role` alone, not the account-role × event-role
pair §5 describes. There is no `operator` vs `host` distinction yet.

Harmless today (one axis, two roles) and the shape is right, but the comment is
currently a promise rather than a description.

### 4. The seeded default event is still owned by nobody — narrowed

Every host-created event now has an owner, and `host-loop.test.ts` asserts it. What
remains is only the "The party" event seeded at boot so the app works before anyone
signs up. Once sign-up is the normal way in, that seed should either be claimable or
dropped entirely.

### 5. `staffByIdUnscoped` is guarded by its name, not by the type system

The unscoped lookup is genuinely needed when resolving a session from a token we
already trust. But the plan's principle is "the type system is the defence, not
care", and a name is care. A branded `TrustedStaffId` type would make it real.

### 6. Smaller, but real

- `inventory` exists and nothing reads it. Phase 3 wires it up.
- **No UI** for events, inventory or sign-up. All of the above is API-only.
- `Staff` now carries `eventId` to the client — defensible, but a server concept in a
  client-facing shape.
- The tenancy migration uses `ALTER TABLE ... ADD COLUMN NOT NULL`, which only
  succeeds on an **empty** table. Same wipe-first caveat as below.
- Tests call `ensureLiveEvent()` inline, which creates an event as a side effect.
  Works; not elegant.
- The two tenancy migrations were collapsed by hand-editing `_journal.json`. Correct
  on a green field, wrong once anything has shipped.

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

**Still unset: `STAFF_PIN`** in `~/.config/cocktails/env` on the Mac. Empty means PIN
sign-in is off; email + password still works. Set it, then
`launchctl kickstart -k gui/$(id -u)/com.meridew.cocktails`.

### 🧊 Litestream → R2 — parked, 30 Jul 2026

**Dan's call: back burner.** Litestream 0.5.15 is installed on the Mac and configured
with nothing, so **there are currently no backups of anything.**

That is a fine trade _today_ — the database holds a seeded admin, one default event
and no real data, so losing the disk would cost an afternoon of re-running
migrations. It stops being fine at exactly the moment the wipe permission does:
**the first real host account.** From then the data belongs to someone else, and a
single SSD is the only copy of their evening.

When it comes off the back burner: an R2 bucket and API token from the Cloudflare
dashboard, then `litestream replicate` as a third LaunchAgent beside the app and the
tunnel. Not done until a restore into a scratch path has been diffed against the
live database — the plan is explicit that an untested backup is not a backup.

### ~~Real email~~ ✅ done, 30 Jul 2026

Microsoft Graph, authenticated with a **certificate** rather than a client secret, so
nothing secret ever passed through a clipboard or this repo. Proven end to end
against the live tenant: certificate → token → `sendMail` → shared mailbox. Details
and identifiers in [`PLATFORM-PLAN.md`](PLATFORM-PLAN.md) §8.1.

Still unset: **`BETTER_AUTH_SECRET`**… actually no — it is set on the Mac. What
remains unset is **`STAFF_PIN`**, so PIN sign-in is off; email and password work.

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

## ⚠️ The NAS volume must be wiped before any deploy to it

Phase 0 replaced the declared schema with Drizzle migrations. A database created by
the old code has all five tables but no `__drizzle_migrations` row, so the baseline
migration collides with `table orders already exists` at boot.

Deliberately **not** solved with adoption code — that would be a compatibility shim
for a single transition, and `PLATFORM-PLAN.md` §0 rules those out while the data is
still disposable. Phase 4 abandons the NAS volume entirely, so the realistic fix is
"don't deploy to the NAS again". If you must, delete `cocktails-data` first.

## Voice / NL "Ask" finder — ❌ DROPPED

The legacy voice/natural-language "Ask the bar" finder relied on a now-dead
MCP / external service. **Not being ported** to the rebuild.

It lived only in the legacy flat app, which has been deleted along with GitHub
Pages. Nothing to strip.

## Make-a-Drink + live ingredient availability — 🤔 NEEDS DESIGN

The "Make a Drink" discovery engine is **not yet ported**, because it should be
driven by **what's actually in stock** rather than by a static tree.

> ⚠️ **Its dataset is no longer in the working tree.** `cocktails.json` (~4.5k
> lines: every cocktail as a base spirit plus an unordered ingredient set, with the
> category order the decision tree walks) went with the legacy app. It is not lost —
> retrieve it with:
>
> ```bash
> git show 5a41824:cocktails.json > cocktails.json
> ```
>
> Deliberately not carried in the tree: nothing reads it today, and a 100 KB file
> that only a future feature wants is exactly the weight this repo just shed.

Desired behaviour:

- The **bartender can mark which ingredients are available** (in stock) tonight.
- That availability then:
  1. **filters the Make-a-Drink** decision tree to only recipes that are still
     reachable, and
  2. **gates the main menu** — drinks that can't currently be made are
     greyed-out / hidden.

Open questions to settle before building:

- **Granularity** — per-ingredient, or per-spirit/category? (e.g. is "Triple Sec"
  one toggle, or do we track brands?)
- **Who owns the inventory** — a bartender-only screen on the NAS/API; how is it
  stored (new `ingredients` table) and edited?
- **Live sync** — poll vs push so guests see availability change in near-real-time.
- **Interaction with the axes model** — how availability maps onto the current
  `DRINKS` + option-axes (Boozy/Boring, Margarita flavour, etc.) and the
  `cocktails.json` ingredient sets.

→ Discuss, then implement as its own slice (likely after Phase 3).

## Visual restoration / polish pass — 🎨 SCHEDULED (after Phase 2 + cutover)

The Svelte rebuild currently uses a **clean placeholder neon style**, not the full
loud original aesthetic. This is deliberate prototype sequencing, not a redesign.
To bring back / level up after the foundation is locked:

- **Load the display fonts** (Bungee / Archivo Black / Playfair) — currently
  referenced in CSS vars but never linked, so it falls back to system fonts.
- **Background confetti cannon** (ingredient emojis blasting in from the edges).
- **Celebrate confetti explosion** on successful order (foreground burst).
- Favicon-in-the-bar, louder neon glow/intensity, overall "in your face" energy.
- Revisit layout density to match the original's punch.
  → One focused styling pass once components are stable (post-cutover).
