# Every word the app says, and what is wrong with some of them

_Reviewed 1 Aug 2026 against `701c2cb`. 432 strings extracted from `src/`, comments
stripped, then read. The inventory is at the bottom; the findings come first
because that is the part worth acting on._

## The findings

Ordered by how wrong they are, not by how easy they are to change.

### 1. The app thinks every party is in the evening

**Fourteen strings and one emoji assume night.** A christening lunch, a birthday
BBQ, a Sunday afternoon in a garden — all of them get told:

| Where             | Says                                                    |
| ----------------- | ------------------------------------------------------- |
| `/`               | **What's on tonight** (the page's `h1`)                 |
| `/`               | **Pouring tonight?**                                    |
| `/bar`            | **Helping out tonight?**                                |
| `/bar`            | "…or pick it from **what's on tonight**"                |
| `/bar`, `Gate`    | **What's on tonight** (button, twice)                   |
| `/e/<id>`         | 🌙 The bar has closed — **no more orders tonight**      |
| `/e/<id>`, `/3d`  | The bar hasn't got anything on **tonight**              |
| `ChooseADrink`    | "Only the ones **tonight**…"                            |
| `ChooseADrink`    | Nothing is pourable **tonight**                         |
| `SentCelebration` | Notifications aren't switched on at the bar **tonight** |
| `SignInSheet`     | Helping behind the bar **tonight**?                     |
| `StaffGate`       | If you're just helping out **tonight**…                 |

The **🌙** on the closed-bar banner is the same mistake in a picture: a moon over a
bar that shut at four in the afternoon.

None of it is load-bearing. "What's on tonight" → **"What's on"**. "Pouring
tonight?" → **"Pouring at one of these?"**. The moon → **⛔** or nothing.

### 2. A sentence on the guest's menu is not a sentence

`ChooseADrink.svelte:138`, the first thing anybody reading "Help me choose" sees:

> Start with a spirit. **Only the ones tonight can actually pour are here.**

There is no subject. It was presumably meant as "only the ones the bar can
actually pour tonight", and the words got shuffled. It has been shipped and
nobody caught it, which is the argument for reading copy out of context like this.

→ **"Only what the bar can actually make is here."**

### 3. "bottles" for things that are not bottles

Four places count the cupboard in bottles:

- `Cupboard` — "61 drinks from **30 bottles**"
- `Cupboard` — the **"One more bottle"** panel
- `/host` — "30 **bottles** in · pours 61 drinks"
- `/admin/p/<id>` — "30 **bottles** · pours 61 drinks"

The list holds mint, cucumber, fresh chilli, salt, black pepper, egg white, sugar
cubes, olives, lemon twists and a salt rim. Owain's own 29 include mint, lemons,
limes, oranges and espresso.

→ **"30 things in"**, which fits the heading already above it ("What you've got
in"). "One more bottle" → **"Worth buying next"**, which is what that panel
answers.

### 4. The notification opt-in tells a bartender something false

`NotifyOptIn` is mounted in the root layout, so it can appear on **any** screen,
including the bar. Its only line of copy:

> Only about your own order. You can change this any time in Settings.

`pushToRole('bartender', newOrderPush(order))` sends a **🔔 New order** push for
everybody's drinks. So the sentence that sets the expectation is false for exactly
the person who will receive the most notifications. It gets worse rather than
better with time: accepting as a guest and _then_ working the bar triggers
`enableIfPermitted('bartender')`, so the promise breaks later even where it was
true when read.

→ Cover both: **"When your drink's ready — and every order, if you end up behind
the bar."**

### 5. "Open the bar" means two different things

| Where           | "Open the bar" does                           |
| --------------- | --------------------------------------------- |
| `/admin/p/<id>` | makes the party **live**, so guests can order |
| `StaffGate`     | takes **you** a shift on this device          |

And on `/admin` the first of those is just **"Open"**. Same words, different acts —
the same failure the app bar had when one corner meant six things.

→ The party one becomes **"Start taking orders"**; the shift one stays "Open the
bar".

### 6. Internal jargon on host-facing screens

- **"the house six"** (`/host`, `/admin/h/<id>`) — our name for the six hard-coded
  fallback drinks. A host cannot know that. → "a short standard menu".
- **"pourable"** (`ChooseADrink`, `ShortList`) — our word, and one of the two is on
  a guest's screen. → "what the bar can make".
- **"Feature nothing"** (`ShortList`) — "feature" is our verb for the short list.

### 7. Four names for one idea, three for another

The short list is called:

- **What it leads with** (`/admin/p/<id>`)
- **What to lead with** (`/host/<id>`)
- **What that pours** (`Cupboard`, for the count it produces)
- and every button under them says **Choose drinks**

"Leads with" is opaque anyway. Dan's own words for it were "the cocktails the bar
is prepared to make". → **"What the bar will make"** everywhere.

Opening the cupboard is **"Fill it in"**, **"Change it"**, **"Look at it"** and
**"Fill it in for them"** depending on screen and state. Two of those are worth
keeping (empty vs filled); four is drift.

### 8. Two names for one subscription

**"New-order alerts"** in the bar's ⋯ menu; **"Notifications"** in Settings. One
switch, two names, and the bar's own menu is where a bartender is most likely to
go looking.

### 9. Smaller

- **"Your drinks are on the way. 🍹"** after sending — it has been _sent_, not
  started, and it may be one drink. → "Sent to the bar."
- **"DANIEL"** as the name placeholder, in three inputs. It is Dan's own name, shown
  to every guest. → "Your name" or a neutral example.
- **"No ice! Extra lime! Make it spicy!"** as the note placeholder — three
  exclamation marks reads as shouting the instruction rather than exampling it.
- **"Back to the menu"** in the walk now sits under a "← Menu" up-link that does the
  same job in different words.
- **"Helping out tonight?"** (`/bar`) vs **"Pouring at <party>?"** (`StaffGate`) —
  same question, two openings, one of which also has the "tonight" problem.

## What is genuinely good, and should not be touched

Worth writing down so a later pass doesn't "fix" it:

- **"Garnishes don't count against a drink — a missing olive shouldn't hide a
  Martini."** Explains a real rule in one line, in the reader's terms.
- **"So the bar knows whose drink is whose."** Says why it wants your name.
- **"Their list — you can look, not change it."**
- **"End my shift"** vs **"Sign out"** — two different acts, correctly named apart.
- **"Not your door"** and **"Sign in to see this"** — refusals that say which of the
  two problems you have.
- **"When there is, it'll be here. At a party already? Open the link or QR code your
  host gave you."** An empty state that gives you something to do.

---

# The inventory

Every user-facing string, by screen. Ingredient names, HTTP headers, font names and
SQL fragments are left out; so are strings my extraction clipped mid-apostrophe.

## Screens

### The front door — /

_`src/routes/+page.svelte`_

- Check your email
- Different account
- Email confirmed — you're all set.
- Hosting?
- I'm pouring here
- Join →
- Nothing arrived? It can take a minute, and it may be in spam.
- Nothing on right now
- One moment…
- Pouring tonight?
- Send it again
- Sent again — check your inbox.
- Sign in to your host account →
- Sign out
- Tap your party above, then
- Tap yours and start ordering
- That did not work.
- This account is closed
- We sent a link to
- What's on tonight
- When there is, it'll be here. At a party already? Open the link or QR code your host gave you — it goes straight to their menu.
- You're signed in
- Your details are right, but the account has been suspended. Get in touch if you think that's a mistake.

### A guest's menu — /e/<id>

_`src/routes/e/[id]/+page.svelte`_

- Close order
- I'm pouring here
- Main navigation
- Menu
- One moment…
- Order
- Search the menu
- Search {onOffer.length} drinks…
- See it in 3D
- So the bar knows whose drink is whose.
- The bar hasn't got anything on tonight — ask whoever's pouring.
- The party
- Toggle favourite
- Who's this?
- Your name

### Help me choose — /e/<id>/choose

_`src/routes/e/[id]/choose/+page.svelte`_

- Help me choose
- Help me choose · COCKTAILS!!!

### The 3D menu — /e/<id>/3d

_`src/routes/e/[id]/3d/+page.svelte`_

- Close order
- Here's the normal one →
- I'm in
- Main navigation
- Menu
- Order
- Pouring…
- So the bar knows whose drink is whose.
- The bar hasn't got anything on tonight.
- This phone can't do the 3D menu.
- Who's this?
- Your name

### Which bar? — /bar

_`src/routes/bar/+page.svelte`_

- Bars you can work
- Helping out tonight?
- I'm pouring here
- Not open yet
- One moment…
- Open the link or QR code for the party you're pouring at, and you can ask to help from its menu. Or pick it from what's on tonight.
- Taking orders
- The bar you were last at can wave you in — no account needed.
- Watch
- What's on tonight
- Which bar? · COCKTAILS!!!
- Which party?
- Whoever's behind the bar works the queue. Here's yours to watch.
- Work it
- You're hosting, not pouring
- 🍸 Which bar?

### The bar — /bar/<id>

_`src/routes/bar/[id]/+page.svelte`_

- Bar · COCKTAILS!!!
- The party

### A host's own area — /host

_`src/routes/host/+page.svelte`_

- A host
- Change it
- Fill it in
- Guest link
- Guest link copied.
- Have a drink
- None yet — Dan sets those up. Your cupboard is ready whenever he does.
- Nothing recorded yet — your guests see the house six.
- One moment…
- Tick what's actually in the house and we'll work out what the bar can pour. It's optional — leave it and your guests just see everything.
- Watch
- What you
- What you've got in
- Your bar · COCKTAILS!!!
- Your parties
- 🍸 Your bar

### A host watching — /host/<id>

_`src/routes/host/[id]/+page.svelte`_

- Choose drinks
- Copy the link
- Guest link copied.
- No orders yet. They will show up here as your guests order.
- Nothing waiting — the bar is keeping up.
- One moment…
- Open the menu
- Pick a handful of favourites, or leave it and guests see everything.
- Poured so far
- Put this under a QR code on the table, or send it round.
- Reconnecting…
- This party
- What to lead with
- What's happening
- Your guests' link
- Your party

### The desk, parties — /admin

_`src/routes/admin/+page.svelte`_

- Admin · COCKTAILS!!!
- Create it
- Hosts
- New party
- No parties yet. Make one below.
- Not open yet
- One moment…
- Parties
- Pick a host…
- Pick whose party it is.
- Saturday at theirs
- Sections
- The admin desk
- What's it called
- When (optional)
- Whose is it
- 🍸 Admin

### The desk, hosts — /admin/hosts

_`src/routes/admin/hosts/+page.svelte`_

- Hosts
- Hosts · COCKTAILS!!!
- Name or email…
- Nobody has registered yet.
- Nobody matches “${filter}”.
- One moment…
- Parties
- Search
- Sections
- The admin desk

### One party — /admin/p/<id>

_`src/routes/admin/p/[id]/+page.svelte`_

- Back to the parties
- Change it
- Choose drinks
- Close the bar
- Copy the link
- Couldn't count it.
- Counting…
- Delete ${party.name}? The orders go with it.
- Delete this party
- Deleting this party takes its orders with it. The cupboard is untouched.
- Fill it in
- Getting rid of it
- Guest link copied.
- Guests can order.
- It may have been deleted.
- No such party
- Nothing recorded — the menu falls back to the house six.
- One moment…
- Open the bar
- Open the menu
- Put this under a QR code on the table, or send it round.
- Shared across their parties
- The bar
- The bar has closed.
- Their account
- Their cupboard, shared across every party they throw — not just this one.
- Their guests' link
- This party
- What it leads with
- What {host.name} has in
- Whose party it is
- Work it

### One host — /admin/h/<id>

_`src/routes/admin/h/[id]/+page.svelte`_

- Admin by configuration — edit ADMIN_EMAILS to change
- Back to the hosts
- Create it
- Delete ${host.name}? Their parties go too. The orders go with them.
- Delete this account
- Fill it in for them
- Look at it
- Make admin
- No parties yet.
- No such host
- One moment…
- Reinstate
- Remove admin
- Saturday at theirs
- Saved ${host?.name}
- Suspend
- The account
- The admin desk
- Their cupboard
- Their parties
- They haven't opened it yet — the menu falls back to the house six.
- They may have been deleted.
- They've said what they have in.
- What's it called
- When (optional)
- Why? (they will not see this)

## Shared components

### AppBar

_`src/lib/components/AppBar.svelte`_

- Settings

### BarMenu

_`src/lib/components/BarMenu.svelte`_

- Bar options
- Bar staff
- Clear finished orders
- Close
- End my shift
- New-order alerts
- Newest first
- Oldest first
- Sort by

### Bartender

_`src/lib/components/Bartender.svelte`_

- Active
- Bar options
- Bar options — ${pendingCount} staff waiting
- Enabling…
- Filter orders
- Loading…
- No ${filter} orders.
- Nothing waiting.
- Reconnecting…
- Settings

### ChooseADrink

_`src/lib/components/ChooseADrink.svelte`_

- Add it to my round
- Any of these:
- Back to the menu
- Let's find you one
- No thanks
- Nothing is pourable tonight — ask whoever's behind the bar.
- Nothing matches that combination.
- Start again
- Start with a spirit. Only the ones tonight can actually pour are here.
- The bar is not taking orders

### Configurator

_`src/lib/components/Configurator.svelte`_

- Add to order
- Close
- Customise ${drink.name}

### Cupboard

_`src/lib/components/Cupboard.svelte`_

- Everything
- Garnishes don't count against a drink — a missing olive shouldn't hide a Martini.
- Gin, lime, tonic…
- In stock
- Loading…
- One more bottle
- Search
- Shelves
- Their list — you can look, not change it.
- Tick a spirit and something to mix it with.
- Undo
- What that pours

### Gate

_`src/lib/components/Gate.svelte`_

- Not your door
- One moment…
- Sign in
- Sign in to see this
- What's on tonight

### InstallButton

_`src/lib/components/InstallButton.svelte`_

- Add to Home Screen
- Got it
- How to install
- In Safari, tap
- Install Cocktails 🍸
- Share

### Keypad

_`src/lib/components/Keypad.svelte`_

- Checking…
- Delete last digit

### NotifyOptIn

_`src/lib/components/NotifyOptIn.svelte`_

- Not now
- On iPhone that needs the app on your Home Screen first — then we can let you know without you watching the screen.
- Only about your own order. You can change this any time in Settings.
- Setting up…
- Yes, notify me

### OrderCard

_`src/lib/components/OrderCard.svelte`_

- Bumped to the front
- Delete this order
- Guest was {HANDOFF_META[order.handoff].note}
- Has a note
- Let {order.name} in
- One fewer {item.name} poured
- One more {item.name} poured
- Poured
- Ready — and tell them how
- Show more options
- Turn away {order.name}
- Turn {order.name} away
- Undo — back to {STATUS_META[meta.prev].label}

### OrderRail

_`src/lib/components/OrderRail.svelte`_

- Add something first
- Clear all
- Close order
- Less
- More
- No ice! Extra lime! Make it spicy!
- Note (optional)
- Nothing yet.
- Ordering as
- Send order
- Tap a drink to start your round.
- Your order

### PartyRow

_`src/lib/components/PartyRow.svelte`_

- Open
- Work it

### SentCelebration

_`src/lib/components/SentCelebration.svelte`_

- Cheers! 🥂
- Enabling…
- Notifications are blocked — enable them in your browser settings.
- Notifications aren't switched on at the bar tonight.
- Order sent
- Start another 🍸
- Your drinks are

### SettingsSheet

_`src/lib/components/SettingsSheet.svelte`_

- Close
- Notifications
- Notifications aren’t set up on the bar’s server.
- Settings
- Sign out
- Signed in as
- This browser can’t do notifications.
- Turn this on to hear when your drink is ready.
- Your browser is blocking notifications for this site. We can’t re-ask from here — you’ll need to allow them in your browser’s site settings.
- You’ll hear when your drink is being made and when it’s ready.

### ShortList

_`src/lib/components/ShortList.svelte`_

- Feature nothing
- Loading…
- Negroni, gin…
- Nothing is pourable — fill in the cupboard.
- Nothing matches “${filter}”.
- Search
- Undo

### SignInSheet

_`src/lib/components/SignInSheet.svelte`_

- Close
- Continue with Google
- Create my account
- Email
- For hosts and admins.
- Helping behind the bar tonight? You don't need an account — open your party's link and tap
- I have an account
- I need an account
- I'm pouring here
- One moment…
- Password
- Set up a host account
- Sign in
- That did not work.
- Welcome back
- Your name

### StaffAdmin

_`src/lib/components/StaffAdmin.svelte`_

- Back to orders
- Bar staff
- Cancel
- Deny {nameOf(person)}
- Helpers
- No helpers yet.
- No one waiting.
- Remove {nameOf(person)}
- Revoke
- Revoke all helpers
- Revoke every helper?
- Yes, revoke all

### StaffGate

_`src/lib/components/StaffGate.svelte`_

- Ask again
- Asked as
- Cancel
- Couldn’t send that request
- Have a word with whoever's pouring, then ask again.
- I already have an account
- One moment…
- Open the bar
- That bar isn’t yours to open.
- They didn't let you in
- Waiting for the bar…
- You're signed in, so this is one tap.
- your name

### UpdateBar

_`src/lib/components/UpdateBar.svelte`_

- Refreshing…
- There's a newer version.

### WorkSheet

_`src/lib/components/WorkSheet.svelte`_

- Done

## Notifications and email

### src/lib/server/accounts.ts

_`src/lib/server/accounts.ts`_

- Choose a new password
- Confirm my email
- Confirm this address to finish setting up your account.
- Confirm your email for cocktails
- If that wasn
- Reset your cocktails password
- Set a new password
- Someone asked to reset the password for this account.
- Then tell us what you

### src/lib/server/email.render.ts

_`src/lib/server/email.render.ts`_

- Button not working? Copy this into your browser:
- COCKTAILS!!! · Dan
- Sent by

### src/lib/server/notify.ts

_`src/lib/server/notify.ts`_

- Bar access declined
- The host approved you — the bar is open on this device.
- The host didn’t approve this request. You can ask again.

### src/lib/stores/session.svelte.ts

_`src/lib/stores/session.svelte.ts`_

- Session expired — sign in again.
