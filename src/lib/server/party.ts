import { readSettings, type PartySettings } from '$lib/shared';

/** A party as the browser sees it — `$lib/api`'s `Party`, kept honest from here. */
export interface PartyOnWire {
  id: string;
  hostUserId: string;
  name: string;
  status: 'draft' | 'live' | 'done';
  startsAt: number | null;
  settings: PartySettings;
  createdAt: number;
}

/**
 * Shape a party row for the wire.
 *
 * The endpoints used to `json()` the row straight out, which worked for as long as
 * every column was already the shape the client wanted. `settings` isn't: on disk it
 * is a JSON *string*, or null for every party made before the column existed. Sending
 * the row raw put `"settings": null` on a payload whose declared type says
 * `PartySettings`, so the client's type was a lie the compiler couldn't see — and a
 * host page reading `party.settings.threeD` would have thrown on a real party.
 *
 * So the parse happens exactly once, here, on the way out. `readSettings` turns null,
 * a blob and a half-migrated value alike into all-on.
 */
export function onWire(row: {
  id: string;
  hostUserId: string;
  name: string;
  status: string;
  startsAt: number | null;
  settings: string | null;
  createdAt: number;
}): PartyOnWire {
  return {
    id: row.id,
    hostUserId: row.hostUserId,
    name: row.name,
    status: row.status as 'draft' | 'live' | 'done',
    startsAt: row.startsAt,
    settings: readSettings(row.settings),
    createdAt: row.createdAt,
  };
}
