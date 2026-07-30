<script lang="ts">
  /**
   * App shell: the menu, and the orchestration of the overlays. State lives in
   * `lib/*.svelte.ts` stores; this file wires them to components.
   */
  import { DRINKS, type Drink } from './lib/data.ts';
  import { basketCount } from './lib/basket.svelte';
  import { favourites } from './lib/favourites.svelte';
  import { refreshPushState } from './lib/push.svelte';
  import Configurator from './lib/Configurator.svelte';
  import Bartender from './lib/Bartender.svelte';
  import InstallButton from './lib/InstallButton.svelte';
  import OrderRail from './lib/OrderRail.svelte';
  import SentCelebration from './lib/SentCelebration.svelte';
  import { startBackgroundCannon, celebrate as fireConfetti } from './lib/confetti.ts';
  import { lockBackground } from './lib/dialog.ts';
  import { addLine } from './lib/basket.svelte';

  // dev-hub deep links: /?bartender opens the bar, /?order opens the order sheet
  const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  let selected = $state<Drink | null>(null);
  let showBartender = $state(params.has('bartender'));
  let orderOpen = $state(params.has('order'));
  let celebrating = $state(false);
  let favesOnly = $state(false);

  let count = $derived(basketCount());

  // background party-popper cannon
  let cannon = $state<HTMLCanvasElement>();
  $effect(() => {
    if (cannon) return startBackgroundCannon(cannon);
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

  // Reconcile a previous visit's notification registration, without prompting.
  void refreshPushState('guest');

  function surprise() {
    selected = DRINKS[Math.floor(Math.random() * DRINKS.length)]!;
  }

  function toggleFav(name: string) {
    favourites.toggle(name);
    if (favourites.size === 0) favesOnly = false;
  }

  function onSent() {
    orderOpen = false;
    celebrating = true;
    fireConfetti();
  }
</script>

<canvas class="bg-cannon" bind:this={cannon} aria-hidden="true"></canvas>

<svelte:window
  onkeydown={(e) => {
    if (e.key !== 'Escape') return;
    if (celebrating) celebrating = false;
    else if (orderOpen) orderOpen = false;
  }}
/>

<div class="app">
  <header class="appbar">
    <span class="brand">COCKTAILS</span>
    <nav class="topnav" aria-label="Sections">
      <span class="nav-btn" aria-current="true">Menu</span>
    </nav>
    <button
      type="button"
      class="appbar-bartender"
      onclick={() => (showBartender = true)}
      aria-label="Bartender mode"
    >
      <span class="emoji">🍸</span>
    </button>
  </header>

  <main class="stage">
    <section class="view view-menu" aria-label="Menu">
      <div class="menubar">
        {#if favourites.size}
          <button
            type="button"
            class="chip chip-fav"
            aria-pressed={favesOnly}
            onclick={() => (favesOnly = !favesOnly)}>⭐ Faves</button
          >
        {/if}
        <button type="button" class="chip chip-surprise" onclick={surprise}>🎲 Surprise</button>
        <InstallButton />
      </div>

      <!-- Filtering is neo.css's job (.menu.faves-only hides non-favourites), so
           the class drives it rather than a filtered list. -->
      <div class="menu" class:faves-only={favesOnly}>
        {#each DRINKS as d (d.name)}
          <article class="cocktail" class:is-fav={favourites.has(d.name)}>
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
            <button type="button" class="order" onclick={() => (selected = d)}>Add to order</button>
          </article>
        {/each}
      </div>
    </section>
  </main>

  <nav class="tabbar" aria-label="Main navigation">
    <div class="tab" aria-current="true"><span class="emoji">🍸</span><span>Menu</span></div>
    <button type="button" class="tab tab-order" onclick={() => (orderOpen = true)}>
      <span class="emoji">🧺</span><span>Order</span>
      {#if count}<b class="tab-badge">{count}</b>{/if}
    </button>
  </nav>
</div>

<OrderRail
  open={orderOpen}
  onclose={() => (orderOpen = false)}
  onsent={onSent}
  bind:rail={orderRail}
/>
<div
  class="order-backdrop"
  class:open={orderOpen}
  bind:this={orderBackdrop}
  onclick={() => (orderOpen = false)}
  onkeydown={(e) => e.key === 'Escape' && (orderOpen = false)}
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
{#if showBartender}
  <Bartender onclose={() => (showBartender = false)} />
{/if}
{#if celebrating}
  <SentCelebration onclose={() => (celebrating = false)} />
{/if}
