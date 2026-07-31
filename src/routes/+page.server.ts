import { config } from '$lib/server/config';

/**
 * Whether the Google button should exist at all.
 *
 * Asked on the server because the credentials are server-only and must stay that
 * way — and because a button that 404s is worse than no button. Better Auth
 * registers no Google routes when the provider isn't configured, so this flag and
 * the server's actual behaviour come from the same value.
 */
export const load = (): { googleEnabled: boolean } => ({
  googleEnabled: Boolean(config.accounts.google.clientId && config.accounts.google.clientSecret),
});
