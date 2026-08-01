<script lang="ts">
  /**
   * What a host has in — the tick list the whole generated menu hangs off.
   *
   * **Two screens use this, which is why it is a component.** A host fills in their
   * own from `/host`; Dan fills one in for them from `/admin` when they haven't got
   * round to it. Same list, same rules, one place — a second copy would be a second
   * set of decisions about what counts as pourable.
   *
   * It takes a `userId` rather than reading one from the session, because *whose*
   * cupboard is the question the screen exists to answer, and the two callers answer
   * it differently. The server checks: `stock:read`/`stock:edit` are scoped to a
   * person, so a host asking for somebody else's gets a 404 and this renders nothing.
   *
   * An earlier version of this lived inside the bartender's screen, because a bar
   * session was the only credential that could authorise editing it. That was the
   * bug the whole actor model exists to fix; it is not a coincidence that the fix
   * also made this reusable.
   */
  import { onMount } from 'svelte';
  import { registerSheetEditor } from '$lib/worksheet';
  import { SvelteSet } from 'svelte/reactivity';
  import { getStock, saveStock, Unauthorized } from '$lib/api';
  import {
    makeable,
    suggestions,
    OPTIONAL_CATEGORIES,
    STOCK_GROUPS,
    type Category,
  } from '$lib/shared';

  let {
    userId,
    readonly = false,
    onsaved,
  }: {
    userId: string;
    /** True when the viewer may look but not tick. */
    readonly?: boolean;
    onsaved?: (stock: string[]) => void;
  } = $props();

  /** How many "buy this next" rows earn their space on a phone. */
  const SUGGESTION_COUNT = 4;

  let loaded = $state(false);
  let busy = $state(false);
  let err = $state('');
  let filter = $state('');

  /** What's ticked now, and what the server last confirmed — the diff is "unsaved". */
  const ticked = new SvelteSet<string>();
  let saved = $state<string[]>([]);

  /**
   * Counts recomputed here as they tick, from the same `$lib/shared` engine the
   * server uses.
   *
   * That isn't the duplication the endpoints warn about: a guest is *told* what's
   * pourable precisely because a guest never receives the stock, whereas this screen
   * holds the whole list already. Calling the same function on the same data cannot
   * disagree with itself, and a round trip per checkbox would make the count lag a
   * tap behind the ticking.
   */
  const stock = $derived([...ticked]);
  const pourable = $derived(makeable(stock, { ignore: OPTIONAL_CATEGORIES }));
  const nextBest = $derived(
    suggestions(stock, { ignore: OPTIONAL_CATEGORIES }).slice(0, SUGGESTION_COUNT),
  );

  const dirty = $derived(ticked.size !== saved.length || saved.some((i) => !ticked.has(i)));

  // The surrounding sheet asks before it lets anybody close it or leave the page.
  // `readonly` has nothing to lose, so it never claims to.
  registerSheetEditor({ isDirty: () => dirty && !readonly, save: () => save() });

  /**
   * Which shelf is open. `all` is the whole cupboard, and stays the default —
   * unticking something you cannot find is a worse failure than scrolling.
   */
  let shelf = $state<'all' | 'in' | Category>('all');

  /** Ticked-of-total per shelf, so the tabs double as "how far have I got". */
  const shelfCounts = $derived(
    new Map(STOCK_GROUPS.map((g) => [g.category, g.items.filter((i) => ticked.has(i)).length])),
  );

  /** Groups narrowed by the search box, empty ones dropped so no heading dangles. */
  const groups = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    // Searching crosses shelves on purpose: you type "lime" to find lime, not to
    // find lime on whichever shelf you happen to be standing at.
    if (q) {
      return STOCK_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((i) => i.toLowerCase().includes(q)),
      })).filter((g) => g.items.length > 0);
    }
    /**
     * **"In stock" — the shelf that answers "what has he actually got?"**
     *
     * Everything else here narrows by *category*, which is the right way to fill a
     * cupboard in and the wrong way to check one over. Reviewing 29 ticks spread
     * through 173 rows the night before a party meant scrolling the lot and trusting
     * your eyes. This is the same list with the noise removed.
     *
     * Empty groups are dropped so no heading dangles over nothing.
     */
    if (shelf === 'in') {
      return STOCK_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((i) => ticked.has(i)),
      })).filter((g) => g.items.length > 0);
    }
    return shelf === 'all' ? STOCK_GROUPS : STOCK_GROUPS.filter((g) => g.category === shelf);
  });

  /** Every bottle this screen can actually draw a row for. */
  const STOCKABLE_SET = new Set(STOCK_GROUPS.flatMap((g) => g.items));

  /**
   * Take a saved list, minus anything with no row to show it in.
   *
   * A cupboard can hold an ingredient the tick list has never heard of — a leftover
   * from an older recipe set, or a name that changed. It counted towards the total
   * while being invisible and impossible to untick, so the header said "30 bottles"
   * above 29 rows. Found on a seeded cupboard holding `Dark Rum`, which no recipe
   * mentions and no shelf lists.
   *
   * Dropped from `saved` as well as from `ticked`, so the two still agree and the
   * screen does not open looking unsaved. `saveStock` already discards what it
   * doesn't recognise, so the next save quietly cleans the record too.
   */
  function adopt(list: string[]): void {
    const real = list.filter((i) => STOCKABLE_SET.has(i));
    saved = real;
    ticked.clear();
    for (const i of real) ticked.add(i);
  }

  async function load(): Promise<void> {
    try {
      adopt((await getStock(userId)).stock);
      loaded = true;
    } catch (e) {
      if (!(e instanceof Unauthorized)) err = (e as Error).message || "Couldn't load the cupboard";
    }
  }

  onMount(load);

  function toggle(ingredient: string): void {
    if (readonly) return;
    if (ticked.has(ingredient)) ticked.delete(ingredient);
    else ticked.add(ingredient);
  }

  /** Returns whether it stuck: the sheet only closes on `true`. See `SheetEditor`. */
  async function save(): Promise<boolean> {
    if (busy) return false;
    busy = true;
    err = '';
    try {
      // Adopt what the server kept, not what we sent: it drops anything it doesn't
      // recognise, and pretending otherwise leaves the screen permanently dirty.
      const r = await saveStock(userId, [...ticked]);
      adopt(r.stock);
      onsaved?.(r.stock);
      return true;
    } catch (e) {
      if (!(e instanceof Unauthorized)) err = (e as Error).message || "That didn't save";
      return false;
    } finally {
      busy = false;
    }
  }

  /** Undo back to the last saved list — the escape hatch from a mis-tap spree. */
  const revert = () => adopt(saved);
</script>

<div class="cupboard">
  {#if err}<p class="says says-bad" role="status">{err}</p>{/if}

  {#if !loaded}
    <p class="empty">Loading…</p>
  {:else}
    <!--
      The count and the controls on one surface.

      They used to be two bare children sitting straight on the page background while
      everything around them was on a card, so the Save button floated between two
      panels looking like it had come adrift. They belong together anyway: the number
      is what the buttons are about.

      Sticky, so the effect of a tick is never off-screen while you work down a list
      of 173 bottles.
    -->
    <div class="panel-acts acts-sticky">
      <!--
        **"Things", not "bottles".** A third of this list is not in a bottle: mint,
        cucumber, fresh chilli, salt, black pepper, egg white, sugar cubes, olives, a
        lemon twist, a salt rim. Owain's own cupboard is mint, lemons, limes, oranges
        and espresso. "Things in" also matches the heading these screens already carry
        — "What you've got in".
      -->
      <p class="stat" aria-live="polite">
        <b>{pourable.length}</b>
        {pourable.length === 1 ? 'drink' : 'drinks'} from
        <b>{ticked.size}</b>
        {ticked.size === 1 ? 'thing' : 'things'}
      </p>

      {#if readonly}
        <span class="row-note">Their list — you can look, not change it.</span>
      {:else}
        <button type="button" class="btn btn-go" disabled={!dirty || busy} onclick={save}>
          {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
        {#if dirty}
          <button type="button" class="btn btn-quiet" disabled={busy} onclick={revert}>Undo</button>
        {/if}
      {/if}
    </div>

    {#if nextBest.length}
      <!-- The question a tick list can't answer on its own: not "what can I make"
           but "what should I buy". Only counts bottles that are the sole thing
           standing between this cupboard and a recipe. -->
      <section class="panel">
        <h2>Worth buying next</h2>
        <div class="suggests">
          {#each nextBest as s (s.ingredient)}
            <button
              type="button"
              class="btn suggest"
              disabled={readonly}
              onclick={() => toggle(s.ingredient)}
            >
              {s.ingredient}<b>+{s.unlocks}</b>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <section class="panel">
      <label class="field">
        Search
        <input
          type="search"
          bind:value={filter}
          placeholder="Gin, lime, tonic…"
          autocomplete="off"
        />
      </label>

      <!-- One shelf at a time, with the count on the tab — the same trick the bar
           screen's filter tabs pull, and for the same reason: the number *is* the
           overview, so there's nothing else to render to answer "how far have I
           got". Hidden while searching, when the shelves aren't what you're
           navigating by. -->
      {#if !filter.trim()}
        <nav class="shelf-tabs" aria-label="Shelves">
          <button
            type="button"
            class="bar-tab"
            aria-current={shelf === 'all'}
            onclick={() => (shelf = 'all')}
          >
            Everything <b>{ticked.size}</b>
          </button>
          <!-- Second, not last: checking what is in is the commoner job once a
               cupboard exists, and it should not be at the end of a scrolling row. -->
          {#if ticked.size > 0}
            <button
              type="button"
              class="bar-tab"
              aria-current={shelf === 'in'}
              onclick={() => (shelf = 'in')}
            >
              In stock <b>{ticked.size}</b>
            </button>
          {/if}
          {#each STOCK_GROUPS as group (group.category)}
            <button
              type="button"
              class="bar-tab"
              aria-current={shelf === group.category}
              onclick={() => (shelf = group.category)}
            >
              {group.label} <b>{shelfCounts.get(group.category)}/{group.items.length}</b>
            </button>
          {/each}
        </nav>
      {/if}

      {#each groups as group (group.category)}
        <h2>{group.label}</h2>
        <div class="tick-grid">
          {#each group.items as item (item)}
            <label class="tick" class:is-in={ticked.has(item)}>
              <input
                type="checkbox"
                checked={ticked.has(item)}
                disabled={readonly}
                onchange={() => toggle(item)}
              />
              <span>{item}</span>
            </label>
          {/each}
        </div>
      {/each}

      {#if groups.length === 0}
        <p class="empty">Nothing matches “{filter}”.</p>
      {/if}
    </section>

    <section class="panel">
      <h2>What that makes</h2>
      {#if pourable.length === 0}
        <p class="empty">Tick a spirit and something to mix it with.</p>
      {:else}
        <p class="pours">
          {#each pourable as r (r.id)}<span>{r.name}</span>{/each}
        </p>
      {/if}
      <p>Garnishes don't count against a drink — a missing olive shouldn't hide a Martini.</p>
    </section>
  {/if}
</div>
