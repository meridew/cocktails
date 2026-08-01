/**
 * What a host has turned on for their own party.
 *
 * ## Why one JSON column and not three booleans
 *
 * Every toggle as its own column is a migration per toggle, and these will not stop
 * at three — the sound cues are already queued behind them. The app already stores
 * structured, non-relational data this way: `orders.items` and
 * `subscriptions.subscription` are both JSON in a text column. This is that pattern,
 * not a new one.
 *
 * The trade is that SQL can't query inside it. Nothing wants to: no screen asks
 * "which parties have 3D on", and the settings are only ever read alongside the
 * party they belong to.
 *
 * ## Absence means yes
 *
 * `readSettings` merges whatever it finds over `ALL_ON`, so a null column, an empty
 * object, a key we haven't invented yet and a corrupt blob all land on "everything
 * is on". That is what makes this safe to ship to a database full of parties that
 * predate it: nobody's menu changes until they change it.
 *
 * The opposite default would have every existing party quietly lose three features
 * on deploy, which is the kind of migration you find out about from a guest.
 */

/** The extras a host can hide from their menu. Each key is a settings field. */
export interface PartySettings {
  /** 🤔 "Help me choose" — the guided walk at `/e/<id>/choose`. */
  chooser: boolean;
  /** 🎲 "Surprise" — puts a random pourable drink in the round. */
  surprise: boolean;
  /** 🧊 "See it in 3D" — the WebGL menu at `/e/<id>/3d`. */
  threeD: boolean;
}

/** The default, and the fallback for anything unreadable. See the note above. */
export const ALL_ON: PartySettings = { chooser: true, surprise: true, threeD: true };

/**
 * One description per toggle, so the host's switches and the guest's menu are
 * driven by the same list rather than by two hand-kept copies that drift.
 *
 * `note` is what the host is actually deciding about — the guest-facing effect,
 * in the words the guest would see it in.
 */
export const MENU_EXTRAS = [
  {
    key: 'chooser',
    emoji: '🤔',
    label: 'Help me choose',
    note: 'Asks a few questions and narrows the list down.',
  },
  {
    key: 'surprise',
    emoji: '🎲',
    label: 'Surprise',
    note: 'Drops a random drink straight into their round.',
  },
  {
    key: 'threeD',
    emoji: '🧊',
    label: 'See it in 3D',
    note: 'The spinning bottle menu. Heavy on older phones.',
  },
] as const satisfies ReadonlyArray<{
  key: keyof PartySettings;
  emoji: string;
  label: string;
  note: string;
}>;

/**
 * Turn whatever is in the column into settings.
 *
 * Deliberately total: it takes `unknown` and cannot throw. The column is written by
 * `writeSettings` below and by nothing else, but a hand-edited database, a
 * half-finished migration or a future key removal must not be able to 500 a menu
 * that a room full of people are reading.
 */
export function readSettings(raw: unknown): PartySettings {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...ALL_ON };
    }
  }
  if (!parsed || typeof parsed !== 'object') return { ...ALL_ON };
  const got = parsed as Record<string, unknown>;
  const out = { ...ALL_ON };
  for (const k of Object.keys(ALL_ON) as (keyof PartySettings)[]) {
    if (typeof got[k] === 'boolean') out[k] = got[k];
  }
  return out;
}

/** The inverse, and the only thing that writes the column. Keys we know, nothing else. */
export function writeSettings(s: PartySettings): string {
  return JSON.stringify(readSettings(s));
}
