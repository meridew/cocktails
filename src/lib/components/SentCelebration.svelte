<script lang="ts">
  /**
   * "Order sent" confirmation, and the one place a guest is offered notifications
   * — the moment they actually care about being told when the drink is ready.
   * Owning the push opt-in here keeps that concern out of the app shell.
   */
  import { dialog } from '$lib/dialog';
  import { enablePush, pushSupported, pushState } from '$lib/stores/push.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let notify = $derived(pushState('guest'));
  let canOffer = $derived(pushSupported() && notify !== 'unsupported');
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="celebrate"
  role="dialog"
  aria-modal="true"
  aria-label="Order sent"
  tabindex="-1"
  use:dialog={{ onclose }}
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div class="celebrate-card">
    <h2>Cheers! 🥂</h2>
    <p class="celebrate-msg">Your drinks are <strong>on the way</strong>. 🍹</p>
    {#if canOffer}
      {#if notify === 'on'}
        <p class="notify-on">🔔 You'll get a buzz when it's ready.</p>
      {:else if notify === 'denied'}
        <p class="notify-note">Notifications are blocked — enable them in your browser settings.</p>
      {:else if notify === 'disabled'}
        <p class="notify-note">Notifications aren't switched on at the bar tonight.</p>
      {:else}
        <button
          type="button"
          class="notify-btn"
          onclick={() => enablePush('guest')}
          disabled={notify === 'working'}
        >
          {notify === 'working'
            ? 'Enabling…'
            : notify === 'error'
              ? '🔔 Try again'
              : '🔔 Notify me when ready'}
        </button>
      {/if}
    {/if}
    <button type="button" class="send" onclick={onclose}>Start another 🍸</button>
  </div>
</div>
