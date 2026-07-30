<script lang="ts">
  /**
   * What the host has in — the tick list the whole generator hangs off.
   *
   * This is the last piece of phase 3, and the one that makes the other pieces
   * visible: the 270-recipe engine, the inventory endpoints and the guest menu's
   * gating were all in place and had no way for a person to say "I have gin".
   *
   * It lives inside the bar rather than under /host because `inventory:read` and
   * `inventory:edit` are *staff* capabilities scoped to one event — the host already
   * traded their account session for a bar session to get here, and a second screen
   * behind a second credential would mean signing in twice to run one party.
   *
   * The counts update as you tick, computed here from the same `$lib/shared` engine
   * the server uses. That isn't the duplication the endpoints warn about: the guest
   * is told what's pourable precisely because the guest never receives the stock,
   * whereas this screen holds the whole list already. Calling the same function on
   * the same data cannot disagree with itself, and a round trip per checkbox would
   * make the count lag a tap behind the ticking.
   */
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { getStock, saveStock, Unauthorized } from '$lib/api';
  import { session } from '$lib/stores/session.svelte';
  import { can, makeable, suggestions, OPTIONAL_CATEGORIES, STOCK_GROUPS } from '$lib/shared';

  let { onclose }: { onclose: () => void } = $props();

  /** How many "buy this next" rows earn their space on a phone. */
  const SUGGESTION_COUNT = 4;

  let loaded = $state(false);
  let busy = $state(false);
  let err = $state('');
  let filter = $state('');

  /** What's ticked now, and what the server last confirmed — the diff is "unsaved". */
  const ticked = new SvelteSet<string>();
  let saved = $state<string[]>([]);

  const editable = $derived(can(session.staff, 'inventory:edit'));

  /** Recomputed as they tick. See the note above on why this is local. */
  const stock = $derived([...ticked]);
  const pourable = $derived(makeable(stock, { ignore: OPTIONAL_CATEGORIES }));
  const nextBest = $derived(
    suggestions(stock, { ignore: OPTIONAL_CATEGORIES }).slice(0, SUGGESTION_COUNT),
  );

  const dirty = $derived(ticked.size !== saved.length || saved.some((i) => !ticked.has(i)));

  /** Groups narrowed by the search box, empty ones dropped so no heading dangles. */
  const groups = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return STOCK_GROUPS;
    return STOCK_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((i) => i.toLowerCase().includes(q)),
    })).filter((g) => g.items.length > 0);
  });

  async function load() {
    try {
      const r = await getStock();
      ticked.clear();
      for (const i of r.stock) ticked.add(i);
      saved = r.stock;
      loaded = true;
    } catch (e) {
      if (!(e instanceof Unauthorized))
        err = (e as Error).message || "Couldn't load the stock list";
    }
  }

  onMount(load);

  function toggle(ingredient: string) {
    if (!editable) return;
    if (ticked.has(ingredient)) ticked.delete(ingredient);
    else ticked.add(ingredient);
  }

  async function save() {
    if (busy) return;
    busy = true;
    err = '';
    try {
      const r = await saveStock([...ticked]);
      // Adopt what the server kept, not what we sent: it drops anything it doesn't
      // recognise, and pretending otherwise would leave the screen permanently dirty.
      saved = r.stock;
      ticked.clear();
      for (const i of r.stock) ticked.add(i);
    } catch (e) {
      if (!(e instanceof Unauthorized)) err = (e as Error).message || "That didn't save";
    } finally {
      busy = false;
    }
  }

  /** Undo back to the last saved list — the escape hatch from a mis-tap spree. */
  function revert() {
    ticked.clear();
    for (const i of saved) ticked.add(i);
  }
</script>

<div class="bt-stock">
  <header class="bt-staff-top">
    <h3>What we have in</h3>
    <button type="button" class="bt-chip" onclick={onclose}>Back to orders</button>
  </header>

  {#if err}<p class="bt-conn" role="status">{err}</p>{/if}

  {#if !loaded}
    <p class="bt-empty">Loading…</p>
  {:else}
    <!-- The number this screen exists to move. Kept at the top so the effect of a
         tick is visible without scrolling back up to find it. -->
    <p class="bt-stock-count" aria-live="polite">
      <b>{pourable.length}</b>
      {pourable.length === 1 ? 'drink' : 'drinks'} from
      <b>{ticked.size}</b>
      {ticked.size === 1 ? 'bottle' : 'bottles'}
    </p>

    {#if editable}
      <div class="bt-acts bt-stock-acts">
        <button type="button" class="bt-act start" disabled={!dirty || busy} onclick={save}>
          {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
        {#if dirty}
          <button type="button" class="bt-act" disabled={busy} onclick={revert}>Undo</button>
        {/if}
      </div>
    {:else}
      <p class="bt-staff-note">Only the host can change this list.</p>
    {/if}

    {#if nextBest.length}
      <!-- The question a tick list can't answer on its own: not "what can I make"
           but "what should I buy". Only counts bottles that are the sole thing
           standing between this cupboard and a recipe. -->
      <section class="bt-staff-group">
        <h4>One more bottle</h4>
        <div class="bt-stock-suggest">
          {#each nextBest as s (s.ingredient)}
            <button
              type="button"
              class="bt-stock-tip"
              disabled={!editable}
              onclick={() => toggle(s.ingredient)}
            >
              {s.ingredient}<b>+{s.unlocks}</b>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <div class="bt-stock-search">
      <input
        type="search"
        bind:value={filter}
        placeholder="Search the cupboard…"
        aria-label="Search ingredients"
        autocomplete="off"
      />
    </div>

    {#each groups as group (group.category)}
      <section class="bt-staff-group">
        <h4>{group.label}</h4>
        <div class="bt-stock-grid">
          {#each group.items as item (item)}
            <label class="bt-stock-item" class:is-in={ticked.has(item)}>
              <input
                type="checkbox"
                checked={ticked.has(item)}
                disabled={!editable}
                onchange={() => toggle(item)}
              />
              <span>{item}</span>
            </label>
          {/each}
        </div>
      </section>
    {/each}

    {#if groups.length === 0}
      <p class="bt-empty">Nothing matches “{filter}”.</p>
    {/if}

    <section class="bt-staff-group">
      <h4>What that pours</h4>
      {#if pourable.length === 0}
        <p class="bt-empty">Tick a spirit and something to mix it with.</p>
      {:else}
        <p class="bt-stock-pourable">
          {#each pourable as r (r.id)}<span>{r.name}</span>{/each}
        </p>
      {/if}
      <p class="bt-staff-note">
        Garnishes don't count against a drink — a missing olive shouldn't hide a Martini.
      </p>
    </section>
  {/if}
</div>
