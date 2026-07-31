<script lang="ts">
  /**
   * Dan's desk: every host, every party, and the handful of things only he can do.
   *
   * **Not reachable by anyone else**, and it checks that with the server rather than
   * with anything this device remembers — a client that decides its own access is a
   * client that can be lied to. `refreshActor()` asks; the endpoints refuse anyway.
   *
   * One page rather than a section, because the work is a loop: pick a host, look at
   * their cupboard, make them a party, open its bar. Splitting that across routes
   * would mean four navigations to do one job.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    createParty,
    deleteHost,
    deleteParty,
    listHosts,
    myParties,
    openBar,
    signOutOfAccount,
    updateHost,
    updateParty,
    type Host,
    type Party,
  } from '$lib/api';
  import { adoptApprovedSession, refreshActor, session } from '$lib/stores/session.svelte';
  import { rememberEvent } from '$lib/party';
  import Cupboard from '$lib/components/Cupboard.svelte';

  let hosts = $state<Host[]>([]);
  let parties = $state<Party[]>([]);
  let loading = $state(true);
  let busy = $state('');
  let error = $state('');
  let notice = $state('');
  let filter = $state('');

  /** Which host is open. Null is the list. */
  let openHost = $state<Host | null>(null);
  /** Whether the cupboard panel is expanded for the open host. */
  let showCupboard = $state(false);

  let newPartyName = $state('');
  let newPartyDate = $state('');

  const isAdmin = $derived(session.actor.account?.role === 'admin');

  const shown = $derived(
    filter.trim()
      ? hosts.filter((h) =>
          `${h.name} ${h.email}`.toLowerCase().includes(filter.trim().toLowerCase()),
        )
      : hosts,
  );

  async function load(): Promise<void> {
    const [h, p] = await Promise.all([listHosts(), myParties()]);
    hosts = h.hosts;
    parties = p.events;
  }

  onMount(async () => {
    await refreshActor();
    // The server is the authority; this only avoids drawing a screen that would
    // answer 403 to everything on it.
    if (session.actor.account?.role !== 'admin') {
      await goto('/', { replaceState: true });
      return;
    }
    try {
      await load();
    } catch (e) {
      error = (e as Error).message;
    }
    loading = false;
  });

  /** One in-flight guard and one error path for every action. */
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

  function open(host: Host): void {
    openHost = host;
    showCupboard = false;
  }

  const partiesFor = (host: Host) => parties.filter((p) => p.hostUserId === host.id);

  const makeParty = (host: Host) =>
    act('new-party', async () => {
      const when = newPartyDate ? new Date(newPartyDate).getTime() : null;
      const { event } = await createParty(host.id, newPartyName.trim(), when);
      parties = [event, ...parties];
      newPartyName = '';
      newPartyDate = '';
      notice = `${event.name} created for ${host.name}.`;
    });

  const setStatus = (party: Party, status: 'draft' | 'live' | 'done') =>
    act(`status-${party.id}`, async () => {
      const { event } = await updateParty(party.id, { status });
      parties = parties.map((p) => (p.id === event.id ? event : p));
      notice = status === 'live' ? `${event.name} is open.` : `${event.name} is ${status}.`;
    });

  const removeParty = (party: Party) =>
    act(`del-${party.id}`, async () => {
      await deleteParty(party.id);
      parties = parties.filter((p) => p.id !== party.id);
      notice = `${party.name} deleted. The cupboard is untouched.`;
    });

  const setBan = (host: Host, banned: boolean) =>
    act(`ban-${host.id}`, async () => {
      const reason = banned ? (prompt('Why? (they will not see this)') ?? '') : '';
      const { host: updated } = await updateHost(host.id, { banned, reason });
      hosts = hosts.map((h) => (h.id === updated.id ? updated : h));
      if (openHost?.id === updated.id) openHost = updated;
      notice = banned ? `${updated.name} suspended.` : `${updated.name} reinstated.`;
    });

  const setRole = (host: Host, role: 'admin' | 'host') =>
    act(`role-${host.id}`, async () => {
      const { host: updated } = await updateHost(host.id, { role });
      hosts = hosts.map((h) => (h.id === updated.id ? updated : h));
      if (openHost?.id === updated.id) openHost = updated;
      notice = `${updated.name} is now ${role}.`;
    });

  const removeHost = (host: Host) =>
    act(`del-host-${host.id}`, async () => {
      if (!confirm(`Delete ${host.name}? Their parties go too. The orders go with them.`)) return;
      await deleteHost(host.id);
      hosts = hosts.filter((h) => h.id !== host.id);
      parties = parties.filter((p) => p.hostUserId !== host.id);
      openHost = null;
      notice = `${host.name} removed.`;
    });

  /**
   * Take a bar session and go.
   *
   * Admin already passes every party capability on the account cookie alone, so this
   * is not permission — it is a token for a phone that will be behind a bar all
   * night, and the row the keypad unlocks.
   */
  const enterBar = (party: Party) =>
    act(`bar-${party.id}`, async () => {
      const { token, staff } = await openBar(party.id);
      adoptApprovedSession(token, staff);
      rememberEvent(party.id);
      await goto('/bar');
    });

  const guestLink = (party: Party): string => `${page.url.origin}/e/${party.id}`;

  async function copyLink(party: Party): Promise<void> {
    try {
      await navigator.clipboard.writeText(guestLink(party));
      notice = 'Guest link copied.';
    } catch {
      notice = guestLink(party); // clipboard needs permission it may not have
    }
  }

  const leave = async () => {
    await signOutOfAccount().catch(() => {});
    await refreshActor();
    await goto('/', { replaceState: true });
  };

  const when = (ms: number | null): string =>
    ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'no date';
</script>

<svelte:head><title>Admin · COCKTAILS!!!</title></svelte:head>

<header class="appbar">
  <div class="brand">🍸 Admin</div>
  <button class="appbar-bartender" type="button" onclick={leave}>Sign out</button>
</header>

<main class="host">
  {#if loading}
    <p class="host-quiet">One moment…</p>
  {:else if !isAdmin}
    <p class="host-bad">Not your door.</p>
  {:else if openHost}
    {@const host = openHost}
    <header class="bt-staff-top">
      <h1 class="host-h1">{host.name}</h1>
      <button class="bt-chip" type="button" onclick={() => (openHost = null)}>All hosts</button>
    </header>
    <p class="host-quiet">
      {host.email}{host.role === 'admin' || host.adminByConfig ? ' · admin' : ''}{host.emailVerified
        ? ''
        : ' · unverified'}{host.bannedAt ? ' · suspended' : ''}
    </p>

    <section class="bt-staff-group">
      <h4>Their cupboard</h4>
      {#if showCupboard}
        <!-- The "do the chore for them" case: Dan fills it in when they haven't.
             Same component the host uses on their own screen — one set of rules
             about what counts as pourable, not two. -->
        <Cupboard userId={host.id} onsaved={() => (notice = `Saved ${host.name}'s cupboard.`)} />
        <button class="bt-chip" type="button" onclick={() => (showCupboard = false)}>Done</button>
      {:else}
        <p class="bt-empty">
          {host.hasStock ? 'They have recorded what they have in.' : "They haven't opened it yet."}
        </p>
        <button class="bt-chip" type="button" onclick={() => (showCupboard = true)}>
          {host.hasStock ? 'Look at it' : 'Fill it in for them'}
        </button>
      {/if}
    </section>

    <section class="bt-staff-group">
      <h4>Their parties</h4>
      {#each partiesFor(host) as party (party.id)}
        <div class="bt-staff-row">
          <div class="bt-staff-who">
            <span class="bt-name">{party.name}</span>
            <span class="bt-ago">{party.status} · {when(party.startsAt)}</span>
          </div>
          <div class="bt-acts">
            {#if party.status !== 'live'}
              <button
                class="bt-act start"
                type="button"
                disabled={!!busy}
                onclick={() => setStatus(party, 'live')}>Open</button
              >
            {:else}
              <button
                class="bt-act"
                type="button"
                disabled={!!busy}
                onclick={() => setStatus(party, 'done')}>Close</button
              >
              <button
                class="bt-act start"
                type="button"
                disabled={!!busy}
                onclick={() => enterBar(party)}>Work it</button
              >
            {/if}
            <button class="bt-act" type="button" onclick={() => copyLink(party)}>Link</button>
            <button
              class="bt-act del"
              type="button"
              disabled={!!busy}
              onclick={() => removeParty(party)}
              aria-label="Delete {party.name}">🗑</button
            >
          </div>
        </div>
      {:else}
        <p class="bt-empty">No parties yet.</p>
      {/each}

      <form
        class="host-form"
        onsubmit={(e) => {
          e.preventDefault();
          void makeParty(host);
        }}
      >
        <label class="host-label">
          New party
          <input
            class="host-input"
            bind:value={newPartyName}
            placeholder="Saturday at theirs"
            maxlength="80"
          />
        </label>
        <label class="host-label">
          When (optional)
          <input class="host-input" type="date" bind:value={newPartyDate} />
        </label>
        <button class="host-go" type="submit" disabled={!!busy}>Create it</button>
      </form>
    </section>

    <section class="bt-staff-group">
      <h4>The account</h4>
      <div class="bt-acts">
        {#if host.bannedAt}
          <button
            class="bt-act start"
            type="button"
            disabled={!!busy}
            onclick={() => setBan(host, false)}
          >
            Reinstate
          </button>
        {:else}
          <button class="bt-act" type="button" disabled={!!busy} onclick={() => setBan(host, true)}>
            Suspend
          </button>
        {/if}
        {#if host.adminByConfig}
          <span class="bt-ago">Admin by configuration — edit ADMIN_EMAILS to change</span>
        {:else if host.role === 'admin'}
          <button
            class="bt-act"
            type="button"
            disabled={!!busy}
            onclick={() => setRole(host, 'host')}
          >
            Remove admin
          </button>
        {:else}
          <button
            class="bt-act"
            type="button"
            disabled={!!busy}
            onclick={() => setRole(host, 'admin')}
          >
            Make admin
          </button>
        {/if}
        <button class="bt-act del" type="button" disabled={!!busy} onclick={() => removeHost(host)}>
          Delete
        </button>
      </div>
      {#if host.banReason}<p class="bt-staff-note">Suspended: {host.banReason}</p>{/if}
    </section>
  {:else}
    <h1 class="host-h1">Hosts</h1>
    <div class="bt-stock-search">
      <input type="search" bind:value={filter} placeholder="Search…" aria-label="Search hosts" />
    </div>

    {#each shown as host (host.id)}
      <button class="bt-staff-row admin-row" type="button" onclick={() => open(host)}>
        <span class="bt-staff-who">
          <span class="bt-name">{host.name}</span>
          <span class="bt-ago">
            {host.email}
            <!-- Effective role, not the column. Dan's own adminness comes from
                 ADMIN_EMAILS and is never written to `role`, so reading the column
                 alone showed the operator as an ordinary host in his own list. -->
            {#if host.role === 'admin' || host.adminByConfig}· admin{/if}
            {#if host.bannedAt}· suspended{/if}
            {#if !host.hasStock}· no cupboard{/if}
          </span>
        </span>
        <span class="bt-ago">{host.parties} {host.parties === 1 ? 'party' : 'parties'}</span>
      </button>
    {:else}
      <p class="bt-empty">
        {filter ? `Nobody matches “${filter}”.` : 'Nobody has registered yet.'}
      </p>
    {/each}
  {/if}

  {#if error}<p class="host-bad" role="alert">{error}</p>{/if}
  {#if notice}<p class="host-good" role="status">{notice}</p>{/if}
</main>
