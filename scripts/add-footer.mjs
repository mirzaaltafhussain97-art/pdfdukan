// add-footer.mjs — inject the standard site footer into pages that are
// missing it (all blog pages + several root pages had no <footer>).
//
// Source of truth:
//   - root pages  → footer copied from public/index.html      (root-relative links)
//   - subdir pages→ footer copied from public/tools/compress-pdf.html (../ links,
//                    valid from both /tools/ and /blog/ since both are one level deep)
//
// Footer is inserted immediately before </body>. Idempotent: pages that
// already contain a <footer> are skipped.
//
// Usage: node scripts/add-footer.mjs

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const PUB = join(process.cwd(), 'public');

function extractFooter(file) {
  const html = readFileSync(file, 'utf8');
  const m = html.match(/<footer class="footer"[^>]*>[\s\S]*?<\/footer>/);
  if (!m) throw new Error(`No footer found in ${file}`);
  return m[0];
}

const rootFooter = extractFooter(join(PUB, 'index.html'));
const subFooter  = extractFooter(join(PUB, 'tools', 'compress-pdf.html'));

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith('.html')) yield p;
  }
}

const SKIP = new Set(['yandex_946f7d7197c92580.html', '404.html']);
let added = 0;

for (const file of htmlFiles(PUB)) {
  const base = file.split(/[\\/]/).pop();
  if (SKIP.has(base)) continue;
  let html = readFileSync(file, 'utf8');
  if (/<footer/.test(html)) continue;
  if (!html.includes('</body>')) { console.error(`✗ no </body> in ${file}`); continue; }

  const isSubdir = /[\\/]public[\\/](blog|tools)[\\/]/.test(file);
  const footer = isSubdir ? subFooter : rootFooter;
  html = html.replace('</body>', `${footer}\n</body>`);
  writeFileSync(file, html);
  added++;
  console.log(`✓ ${file.replace(PUB, '')}`);
}

console.log(`\nDone — footer added to ${added} page(s).`);
