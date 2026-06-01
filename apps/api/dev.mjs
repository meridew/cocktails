// Dev runner: pin the API to its own port regardless of an inherited PORT.
// The Claude preview harness sets PORT to the *web* port when it runs the
// combined `npm run dev`, which would otherwise make the API bind the web's
// port and collide. Prod (`npm start`) is unaffected — it reads PORT straight
// from the container env. Override with API_PORT if 8787 is ever taken.
import { spawn } from 'node:child_process';

spawn(process.execPath, ['--env-file-if-exists=.env', '--watch', 'src/server.ts'], {
  stdio: 'inherit',
  // env wins over --env-file, so this PORT sticks even if .env sets one.
  env: { ...process.env, PORT: process.env.API_PORT ?? '8787' },
}).on('exit', (code) => process.exit(code ?? 0));
