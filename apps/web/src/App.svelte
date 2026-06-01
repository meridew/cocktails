<script lang="ts">
  import { DRINKS, type Drink } from './lib/data';
  import { basket, addLine, setQty, clearBasket, basketCount } from './lib/basket.svelte';
  import { createOrder } from './lib/api';
  import { getDeviceId, getSavedName, saveName } from './lib/device';
  import { storage } from './lib/storage';
  import { SvelteSet } from 'svelte/reactivity';
  import { enablePush, pushSupported, pushPermission } from './lib/push';
  import Configurator from './lib/Configurator.svelte';
  import Bartender from './lib/Bartender.svelte';
  import { startBackgroundCannon, celebrate as fireConfetti } from './lib/confetti';
  import { dialog, lockBackground } from './lib/dialog';

  // dev-hub deep links: /?bartender opens the bar, /?order opens the order sheet
  const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  let selected = $state<Drink | null>(null);
  let showBartender = $state(params.has('bartender'));
  let orderOpen = $state(params.has('order'));
  let name = $state(getSavedName());
  let note = $state('');
  let sending = $state(false);
  let celebrate = $state(false);
  let errMsg = $state('');

  // favourites (persisted via the storage seam). SvelteSet so add/delete are
  // reactive — a plain Set wrapped in $state doesn't re-render on mutation.
  const FAV = 'favs';
  let favs = new SvelteSet<string>(loadFavs());
  let favesOnly = $state(false);
  function loadFavs(): string[] {
    const v = storage.readJSON<unknown>(FAV, []);
    return Array.isArray(v) ? (v as string[]) : [];
  }
  function toggleFav(n: string) {
    if (favs.has(n)) favs.delete(n);
    else favs.add(n);
    storage.writeJSON(FAV, [...favs]);
    if (favs.size === 0) favesOnly = false;
  }

  let count = $derived(basketCount());

  // background party-popper cannon
  let cannon = $state<HTMLCanvasElement>();
  $effect(() => {
    if (cannon) return startBackgroundCannon(cannon);
  });

  // On mobile the order sheet is a modal: focus it + make the menu behind inert.
  // (On desktop it's a persistent rail, so we skip.)
  $effect(() => {
    if (!orderOpen) return;
    if (window.matchMedia('(min-width: 900px)').matches) return;
    const release = lockBackground();
    const prev = document.activeElement as HTMLElement | null;
    queueMicrotask(() => document.getElementById('name')?.focus());
    return () => {
      release();
      prev?.focus?.();
    };
  });

  function surprise() {
    selected = DRINKS[Math.floor(Math.random() * DRINKS.length)]!;
  }

  // push: "notify me when my drink is ready" (anonymous, device-keyed)
  let notify = $state<'idle' | 'working' | 'on' | 'denied' | 'unavailable'>(
    pushPermission() === 'granted' ? 'on' : 'idle',
  );
  async function notifyMe() {
    notify = 'working';
    const r = await enablePush('guest');
    notify = r.ok ? 'on' : r.reason === 'denied' ? 'denied' : 'unavailable';
  }

  async function send() {
    if (!name.trim() || basket.items.length === 0) return;
    sending = true;
    errMsg = '';
    try {
      saveName(name.trim());
      await createOrder({
        name: name.trim(),
        items: [...basket.items],
        note: note.trim(),
        deviceId: getDeviceId(),
      });
      clearBasket();
      note = '';
      orderOpen = false;
      celebrate = true;
      fireConfetti();
    } catch (e) {
      errMsg = (e as Error).message;
    } finally {
      sending = false;
    }
  }
</script>

<canvas class="bg-cannon" bind:this={cannon} aria-hidden="true"></canvas>

<svelte:window
  onkeydown={(e) => {
    if (e.key !== 'Escape') return;
    if (celebrate) celebrate = false;
    else if (orderOpen) orderOpen = false;
  }}
/>

<div class="app">
  <header class="appbar">
    <span class="brand">COCKTAILS</span>
    <nav class="topnav" aria-label="Sections">
      <span class="nav-btn" aria-current="true">Menu</span>
    </nav>
    <button type="button" class="appbar-bartender" onclick={() => (showBartender = true)} aria-label="Bartender mode">
      <span class="emoji">🍸</span>
    </button>
  </header>

  <main class="stage">
    <section class="view view-menu" aria-label="Menu">
      <div class="menubar">
        {#if favs.size}
          <button type="button" class="chip chip-fav" aria-pressed={favesOnly} onclick={() => (favesOnly = !favesOnly)}>⭐ Faves</button>
        {/if}
        <button type="button" class="chip chip-surprise" onclick={surprise}>🎲 Surprise</button>
      </div>

      <div class="menu" class:faves-only={favesOnly}>
        {#each DRINKS as d (d.name)}
          <article class="cocktail" class:is-fav={favs.has(d.name)}>
            <button
              type="button"
              class="fav"
              aria-pressed={favs.has(d.name)}
              onclick={() => toggleFav(d.name)}
              aria-label="Toggle favourite"
            >
              {favs.has(d.name) ? '⭐' : '☆'}
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

<aside class="order-rail" class:open={orderOpen} aria-label="Your order">
  <section id="order-form">
    <h2>Your order</h2>
    <p class="hint">▶ Add drinks, drop your name, send.</p>

    <div class="basket">
      {#if basket.items.length === 0}
        <p class="basket-empty"><strong>Nothing yet.</strong> Tap a drink to start your round.</p>
      {:else}
        <ul class="basket-list">
          {#each basket.items as item (item.name)}
            <li class="basket-item">
              <span class="basket-item-name">{item.name}</span>
              <div class="qty">
                <button type="button" class="qty-btn" onclick={() => setQty(item.name, item.qty - 1)} aria-label="Less">−</button>
                <span class="qty-n">{item.qty}</span>
                <button type="button" class="qty-btn" onclick={() => setQty(item.name, item.qty + 1)} aria-label="More">+</button>
              </div>
            </li>
          {/each}
        </ul>
        <button type="button" class="basket-clear" onclick={clearBasket}>Clear all</button>
      {/if}
    </div>

    <label for="name">Your name</label>
    <input id="name" bind:value={name} placeholder="DANIEL" autocomplete="name" autocapitalize="words" />
    <label for="note">Note (optional)</label>
    <textarea id="note" bind:value={note} placeholder="No ice! Extra lime! Make it spicy!"></textarea>
    {#if errMsg}<p class="status err" role="alert">{errMsg}</p>{/if}

    <div class="flowbar">
      <button type="button" class="send flowbar-primary" disabled={!name.trim() || count === 0 || sending} onclick={send}>
        {sending ? 'Sending…' : count === 0 ? 'Add something first' : 'Send order'}
      </button>
      <button type="button" class="flowbar-back" onclick={() => (orderOpen = false)} aria-label="Close order">✕</button>
    </div>
  </section>
</aside>
<div
  class="order-backdrop"
  class:open={orderOpen}
  onclick={() => (orderOpen = false)}
  onkeydown={(e) => e.key === 'Escape' && (orderOpen = false)}
  role="button"
  tabindex="-1"
  aria-label="Close order"
></div>

{#if selected}
  <Configurator drink={selected} onadd={(n) => addLine(n)} onclose={() => (selected = null)} />
{/if}
{#if showBartender}
  <Bartender onclose={() => (showBartender = false)} />
{/if}
{#if celebrate}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="celebrate"
    role="dialog"
    aria-modal="true"
    aria-label="Order sent"
    tabindex="-1"
    use:dialog={{ onclose: () => (celebrate = false) }}
    onclick={(e) => {
      if (e.target === e.currentTarget) celebrate = false;
    }}
  >
    <div class="celebrate-card">
      <h2>Cheers! 🥂</h2>
      <p class="celebrate-msg">Your drinks are <strong>on the way</strong>. 🍹</p>
      {#if pushSupported()}
        {#if notify === 'on'}
          <p class="notify-on">🔔 You'll get a buzz when it's ready.</p>
        {:else if notify === 'denied'}
          <p class="notify-note">Notifications are blocked — enable them in your browser settings.</p>
        {:else if notify === 'unavailable'}
          <p class="notify-note">Notifications aren't available right now.</p>
        {:else}
          <button type="button" class="notify-btn" onclick={notifyMe} disabled={notify === 'working'}>
            {notify === 'working' ? 'Enabling…' : '🔔 Notify me when ready'}
          </button>
        {/if}
      {/if}
      <button type="button" class="send" onclick={() => (celebrate = false)}>Start another 🍸</button>
    </div>
  </div>
{/if}
