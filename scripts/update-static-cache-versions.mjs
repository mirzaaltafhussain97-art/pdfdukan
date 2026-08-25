// Update cache-busting query strings after shared front-end assets change.
// Idempotent: running it again with the same RELEASE leaves files untouched.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RELEASE = '20260825i';
const PUBLIC_ROOT = join(process.cwd(), 'public');
const ASSETS = ['style.css', 'app.js', 'header.js', 'tools.js', 'scanner.js', 'crop.js', 'i18n.js'];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const file = join(dir, name);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
}

let changed = 0;
for (const file of walk(PUBLIC_ROOT).filter((name) => name.endsWith('.html'))) {
  const before = readFileSync(file, 'utf8');
  let after = before;
  for (const asset of ASSETS) {
    const escaped = asset.replace('.', '\\.');
    after = after.replace(new RegExp(`(${escaped})\\?v=[A-Za-z0-9._-]+`, 'g'), `$1?v=${RELEASE}`);
  }
  if (after !== before) {
    writeFileSync(file, after, 'utf8');
    changed++;
  }
}

console.log(`Static asset release ${RELEASE}: ${changed} HTML files updated`);
