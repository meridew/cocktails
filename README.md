# Cocktails

A party drinks-ordering app. A host records what is in their cupboard, the app
generates what can be poured, guests order anonymously, and Dan or a temporary
helper works the queue.

**Live:** <https://cock.meridew.com>

The four audiences are deliberately different:

| Person | What they do                                     |
| ------ | ------------------------------------------------ |
| Admin  | Manages hosts and parties, and can work any bar  |
| Host   | Maintains one cupboard and watches their parties |
| Staff  | Joins one party temporarily and pours orders     |
| Guest  | Opens a party link and orders without an account |

## Running it

Node 24 is required; Node 25 is deliberately excluded in `package.json`.

```bash
npm install
npm run dev
```

The development server at `http://localhost:5173` serves the pages and `/api` from
one SvelteKit application. The SQLite database is created and migrated on first use.

| Command                 | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `npm run dev`           | Development server with HMR                      |
| `npm run dev:lan`       | Development server reachable from another device |
| `npm run format:check`  | The first CI gate                                |
| `npm run check`         | Svelte and TypeScript diagnostics                |
| `npm test`              | Vitest suite                                     |
| `npm run build`         | Production build in `build/`                     |
| `npm run preview`       | Build and run the production artifact locally    |
| `npm run test:e2e`      | Build and run the Playwright journeys            |
| `npm run db:seed busy`  | Seed a queue (`helper` seeds a pending request)  |
| `npm run db:seed reset` | Reset local development data                     |

## Configuration

Local configuration may go in `.env` (gitignored). Production variables are loaded
by the Mac's launch script.

| Variable                                    | Purpose                                             |
| ------------------------------------------- | --------------------------------------------------- |
| `DB_PATH`                                   | SQLite file; defaults to `./data/cocktails.sqlite`  |
| `ORIGIN`                                    | Public origin used in account links                 |
| `BETTER_AUTH_SECRET`                        | Account-session signing secret                      |
| `ADMIN_EMAILS`                              | Comma-separated accounts that always remain admins  |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional Google sign-in                             |
| `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID`       | Microsoft Graph mail application                    |
| `GRAPH_KEY_FILE` / `GRAPH_SENDER`           | Graph certificate path and sender                   |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`    | Web Push credentials                                |
| `VAPID_SUBJECT`                             | Web Push contact URI                                |
| `PUSH_DATA_KEY`                             | Optional dedicated push-subscription encryption key |
| `ALLOWED_ORIGIN`                            | Optional comma-separated native-app CORS origins    |

Missing Graph configuration writes verification links to the server log instead of
sending them. Missing VAPID keys disables push. Production never falls back to a
fixed account-session secret. When `PUSH_DATA_KEY` is absent, sealed push subscriptions
use key material derived from `BETTER_AUTH_SECRET`; set it explicitly before rotating
the account secret if existing device registrations must remain readable.

## Shape

One SvelteKit app, built with `adapter-node` and run natively on the Mac mini:

```text
src/routes/          pages and /api endpoints
src/lib/components/ UI components
src/lib/stores/      client state, using Svelte 5 runes
src/lib/shared/      types, validation, recipes and permissions used both sides
src/lib/server/      Drizzle/SQLite, auth, email, push and guards
drizzle/             forward migrations applied at first query
tests/               Vitest behavior and contract tests
e2e/                 Playwright participant journeys
```

The permission model is account role plus party role plus an explicit scope. The UI
and server both use `src/lib/shared/permissions.ts`. Guests and temporary helpers do
not need accounts.

The service worker is push-only. It does not intercept requests or provide a stale,
nonfunctional offline shell.

## Guardrails

- `src/lib/neo.css` is a verbatim copy of the original design. Keep it byte-identical;
  additions belong in `src/lib/app.css`.
- Client code must never import `$lib/server/*`; the build enforces the boundary.
- A change is not done until format, typecheck, tests and build pass. Run Playwright
  when behavior crosses participants or navigation.
- Deploy only when explicitly requested. Pushes gate but do not deploy.

## Hosting

The production app runs as native Node under launchd on a Mac mini M4. Cloudflared
connects it to the public hostname without inbound ports, and a self-hosted Actions
runner performs the gate and manual deployment. There is no Docker or active NAS
deployment.

```bash
gh workflow run "gate + deploy (Mac)" --ref main -f deploy=true
```

Start operational work with
[`docs/HANDOFF-2026-08-01.md`](docs/HANDOFF-2026-08-01.md). Deliberately deferred
product decisions and credential-dependent work are in
[`docs/OUTSTANDING.md`](docs/OUTSTANDING.md).
