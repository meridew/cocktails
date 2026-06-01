<script lang="ts">
  import { onMount } from 'svelte';
  import { Capacitor } from '@capacitor/core';

  // The Chrome/Android "you can install this PWA" event.
  type BIPEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };

  let deferred = $state<BIPEvent | null>(null);
  let installed = $state(false);
  let showTip = $state(false);

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isNative = Capacitor.isNativePlatform();
  const standalone =
    (typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches) ||
    (typeof navigator !== 'undefined' &&
      (navigator as unknown as { standalone?: boolean }).standalone === true);

  // Show on the web when installable: Chrome/Android fires beforeinstallprompt;
  // iOS Safari has no install API, so we offer an "Add to Home Screen" tip.
  let canShow = $derived(!isNative && !standalone && !installed && (!!deferred || isIos));

  onMount(() => {
    if (isNative || standalone) return;
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
    onclick={() => (showTip = false)}
  >
    <div class="install-tip-card" role="document">
      <h3>Install Cocktails 🍸</h3>
      <p>In Safari, tap <strong>Share</strong> <span aria-hidden="true">⬆︎</span>, then <strong>Add to Home Screen</strong>.</p>
      <button type="button" class="send" onclick={() => (showTip = false)}>Got it</button>
    </div>
  </div>
{/if}
