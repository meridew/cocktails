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
    liveParties,
    type AccountUser,
  } from '$lib/api';
  import { refreshActor, session } from '$lib/stores/session.svelte';
  import { dialog } from '$lib/dialog';

  /** From +page.server.ts: whether Google is configured on this deployment. */
  let { data }: { data: { googleEnabled: boolean } } = $props();

  /**
   * What's on tonight.
   *
   * The front door used to be a sign-in form, which had the audience backwards:
   * hosts and staff are a handful of people and guests are everyone else. A guest
   * who has lost the QR code now has somewhere to go.
   *
   * Only live parties are listed — opening one already means it takes orders, so it
   * means "and it is on the door" too, with no second thing to remember. Failing to
   * load leaves the list empty and the page still works; a guest with a link never
   * needed it.
   */
  let parties = $state<{ id: string; name: string }[]>([]);

  /** Sign-in is a rare act by a few people, so it lives behind an icon. */
  let signingIn = $state(false);

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

  /**
   * Signed in, verified, and still nobody — which is what a suspension looks like
   * from here.
   *
   * Better Auth does not know about `bannedAt`; the ban lives in `resolveActor`, so a
   * suspended host's password is still correct and they still get a session. Without
   * this they landed back on the sign-in form having successfully signed in, with
   * nothing said and no idea why — the same dead end sign-up used to have, which is
   * why `awaitingConfirmation` exists two states up. Found by the end-to-end suite.
   *
   * It does not say *why* they were suspended. That reason is Dan's note to himself,
   * and `PATCH /api/hosts/[id]` never sends it to the person it is about.
   */
  let suspended = $state(false);

  async function refresh(): Promise<void> {
    const account = await currentAccount();
    user = account?.user ?? null;
    if (user?.emailVerified) awaitingConfirmation = '';
    // The actor is the server's answer, and it is what decides the destination —
    // `user` only says whether anyone is signed in at all.
    await refreshActor();
    suspended = Boolean(user?.emailVerified) && session.actor.account === null;
    if (user?.emailVerified && session.actor.account) await goto(home(), { replaceState: true });
  }

  onMount(async () => {
    void liveParties()
      .then((r) => (parties = r.parties))
      .catch(() => {
        /* offline, or nothing on — the rest of the door still works */
      });
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
      suspended = false;
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

<div class="workshell">
  <header class="appbar">
    <span class="brand">COCKTAILS</span>
    <!-- Sign-in is a rare act by a handful of people. It gets an icon, and the page
         goes to the guests who are most of the traffic. -->
    <button
      class="appbar-bartender"
      type="button"
      onclick={() => (signingIn = true)}
      aria-label="Sign in"
    >
      <span class="emoji">🔑</span>
    </button>
  </header>

  <!-- `deck-hero` centres a short door vertically. With a list of parties on it that
       would fight the scroll, so it only applies when there is nothing to list. -->
  <main class="deck" class:deck-hero={parties.length === 0}>
    {#if loading}
      <p class="empty">One moment…</p>
    {:else if awaitingConfirmation || (user && !user.emailVerified)}
      <!-- Signed up, waiting on the email. Sign-up issues no session when verification
         is required, so this state must not depend on `user`. -->
      {@const who = user?.email ?? awaitingConfirmation}
      <section class="panel">
        <h2>Check your email</h2>
        <p>We sent a link to <strong>{who}</strong>. Open it and you're in.</p>
        <p>Nothing arrived? It can take a minute, and it may be in spam.</p>
        <div class="row-acts">
          <button class="btn btn-go" type="button" onclick={() => resend(who)} disabled={busy}>
            Send it again
          </button>
          <button
            class="btn"
            type="button"
            onclick={() => {
              awaitingConfirmation = '';
              error = '';
              notice = '';
              void leave();
            }}
          >
            Different account
          </button>
        </div>
      </section>
    {:else}
      {#if verified}
        <p class="says says-good">Email confirmed — you're all set.</p>
      {/if}

      {#if suspended}
        <section class="panel">
          <h2>This account is closed</h2>
          <p>
            Your details are right, but the account has been suspended. Get in touch if you think
            that's a mistake.
          </p>
          <button class="btn" type="button" onclick={leave} disabled={busy}>Sign out</button>
        </section>
      {/if}

      <!-- The list is the door. A guest who lost the QR code, or who was told
           "it's on the website", lands here and taps their party. -->
      <section class="panel">
        <h2>What's on tonight</h2>
        {#each parties as p (p.id)}
          <a class="row" href="/e/{p.id}">
            <span class="row-main"><span class="row-name">{p.name}</span></span>
            <span class="row-note">Join →</span>
          </a>
        {:else}
          <p class="empty">
            Nothing running right now. If you're at a party, open the link or QR code your host gave
            you — it goes straight to their menu.
          </p>
        {/each}
      </section>
    {/if}

    {#if error}<p class="says says-bad" role="alert">{error}</p>{/if}
    {#if notice}<p class="says says-good" role="status">{notice}</p>{/if}
  </main>
</div>

{#if signingIn}
  <!-- `use:dialog` gives it the focus trap, the Escape handler and the inert
       background that neo.css's other sheets get. It is the same form as before —
       only its place in the page changed, from the whole door to a drawer behind an
       icon. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-label="Sign in"
    tabindex="-1"
    use:dialog={{ onclose: () => (signingIn = false) }}
    onclick={(e) => {
      if (e.target === e.currentTarget) signingIn = false;
    }}
  >
    <div class="sheet-card">
      <button
        type="button"
        class="sheet-close"
        onclick={() => (signingIn = false)}
        aria-label="Close">✕</button
      >
      <h2>{registering ? 'Set up your account' : 'Welcome back'}</h2>
      <p class="hint">
        {registering
          ? "Tell us what you've got in, and we'll work out what the bar can pour."
          : 'For hosts and whoever is running the bar.'}
      </p>

      {#if data.googleEnabled}
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
          <button
            class="btn"
            type="button"
            onclick={() => {
              registering = !registering;
              error = '';
              notice = '';
            }}
          >
            {registering ? 'I have an account' : 'I need an account'}
          </button>
        </div>
      </form>

      {#if error}<p class="says says-bad" role="alert">{error}</p>{/if}
    </div>
  </div>
{/if}
