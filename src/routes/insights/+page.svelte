<script lang="ts">
  import { page } from '$app/state';
  import { analyticsHistory, listHosts, type Host } from '$lib/api';
  import type { PartyAnalyticsSummary } from '$lib/shared';
  import { session } from '$lib/stores/session.svelte';
  import AppBar from '$lib/components/AppBar.svelte';
  import Gate from '$lib/components/Gate.svelte';

  let parties = $state<PartyAnalyticsSummary[]>([]);
  let hosts = $state<Host[]>([]);
  let hostId = $state(page.url.searchParams.get('hostId') ?? '');
  let status = $state<'all' | 'draft' | 'live' | 'done'>('all');
  let loading = $state(true);
  let error = $state('');
  let started = false;

  const isAdmin = $derived(session.actor.account?.role === 'admin');
  const up = $derived(
    isAdmin ? { href: '/admin', label: 'Admin' } : { href: '/host', label: 'Your bar' },
  );
  const visible = $derived(
    parties.filter((party) => status === 'all' || party.party.status === status),
  );
  const groups = $derived.by(() => {
    const grouped = new Map<
      string,
      { hostId: string; hostName: string; parties: PartyAnalyticsSummary[] }
    >();
    for (const party of visible) {
      const key = party.party.hostUserId;
      const group = grouped.get(key) ?? {
        hostId: key,
        hostName: party.party.hostName,
        parties: [],
      };
      group.parties.push(party);
      grouped.set(key, group);
    }
    return [...grouped.values()].sort((a, b) => a.hostName.localeCompare(b.hostName));
  });
  const totals = $derived(
    visible.reduce(
      (sum, party) => ({
        parties: sum.parties + 1,
        attendees: sum.attendees + party.totals.attendeeCount,
        drinks: sum.drinks + party.totals.servedDrinks,
        units: sum.units + party.totals.estimatedUnitsServed,
      }),
      { parties: 0, attendees: 0, drinks: 0, units: 0 },
    ),
  );

  const when = (ms: number | null): string =>
    ms
      ? new Date(ms).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : 'Not dated';

  const number = (value: number): string =>
    value.toLocaleString(undefined, { maximumFractionDigits: 1 });

  async function load(selectedHost = hostId): Promise<void> {
    loading = true;
    error = '';
    try {
      parties = (await analyticsHistory(selectedHost || undefined)).parties;
    } catch (cause) {
      error = (cause as Error).message || "Couldn't load party history";
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const account = session.actor.account;
    if (!account || started) return;
    started = true;
    void (async () => {
      if (account.role === 'admin') hosts = (await listHosts()).hosts;
      await load();
    })();
  });
</script>

<svelte:head><title>Insights · COCKTAILS!!!</title></svelte:head>

<div class="workshell insights-shell">
  <AppBar {up} title="Party insights" />
  <main class="deck dashboard-deck">
    <Gate what="party insights">
      <section class="insights-tools" aria-label="History filters">
        {#if isAdmin}
          <label>
            <span>Host</span>
            <select
              class="dashboard-select"
              value={hostId}
              onchange={(event) => {
                hostId = event.currentTarget.value;
                void load(hostId);
              }}
            >
              <option value="">All hosts</option>
              {#each hosts as host (host.id)}<option value={host.id}>{host.name}</option>{/each}
            </select>
          </label>
        {/if}
        <label>
          <span>Status</span>
          <select class="dashboard-select" bind:value={status}>
            <option value="all">All parties</option>
            <option value="draft">Draft</option>
            <option value="live">Live</option>
            <option value="done">Finished</option>
          </select>
        </label>
      </section>

      <section class="dashboard-metrics" aria-label="Party history totals">
        <div><b>{totals.parties}</b><span>Parties</span></div>
        <div><b>{totals.attendees}</b><span>Attendees</span></div>
        <div><b>{totals.drinks}</b><span>Drinks served</span></div>
        <div><b>{number(totals.units)}</b><span>Est. units served</span></div>
      </section>

      {#if loading}
        <p class="empty">One moment…</p>
      {:else if error}
        <p class="says says-bad" role="status">{error}</p>
      {:else}
        {#each groups as group (group.hostId)}
          <section class="panel history-panel">
            <h2>{isAdmin && !hostId ? group.hostName : 'Party history'}</h2>
            <div class="history-table" role="table" aria-label="Party history for {group.hostName}">
              <div class="history-head" role="row">
                <span role="columnheader">Party</span>
                <span role="columnheader">Attendees</span>
                <span role="columnheader">Served</span>
                <span role="columnheader">Est. units</span>
                <span role="columnheader">Coverage</span>
                <span aria-hidden="true"></span>
              </div>
              {#each group.parties as summary (summary.party.id)}
                <div class="history-row" role="row">
                  <span class="party-cell" role="cell">
                    <b>{summary.party.name}</b>
                    <small
                      >{when(summary.party.startsAt ?? summary.party.createdAt)} · {summary.party
                        .status}</small
                    >
                  </span>
                  <span role="cell">{summary.totals.attendeeCount}</span>
                  <span role="cell">{summary.totals.servedDrinks}</span>
                  <span role="cell">{number(summary.totals.estimatedUnitsServed)}</span>
                  <span role="cell">{number(summary.coverage.percent)}%</span>
                  <a class="btn" href="/insights/{summary.party.id}" role="cell">Open</a>
                </div>
              {/each}
            </div>
          </section>
        {:else}
          <section class="panel">
            <h2>Party history</h2>
            <p class="empty">No parties match this view.</p>
          </section>
        {/each}
      {/if}
    </Gate>
  </main>
</div>

<style>
  .insights-shell {
    background: var(--bg);
    min-height: 100dvh;
  }
  .insights-tools {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }
  .insights-tools label {
    display: grid;
    gap: 4px;
    min-width: min(220px, 100%);
    font-weight: 800;
  }
  .history-table {
    display: grid;
    gap: 0;
  }
  .history-head,
  .history-row {
    display: grid;
    grid-template-columns: minmax(180px, 2fr) repeat(4, minmax(74px, 0.65fr)) 80px;
    gap: 10px;
    align-items: center;
  }
  .history-head {
    padding: 6px 8px;
    border-bottom: 3px solid var(--line);
    font-size: 0.76rem;
    font-weight: 900;
    text-transform: uppercase;
  }
  .history-row {
    padding: 10px 8px;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 35%, transparent);
  }
  .party-cell {
    display: grid;
    min-width: 0;
  }
  .party-cell b,
  .party-cell small {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .party-cell small {
    color: var(--text-soft);
  }
  .history-row .btn {
    min-width: 0;
    padding-inline: 10px;
  }
  @media (max-width: 700px) {
    .history-head {
      display: none;
    }
    .history-row {
      grid-template-columns: minmax(0, 1fr) repeat(2, auto);
    }
    .history-row > span:nth-child(4),
    .history-row > span:nth-child(5) {
      display: none;
    }
    .history-row > span:nth-child(2)::before {
      content: 'People ';
      font-size: 0.7rem;
      font-weight: 900;
    }
    .history-row > span:nth-child(3)::before {
      content: 'Served ';
      font-size: 0.7rem;
      font-weight: 900;
    }
    .history-row .btn {
      grid-column: 1 / -1;
      justify-self: start;
    }
  }
</style>
