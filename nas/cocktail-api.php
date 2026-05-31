<?php
/* ============================================================
   cocktail-api.php — shared JSON order store for "bartender mode"
   Runs on Synology Web Station (PHP). Single file, no database.

   Order shape matches the website's basket:
     { id, name, items:[{name, qty}], note, ts(ms), status:"pending"|"done" }

   Endpoints (all return JSON):
     POST ?action=order   {name, items:[{name,qty}], note}  -> add   (public)
     GET  ?action=list                                       -> all   (needs key)
     POST ?action=status  {id, status:"pending"|"done"}      -> set   (needs key)
     POST ?action=delete  {id}                               -> remove(needs key)
     POST ?action=clear   {which:"done"|"all"}               -> bulk  (needs key)

   The bartender key is sent in the "X-Bartender-Key" header.
   See nas/README.md for install steps.
   ============================================================ */

// ----------------------- CONFIG (edit these) -----------------------
$ALLOWED_ORIGIN = 'https://cock.meridew.com';          // your site origin
$BARTENDER_KEY  = 'CHANGE-ME-to-a-strong-passphrase';  // bartender must enter this
$DATA_FILE      = __DIR__ . '/orders.data.php';        // self-guarding data file
$MAX_ORDERS     = 500;                                  // safety cap
$MAX_ITEMS      = 50;                                   // items per order
$MAX_LEN        = 140;                                  // max chars per field
// -------------------------------------------------------------------

// Leading guard so the data file is inert if requested directly in a browser.
$GUARD = "<?php http_response_code(403); die('Forbidden'); ?>\n";

// ----------------------- CORS / headers ----------------------------
header('Access-Control-Allow-Origin: ' . $ALLOWED_ORIGIN);
header('Vary: Origin');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Bartender-Key');
header('Access-Control-Max-Age: 86400');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ----------------------- helpers -----------------------------------
function out($data, $code = 200) {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}
function clean_str($s, $max) {
  $s = is_string($s) ? trim($s) : '';
  $s = preg_replace('/[\x00-\x1F\x7F]/u', '', $s); // strip control chars
  if (mb_strlen($s) > $max) $s = mb_substr($s, 0, $max);
  return $s;
}
function clean_items($raw, $maxItems, $maxLen) {
  if (!is_array($raw)) return [];
  $items = [];
  foreach ($raw as $it) {
    if (!is_array($it)) continue;
    $name = clean_str(isset($it['name']) ? $it['name'] : '', $maxLen);
    if ($name === '') continue;
    $qty = isset($it['qty']) ? (int)$it['qty'] : 1;
    if ($qty < 1) $qty = 1;
    if ($qty > 99) $qty = 99;
    $items[] = ['name' => $name, 'qty' => $qty];
    if (count($items) >= $maxItems) break;
  }
  return $items;
}
function require_key() {
  global $BARTENDER_KEY;
  $sent = isset($_SERVER['HTTP_X_BARTENDER_KEY']) ? $_SERVER['HTTP_X_BARTENDER_KEY'] : '';
  if (!is_string($sent) || !hash_equals($BARTENDER_KEY, $sent)) {
    out(['ok' => false, 'error' => 'unauthorized'], 401);
  }
}
function now_ms() { return (int) round(microtime(true) * 1000); }

/* Read-modify-write under an exclusive lock. $fn(orders) -> [orders, response]. */
function with_store($file, $guard, $fn) {
  $fp = @fopen($file, file_exists($file) ? 'r+' : 'w+');
  if (!$fp) out(['ok' => false, 'error' => 'store_unavailable'], 500);
  flock($fp, LOCK_EX);

  $raw = stream_get_contents($fp);
  $nl  = strpos($raw, "\n");
  $json = ($nl === false) ? '' : substr($raw, $nl + 1);
  $orders = json_decode($json, true);
  if (!is_array($orders)) $orders = [];

  list($orders, $response) = $fn($orders);

  ftruncate($fp, 0);
  rewind($fp);
  fwrite($fp, $guard . json_encode(array_values($orders), JSON_UNESCAPED_UNICODE));
  fflush($fp);
  flock($fp, LOCK_UN);
  fclose($fp);

  return $response;
}

// ----------------------- routing -----------------------------------
$action = isset($_GET['action']) ? $_GET['action'] : '';
$body   = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) $body = [];

switch ($action) {

  case 'order': // ---- public: guest places an order ----
    $name  = clean_str(isset($body['name']) ? $body['name'] : '', $MAX_LEN);
    $note  = clean_str(isset($body['note']) ? $body['note'] : '', $MAX_LEN);
    $items = clean_items(isset($body['items']) ? $body['items'] : [], $MAX_ITEMS, $MAX_LEN);
    if ($name === '' || count($items) === 0) {
      out(['ok' => false, 'error' => 'name and at least one item required'], 422);
    }
    $resp = with_store($DATA_FILE, $GUARD, function ($orders) use ($name, $items, $note, $MAX_ORDERS) {
      if (count($orders) >= $MAX_ORDERS) array_shift($orders); // drop oldest if capped
      $order = [
        'id'     => bin2hex(random_bytes(6)),
        'name'   => $name,
        'items'  => $items,
        'note'   => $note,
        'ts'     => now_ms(),
        'status' => 'pending',
      ];
      $orders[] = $order;
      return [$orders, ['ok' => true, 'id' => $order['id']]];
    });
    out($resp);
    break;

  case 'list': // ---- bartender: read the queue ----
    require_key();
    $resp = with_store($DATA_FILE, $GUARD, function ($orders) {
      return [$orders, ['ok' => true, 'orders' => $orders, 'now' => now_ms()]];
    });
    out($resp);
    break;

  case 'status': // ---- bartender: pending <-> done ----
    require_key();
    $id = isset($body['id']) ? (string)$body['id'] : '';
    $st = isset($body['status']) ? (string)$body['status'] : '';
    if (!in_array($st, ['pending', 'making', 'done'], true)) out(['ok' => false, 'error' => 'bad status'], 422);
    $resp = with_store($DATA_FILE, $GUARD, function ($orders) use ($id, $st) {
      $found = false;
      foreach ($orders as &$o) { if ($o['id'] === $id) { $o['status'] = $st; $found = true; break; } }
      unset($o);
      return [$orders, ['ok' => $found]];
    });
    out($resp);
    break;

  case 'delete': // ---- bartender: remove one ----
    require_key();
    $id = isset($body['id']) ? (string)$body['id'] : '';
    $resp = with_store($DATA_FILE, $GUARD, function ($orders) use ($id) {
      $orders = array_filter($orders, function ($o) use ($id) { return $o['id'] !== $id; });
      return [$orders, ['ok' => true]];
    });
    out($resp);
    break;

  case 'clear': // ---- bartender: bulk remove ----
    require_key();
    $which = isset($body['which']) ? (string)$body['which'] : 'done';
    $resp = with_store($DATA_FILE, $GUARD, function ($orders) use ($which) {
      if ($which === 'all') { $orders = []; }
      else { $orders = array_filter($orders, function ($o) { return $o['status'] !== 'done'; }); }
      return [$orders, ['ok' => true]];
    });
    out($resp);
    break;

  default:
    out(['ok' => false, 'error' => 'unknown action'], 404);
}
