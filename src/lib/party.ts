/**
 * Which party this device is at.
 *
 * A guest arrives through `/e/<eventId>` — the link behind the host's QR code —
 * and that id then rides along on every order. Without it the server falls back to
 * "whichever event is live", which is right while there is exactly one party and
 * silently wrong the moment there are two.
 *
 * Stored rather than kept in the URL so a reload, a Home Screen launch, or wandering
 * off to the bar screen and back doesn't lose it. The id is not a secret: it travels
 * in a QR code on a kitchen table, and ordering at a party you were invited to is
 * the entire point.
 */
import { storage } from './storage';

const KEY = 'event_id';

/** The party this device joined, or null if it arrived at the app directly. */
export const currentEventId = (): string | null => storage.read(KEY);

/** Remember the party from an `/e/<id>` link. */
export const rememberEvent = (id: string): void => storage.write(KEY, id);

/** Forget it — "I'm not at that party any more". */
export const forgetEvent = (): void => storage.remove(KEY);
