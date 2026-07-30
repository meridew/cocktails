/**
 * Client-rendered, not prerendered.
 *
 * There is nothing to server-render: every page is driven by device-local state
 * (the basket, the session token, favourites) and the app has to work offline as an
 * installed PWA. SSR would render a shell that the client immediately replaces, and
 * prerendering would bake in a queue that is stale the moment it's written.
 */
export const ssr = false;
export const prerender = false;
