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
  import { LIMITS } from '$lib/shared';
  import { openBar } from '$lib/api';
  import { adoptApprovedSession, session } from '$lib/stores/session.svelte';
  import { currentEventId } from '$lib/party';
  import {
    askToHelp,
    checkDecision,
    clearRequest,
    staffRequest,
  } from '$lib/stores/staffRequest.svelte';
  import { getSavedName, saveName } from '$lib/device';

  /** Fired once a request is lodged, so the bar can get out of the way. */
  let { onasked }: { onasked: () => void } = $props();

  let askName = $state(getSavedName());
  let busy = $state(false);
  let error = $state('');

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
   * An outstanding or unacknowledged request always wins: that's the news, and
   * burying it behind a form was the original defect.
   */
  let mode = $derived(
    staffRequest.kind === 'pending'
      ? 'waiting'
      : staffRequest.kind === 'declined'
        ? 'declined'
        : hasAccount
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
      const eventId = currentEventId();
      if (!eventId) {
        error = 'Open this party’s link first, so we know which bar you mean.';
        return;
      }
      const { token, staff } = await openBar(eventId);
      adoptApprovedSession(token, staff);
    } catch (e) {
      error = (e as Error).message || 'That bar isn’t yours to open.';
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
      const eventId = currentEventId();
      if (!eventId) {
        error = 'Open this party’s link first, so we know which bar you mean.';
        return;
      }
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
  });
</script>

<div class="bt-gate">
  {#if mode === 'open'}
    <p class="bt-gate-msg">Ready when you are</p>
    <p class="bt-gate-hint">You're signed in, so this is one tap.</p>
    <button type="button" class="bt-unlock" onclick={openTheBar} disabled={busy}>
      {busy ? 'One moment…' : 'Open the bar'}
    </button>
  {:else if mode === 'ask'}
    <p class="bt-gate-msg">Helping out tonight?</p>
    <p class="bt-gate-hint">
      Give your name and whoever's behind the bar can wave you in. We'll tell you as soon as they do
      — carry on ordering meanwhile.
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
      {busy ? 'Sending…' : 'Ask to help'}
    </button>
    <!-- The way in for anyone who works here. Opens the sign-in drawer on the front
         door rather than merely landing on it — `/` is the party list now, so a bare
         link left people looking at a list of parties wondering where the form went. -->
    <a class="bt-gate-alt" href="/?signin">I work here</a>
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
