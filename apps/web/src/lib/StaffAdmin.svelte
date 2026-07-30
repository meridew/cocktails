<script lang="ts">
  /**
   * Admin-only: decide who can run the bar.
   *
   * The parent owns the polling (it already has a 4s tick) and passes the list
   * down; this component renders it and performs the actions, asking the parent to
   * refresh afterwards. That keeps one fetcher rather than two competing ones.
   */
  import { SvelteSet } from 'svelte/reactivity';
  import type { Staff } from '@cocktails/shared';
  import {
    approveStaff,
    createJoinCode,
    removeStaff,
    revokeAllHelpers,
    revokeJoinCodes,
    revokeStaff,
    Unauthorized,
  } from './api.ts';
  import { session } from './session.svelte';

  let {
    staff,
    loaded,
    onchanged,
    onclose,
  }: {
    staff: Staff[];
    loaded: boolean;
    onchanged: () => void;
    onclose: () => void;
  } = $props();

  let err = $state('');
  let busy = new SvelteSet<string>();
  let confirmingRevokeAll = $state(false);

  /** The live join code, once minted. Shown in the clear — that's its whole job. */
  let joinCode = $state<{ code: string; expiresAt: number } | null>(null);
  /** Ticks so the countdown is honest about how long is left. */
  let nowMs = $state(Date.now());
  $effect(() => {
    if (!joinCode) return;
    const t = setInterval(() => (nowMs = Date.now()), 1000);
    return () => clearInterval(t);
  });
  let codeLeft = $derived(joinCode ? Math.max(0, joinCode.expiresAt - nowMs) : 0);
  // Drop it from the screen the moment it stops working, rather than leaving a
  // dead code up for someone to read out.
  $effect(() => {
    if (joinCode && codeLeft <= 0) joinCode = null;
  });

  let pending = $derived(staff.filter((s) => s.status === 'pending'));
  let helpers = $derived(staff.filter((s) => s.status !== 'pending' && s.role !== 'admin'));
  let admins = $derived(staff.filter((s) => s.role === 'admin'));

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

  const mmss = (ms: number): string => {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

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

  <!-- The fast path: read this out to whoever's next to you and they're in. No
       waiting, no approval round-trip, nothing to notice and act on later. -->
  <section class="bt-staff-group">
    <h4>Add someone now</h4>
    {#if joinCode}
      <p class="joincode" aria-label="Join code {joinCode.code.split('').join(' ')}">
        {joinCode.code}
      </p>
      <p class="bt-staff-note">
        They tap 🍸 → “Helping out tonight?” and type this. Expires in {mmss(codeLeft)}.
      </p>
      <div class="bt-acts">
        <button
          type="button"
          class="bt-act"
          disabled={busy.has('__code')}
          onclick={() =>
            act('__code', async () => {
              joinCode = await createJoinCode();
            })}
        >
          New code
        </button>
        <button
          type="button"
          class="bt-act del"
          disabled={busy.has('__code')}
          onclick={() =>
            act('__code', async () => {
              await revokeJoinCodes();
              joinCode = null;
            })}
        >
          Stop sharing
        </button>
      </div>
    {:else}
      <button
        type="button"
        class="bt-chip"
        disabled={busy.has('__code')}
        onclick={() =>
          act('__code', async () => {
            joinCode = await createJoinCode();
          })}
      >
        Show a join code
      </button>
    {/if}
  </section>

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
            <span class="bt-name">{person.name}</span>
            <span class="bt-ago">asked {ago(person.createdAt)} ago</span>
          </div>
          <div class="bt-acts">
            <button
              type="button"
              class="bt-act start"
              disabled={busy.has(person.id)}
              onclick={() => act(person.id, () => approveStaff(person.id))}
            >
              ✓ Approve
            </button>
            <button
              type="button"
              class="bt-act del"
              disabled={busy.has(person.id)}
              onclick={() => act(person.id, () => removeStaff(person.id))}
              aria-label="Deny {person.name}"
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
            <span class="bt-name">{person.name}</span>
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
                onclick={() => act(person.id, () => revokeStaff(person.id))}
              >
                Revoke
              </button>
            {/if}
            <button
              type="button"
              class="bt-act del"
              disabled={busy.has(person.id)}
              onclick={() => act(person.id, () => removeStaff(person.id))}
              aria-label="Remove {person.name}"
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
                    await revokeAllHelpers();
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

  <section class="bt-staff-group">
    <h4>Admins</h4>
    {#each admins as person (person.id)}
      <div class="bt-staff-row">
        <div class="bt-staff-who">
          <span class="bt-name">{person.name}</span>
          <span class="bt-ago">
            {person.email}{person.id === session.staff?.id ? ' · you' : ''}
          </span>
        </div>
      </div>
    {/each}
    <p class="bt-staff-note">Admins sign in with the bar PIN and can't be revoked here.</p>
  </section>
</div>
