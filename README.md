# 🍸 Cocktails

A party drinks-ordering app. Guests browse a menu, build a round and send it with
their name; whoever's running the bar works the queue on their phone. Self-hosted
on a Synology NAS, public over a Cloudflare Tunnel with no inbound ports.

**Live:** <https://cock.meridew.com>

## Running it

```bash
npm install
npm run dev
```

One dev server on `http://localhost:5173` serving the app _and_ `/api` — the
database is created on first boot and an admin account is seeded from the env.

|                        |                                                      |
| ---------------------- | ---------------------------------------------------- |
| `npm run dev`          | dev server, HMR                                      |
| `npm test`             | the suite (Vitest, jsdom)                            |
| `npm run check`        | svelte-check + typecheck                             |
| `npm run build`        | production build → `build/`                          |
| `npm run preview`      | build, then run the real production artifact locally |
| `npm run db:reset`     | empty the database                                   |
| `npm run db:seed busy` | a queue mid-service (`helper` for a pending request) |

`npm run preview` runs exactly what the container runs, so a bug that only shows up
in the built output can be caught without deploying.

## Configuration

Put what you need in `.env` (gitignored). All of it is optional — the app runs
without any, using dev defaults on localhost.

|                                          |                                                    |
| ---------------------------------------- | -------------------------------------------------- |
| `STAFF_PIN`                              | the 6-digit PIN that opens the bar                 |
| `STAFF_EMAIL` / `STAFF_PASSWORD`         | break-glass sign-in for the same admin account     |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push. Unset → push is inert                    |
| `DB_PATH`                                | SQLite file. Defaults to `./data/cocktails.sqlite` |

In production a _missing_ credential never falls back to a guessable one: the
password becomes random and the PIN door switches off entirely.

## Shape

One SvelteKit app. `src/routes` holds the pages and the `/api` endpoints;
`adapter-node` builds `build/index.js`, a single Node process serving both.

```
src/
├── routes/            / (menu) · /bar · api/**/+server.ts
├── lib/
│   ├── server/        db · auth · notify · push · ratelimit · guards
│   ├── components/    the UI
│   ├── stores/        client state (Svelte 5 runes)
│   └── shared/        types and rules both sides must agree on
├── hooks.server.ts    CORS · body cap · security headers · logging · boot seed
└── service-worker.ts  precache + Web Push
```

Two things to know before changing anything:

- **`src/lib/neo.css` is a verbatim copy of the original hand-made design.** It's in
  `.prettierignore` and must stay byte-identical — additions belong in `app.css`.
- **There are no database migrations.** The schema is declared in `db.ts`; changing
  it means editing that and running `npm run db:reset`. Add a forward-only runner
  before there's data worth keeping — see `docs/archive/SVELTEKIT-PLAN.md` §5.

## Deploying

Push to `main` or `modernise`. CI gates on a cloud runner, then a self-hosted runner
on the NAS assembles the image and restarts the container. The NAS deliberately
compiles nothing — it shares a 4-core box with two VMs and has under a gigabyte
free.

More detail, including how to operate the NAS: [`docs/handoff.md`](docs/handoff.md).
