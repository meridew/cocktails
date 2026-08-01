<script lang="ts">
  /**
   * The notification opt-in: a one-time modal on first visit, adjustable in
   * Settings afterwards.
   *
   * Deliberately two stages. The browser's permission prompt is a *one-shot,
   * irreversible* resource: a dismissal blocks notifications permanently and can
   * only be undone in site settings, which nobody does. So this modal is ours —
   * free to show, free to decline, and re-openable from Settings — and the real
   * prompt only fires from the tap on "Yes", which is both a user gesture (required
   * by Safari) and a moment of stated intent, so it's very likely to be granted.
   *
   * On iPhone there's an extra step: iOS only supports Web Push for Home Screen
   * apps, so a prompt in a Safari tab cannot appear at all. There we ask them to
   * install first rather than firing something that silently fails.
   *
   * Any dismissal — either button, Escape, or the backdrop — counts as the answer,
   * so it never nags on the next load. Settings is the way back.
   */
  import { dialog } from '$lib/dialog';
  import { enablePush, needsInstallFirst, pushSupported } from '$lib/stores/push.svelte';
  import { notifyConsent, recordChoice } from '$lib/stores/notifyConsent.svelte';
  import { arrival } from '$lib/stores/arrival.svelte';
  import InstallButton from '$lib/components/InstallButton.svelte';

  let busy = $state(false);
  let installNeeded = $derived(needsInstallFirst());
  /**
   * **Waits for the arrival panel.** This card is in the root layout and used to ask
   * only "have we asked before, and could the browser still prompt" — nothing about
   * what else was on screen. A guest opening a party link for the first time got the
   * inline "Who's this?" *and* this modal over it: two decisions before seeing a
   * drink. See `arrival.svelte.ts`.
   */
  let show = $derived(
    notifyConsent.shouldAsk && !arrival.arriving && (pushSupported() || installNeeded),
  );

  async function accept() {
    if (busy) return;
    busy = true;
    // Record first: whatever the browser then decides, we've had our answer and
    // must not ask again on the next load.
    recordChoice('accepted');
    await enablePush('guest');
    busy = false;
  }

  /** Anything other than "yes" is a decline — recoverable from Settings. */
  const decline = () => recordChoice('declined');
</script>

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="optin-scrim"
    role="dialog"
    aria-modal="true"
    aria-labelledby="optin-title"
    tabindex="-1"
    use:dialog={{ onclose: decline }}
    onclick={(e) => {
      if (e.target === e.currentTarget) decline();
    }}
  >
    <section class="optin">
      <h3 id="optin-title">🔔 Want a nudge when your drink’s ready?</h3>
      {#if installNeeded}
        <p>
          On iPhone that needs the app on your Home Screen first — then we can let you know without
          you watching the screen.
        </p>
        <div class="optin-actions">
          <InstallButton />
          <button type="button" class="optin-no" onclick={decline}>Not now</button>
        </div>
      {:else}
        <!--
          **This used to say "Only about your own order", and that was false.**

          This card is mounted in the root layout, so it can be read on any screen —
          including the bar, where party-scoped bartender delivery sends a push for
          that party's drinks. It also broke retroactively: accepting as a guest and
          later working a bar triggers `enableIfPermitted('bartender')`, so the
          promise expired even where it had been true when read.
        -->
        <p>
          When your drink's ready — and every order, if you end up behind the bar. You can change
          this any time in Settings.
        </p>
        <div class="optin-actions">
          <button type="button" class="optin-yes" disabled={busy} onclick={accept}>
            {busy ? 'Setting up…' : 'Yes, notify me'}
          </button>
          <button type="button" class="optin-no" disabled={busy} onclick={decline}>Not now</button>
        </div>
      {/if}
    </section>
  </div>
{/if}
