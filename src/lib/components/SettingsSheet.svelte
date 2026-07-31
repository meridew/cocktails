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
  import { goto } from '$app/navigation';
  import { dialog } from '$lib/dialog';
  import {
    disablePush,
    enablePush,
    needsInstallFirst,
    permissionState,
    pushState,
    pushSupported,
  } from '$lib/stores/push.svelte';
  import { resetChoice } from '$lib/stores/notifyConsent.svelte';
  import { signOutOfAccount } from '$lib/api';
  import { refreshActor, session } from '$lib/stores/session.svelte';
  import InstallButton from '$lib/components/InstallButton.svelte';

  let { onclose }: { onclose: () => void } = $props();

  /**
   * **Signing out lives here now.**
   *
   * It used to be a button in the app bar's right-hand corner on `/host` and
   * `/admin` — the same corner that means "up" on every other screen, including
   * `/host/[id]`, which is one tap away from `/host`. Reaching for Back and ending
   * your session instead is not a mistake a person should be able to make.
   *
   * Settings is mounted in the root layout and its ⚙️ is in every app bar, so this is
   * reachable from more screens than it was before, not fewer.
   */
  let me = $derived(session.actor.account);
  let leaving = $state(false);

  async function leave(): Promise<void> {
    if (leaving) return;
    leaving = true;
    await signOutOfAccount().catch(() => {
      /* already gone, or offline — the local session goes either way */
    });
    await refreshActor();
    onclose();
    await goto('/', { replaceState: true });
  }

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

    {#if me}
      <div class="settings-account">
        <p class="settings-note">
          Signed in as <strong>{me.role === 'admin' ? 'admin' : 'host'}</strong>.
        </p>
        <button type="button" class="barmenu-item" disabled={leaving} onclick={leave}>
          <span>Sign out</span>
          <em>{leaving ? '…' : ''}</em>
        </button>
      </div>
    {/if}

    <button type="button" class="barmenu-close" onclick={onclose}>Close</button>
  </div>
</div>
