<script lang="ts">
  /**
   * The front door.
   *
   * **This used to be the guest menu**, which meant a stranger arriving at
   * `cock.meridew.com` got whichever party happened to be live — the same guess that
   * `liveEvent()` made on the server, wearing a different hat. The menu lives at
   * `/e/<id>` now, because a guest always arrives from a link that names their party.
   *
   * ## Three doors, and it no longer throws anyone out
   *
   * Four different people arrive here and each is answering a different question
   * about themselves — "I want a drink", "I'm pouring", "it's my party", "I run
   * this". The page used to serve the first fully and put the other three behind one
   * unlabelled key, which is how a barman ended up registering a host account.
   *
   * So the list stays exactly as it was — guests lose nothing — and it gains named
   * rows for the other two answers, in the words those people use about themselves.
   *
   * **And signing in no longer bounces you off this page.** It used to `goto(home())`
   * the moment the server said who you were, with `replaceState`, so a signed-in host
   * could not look at what was on tonight *and* could not get back here with Back.
   * A host who wants a drink at their own party was locked out of the one screen that
   * offers one. Where you belong is now a line on this page rather than a redirect
   * off it.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    currentAccount,
    resendVerification,
    signOutOfAccount,
    liveParties,
    type AccountUser,
  } from '$lib/api';
  import { refreshActor, session } from '$lib/stores/session.svelte';
  import AppBar from '$lib/components/AppBar.svelte';
  import SignInSheet from '$lib/components/SignInSheet.svelte';

  /** From +layout.server.ts: whether Google is configured on this deployment. */
  let { data }: { data: { googleEnabled: boolean } } = $props();

  /**
   * What's on.
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

  /**
   * A glass for each party, picked from its id.
   *
   * Deterministic, so a party keeps the same face between visits and between people —
   * one that changed on reload would read as a glitch. There is no meaning in which
   * glass; it is there so a wall of cards has faces rather than three colours and
   * some words.
   */
  const GLASSES = ['🍸', '🍹', '🥂', '🍾', '🥃', '🍷', '🧉', '🍺'];
  const glassFor = (id: string): string =>
    GLASSES[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % GLASSES.length]!;

  /** Sign-in is a rare act by a few people, so it lives behind one named button. */
  let signingIn = $state(false);

  let user = $state<AccountUser | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');

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
  const home = $derived(session.actor.account?.role === 'admin' ? '/admin' : '/host');
  const homeLabel = $derived(
    session.actor.account?.role === 'admin' ? 'the admin desk' : 'your bar',
  );
  const signedIn = $derived(session.actor.account !== null);
  /** The party this device holds a bar session for, if any — see the row below. */
  const onShift = $derived(session.actor.party?.id ?? null);

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
    // **No bounce.** See the note at the top: this used to `goto(home())` here, which
    // made the party list unreachable for the very people who also want a drink.
  }

  /**
   * Signing in from the sheet *does* move you on — because that was a deliberate act
   * with a destination in mind, unlike merely arriving at the door already signed in.
   */
  async function afterSignIn(): Promise<void> {
    await refresh();
    if (session.actor.account) await goto(home);
  }

  onMount(async () => {
    // `?signin` opens the sheet straight away, for a link that means "sign in" rather
    // than "here's the door". The bar gate used to be the caller and no longer is —
    // it raises the sheet in place now, because sending a barman here to sign in was
    // sending them away from the only screen their answer was about.
    if (page.url.searchParams.has('signin')) signingIn = true;

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

  /**
   * Sign out from *this page's own states* — "different account" while waiting on a
   * verification email, and the suspended notice. Ordinary signing out lives in
   * Settings now, reachable from every screen's ⚙️.
   */
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
</script>

<svelte:head><title>COCKTAILS!!!</title></svelte:head>

<div class="workshell">
  <!-- The root of the app: no up, so the wordmark takes the left slot. The named
       doors are on the page itself rather than crammed into the corner. -->
  <AppBar brand />

  <!-- `deck-hero` centres a short door vertically. With a list of parties on it that
       would fight the scroll, so it only applies when there is nothing to list. -->
  <main class="deck deck-door" class:deck-hero={parties.length === 0}>
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
      {#if parties.length}
        <h1 class="door-title">What's on</h1>
        <p class="door-sub">Tap yours and start ordering</p>
        <div class="parties">
          {#each parties as p (p.id)}
            <a class="party" href="/e/{p.id}">
              <span class="party-emoji">{glassFor(p.id)}</span>
              <h2 class="party-name">{p.name}</h2>
              <span class="party-go">Join →</span>
            </a>
          {/each}
        </div>
      {:else}
        <section class="door-empty">
          <h2>Nothing on right now</h2>
          <p>
            When there is, it'll be here. At a party already? Open the link or QR code your host
            gave you — it goes straight to their menu.
          </p>
        </section>
      {/if}

      <!--
        **The other two doors.**

        Everything above this line speaks to a guest, which was the whole problem: the
        page read as "this app is for ordering drinks" and the other three arrivals had
        to guess that a key icon in the corner was for them. Each row is named the way
        the person would name themselves — pouring, hosting — rather than after the
        credential they'd need.

        Helping points *back at a party*, because it has to: "ask to be waved in" is
        meaningless without one, which is exactly why the bar's gate could never say
        which bar it was a door to.
      -->
      <section class="doors">
        <!--
          **Where an installed app lands.** The manifest's `start_url` is `/` and has
          to be — it is baked into the icon and cannot know which party. So for the
          person most likely to install, the icon opens *here*, furthest from their
          job. This row is the fix: a device holding a bar session gets one tap back
          to the queue, the same shape as "Go to the admin desk" below it.
        -->
        {#if onShift}
          <a class="door-row" href="/bar/{onShift}">
            <span class="door-row-q">You're on shift</span>
            <span class="door-row-a">Back to the bar →</span>
          </a>
        {/if}
        {#if signedIn}
          <a class="door-row" href={home}>
            <span class="door-row-q">You're signed in</span>
            <span class="door-row-a">Go to {homeLabel} →</span>
          </a>
        {:else}
          <button class="door-row" type="button" onclick={() => (signingIn = true)}>
            <span class="door-row-q">Hosting?</span>
            <span class="door-row-a">Sign in to your host account →</span>
          </button>
        {/if}
        <div class="door-row door-row-static">
          <span class="door-row-q">Pouring at one of these?</span>
          <span class="door-row-a">
            Tap your party above, then <strong>I'm pouring here</strong> at the foot of the menu.
          </span>
        </div>
      </section>
    {/if}

    {#if error}<p class="says says-bad" role="alert">{error}</p>{/if}
    {#if notice}<p class="says says-good" role="status">{notice}</p>{/if}
  </main>
</div>

{#if signingIn}
  <!-- The same sheet the bar's gate raises. It was inlined here while `/` was the
       only place anyone signed in; the moment "I work here" had to sign somebody in
       *without* moving them off their party, one copy of this form became two, and
       two copies of a login form is how they drift. -->
  <SignInSheet
    googleEnabled={data.googleEnabled}
    allowRegister
    onclose={() => (signingIn = false)}
    onsignedin={async () => {
      signingIn = false;
      await afterSignIn();
    }}
    onregistered={(who) => {
      signingIn = false;
      awaitingConfirmation = who;
    }}
  />
{/if}
