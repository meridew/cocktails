<script lang="ts">
  /**
   * What a party leads with — the short list, ticked out of what the cupboard pours.
   *
   * **Curation is optional, and this screen has to keep saying so.** An empty list is
   * the default and a working menu: guests land on the whole generated list instead.
   * That is why nothing here nags, and why "Feature nothing" is a button rather than
   * something you reach by untucking every tick.
   *
   * Two screens use it, like [Cupboard]: a host curating their own party from
   * `/host/<id>`, and Dan doing it for them from `/admin`. It takes an `eventId` for
   * the same reason the cupboard takes a `userId` — *whose* list is the question, and
   * the callers answer it differently. The server checks `menu:curate` at that party,
   * so a host reaching for someone else's gets a 404 and this renders nothing.
   *
   * The choices come from the menu endpoint rather than from `RECIPES`, so the board
   * can only ever offer drinks the party can actually pour. A host who takes the gin
   * out of their cupboard loses those rows here too, and the endpoint drops them from
   * a saved list rather than refusing it.
   */
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { eventMenu, setShortList, Unauthorized, type MenuItem } from '$lib/api';
  import { groupByBase } from '$lib/menu';
  import { registerSheetEditor } from '$lib/worksheet';

  let { eventId }: { eventId: string } = $props();

  let loaded = $state(false);
  let busy = $state(false);
  let err = $state('');
  let filter = $state('');

  let items = $state<MenuItem[]>([]);
  let source = $state<'cupboard' | 'house'>('house');

  /** What's ticked now, and what the server last confirmed — the diff is "unsaved". */
  const ticked = new SvelteSet<string>();
  let saved = $state<string[]>([]);

  /**
   * How many ticks differ from the server, in both directions.
   *
   * Counted rather than merely flagged because the action bar has to *say* it. "Save"
   * being enabled was the only sign anything was pending, and that sign was the one
   * control that scrolled off the screen — so from the second flick onwards there was
   * nothing anywhere admitting there was work to lose.
   */
  const pending = $derived.by(() => {
    const was = new Set(saved);
    let n = 0;
    for (const id of ticked) if (!was.has(id)) n++;
    for (const id of was) if (!ticked.has(id)) n++;
    return n;
  });
  const dirty = $derived(pending > 0);

  // The surrounding sheet asks before it lets anybody close it or leave the page.
  registerSheetEditor({ isDirty: () => dirty, save: () => save() });

  /** Grouped by base spirit and searchable, because this can be 200 rows. */
  const groups = $derived(groupByBase(items, filter));

  function adopt(list: string[]): void {
    saved = list;
    ticked.clear();
    for (const id of list) ticked.add(id);
  }

  onMount(async () => {
    try {
      const menu = await eventMenu(eventId);
      items = menu.items;
      source = menu.source;
      adopt(menu.shortList);
      loaded = true;
    } catch (e) {
      if (!(e instanceof Unauthorized)) err = (e as Error).message || "Couldn't load the menu";
    }
  });

  function toggle(id: string): void {
    if (ticked.has(id)) ticked.delete(id);
    else ticked.add(id);
  }

  /** Returns whether it stuck: the sheet only closes on `true`. See `SheetEditor`. */
  async function save(): Promise<boolean> {
    if (busy) return false;
    busy = true;
    err = '';
    try {
      // Adopt what the server kept rather than what we sent — it drops ids that have
      // fallen off the menu, and pretending otherwise leaves the screen permanently
      // dirty.
      adopt((await setShortList(eventId, [...ticked])).shortList);
      return true;
    } catch (e) {
      if (!(e instanceof Unauthorized)) err = (e as Error).message || "That didn't save";
      return false;
    } finally {
      busy = false;
    }
  }

  const revert = () => adopt(saved);
</script>

<div class="shortlist">
  {#if err}<p class="says says-bad" role="status">{err}</p>{/if}

  {#if !loaded}
    <p class="empty">Loading…</p>
  {:else}
    <!--
      **Sticky, which it was not, and that was the whole bug.**

      The count and the Save button used to be two separate blocks at the top of a
      list up to 200 rows long. Both scrolled away on the first flick, leaving the
      sheet's own "Done" as the only control on screen — and "Done" discarded. The
      cupboard already solved this and this file never got the same treatment; now
      they share `.acts-sticky`.

      The count moved *into* the bar for the same reason: what you have done and what
      it will take to keep it are one thought, and neither is any use out of sight.
    -->
    <div class="panel-acts acts-sticky">
      <p class="stat" aria-live="polite">
        {#if ticked.size === 0}
          <b>{items.length}</b> drinks · guests see them all
        {:else}
          <b>{ticked.size}</b> featured of <b>{items.length}</b>
        {/if}
        {#if dirty}
          <span class="unsaved">{pending} unsaved</span>
        {/if}
      </p>

      <button type="button" class="btn btn-go" disabled={!dirty || busy} onclick={save}>
        {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
      </button>
      {#if dirty}
        <button type="button" class="btn btn-quiet" disabled={busy} onclick={revert}>Undo</button>
      {/if}
      {#if ticked.size > 0}
        <!-- "Feature" is our verb for the short list, not a word a host would reach
             for. This button clears every tick, and clearing every tick is what makes
             guests see everything — so say that. -->
        <button type="button" class="btn" disabled={busy} onclick={() => ticked.clear()}>
          Show them everything
        </button>
      {/if}
    </div>

    <p class="empty">
      {#if source === 'house'}
        This party has no cupboard behind it yet, so these are the six house drinks. Fill the
        cupboard in and this list grows.
      {:else}
        Tick what the bar will make. Leave it empty and guests get the lot — they can always search
        or ask to be walked through it.
      {/if}
    </p>

    <label class="field">
      Search
      <input type="search" bind:value={filter} placeholder="Negroni, gin…" autocomplete="off" />
    </label>

    {#each groups as group (group.base)}
      <h2>{group.base}</h2>
      <div class="tick-grid">
        {#each group.list as item (item.id)}
          <label class="tick" class:is-in={ticked.has(item.id)}>
            <input type="checkbox" checked={ticked.has(item.id)} onchange={() => toggle(item.id)} />
            <span>{item.name}</span>
          </label>
        {/each}
      </div>
    {/each}

    {#if groups.length === 0}
      <p class="empty">
        {filter
          ? `Nothing matches “${filter}”.`
          : 'Nothing can be made yet — fill in the cupboard.'}
      </p>
    {/if}
  {/if}
</div>
