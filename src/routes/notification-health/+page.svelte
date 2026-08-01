<script lang="ts">
  import { notificationHealth, listHosts, setNotificationDeliveryMode, type Host } from '$lib/api';
  import type { NotificationHealthSummary, NotificationMode } from '$lib/shared';
  import { session } from '$lib/stores/session.svelte';
  import AppBar from '$lib/components/AppBar.svelte';
  import Gate from '$lib/components/Gate.svelte';

  let parties = $state<NotificationHealthSummary[]>([]);
  let hosts = $state<Host[]>([]);
  let hostId = $state('');
  let mode = $state<NotificationMode>('shadow');
  let enabled = $state(true);
  let problem = $state<string | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let started = false;

  const isAdmin = $derived(session.actor.account?.role === 'admin');
  const up = $derived(
    isAdmin ? { href: '/admin', label: 'Admin' } : { href: '/host', label: 'Your bar' },
  );
  const totals = $derived(
    parties.reduce(
      (sum, party) => ({
        targeted: sum.targeted + party.totals.targeted,
        accepted: sum.accepted + party.totals.accepted,
        displayed: sum.displayed + party.totals.displayed,
        failed: sum.failed + party.totals.permanentFailures,
        queued: sum.queued + (party.oldestQueuedAt ? 1 : 0),
      }),
      { targeted: 0, accepted: 0, displayed: 0, failed: 0, queued: 0 },
    ),
  );

  const percent = (part: number, whole: number): string =>
    whole ? `${Math.round((part / whole) * 100)}%` : '—';
  const when = (value: number | null): string =>
    value
      ? new Date(value).toLocaleString(undefined, {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'None';

  async function load(selectedHost = hostId): Promise<void> {
    loading = true;
    error = '';
    try {
      const result = await notificationHealth(selectedHost || undefined);
      parties = result.parties;
      mode = result.mode;
      enabled = result.configuration?.enabled ?? true;
      problem = result.configuration?.problem ?? null;
    } catch (cause) {
      error = (cause as Error).message;
    } finally {
      loading = false;
    }
  }

  async function changeMode(next: NotificationMode): Promise<void> {
    if (!isAdmin || busy || next === mode) return;
    busy = true;
    error = '';
    try {
      mode = (await setNotificationDeliveryMode(next)).mode;
      parties = parties.map((party) => ({ ...party, mode }));
    } catch (cause) {
      error = (cause as Error).message;
    } finally {
      busy = false;
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

<svelte:head><title>Notification health · COCKTAILS!!!</title></svelte:head>

<div class="workshell health-shell">
  <AppBar {up} title="Notification health" />
  <main class="deck">
    <Gate what="notification health">
      <section class="health-tools" aria-label="Notification controls">
        {#if isAdmin}
          <label>
            <span>Host</span>
            <select
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
          <fieldset disabled={busy}>
            <legend>Delivery mode</legend>
            {#each ['shadow', 'live', 'paused'] as choice}
              <button
                type="button"
                aria-pressed={mode === choice}
                onclick={() => changeMode(choice as NotificationMode)}
                >{choice.charAt(0).toUpperCase() + choice.slice(1)}</button
              >
            {/each}
          </fieldset>
        {:else}
          <p><b>Delivery mode:</b> {mode}</p>
        {/if}
      </section>

      {#if !enabled || problem}<p class="says says-bad" role="alert">{problem}</p>{/if}
      {#if error}<p class="says says-bad" role="alert">{error}</p>{/if}

      <section class="metric-band" aria-label="Notification totals">
        <div><b>{totals.targeted}</b><span>Targets</span></div>
        <div><b>{percent(totals.accepted, totals.targeted)}</b><span>Provider accepted</span></div>
        <div><b>{percent(totals.displayed, totals.accepted)}</b><span>Display receipts</span></div>
        <div><b>{totals.queued}</b><span>Parties queued</span></div>
      </section>

      {#if loading}
        <p class="empty">One moment…</p>
      {:else}
        <section class="health-table" aria-labelledby="party-health-title">
          <h2 id="party-health-title">Party delivery</h2>
          <div class="health-head" aria-hidden="true">
            <span>Party</span><span>Targets</span><span>Accepted</span><span>Displayed</span><span
              >Failures</span
            ><span>Oldest queued</span><span></span>
          </div>
          {#each parties as party (party.eventId)}
            <div class="health-row">
              <span class="party-name"><b>{party.eventName}</b><small>{party.status}</small></span>
              <span>{party.totals.targeted}</span>
              <span>{percent(party.totals.accepted, party.totals.targeted)}</span>
              <span>{percent(party.totals.displayed, party.totals.accepted)}</span>
              <span>{party.totals.permanentFailures}</span>
              <span>{when(party.oldestQueuedAt)}</span>
              <a class="btn" href="/notification-health/{party.eventId}">Open</a>
            </div>
          {:else}
            <p class="empty">No party notification data yet.</p>
          {/each}
        </section>
      {/if}

      <p class="health-note">
        Provider acceptance means the push service accepted the message. Missing device receipts are
        unknown; they are not counted as delivery failures.
      </p>
    </Gate>
  </main>
</div>

<style>
  .health-shell {
    min-height: 100dvh;
    background: var(--bg);
  }
  .health-tools {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
  }
  .health-tools label {
    display: grid;
    gap: 0.35rem;
    font-weight: 700;
  }
  .health-tools select {
    min-height: 2.7rem;
    border: 2px solid var(--ink);
    background: white;
    padding: 0 0.65rem;
    font: inherit;
  }
  fieldset {
    display: flex;
    margin: 0;
    padding: 0;
    border: 2px solid var(--ink);
  }
  legend {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }
  fieldset button {
    min-height: 2.7rem;
    border: 0;
    border-right: 2px solid var(--ink);
    background: white;
    padding: 0 0.85rem;
    font: inherit;
    font-weight: 700;
  }
  fieldset button:last-child {
    border-right: 0;
  }
  fieldset button[aria-pressed='true'] {
    background: var(--yellow);
  }
  .health-table {
    margin-top: 1rem;
  }
  .health-table h2 {
    font-size: 1.2rem;
  }
  .health-head,
  .health-row {
    display: grid;
    grid-template-columns: minmax(11rem, 2fr) repeat(4, minmax(5rem, 0.7fr)) minmax(8rem, 1fr) auto;
    gap: 0.65rem;
    align-items: center;
    padding: 0.7rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 22%, transparent);
  }
  .health-head {
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
  }
  .party-name {
    display: grid;
  }
  .party-name small {
    opacity: 0.7;
  }
  .health-note {
    max-width: 58rem;
    font-size: 0.84rem;
    opacity: 0.78;
  }
  @media (max-width: 780px) {
    .health-head {
      display: none;
    }
    .health-row {
      grid-template-columns: 1fr auto;
      gap: 0.35rem 1rem;
    }
    .health-row > span:not(.party-name)::before {
      content: attr(data-label);
    }
    .health-row .btn {
      grid-column: 1 / -1;
      text-align: center;
    }
  }
</style>
