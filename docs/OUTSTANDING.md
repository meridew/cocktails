# 🧊 Outstanding / parked

Things deliberately deferred — revisit before they block a phase.

## ⛔ Waiting on a human

Per [`PLATFORM-PLAN.md`](PLATFORM-PLAN.md) §0, work that needs a browser login is
stubbed behind an interface and logged here rather than stopping the plan. Each entry
says what is needed, who can do it, and what it unblocks.

### Real email — Entra app registration

**Blocks:** nothing yet. Accounts work end to end; the messages go to the server log
instead of an inbox, which is enough for development and for the tests.
**Needed before:** a real host signs up.

`src/lib/server/email.ts` is an interface with a logging implementation. To send for
real, add a Graph sender beside it and swap the default. What only a human can do:

1. **Entra app registration** on the `meridew.com` tenant — new registration, a client
   secret, and the **`Mail.Send` _application_ permission** with admin consent.
2. **An Application Access Policy** scoping that app to one mailbox
   (`bar@meridew.com`), via Exchange Online PowerShell `New-ApplicationAccessPolicy`.
   **Don't skip this** — `Mail.Send` is tenant-wide by default, so a leaked secret
   could otherwise send as anyone in the tenant.
3. Put the client id, tenant id and secret in the environment (piped to
   `gh secret set`, never echoed).

Also unset today: **`BETTER_AUTH_SECRET`**. Without it, production mints a random one
per boot, so every host is signed out on restart. Dev has a fixed placeholder.

### OAuth sign-in (Google / Apple) — optional

Client ids and secrets, if that door is wanted. Better Auth makes it configuration
rather than code, so this is a config block and two secrets.

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
