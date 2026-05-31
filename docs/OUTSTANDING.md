# 🧊 Outstanding / parked

Things deliberately deferred — revisit before they block a phase.

## Voice / NL "Ask" finder — ❌ DROPPED
The legacy voice/natural-language "Ask the bar" finder relied on a now-dead
MCP / external service. **Not being ported** to the rebuild.
- The legacy flat app (`app.js`, still live until Phase 1 cutover) still contains
  it. It can be stripped from the live app on request; otherwise it disappears
  naturally when we cut over to the Svelte app.

## Make-a-Drink + live ingredient availability — 🤔 NEEDS DESIGN
The "Make a Drink" discovery engine (`cocktails.json`, ~4.5k lines) is **not yet
ported** because it should be driven by **what's actually in stock**.

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
