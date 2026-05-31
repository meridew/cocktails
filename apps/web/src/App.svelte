<script lang="ts">
  import { DRINKS, type Drink } from './lib/data';
  import { basket, addLine, setQty, clearBasket, basketCount } from './lib/basket.svelte';
  import { createOrder } from './lib/api';
  import { getDeviceId, getSavedName, saveName } from './lib/device';
  import Configurator from './lib/Configurator.svelte';
  import Bartender from './lib/Bartender.svelte';
  import { startBackgroundCannon, celebrate as fireConfetti } from './lib/confetti';

  let selected = $state<Drink | null>(null);
  let showBartender = $state(false);
  let name = $state(getSavedName());
  let note = $state('');
  let sending = $state(false);
  let celebrate = $state(false);
  let errMsg = $state('');

  let count = $derived(basketCount());

  // background party-popper cannon
  let cannon = $state<HTMLCanvasElement>();
  $effect(() => {
    if (cannon) return startBackgroundCannon(cannon);
  });

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
      celebrate = true;
      fireConfetti();
    } catch (e) {
      errMsg = (e as Error).message;
    } finally {
      sending = false;
    }
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key !== 'Escape') return;
    if (celebrate) celebrate = false;
    else if (selected) selected = null;
  }}
/>

<canvas class="bg-cannon" bind:this={cannon} aria-hidden="true"></canvas>

<header class="bar">
  <span class="brand neon">COCKTAILS</span>
  <button class="bt-open" onclick={() => (showBartender = true)} aria-label="Bartender">🍸</button>
</header>

<main>
  <section class="menu">
    {#each DRINKS as d (d.name)}
      <button class="card" onclick={() => (selected = d)}>
        <span class="card-emoji">{d.emoji}</span>
        <span class="card-name">{d.name}</span>
      </button>
    {/each}
  </section>

  <aside class="order">
    <h2>Your order</h2>
    {#if basket.items.length === 0}
      <p class="muted">Tap a drink to start your round.</p>
    {:else}
      <ul>
        {#each basket.items as item (item.name)}
          <li>
            <span class="ln">{item.name}</span>
            <div class="qty">
              <button onclick={() => setQty(item.name, item.qty - 1)} aria-label="Less">−</button>
              <b>{item.qty}</b>
              <button onclick={() => setQty(item.name, item.qty + 1)} aria-label="More">+</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <input placeholder="Your name" autocomplete="name" bind:value={name} />
    <textarea placeholder="Note (optional) — no ice, extra lime…" bind:value={note}></textarea>
    {#if errMsg}<p class="err">{errMsg}</p>{/if}
    <button class="send" disabled={!name.trim() || count === 0 || sending} onclick={send}>
      {sending ? 'Sending…' : count === 0 ? 'Add something first' : `Send order (${count})`}
    </button>
  </aside>
</main>

{#if selected}
  <Configurator drink={selected} onadd={(n) => addLine(n)} onclose={() => (selected = null)} />
{/if}
{#if showBartender}
  <Bartender onclose={() => (showBartender = false)} />
{/if}
{#if celebrate}
  <div
    class="celebrate"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => {
      if (e.target === e.currentTarget) celebrate = false;
    }}
    onkeydown={(e) => e.key === 'Escape' && (celebrate = false)}
  >
    <div class="celebrate-card">
      <h2 class="neon">Cheers! 🥂</h2>
      <p>Your drinks are on the way. 🍹</p>
      <button onclick={() => (celebrate = false)}>Start another 🍸</button>
    </div>
  </div>
{/if}

<style>
  .bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.9rem 1.1rem;
    position: sticky;
    top: 0;
    background: rgb(10 10 20 / 0.8);
    backdrop-filter: blur(8px);
    z-index: 10;
  }
  .brand {
    font-family: var(--font-display);
    font-size: clamp(1.5rem, 6vw, 2.1rem);
    animation: neon-pulse 2.6s ease-in-out infinite;
  }
  .bt-open {
    background: transparent;
    border: 1.5px solid var(--neon-pink);
    border-radius: 999px;
    font-size: 1.2rem;
    padding: 0.3rem 0.6rem;
  }
  main {
    position: relative;
    z-index: 1;
    display: grid;
    gap: 1.2rem;
    padding: 1.1rem;
    max-inline-size: 1000px;
    margin-inline: auto;
  }
  @media (min-width: 760px) {
    main { grid-template-columns: 1fr 340px; align-items: start; }
    .order { position: sticky; top: 5rem; }
  }
  .menu {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.8rem;
  }
  .card {
    background: var(--panel);
    border: 1.5px solid var(--line);
    border-radius: 16px;
    padding: 1.2rem 0.8rem;
    display: grid;
    gap: 0.4rem;
    justify-items: center;
    color: var(--text);
    transition: border-color 0.15s, transform 0.1s;
  }
  .card:hover {
    border-color: var(--neon-cyan);
    transform: translateY(-3px);
    box-shadow: 0 0 0 1px var(--neon-cyan), 0 8px 26px -8px var(--neon-cyan);
  }
  .card-emoji { font-size: 2.4rem; }
  .card-name { font-weight: 600; }
  .order {
    background: var(--panel);
    border: 1.5px solid var(--line);
    border-radius: 16px;
    padding: 1rem;
  }
  .order h2 { margin-top: 0; }
  .muted { color: var(--muted); }
  .order ul { list-style: none; padding: 0; margin: 0 0 0.8rem; display: grid; gap: 0.5rem; }
  .order li { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
  .ln { font-size: 0.92rem; }
  .qty { display: flex; align-items: center; gap: 0.5rem; }
  .qty button {
    inline-size: 2rem;
    block-size: 2rem;
    border-radius: 8px;
    border: 1.5px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font-size: 1.1rem;
  }
  input, textarea {
    inline-size: 100%;
    box-sizing: border-box;
    background: var(--bg);
    border: 1.5px solid var(--line);
    color: var(--text);
    border-radius: 10px;
    padding: 0.7rem;
    margin-block-end: 0.6rem;
    font: inherit;
  }
  textarea { min-block-size: 3rem; resize: vertical; }
  .send {
    inline-size: 100%;
    background: var(--neon-pink);
    color: #150018;
    border: none;
    font-weight: 700;
    font-size: 1.05rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 0.95rem;
    border-radius: 12px;
    box-shadow: 0 0 26px -4px var(--neon-pink);
  }
  .send:disabled { background: var(--line); color: var(--muted); }
  .err { color: var(--neon-pink); }
  .celebrate {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.8);
    display: grid;
    place-items: center;
    z-index: 70;
  }
  .celebrate-card {
    background: var(--panel);
    border: 2px solid var(--neon-pink);
    border-radius: 18px;
    padding: 2rem;
    text-align: center;
    display: grid;
    gap: 0.8rem;
  }
  .celebrate-card button {
    background: var(--neon-cyan);
    color: #001a17;
    border: none;
    font-weight: 700;
    padding: 0.8rem 1.2rem;
    border-radius: 12px;
  }
</style>
