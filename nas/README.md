# 🍸 NAS order API — Synology Web Station setup

This is the backend for "bartender mode": a single PHP file that stores orders
as JSON on your Synology. Guests POST orders from the website; the bartender
page reads/updates them.

## Prerequisites (you already have these)
- Web Station installed, with a **PHP** profile enabled.
- The NAS reachable over **HTTPS** (e.g. `https://yourname.synology.me`) with a
  valid Let's Encrypt cert.

## 1. Edit the two settings at the top of `cocktail-api.php`
```php
$ALLOWED_ORIGIN = 'https://cock.meridew.com';          // leave as-is
$BARTENDER_KEY  = 'CHANGE-ME-to-a-strong-passphrase';  // <-- pick a real passphrase
```
The `$BARTENDER_KEY` is what the bartender types in to see/manage orders. Make it
decent (it's the only thing protecting the queue). Don't commit your real key.

## 2. Copy the file to your web root
Put `cocktail-api.php` in Web Station's document root (commonly `/web` or a
virtual host's folder). It will then be reachable at, e.g.:
```
https://yourname.synology.me/cocktail-api.php
```

## 3. Make the folder writable
The script creates `orders.data.php` next to itself. The PHP user (often
`http`) needs write permission to that folder. In **File Station**:
- right-click the folder → **Properties → Permission**
- give the `http` user (or the relevant group) **Read/Write**, apply.

> The data file is named `.php` and starts with a `die()` guard, so even if
> someone requests `orders.data.php` directly in a browser they get `403` — the
> orders are only readable through the API with the bartender key.

## 4. Test it
```bash
# place an order (public)
curl -X POST "https://yourname.synology.me/cocktail-api.php?action=order" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","items":[{"name":"Margarita","qty":2}],"note":"extra lime"}'
# -> {"ok":true,"id":"..."}

# read the queue (needs the key)
curl "https://yourname.synology.me/cocktail-api.php?action=list" \
  -H "X-Bartender-Key: CHANGE-ME-to-a-strong-passphrase"
# -> {"ok":true,"orders":[...],"now":...}
```

## 5. Point the website at it
In the site repo, edit **`config.js`**:
```js
window.COCKTAIL_API = "https://yourname.synology.me/cocktail-api.php";
```
Commit + push. From then on the order form posts to your NAS instead of email.
(Until that URL is set, the form safely falls back to Formspree email.)

## 6. Open bartender mode
On the site, tap the **🍸 button** in the top bar (or go to
**https://cock.meridew.com/#bartender**). Enter your `$BARTENDER_KEY` once; the
shared live queue then appears and auto-refreshes. Keep it open behind the bar.

> With `config.js` set, bartender mode reads the **shared NAS queue** (orders
> from every guest's device). Without it, bartender mode falls back to showing
> only orders placed on that one device.

---

### Notes / hardening
- **CORS** is locked to `https://cock.meridew.com`. If you test from elsewhere,
  add that origin to `$ALLOWED_ORIGIN` (one origin per deploy).
- Ordering is intentionally open (guests have no key). The `$MAX_ORDERS` cap and
  per-field length limits keep abuse bounded. For a private party this is fine;
  if you want, put the endpoint behind Web Station's IP allow-list or a rate
  limit in the reverse proxy.
- Backups: the entire order history is just `orders.data.php` — copy it anywhere.
