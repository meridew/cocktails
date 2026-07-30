<script lang="ts">
  /**
   * Staff sign-in. Split out of Bartender because it shares nothing with the
   * order queue but the fact of being signed in — and it owns its own transient
   * form state, which the queue should not have to carry.
   */
  import { Unauthorized } from './api.ts';
  import { session, signIn } from './session.svelte';

  let { onsignedin }: { onsignedin: () => void } = $props();

  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state('');

  // Show why a previous session ended until the next attempt.
  let message = $derived(error || session.expiredMessage);

  async function submit() {
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
</script>

<div class="bt-gate">
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
    onkeydown={(e) => e.key === 'Enter' && submit()}
  />
  <button type="button" class="bt-unlock" onclick={submit} disabled={busy}>
    {busy ? 'Signing in…' : 'Sign in'}
  </button>
  {#if message}<p class="bt-err" role="alert">{message}</p>{/if}
</div>
