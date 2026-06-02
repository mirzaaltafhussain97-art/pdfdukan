<?php
/* ============================================================
   PDFdukan — AI Proxy (Groq, OpenAI-compatible)
   Keeps the API key OFF the client and OUT of the repo.
   Key is read from secret-config.php on the server only.
   Client tools POST { prompt, maxTokens } here.
   ============================================================ */

header('Content-Type: application/json; charset=utf-8');

/* ---- Locate the secret key ---- */
$GROQ_API_KEY = '';
$model = 'llama-3.3-70b-versatile';
$docroot = isset($_SERVER['DOCUMENT_ROOT']) ? rtrim($_SERVER['DOCUMENT_ROOT'], '/\\') : '';
$candidates = [
  __DIR__ . '/secret-config.php',
  __DIR__ . '/../secret-config.php',
  __DIR__ . '/../../secret-config.php',
  __DIR__ . '/../../../secret-config.php',
];
if ($docroot) {
  $candidates[] = $docroot . '/secret-config.php';
  $candidates[] = $docroot . '/../secret-config.php';
}
$candidates[] = '/home/' . get_current_user() . '/public_html/secret-config.php';

$loadedFrom = '';
foreach ($candidates as $f) {
  if (@is_file($f)) { include $f; $loadedFrom = $f; break; }
}
/* Back-compat: if someone set $GEMINI_API_KEY, treat it as the key */
if (empty($GROQ_API_KEY) && !empty($GEMINI_API_KEY)) { $GROQ_API_KEY = $GEMINI_API_KEY; }
if (getenv('GROQ_API_KEY')) { $GROQ_API_KEY = getenv('GROQ_API_KEY'); }
if (getenv('GROQ_MODEL'))   { $model = getenv('GROQ_MODEL'); }

/* Models tried in order (handles deprecated names automatically) */
$MODELS = array_values(array_unique([$model, 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama3-70b-8192', 'gemma2-9b-it']));

/* ---- Helper: call Groq, return [httpCode, decodedBody, curlErr] ---- */
function _groq($model, $key, $messages, $maxTokens) {
  $payload = ['model' => $model, 'messages' => $messages, 'max_tokens' => $maxTokens, 'temperature' => 0.7];
  $ch = curl_init('https://api.groq.com/openai/v1/chat/completions');
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'Authorization: Bearer ' . $key],
    CURLOPT_POSTFIELDS     => json_encode($payload),
    CURLOPT_TIMEOUT        => 60,
  ]);
  $resp = curl_exec($ch);
  $code = ($resp === false) ? 0 : curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err  = curl_error($ch);
  curl_close($ch);
  return [$code, ($resp === false ? null : json_decode($resp, true)), $err];
}

/* ---- Diagnostic: ?diag=1 (no key shown) ---- */
if (isset($_GET['diag'])) {
  $checked = [];
  foreach ($candidates as $f) { $checked[$f] = @is_file($f); }
  echo json_encode([
    'provider'      => 'groq',
    'document_root' => $docroot,
    'proxy_dir'     => __DIR__,
    'loaded_from'   => $loadedFrom ?: 'NONE FOUND',
    'key_present'   => !empty($GROQ_API_KEY) && strpos($GROQ_API_KEY, 'PASTE_') === false,
    'checked_paths' => $checked,
  ], JSON_PRETTY_PRINT);
  exit;
}

if (!$GROQ_API_KEY) {
  http_response_code(500);
  echo json_encode(['error' => 'Server not configured. Add your Groq key to secret-config.php on the server.']);
  exit;
}

/* ---- Test: ?test=1 ---- */
if (isset($_GET['test'])) {
  $out = [];
  foreach ($MODELS as $mm) {
    list($code, $body, $err) = _groq($mm, $GROQ_API_KEY, [['role' => 'user', 'content' => 'Say hello in 3 words.']], 50);
    $msg = isset($body['error']['message']) ? $body['error']['message'] : ($err ?: 'OK');
    $out[$mm] = ['http' => $code, 'result' => ($code === 200 ? 'WORKS' : $msg)];
    if ($code === 200) break;
  }
  echo json_encode(['key_length' => strlen($GROQ_API_KEY), 'models' => $out], JSON_PRETTY_PRINT);
  exit;
}

/* ---- Only POST ---- */
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['error' => 'Method not allowed']);
  exit;
}

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body) || empty($body['prompt'])) {
  http_response_code(400);
  echo json_encode(['error' => 'Missing prompt']);
  exit;
}
$prompt    = (string) $body['prompt'];
$maxTokens = isset($body['maxTokens']) ? (int) $body['maxTokens'] : 2048;
if ($maxTokens < 1)    { $maxTokens = 1; }
if ($maxTokens > 8000) { $maxTokens = 8000; }

$messages = [['role' => 'user', 'content' => $prompt]];

/* ---- Call Groq with model fallback ---- */
$data = null; $code = 0; $lastMsg = '';
foreach ($MODELS as $mm) {
  list($code, $b, $err) = _groq($mm, $GROQ_API_KEY, $messages, $maxTokens);
  if ($code === 200) { $data = $b; break; }
  $lastMsg = isset($b['error']['message']) ? $b['error']['message'] : ($err ?: ('HTTP ' . $code));
  if (in_array($code, [400, 401, 403, 429])) { break; }
}
if ($data === null) {
  http_response_code($code ?: 502);
  echo json_encode(['error' => $lastMsg ?: 'AI API error']);
  exit;
}

$text = isset($data['choices'][0]['message']['content']) ? $data['choices'][0]['message']['content'] : '';
echo json_encode(['text' => $text]);
