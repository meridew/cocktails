<script lang="ts">
  import { page } from '$app/state';
  import { partyNotificationHealth } from '$lib/api';
  import type { NotificationDailyHealth, NotificationHealthSummary } from '$lib/shared';
  import { session } from '$lib/stores/session.svelte';
  import AppBar from '$lib/components/AppBar.svelte';
  import Gate from '$lib/components/Gate.svelte';

  let summary = $state<NotificationHealthSummary | null>(null);
  let daily = $state<NotificationDailyHealth[]>([]);
  let error = $state('');
  let started = false;
  const up = $derived({ href: '/notification-health', label: 'Notification health' });
  const maxTargets = $derived(Math.max(1, ...daily.map((row) => row.totals.targeted)));
  const percent = (part: number, whole: number): string =>
    whole ? `${Math.round((part / whole) * 100)}%` : '—';
  const duration = (ms: number | null): string =>
    ms === null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

  $effect(() => {
    if (!session.actor.account || started) return;
    started = true;
    void partyNotificationHealth(page.params.eventId!)
      .then((result) => {
        summary = result.summary;
        daily = result.daily;
      })
      .catch((cause) => (error = (cause as Error).message));
  });
</script>

<svelte:head
  ><title>{summary?.eventName ?? 'Notification health'} · COCKTAILS!!!</title></svelte:head
>

<div class="workshell detail-shell">
  <AppBar {up} title={summary?.eventName ?? 'Notification health'} />
  <main class="deck dashboard-deck">
    <Gate what="party notification health">
      {#if error}<p class="says says-bad" role="alert">{error}</p>{/if}
      {#if summary}
        <section class="dashboard-metrics" aria-label="Party notification totals">
          <div><b>{summary.totals.targeted}</b><span>Targets</span></div>
          <div>
            <b>{percent(summary.totals.accepted, summary.totals.targeted)}</b><span
              >Provider accepted</span
            >
          </div>
          <div>
            <b>{percent(summary.totals.displayed, summary.totals.accepted)}</b><span
              >Display receipts</span
            >
          </div>
          <div><b>{summary.totals.retries}</b><span>Retries</span></div>
        </section>

        <section class="latency-band" aria-label="Notification latency">
          <div>
            <span>Average provider acceptance</span><b
              >{duration(summary.totals.averageAcceptanceMs)}</b
            >
          </div>
          <div>
            <span>Average device receipt</span><b>{duration(summary.totals.averageReceiptMs)}</b>
          </div>
          <div><span>Permanent failures</span><b>{summary.totals.permanentFailures}</b></div>
          <div><span>No active target</span><b>{summary.totals.noTargets}</b></div>
        </section>

        <section class="activity" aria-labelledby="activity-title">
          <h2 id="activity-title">Delivery activity</h2>
          {#each daily as row (`${row.day}-${row.platform}-${row.kind}`)}
            <div class="activity-row">
              <span
                ><b>{row.kind.replaceAll('-', ' ')}</b><small>{row.day} · {row.platform}</small
                ></span
              >
              <div class="bar" aria-label={`${row.totals.targeted} targets`}>
                <i style:width={`${(row.totals.targeted / maxTargets) * 100}%`}></i>
              </div>
              <span>{row.totals.targeted}</span>
              <span>{percent(row.totals.accepted, row.totals.targeted)} accepted</span>
              <span>{percent(row.totals.displayed, row.totals.accepted)} displayed</span>
            </div>
          {:else}
            <p class="empty">No notifications have targeted this party yet.</p>
          {/each}
        </section>
        <p class="health-note">
          A missing receipt remains unknown. This view never treats provider acceptance as proof
          that a person saw an alert.
        </p>
      {:else if !error}
        <p class="empty">One moment…</p>
      {/if}
    </Gate>
  </main>
</div>

<style>
  .detail-shell {
    min-height: 100dvh;
    background: var(--bg);
  }
  .latency-band {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-block: 2px solid var(--line);
    margin: 1rem 0;
  }
  .latency-band > div {
    display: grid;
    gap: 0.35rem;
    padding: 0.8rem;
    border-right: 1px solid var(--line);
  }
  .latency-band > div:last-child {
    border-right: 0;
  }
  .latency-band span {
    font-size: 0.75rem;
  }
  .activity h2 {
    font-size: 1.2rem;
  }
  .activity-row {
    display: grid;
    grid-template-columns: minmax(11rem, 1.4fr) minmax(8rem, 2fr) 3rem minmax(7rem, 0.8fr) minmax(
        7rem,
        0.8fr
      );
    gap: 0.75rem;
    align-items: center;
    min-height: 3.4rem;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 22%, transparent);
    font-size: 0.82rem;
  }
  .activity-row > span:first-child {
    display: grid;
    text-transform: capitalize;
  }
  .activity-row small {
    opacity: 0.68;
    text-transform: none;
  }
  .bar {
    height: 0.65rem;
    background: color-mix(in srgb, var(--line) 14%, transparent);
  }
  .bar i {
    display: block;
    height: 100%;
    min-width: 2px;
    background: var(--accent);
  }
  .health-note {
    max-width: 58rem;
    font-size: 0.84rem;
    opacity: 0.78;
  }
  @media (max-width: 700px) {
    .latency-band {
      grid-template-columns: 1fr 1fr;
    }
    .latency-band > div:nth-child(2) {
      border-right: 0;
    }
    .activity-row {
      grid-template-columns: 1fr auto;
      padding: 0.65rem 0;
    }
    .activity-row .bar {
      grid-column: 1 / -1;
    }
  }
</style>
