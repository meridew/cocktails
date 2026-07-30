<script lang="ts">
  /**
   * The notification opt-in, asked once at the start.
   *
   * Deliberately two stages. The browser's permission prompt is a *one-shot,
   * irreversible* resource: a dismissal blocks notifications permanently and can
   * only be undone in site settings, which nobody does. So this card is ours — free
   * to show, free to decline, and re-askable from Settings — and the real prompt
   * only fires from the tap on "Yes", which is both a user gesture (required by
   * Safari) and a moment of stated intent, so it's very likely to be granted.
   *
   * On iPhone there's an extra step: iOS only supports Web Push for Home Screen
   * apps, so a prompt in a Safari tab cannot appear at all. There we ask them to
   * install first rather than firing something that silently fails.
   */
  import { enablePush, needsInstallFirst, pushSupported } from './push.svelte';
  import { notifyConsent, recordChoice } from './notifyConsent.svelte';
  import InstallButton from './InstallButton.svelte';

  let busy = $state(false);
  let installNeeded = $derived(needsInstallFirst());

  async function accept() {
    if (busy) return;
    busy = true;
    // Record first: whatever the browser decides, we've had our answer and must
    // not ask again on the next load.
    recordChoice('accepted');
    await enablePush('guest');
    busy = false;
  }
</script>

{#if notifyConsent.shouldAsk && (pushSupported() || installNeeded)}
  <section class="optin" aria-label="Notifications">
    {#if installNeeded}
      <h3>🔔 Want a nudge when your drink’s ready?</h3>
      <p>
        On iPhone that needs the app on your Home Screen first — then we can let you know without
        you watching the screen.
      </p>
      <div class="optin-actions">
        <InstallButton />
        <button type="button" class="optin-no" onclick={() => recordChoice('declined')}>
          Not now
        </button>
      </div>
    {:else}
      <h3>🔔 Want a nudge when your drink’s ready?</h3>
      <p>Only about your own order. You can turn it off any time in Settings.</p>
      <div class="optin-actions">
        <button type="button" class="optin-yes" disabled={busy} onclick={accept}>
          {busy ? 'Setting up…' : 'Yes, notify me'}
        </button>
        <button
          type="button"
          class="optin-no"
          disabled={busy}
          onclick={() => recordChoice('declined')}
        >
          Not now
        </button>
      </div>
    {/if}
  </section>
{/if}
