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
   * The shell (appbar, tabbar) lives here rather than in the layout because the bar
   * is a full-screen view of its own — putting the chrome in the layout would only
   * mean hiding it again on /bar.
   */
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { DRINKS, type Drink } from '$lib/data';
  import { eventMenu } from '$lib/api';

  import { addLine, basketCount } from '$lib/stores/basket.svelte';
  import { favourites } from '$lib/stores/favourites.svelte';
  import { applyDeepLink, settings, view } from '$lib/stores/view.svelte';
  import { staffRequest } from '$lib/stores/staffRequest.svelte';
  import { celebrate as fireConfetti, startBackgroundCannon } from '$lib/confetti';
  import { lockBackground } from '$lib/dialog';
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
   * What this party can actually pour, from the host's stock list.
   *
   * **Fails open on purpose.** An empty map means every drink is offered, and so
   * does a failed request or a name the recipe engine has never heard of. Wrongly
   * offering a drink costs someone a "sorry, we're out"; wrongly hiding one costs a
   * drink nobody knew they could have had — and a menu that silently shrinks because
   * the network hiccuped is indistinguishable from a broken app.
   *
   * Marked, not hidden: a guest who knows this menu has six drinks and counts four
   * assumes the app is wrong. "Not tonight" is information.
   */
  let available = $state<Record<string, boolean>>({});
  const pourable = (name: string): boolean => available[name] !== false;

  onMount(() => {
    // Notifications sent before the bar became a route still carry `/?bartender`.
    if (new URLSearchParams(location.search).has('bartender')) {
      void goto('/bar', { replaceState: true });
      return;
    }
    applyDeepLink(location.search);

    // Deliberately not awaited: the menu renders immediately and drinks that turn
    // out to be off get marked when the answer lands, rather than the whole list
    // waiting on a request to show anything at all.
    {
      void eventMenu(data.eventId)
        .then((r) => (available = r.available))
        .catch(() => {
          /* offline, or a party that's been deleted — offer everything */
        });
    }
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
    const pool = DRINKS.filter((d) => pourable(d.name));
    if (pool.length === 0) return;
    selected = pool[Math.floor(Math.random() * pool.length)]!;
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

      <div class="menubar">
        {#if favourites.size}
          <button
            type="button"
            class="chip chip-fav"
            aria-pressed={favesOnly}
            onclick={() => (view.favesOnly = !favesOnly)}>⭐ Faves</button
          >
        {/if}
        <button type="button" class="chip chip-surprise" onclick={surprise}>🎲 Surprise</button>
        <InstallButton />
      </div>

      <!-- Filtering is neo.css's job (.menu.faves-only hides non-favourites), so
           the class drives it rather than a filtered list. -->
      <div class="menu" class:faves-only={favesOnly}>
        {#each DRINKS as d (d.name)}
          {@const on = pourable(d.name)}
          <!-- Order is never re-sorted on the availability response: drinks
               visibly jumping around a second after load reads as a glitch. -->
          <article class="cocktail" class:is-fav={favourites.has(d.name)} class:is-out={!on}>
            <button
              type="button"
              class="fav"
              aria-pressed={favourites.has(d.name)}
              onclick={() => toggleFav(d.name)}
              aria-label="Toggle favourite"
            >
              {favourites.has(d.name) ? '⭐' : '☆'}
            </button>
            <h3><span class="emoji">{d.emoji}</span> {d.name}</h3>
            <button type="button" class="order" disabled={!on} onclick={() => (selected = d)}>
              {on ? 'Add to order' : 'Not tonight'}
            </button>
          </article>
        {/each}
      </div>
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
