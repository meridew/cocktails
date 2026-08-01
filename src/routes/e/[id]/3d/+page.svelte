<script lang="ts">
  /**
   * The menu, in three dimensions — **the same menu**, not a different one.
   *
   * Two earlier attempts replaced the layout with a carousel, which was my idea
   * rather than the product's. This is the grid a guest already knows: same cards,
   * same order, same two columns on a phone, same "Add to order" in the same corner
   * of each one. What it gains is that they are objects — real depth, a real shadow
   * from a real light, and a wall that leans and falls away as you scroll it.
   *
   * The round, the name and the send button stay in the DOM. Text entry inside WebGL
   * means reimplementing a keyboard, focus, autofill and a screen reader, and losing
   * to the ones the phone already has.
   *
   * Everything below the presentation is shared with the flat page — the same
   * `eventMenu`, the same basket store, the same join. Two views that disagreed about
   * what was on the menu or what was in your round would be worse than one view.
   */
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { eventMenu, joinParty, type EventMenu, type MenuItem } from '$lib/api';
  import { emojiFor } from '$lib/menu';
  import {
    acknowledgeSoundHint,
    loadSounds,
    partyHasSounds,
    playCue,
    soundsMuted,
  } from '$lib/sound';
  import { createGrid, type Grid } from '$lib/three/grid';
  import { addLine, basketCount } from '$lib/stores/basket.svelte';
  import { getDeviceId, getSavedName, saveName } from '$lib/device';
  import { view } from '$lib/stores/view.svelte';
  import { celebrate as fireConfetti } from '$lib/confetti';
  import { DRINKS, type Drink } from '$lib/data';
  import Configurator from '$lib/components/Configurator.svelte';
  import OrderRail from '$lib/components/OrderRail.svelte';
  import SentCelebration from '$lib/components/SentCelebration.svelte';
  import SoundHint from '$lib/components/SoundHint.svelte';

  let { data }: { data: { eventId: string } } = $props();

  let canvas = $state<HTMLCanvasElement>();
  let grid: Grid | undefined;
  let status = $state<'loading' | 'ready' | 'empty' | 'nowebgl'>('loading');
  let menu = $state<EventMenu | null>(null);
  let selected = $state<Drink | null>(null);
  let celebrating = $state(false);
  let orderOpen = $derived(view.order);
  let count = $derived(basketCount());

  /** Arrival, exactly as the flat menu does it. */
  let askingName = $state(false);
  let nameInput = $state('');

  /**
   * What the bar is prepared to make: the short list where one exists, everything
   * where it doesn't. The same rule as the flat page, because it must be.
   */
  const onOffer = $derived.by(() => {
    if (!menu) return [];
    if (menu.shortList.length === 0) return menu.items;
    const byId = new Map(menu.items.map((i) => [i.id, i]));
    return menu.shortList.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
  });

  const closed = $derived(menu ? menu.event.status !== 'live' : false);

  function hasWebGL(): boolean {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  }

  onMount(async () => {
    if (!hasWebGL()) {
      status = 'nowebgl';
      return;
    }

    const known = getSavedName();
    if (known) void join(known);
    else askingName = true;

    try {
      menu = await eventMenu(data.eventId);
    } catch {
      status = 'empty';
      return;
    }

    /**
     * **Hiding the link does not shut the door.** This is a route: still reachable by
     * URL, by a bookmark, and by Back. A host who turned 3D off would reasonably
     * expect it gone, and this is a whole WebGL scene to be surprised by.
     *
     * `replaceState`, because the entry they came from no longer exists — leaving it
     * in the history sends Back straight back into this redirect.
     *
     * After the fetch and not before, so an offline guest lands on `empty` rather
     * than being bounced: we only act on an answer we actually got.
     */
    if (!menu.settings.threeD) {
      await goto(`/e/${data.eventId}`, { replaceState: true });
      return;
    }

    // Same clips as the flat menu. This page fetches once rather than polling, so a
    // sound recorded while somebody is in here lands on their next visit — which is
    // the right trade for a scene that is already holding a GPU context open.
    loadSounds(data.eventId, menu.sounds);

    if (onOffer.length === 0) {
      status = 'empty';
      return;
    }

    // The faces are drawn with `ctx.font`, so the poster face has to be resident
    // before the first is painted — otherwise every card bakes a fallback sans-serif
    // into a texture that is never redrawn.
    await document.fonts.ready;
    if (!canvas) return;

    grid = createGrid(canvas, emojiFor, {
      onPick: (item) => {
        if (closed) return;
        // The six house drinks have options, so they open the same sheet the flat
        // menu uses. A generated recipe has none and goes straight in.
        const configurable = DRINKS.find((d) => d.name === item.name);
        if (configurable) selected = configurable;
        else {
          addLine(item.name);
          playCue('add');
        }
      },
    });
    grid.setItems(onOffer);
    fit();
    status = 'ready';
  });

  async function join(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveName(trimmed);
    try {
      await joinParty(data.eventId, trimmed, getDeviceId());
    } catch {
      /* the order they eventually send creates the guest row anyway */
    }
    askingName = false;
  }

  function fit() {
    if (grid && canvas) grid.resize(canvas.clientWidth, canvas.clientHeight);
  }

  function onSent() {
    view.order = false;
    celebrating = true;
    fireConfetti();
    playCue('sent');
  }

  onDestroy(() => grid?.dispose());
</script>

<svelte:head><title>{menu?.event.name ?? 'Menu'} · COCKTAILS!!!</title></svelte:head>
<svelte:window onresize={fit} />

<div class="stage3d">
  <canvas bind:this={canvas} class="stage3d-canvas" class:is-ready={status === 'ready'}></canvas>

  <!-- Up, in the same slot and the same shape as every other screen. It said "Flat
       menu" on the right — a sideways move in the corner that means "back" here and
       "sign out" on two other screens. This page is *below* the menu now, and says
       so, which is also how it finally became reachable: the menu links down to it. -->
  <header class="stage3d-bar">
    <a class="appbar-up" href="/e/{data.eventId}">
      <span class="appbar-up-chev" aria-hidden="true">←</span>
      <span class="appbar-up-label">Menu</span>
    </a>
    <span class="brand">3D</span>
  </header>

  {#if askingName}
    <div class="stage3d-sheet">
      <section class="panel arrive">
        <h2>Who's this?</h2>
        <p>So the bar knows whose drink is whose.</p>
        <form
          onsubmit={(e) => {
            e.preventDefault();
            // On the tap, not inside `join()` — see the flat menu's note. `join()`
            // also runs unattended for a guest this device already has a name for.
            if (menu && partyHasSounds(menu.sounds) && !soundsMuted()) {
              acknowledgeSoundHint(data.eventId);
            }
            playCue('join');
            void join(nameInput);
          }}
        >
          <label class="field">
            Your name
            <input bind:value={nameInput} placeholder="Alex" autocomplete="name" maxlength="40" />
          </label>
          {#if menu}
            <SoundHint eventId={data.eventId} sounds={menu.sounds} placement="arrival" />
          {/if}
          <button class="btn btn-go" type="submit" disabled={!nameInput.trim()}>I'm in</button>
        </form>
      </section>
    </div>
  {/if}

  {#if !askingName && menu}
    <div class="stage3d-soundhint">
      <SoundHint eventId={data.eventId} sounds={menu.sounds} dismissible />
    </div>
  {/if}

  {#if status === 'loading'}
    <p class="stage3d-say">Pouring…</p>
  {:else if status === 'empty'}
    <p class="stage3d-say">The bar hasn't got anything on.</p>
  {:else if status === 'nowebgl'}
    <p class="stage3d-say">
      This phone can't do the 3D menu. <a href="/e/{data.eventId}">Here's the normal one →</a>
    </p>
  {/if}

  {#if closed && status === 'ready'}
    <p class="stage3d-say stage3d-shut">🚫 The bar isn't taking orders.</p>
  {/if}

  <!-- The tab bar is the flat one, deliberately: the count is the thing a guest
       checks, and it should be in the same place in both views. -->
  <nav class="tabbar" aria-label="Main navigation">
    <div class="tab" aria-current="true"><span class="emoji">🍸</span><span>Menu</span></div>
    <button type="button" class="tab tab-order" onclick={() => (view.order = true)}>
      <span class="emoji">🧺</span><span>Order</span>
      {#if count}<b class="tab-badge">{count}</b>{/if}
    </button>
  </nav>

  <!-- Inside the stage, so the overrides below can reach it. See the style block:
       the rail's desktop form is a column of a grid this page doesn't have. -->
  <div
    class="order-backdrop"
    class:open={orderOpen}
    onclick={() => (view.order = false)}
    onkeydown={(e) => e.key === 'Escape' && (view.order = false)}
    role="button"
    tabindex="-1"
    aria-label="Close order"
  ></div>
  <OrderRail open={orderOpen} onclose={() => (view.order = false)} onsent={onSent} />
</div>

{#if selected}
  {#key selected.name}
    <Configurator
      drink={selected}
      onadd={(n) => {
        addLine(n);
        playCue('add');
      }}
      onclose={() => (selected = null)}
    />
  {/key}
{/if}
{#if celebrating}
  <SentCelebration onclose={() => (celebrating = false)} />
{/if}

<style>
  /* Full-bleed and its own scroll context: the scene *is* the page here, unlike
     every other screen, so it opts out of the shell rather than sitting inside it. */
  .stage3d {
    position: fixed;
    inset: 0;
    overflow: hidden;
  }
  .stage3d-canvas {
    display: block;
    width: 100%;
    height: 100%;
    /* The wall is dragged, so the browser must not also try to scroll the page. */
    touch-action: none;
    opacity: 0;
    transition: opacity 0.4s ease;
  }
  .stage3d-canvas.is-ready {
    opacity: 1;
  }
  .stage3d-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    pointer-events: none;
  }
  .stage3d-bar :global(a) {
    pointer-events: auto;
  }
  .stage3d-bar .brand {
    color: #fff;
    text-shadow: var(--display-shadow);
  }
  .stage3d-bar :global(.appbar-bartender) {
    margin-left: auto;
    background: #0a0a12;
    color: #fff;
    border-radius: 999px;
  }
  .stage3d-sheet {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgba(10, 10, 18, 0.55);
  }
  .stage3d-sheet .panel {
    max-width: 420px;
    width: 100%;
  }
  .stage3d-soundhint {
    position: absolute;
    z-index: 2;
    top: 70px;
    left: 50%;
    width: min(520px, calc(100% - 24px));
    transform: translateX(-50%);
  }
  .stage3d-say {
    position: absolute;
    inset: auto 0 auto 0;
    top: 50%;
    margin: 0;
    text-align: center;
    font-family: var(--font-accent);
    font-size: 0.8rem;
    letter-spacing: var(--ls-accent);
    text-transform: uppercase;
    color: var(--text);
  }
  .stage3d-shut {
    top: auto;
    bottom: 92px;
  }

  /*
   * The order rail stays a slide-up sheet here, at every width.
   *
   * neo.css turns it into `grid-area: order; position: static` above 900px, because
   * on the flat menu the desktop layout is a two-column grid with the rail as its
   * right-hand column. This page has no such grid — the scene is the whole viewport —
   * so that rule dropped the rail into normal flow at the top of the document, full
   * width, permanently, with "Add something first" spanning 1240px in front of
   * everything. The same media query also hides the tab bar and the rail's own close
   * button, so on a laptop there was no way to open it and no way to shut it.
   *
   * Restoring the mobile form is the right fix rather than inventing a grid: the
   * scene wants the whole screen, and a sheet over it is what the flat menu already
   * does on the device most guests are holding.
   */
  .stage3d :global(.order-rail) {
    position: fixed;
    grid-area: auto;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 86dvh;
    border-radius: 16px 16px 0 0;
    border-left: none;
    box-shadow: 0 -18px 44px rgba(0, 0, 0, 0.55);
    transform: translateY(110%);
  }
  .stage3d :global(.order-rail.open) {
    transform: none;
  }
  /* Both hidden by the same media query, and both needed here. */
  .stage3d :global(.order-backdrop),
  .stage3d :global(.tabbar) {
    display: revert;
  }
  .stage3d :global(.order-rail .flowbar-back) {
    display: revert;
  }
</style>
