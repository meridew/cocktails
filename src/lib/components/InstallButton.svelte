<script lang="ts">
  import { onMount } from 'svelte';
  import { dialog } from '$lib/dialog';
  import { canInstall, isApple } from '$lib/install';

  // The Chrome/Android "you can install this PWA" event.
  type BIPEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };

  let deferred = $state<BIPEvent | null>(null);
  let installed = $state(false);
  let showTip = $state(false);

  /**
   * **The detection lives in `$lib/install` now, and that is a bug fix.**
   *
   * This file used to match `/iphone|ipad|ipod/` on the user agent while
   * `needsInstallFirst()` — the thing that decides whether to *tell* somebody to
   * install — also handled iPadOS reporting itself as a Macintosh. So on an iPad the
   * notification card said "that needs the app on your Home Screen first" and rendered
   * this button, which drew nothing at all.
   */
  const isIos = isApple();
  const canInstallHere = canInstall();

  // Chrome/Android fires `beforeinstallprompt`; iOS Safari has no install API, so the
  // fallback is a tip pointing at the Share sheet.
  let canShow = $derived(canInstallHere && !installed && (!!deferred || isIos));

  onMount(() => {
    if (!canInstallHere) return;
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the event so our button drives it
      deferred = e as BIPEvent;
    };
    const onInstalled = () => {
      installed = true;
      deferred = null;
      showTip = false;
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  });

  async function install() {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null;
    } else if (isIos) {
      showTip = true;
    }
  }
</script>

{#if canShow}
  <button type="button" class="chip chip-install" onclick={install}>📲 Install app</button>
{/if}

{#if showTip}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="install-tip"
    role="dialog"
    aria-modal="true"
    aria-label="How to install"
    tabindex="-1"
    use:dialog={{ onclose: () => (showTip = false) }}
    onclick={() => (showTip = false)}
  >
    <div class="install-tip-card" role="document">
      <h3>Add Cocktails 🍸</h3>
      <!-- "In Safari", not "On iPhone": the same words are true on an iPad, which is
           the device this whole control used to fail silently on. -->
      <p>
        In Safari, tap <strong>Share</strong> <span aria-hidden="true">⬆︎</span>, then
        <strong>Add to Home Screen</strong>.
      </p>
      <button type="button" class="send" onclick={() => (showTip = false)}>Got it</button>
    </div>
  </div>
{/if}
