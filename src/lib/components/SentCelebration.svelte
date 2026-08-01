<script lang="ts">
  /**
   * "Order sent" confirmation, and the one place a guest is offered notifications
   * — the moment they actually care about being told when the drink is ready.
   * Owning the push opt-in here keeps that concern out of the app shell.
   */
  import { dialog } from '$lib/dialog';
  import { enablePush, pushSupported, pushState } from '$lib/stores/push.svelte';
  import InstallPrompt from '$lib/components/InstallPrompt.svelte';

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
    <p class="celebrate-msg">Sent to the bar. 🍹</p>
    {#if canOffer}
      {#if notify === 'on'}
        <p class="notify-on">🔔 You'll get a buzz when it's ready.</p>
      {:else if notify === 'denied'}
        <p class="notify-note">Notifications are blocked — enable them in your browser settings.</p>
      {:else if notify === 'disabled'}
        <p class="notify-note">Notifications aren't switched on at the bar.</p>
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
    <!--
      **The one moment installing is worth proposing to a guest.**

      They have just got value out of this and will plausibly want a second round —
      "keep it handy" is true here in a way it simply was not on the menubar, where a
      permanent chip met people who had not yet seen a drink. Offered once, remembered
      if declined, and always reachable again from Settings.
    -->
    <InstallPrompt who="guest" reason="Ordering another later? Keep this on your Home Screen." />

    <button type="button" class="send" onclick={onclose}>Start another 🍸</button>
  </div>
</div>
