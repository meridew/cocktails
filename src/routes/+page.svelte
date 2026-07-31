<script lang="ts">
  /**
   * The front door.
   *
   * **This used to be the guest menu**, which meant a stranger arriving at
   * `cock.meridew.com` got whichever party happened to be live — the same guess that
   * `liveEvent()` made on the server, wearing a different hat. The menu lives at
   * `/e/<id>` now, because a guest always arrives from a link that names their party.
   *
   * So this is the only page for people who work here: sign in, or register. It
   * routes on what the server says you are rather than on anything this device
   * remembers, because the two disagree the moment a session expires.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    currentAccount,
    googleSignInUrl,
    resendVerification,
    signInToAccount,
    signOutOfAccount,
    signUp,
    type AccountUser,
  } from '$lib/api';
  import { refreshActor, session } from '$lib/stores/session.svelte';

  /** From +page.server.ts: whether Google is configured on this deployment. */
  let { data }: { data: { googleEnabled: boolean } } = $props();

  let user = $state<AccountUser | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');

  /** Sign in unless they've asked to register — signing in is the commoner visit. */
  let registering = $state(false);
  let name = $state('');
  let email = $state('');
  let password = $state('');

  /**
   * Who just signed up, when there is no session to show for it.
   *
   * Sign-up with verification required deliberately issues no session, so without
   * this the screen falls straight back to the signed-out form it just submitted —
   * "it dumped me back at the login screen with no idea what happened". Signing up
   * is a thing that *happened*; the screen has to say so.
   */
  let awaitingConfirmation = $state('');

  const verified = $derived(page.url.searchParams.get('verified') !== null);

  /** Where a signed-in person belongs. Dan runs the service; everyone else is a host. */
  const home = () => (session.actor.account?.role === 'admin' ? '/admin' : '/host');

  async function refresh(): Promise<void> {
    const account = await currentAccount();
    user = account?.user ?? null;
    if (user?.emailVerified) awaitingConfirmation = '';
    // The actor is the server's answer, and it is what decides the destination —
    // `user` only says whether anyone is signed in at all.
    await refreshActor();
    if (user?.emailVerified && session.actor.account) await goto(home(), { replaceState: true });
  }

  onMount(async () => {
    await refresh();
    loading = false;
  });

  /** Run something, showing one error rather than a stack. */
  async function attempt(what: () => Promise<void>): Promise<void> {
    busy = true;
    error = '';
    notice = '';
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
        await signUp(name.trim(), email.trim(), password);
        awaitingConfirmation = email.trim();
      } else {
        await signInToAccount(email.trim(), password);
      }
      password = '';
      await refresh();
    });

  const leave = () =>
    attempt(async () => {
      await signOutOfAccount();
      user = null;
      await refreshActor();
    });

  const resend = (who: string) =>
    attempt(async () => {
      await resendVerification(who);
      notice = 'Sent again — check your inbox.';
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

<svelte:head><title>COCKTAILS!!!</title></svelte:head>

<header class="appbar">
  <span class="brand">COCKTAILS</span>
</header>

<main class="host">
  {#if loading}
    <p class="host-quiet">One moment…</p>
  {:else if awaitingConfirmation || (user && !user.emailVerified)}
    <!-- Signed up, waiting on the email. Sign-up issues no session when verification
         is required, so this state must not depend on `user`. -->
    {@const who = user?.email ?? awaitingConfirmation}
    <h1 class="host-h1">Check your email</h1>
    <p class="host-quiet">We sent a link to <strong>{who}</strong>. Open it and you're in.</p>
    <p class="host-quiet">Nothing arrived? It can take a minute, and it may be in spam.</p>
    <button class="host-go" type="button" onclick={() => resend(who)} disabled={busy}>
      Send it again
    </button>
    <button
      class="host-alt"
      type="button"
      onclick={() => {
        awaitingConfirmation = '';
        error = '';
        notice = '';
        void leave();
      }}
    >
      Use a different account
    </button>
  {:else}
    {#if verified}
      <p class="host-good">Email confirmed — you're all set.</p>
    {/if}

    <h1 class="host-h1">{registering ? 'Set up your account' : 'Welcome back'}</h1>
    <p class="host-quiet">
      {registering
        ? "Tell us what you've got in, and we'll work out what the bar can pour."
        : 'Sign in to your parties.'}
    </p>

    {#if data.googleEnabled}
      <button class="host-google" type="button" onclick={withGoogle} disabled={busy}>
        <span class="host-google-g" aria-hidden="true">G</span>
        Continue with Google
      </button>
      <p class="host-or"><span>or</span></p>
    {/if}

    <form
      class="host-form"
      onsubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {#if registering}
        <label class="host-label">
          Your name
          <input class="host-input" bind:value={name} autocomplete="name" required />
        </label>
      {/if}
      <label class="host-label">
        Email
        <input class="host-input" type="email" bind:value={email} autocomplete="email" required />
      </label>
      <label class="host-label">
        Password
        <input
          class="host-input"
          type="password"
          bind:value={password}
          autocomplete={registering ? 'new-password' : 'current-password'}
          required
        />
      </label>
      <button class="host-go" type="submit" disabled={busy}>
        {busy ? 'One moment…' : registering ? 'Create my account' : 'Sign in'}
      </button>
    </form>

    <button
      class="host-alt"
      type="button"
      onclick={() => {
        registering = !registering;
        error = '';
        notice = '';
      }}
    >
      {registering ? 'I already have an account' : 'I need an account'}
    </button>

    <!-- The one thing a guest might need from this page. They should never be here —
         their link goes straight to a party — but somebody will type the bare domain
         after being sent the app, and "you're in the wrong place" is a dead end. -->
    <p class="host-quiet host-footnote">
      At a party? Open the link or QR code your host gave you — it goes straight to their menu.
    </p>
  {/if}

  {#if error}<p class="host-bad" role="alert">{error}</p>{/if}
  {#if notice}<p class="host-good" role="status">{notice}</p>{/if}
</main>
