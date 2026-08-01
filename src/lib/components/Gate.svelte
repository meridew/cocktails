<script lang="ts">
  /**
   * May you see this screen — and if not, **the right door rather than a redirect**.
   *
   * ## What it replaces
   *
   * `/admin`, `/host` and `/host/[id]` each rolled their own guard: an `onMount` that
   * called `refreshActor()` and then `goto('/')` or `goto('/host')`. Three copies,
   * three destinations, and **not one of them remembered where you had been trying to
   * go**. So a bookmark, a shared link or a push notification aimed at a deep page
   * signed you in and dropped you at the front door, with the thing you came for
   * forgotten. It accidentally worked for hosts and admins, because the front door
   * happened to send them somewhere useful afterwards. It could never work for a
   * helper, because there is no account sign-in for helpers at all.
   *
   * ## Three outcomes, none of them a redirect
   *
   * - **Satisfied** → render the page.
   * - **Nobody is signed in** → sign in *here*, keeping the URL, and carry on to it.
   * - **Signed in, but with no claim on this** → say so plainly. Not a bounce to
   *   somewhere they didn't ask for.
   *
   * It asks `can(actor, capability, scope)` — the same object and the same function
   * the server's `requireCapability` uses — so a screen that renders is a screen the
   * endpoints will honour, and the two cannot drift into disagreeing.
   */
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { can, type Capability, type Scope } from '$lib/shared';
  import { refreshActor, session } from '$lib/stores/session.svelte';
  import SignInSheet from '$lib/components/SignInSheet.svelte';

  let {
    capability,
    scope,
    /** What to call this place when telling somebody they can't come in. */
    what = 'this screen',
    children,
  }: {
    /**
     * Omit both to mean **"signed in as anybody"**, which is a real requirement and
     * not a capability: a host's own area asks who you are, not what you may do — the
     * cupboard and party list on it are already scoped to the account that fetched
     * them. Inventing a `host:self` capability to say that would put a permission in
     * the table that no endpoint ever checks, which is how the last permission model
     * went wrong.
     */
    capability?: Capability;
    scope?: Scope;
    what?: string;
    children: Snippet;
  } = $props();

  let asked = $state(false);
  let signingIn = $state(false);

  const allowed = $derived(
    capability && scope ? can(session.actor, capability, scope) : session.actor.account !== null,
  );
  const signedIn = $derived(session.actor.account !== null);

  onMount(async () => {
    // The server is the authority on who we are, and a reload keeps the credential
    // but not what it means. Nothing renders until it has answered — including the
    // refusal, which would otherwise flash for anyone perfectly entitled.
    await refreshActor();
    asked = true;
  });
</script>

{#if !asked}
  <p class="empty">One moment…</p>
{:else if allowed}
  {@render children()}
{:else if !signedIn}
  <!-- The URL is untouched, so signing in continues to the page that was asked for.
       That is the whole point: a deep link that survives its own permission check. -->
  <section class="panel">
    <h2>Sign in to see this</h2>
    <p>{what} is for hosts and admins. Signing in brings you straight back here.</p>
    <button class="btn btn-go" type="button" onclick={() => (signingIn = true)}> Sign in </button>
  </section>
{:else}
  <section class="panel">
    <h2>Not your door</h2>
    <p>
      You're signed in, but this account has no claim on {what}. If that's wrong, whoever set the
      party up can sort it.
    </p>
    <a class="btn btn-go" href="/">What's on</a>
  </section>
{/if}

{#if signingIn}
  <SignInSheet
    googleEnabled={Boolean(page.data.googleEnabled)}
    onclose={() => (signingIn = false)}
    onsignedin={async () => {
      signingIn = false;
      await refreshActor();
    }}
  />
{/if}
