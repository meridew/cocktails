<script lang="ts">
  /**
   * The door to the bar. Three ways through, in order of how often they're used:
   *   • the host taps their PIN
   *   • a helper types a join code the host just read out — instant
   *   • a helper asks, and waits for the host to approve their device
   *
   * The join code is the primary helper path on purpose. Request-and-approve solves
   * *remote* onboarding, and at a party the host is standing right there — so the
   * asynchronous version turned a five-second conversation into a multi-minute wait
   * that could stall indefinitely. It's kept as the fallback for when the host isn't
   * nearby, and it now pushes them, so it can't sit unnoticed.
   *
   * Every state a request can be in is shown explicitly — sent, waiting, declined —
   * because the previous version deleted the outcome as soon as it read it and left
   * people staring at a sign-in form with no idea what had happened. The lifecycle
   * lives in the staffRequest store, so it survives closing the panel and reloading.
   * (Approval needs no panel: the queue simply appears.)
   */
  import { onMount } from 'svelte';
  import { JOIN_CODE_LENGTH, LIMITS, PIN_LENGTH, isValidPin } from '@cocktails/shared';
  import { Unauthorized } from './api.ts';
  import { session, signInWithPin } from './session.svelte';
  import {
    askToHelp,
    checkDecision,
    clearRequest,
    joinWithJoinCode,
    staffRequest,
  } from './staffRequest.svelte';
  import { getSavedName, saveName } from './device.ts';
  import Keypad from './Keypad.svelte';

  /** Fired once a request is lodged, so the bar can get out of the way. */
  let { onasked }: { onasked: () => void } = $props();

  let askName = $state(getSavedName());
  let busy = $state(false);
  let error = $state('');
  /** Which door the person is currently at. */
  let door = $state<'pin' | 'join' | 'ask'>('pin');

  let message = $derived(error || session.expiredMessage);

  /**
   * An outstanding or unacknowledged request always wins over the doors: that's the
   * news, and burying it behind a sign-in form was the original defect.
   */
  let mode = $derived(
    staffRequest.kind === 'pending'
      ? 'waiting'
      : staffRequest.kind === 'declined'
        ? 'declined'
        : door,
  );

  /** Move to another door with a clean slate. */
  const goto = (next: 'pin' | 'join' | 'ask') => () => {
    door = next;
    error = '';
  };

  async function submitPin(pin: string) {
    if (!isValidPin(pin) || busy) return;
    busy = true;
    error = '';
    try {
      await signInWithPin(pin);
    } catch (e) {
      error =
        e instanceof Unauthorized ? 'Wrong PIN' : (e as Error).message || 'That PIN didn’t work';
    } finally {
      busy = false;
    }
  }

  async function submitJoin(code: string) {
    const name = askName.trim();
    if (busy) return;
    if (!name) {
      error = 'Pop your name in first, so the bar knows who you are';
      return;
    }
    busy = true;
    error = '';
    try {
      saveName(name);
      await joinWithJoinCode(code, name);
    } catch (e) {
      error =
        e instanceof Unauthorized
          ? 'That code is wrong or has expired'
          : (e as Error).message || 'That code didn’t work';
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
      saveName(name);
      await askToHelp(name);
      door = 'pin';
      // Waiting is a background activity — hand the screen back so they can carry
      // on ordering instead of staring at a modal until somebody answers.
      onasked();
    } catch (e) {
      error = (e as Error).message || 'Couldn’t send that request';
    } finally {
      busy = false;
    }
  }

  /** Acknowledge a finished request and go back to the door. */
  function dismiss() {
    clearRequest();
    door = 'pin';
  }

  /** How long ago the request was sent, so "waiting" doesn't feel like a hang. */
  function since(ts: number): string {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
  }

  onMount(() => {
    // Reopening the panel is a deliberate "any news?" — answer it immediately.
    void checkDecision();
  });
</script>

<div class="bt-gate">
  {#if mode === 'pin'}
    <p class="bt-gate-msg">Enter bar PIN</p>
    <Keypad length={PIN_LENGTH} label="Bar PIN" disabled={busy} {busy} onsubmit={submitPin} />
    <button type="button" class="bt-gate-alt" onclick={goto('join')}> Helping out tonight? </button>
  {:else if mode === 'join'}
    <p class="bt-gate-msg">Got a join code?</p>
    <p class="bt-gate-hint">Ask whoever’s running the bar — they can show you one.</p>
    <input
      type="text"
      autocomplete="name"
      autocapitalize="words"
      placeholder="your name"
      maxlength={LIMITS.maxFieldLen}
      bind:value={askName}
    />
    <Keypad
      length={JOIN_CODE_LENGTH}
      label="Join code"
      disabled={busy}
      {busy}
      onsubmit={submitJoin}
    />
    <button type="button" class="bt-gate-alt" onclick={goto('ask')}>
      No code? Ask them to let you in
    </button>
    <button type="button" class="bt-gate-alt" onclick={goto('pin')}>Back</button>
  {:else if mode === 'ask'}
    <p class="bt-gate-msg">Ask to help at the bar</p>
    <p class="bt-gate-hint">
      We’ll notify them, and tell you as soon as they answer. You can carry on ordering meanwhile.
    </p>
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
    <button type="button" class="bt-gate-alt" onclick={goto('join')}>Back</button>
  {:else if mode === 'waiting'}
    <p class="bt-status-badge is-sent">✓ Request sent</p>
    <p class="bt-gate-msg">Waiting for the host…</p>
    <p class="bt-gate-hint">
      Asked as <strong>{staffRequest.name}</strong>, {since(staffRequest.at)}. We’ve notified them.
    </p>
    <p class="bt-gate-hint">
      Close this and carry on — we’ll tell you either way, and it’ll be here when you come back.
    </p>
    <button
      type="button"
      class="bt-unlock"
      onclick={() => {
        clearRequest();
        door = 'join';
      }}
    >
      Got a code instead?
    </button>
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
        door = 'join';
      }}
    >
      Try a join code
    </button>
    <button type="button" class="bt-gate-alt" onclick={dismiss}>Back to PIN</button>
  {/if}
  {#if message}<p class="bt-err" role="alert">{message}</p>{/if}
</div>
