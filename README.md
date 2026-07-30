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
  before there's data worth keeping.

## Testing platform states you don't have

Notification permission is one-shot: once a browser profile has denied it, the
opt-in flow can never render there again. And "what does an iPhone that hasn't
installed the app see?" normally means finding an iPhone. Dev-only query params
fake both — they are read **only** under `import.meta.env.DEV`, so they are dead
code in a production build (asserted by `tests/devOverrides.test.ts`):

|                                        |                                        |
| -------------------------------------- | -------------------------------------- |
| `?permission=default\|granted\|denied` | what `Notification.permission` reports |
| `?platform=ios\|android\|desktop`      | what the UA sniffing concludes         |
| `?installed=1\|0`                      | standalone app vs browser tab          |
| `?push=unsupported\|supported`         | whether the Push API exists            |
| `?reset-overrides`                     | back to reality                        |

They stick in `sessionStorage`, so the URL can go back to being clean. An iPhone
that hasn't added the app to its Home Screen:

```
http://localhost:5173/?permission=default&platform=ios&installed=0&push=unsupported
```

`npm run dev:lan` serves on the network so a phone can reach it — good for layout
and flows, but **not** PWA install or push: those need a secure context, and a LAN
IP over plain HTTP isn't one.

## Deploying

Pushing gates but does **not** deploy — CI typechecks, tests and builds on a cloud
runner, and stops there. Deploy when you actually want it live:

```bash
gh workflow run "gate + deploy (NAS)" --ref main -f deploy=true
```

A self-hosted runner on the NAS then assembles the image and restarts the
container. It deliberately compiles nothing — it shares a 4-core box with two VMs
and has under a gigabyte free.

More detail, including how to operate the NAS: [`docs/handoff.md`](docs/handoff.md).
