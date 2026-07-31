# Navigation: audit and a single model

_Written 31 Jul 2026, against `8117603`. Every claim marked **verified** was
observed in a browser against the dev server; claims marked **read** are from the
source, with the file and line given so they can be checked without re-running
anything._

## 1. What exists

Seven pages. That is the whole app.

| Route        | Who it is for | What it is                         |
| ------------ | ------------- | ---------------------------------- |
| `/`          | anyone        | front door: live parties + sign-in |
| `/e/[id]`    | guest         | the menu                           |
| `/e/[id]/3d` | guest         | the same menu, in 3D               |
| `/bar`       | staff         | the live queue                     |
| `/host`      | host          | their cupboard and their parties   |
| `/host/[id]` | host          | watching one party                 |
| `/admin`     | admin         | every party, every host            |

And the full set of ways between them — every `href`, `goto` and
`location.href` in `src/`:

```
/            → /e/[id]         party card
             → /admin | /host  automatic, once signed in
/e/[id]      → /bar            🍸 appbar icon, and the "waiting" banner
/e/[id]/3d   → /e/[id]         "Flat menu"
/bar         → /e/[id] or /    ✕
/host        → /host/[id]      "Watch"
             → /               sign out
/host/[id]   → /host           "Back"
             → /e/[id]         "See their menu"
/admin       → /bar            "Work it"
             → /e/[id]         "See their menu"
             → /               sign out
```

Twelve edges for seven nodes. The problems are all in what is missing from that
list, and in what the list cannot show — because a third of this app's navigation
does not go through the URL at all.

## 2. The diagnosis

**Three different navigation models are running at once.**

1. **URL as state.** `/host` → `/host/[id]`, `/e/[id]`. Proper routes. Back
   works, links work, reload works.
2. **Component state as navigation.** `/admin`'s `tab` / `openParty` / `openHost`
   / `sheet`; the guest menu's `door`; the bar's `showStaff`. Real screens, real
   hierarchy, invisible to the URL.
3. **Device storage as context.** `/bar` learns which party it is serving by
   reading `localStorage`. Invisible to the URL _and_ writable from an unrelated
   page.

Each is defensible on its own. Together they mean the address bar tells you
almost nothing about where you are, and **Back means something different on
every screen**.

## 3. The defects

### D1 — the bar does not know which bar it is

`/bar` takes no party. It reads one from device storage:

- `src/lib/components/Bartender.svelte:61` — `let eventId = $derived(currentEventId() ?? '')`
- `src/routes/e/[id]/+page.ts:19` — `rememberEvent(params.id)`, on every menu load

**Verified.** Loading Ana's birthday then Sam's Saturday moved
`cocktail_event_id` from `ccd53b7dda47` to `a5e98f884fab`. Anything that opens a
guest link — a QR code on a table, a shared URL, a host checking their own menu —
silently repoints the bar.

The server is not fooled. `partyInScope` (`src/lib/server/scope.ts:33`) prefers
the staff token's own event over `?eventId=`, so the queue that comes back is
always the token's party. **No data leaks.**

The client is a different story. `Bartender.svelte:75`:

```ts
let working = $derived(can(session.actor, 'orders:advance', party(eventId)));
```

and `src/lib/shared/permissions.ts:208`:

```ts
if (actor.party?.id !== scope.eventId) return false;
```

`working` is what decides between the queue and the sign-in gate. It is asked
about **the party in localStorage**, not the party the token is for. For a helper
— no account, one party-scoped token — a mismatch means the queue is replaced
mid-shift by "Helping out tonight?", asking them to request access they already
hold. Nothing on the screen explains it, and there is no control anywhere that
puts it back; the only fix is to re-open the right party's guest link.

Admins never see this: `permissions.ts:202` returns true for `role === 'admin'`
before the party check. **This is read, not verified** — my test helper was
masked by an account cookie that `POST /api/auth/logout` does not clear (it ends
the staff session only; the Better Auth cookie lives under `/api/account/*`).
The three lines above are unambiguous, but I did not see the eviction happen.

Compounding it: **the bar screen never names the party.** The header is `🍸 Bar`
and nothing else (**verified**, two screenshots). A bartender cannot tell which
party they are serving, so they cannot notice when it changes.

### D2 — `/admin`'s hierarchy is invisible to the URL

`tab`, `openHost`, `openParty` and `sheet` are all `$state`. **Verified**: from
the parties list I opened Sam's Saturday — two levels deep, showing "The bar",
"What it leads with", "Their guests' link", "Getting rid of it" — and the URL was
still exactly `/admin`.

Then I pressed Back. It did not go up a level to the parties list. **It left
`/admin` entirely and landed on `/bar`.**

This is a phone app installed to a Home Screen. On Android the gesture/hardware
Back is _the_ back affordance, and here it ejects you from the desk. Reload loses
your place. A party cannot be linked to. The same shape applies to the guest
menu's `door === 'walk'` and the bar's `showStaff`.

### D3 — the top-right corner means six different things

Every screen puts something in the same place, with the same class
(`.appbar-bartender`), and no two agree on what it is for:

| Screen       | Top-right    | What it does             |
| ------------ | ------------ | ------------------------ |
| `/`          | 🔑           | opens the sign-in drawer |
| `/e/[id]`    | ⚙️ then 🍸   | settings; go to the bar  |
| `/e/[id]/3d` | "Flat menu"  | sideways, to the 2D menu |
| `/bar`       | ⋯ then ✕     | options; leave           |
| `/host`      | **Sign out** | destructive              |
| `/admin`     | **Sign out** | destructive              |
| `/host/[id]` | "Back"       | up one level             |

Look at the last two rows together. In the host's own two screens, one tap apart,
the same corner is **Sign out** on one and **Back** on the other. No muscle
memory can form against that, and the failure mode is losing your session by
reaching for Back.

### D4 — three links lead into rooms with no door out

`/e/[id]` is linked to from `/admin` and `/host/[id]`, both labelled "See their
menu". Neither can be returned from: the guest menu has no exit to any host or
admin surface. Its only outbound link is 🍸 → `/bar`.

Which makes the path Dan walks at every single party:

```
/admin → "Work it" → /bar → ✕ → /e/<id> → (nothing)
```

The bar's ✕ is `aria-label="Back to the menu"` and goes to the guest menu — right
for a helper who is also a guest, a dead end for the person who arrived from the
admin desk. Browser Back or retyping `/admin` are the only ways on.

### D5 — `/e/[id]/3d` is unreachable

Nothing links to it. A grep for `3d` across `src/` returns the route's own files
and nothing else. It links _out_ to the flat menu, and can only be arrived at by
typing the URL. Either it is a feature nobody can find, or it is dead weight.

### D6 — the basket is not scoped to a party

One `cocktail_basket` key, no party in it (`src/lib/stores/basket.svelte.ts:10`).
**Verified**: a Gimlet added on Ana's birthday was still in the basket on Sam's
Saturday, where it may not be on the menu at all.

### D7 — "help me choose" has no address

The walk is a whole view reached by a chip, held in `door` state, dismissed by
Escape. Not a tab, not a route, not linkable, and Back does not leave it.

## 4. The model

One rule, applied everywhere:

> **Everything that changes what is on screen goes in the URL. Everything the URL
> says is what is on screen. The party is always in the path.**

### 4.1 Routes

```
/                     front door
/e/[id]               menu
/e/[id]/choose        the walk                  ← was `door` state
/e/[id]/3d            3D menu                   ← linked at last
/bar                  which bar? — a picker     ← was a guess
/bar/[id]             the queue                 ← was /bar + localStorage
/host                 the host's own area
/host/[id]            watching one party
/admin                parties
/admin/hosts          hosts                     ← was `tab` state
/admin/p/[id]         one party                 ← was `openParty` state
/admin/h/[id]         one host                  ← was `openHost` state
```

`/bar/[id]` is the load-bearing change. It kills D1 at the root: permission is
asked about the party in the path, which is the same party the token is for, so
the mismatch cannot arise. It also means the bar can be bookmarked, two bars can
be worked in two tabs, and the header can finally say **which** bar.

`currentEventId()` stops being an input to any permission check and goes back to
what its own doc comment says it is — a convenience so a returning guest does not
need the QR code again.

### 4.2 One shell, one grammar

Today there are three hand-rolled shells: `.workshell` (front door, host, host
detail, admin), `.app` (guest menu), `.bartender` (bar). One `<Shell>` component,
with three fixed slots and a rule for each:

- **Left — always up.** A back chevron naming its destination ("← Parties",
  "← Ana's birthday"), or the brand when you are at a root. Rendered as a real
  `<a href>` to the parent route, so it works on a cold load into a deep link,
  not just when there is history behind you.
- **Centre — always where you are.** The party name, or the section. The bar
  header stops being `🍸 Bar` and becomes `🍸 Ana's birthday`, which is D1's
  visible half fixed for free.
- **Right — always this screen's one action.** Never sign out.

**Sign out moves into Settings.** `SettingsSheet` is already mounted in the root
layout and already reachable from the guest menu's ⚙️; putting ⚙️ in every
shell's right slot gives every screen the same escape hatch and takes the
destructive control out of the position that everywhere else means "go back".
This is the single highest-value change in the document and it is small.

### 4.3 Getting between roles

Dan is an admin, a host, and the bartender, and there is currently no link
between those three worlds — `/admin` cannot reach `/host`, and neither can be
reached from a guest menu. Settings grows a "Switch to…" list of the surfaces
this actor can actually reach, computed from `can()` so it cannot drift from what
the server will honour.

### 4.4 Back is a real Back

Once the hierarchy is in routes, browser and hardware Back work by themselves,
and D2 evaporates. `WorkSheet` overlays keep their own close — a sheet over a
page is genuinely modal, and that is the one place where state rather than a
route is right.

## 5. Arriving: who is at the door, and what it offers them

_Second pass, prompted by: "I couldn't instantly tell what was 'I work here' —
I'm a barman helping — vs 'I want to host', sign in and set up an event."_

Four different people arrive at this app, and each is answering a different
question about themselves:

| They think       | We call them | What they need                     | Do they have an account? |
| ---------------- | ------------ | ---------------------------------- | ------------------------ |
| "I want a drink" | guest        | one party's menu                   | no, and never will       |
| "I'm pouring"    | helper       | one party's queue                  | no — that is the point   |
| "It's my party"  | host         | a cupboard, and to watch the night | yes                      |
| "I run this"     | admin        | everything                         | yes                      |

The front door serves the first fully, the third and fourth behind one unlabelled
icon, and **the second not at all**.

### D8 — the front door is 100% guest, plus a key

**Verified.** Signed out, `/` is: "What's on tonight", "Tap yours and start
ordering", three large party cards each reading "Join →", and a 22px key glyph in
the corner with no visible label. Nothing on the page distinguishes hosting from
helping, because nothing on the page mentions either.

### D9 — the one sentence meant to disambiguate is the one that conflates

**Verified.** The sign-in drawer reads:

> **Welcome back**
> For hosts and whoever is running the bar.

A barman reads "whoever is running the bar", taps **I need an account**, and gets
"Set up your account — tell us what you've got in, and we'll work out what the bar
can pour." That is host copy, and the outcome is a **host account with a cupboard
and no parties**. Registering has never been a way to get behind a bar, and this
screen is the only thing in the app that implies it is.

### D10 — "I work here" leads away from working here

**Verified end to end.** `StaffGate.svelte:166` is `href="/?signin"`. So from the
bar gate:

```
/bar  →  "I work here"  →  /?signin  →  the host sign-in drawer
      →  "I need an account"  →  a host account
```

The control labelled in the barman's own words is the one that takes them to the
wrong place — and it navigates _off the party_, so the ask-to-help door they were
one tap from is now behind finding the party link again. Meanwhile the only path
that works is `/e/<id>` → an unlabelled 🍸 → "Ask to help", reachable only by
someone who already has the party's link.

The trap is circular: the front door points at the bar for bar staff, and the bar
points at the front door for people who work here, and neither is where a helper
gets in.

### D11 — the bar gate cannot name the party either

**Verified.** The gate asks "Helping out tonight?" — at which party? It is asking
the device to request access to whatever party it last looked at (D1 again). A
helper cannot see what they are asking to join, and a host cannot see which bar
they are about to open.

### D12 — signing in makes the front door unreachable

`src/routes/+page.svelte:113` — `if (user?.emailVerified && session.actor.account)
await goto(home(), { replaceState: true })`.

**Verified**: navigating to `/` while signed in lands on `/admin` before anything
renders. So the party list — the thing worth keeping — exists only for people who
are signed out. Dan cannot look at what is on tonight. A host cannot reach their
own guests' menu from the front door. And `replaceState` destroys the `/` history
entry, so Back skips past it.

### D13 — every guard is a hand-rolled redirect that forgets where you were going

`/admin`, `/host` and `/host/[id]` each do their own `onMount` → `refreshActor()`
→ `goto(...)`, with three different destinations and no shared component. None
records the URL that was being asked for, so a deep link — a bookmark, a shared
link, a push notification — signs you in and drops you at the front door. It
accidentally works for hosts and admins, because `home()` happens to send them
somewhere useful. It cannot work for a helper, because there is no sign-in for
helpers at all.

## 6. The fix: name the party first, then the door

The instinct that the party picker "might be causing friction" is half right. The
list is not the friction — it is **under-used**. It is presented as a convenience
for a guest who lost their link, when in fact it is the necessary first step for
three of the four arrivals.

Because **every staff question is meaningless without a party.** "Ask to help"
needs one. "Open the bar" needs one. "Watch tonight" needs one. That is exactly
why the current gate cannot name what it is asking about: it inherited the party
from device storage instead of being given one. So:

> **Pick the party, then pick the door. The only thing that is not party-scoped is
> signing in.**

### 6.1 Three named doors, in the words people use about themselves

`/` keeps the list exactly as it is — guests lose nothing. It gains one labelled
line beneath it, and the naked key goes:

```
  What's on tonight
  [ Sam's Saturday        Join → ]
  [ Priya's housewarming  Join → ]
  [ Ana's birthday        Join → ]

  Pouring tonight?  Tap your party above, then "I'm pouring here".
  Hosting?          [ Host sign-in ]
```

Three doors, each named the way the person would name themselves — "Join",
"pouring", "hosting" — instead of one door and an icon.

### 6.2 The party's own door

Tapping a party still goes straight to the menu; the 95% case gains no taps. What
changes is that the staff entrance lives **on the party**, named, instead of being
an unlabelled 🍸 in the corner of a guest's screen:

- **`/e/[id]/bar`** — "I'm pouring here", which knows the party from its own path
  and can therefore say **"Helping at Ana's birthday?"**. This is D11 fixed by
  the same change as D1.
- A guest never needs it, so it stops being a top-level icon on their menu and
  becomes a labelled row at the foot of it.

### 6.3 One `<Gate>`, and it never redirects

Replace the three hand-rolled `onMount` guards with one component that takes the
capability and scope it needs — the same `can(actor, cap, scope)` the server asks,
so a screen that renders is a screen the endpoints honour:

- **Satisfied** → render the page.
- **No account, and one is needed** → sign in _in place_, keeping the URL, then
  continue to where they were going. Fixes D13.
- **Account, but no standing at this party** → the party's own door, named:
  "Open the bar at Ana's birthday", or "Ask <host> to wave you in".

Never `goto('/')`. A refusal that throws away the destination is the reason a
deep link cannot work today.

### 6.4 Copy that stops conflating the two

- Sign-in drawer: "For hosts and whoever is running the bar" →
  **"For hosts and admins."** plus a line pointing helpers back to their party:
  "Helping behind the bar tonight? Open your party's link and tap 'I'm pouring
  here' — you don't need an account."
- Registration: "Set up your account" → **"Set up a host account"**. It is a host
  account; saying so is the whole fix.
- `StaffGate`'s "I work here" should sign in **without leaving the party**, then
  open the bar — which is what the gate already does for an account holder
  (`mode === 'open'`). Today it navigates away and never comes back.

### 6.5 And let a signed-in person see the door

Drop the automatic bounce off `/` (D12). Signed in, the front door shows the same
party list plus a line saying where you belong — "You're hosting Ana's birthday →"
— rather than refusing to be looked at.

## 7. Sequence

Seven steps, each shippable on its own, most valuable first. 1–4 were the first
pass; 5–7 come from the second.

1. ✅ **`/bar/[id]`.** Fixes D1 and D11. New route; `Bartender` and `StaffGate`
   take the id as a prop instead of reading storage; `enterBar` and the menu's
   link gain the id; bare `/bar` is a picker of the bars this actor may work,
   built from the same `can()` the server uses.
2. ✅ **Copy.** D9, D10 and the "I work here" destination. The sign-in sheet is
   now one shared component (`SignInSheet`) that the bar's gate raises **in
   place**, so signing in no longer means leaving the party. Registering is
   offered only where it means something — the front door — and says "host
   account" when it does. The guest menu's unlabelled 🍸 became a named
   "I'm pouring here" at the foot of the list.

   One thing this exposed and closed on the way: an account holder standing at
   somebody else's bar had exactly one button, and the server's deliberate 404
   surfaced raw as "NOT FOUND". `openBar`'s refusal now falls through to the
   ask-to-help form, so a host helping at a friend's party has a second move.

3. **The shell.** One component, the three-slot grammar, sign out into Settings.
   Fixes D3 and D4 across all seven pages at once.
4. **The front door's three doors.** D8, and drop the bounce (D12).
5. **One `<Gate>`.** D13 — and it is only buildable once the party is in the path,
   because a gate that cannot name its party can only say "sign in".
6. **Admin routes.** `/admin/hosts`, `/admin/p/[id]`, `/admin/h/[id]`. Fixes D2.
7. **The rest.** `/e/[id]/choose` (D7); link or delete the 3D menu (D5); scope the
   basket to a party (D6).
