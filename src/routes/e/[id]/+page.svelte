<script lang="ts">
  /**
   * The menu: pick drinks, build a round, send it. **This is a party's page**, at
   * `/e/<id>` — the URL behind the QR code on the kitchen table.
   *
   * It used to live at `/`, with `/e/<id>` bouncing to it after stashing the id.
   * That made the menu's address name no party, which was survivable while only one
   * ever ran and is not now: a bookmarked or forwarded link has to keep working, and
   * `/` belongs to the front door.
   *
   * ## Three doors
   *
   * The list is now **generated from the host's cupboard** — up to 270 recipes rather
   * than a curated six — so "here is the menu, scroll it" stopped being a design. A
   * guest arrives at one of three:
   *
   * - **the short list**, what this party leads with, and the default;
   * - **everything**, grouped by base spirit and searchable, for someone who knows
   *   what they want;
   * - **help me choose**, the walk, for someone who doesn't.
   *
   * A party that curated nothing lands on everything, because an empty short list
   * means "we didn't pick favourites", not "there is no menu".
   *
   * The shell (appbar, tabbar) lives here rather than in the layout because the bar
   * is a full-screen view of its own — putting the chrome in the layout would only
   * mean hiding it again on /bar.
   */
  import { goto } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { DRINKS, type Drink } from '$lib/data';
  import { eventMenu, joinParty, type EventMenu, type MenuItem } from '$lib/api';
  import { emojiFor, groupByBase } from '$lib/menu';
  import { getDeviceId, getSavedName, saveName } from '$lib/device';

  import { addLine, basketCount, rebaseTo } from '$lib/stores/basket.svelte';
  import { favourites } from '$lib/stores/favourites.svelte';
  import { applyDeepLink, settings, view } from '$lib/stores/view.svelte';
  import { staffRequest } from '$lib/stores/staffRequest.svelte';
  import { celebrate as fireConfetti, startBackgroundCannon } from '$lib/confetti';
  import { lockBackground } from '$lib/dialog';
  import AppBar from '$lib/components/AppBar.svelte';
  import Configurator from '$lib/components/Configurator.svelte';
  import InstallButton from '$lib/components/InstallButton.svelte';
  import OrderRail from '$lib/components/OrderRail.svelte';
  import SentCelebration from '$lib/components/SentCelebration.svelte';

  /** From `+page.ts`: the party this page *is*, rather than the one this device recalls. */
  let { data }: { data: { eventId: string } } = $props();

  /**
   * The party-popper cannon, which used to live in the layout and therefore rained
   * emoji over every form in the app. It belongs here: this screen is a wall of
   * opaque cards, which is exactly what it was designed to sit behind.
   */
  let cannon = $state<HTMLCanvasElement>();
  $effect(() => {
    if (cannon) return startBackgroundCannon(cannon);
  });

  let selected = $state<Drink | null>(null);
  let celebrating = $state(false);
  let orderOpen = $derived(view.order);
  let favesOnly = $derived(view.favesOnly);
  let count = $derived(basketCount());

  /**
   * The menu, generated server-side from the host's cupboard.
   *
   * **Fails open on purpose**, exactly as the old availability map did: a failed
   * request leaves `menu` null and falls back to the six house drinks, because a menu
   * that silently empties because the network hiccuped is indistinguishable from a
   * broken app. Erring towards offering costs someone a "sorry, we're out"; erring
   * the other way costs a drink nobody knew they could have had.
   */
  let menu = $state<EventMenu | null>(null);

  /**
   * Arriving at a party: say who you are, once.
   *
   * The name was already asked for on every round, at the bottom of the order rail.
   * Asking on the way in instead means sending a round is one tap afterwards, and it
   * gives the bar a name to put against the face it is being asked to admit — "2×
   * Negroni" is not something you can make a decision about.
   *
   * **Somebody we already know is joined silently.** A returning guest, or one
   * arriving at their second party of the year, has a name saved on this device;
   * stopping them to retype it would be a toll for having been here before.
   *
   * The join itself never reports anything back (see `joinParty`), so there is
   * nothing here that could tell a guest they are waiting to be let in.
   */
  let askingName = $state(false);
  let nameInput = $state('');
  let joining = $state(false);

  async function join(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    joining = true;
    try {
      saveName(trimmed);
      await joinParty(data.eventId, trimmed, getDeviceId());
    } catch {
      // Offline, or a party that has gone. Never a dead end: the order they
      // eventually send creates the guest row anyway, from the same name.
    } finally {
      joining = false;
      askingName = false;
    }
  }

  const HOUSE: MenuItem[] = DRINKS.map((d) => ({
    id: d.name,
    name: d.name,
    base: d.spirits[0] ?? '',
  }));

  const items = $derived(menu?.items ?? HOUSE);
  const stock = $derived(menu?.stock ?? []);

  /**
   * Whether the bar is taking orders, and what to say when it isn't.
   *
   * Only a live party does — `POST /api/orders` answers 409 otherwise. Saying so up
   * here rather than only at send time is the difference between "the bar isn't open"
   * and choosing three drinks, typing your name, and *then* being told none of it
   * counted.
   *
   * Defaults to open while the menu is loading and if the request fails, for the same
   * reason the menu itself fails open: a guest wrongly told the bar is shut goes and
   * finds something else to do.
   */
  const closed = $derived(
    menu
      ? menu.event.status === 'done'
        ? 'closed'
        : menu.event.status === 'draft'
          ? 'soon'
          : null
      : null,
  );

  /**
   * **The menu.** The cupboard is what the host *has*; the short list is what the bar
   * is prepared to make, and that is what a guest may order.
   *
   * There used to be a `Show everything` door beside this one, and it was a mistake:
   * a guest could order round the curation, which made curating pointless. Whatever
   * somebody deliberately left off the list is off it.
   *
   * **No short list still means everything**, which is not the same hole. That is the
   * cupboard's rule again — never asked is not answered no — so a party nobody has
   * curated works rather than serving an empty menu. Curation is what *narrows*.
   */
  const onOffer = $derived.by(() => {
    const list = menu?.shortList ?? [];
    if (list.length === 0) return items;
    const byId = new Map(items.map((i) => [i.id, i]));
    return list.flatMap((id) => {
      const found = byId.get(id);
      return found ? [found] : [];
    });
  });

  let query = $state('');

  /**
   * Grouped by base spirit and searchable — worth it once a party offers more than a
   * screenful, and harmless when it doesn't.
   */
  const grouped = $derived(groupByBase(onOffer, query));
  /** Only worth the search box and the headings when there is something to sort. */
  const manyDrinks = $derived(onOffer.length > 12);

  onMount(() => {
    // Notifications sent before the bar became a route still carry `/?bartender`.
    if (new URLSearchParams(location.search).has('bartender')) {
      void goto(`/bar/${data.eventId}`, { replaceState: true });
      return;
    }
    applyDeepLink(location.search);

    // A round belongs to the bar it was built for. Walking from one party's menu to
    // another used to carry the basket across — a Gimlet from Ana's birthday turning
    // up on Sam's Saturday, which may not be able to make it.
    rebaseTo(data.eventId);

    // Known already → join quietly. Never met → ask, once, before the menu.
    const known = getSavedName();
    if (known) void join(known);
    else askingName = true;

    // Deliberately not awaited: the house list renders immediately and is replaced
    // when the real one lands, rather than the whole page waiting on a request to
    // show anything at all.
    void eventMenu(data.eventId)
      .then((r) => (menu = r))
      .catch(() => {
        /* offline, or a party that's been deleted — offer the house list */
      });
  });

  // The mobile order sheet spans two siblings — the rail and its click-to-dismiss
  // backdrop — and both must stay interactive while the rest goes inert.
  let orderRail = $state<HTMLElement>();
  let orderBackdrop = $state<HTMLElement>();

  // On mobile the order sheet is a modal: focus it + make the menu behind inert.
  // (On desktop it's a persistent rail, so we skip.)
  $effect(() => {
    if (!orderOpen) return;
    if (window.matchMedia('(min-width: 900px)').matches) return;
    const release = lockBackground(orderRail, orderBackdrop);
    const prev = document.activeElement as HTMLElement | null;
    queueMicrotask(() => document.getElementById('name')?.focus());
    return () => {
      release();
      prev?.focus?.();
    };
  });

  /** Only ever suggests something the bar can actually pour, and only when it's open. */
  function surprise() {
    if (closed) return;
    if (onOffer.length === 0) return;
    choose(onOffer[Math.floor(Math.random() * onOffer.length)]!);
  }

  /**
   * Which card just went in, so it can say so.
   *
   * Adding a drink changed a small number in the corner and nothing else, which is
   * easy to miss on a phone held at arm's length in a kitchen. `neo.css` already had
   * the answer — `.cocktail.just-picked` glows and `.order.added` flips the button to
   * the accent — and the phase 5 rewrite of this page simply stopped using both.
   *
   * Cleared on a timer rather than on the next click, so adding the same drink twice
   * flashes twice instead of looking like nothing happened the second time.
   */
  let justPicked = $state<string | null>(null);
  let pickedTimer: ReturnType<typeof setTimeout> | undefined;
  function flash(id: string) {
    clearTimeout(pickedTimer);
    justPicked = null;
    // A frame apart, or re-adding the same drink re-renders with the class already
    // present and the animation never restarts.
    requestAnimationFrame(() => {
      justPicked = id;
      pickedTimer = setTimeout(() => (justPicked = null), 1100);
    });
  }
  onDestroy(() => clearTimeout(pickedTimer));

  /**
   * Add a drink to the round.
   *
   * The six house drinks have options — ice, garnish, how strong — so they open the
   * configurator. A generated recipe has none, so it goes straight in: inventing a
   * sheet with nothing on it just to be consistent would be one more tap for nothing.
   */
  function choose(item: MenuItem) {
    const configurable = DRINKS.find((d) => d.name === item.name);
    if (configurable) {
      selected = configurable;
      // The flash comes when the sheet's own "Add to order" fires, not now — this
      // tap only opened a dialog, and saying "added" would be a lie for the second
      // or two before they confirm.
      return;
    }
    addLine(item.name);
    flash(item.id);
  }

  function toggleFav(name: string) {
    favourites.toggle(name);
    if (favourites.size === 0) view.favesOnly = false;
  }

  function onSent() {
    view.order = false;
    celebrating = true;
    fireConfetti();
  }
</script>

<svelte:head><title>COCKTAILS!!!</title></svelte:head>

<svelte:window
  onkeydown={(e) => {
    if (e.key !== 'Escape') return;
    if (celebrating) celebrating = false;
    else if (orderOpen) view.order = false;
  }}
/>

<canvas class="bg-cannon" bind:this={cannon} aria-hidden="true"></canvas>

<div class="app">
  <!--
    A guest arrived here from a QR code on a table, so there is nothing above this to
    go up to — the brand takes the left slot, and the corner is Settings, as
    everywhere else.

    The cocktail glass that used to live here is at the foot of the menu now. It was
    an unlabelled emoji leading to a staff sign-up flow: permanent for the ~95% who
    will never want it, and unrecognisable as "the way in" to the few who do.
  -->
  <AppBar brand />

  <main class="stage">
    <section class="view view-menu" aria-label="Menu">
      <!-- Inside the scrolling view, not a child of `.app`: the shell is a
           three-row grid (appbar / stage / tabbar) and a fourth child steals the
           flexible row, which collapsed the menu to nothing. -->
      {#if staffRequest.active}
        <!-- The answer to "am I in yet?" must be reachable without opening the bar:
             someone who navigated away shouldn't have to go hunting for it. -->
        <a class="ask-banner ask-{staffRequest.kind}" href="/bar/{data.eventId}">
          {#if staffRequest.kind === 'pending'}
            ⏳ Waiting for the host to approve <strong>{staffRequest.name}</strong>…
          {:else}
            ✕ Bar request declined — tap for options
          {/if}
        </a>
      {/if}

      {#if askingName}
        <!-- Before the menu rather than over it: this is arriving at a party, not a
             dialog interrupting one. Nothing here mentions being approved — the bar
             may not have let them in yet, and they must not be able to tell. -->
        <section class="panel arrive">
          <h2>Who's this?</h2>
          <p>So the bar knows whose drink is whose.</p>
          <form
            onsubmit={(e) => {
              e.preventDefault();
              void join(nameInput);
            }}
          >
            <label class="field">
              Your name
              <input
                bind:value={nameInput}
                placeholder="DANIEL"
                autocomplete="name"
                autocapitalize="words"
                maxlength="40"
              />
            </label>
            <button class="btn btn-go" type="submit" disabled={joining || !nameInput.trim()}>
              {joining ? 'One moment…' : "I'm in"}
            </button>
          </form>
        </section>
      {/if}

      {#if closed}
        <!-- Said once, at the top, and the menu stays readable underneath: knowing
             what they *would* have been able to order is the friendly half of being
             told the bar is shut. -->
        <p class="ask-banner ask-declined">
          {closed === 'closed'
            ? '🌙 The bar has closed — no more orders tonight.'
            : "⏳ This party isn't open yet. Have a look at the menu; the bar will start taking orders shortly."}
        </p>
      {/if}

      {#if askingName}
        <!-- nothing else while we ask; the menu is one tap away -->
      {:else}
        <div class="menubar">
          {#if favourites.size}
            <button
              type="button"
              class="chip chip-fav"
              aria-pressed={favesOnly}
              onclick={() => (view.favesOnly = !favesOnly)}>⭐ Faves</button
            >
          {/if}
          <!-- A route now, not a `door` flag — so Back leaves it, it can be linked
               to, and it survives a reload. -->
          <a class="chip" href="/e/{data.eventId}/choose">🤔 Help me choose</a>
          <button type="button" class="chip chip-surprise" disabled={!!closed} onclick={surprise}>
            🎲 Surprise
          </button>
          <InstallButton />
        </div>

        <!-- One menu: what the bar is prepared to make. The search box and the base
             headings only appear once there is enough to need them — on a party
             offering eight drinks they would be furniture. -->
        {#if manyDrinks}
          <input
            class="askbar-input menu-search"
            type="search"
            placeholder="Search {onOffer.length} drinks…"
            bind:value={query}
            aria-label="Search the menu"
          />
          {#each grouped as group (group.base)}
            <h2 class="menu-heading">{group.base}</h2>
            <!-- Filtering is neo.css's job (.menu.faves-only hides non-favourites),
                 so the class drives it rather than a filtered list. -->
            <div class="menu" class:faves-only={favesOnly}>
              {#each group.list as item (item.id)}
                {@render card(item)}
              {/each}
            </div>
          {/each}
          {#if grouped.length === 0}
            <p class="menu-empty">Nothing matches “{query}”.</p>
          {/if}
        {:else}
          <div class="menu" class:faves-only={favesOnly}>
            {#each onOffer as item (item.id)}
              {@render card(item)}
            {/each}
          </div>
          {#if onOffer.length === 0}
            <p class="menu-empty">
              The bar hasn't got anything on tonight — ask whoever's pouring.
            </p>
          {/if}
        {/if}

        <!--
          The staff door, named, and at the bottom where it belongs.

          This is the only route into the bar for someone with no account, and until
          now it was an unlabelled 🍸 in the appbar — so the people who needed it
          couldn't find it and the people who didn't kept finding it. It carries the
          party in its href, which is what lets the gate on the other side say *which*
          bar it is about.
        -->
        <div class="menu-foot">
          <!--
            **The 3D menu had nothing linking to it.** A grep for it across `src/`
            returned only its own two files: a whole feature reachable solely by
            typing the URL. It links *out* to this page and always did, which is the
            shape of a door that was fitted the wrong way round.
          -->
          <a class="menu-staff menu-staff-quiet" href="/e/{data.eventId}/3d">
            <span class="emoji" aria-hidden="true">🧊</span>
            See it in 3D
          </a>
          <a class="menu-staff" href="/bar/{data.eventId}">
            <span class="emoji" aria-hidden="true">🍸</span>
            I'm pouring here
          </a>
        </div>
      {/if}
    </section>
  </main>

  <nav class="tabbar" aria-label="Main navigation">
    <div class="tab" aria-current="true"><span class="emoji">🍸</span><span>Menu</span></div>
    <button type="button" class="tab tab-order" onclick={() => (view.order = true)}>
      <span class="emoji">🧺</span><span>Order</span>
      {#if count}<b class="tab-badge">{count}</b>{/if}
    </button>
  </nav>
</div>

{#snippet card(item: MenuItem)}
  <!-- Nothing is drawn as unavailable on stock grounds any more: the list *is* what's
       pourable, so a greyed-out card would be a drink the host can't make and never
       claimed to. A shut bar is different — that is about the party, not the drink,
       and it applies to every card at once. -->
  {@const added = justPicked === item.id}
  <article
    class="cocktail"
    class:is-fav={favourites.has(item.name)}
    class:is-out={!!closed}
    class:just-picked={added}
  >
    <button
      type="button"
      class="fav"
      aria-pressed={favourites.has(item.name)}
      onclick={() => toggleFav(item.name)}
      aria-label="Toggle favourite"
    >
      {favourites.has(item.name) ? '⭐' : '☆'}
    </button>
    <h3><span class="emoji">{emojiFor(item)}</span> {item.name}</h3>
    <!-- `just-picked` and `added` are both neo.css's, and both were sitting unused:
         the card glows and the button flips to the accent for a beat. A number in
         the corner going from 1 to 2 is not enough to notice on a phone held at
         arm's length in somebody's kitchen. -->
    <button
      type="button"
      class="order"
      class:added
      disabled={!!closed}
      onclick={() => choose(item)}
    >
      {#if added}✓ Added{:else if closed === 'closed'}Bar closed{:else if closed}Not yet{:else}Add
        to order{/if}
    </button>
  </article>
{/snippet}

<OrderRail
  open={orderOpen}
  onclose={() => (view.order = false)}
  onsent={onSent}
  bind:rail={orderRail}
/>
<div
  class="order-backdrop"
  class:open={orderOpen}
  bind:this={orderBackdrop}
  onclick={() => (view.order = false)}
  onkeydown={(e) => e.key === 'Escape' && (view.order = false)}
  role="button"
  tabindex="-1"
  aria-label="Close order"
></div>

{#if selected}
  <!-- Keyed by drink: picking a different drink must start from that drink's own
       defaults, so we want a fresh component rather than a reused one carrying
       the previous selections. Configurator relies on this. -->
  {#key selected.name}
    <Configurator drink={selected} onadd={(n) => addLine(n)} onclose={() => (selected = null)} />
  {/key}
{/if}
{#if celebrating}
  <SentCelebration onclose={() => (celebrating = false)} />
{/if}
