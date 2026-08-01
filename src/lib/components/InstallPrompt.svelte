<script lang="ts">
  /**
   * "Put this on your Home Screen" — offered once, to the person it is worth it for.
   *
   * ## What this replaced
   *
   * A permanent `📲 Install app` chip in every guest's menubar, sitting between "Help
   * me choose" and "Surprise" as though it were another way to pick a drink. It was
   * there on every visit forever — nothing recorded a no, so on Android it came back
   * on the next page load and on iOS it never left at all. And it appeared before the
   * guest had seen a single drink, on the same screen as the arrival panel and the
   * notification card.
   *
   * Meanwhile the **bar** offered nothing, and the bar is where this matters: a
   * bartender works all night, and on iOS cannot receive order alerts *at all* without
   * installing.
   *
   * So: not shown to a guest until they have sent a round, shown plainly on the bar,
   * dismissible, and remembered per audience.
   */
  import { onMount } from 'svelte';
  import { dialog } from '$lib/dialog';
  import { dismiss, isApple, shouldOffer, type InstallAudience } from '$lib/install';

  type BIPEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };

  let {
    who,
    reason,
  }: {
    who: InstallAudience;
    /** Why *this* person would want it. Never shown without one — see below. */
    reason: string;
  } = $props();

  let deferred = $state<BIPEvent | null>(null);
  let installed = $state(false);
  let gone = $state(false);
  let showTip = $state(false);

  /**
   * Android hands us an event; iOS has no install API at all and needs telling where
   * the button is. Anything else — a desktop browser with no `beforeinstallprompt` —
   * gets nothing, because there is no honest instruction to give.
   */
  const offer = $derived(!gone && !installed && shouldOffer(who) && (!!deferred || isApple()));

  onMount(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep it, so our own control drives the sheet
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

  async function add(): Promise<void> {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice.catch(() => null);
      deferred = null;
      // Declining Chrome's own sheet *is* an answer. Without recording it the prompt
      // simply returned on the next page load, which is how this became furniture.
      if (choice?.outcome === 'dismissed') no();
    } else {
      showTip = true;
    }
  }

  function no(): void {
    dismiss(who);
    gone = true;
  }
</script>

{#if offer}
  <!-- A row, not a modal. Nobody's evening should be interrupted to be sold an icon;
       this sits in the flow and is ignorable. -->
  <div class="installrow">
    <p class="installrow-why">{reason}</p>
    <div class="installrow-acts">
      <button type="button" class="btn btn-go" onclick={add}>Add to Home Screen</button>
      <button type="button" class="btn btn-quiet" onclick={no}>Not now</button>
    </div>
  </div>
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
      <!-- "In Safari", not "On iPhone" — the same words work on an iPad, which is the
           device the old copy talked past while its button failed to render. -->
      <p>
        In Safari, tap <strong>Share</strong> <span aria-hidden="true">⬆︎</span>, then
        <strong>Add to Home Screen</strong>.
      </p>
      <button type="button" class="send" onclick={() => (showTip = false)}>Got it</button>
    </div>
  </div>
{/if}
