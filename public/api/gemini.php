<?php
/* ============================================================
   PDFdukan — Gemini API Proxy
   Keeps the API key OFF the client and OUT of the GitHub repo.
   The key is read from secret-config.php (placed on the server
   only, never committed). Client tools POST here instead of
   calling Google directly.
   ============================================================ */

header('Content-Type: application/json; charset=utf-8');

/* ---- Locate the secret key (try a few common spots) ---- */
$GEMINI_API_KEY = '';
$model = 'gemini-1.5-flash';
$docroot = isset($_SERVER['DOCUMENT_ROOT']) ? rtrim($_SERVER['DOCUMENT_ROOT'], '/\\') : '';
$candidates = [
  __DIR__ . '/secret-config.php',          // same folder as this proxy
  __DIR__ . '/../secret-config.php',       // one level up
  __DIR__ . '/../../secret-config.php',    // two levels up
  __DIR__ . '/../../../secret-config.php', // three levels up (Next.js build nesting)
];
if ($docroot) {
  $candidates[] = $docroot . '/secret-config.php';        // web root (public_html)
  $candidates[] = $docroot . '/../secret-config.php';     // above web root (most private)
}
/* Common Hostinger absolute fallbacks */
$candidates[] = '/home/' . get_current_user() . '/public_html/secret-config.php';
$candidates[] = '/home/' . get_current_user() . '/domains/secret-config.php';

$loadedFrom = '';
foreach ($candidates as $f) {
  if (@is_file($f)) { include $f; $loadedFrom = $f; break; }
}

/* Safe diagnostic: /api/gemini.php?diag=1 — shows where it looked (NO key shown) */
if (isset($_GET['diag'])) {
  $checked = [];
  foreach ($candidates as $f) { $checked[$f] = @is_file($f); }
  echo json_encode([
    'document_root' => $docroot,
    'proxy_dir'     => __DIR__,
    'loaded_from'   => $loadedFrom ?: 'NONE FOUND',
    'key_present'   => !empty($GEMINI_API_KEY) && $GEMINI_API_KEY !== 'PASTE_YOUR_AIzaSy_KEY_HERE',
    'checked_paths' => $checked,
  ], JSON_PRETTY_PRINT);
  exit;
}
/* Allow a real server environment variable to override, if set */
if (getenv('GEMINI_API_KEY')) { $GEMINI_API_KEY = getenv('GEMINI_API_KEY'); }
if (getenv('GEMINI_MODEL'))   { $model = getenv('GEMINI_MODEL'); }

if (!$GEMINI_API_KEY) {
  http_response_code(500);
  echo json_encode(['error' => 'Server not configured. Add your Gemini key to secret-config.php on the server.']);
  exit;
}

/* ---- Helper: call a Gemini model, return [httpCode, decodedBody] ---- */
function _gcall($model, $key, $payload) {
  $url = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent?key=' . urlencode($key);
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS     => json_encode($payload),
    CURLOPT_TIMEOUT        => 60,
  ]);
  $resp = curl_exec($ch);
  $code = ($resp === false) ? 0 : curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err  = curl_error($ch);
  curl_close($ch);
  return [$code, ($resp === false ? null : json_decode($resp, true)), $err, $resp];
}

/* Models tried in order (newest first) — handles deprecated model names */
$MODELS = array_values(array_unique([$model, 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash-latest', 'gemini-pro']));

/* ---- TEST MODE: /api/gemini.php?test=1 — diagnoses key/model via browser ---- */
if (isset($_GET['test'])) {
  $p = ['contents' => [['parts' => [['text' => 'Say hello in 3 words.']]]]];
  $out = [];
  foreach ($MODELS as $mm) {
    list($code, $body, $err) = _gcall($mm, $GEMINI_API_KEY, $p);
    $msg = isset($body['error']['message']) ? $body['error']['message'] : ($err ?: 'OK');
    $out[$mm] = ['http' => $code, 'result' => ($code === 200 ? 'WORKS' : $msg)];
    if ($code === 200) break;
  }
  echo json_encode(['key_length' => strlen($GEMINI_API_KEY), 'models' => $out], JSON_PRETTY_PRINT);
  exit;
}

/* ---- Only POST allowed ---- */
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['error' => 'Method not allowed']);
  exit;
}

/* ---- Read + validate input ---- */
$raw = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body) || empty($body['prompt'])) {
  http_response_code(400);
  echo json_encode(['error' => 'Missing prompt']);
  exit;
}

$prompt    = (string) $body['prompt'];
$maxTokens = isset($body['maxTokens']) ? (int) $body['maxTokens'] : 2048;
if ($maxTokens < 1)    { $maxTokens = 1; }
if ($maxTokens > 8192) { $maxTokens = 8192; }

/* Optional inline file (base64) for PDF/image understanding */
$parts = [['text' => $prompt]];
if (!empty($body['fileData']) && !empty($body['mimeType'])) {
  $parts[] = ['inline_data' => ['mime_type' => (string)$body['mimeType'], 'data' => (string)$body['fileData']]];
}

$payload = [
  'contents' => [['parts' => $parts]],
  'generationConfig' => ['maxOutputTokens' => $maxTokens, 'temperature' => 0.7],
];

/* ---- Call Gemini, with automatic model fallback ---- */
$data = null; $code = 0; $lastMsg = '';
foreach ($MODELS as $mm) {
  list($code, $body, $err) = _gcall($mm, $GEMINI_API_KEY, $payload);
  if ($code === 200) { $data = $body; break; }
  $lastMsg = isset($body['error']['message']) ? $body['error']['message'] : ($err ?: ('HTTP ' . $code));
  /* If it's a key/permission/quota problem, stop trying other models */
  if (in_array($code, [400, 401, 403, 429])) { break; }
}

if ($data === null) {
  http_response_code($code ?: 502);
  echo json_encode(['error' => $lastMsg ?: 'Gemini API error']);
  exit;
}
$text = '';
if (isset($data['candidates'][0]['content']['parts'])) {
  foreach ($data['candidates'][0]['content']['parts'] as $p) {
    if (isset($p['text'])) { $text .= $p['text']; }
  }
}
echo json_encode(['text' => $text]);
