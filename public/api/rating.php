<?php
/* PDFdukan — tool ratings (real votes only).
   GET  /api/rating.php?tool=merge-pdf            -> {"tool","avg","count"}
   POST /api/rating.php  {"tool":"merge-pdf","score":5} -> same, after saving
   One vote per visitor per tool (salted hash of IP + browser; the raw IP is never stored).
   A repeat vote from the same visitor replaces their earlier score. */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$TOOLS = ['merge-pdf','extract-pdf-pages','compress-pdf-reduce-file-size','organize-pdf-pages-online','crop-pdf-online',
  'pdf-editor','fill-sign','add-watermark-to-pdf-online','page-numbers','unlock-pdf-without-password',
  'pdf-restriction-compatibility-check','pdf-metadata','pdf-to-word-converter','pdf-to-image-converter',
  'image-to-pdf-converter','word-to-pdf-converter','ocr-image-to-text','pdf-text-extractor','searchable-pdf',
  'image-compress-resize','html-to-pdf-converter-online','word-character-counter','scanner'];

$dir  = __DIR__ . '/data';
$file = $dir . '/ratings.json';
if (!is_dir($dir)) { @mkdir($dir, 0750, true); @file_put_contents($dir . '/.htaccess', "Require all denied\n"); }

function out($code, $arr) { http_response_code($code); echo json_encode($arr); exit; }
function summary($db, $tool) {
  $v = isset($db[$tool]) ? $db[$tool] : [];
  $n = count($v); $sum = 0; foreach ($v as $s) $sum += $s;
  return ['tool' => $tool, 'avg' => $n ? round($sum / $n, 1) : 0, 'count' => $n];
}
function load($fh) { rewind($fh); $raw = stream_get_contents($fh); $db = json_decode($raw ?: '{}', true); return is_array($db) ? $db : []; }

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'GET') {
  $tool = $_GET['tool'] ?? '';
  if (!in_array($tool, $TOOLS, true)) out(400, ['error' => 'unknown tool']);
  $fh = @fopen($file, 'c+'); if (!$fh) out(200, ['tool' => $tool, 'avg' => 0, 'count' => 0]);
  flock($fh, LOCK_SH); $db = load($fh); flock($fh, LOCK_UN); fclose($fh);
  out(200, summary($db, $tool));
}
if ($method !== 'POST') out(405, ['error' => 'method']);

/* same-site only */
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$host = $_SERVER['HTTP_HOST'] ?? '';
$norm = function ($h) { return preg_replace('/^www\./', '', strtolower(preg_replace('/:\d+$/', '', (string)$h))); };
if ($origin && $norm(parse_url($origin, PHP_URL_HOST)) !== $norm($host)) out(403, ['error' => 'origin']);

$in = json_decode(file_get_contents('php://input', false, null, 0, 2000), true);
$tool = is_array($in) ? ($in['tool'] ?? '') : '';
$score = is_array($in) ? intval($in['score'] ?? 0) : 0;
if (!in_array($tool, $TOOLS, true) || $score < 1 || $score > 5) out(400, ['error' => 'bad input']);

$saltFile = $dir . '/salt.txt';
if (!is_file($saltFile)) @file_put_contents($saltFile, bin2hex(random_bytes(16)));
$salt = @file_get_contents($saltFile) ?: 'pdfdukan';
$ip = $_SERVER['REMOTE_ADDR'] ?? '';
$voter = substr(hash('sha256', $salt . '|' . $ip . '|' . ($_SERVER['HTTP_USER_AGENT'] ?? '')), 0, 24);

$fh = @fopen($file, 'c+'); if (!$fh) out(500, ['error' => 'storage']);
flock($fh, LOCK_EX);
$db = load($fh);
if (!isset($db[$tool])) $db[$tool] = [];
$db[$tool][$voter] = $score;
ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($db)); fflush($fh);
flock($fh, LOCK_UN); fclose($fh);
out(200, summary($db, $tool));
