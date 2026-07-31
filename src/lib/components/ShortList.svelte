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
  const dirty = $derived(ticked.size !== saved.length || saved.some((id) => !ticked.has(id)));

  /** Grouped by base spirit and searchable, because this can be 200 rows. */
  const groups = $derived.by(() => {
    const q = filter.trim().toLowerCase();
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

  async function save(): Promise<void> {
    if (busy) return;
    busy = true;
    err = '';
    try {
      // Adopt what the server kept rather than what we sent — it drops ids that have
      // fallen off the menu, and pretending otherwise leaves the screen permanently
      // dirty.
      adopt((await setShortList(eventId, [...ticked])).shortList);
    } catch (e) {
      if (!(e instanceof Unauthorized)) err = (e as Error).message || "That didn't save";
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
    <p class="stat" aria-live="polite">
      {#if ticked.size === 0}
        <b>{items.length}</b> drinks · guests see them all
      {:else}
        <b>{ticked.size}</b> featured of <b>{items.length}</b>
      {/if}
    </p>

    <p class="empty">
      {#if source === 'house'}
        This party has no cupboard behind it yet, so these are the six house drinks. Fill the
        cupboard in and this list grows.
      {:else}
        Tick the ones to lead with. Leave it empty and guests get the lot — they can always search
        or ask to be walked through it.
      {/if}
    </p>

    <div class="row-acts">
      <button type="button" class="btn btn-go" disabled={!dirty || busy} onclick={save}>
        {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
      </button>
      {#if dirty}
        <button type="button" class="btn" disabled={busy} onclick={revert}>Undo</button>
      {/if}
      {#if ticked.size > 0}
        <button type="button" class="btn" disabled={busy} onclick={() => ticked.clear()}>
          Feature nothing
        </button>
      {/if}
    </div>

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
        {filter ? `Nothing matches “${filter}”.` : 'Nothing is pourable — fill in the cupboard.'}
      </p>
    {/if}
  {/if}
</div>
