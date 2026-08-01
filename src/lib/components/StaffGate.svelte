<script lang="ts">
  /**
   * The door to the bar. **One question: are you already entitled, or are you asking?**
   *
   * It used to offer three doors, led by a keypad. That keypad could never work —
   * `setAccountPin` had no endpoint and no screen, so no PIN was ever set, and it
   * answered a generic "wrong PIN" to everybody forever. It was also circular: it
   * built its request from the live account session, the very credential it existed
   * to spare a bar phone from carrying. And the join code it sat in front of was
   * *more* work for the person approving — reading six digits aloud, versus tapping
   * yes to a name already on their screen. Both are gone.
   *
   * What is left is the two answers that were ever really distinct:
   *
   * - **You have standing.** Your account may work this party, so open the bar.
   *   Nothing to type; the guard has already agreed.
   * - **Somebody has to vouch for you.** Give a name, ask, and whoever is behind the
   *   bar taps yes. They are notified, and so are you when they answer.
   *
   * Every state a request can be in is shown explicitly — sent, waiting, declined —
   * because an earlier version deleted the outcome as soon as it read it and left
   * people staring at a form with no idea what had happened. The lifecycle lives in
   * the staffRequest store, so it survives closing the panel and reloading.
   * (Approval needs no panel: the queue simply appears.)
   */
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { LIMITS } from '$lib/shared';
  import { liveParties, openBar, NotFound } from '$lib/api';
  import { adoptApprovedSession, refreshActor, session } from '$lib/stores/session.svelte';
  import {
    askToHelp,
    checkDecision,
    clearRequest,
    staffRequest,
  } from '$lib/stores/staffRequest.svelte';
  import { getSavedName, saveName } from '$lib/device';
  import SignInSheet from '$lib/components/SignInSheet.svelte';

  /**
   * **Which bar this is a door to.** It used to ask `currentEventId()` — device
   * storage — so the gate could not name what it was asking about, and could be
   * asking about a party the person had merely glanced at. It comes from the route
   * now, which is the same party the queue behind this gate belongs to.
   */
  let {
    eventId,
    partyName = '',
    onasked,
  }: { eventId: string; partyName?: string; onasked: () => void } = $props();

  /**
   * The party's name, for someone who cannot yet read the party.
   *
   * `partyById` needs `orders:read`, which is precisely what a helper standing at
   * this gate does not have — so the caller can only pass a name when the person
   * already had one. The public party list is the honest source for everyone else: a
   * bar worth asking to help at is a bar that is open, and open parties are listed.
   */
  let publicName = $state('');
  const where = $derived(partyName || publicName);

  let askName = $state(getSavedName());
  let busy = $state(false);
  let error = $state('');
  /** Signing in happens here, not somewhere else. See `signingIn` below. */
  let signingIn = $state(false);

  let message = $derived(error || session.expiredMessage);

  /**
   * Whether this device is signed in as somebody at all.
   *
   * Deliberately *not* "may they work this party" — the client cannot know that, and
   * a client that decides its own access is a client that can be lied to. It offers
   * the button to anyone holding an account and lets the server answer; a host who
   * isn't entitled gets a refusal with a reason rather than a hidden control they
   * can't see the point of.
   */
  let hasAccount = $derived(session.actor.account !== null);

  /**
   * The server has said this bar is not theirs to open.
   *
   * **Holding an account is not the same as being staff here**, and until now the
   * two were conflated: `hasAccount` alone chose the "Open the bar" branch, so a host
   * helping out at a *friend's* party got one button, a refusal, and no second move —
   * the ask-to-help form was unreachable to them by construction. That was survivable
   * while a bar could only be arrived at from the party you were already standing in.
   * `/bar/<id>` is a real address now, so it is not.
   *
   * It is a refusal to *this* attempt, not a fact about the person, so it clears when
   * they sign in as somebody else.
   */
  let refused = $state(false);
  $effect(() => {
    void session.actor;
    refused = false;
  });

  /**
   * An outstanding or unacknowledged request always wins: that's the news, and
   * burying it behind a form was the original defect.
   */
  let mode = $derived(
    staffRequest.kind === 'pending'
      ? 'waiting'
      : staffRequest.kind === 'declined'
        ? 'declined'
        : hasAccount && !refused
          ? 'open'
          : 'ask',
  );

  /**
   * Take a bar session on the account already signed in here.
   *
   * The same call `/admin`'s "Work it" makes — there is one way for an entitled
   * person to get behind a bar, and this is the other place it is offered from.
   */
  async function openTheBar() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const { token, staff } = await openBar(eventId);
      adoptApprovedSession(token, staff);
    } catch (e) {
      /**
       * **404 is the endpoint being careful, not the party being missing.** It answers
       * the same way for a party that isn't yours as for one that doesn't exist, so an
       * id cannot be used to discover whose parties are real. Surfacing that raw put
       * the word "not found" on screen about a party the person is looking at the name
       * of — so it is translated here, where the question that was asked is known.
       */
      if (e instanceof NotFound) {
        refused = true;
        error = '';
      } else {
        error = (e as Error).message || 'That bar isn’t yours to open.';
      }
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
      await askToHelp(eventId, name);
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
  const dismiss = () => clearRequest();

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

    if (!partyName) {
      void liveParties()
        .then((r) => (publicName = r.parties.find((p) => p.id === eventId)?.name ?? ''))
        .catch(() => {
          /* the copy falls back to "the bar" — never a reason to block the door */
        });
    }
  });
</script>

<div class="bt-gate">
  {#if mode === 'open'}
    <p class="bt-gate-msg">Open the bar{where ? ` at ${where}` : ''}?</p>
    <p class="bt-gate-hint">You're signed in, so this is one tap.</p>
    <button type="button" class="bt-unlock" onclick={openTheBar} disabled={busy}>
      {busy ? 'One moment…' : 'Open the bar'}
    </button>
  {:else if mode === 'ask'}
    <!-- **It says which bar.** "Helping out tonight?" could not, because the party
         came from device storage and might have been one this person merely glanced
         at on the way past. -->
    <p class="bt-gate-msg">Pouring at {where || 'this party'}?</p>
    <p class="bt-gate-hint">
      {#if refused}
        This one isn't yours to open — it's somebody else's party. Whoever's behind the bar can
        still wave you in.
      {:else}
        Give your name and whoever's behind the bar can wave you in. We'll tell you as soon as they
        do — carry on ordering meanwhile.
      {/if}
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
      {busy ? 'Sending…' : "I'm pouring here"}
    </button>
    <!--
      **This used to be the worst link in the app.** It was `href="/?signin"`, so the
      one control labelled in a barman's own words carried them off the party to a form
      whose subtitle read "for hosts and whoever is running the bar", and on to host
      registration — which grants standing at no bar at all. Three wrong turns in one
      tap, and the ask-to-help door they were one tap from was now behind finding the
      party's link again.

      It signs them in here instead. Nothing moves; the sheet closes and `mode` flips
      to `open`, which is the "you already have standing" branch two states up.
    -->
    {#if !hasAccount}
      <button type="button" class="bt-gate-alt" onclick={() => (signingIn = true)}>
        I already have an account
      </button>
    {/if}
  {:else if mode === 'waiting'}
    <p class="bt-status-badge is-sent">✓ Request sent</p>
    <p class="bt-gate-msg">Waiting for the bar…</p>
    <p class="bt-gate-hint">
      Asked as <strong>{staffRequest.name}</strong>, {since(staffRequest.at)}. We've told them.
    </p>
    <button type="button" class="bt-gate-alt" onclick={dismiss}>Cancel</button>
  {:else}
    <p class="bt-status-badge is-declined">✕ Not this time</p>
    <p class="bt-gate-msg">They didn't let you in</p>
    <p class="bt-gate-hint">Have a word with whoever's pouring, then ask again.</p>
    <button type="button" class="bt-unlock" onclick={dismiss}>Ask again</button>
  {/if}

  {#if message}<p class="bt-conn" role="status">{message}</p>{/if}
</div>

{#if signingIn}
  <!-- No `allowRegister`: a brand-new account has standing at no party, so offering
       one here would answer a question nobody asked and cost an email round trip to
       find that out. Someone with no account is already looking at the door that
       does work — it's the button above this one. -->
  <SignInSheet
    googleEnabled={Boolean(page.data.googleEnabled)}
    hint="Hosts and admins. If you're just helping out, ask to be waved in instead — you don't need an account."
    onclose={() => (signingIn = false)}
    onsignedin={async () => {
      signingIn = false;
      // The gate reads `session.actor`, so it has to be re-asked before `mode` can
      // move off `ask` — signing in changes who the server says we are.
      await refreshActor();
    }}
  />
{/if}
