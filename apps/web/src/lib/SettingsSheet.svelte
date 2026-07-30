<script lang="ts">
  /**
   * Settings. One switch today — notifications on or off for this device.
   *
   * "Off" isn't a preference the server consults before sending; it's the absence
   * of a subscription. Web Push is `userVisibleOnly`, so a push that arrives *must*
   * display something — filtering later would just swap our notification for the
   * browser's "site updated in the background". So off means unsubscribe, and the
   * server has nowhere to send.
   *
   * Turning it back on doesn't re-prompt: browser permission survives, so this is
   * a one-tap toggle after the first grant.
   */
  import { dialog } from './dialog.ts';
  import {
    disablePush,
    enablePush,
    needsInstallFirst,
    permissionState,
    pushState,
    pushSupported,
  } from './push.svelte';
  import { resetChoice } from './notifyConsent.svelte';
  import InstallButton from './InstallButton.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let busy = $state(false);
  let guest = $derived(pushState('guest'));
  let bartender = $derived(pushState('bartender'));
  /** On if this device is registered for anything at all. */
  let on = $derived(guest === 'on' || bartender === 'on');

  /**
   * Why the switch can't be used, or null when it can. Being specific matters:
   * "blocked" and "not supported here" need completely different actions from the
   * user, and a single greyed-out toggle explains neither.
   */
  let blockedReason = $derived(
    needsInstallFirst()
      ? 'install'
      : !pushSupported()
        ? 'unsupported'
        : permissionState() === 'denied'
          ? 'denied'
          : guest === 'disabled'
            ? 'server'
            : null,
  );

  async function toggle() {
    if (busy || blockedReason) return;
    busy = true;
    if (on) {
      await disablePush();
      // They've made a fresh decision, so the opt-in card is allowed to return.
      resetChoice();
    } else {
      await enablePush('guest');
    }
    busy = false;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="barmenu"
  role="dialog"
  aria-modal="true"
  aria-label="Settings"
  tabindex="-1"
  use:dialog={{ onclose }}
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div class="barmenu-sheet">
    <h3>Settings</h3>

    <button
      type="button"
      class="barmenu-item"
      role="switch"
      aria-checked={on}
      disabled={busy || !!blockedReason}
      onclick={toggle}
    >
      <span>Notifications</span>
      <em>{busy ? '…' : on ? 'On' : 'Off'}</em>
    </button>

    {#if blockedReason === 'install'}
      <p class="settings-note">
        iPhone only allows notifications for apps on the Home Screen. Add it, then turn this on.
      </p>
      <InstallButton />
    {:else if blockedReason === 'denied'}
      <p class="settings-note">
        Your browser is blocking notifications for this site. We can’t re-ask from here — you’ll
        need to allow them in your browser’s site settings.
      </p>
    {:else if blockedReason === 'unsupported'}
      <p class="settings-note">This browser can’t do notifications.</p>
    {:else if blockedReason === 'server'}
      <p class="settings-note">Notifications aren’t set up on the bar’s server.</p>
    {:else}
      <p class="settings-note">
        {on
          ? 'You’ll hear when your drink is being made and when it’s ready.'
          : 'Turn this on to hear when your drink is ready.'}
      </p>
    {/if}

    <button type="button" class="barmenu-close" onclick={onclose}>Close</button>
  </div>
</div>
