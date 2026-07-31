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
  import { onMount } from 'svelte';
  import { DRINKS, type Drink } from '$lib/data';
  import { eventMenu, type EventMenu, type MenuItem } from '$lib/api';

  import { addLine, basketCount } from '$lib/stores/basket.svelte';
  import { favourites } from '$lib/stores/favourites.svelte';
  import { applyDeepLink, settings, view } from '$lib/stores/view.svelte';
  import { staffRequest } from '$lib/stores/staffRequest.svelte';
  import { celebrate as fireConfetti, startBackgroundCannon } from '$lib/confetti';
  import { lockBackground } from '$lib/dialog';
  import ChooseADrink from '$lib/components/ChooseADrink.svelte';
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

  const HOUSE: MenuItem[] = DRINKS.map((d) => ({
    id: d.name,
    name: d.name,
    base: d.spirits[0] ?? '',
  }));

  const items = $derived(menu?.items ?? HOUSE);
  const stock = $derived(menu?.stock ?? []);

  /**
   * What the party leads with. Curation is optional, so **no short list means show
   * everything** — its absence is a default, not a broken menu.
   */
  const featured = $derived.by(() => {
    const list = menu?.shortList ?? [];
    if (list.length === 0) return items;
    const byId = new Map(items.map((i) => [i.id, i]));
    return list.flatMap((id) => {
      const found = byId.get(id);
      return found ? [found] : [];
    });
  });

  /** Which door is open. `featured` is where everyone starts. */
  let door = $state<'featured' | 'all' | 'walk'>('featured');
  let query = $state('');

  /** `Show everything`, grouped by base spirit so 200 drinks are navigable. */
  const grouped = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const hits = q
      ? items.filter((i) => i.name.toLowerCase().includes(q) || i.base.toLowerCase().includes(q))
      : items;
    const by = new Map<string, MenuItem[]>();
    for (const i of hits) {
      const key = i.base || 'Other';
      (by.get(key) ?? by.set(key, []).get(key)!).push(i);
    }
    return [...by.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([base, list]) => ({ base, list: list.sort((a, b) => a.name.localeCompare(b.name)) }));
  });

  /**
   * A card's emoji. The six house drinks carry their own; the generated 270 don't,
   * and a wall of identical glasses is worse than a wall of none — so the base spirit
   * picks one, which at least groups the cards by eye the way the list groups them by
   * heading.
   */
  const BASE_EMOJI: Record<string, string> = {
    Gin: '🌿',
    Vodka: '❄️',
    Rum: '🏝️',
    Tequila: '🌵',
    Mezcal: '🔥',
    Whiskey: '🥃',
    Whisky: '🥃',
    Bourbon: '🥃',
    Rye: '🥃',
    Scotch: '🥃',
    Brandy: '🍇',
    Cognac: '🍇',
    Champagne: '🍾',
    Prosecco: '🍾',
    Wine: '🍷',
    Beer: '🍺',
    Cachaça: '🇧🇷',
    Pisco: '🍋',
    Absinthe: '🧚',
    Aperol: '🧡',
    Campari: '❤️',
    Vermouth: '🍸',
  };
  const emojiFor = (item: MenuItem): string =>
    DRINKS.find((d) => d.name === item.name)?.emoji ?? BASE_EMOJI[item.base] ?? '🍸';

  onMount(() => {
    // Notifications sent before the bar became a route still carry `/?bartender`.
    if (new URLSearchParams(location.search).has('bartender')) {
      void goto('/bar', { replaceState: true });
      return;
    }
    applyDeepLink(location.search);

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

  /** Only ever suggests something the bar can actually pour. */
  function surprise() {
    const pool = featured.length > 0 ? featured : items;
    if (pool.length === 0) return;
    choose(pool[Math.floor(Math.random() * pool.length)]!);
  }

  /**
   * Add a drink to the round.
   *
   * The six house drinks have options — ice, garnish, how strong — so they open the
   * configurator. A generated recipe has none, so it goes straight in: inventing a
   * sheet with nothing on it just to be consistent would be one more tap for nothing.
   */
  function choose(item: MenuItem) {
    const configurable = DRINKS.find((d) => d.name === item.name);
    if (configurable) selected = configurable;
    else addLine(item.name);
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
    else if (door !== 'featured') door = 'featured';
  }}
/>

<canvas class="bg-cannon" bind:this={cannon} aria-hidden="true"></canvas>

<div class="app">
  <header class="appbar">
    <span class="brand">COCKTAILS</span>
    <nav class="topnav" aria-label="Sections">
      <span class="nav-btn" aria-current="true">Menu</span>
    </nav>
    <!-- Grouped, because `.appbar-bartender` carries `margin-left:auto` — with two
         of them loose in the flex row each claimed the free space, stranding the
         first one in the middle of the bar. -->
    <div class="appbar-actions">
      <button
        type="button"
        class="appbar-bartender"
        onclick={() => (settings.open = true)}
        aria-label="Settings"
      >
        <span class="emoji">⚙️</span>
      </button>
      <a class="appbar-bartender" href="/bar" aria-label="Bartender mode">
        <span class="emoji">🍸</span>
      </a>
    </div>
  </header>

  <main class="stage">
    <section class="view view-menu" aria-label="Menu">
      <!-- Inside the scrolling view, not a child of `.app`: the shell is a
           three-row grid (appbar / stage / tabbar) and a fourth child steals the
           flexible row, which collapsed the menu to nothing. -->
      {#if staffRequest.active}
        <!-- The answer to "am I in yet?" must be reachable without opening the bar:
             someone who navigated away shouldn't have to go hunting for it. -->
        <a class="ask-banner ask-{staffRequest.kind}" href="/bar">
          {#if staffRequest.kind === 'pending'}
            ⏳ Waiting for the host to approve <strong>{staffRequest.name}</strong>…
          {:else}
            ✕ Bar request declined — tap for options
          {/if}
        </a>
      {/if}

      {#if door === 'walk'}
        <ChooseADrink
          {stock}
          onpick={(r) => {
            addLine(r.name);
            door = 'featured';
          }}
          onclose={() => (door = 'featured')}
        />
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
          <button
            type="button"
            class="chip"
            aria-pressed={door === 'all'}
            onclick={() => (door = door === 'all' ? 'featured' : 'all')}
          >
            {door === 'all' ? '← Back' : '📖 Everything'}
          </button>
          <button type="button" class="chip" onclick={() => (door = 'walk')}
            >🤔 Help me choose</button
          >
          <button type="button" class="chip chip-surprise" onclick={surprise}>🎲 Surprise</button>
          <InstallButton />
        </div>

        {#if door === 'all'}
          <input
            class="askbar-input menu-search"
            type="search"
            placeholder="Search {items.length} drinks…"
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
            {#each featured as item (item.id)}
              {@render card(item)}
            {/each}
          </div>
          {#if featured.length === 0}
            <p class="menu-empty">
              The bar hasn't got anything on tonight — ask whoever's pouring.
            </p>
          {/if}
        {/if}
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
  <!-- Nothing is drawn as unavailable any more: the list *is* what's pourable, so a
       greyed-out card would be a drink the host can't make and never claimed to. -->
  <article class="cocktail" class:is-fav={favourites.has(item.name)}>
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
    <button type="button" class="order" onclick={() => choose(item)}>Add to order</button>
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
