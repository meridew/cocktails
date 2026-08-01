<script lang="ts">
  /**
   * One host, at their own address. Was `openHost` on `/admin`.
   *
   * The cupboard here is the same component the host uses on their own screen,
   * because it is the same list under the same rules — two copies would be two sets
   * of decisions about what counts as pourable.
   */
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    createParty,
    deleteHost,
    listHosts,
    myParties,
    openBar,
    updateHost,
    updateParty,
    type Host,
    type Party,
  } from '$lib/api';
  import { platform } from '$lib/shared';
  import { adoptApprovedSession, session } from '$lib/stores/session.svelte';
  import { rememberEvent } from '$lib/party';
  import AppBar from '$lib/components/AppBar.svelte';
  import Cupboard from '$lib/components/Cupboard.svelte';
  import Gate from '$lib/components/Gate.svelte';
  import PartyRow from '$lib/components/PartyRow.svelte';
  import WorkSheet from '$lib/components/WorkSheet.svelte';

  const userId = $derived(page.params.id!);

  let host = $state<Host | null>(null);
  let parties = $state<Party[]>([]);
  let loading = $state(true);
  let busy = $state('');
  let error = $state('');
  let notice = $state('');
  let cupboardOpen = $state(false);

  let newPartyName = $state('');
  let newPartyDate = $state('');

  const theirs = $derived(parties.filter((p) => p.hostUserId === userId));

  async function load(): Promise<void> {
    const [h, p] = await Promise.all([
      listHosts().catch(() => null),
      myParties().catch(() => null),
    ]);
    host = h?.hosts.find((x) => x.id === userId) ?? null;
    parties = p?.events ?? [];
  }

  let started = false;
  $effect(() => {
    if (session.actor.account?.role !== 'admin' || started) return;
    started = true;
    void (async () => {
      await load();
      loading = false;
    })();
  });

  async function act(key: string, fn: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = key;
    error = '';
    notice = '';
    try {
      await fn();
    } catch (e) {
      error = (e as Error).message || "That didn't go through.";
    } finally {
      busy = '';
    }
  }

  const makeParty = () =>
    act('new-party', async () => {
      const when = newPartyDate ? new Date(newPartyDate).getTime() : null;
      const { event } = await createParty(userId, newPartyName.trim(), when);
      parties = [event, ...parties];
      newPartyName = '';
      newPartyDate = '';
      notice = `${event.name} created.`;
    });

  const openParty = (party: Party) =>
    act(`status-${party.id}`, async () => {
      const { event } = await updateParty(party.id, { status: 'live' });
      parties = parties.map((p) => (p.id === event.id ? event : p));
      notice = `${event.name} is open.`;
    });

  const work = (party: Party) =>
    act(`bar-${party.id}`, async () => {
      const { token, staff } = await openBar(party.id);
      adoptApprovedSession(token, staff);
      rememberEvent(party.id);
      await goto(`/bar/${party.id}`);
    });

  const setBan = (banned: boolean) =>
    act('ban', async () => {
      const reason = banned ? (prompt('Why? (they will not see this)') ?? '') : '';
      const { host: updated } = await updateHost(userId, { banned, reason });
      host = updated;
      notice = banned ? `${updated.name} suspended.` : `${updated.name} reinstated.`;
    });

  const setRole = (role: 'admin' | 'host') =>
    act('role', async () => {
      const { host: updated } = await updateHost(userId, { role });
      host = updated;
      notice = `${updated.name} is now ${role}.`;
    });

  const remove = () =>
    act('delete', async () => {
      if (!host) return;
      if (!confirm(`Delete ${host.name}? Their parties go too. The orders go with them.`)) return;
      await deleteHost(userId);
      await goto('/admin/hosts', { replaceState: true });
    });
</script>

<svelte:head><title>{host?.name ?? 'Host'} · COCKTAILS!!!</title></svelte:head>

<div class="workshell">
  <AppBar up={{ href: '/admin/hosts', label: 'Hosts' }} title={host?.name ?? 'Host'} />

  <main class="deck">
    <Gate capability="host:list" scope={platform()} what="The admin desk">
      {#if loading}
        <p class="empty">One moment…</p>
      {:else if !host}
        <section class="panel">
          <h2>No such host</h2>
          <p>They may have been deleted.</p>
          <a class="btn btn-go" href="/admin/hosts">Back to the hosts</a>
        </section>
      {:else}
        {@const h = host}
        <p class="stat">
          {h.email}{h.role === 'admin' || h.adminByConfig ? ' · admin' : ''}{h.emailVerified
            ? ''
            : ' · unverified'}{h.bannedAt ? ' · suspended' : ''}
        </p>

        <section class="panel">
          <h2>Their cupboard</h2>
          <p class="card-stat">
            {#if h.hasStock}
              <span class="row-note">They've said what they have in.</span>
            {:else}
              <span class="row-note">
                They haven't opened it yet — the menu falls back to a short standard one.
              </span>
            {/if}
          </p>
          <!-- The "do the chore for them" case. Same component the host uses on their
               own screen — one set of rules about what counts as pourable, not two. -->
          <button class="btn" type="button" onclick={() => (cupboardOpen = true)}>
            {h.hasStock ? 'Look at it' : 'Fill it in for them'}
          </button>
        </section>

        <section class="panel">
          <h2>Their parties</h2>
          {#each theirs as party (party.id)}
            <PartyRow {party} by="host" busy={Boolean(busy)} onwork={work} onopen={openParty} />
          {:else}
            <p class="empty">No parties yet.</p>
          {/each}
        </section>

        <section class="panel">
          <h2>New party for {h.name}</h2>
          <form
            onsubmit={(e) => {
              e.preventDefault();
              void makeParty();
            }}
          >
            <label class="field">
              What's it called
              <input bind:value={newPartyName} placeholder="Saturday at theirs" maxlength="80" />
            </label>
            <label class="field">
              When (optional)
              <input type="date" bind:value={newPartyDate} />
            </label>
            <button
              class="btn btn-go"
              type="submit"
              disabled={Boolean(busy) || !newPartyName.trim()}
            >
              Create it
            </button>
          </form>
        </section>

        <section class="panel">
          <h2>The account</h2>
          {#if h.banReason}<p>Suspended: {h.banReason}</p>{/if}
          <div class="row-acts">
            {#if h.bannedAt}
              <button
                class="btn btn-go"
                type="button"
                disabled={Boolean(busy)}
                onclick={() => setBan(false)}
              >
                Reinstate
              </button>
            {:else}
              <button
                class="btn"
                type="button"
                disabled={Boolean(busy)}
                onclick={() => setBan(true)}
              >
                Suspend
              </button>
            {/if}
            {#if h.adminByConfig}
              <span class="row-note">Admin by configuration — edit ADMIN_EMAILS to change</span>
            {:else if h.role === 'admin'}
              <button
                class="btn"
                type="button"
                disabled={Boolean(busy)}
                onclick={() => setRole('host')}
              >
                Remove admin
              </button>
            {:else}
              <button
                class="btn"
                type="button"
                disabled={Boolean(busy)}
                onclick={() => setRole('admin')}
              >
                Make admin
              </button>
            {/if}
          </div>
          <div class="danger-zone">
            <p>Deleting {h.name} deletes their parties and every order in them.</p>
            <button class="btn btn-danger" type="button" disabled={Boolean(busy)} onclick={remove}>
              Delete this account
            </button>
          </div>
        </section>
      {/if}

      {#if error}<p class="says says-bad" role="alert">{error}</p>{/if}
      {#if notice}<p class="says says-good" role="status">{notice}</p>{/if}
    </Gate>
  </main>
</div>

{#if cupboardOpen && host}
  <WorkSheet
    title="Their cupboard"
    subtitle={host.name}
    onclose={() => {
      cupboardOpen = false;
      void load();
    }}
  >
    <Cupboard userId={host.id} onsaved={() => (notice = `Saved ${host?.name}'s cupboard.`)} />
  </WorkSheet>
{/if}
