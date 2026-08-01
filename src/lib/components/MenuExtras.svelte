<script lang="ts">
  /**
   * Which extras a party's menu offers — the three chips and links that sit around
   * the drinks rather than being drinks.
   *
   * Two screens use it, like [ShortList] and [Cupboard]: a host on `/host/<id>` and
   * Dan on `/admin/p/<id>`. It takes an `eventId` because *whose menu* is the
   * question, and the server checks `menu:curate` at that party, so a host reaching
   * for someone else's gets a 401 and this shows an error rather than a lie.
   *
   * ## Saved on the tap, not behind a Save button
   *
   * Unlike the short list, where the unit of work is "go through 200 drinks and then
   * commit", each switch here is a whole decision on its own. A Save button would
   * mean a host who flips one thing and closes the sheet loses it — and there is
   * nothing to review, because the list of what changed is one row long.
   *
   * So it writes on tap and shows the new state immediately, then puts it back if the
   * server disagrees. `setPartySettings` sends only the key that moved, so this can't
   * clobber a change made on another device between load and tap.
   */
  import { onMount } from 'svelte';
  import { eventMenu, setPartySettings, Unauthorized } from '$lib/api';
  import { ALL_ON, MENU_EXTRAS, type PartySettings } from '$lib/shared';

  let { eventId }: { eventId: string } = $props();

  let settings = $state<PartySettings>({ ...ALL_ON });
  let loaded = $state(false);
  /** Which key is in flight, so one row can say "…" without disabling the others. */
  let saving = $state<keyof PartySettings | null>(null);
  let err = $state('');

  onMount(async () => {
    try {
      // From the menu payload rather than a settings GET: it is the same answer the
      // guest is reading, so a host cannot be looking at switches that disagree with
      // the menu they are about to open in the next tab.
      settings = (await eventMenu(eventId)).settings;
      loaded = true;
    } catch (e) {
      if (!(e instanceof Unauthorized)) err = (e as Error).message || "Couldn't load the settings";
    }
  });

  async function flip(key: keyof PartySettings): Promise<void> {
    if (saving) return;
    const want = !settings[key];
    settings = { ...settings, [key]: want };
    saving = key;
    err = '';
    try {
      // Adopt the server's answer, not ours — same reason the short list does. If it
      // has been changed elsewhere, this is the moment we find out.
      settings = (await setPartySettings(eventId, { [key]: want })).settings;
    } catch (e) {
      settings = { ...settings, [key]: !want }; // put it back; nothing was stored
      if (!(e instanceof Unauthorized)) err = (e as Error).message || "That didn't save";
    } finally {
      saving = null;
    }
  }

  const onCount = $derived(MENU_EXTRAS.filter((x) => settings[x.key]).length);
</script>

<div class="extras">
  {#if err}<p class="says says-bad" role="status">{err}</p>{/if}

  {#if !loaded}
    <p class="empty">Loading…</p>
  {:else}
    <p class="stat" aria-live="polite">
      <b>{onCount}</b> of {MENU_EXTRAS.length} on
    </p>

    <p class="empty">
      These sit around the drinks rather than being drinks. Turning one off takes it off your
      guests' menus straight away, including phones already open on it.
    </p>

    <div class="switches">
      {#each MENU_EXTRAS as x (x.key)}
        {@const on = settings[x.key]}
        <button
          type="button"
          class="switch-row"
          class:is-on={on}
          role="switch"
          aria-checked={on}
          disabled={saving !== null}
          onclick={() => flip(x.key)}
        >
          <span class="switch-main">
            <span class="switch-name">
              <span class="emoji" aria-hidden="true">{x.emoji}</span>
              {x.label}
            </span>
            <span class="row-note">{x.note}</span>
          </span>
          <span class="switch-pip">{saving === x.key ? '…' : on ? 'On' : 'Off'}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
