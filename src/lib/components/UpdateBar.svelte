<script lang="ts">
  /**
   * "There's a new version" — offered, never taken.
   *
   * **This exists because deploying is only half of shipping.** The service worker
   * updates itself correctly, but `clients.claim()` does not reload anything, so a
   * page that is already open keeps running the JavaScript it booted with. On a
   * home-screen PWA — no address bar, no obvious reload, restored from a snapshot —
   * that can persist for days, and nothing on screen ever admits it.
   *
   * ## It asks
   *
   * The obvious implementation listens for a new worker and calls
   * `location.reload()`. That is wrong here and it is worth writing down why: this
   * app is used *while pouring*. An automatic reload could fire on a bartender
   * halfway through a round of nine, or on a guest choosing their second drink. A
   * refresh that the person did not ask for, at a party, is worse than a stale
   * build.
   *
   * So this is a prompt. Nothing reloads until somebody taps.
   *
   * The round survives it either way — the basket is written to storage on every
   * change — which is what makes offering the tap honest rather than a trap.
   *
   * ## Two triggers
   *
   * `version.pollInterval` in svelte.config.js catches a deploy that lands while the
   * app is open. `updated.check()` on becoming visible catches the far more common
   * case: the app was backgrounded for an hour, the poll timer was frozen with it,
   * and the person has just come back to it expecting the current version.
   */
  import { updated } from '$app/state';

  let busy = $state(false);

  function refresh() {
    busy = true;
    location.reload();
  }

  /** Check the moment the app is looked at again, rather than up to a minute later. */
  function onVisible() {
    if (document.visibilityState === 'visible') void updated.check();
  }
</script>

<svelte:document onvisibilitychange={onVisible} />

{#if updated.current}
  <div class="updatebar" role="status">
    <span class="updatebar-say">There's a newer version.</span>
    <button class="btn btn-go updatebar-go" type="button" disabled={busy} onclick={refresh}>
      {busy ? 'Refreshing…' : 'Refresh'}
    </button>
  </div>
{/if}
