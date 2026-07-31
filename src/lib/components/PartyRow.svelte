<script lang="ts">
  /**
   * One party in a list, on the admin desk.
   *
   * Shared because it appears in two lists — grouped by state on `/admin`, and under
   * a host on `/admin/h/<id>` — and `by` says which, because that decides what the
   * row must *not* repeat. Under an "On now" heading the status pill is noise on
   * every row; in a host's own list the statuses are mixed and the pill is the point,
   * while the host's name is the thing already known.
   *
   * The body is a link now rather than a button setting `openParty`. That is the
   * whole of step 6 in miniature: the drill-down was component state, so Back left
   * the desk entirely — verified once by opening a party and landing on `/bar`.
   */
  import type { Host, Party } from '$lib/api';

  let {
    party,
    by,
    host,
    busy = false,
    onopen,
    onwork,
  }: {
    party: Party;
    by: 'status' | 'host';
    /** Only needed when the list spans hosts, i.e. `by === 'status'`. */
    host?: Host;
    busy?: boolean;
    /** Take a bar session and go — only offered for a live party. */
    onwork: (party: Party) => void;
    /** Open it — only offered for one not yet live. */
    onopen: (party: Party) => void;
  } = $props();

  const STATUS_WORD = { draft: 'Not open', live: 'On now', done: 'Finished' } as const;

  const when = (ms: number | null): string =>
    ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'no date';

  /**
   * The line under the name, built here rather than in the markup.
   *
   * Assembling it from `{#if}` blocks inline put the separator's whitespace at the
   * mercy of the formatter, which reflowed it onto its own line and shipped
   * "Sam ·no date". A string is a string.
   */
  const note = $derived(
    [by === 'status' ? (host?.name ?? 'unknown host') : '', when(party.startsAt)]
      .filter(Boolean)
      .join(' · '),
  );
</script>

<div class="row">
  <a class="row-open" href="/admin/p/{party.id}">
    <span class="row-name">{party.name}</span>
    <span class="row-note">{note}</span>
  </a>
  <span class="row-acts">
    {#if by === 'host'}
      <span
        class="pill"
        class:pill-live={party.status === 'live'}
        class:pill-done={party.status === 'done'}
      >
        {STATUS_WORD[party.status]}
      </span>
    {/if}
    {#if party.status === 'live'}
      <button class="btn btn-go" type="button" disabled={busy} onclick={() => onwork(party)}>
        Work it
      </button>
    {:else if party.status === 'draft'}
      <button class="btn btn-go" type="button" disabled={busy} onclick={() => onopen(party)}>
        Open
      </button>
    {/if}
  </span>
</div>
