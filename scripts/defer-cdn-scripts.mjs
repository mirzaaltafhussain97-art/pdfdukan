// Adds `defer` to render-blocking external CDN <script> tags in <head> across
// all public/**/*.html, and makes the adjacent inline pdf.js workerSrc setters
// defer-safe by wrapping them in a DOMContentLoaded listener (deferred scripts
// always execute before DOMContentLoaded, so the lib global exists by then).
//
// Why: every tool page loaded pdf.js / pdf-lib / jspdf / tesseract / etc.
// synchronously in <head>, blocking first paint for new (cold-cache) users.
//
// Idempotent — re-run any time (e.g. after adding new tool pages).
// Usage: node scripts/defer-cdn-scripts.mjs

import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(process.cwd(), 'public');
const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
];

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith('.html')) yield p;
  }
}

let changedFiles = 0, deferred = 0, wrapped = 0;

for (const file of htmlFiles(ROOT)) {
  let html = readFileSync(file, 'utf8');
  const headEnd = html.indexOf('</head>');
  if (headEnd === -1) continue;
  let head = html.slice(0, headEnd);
  const rest = html.slice(headEnd);
  let changed = false;

  // 1. defer external CDN scripts in <head> that have no async/defer/module
  head = head.replace(/<script\s+src="(https:\/\/[^"]+)"([^>]*)>/g, (m, src, attrs) => {
    if (!CDN_HOSTS.some(h => src.includes(h))) return m;
    if (/\b(async|defer|type="module")\b/.test(m)) return m;
    deferred++; changed = true;
    return `<script defer src="${src}"${attrs}>`;
  });

  // 2. wrap bare inline workerSrc setters so they run after deferred pdf.js
  head = head.replace(
    /<script>(\s*(?:if\(typeof pdfjsLib!=="undefined"\)\{)?\s*pdfjsLib\.GlobalWorkerOptions\.workerSrc\s*=\s*['"]([^'"]+)['"];?\s*\}?\s*)<\/script>/g,
    (m, _body, workerUrl) => {
      wrapped++; changed = true;
      return `<script>window.addEventListener('DOMContentLoaded',function(){if(window.pdfjsLib)pdfjsLib.GlobalWorkerOptions.workerSrc='${workerUrl}';});</script>`;
    }
  );

  if (changed) {
    writeFileSync(file, head + rest);
    changedFiles++;
    console.log('updated', file.replace(ROOT, ''));
  }
}

console.log(`\n${changedFiles} files changed, ${deferred} scripts deferred, ${wrapped} workerSrc setters wrapped`);
