<script lang="ts">
  /**
   * The host's door — the thing the platform overhaul was missing.
   *
   * Everything behind this existed already: accounts in phase 1, events and the
   * account→bar bridge in phase 2.5. What didn't exist was any way to reach them
   * without curl, which meant the one role the whole overhaul was *for* couldn't
   * be used by a person.
   *
   * One route rather than four, because the states are a sequence rather than a
   * menu: signed out → signed up but unverified → signed in with no party → a
   * party to open. Splitting that across /sign-in, /sign-up, /verify and /parties
   * would make a linear walk feel like a site map.
   *
   * The PIN and join codes are untouched. This is for hosts, who sign in from a
   * phone they've never used before; typing an email and a password behind a bar
   * mid-party is exactly the misery the keypad removed.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    createParty,
    currentAccount,
    myParties,
    openBar,
    resendVerification,
    signInToAccount,
    signOutOfAccount,
    signUp,
    type AccountUser,
    type Party,
  } from '$lib/api';
  import { adoptApprovedSession } from '$lib/stores/session.svelte';
  import { rememberEvent } from '$lib/party';

  let user = $state<AccountUser | null>(null);
  let parties = $state<Party[]>([]);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');

  /** Sign in unless they've asked to register — sign-in is the commoner visit. */
  let registering = $state(false);
  let name = $state('');
  let email = $state('');
  let password = $state('');
  let partyName = $state('');

  /**
   * Who just signed up, when there is no session to show for it.
   *
   * Sign-up with verification required deliberately issues no session, so without
   * this the screen falls straight back to "signed out" and redraws the form they
   * just submitted — the same "it dumped me back at the login screen with no idea
   * what happened" that made the ask-to-help flow feel broken. Signing up is a
   * thing that *happened*; the screen has to say so.
   */
  let awaitingConfirmation = $state('');

  const verified = $derived(page.url.searchParams.get('verified') !== null);

  async function refresh(): Promise<void> {
    const session = await currentAccount();
    user = session?.user ?? null;
    if (user?.emailVerified) awaitingConfirmation = '';
    // Only a verified account can list parties; asking anyway would surface a 401
    // as an error on a screen whose job is to explain what to do next.
    parties = user?.emailVerified ? ((await myParties().catch(() => null))?.events ?? []) : [];
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

  const makeParty = () =>
    attempt(async () => {
      const { event } = await createParty(partyName.trim());
      partyName = '';
      parties = [event, ...parties];
      notice = `${event.name} is ready.`;
    });

  /**
   * Open a party's bar.
   *
   * Trades the account session for a staff one, because every bar endpoint speaks
   * staff sessions — most people behind a bar have no account at all. Also
   * remembers the party on this device, so if the host orders a drink themselves
   * it lands in their own queue rather than in whichever event happens to be live.
   */
  const enterBar = (party: Party) =>
    attempt(async () => {
      const { token, staff } = await openBar(party.id);
      adoptApprovedSession(token, staff);
      rememberEvent(party.id);
      await goto('/bar');
    });

  const leave = () =>
    attempt(async () => {
      await signOutOfAccount();
      user = null;
      parties = [];
    });

  const resend = (who: string) =>
    attempt(async () => {
      await resendVerification(who);
      notice = 'Sent again — check your inbox.';
    });

  /** The link to put in a QR code on the kitchen table. */
  const guestLink = (party: Party): string => `${page.url.origin}/e/${party.id}`;

  async function copyLink(party: Party): Promise<void> {
    try {
      await navigator.clipboard.writeText(guestLink(party));
      notice = 'Guest link copied.';
    } catch {
      // Clipboard needs permission it may not have; the link is on screen anyway.
      notice = guestLink(party);
    }
  }
</script>

<svelte:head><title>Host · COCKTAILS!!!</title></svelte:head>

<header class="appbar">
  <div class="brand">🍸 Host</div>
  <a class="appbar-bartender" href="/">Back to the menu</a>
</header>

<main class="host">
  {#if loading}
    <p class="host-quiet">One moment…</p>
  {:else if awaitingConfirmation || (user && !user.emailVerified)}
    <!-- Signed up, waiting on the email. Sign-up issues no session when
         verification is required, so this state must not depend on `user`. -->
    {@const who = user?.email ?? awaitingConfirmation}
    <h1 class="host-h1">Check your email</h1>
    <p class="host-quiet">
      We sent a link to <strong>{who}</strong>. Open it and you're in.
    </p>
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
  {:else if !user}
    <!-- Signed out -->
    <h1 class="host-h1">{registering ? 'Set up your party' : 'Welcome back'}</h1>
    <p class="host-quiet">
      {registering
        ? 'An account lets you own a party, set what you have in, and open its bar from any phone.'
        : 'Sign in to your parties.'}
    </p>

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
  {:else}
    <!-- Signed in and verified -->
    {#if verified}
      <p class="host-good">Email confirmed — you're all set.</p>
    {/if}

    <h1 class="host-h1">Your parties</h1>

    {#if parties.length === 0}
      <p class="host-quiet">Nothing yet. Name your first one.</p>
    {/if}

    <ul class="host-parties">
      {#each parties as party (party.id)}
        <li class="host-party">
          <div class="host-party-main">
            <span class="host-party-name">{party.name}</span>
            <span class="host-party-status">{party.status}</span>
          </div>
          <div class="host-party-acts">
            <button class="host-go" type="button" onclick={() => enterBar(party)} disabled={busy}>
              Open the bar
            </button>
            <button class="host-alt" type="button" onclick={() => copyLink(party)}>
              Copy guest link
            </button>
          </div>
          <code class="host-link">{guestLink(party)}</code>
        </li>
      {/each}
    </ul>

    <form
      class="host-form"
      onsubmit={(e) => {
        e.preventDefault();
        void makeParty();
      }}
    >
      <label class="host-label">
        New party
        <input
          class="host-input"
          bind:value={partyName}
          placeholder="Saturday at ours"
          maxlength="80"
        />
      </label>
      <button class="host-go" type="submit" disabled={busy}>Create it</button>
    </form>

    <button class="host-alt" type="button" onclick={leave}>Sign out</button>
  {/if}

  {#if error}<p class="host-bad" role="alert">{error}</p>{/if}
  {#if notice}<p class="host-good" role="status">{notice}</p>{/if}
</main>
