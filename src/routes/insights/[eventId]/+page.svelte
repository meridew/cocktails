<script lang="ts">
  import { page } from '$app/state';
  import { partyAnalytics, Unauthorized } from '$lib/api';
  import type { AttendeeAnalytics, PartyAnalytics } from '$lib/shared';
  import { session } from '$lib/stores/session.svelte';
  import AppBar from '$lib/components/AppBar.svelte';
  import Gate from '$lib/components/Gate.svelte';

  type Mode = 'ordered' | 'served';
  type Sort = 'units' | 'drinks' | 'name' | 'last';
  const eventId = $derived(page.params.eventId!);
  let analytics = $state<PartyAnalytics | null>(null);
  let mode = $state<Mode>('served');
  let sort = $state<Sort>('units');
  let openKey = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');
  let started = false;

  const isAdmin = $derived(session.actor.account?.role === 'admin');
  const historyUp = $derived({ href: '/insights', label: 'Party insights' });
  const people = $derived.by(() => {
    if (!analytics) return [];
    return [...analytics.attendees].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'last') return b.lastOrderAt - a.lastOrderAt;
      const aValue =
        sort === 'drinks'
          ? mode === 'served'
            ? a.servedDrinks
            : a.orderedDrinks
          : mode === 'served'
            ? a.estimatedUnitsServed
            : a.estimatedUnitsOrdered;
      const bValue =
        sort === 'drinks'
          ? mode === 'served'
            ? b.servedDrinks
            : b.orderedDrinks
          : mode === 'served'
            ? b.estimatedUnitsServed
            : b.estimatedUnitsOrdered;
      return bValue - aValue || a.name.localeCompare(b.name);
    });
  });
  const maxHourly = $derived(Math.max(1, ...(analytics?.hourly.map((hour) => hour.drinks) ?? [1])));

  const number = (value: number): string =>
    value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const time = (ms: number): string =>
    new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  function drinks(person: AttendeeAnalytics): number {
    return mode === 'served' ? person.servedDrinks : person.orderedDrinks;
  }
  function units(person: AttendeeAnalytics): number {
    return mode === 'served' ? person.estimatedUnitsServed : person.estimatedUnitsOrdered;
  }

  $effect(() => {
    const account = session.actor.account;
    if (!account || started) return;
    started = true;
    void partyAnalytics(eventId)
      .then((response) => (analytics = response.analytics))
      .catch((cause) => {
        error =
          cause instanceof Unauthorized
            ? 'This party is not available to this account.'
            : (cause as Error).message;
      })
      .finally(() => (loading = false));
  });
</script>

<svelte:head><title>{analytics?.party.name ?? 'Party'} insights · COCKTAILS!!!</title></svelte:head>

<div class="workshell insights-shell">
  <AppBar up={historyUp} title={analytics?.party.name ?? 'Party insights'} />
  <main class="deck dashboard-deck">
    <Gate what="party insights">
      {#if loading}
        <p class="empty">One moment…</p>
      {:else if error || !analytics}
        <p class="says says-bad" role="status">{error || 'No analytics found.'}</p>
      {:else}
        <section class="dashboard-metrics" aria-label="Party totals">
          <div><b>{analytics.totals.attendeeCount}</b><span>Attendees</span></div>
          <div><b>{analytics.totals.orderedDrinks}</b><span>Drinks ordered</span></div>
          <div><b>{analytics.totals.servedDrinks}</b><span>Drinks served</span></div>
          <div>
            <b>{number(analytics.totals.estimatedUnitsServed)}</b><span>Est. units served</span>
          </div>
        </section>

        <section class="panel guest-panel">
          <div class="section-line">
            <div>
              <h2>Guest totals</h2>
              <p class="row-note">Estimated from recorded house pours and bottle strengths.</p>
            </div>
            <div class="controls">
              <div class="dashboard-segments" aria-label="Order or served totals">
                <button
                  class:active={mode === 'ordered'}
                  type="button"
                  onclick={() => (mode = 'ordered')}>Ordered</button
                >
                <button
                  class:active={mode === 'served'}
                  type="button"
                  onclick={() => (mode = 'served')}>Served</button
                >
              </div>
              <label>
                <span class="sr-only">Sort guest totals</span>
                <select class="dashboard-select" bind:value={sort}>
                  <option value="units">Est. units</option>
                  <option value="drinks">Drinks</option>
                  <option value="name">Name</option>
                  <option value="last">Last order</option>
                </select>
              </label>
            </div>
          </div>

          {#if analytics.coverage.percent < 100 || analytics.coverage.hasReconstructed}
            <p class="coverage">
              {number(analytics.coverage.percent)}% unit coverage
              {analytics.coverage.hasReconstructed ? ' · includes reconstructed estimates' : ''}
            </p>
          {/if}

          <div class="guest-table" role="table" aria-label="Guest totals">
            <div class="guest-head" role="row">
              <span role="columnheader">Guest</span><span role="columnheader">Drinks</span><span
                role="columnheader">Est. units</span
              ><span role="columnheader">Last</span><span></span>
            </div>
            {#each people as person, index (person.attendeeKey)}
              <div class="guest-row-wrap">
                <div class="guest-row" role="row">
                  <span class="guest-name" role="cell"
                    ><small>{index + 1}</small><b>{person.name}</b
                    >{#if person.identityBasis === 'name-only'}<em>name only</em>{/if}</span
                  >
                  <span role="cell"><strong>{drinks(person)}</strong></span>
                  <span role="cell"><strong>{number(units(person))}</strong></span>
                  <span role="cell">{time(person.lastOrderAt)}</span>
                  <button
                    class="icon-btn"
                    type="button"
                    aria-label="{openKey === person.attendeeKey
                      ? 'Hide'
                      : 'Show'} drink breakdown for {person.name}"
                    aria-expanded={openKey === person.attendeeKey}
                    onclick={() =>
                      (openKey = openKey === person.attendeeKey ? null : person.attendeeKey)}
                    >{openKey === person.attendeeKey ? '−' : '+'}</button
                  >
                </div>
                {#if openKey === person.attendeeKey}
                  <div class="drink-breakdown">
                    {#each person.drinks as drink (drink.name)}
                      <div>
                        <span
                          ><b>{drink.name}</b><small
                            >{drink.base} · {drink.basis.replaceAll('-', ' ')}</small
                          ></span
                        ><span
                          >{mode === 'served' ? drink.servedDrinks : drink.orderedDrinks} drinks · {number(
                            mode === 'served'
                              ? drink.estimatedUnitsServed
                              : drink.estimatedUnitsOrdered,
                          )} units</span
                        >
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {:else}
              <p class="empty">No orders have been placed at this party.</p>
            {/each}
          </div>
        </section>

        <div class="detail-grid">
          <section class="panel">
            <h2>Popular drinks</h2>
            {#each analytics.popularDrinks.slice(0, 8) as drink (drink.name)}
              <div class="detail-row">
                <span><b>{drink.name}</b><small>{drink.base}</small></span><strong
                  >{drink.orderedDrinks}</strong
                >
              </div>
            {:else}<p class="empty">Nothing ordered yet.</p>{/each}
          </section>
          <section class="panel">
            <h2>Base breakdown</h2>
            {#each analytics.bases.slice(0, 8) as base (base.name)}
              <div class="detail-row">
                <span><b>{base.name}</b><small>Ordered / served</small></span>
                <strong>{base.orderedDrinks} / {base.servedDrinks}</strong>
              </div>
            {:else}<p class="empty">Nothing ordered yet.</p>{/each}
          </section>
          <section class="panel">
            <h2>Ordering by hour</h2>
            <div class="hours">
              {#each analytics.hourly as hour (hour.start)}
                <div>
                  <span>{time(hour.start)}</span><i
                    style:width={`${(hour.drinks / maxHourly) * 100}%`}
                  ></i><b>{hour.drinks}</b>
                </div>
              {:else}<p class="empty">Nothing ordered yet.</p>{/each}
            </div>
          </section>
        </div>

        <p class="estimate-note">
          These are service estimates, not a measure of consumption or intoxication.
        </p>
      {/if}
    </Gate>
  </main>
</div>

<style>
  .insights-shell {
    background: var(--bg);
    min-height: 100dvh;
  }
  .section-line {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: end;
    margin-bottom: 12px;
  }
  .section-line h2,
  .section-line p {
    margin: 0;
  }
  .controls {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .coverage {
    background: #fff;
    border-left: 6px solid #ff4f87;
    padding: 8px 10px;
    font-weight: 800;
  }
  .guest-table {
    display: grid;
  }
  .guest-head,
  .guest-row {
    display: grid;
    grid-template-columns: minmax(160px, 2fr) repeat(3, minmax(64px, 0.6fr)) 42px;
    gap: 10px;
    align-items: center;
  }
  .guest-head {
    border-bottom: 3px solid var(--line);
    padding: 6px;
    font-size: 0.75rem;
    font-weight: 900;
    text-transform: uppercase;
  }
  .guest-row {
    padding: 9px 6px;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 35%, transparent);
  }
  .guest-name {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  }
  .guest-name small {
    min-width: 22px;
    font-weight: 900;
    color: var(--text-soft);
  }
  .guest-name b {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .guest-name em {
    font-size: 0.65rem;
    font-style: normal;
    text-transform: uppercase;
  }
  .icon-btn {
    width: 36px;
    height: 36px;
    border: 3px solid var(--line);
    background: #fff;
    font: 900 1.2rem/1 sans-serif;
  }
  .drink-breakdown {
    margin: 0 6px 8px 36px;
    border-left: 3px solid var(--line);
    padding-left: 12px;
  }
  .drink-breakdown div,
  .detail-row {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    padding: 7px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 25%, transparent);
  }
  .drink-breakdown span:first-child,
  .detail-row span {
    display: grid;
  }
  .drink-breakdown small,
  .detail-row small {
    color: var(--text-soft);
  }
  .detail-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }
  .hours {
    display: grid;
    gap: 8px;
  }
  .hours div {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) 28px;
    gap: 8px;
    align-items: center;
  }
  .hours i {
    display: block;
    min-width: 3px;
    height: 13px;
    background: #ff4f87;
    border: 1px solid var(--line);
  }
  .estimate-note {
    font-size: 0.8rem;
    font-weight: 700;
    text-align: center;
  }
  @media (max-width: 700px) {
    .section-line {
      align-items: stretch;
      flex-direction: column;
    }
    .controls {
      justify-content: space-between;
    }
    .guest-head {
      display: none;
    }
    .guest-row {
      grid-template-columns: minmax(0, 1fr) auto auto 36px;
    }
    .guest-row > span:nth-child(4) {
      display: none;
    }
    .guest-row > span:nth-child(2)::after {
      content: ' drinks';
      font-size: 0.65rem;
    }
    .guest-row > span:nth-child(3)::after {
      content: ' units';
      font-size: 0.65rem;
    }
    .drink-breakdown {
      margin-left: 6px;
    }
    .drink-breakdown div {
      align-items: start;
      flex-direction: column;
      gap: 3px;
    }
    .detail-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
