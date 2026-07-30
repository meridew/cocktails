<script lang="ts">
  /**
   * Two ways into the bar:
   *   • admins sign in with email + password (works on any device)
   *   • helpers ask to help and wait for an admin to approve this device
   *
   * The claim secret is kept in storage so closing the panel — or reloading —
   * doesn't lose a pending request.
   */
  import { onMount } from 'svelte';
  import { LIMITS } from '@cocktails/shared';
  import { Unauthorized, claimStaffAccess, requestStaffAccess } from './api.ts';
  import { adoptApprovedSession, session, signIn } from './session.svelte';
  import { getDeviceId, getSavedName } from './device.ts';
  import { storage } from './storage.ts';

  let { onsignedin }: { onsignedin: () => void } = $props();

  /** Persisted so a pending request survives a reload. */
  const CLAIM_KEY = 'staff_claim';
  const POLL_MS = 4000;

  type Mode = 'signin' | 'ask' | 'waiting';

  let mode = $state<Mode>(storage.read(CLAIM_KEY) ? 'waiting' : 'signin');
  let email = $state('');
  let password = $state('');
  let askName = $state(getSavedName());
  let busy = $state(false);
  let error = $state('');
  let denied = $state(false);
  let timer: ReturnType<typeof setInterval> | undefined;

  // Show why a previous session ended until the next attempt.
  let message = $derived(error || session.expiredMessage);

  async function submitSignIn() {
    const trimmed = email.trim();
    if (!trimmed || !password || busy) return;
    busy = true;
    error = '';
    try {
      await signIn(trimmed, password);
      password = '';
      onsignedin();
    } catch (e) {
      error =
        e instanceof Unauthorized
          ? 'Wrong email or password'
          : (e as Error).message || 'Sign-in failed';
    } finally {
      busy = false;
    }
  }

  async function submitRequest() {
    const name = askName.trim();
    if (!name || busy) return;
    busy = true;
    error = '';
    denied = false;
    try {
      const { claim } = await requestStaffAccess(name, getDeviceId());
      storage.write(CLAIM_KEY, claim);
      mode = 'waiting';
      startPolling();
    } catch (e) {
      error = (e as Error).message || "Couldn't send that request";
    } finally {
      busy = false;
    }
  }

  /** Poll until an admin decides. */
  async function checkClaim() {
    const claim = storage.read(CLAIM_KEY);
    if (!claim) {
      stopPolling();
      return;
    }
    try {
      const result = await claimStaffAccess(claim);
      if (result.status === 'active') {
        stopPolling();
        storage.remove(CLAIM_KEY);
        adoptApprovedSession(result.token, result.staff);
        onsignedin();
      } else if (result.status === 'denied') {
        // Either turned down, or the request expired — either way, start over.
        stopPolling();
        storage.remove(CLAIM_KEY);
        denied = true;
        mode = 'ask';
      }
    } catch {
      /* transient — the next tick tries again */
    }
  }

  function startPolling() {
    stopPolling();
    timer = setInterval(checkClaim, POLL_MS);
  }
  function stopPolling() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  function cancelRequest() {
    stopPolling();
    storage.remove(CLAIM_KEY);
    mode = 'signin';
  }

  onMount(() => {
    if (mode === 'waiting') {
      void checkClaim(); // don't make them wait a full tick when reopening
      startPolling();
    }
    return () => stopPolling();
  });
</script>

<div class="bt-gate">
  {#if mode === 'signin'}
    <p class="bt-gate-msg">Staff sign-in</p>
    <input
      type="email"
      autocomplete="username"
      placeholder="email"
      bind:value={email}
      onkeydown={(e) => e.key === 'Enter' && document.getElementById('bt-pw')?.focus()}
    />
    <input
      id="bt-pw"
      type="password"
      autocomplete="current-password"
      placeholder="password"
      bind:value={password}
      onkeydown={(e) => e.key === 'Enter' && submitSignIn()}
    />
    <button type="button" class="bt-unlock" onclick={submitSignIn} disabled={busy}>
      {busy ? 'Signing in…' : 'Sign in'}
    </button>
    <button type="button" class="bt-gate-alt" onclick={() => (mode = 'ask')}>
      Helping out tonight? Ask to join
    </button>
  {:else if mode === 'ask'}
    <p class="bt-gate-msg">Ask to help at the bar</p>
    {#if denied}
      <p class="bt-gate-hint">That request wasn't approved. You can ask again.</p>
    {:else}
      <p class="bt-gate-hint">The host approves you on their device — no password needed.</p>
    {/if}
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
    <button type="button" class="bt-gate-alt" onclick={() => (mode = 'signin')}>
      Back to sign-in
    </button>
  {:else}
    <p class="bt-gate-msg">Waiting for the host…</p>
    <p class="bt-gate-hint">
      Ask them to approve you in <strong>🍸 Bar → Requests</strong>. This updates itself.
    </p>
    <button type="button" class="bt-gate-alt" onclick={cancelRequest}>Cancel</button>
  {/if}
  {#if message}<p class="bt-err" role="alert">{message}</p>{/if}
</div>
