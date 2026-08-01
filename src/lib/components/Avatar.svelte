<script lang="ts">
  /**
   * A guest's face in a circle, or their initials if they'd rather not.
   *
   * ## Why this fetches rather than taking a `src`
   *
   * The bar's credential is a **bearer token**, not a cookie — a helper has no
   * account to hang one on. An `<img src>` sends cookies and nothing else, so a
   * guarded image URL simply cannot be loaded by the browser's own image loader. The
   * alternatives were to make the endpoint public behind an unguessable URL, or to
   * fetch it properly and hand the bytes to the tag. These are photographs of
   * somebody's friends; the guard stays and we fetch.
   *
   * That is cheap because `photoId` is a **content hash**: one fetch per face, ever,
   * cached in a module-level map that outlives any single card. The queue re-polls
   * every four seconds and re-renders these constantly — without the cache that would
   * be a request per face per poll.
   *
   * ## The fallback is not a silhouette
   *
   * Initials on a colour picked from the name, deterministic like the glasses on the
   * front door. A generic head tells a bartender nothing; two letters and a colour
   * still tell Steve from Sarah at a glance, which is most of what the feature is for
   * even before anybody takes a picture.
   */
  import { guestPhoto } from '$lib/api';
  import { hueFor, initials } from '$lib/photo';

  let {
    name,
    eventId,
    photoId = null,
    size = 34,
  }: {
    name: string;
    eventId: string;
    /** Null when they never took one — the ordinary case. */
    photoId?: string | null;
    size?: number;
  } = $props();

  /**
   * Object URLs by content hash, shared across every card on the screen.
   *
   * Never revoked: a hash maps to one picture for the life of the page, the whole
   * point is not to fetch it twice, and a party's worth of 6KB avatars is smaller
   * than one of the photographs it came from.
   */
  const cache = new Map<string, Promise<string | null>>();

  function load(id: string): Promise<string | null> {
    const hit = cache.get(id);
    if (hit) return hit;
    const pending = guestPhoto(eventId, id).catch(() => null);
    cache.set(id, pending);
    return pending;
  }

  let src = $state<string | null>(null);

  $effect(() => {
    const id = photoId;
    if (!id) {
      src = null;
      return;
    }
    let live = true;
    void load(id).then((url) => {
      if (live) src = url;
    });
    return () => {
      live = false;
    };
  });
</script>

{#if src}
  <img
    class="avatar"
    style="--avatar-size: {size}px"
    {src}
    alt=""
    width={size}
    height={size}
    loading="lazy"
  />
{:else}
  <!-- `aria-hidden`, because the name is always rendered right beside this. A screen
       reader announcing "S T" before "Steve" is noise, not information. -->
  <span
    class="avatar avatar-initials"
    style="--avatar-size: {size}px; --avatar-hue: {hueFor(name)}"
    aria-hidden="true"
  >
    {initials(name)}
  </span>
{/if}
