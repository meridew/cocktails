<script lang="ts">
  /**
   * Dan's desk: every party, every host, and the handful of things only he can do.
   *
   * **Not reachable by anyone else**, and it checks that with the server rather than
   * with anything this device remembers — a client that decides its own access is a
   * client that can be lied to. `refreshActor()` asks; the endpoints refuse anyway.
   *
   * ## Parties first, hosts second
   *
   * This screen used to open on a list of hosts, because that is how the data is
   * shaped: a cupboard hangs off a person, and a party hangs off the cupboard. But
   * the *work* is a party — "is Saturday open yet", "what is the bar pouring
   * tonight" — and asking that question meant first remembering whose party it was.
   * That is not hypothetical: backfilling a cupboard recently began with a database
   * query to find out which of two accounts owned the party in question, because the
   * screen could not answer it.
   *
   * So the top level is parties grouped by state, with the host as an attribute, and
   * hosts are the second tab where account admin lives.
   *
   * ## Nothing expands in place
   *
   * The cupboard and the short list are screens, not panels — see WorkSheet.svelte.
   * Everything else states its facts on a card and offers one way in. That is the
   * rule that keeps this page a page: no section may *become* the thing it describes.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    createParty,
    deleteHost,
    deleteParty,
    eventMenu,
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
  import ShortList from '$lib/components/ShortList.svelte';
  import WorkSheet from '$lib/components/WorkSheet.svelte';

  let hosts = $state<Host[]>([]);
  let parties = $state<Party[]>([]);
  let loading = $state(true);
  let busy = $state('');
  let error = $state('');
  let notice = $state('');
  let filter = $state('');

  /** Which of the two top-level lists is showing. */
  let tab = $state<'parties' | 'hosts'>('parties');
  /** Drilled into a host, a party, or neither. A party wins if both are set. */
  let openHost = $state<Host | null>(null);
  let openParty = $state<Party | null>(null);
  /** The full-screen job in front of everything, if any. */
  let sheet = $state<'cupboard' | 'menu' | null>(null);

  /** The open party's menu summary, so its card can say more than "curate this". */
  let menuSummary = $state<{ featured: number; total: number } | null>(null);

  let newPartyHost = $state('');
  let newPartyName = $state('');
  let newPartyDate = $state('');

  const isAdmin = $derived(session.actor.account?.role === 'admin');

  const shownHosts = $derived(
    filter.trim()
      ? hosts.filter((h) =>
          `${h.name} ${h.email}`.toLowerCase().includes(filter.trim().toLowerCase()),
        )
      : hosts,
  );

  const hostFor = (party: Party): Host | undefined => hosts.find((h) => h.id === party.hostUserId);

  /**
   * The three states, in the order they matter tonight.
   *
   * Live first because it is the only one with anything happening in it, and done
   * last because it is history. A group with nothing in it is dropped rather than
   * rendered empty — an empty heading reads as something failing to load.
   */
  const groups = $derived(
    (
      [
        { key: 'live', label: 'On now', list: parties.filter((p) => p.status === 'live') },
        { key: 'draft', label: 'Not open yet', list: parties.filter((p) => p.status === 'draft') },
        { key: 'done', label: 'Finished', list: parties.filter((p) => p.status === 'done') },
      ] as const
    ).filter((g) => g.list.length > 0),
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

  function showHost(host: Host): void {
    openHost = host;
    openParty = null;
    sheet = null;
  }

  /** Opening a party loads its menu summary; the card is useless without it. */
  async function showParty(party: Party): Promise<void> {
    openParty = party;
    sheet = null;
    menuSummary = null;
    try {
      const menu = await eventMenu(party.id);
      menuSummary = { featured: menu.shortList.length, total: menu.items.length };
    } catch {
      /* the card falls back to its "couldn't count" copy */
    }
  }

  /** Back out of a party to wherever it was opened from. */
  const closeParty = (): void => {
    openParty = null;
    menuSummary = null;
  };

  const partiesFor = (host: Host) => parties.filter((p) => p.hostUserId === host.id);

  const makeParty = () =>
    act('new-party', async () => {
      const hostId = openHost?.id || newPartyHost;
      if (!hostId) {
        error = 'Pick whose party it is.';
        return;
      }
      const when = newPartyDate ? new Date(newPartyDate).getTime() : null;
      const { event } = await createParty(hostId, newPartyName.trim(), when);
      parties = [event, ...parties];
      newPartyName = '';
      newPartyDate = '';
      notice = `${event.name} created for ${hosts.find((h) => h.id === hostId)?.name ?? 'them'}.`;
    });

  const setStatus = (party: Party, status: 'draft' | 'live' | 'done') =>
    act(`status-${party.id}`, async () => {
      const { event } = await updateParty(party.id, { status });
      parties = parties.map((p) => (p.id === event.id ? event : p));
      if (openParty?.id === event.id) openParty = event;
      notice = status === 'live' ? `${event.name} is open.` : `${event.name} is ${status}.`;
    });

  const removeParty = (party: Party) =>
    act(`del-${party.id}`, async () => {
      if (!confirm(`Delete ${party.name}? The orders go with it.`)) return;
      await deleteParty(party.id);
      parties = parties.filter((p) => p.id !== party.id);
      if (openParty?.id === party.id) closeParty();
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
      // Named in the address. `/bar` used to be told which party by `rememberEvent`
      // above, which is the same storage any guest menu overwrites.
      await goto(`/bar/${party.id}`);
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

  const STATUS_WORD = { draft: 'Not open', live: 'On now', done: 'Finished' } as const;

  /**
   * The line under a party's name, built here rather than in the markup.
   *
   * Assembling it from `{#if}` blocks inline put the separator's whitespace at the
   * mercy of the formatter, which reflowed it onto its own line and shipped
   * "Sam ·no date". A string is a string.
   */
  const partyNote = (party: Party, showHost: boolean): string =>
    [showHost ? (hostFor(party)?.name ?? 'unknown host') : '', when(party.startsAt)]
      .filter(Boolean)
      .join(' · ');
</script>

<svelte:head><title>Admin · COCKTAILS!!!</title></svelte:head>

<!--
  One row shape for a party, used by both lists.

  The body opens it and exactly one action sits outside — the one you came for. The
  previous row put Close, Work it, Menu, Link and Delete side by side as five equal
  pills, which is how Delete ended up the same weight as Link.

  `by` says which list this is in, and it decides what the row must not repeat.
  Under a "On now" heading the status pill is noise on every row; in a host's own
  list the statuses are mixed and the pill is the point, while the host's name is
  the thing already known.
-->
{#snippet partyRow(party: Party, by: 'status' | 'host')}
  <div class="row">
    <button class="row-open" type="button" onclick={() => showParty(party)}>
      <span class="row-name">{party.name}</span>
      <span class="row-note">{partyNote(party, by === 'status')}</span>
    </button>
    <span class="row-acts">
      {#if by === 'host'}
        <span
          class="pill"
          class:pill-live={party.status === 'live'}
          class:pill-done={party.status === 'done'}
        >
          {STATUS_WORD[party.status]}
        </span>
      {/if}
      {#if party.status === 'live'}
        <button class="btn btn-go" type="button" disabled={!!busy} onclick={() => enterBar(party)}>
          Work it
        </button>
      {:else if party.status === 'draft'}
        <button
          class="btn btn-go"
          type="button"
          disabled={!!busy}
          onclick={() => setStatus(party, 'live')}
        >
          Open
        </button>
      {/if}
    </span>
  </div>
{/snippet}

<div class="workshell">
  <header class="appbar">
    <div class="brand">🍸 Admin</div>
    <button class="appbar-bartender appbar-word" type="button" onclick={leave}>Sign out</button>
  </header>

  <main class="deck">
    {#if loading}
      <p class="empty">One moment…</p>
    {:else if !isAdmin}
      <p class="says says-bad">Not your door.</p>

      <!-- ---- one party ---- -->
    {:else if openParty}
      {@const party = openParty}
      {@const host = hostFor(party)}
      <section class="panel">
        <div class="row">
          <span class="row-main">
            <span class="row-name">{party.name}</span>
            <span class="row-note">{host?.name ?? 'unknown host'} · {when(party.startsAt)}</span>
          </span>
          <span class="row-acts">
            <button class="btn" type="button" onclick={closeParty}>Back</button>
          </span>
        </div>
      </section>

      <section class="panel">
        <h2>The bar</h2>
        <p class="card-stat">
          <span
            class="pill"
            class:pill-live={party.status === 'live'}
            class:pill-done={party.status === 'done'}
          >
            {STATUS_WORD[party.status]}
          </span>
          <span class="row-note">
            {party.status === 'live'
              ? 'Guests can order.'
              : party.status === 'draft'
                ? "Guests see the menu but can't order yet."
                : 'The bar has closed.'}
          </span>
        </p>
        <div class="row-acts">
          {#if party.status !== 'live'}
            <button
              class="btn btn-go"
              type="button"
              disabled={!!busy}
              onclick={() => setStatus(party, 'live')}>Open the bar</button
            >
          {:else}
            <button
              class="btn btn-go"
              type="button"
              disabled={!!busy}
              onclick={() => enterBar(party)}
            >
              Work it
            </button>
            <button
              class="btn"
              type="button"
              disabled={!!busy}
              onclick={() => setStatus(party, 'done')}>Close the bar</button
            >
          {/if}
        </div>
      </section>

      <section class="panel">
        <h2>What it leads with</h2>
        <p class="card-stat">
          {#if !menuSummary}
            <span class="row-note">Counting…</span>
          {:else if menuSummary.featured === 0}
            <b>{menuSummary.total}</b>
            <span class="row-note">drinks — guests see them all</span>
          {:else}
            <b>{menuSummary.featured}</b>
            <span class="row-note">featured of {menuSummary.total}</span>
          {/if}
        </p>
        <button class="btn" type="button" onclick={() => (sheet = 'menu')}>Choose drinks</button>
      </section>

      <section class="panel">
        <h2>Their guests' link</h2>
        <p>Put this under a QR code on the table, or send it round.</p>
        <div class="row-acts">
          <button class="btn" type="button" onclick={() => copyLink(party)}>Copy the link</button>
          <a class="btn" href="/e/{party.id}">See their menu</a>
        </div>
      </section>

      <!-- Its own card, so it needs no rule above it — `.danger-zone` is for when
           something destructive has to share a card with something ordinary. -->
      <section class="panel">
        <h2>Getting rid of it</h2>
        <p>Deleting this party takes its orders with it. The cupboard is untouched.</p>
        <button
          class="btn btn-danger"
          type="button"
          disabled={!!busy}
          onclick={() => removeParty(party)}>Delete this party</button
        >
      </section>

      <!-- ---- one host ---- -->
    {:else if openHost}
      {@const host = openHost}
      <section class="panel">
        <div class="row">
          <span class="row-main">
            <span class="row-name">{host.name}</span>
            <span class="row-note">
              {host.email}{host.role === 'admin' || host.adminByConfig
                ? ' · admin'
                : ''}{host.emailVerified ? '' : ' · unverified'}{host.bannedAt
                ? ' · suspended'
                : ''}
            </span>
          </span>
          <span class="row-acts">
            <button class="btn" type="button" onclick={() => (openHost = null)}>All hosts</button>
          </span>
        </div>
      </section>

      <section class="panel">
        <h2>Their cupboard</h2>
        <p class="card-stat">
          {#if host.hasStock}
            <span class="row-note">They've said what they have in.</span>
          {:else}
            <span class="row-note"
              >They haven't opened it yet — the menu falls back to the house six.</span
            >
          {/if}
        </p>
        <!-- The "do the chore for them" case. Same component the host uses on their
             own screen — one set of rules about what counts as pourable, not two. -->
        <button class="btn" type="button" onclick={() => (sheet = 'cupboard')}>
          {host.hasStock ? 'Look at it' : 'Fill it in for them'}
        </button>
      </section>

      <section class="panel">
        <h2>Their parties</h2>
        {#each partiesFor(host) as party (party.id)}
          {@render partyRow(party, 'host')}
        {:else}
          <p class="empty">No parties yet.</p>
        {/each}
      </section>

      <section class="panel">
        <h2>New party for {host.name}</h2>
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
          <button class="btn btn-go" type="submit" disabled={!!busy || !newPartyName.trim()}>
            Create it
          </button>
        </form>
      </section>

      <section class="panel">
        <h2>The account</h2>
        {#if host.banReason}<p>Suspended: {host.banReason}</p>{/if}
        <div class="row-acts">
          {#if host.bannedAt}
            <button
              class="btn btn-go"
              type="button"
              disabled={!!busy}
              onclick={() => setBan(host, false)}
            >
              Reinstate
            </button>
          {:else}
            <button class="btn" type="button" disabled={!!busy} onclick={() => setBan(host, true)}>
              Suspend
            </button>
          {/if}
          {#if host.adminByConfig}
            <span class="row-note">Admin by configuration — edit ADMIN_EMAILS to change</span>
          {:else if host.role === 'admin'}
            <button
              class="btn"
              type="button"
              disabled={!!busy}
              onclick={() => setRole(host, 'host')}
            >
              Remove admin
            </button>
          {:else}
            <button
              class="btn"
              type="button"
              disabled={!!busy}
              onclick={() => setRole(host, 'admin')}
            >
              Make admin
            </button>
          {/if}
        </div>
        <div class="danger-zone">
          <p>Deleting {host.name} deletes their parties and every order in them.</p>
          <button
            class="btn btn-danger"
            type="button"
            disabled={!!busy}
            onclick={() => removeHost(host)}>Delete this account</button
          >
        </div>
      </section>

      <!-- ---- the two lists ---- -->
    {:else}
      <nav class="shelf-tabs" aria-label="Sections">
        <button
          type="button"
          class="bar-tab"
          aria-current={tab === 'parties'}
          onclick={() => (tab = 'parties')}
        >
          Parties <b>{parties.length}</b>
        </button>
        <button
          type="button"
          class="bar-tab"
          aria-current={tab === 'hosts'}
          onclick={() => (tab = 'hosts')}
        >
          Hosts <b>{hosts.length}</b>
        </button>
      </nav>

      {#if tab === 'parties'}
        {#each groups as group (group.key)}
          <section class="panel">
            <h2>{group.label}</h2>
            {#each group.list as party (party.id)}
              {@render partyRow(party, 'status')}
            {/each}
          </section>
        {:else}
          <section class="panel">
            <p class="empty">No parties yet. Make one below.</p>
          </section>
        {/each}

        <section class="panel">
          <h2>New party</h2>
          <form
            onsubmit={(e) => {
              e.preventDefault();
              void makeParty();
            }}
          >
            <label class="field">
              Whose is it
              <select bind:value={newPartyHost}>
                <option value="">Pick a host…</option>
                {#each hosts as host (host.id)}
                  <option value={host.id}>{host.name}</option>
                {/each}
              </select>
            </label>
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
              disabled={!!busy || !newPartyName.trim() || !newPartyHost}
            >
              Create it
            </button>
          </form>
        </section>
      {:else}
        <section class="panel">
          <label class="field">
            Search
            <input type="search" bind:value={filter} placeholder="Name or email…" />
          </label>

          {#each shownHosts as host (host.id)}
            <button class="row" type="button" onclick={() => showHost(host)}>
              <span class="row-main">
                <span class="row-name">{host.name}</span>
                <span class="row-note">
                  {host.email}
                  <!-- Effective role, not the column. Dan's own adminness comes from
                     ADMIN_EMAILS and is never written to `role`, so reading the
                     column alone showed the operator as an ordinary host. -->
                  {#if host.role === 'admin' || host.adminByConfig}· admin{/if}
                  {#if host.bannedAt}· suspended{/if}
                  {#if !host.hasStock}· no cupboard{/if}
                </span>
              </span>
              <span class="row-note">
                {host.parties}
                {host.parties === 1 ? 'party' : 'parties'}
              </span>
            </button>
          {:else}
            <p class="empty">
              {filter ? `Nobody matches “${filter}”.` : 'Nobody has registered yet.'}
            </p>
          {/each}
        </section>
      {/if}
    {/if}

    {#if error}<p class="says says-bad" role="alert">{error}</p>{/if}
    {#if notice}<p class="says says-good" role="status">{notice}</p>{/if}
  </main>
</div>

{#if sheet === 'cupboard' && openHost}
  <WorkSheet
    title="Their cupboard"
    subtitle={openHost.name}
    onclose={() => {
      sheet = null;
      void load();
    }}
  >
    <Cupboard
      userId={openHost.id}
      onsaved={() => (notice = `Saved ${openHost?.name}'s cupboard.`)}
    />
  </WorkSheet>
{/if}

{#if sheet === 'menu' && openParty}
  <WorkSheet
    title="What it leads with"
    subtitle={openParty.name}
    onclose={() => {
      sheet = null;
      if (openParty) void showParty(openParty);
    }}
  >
    <ShortList eventId={openParty.id} />
  </WorkSheet>
{/if}
