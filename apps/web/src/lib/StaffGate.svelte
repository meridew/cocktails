<script lang="ts">
  /**
   * The door to the bar. Two ways in:
   *   • the host taps a PIN (works on any device)
   *   • a helper asks, and the host approves their device
   *
   * Every state a request can be in is shown explicitly — sent, waiting, declined —
   * because the previous version deleted the outcome as soon as it read it and left
   * people staring at a sign-in form with no idea what had happened. The lifecycle
   * lives in the staffRequest store, so it survives closing the panel and reloading.
   * (Approval needs no panel: the queue simply appears.)
   */
  import { onMount } from 'svelte';
  import { LIMITS, PIN_LENGTH, isValidPin } from '@cocktails/shared';
  import { Unauthorized } from './api.ts';
  import { session, signInWithPin } from './session.svelte';
  import { askToHelp, checkDecision, clearRequest, staffRequest } from './staffRequest.svelte';
  import { getSavedName } from './device.ts';

  // No `onsignedin` callback: signing in is a change to the session store, and the
  // bar watches that directly. Notifying a parent from here was unreliable anyway —
  // an approval unmounts this component in the same update that grants the session,
  // so anything scheduled on the way out never ran.

  let pin = $state('');
  let askName = $state(getSavedName());
  let busy = $state(false);
  let error = $state('');
  /** Set when someone chooses to ask rather than enter a PIN. */
  let asking = $state(false);

  // Show why a previous session ended until the next attempt.
  let message = $derived(error || session.expiredMessage);
  let ready = $derived(isValidPin(pin));

  /**
   * Which panel to show. An outstanding or unacknowledged request always wins:
   * that's the news, and burying it behind a sign-in form was the original defect.
   */
  let mode = $derived(
    staffRequest.kind === 'pending'
      ? 'waiting'
      : staffRequest.kind === 'declined'
        ? 'declined'
        : asking
          ? 'ask'
          : 'pin',
  );

  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

  function tap(key: string) {
    if (key === '') return;
    error = '';
    if (key === '⌫') {
      pin = pin.slice(0, -1);
      return;
    }
    if (pin.length >= PIN_LENGTH) return;
    pin += key;
    // Submitting on the last digit is what makes this a single gesture rather than
    // "type, then hunt for the button".
    if (pin.length === PIN_LENGTH) void submitPin();
  }

  async function submitPin() {
    if (!isValidPin(pin) || busy) return;
    busy = true;
    error = '';
    try {
      await signInWithPin(pin);
      pin = '';
    } catch (e) {
      pin = '';
      error =
        e instanceof Unauthorized ? 'Wrong PIN' : (e as Error).message || 'That PIN didn’t work';
    } finally {
      busy = false;
    }
  }

  async function submitRequest() {
    const name = askName.trim();
    if (!name || busy) return;
    busy = true;
    error = '';
    try {
      await askToHelp(name);
      asking = false;
    } catch (e) {
      error = (e as Error).message || 'Couldn’t send that request';
    } finally {
      busy = false;
    }
  }

  /** Acknowledge a finished request and go back to the door. */
  function dismiss() {
    clearRequest();
    asking = false;
  }

  /** How long ago the request was sent, so "waiting" doesn't feel like a hang. */
  function since(ts: number): string {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
  }

  onMount(() => {
    // Reopening the panel is a deliberate "any news?" — answer it immediately
    // rather than on the next tick.
    void checkDecision();
  });
</script>

<div class="bt-gate">
  {#if mode === 'pin'}
    <p class="bt-gate-msg">Enter bar PIN</p>
    <!-- A real password input, so it masks itself, and so a hardware keyboard still
         works. The keypad below is for thumbs behind the bar. -->
    <input
      type="password"
      inputmode="numeric"
      aria-label="Bar PIN"
      autocomplete="one-time-code"
      maxlength={PIN_LENGTH}
      value={pin}
      oninput={(e) => {
        // Digits only, so a stray character can never make a valid-looking PIN.
        pin = e.currentTarget.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
        e.currentTarget.value = pin;
      }}
      onkeydown={(e) => e.key === 'Enter' && submitPin()}
    />
    <div class="pin-pad">
      {#each KEYS as key (key)}
        {#if key === ''}
          <span></span>
        {:else}
          <button
            type="button"
            class="pin-key"
            class:is-back={key === '⌫'}
            disabled={busy}
            onclick={() => tap(key)}
            aria-label={key === '⌫' ? 'Delete last digit' : key}
          >
            {key}
          </button>
        {/if}
      {/each}
    </div>
    <button type="button" class="bt-unlock" onclick={submitPin} disabled={busy || !ready}>
      {busy ? 'Checking…' : 'Unlock'}
    </button>
    <button type="button" class="bt-gate-alt" onclick={() => (asking = true)}>
      Helping out tonight? Ask to join
    </button>
  {:else if mode === 'ask'}
    <p class="bt-gate-msg">Ask to help at the bar</p>
    <p class="bt-gate-hint">The host approves you on their device — no PIN needed.</p>
    <input
      type="text"
      autocomplete="name"
      autocapitalize="words"
      placeholder="your name"
      maxlength={LIMITS.maxFieldLen}
      bind:value={askName}
      onkeydown={(e) => e.key === 'Enter' && submitRequest()}
    />
    <button type="button" class="bt-unlock" onclick={submitRequest} disabled={busy}>
      {busy ? 'Sending…' : 'Ask to join'}
    </button>
    <button type="button" class="bt-gate-alt" onclick={() => (asking = false)}>
      Back to PIN
    </button>
  {:else if mode === 'waiting'}
    <p class="bt-status-badge is-sent">✓ Request sent</p>
    <p class="bt-gate-msg">Waiting for the host…</p>
    <p class="bt-gate-hint">
      Asked as <strong>{staffRequest.name}</strong>, {since(staffRequest.at)}. The host approves you
      in <strong>🍸 Bar → ⋯ → Bar staff</strong>.
    </p>
    <p class="bt-gate-hint">
      You can close this — we’ll let you know either way, and it’ll be here when you come back.
    </p>
    <button type="button" class="bt-gate-alt" onclick={dismiss}>Cancel request</button>
  {:else}
    <p class="bt-status-badge is-no">✕ Not approved</p>
    <p class="bt-gate-msg">Request declined</p>
    <p class="bt-gate-hint">
      The host didn’t approve this one — or it sat unanswered too long and expired.
      {#if staffRequest.name}Asked as <strong>{staffRequest.name}</strong>, {since(
          staffRequest.at,
        )}.{/if}
    </p>
    <button
      type="button"
      class="bt-unlock"
      onclick={() => {
        clearRequest();
        asking = true;
      }}
    >
      Ask again
    </button>
    <button type="button" class="bt-gate-alt" onclick={dismiss}>Back to PIN</button>
  {/if}
  {#if message}<p class="bt-err" role="alert">{message}</p>{/if}
</div>
