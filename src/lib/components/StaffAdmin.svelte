<script lang="ts">
  /**
   * Admin-only: decide who can run the bar.
   *
   * The parent owns the polling (it already has a 4s tick) and passes the list
   * down; this component renders it and performs the actions, asking the parent to
   * refresh afterwards. That keeps one fetcher rather than two competing ones.
   */
  import { SvelteSet } from 'svelte/reactivity';
  import type { Staff } from '$lib/shared';
  import { approveStaff, removeStaff, revokeAllHelpers, revokeStaff, Unauthorized } from '$lib/api';

  let {
    staff,
    loaded,
    eventId,
    onchanged,
    onclose,
  }: {
    staff: Staff[];
    loaded: boolean;
    /**
     * **Which party, said out loud.** Every call on this screen is party-scoped on
     * the server, and none of them used to say which — so they worked for a helper
     * (who holds a bar token that names one) and answered 400 for an account-holder
     * who had not taken one. That is Dan opening `/bar/<id>` from a link rather than
     * through "Work it", and it made pending requests invisible to the one person
     * who can approve them.
     */
    eventId: string;
    onchanged: () => void;
    onclose: () => void;
  } = $props();

  let err = $state('');
  let busy = new SvelteSet<string>();
  let confirmingRevokeAll = $state(false);

  // The join-code state that used to live here — the code, a one-second ticker, a
  // countdown and an `mmss` formatter — went when the codes did. Nothing had
  // assigned `joinCode` since, so the ticker never started and the countdown was
  // permanently zero: forty lines the typecheck was happy with and no eye would
  // catch, because it rendered nothing.

  // Two groups, not three. There is no "admins" section any more: everyone in this
  // list does the same job, and the person who used to sit apart in it holds an
  // account whose powers don't come from a row here at all.
  let pending = $derived(staff.filter((s) => s.status === 'pending'));
  let helpers = $derived(staff.filter((s) => s.status !== 'pending'));

  /** One in-flight guard and one error path for every action. */
  async function act(id: string, fn: () => Promise<unknown>) {
    if (busy.has(id)) return;
    busy.add(id);
    err = '';
    try {
      await fn();
      onchanged();
    } catch (e) {
      // A 401 already ended the session in api.ts; nothing to report here.
      if (!(e instanceof Unauthorized)) err = (e as Error).message || "That didn't go through";
    } finally {
      busy.delete(id);
    }
  }

  /** A row with no name still has to say who it is — see the endpoint that fills it. */
  const nameOf = (person: Staff): string => person.name.trim() || 'Unnamed';

  const ago = (ts: number): string => {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
  };
</script>

<div class="bt-staff">
  <header class="bt-staff-top">
    <h3>Bar staff</h3>
    <button type="button" class="bt-chip" onclick={onclose}>Back to orders</button>
  </header>

  {#if err}<p class="bt-conn" role="status">{err}</p>{/if}

  <section class="bt-staff-group">
    <h4>
      Requests
      {#if pending.length}<span class="bt-badge b-pending">{pending.length}</span>{/if}
    </h4>
    {#if pending.length === 0}
      <p class="bt-empty">{loaded ? 'No one waiting.' : 'Loading…'}</p>
    {:else}
      {#each pending as person (person.id)}
        <div class="bt-staff-row">
          <div class="bt-staff-who">
            <span class="bt-name">{nameOf(person)}</span>
            <span class="bt-ago">asked {ago(person.createdAt)} ago</span>
          </div>
          <div class="bt-acts">
            <button
              type="button"
              class="bt-act start"
              disabled={busy.has(person.id)}
              onclick={() => act(person.id, () => approveStaff(person.id, eventId))}
            >
              ✓ Approve
            </button>
            <button
              type="button"
              class="bt-act del"
              disabled={busy.has(person.id)}
              onclick={() => act(person.id, () => removeStaff(person.id, eventId))}
              aria-label="Deny {nameOf(person)}"
            >
              ✕
            </button>
          </div>
        </div>
      {/each}
    {/if}
  </section>

  <section class="bt-staff-group">
    <h4>Helpers</h4>
    {#if helpers.length === 0}
      <p class="bt-empty">No helpers yet.</p>
    {:else}
      {#each helpers as person (person.id)}
        <div class="bt-staff-row" class:is-revoked={person.status === 'revoked'}>
          <div class="bt-staff-who">
            <span class="bt-name">{nameOf(person)}</span>
            <span class="bt-ago">
              {person.status === 'revoked'
                ? 'no longer has access'
                : `joined ${ago(person.createdAt)} ago`}
            </span>
          </div>
          <div class="bt-acts">
            {#if person.status === 'active'}
              <button
                type="button"
                class="bt-act"
                disabled={busy.has(person.id)}
                onclick={() => act(person.id, () => revokeStaff(person.id, eventId))}
              >
                Revoke
              </button>
            {/if}
            <button
              type="button"
              class="bt-act del"
              disabled={busy.has(person.id)}
              onclick={() => act(person.id, () => removeStaff(person.id, eventId))}
              aria-label="Remove {nameOf(person)}"
            >
              🗑
            </button>
          </div>
        </div>
      {/each}

      <!-- End of the night: everyone loses access at once. Admins are untouched. -->
      {#if helpers.some((h) => h.status === 'active')}
        {#if confirmingRevokeAll}
          <div class="bt-staff-row">
            <span class="bt-staff-who">Revoke every helper?</span>
            <div class="bt-acts">
              <button
                type="button"
                class="bt-act del"
                disabled={busy.has('__all')}
                onclick={() =>
                  act('__all', async () => {
                    await revokeAllHelpers(eventId);
                    confirmingRevokeAll = false;
                  })}
              >
                Yes, revoke all
              </button>
              <button type="button" class="bt-act" onclick={() => (confirmingRevokeAll = false)}>
                Cancel
              </button>
            </div>
          </div>
        {:else}
          <button type="button" class="bt-chip" onclick={() => (confirmingRevokeAll = true)}>
            Revoke all helpers
          </button>
        {/if}
      {/if}
    {/if}
  </section>

  <!-- The "Admins" section that used to sit here is gone. It listed staff rows whose
       role said admin, which is no longer a thing a staff row can say — being an
       admin is a fact about an account, and this screen is about one party's shift. -->
</div>
