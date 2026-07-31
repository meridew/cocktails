import { config } from '$lib/server/config';

/**
 * Whether the Google button should exist at all.
 *
 * Asked on the server because the credentials are server-only and must stay that
 * way — and because a button that 404s is worse than no button. Better Auth
 * registers no Google routes when the provider isn't configured, so this flag and
 * the server's actual behaviour come from the same value.
 *
 * **On the layout rather than the front door**, because sign-in is no longer only
 * something that happens at `/`. The bar's gate raises the same sheet without
 * leaving the party — that is the whole point of it — and a deployment where
 * Google works on one screen and not the other would look like a bug on whichever
 * one you met second.
 */
export const load = (): { googleEnabled: boolean } => ({
  googleEnabled: Boolean(config.accounts.google.clientId && config.accounts.google.clientSecret),
});
