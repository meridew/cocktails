/**
 * Process bootstrap: seed the staff account, then listen. Kept separate from
 * `app.ts` so tests can import the routes without binding a port. This file
 * stays the deployment entrypoint (package.json `main`/`start`, dev.mjs, Dockerfile).
 */
import { serve } from '@hono/node-server';
import { config } from './config.ts';
import { seedStaff } from './auth.ts';
import { app } from './app.ts';

seedStaff();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`\u{1F378} cocktails API listening on http://localhost:${info.port}`);
});
