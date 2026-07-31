<script lang="ts">
  /**
   * Signing in, wherever it is asked for.
   *
   * **Extracted from the front door because it is no longer only the front door's.**
   * The bar's gate offers "I work here", and that used to be a link to `/?signin` —
   * which navigated a barman off the party they were standing in, to a form whose
   * subtitle said "for hosts and whoever is running the bar", to a **host**
   * registration. Three wrong turns in one tap. Now the same sheet opens in place and
   * hands control back when it is done, so the gate can carry straight on to opening
   * the bar.
   *
   * ## Registering is a host thing, and only offered where it means that
   *
   * `allowRegister` is off by default. A new account has standing at no party, so
   * offering "I need an account" at a bar gate answers a question nobody asked and
   * costs somebody an email round trip to find that out. Where it *is* offered — the
   * front door — it says so plainly: a host account, for someone whose party this is.
   *
   * The sheet reports rather than navigates. Sign-in and sign-up have different
   * outcomes (a session, versus an email to go and open), so they are separate
   * callbacks and the caller decides what either one means for the screen it is on.
   */
  import { googleSignInUrl, signInToAccount, signUp } from '$lib/api';
  import { dialog } from '$lib/dialog';

  let {
    googleEnabled = false,
    allowRegister = false,
    hint = 'For hosts and admins.',
    onclose,
    onsignedin,
    onregistered,
  }: {
    googleEnabled?: boolean;
    allowRegister?: boolean;
    hint?: string;
    onclose: () => void;
    onsignedin: () => void | Promise<void>;
    onregistered?: (email: string) => void;
  } = $props();

  /** Sign in unless they've asked to register — signing in is the commoner visit. */
  let registering = $state(false);
  let name = $state('');
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state('');

  /** Run something, showing one error rather than a stack. */
  async function attempt(what: () => Promise<void>): Promise<void> {
    busy = true;
    error = '';
    try {
      await what();
    } catch (e) {
      error = e instanceof Error ? e.message : 'That did not work.';
    } finally {
      busy = false;
    }
  }

  const submit = () =>
    attempt(async () => {
      if (registering) {
        const who = email.trim();
        await signUp(name.trim(), who, password);
        password = '';
        onregistered?.(who);
      } else {
        await signInToAccount(email.trim(), password);
        password = '';
        await onsignedin();
      }
    });

  /**
   * Hand the browser to Google.
   *
   * A full navigation rather than a fetch: the consent screen is a page, and Google
   * refuses to be framed or XHR'd. `location.href` because this leaves the app.
   */
  const withGoogle = () =>
    attempt(async () => {
      const { url } = await googleSignInUrl();
      window.location.href = url;
    });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="sheet"
  role="dialog"
  aria-modal="true"
  aria-label="Sign in"
  tabindex="-1"
  use:dialog={{ onclose }}
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div class="sheet-card">
    <button type="button" class="sheet-close" onclick={onclose} aria-label="Close">✕</button>
    <h2>{registering ? 'Set up a host account' : 'Welcome back'}</h2>
    <!--
      **This sentence used to be the bug.** It read "For hosts and whoever is running
      the bar", so a barman took it at its word, registered, and got a host account
      with a cupboard and no parties — registering has never been a way behind a bar.
      Hosting and helping are named separately now, and helping points back at the
      party, which is the only place it can happen.
    -->
    <p class="hint">
      {registering
        ? "It's your party we'll be pouring at — tell us what you've got in, and we'll work out what the bar can make."
        : hint}
    </p>

    {#if googleEnabled}
      <button class="btn btn-go" type="button" onclick={withGoogle} disabled={busy}>
        Continue with Google
      </button>
    {/if}

    <form
      onsubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {#if registering}
        <label class="field">
          Your name
          <input bind:value={name} autocomplete="name" required />
        </label>
      {/if}
      <label class="field">
        Email
        <input type="email" bind:value={email} autocomplete="email" required />
      </label>
      <label class="field">
        Password
        <input
          type="password"
          bind:value={password}
          autocomplete={registering ? 'new-password' : 'current-password'}
          required
        />
      </label>
      <div class="row-acts">
        <button class="btn btn-go" type="submit" disabled={busy}>
          {busy ? 'One moment…' : registering ? 'Create my account' : 'Sign in'}
        </button>
        {#if allowRegister}
          <button
            class="btn"
            type="button"
            onclick={() => {
              registering = !registering;
              error = '';
            }}
          >
            {registering ? 'I have an account' : 'I need an account'}
          </button>
        {/if}
      </div>
    </form>

    <!-- The other half of the disambiguation, and it only makes sense where an
         account is the *wrong* answer: helping is per party, and asked for at the
         party. Someone reading this is one tap from the door they actually want. -->
    {#if allowRegister && !registering}
      <p class="sheet-aside">
        Helping behind the bar tonight? You don't need an account — open your party's link and tap <strong
          >I'm pouring here</strong
        >.
      </p>
    {/if}

    {#if error}<p class="says says-bad" role="alert">{error}</p>{/if}
  </div>
</div>
