# 🌐 Cutover — public HTTPS via Cloudflare Tunnel

> Goal: serve the new stack at **https://cock.meridew.com** over HTTPS with **no inbound ports**
> (the NAS dials out). This unlocks Web Push and off-WiFi use, and is the gate for the native app.
> Architecture: **Cloudflare edge (TLS) → `cloudflared` (NAS container) → `caddy:80` → web + api.**

## Status
- ✅ Nameservers moved to Cloudflare (`*.ns.cloudflare.com`) — zone active.
- ✅ NAS side wired: `cloudflared` service in `infra/docker-compose.yml` (dormant behind the `tunnel`
  compose profile), CI writes `TUNNEL_TOKEN` and auto-enables the profile when the secret exists.
- ⏳ **Needs you:** create the tunnel in the Cloudflare dashboard, set its public hostname, and add the
  `TUNNEL_TOKEN` secret. Then a deploy brings it live.

## Your steps (≈5 min, one-time)

1. **Cloudflare dashboard → Zero Trust → Networks → Tunnels → _Create a tunnel_.**
   - Connector type: **Cloudflared**. Name it e.g. `cocktails-nas`. Save.
2. On the "Install connector" page, **copy the token** — the long string after `--token` in the shown
   command (starts `ey…`). *Don't* install anything; we run it via Docker.
3. Open the tunnel → **Public Hostname** tab → **Add a public hostname**:
   - **Subdomain** `cock` · **Domain** `meridew.com`  (→ `cock.meridew.com`)
   - **Service**: Type **HTTP**, URL **`caddy:80`**
   - Save. (Cloudflare auto-creates the proxied DNS record, replacing the old GitHub-Pages one.)
4. **Store the token as a secret** (paste it when prompted — keeps it out of the repo/logs):
   ```sh
   gh secret set TUNNEL_TOKEN -R meridew/cocktails
   ```
5. **Deploy** (or just push any change):
   ```sh
   gh workflow run "deploy (NAS)" -R meridew/cocktails --ref modernise
   ```
   The runner sees the token, enables the `tunnel` profile, and `cloudflared` connects.
6. Visit **https://cock.meridew.com** — the new app, over HTTPS. 🎉

## Right after it's live
- **Turn on Web Push** (now that we have HTTPS):
  ```sh
  npm -w @cocktails/api run gen-vapid           # prints VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
  gh secret set VAPID_PUBLIC_KEY  -R meridew/cocktails
  gh secret set VAPID_PRIVATE_KEY -R meridew/cocktails
  ```
  Add both to the deploy's `Write infra/.env` step (like the staff secrets), redeploy → push goes live.
- **Set a real staff password** (replace the `cocktails` placeholder): `gh secret set STAFF_PASSWORD …`
  → redeploy (the seed upserts it). Login stays `bar@meridew.com`.

## Ruthless follow-ups (optional, anytime)
- Drop the legacy flat app + GitHub Pages (`CNAME`, root `index.html`/`app.js`/…) — the tunnel now owns
  the domain, so Pages is redundant.
- Make the repo **private** (kills Pages — fine, since the tunnel replaced it).
- Cloudflare **Access** policy on the tunnel if you ever want to gate the whole site behind a login.

## Notes
- No router port-forward needed anymore (the tunnel dials out). The `:8088` host port stays for LAN.
- Caddy is unchanged — it still path-routes `/api`→api, everything else→web. The tunnel just feeds it.
- The web app calls `/api` same-origin, so it works at `cock.meridew.com` with no rebuild. The native
  app later sets `VITE_API_BASE=https://cock.meridew.com/api`.
