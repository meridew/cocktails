<script lang="ts">
  /**
   * Settings for this device: notifications, party sounds, and your photo.
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
  import { version } from '$app/environment';
  import { onMount } from 'svelte';
  import { RefreshCw, Send } from '@lucide/svelte';
  import { dialog } from '$lib/dialog';
  import {
    disablePush,
    enablePush,
    needsInstallFirst,
    permissionState,
    notificationDiagnostics,
    pushState,
    pushSupported,
    runNotificationTest,
    type PushDiagnostics,
  } from '$lib/stores/push.svelte';
  import { resetChoice } from '$lib/stores/notifyConsent.svelte';
  import { putGuestPhoto, signOutOfAccount } from '$lib/api';
  import { refreshActor, session } from '$lib/stores/session.svelte';
  import { currentEventId } from '$lib/party';
  import { getDeviceId } from '$lib/device';
  import { photoId as hashOf, rememberPhotoSent } from '$lib/photo';
  import { muteSounds, soundsMuted } from '$lib/sound';
  import InstallButton from '$lib/components/InstallButton.svelte';
  import PhotoPicker from '$lib/components/PhotoPicker.svelte';

  let { onclose }: { onclose: () => void } = $props();

  /** Read once on open: `localStorage` isn't reactive, and nothing else writes it. */
  let quiet = $state(soundsMuted());

  /**
   * When this build was made, in the reader's own timezone.
   *
   * SvelteKit's `version` defaults to the build timestamp, so it is already the
   * number we want and there is nothing to maintain. Rendered as a date because
   * "1785580553118" answers nobody's question, and left raw if a future config sets
   * a name instead of a stamp.
   */
  const stamp = /^\d+$/.test(version)
    ? new Date(Number(version)).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : version;

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

  /**
   * Push a changed photo to the party this device is at, straight away.
   *
   * Without this it would take until the next menu load for the bar to see it, and
   * "I've just added my photo, why doesn't it show" is a reasonable thing to think.
   * Nothing to do if this device isn't at a party — the picture is still saved
   * locally and goes out on the next join.
   */
  async function onPhotoChange(photo: string | null): Promise<void> {
    const eventId = currentEventId();
    if (!eventId) return;
    const id = photo ? await hashOf(photo) : null;
    await putGuestPhoto(eventId, getDeviceId(), photo, id)
      .then(() => rememberPhotoSent(eventId, id))
      .catch(() => {
        /* offline — the local copy stands and the next join carries it */
      });
  }

  let busy = $state(false);
  let guest = $derived(pushState('guest'));
  let bartender = $derived(pushState('bartender'));
  /** On if this device is registered for anything at all. */
  let on = $derived(guest === 'on' || bartender === 'on');
  let diagnostics = $state<PushDiagnostics | null>(null);
  let checking = $state(false);
  let testing = $state(false);
  let testResult = $state('');

  async function checkDevice(): Promise<void> {
    checking = true;
    diagnostics = await notificationDiagnostics().catch(() => null);
    checking = false;
  }

  async function testDevice(): Promise<void> {
    if (testing) return;
    testing = true;
    testResult = 'Sending test…';
    try {
      const result = await runNotificationTest();
      testResult =
        result.status === 'displayed' || result.status === 'clicked'
          ? 'Displayed on this device.'
          : result.status === 'accepted'
            ? 'Accepted by the push service; display is not confirmed.'
            : result.status === 'received'
              ? 'Received by the app; display is not confirmed.'
              : result.status === 'queued'
                ? 'Still queued. Check again in a moment.'
                : result.status === 'expired'
                  ? 'The test expired before provider acceptance.'
                  : 'The provider rejected this test.';
      await checkDevice();
    } catch (error) {
      testResult = (error as Error).message;
    } finally {
      testing = false;
    }
  }

  onMount(() => {
    if (on) void checkDevice();
  });

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

    {#if on}
      <section class="notification-diagnostics" aria-labelledby="notification-device-title">
        <div class="diagnostic-heading">
          <h4 id="notification-device-title">This device</h4>
          <button
            type="button"
            class="icon-action"
            aria-label="Refresh notification diagnostics"
            title="Refresh diagnostics"
            disabled={checking}
            onclick={checkDevice}
          >
            <span class:spin={checking}><RefreshCw size={18} /></span>
          </button>
        </div>
        <dl>
          <div>
            <dt>Permission</dt>
            <dd>{diagnostics?.permission ?? 'Checking…'}</dd>
          </div>
          <div>
            <dt>Browser subscription</dt>
            <dd>
              {diagnostics ? (diagnostics.localSubscription ? 'Present' : 'Missing') : 'Checking…'}
            </dd>
          </div>
          <div>
            <dt>Server registration</dt>
            <dd>
              {diagnostics ? (diagnostics.server?.registered ? 'Present' : 'Missing') : 'Checking…'}
            </dd>
          </div>
        </dl>
        <button type="button" class="notification-test" disabled={testing} onclick={testDevice}>
          <Send size={17} />
          <span>{testing ? 'Testing…' : 'Send test notification'}</span>
        </button>
        {#if testResult}<p class="settings-note" aria-live="polite">{testResult}</p>{/if}
        <p class="settings-note">
          {diagnostics?.platform === 'ios'
            ? 'If alerts are missing, check iPhone Settings → Notifications, Focus and Scheduled Summary for this Home Screen app.'
            : diagnostics?.platform === 'android'
              ? 'If alerts are missing, check the site notification channel and remove battery restrictions for your browser.'
              : 'If alerts are missing, check this site in your browser and operating-system notification settings.'}
        </p>
      </section>
    {/if}

    <!--
      **The way back in for everyone who said no.**

      The photo is asked for exactly once, on the way into a party, and there is no
      second prompt — nobody should be nagged for their face. So this is where it
      lives afterwards: change it, add one late, or take it back.

      It sits on the device rather than on one party, so a picture taken at Owain's is
      offered at Sam's without being asked for again. Removing it here stops it being
      offered anywhere; parties that already have a copy keep it until the next join
      clears them, which is the honest tradeoff of not holding a list of every bar
      this phone has ever visited.
    -->
    <!--
      **Party sounds, off.**

      A host can put their own voice on arriving, ordering and sending, and most people
      will want to hear it. But a phone that starts talking in a pocket is its own
      problem, and there is no way for the host to know whose room is quiet — so the
      answer lives on the device, next to the other thing this sheet exists for.

      It says nothing about whether *this* party has any: the switch is about what this
      phone is willing to do, and a party with no recordings simply stays silent
      either way.
    -->
    <button
      type="button"
      class="barmenu-item"
      role="switch"
      aria-checked={!quiet}
      onclick={() => {
        quiet = !quiet;
        muteSounds(quiet);
      }}
    >
      <span>Party sounds</span>
      <em>{quiet ? 'Off' : 'On'}</em>
    </button>
    <p class="settings-note">
      {quiet
        ? "You won't hear anything your host recorded."
        : 'Short clips your host recorded, if they made any.'}
    </p>
    <p class="settings-note">
      Party sounds play only while the app is open. They cannot override silent mode, Focus,
      notification summaries or Android notification-channel settings.
    </p>

    <div class="settings-account">
      <p class="settings-note">Your photo</p>
      <PhotoPicker onchange={onPhotoChange} />
      <p class="settings-note">
        Optional, and only the bar sees it — it helps them find you when your drink's ready.
      </p>
    </div>

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

    <!--
      **Which version is this?**

      Written after an afternoon of not being able to answer that. Phones were stuck
      on an old build, three plausible causes were each disproved in turn, and every
      check came down to "can you see a feature that only exists in the new one" —
      which needs somebody to know what shipped when, and is useless to a guest.

      A date on the screen turns that into a five-second question. It is deliberately
      the last thing in this sheet and deliberately quiet: nobody needs it until they
      need it badly.
    -->
    <p class="settings-note settings-build">Version {stamp}</p>

    <button type="button" class="barmenu-close" onclick={onclose}>Close</button>
  </div>
</div>

<style>
  .notification-diagnostics {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 2px solid var(--line);
  }

  .diagnostic-heading,
  .notification-diagnostics dl > div,
  .notification-test {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .diagnostic-heading h4 {
    margin: 0;
    font-size: 1rem;
  }

  .icon-action {
    display: grid;
    width: 2.25rem;
    height: 2.25rem;
    place-items: center;
    border: 2px solid currentColor;
    background: transparent;
  }

  .notification-diagnostics dl {
    margin: 0.75rem 0;
  }

  .notification-diagnostics dl > div {
    min-height: 2rem;
    border-bottom: 1px solid color-mix(in srgb, currentColor 24%, transparent);
  }

  .notification-diagnostics dt,
  .notification-diagnostics dd {
    margin: 0;
    font-size: 0.82rem;
  }

  .notification-diagnostics dd {
    font-weight: 700;
    text-align: right;
  }

  .notification-test {
    width: 100%;
    min-height: 2.75rem;
    justify-content: center;
    border: 2px solid currentColor;
    background: var(--send-bg);
    font: inherit;
    font-weight: 700;
  }

  .spin {
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
