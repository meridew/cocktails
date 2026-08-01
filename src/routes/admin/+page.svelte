<script lang="ts">
  /**
   * Dan's desk: the parties, grouped by what they are doing tonight.
   *
   * ## The hierarchy is in the URL now
   *
   * This screen used to be one route holding four levels of state — `tab`,
   * `openParty`, `openHost`, `sheet` — none of which the address bar knew about. Two
   * levels deep into a party the URL still read `/admin`, so **Back did not go up a
   * level: it left the desk entirely.** Opening a party and pressing back landed on
   * `/bar`. On a phone installed to a Home Screen, where the gesture is *the* back
   * affordance, that is the whole navigation model broken.
   *
   * So: `/admin` is the parties, `/admin/hosts` is the hosts, `/admin/p/<id>` is one
   * party and `/admin/h/<id>` is one host. Back works because there is something to
   * go back to, a party can be linked to, and a reload keeps your place.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    createParty,
    listHosts,
    myParties,
    openBar,
    updateParty,
    type Host,
    type Party,
  } from '$lib/api';
  import { platform } from '$lib/shared';
  import { adoptApprovedSession, session } from '$lib/stores/session.svelte';
  import { rememberEvent } from '$lib/party';
  import AppBar from '$lib/components/AppBar.svelte';
  import Gate from '$lib/components/Gate.svelte';
  import PartyRow from '$lib/components/PartyRow.svelte';

  let hosts = $state<Host[]>([]);
  let parties = $state<Party[]>([]);
  let loading = $state(true);
  let busy = $state('');
  let error = $state('');
  let notice = $state('');

  let newPartyHost = $state('');
  let newPartyName = $state('');
  let newPartyDate = $state('');

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

  let started = false;
  $effect(() => {
    if (session.actor.account?.role !== 'admin' || started) return;
    started = true;
    void (async () => {
      try {
        const [h, p] = await Promise.all([listHosts(), myParties()]);
        hosts = h.hosts;
        parties = p.events;
      } catch (e) {
        error = (e as Error).message;
      }
      loading = false;
    })();
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

  const makeParty = () =>
    act('new-party', async () => {
      if (!newPartyHost) {
        error = 'Pick whose party it is.';
        return;
      }
      const when = newPartyDate ? new Date(newPartyDate).getTime() : null;
      const { event } = await createParty(newPartyHost, newPartyName.trim(), when);
      parties = [event, ...parties];
      newPartyName = '';
      newPartyDate = '';
      notice = `${event.name} created for ${hosts.find((h) => h.id === newPartyHost)?.name ?? 'them'}.`;
    });

  const open = (party: Party) =>
    act(`status-${party.id}`, async () => {
      const { event } = await updateParty(party.id, { status: 'live' });
      parties = parties.map((p) => (p.id === event.id ? event : p));
      notice = `${event.name} is open.`;
    });

  /**
   * Take a bar session and go.
   *
   * Admin already passes every party capability on the account cookie alone, so this
   * is not permission — it is a token for a phone that will be behind a bar all
   * night.
   */
  const work = (party: Party) =>
    act(`bar-${party.id}`, async () => {
      const { token, staff } = await openBar(party.id);
      adoptApprovedSession(token, staff);
      rememberEvent(party.id);
      await goto(`/bar/${party.id}`);
    });

  onMount(() => {
    /* the gate asks who we are; the effect above loads once it knows */
  });
</script>

<svelte:head><title>Admin · COCKTAILS!!!</title></svelte:head>

<div class="workshell">
  <AppBar up={{ href: '/', label: "What's on" }} title="🍸 Admin" />

  <main class="deck">
    <Gate capability="party:create" scope={platform()} what="The admin desk">
      <!-- Tabs are links now, so which list you are on is in the address and Back
           moves between them. -->
      <nav class="shelf-tabs" aria-label="Sections">
        <a class="bar-tab" aria-current="true" href="/admin">Parties <b>{parties.length}</b></a>
        <a class="bar-tab" href="/admin/hosts">Hosts <b>{hosts.length}</b></a>
        <a class="bar-tab" href="/insights">Insights</a>
        <a class="bar-tab" href="/notification-health">Notifications</a>
      </nav>

      {#if loading}
        <p class="empty">One moment…</p>
      {:else}
        {#each groups as group (group.key)}
          <section class="panel">
            <h2>{group.label}</h2>
            {#each group.list as party (party.id)}
              <PartyRow
                {party}
                by="status"
                host={hostFor(party)}
                busy={Boolean(busy)}
                onwork={work}
                onopen={open}
              />
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
              disabled={Boolean(busy) || !newPartyName.trim() || !newPartyHost}
            >
              Create it
            </button>
          </form>
        </section>
      {/if}

      {#if error}<p class="says says-bad" role="alert">{error}</p>{/if}
      {#if notice}<p class="says says-good" role="status">{notice}</p>{/if}
    </Gate>
  </main>
</div>
