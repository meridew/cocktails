<script lang="ts">
  /**
   * Every host, searchable. Was `/admin` with `tab = 'hosts'` — a state nothing but
   * this component knew about, so it could not be linked to and Back could not
   * return to it.
   */
  import { listHosts, myParties, type Host } from '$lib/api';
  import { platform } from '$lib/shared';
  import { session } from '$lib/stores/session.svelte';
  import AppBar from '$lib/components/AppBar.svelte';
  import Gate from '$lib/components/Gate.svelte';

  let hosts = $state<Host[]>([]);
  let partyCount = $state(0);
  let loading = $state(true);
  let filter = $state('');

  const shown = $derived(
    filter.trim()
      ? hosts.filter((h) =>
          `${h.name} ${h.email}`.toLowerCase().includes(filter.trim().toLowerCase()),
        )
      : hosts,
  );

  let started = false;
  $effect(() => {
    if (session.actor.account?.role !== 'admin' || started) return;
    started = true;
    void (async () => {
      const [h, p] = await Promise.all([
        listHosts().catch(() => null),
        myParties().catch(() => null),
      ]);
      hosts = h?.hosts ?? [];
      partyCount = p?.events.length ?? 0;
      loading = false;
    })();
  });
</script>

<svelte:head><title>Hosts · COCKTAILS!!!</title></svelte:head>

<div class="workshell">
  <AppBar up={{ href: '/admin', label: 'Parties' }} title="Hosts" />

  <main class="deck">
    <Gate capability="host:list" scope={platform()} what="The admin desk">
      <nav class="shelf-tabs" aria-label="Sections">
        <a class="bar-tab" href="/admin">Parties <b>{partyCount}</b></a>
        <a class="bar-tab" aria-current="true" href="/admin/hosts">Hosts <b>{hosts.length}</b></a>
      </nav>

      {#if loading}
        <p class="empty">One moment…</p>
      {:else}
        <section class="panel">
          <label class="field">
            Search
            <input type="search" bind:value={filter} placeholder="Name or email…" />
          </label>

          {#each shown as host (host.id)}
            <a class="row row-link" href="/admin/h/{host.id}">
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
            </a>
          {:else}
            <p class="empty">
              {filter ? `Nobody matches “${filter}”.` : 'Nobody has registered yet.'}
            </p>
          {/each}
        </section>
      {/if}
    </Gate>
  </main>
</div>
