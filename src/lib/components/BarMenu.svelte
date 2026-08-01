<script lang="ts">
  /**
   * The bar's overflow menu: everything that isn't the moment-to-moment work.
   *
   * Five permanently-visible chips were costing ~100px of a 812px phone screen —
   * an eighth of the display — for controls used once or twice a night. They live
   * behind one button now, and the space goes back to orders.
   */
  import { dialog } from '$lib/dialog';

  let {
    canManageStaff,
    pendingStaff,
    sort,
    pushLabel,
    onstaff,
    onsort,
    onpush,
    onclearDone,
    onsignout,
    onclose,
  }: {
    canManageStaff: boolean;
    pendingStaff: number;
    sort: 'oldest' | 'newest';
    /** null when push can't be offered at all on this device. */
    pushLabel: string | null;
    onstaff: () => void;
    onsort: () => void;
    onpush: () => void;
    onclearDone: () => void;
    onsignout: () => void;
    onclose: () => void;
  } = $props();

  /** Run an action and close, so the menu never lingers over the queue. */
  const pick = (fn: () => void) => () => {
    fn();
    onclose();
  };
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="barmenu"
  role="dialog"
  aria-modal="true"
  aria-label="Bar options"
  tabindex="-1"
  use:dialog={{ onclose }}
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div class="barmenu-sheet">
    <h3>Bar options</h3>

    {#if canManageStaff}
      <button type="button" class="barmenu-item" onclick={pick(onstaff)}>
        <span>Bar staff</span>
        {#if pendingStaff}
          <b class="barmenu-badge">{pendingStaff} waiting</b>
        {/if}
      </button>
    {/if}

    <button type="button" class="barmenu-item" onclick={pick(onsort)}>
      <span>Sort by</span>
      <em>{sort === 'oldest' ? 'Oldest first' : 'Newest first'}</em>
    </button>

    {#if pushLabel}
      <button type="button" class="barmenu-item" onclick={pick(onpush)}>
        <span>Notifications</span>
        <em>{pushLabel}</em>
      </button>
    {/if}

    <button type="button" class="barmenu-item" onclick={pick(onclearDone)}>
      <span>Clear finished orders</span>
    </button>

    <!-- **"End my shift", not "Log out".** Two different sign-outs exist now — this
         one drops the bar session, and Settings drops the account. Calling both
         "log out" made the smaller one look like the bigger one, which is a bad
         surprise for a helper who only wanted to hand the phone back. -->
    <button type="button" class="barmenu-item is-danger" onclick={pick(onsignout)}>
      <span>End my shift</span>
    </button>

    <button type="button" class="barmenu-close" onclick={onclose}>Close</button>
  </div>
</div>
