// Cache-busting stamper.
// Hostinger's CDN caches local /css and /js assets and serves stale copies for
// a while after each deploy, so freshly-deployed JS/CSS doesn't show up until
// the CDN TTL expires (tools then look old/broken). Stamping a version query on
// every local asset reference forces the CDN + browsers to fetch the new file
// immediately, because the URL itself changes each deploy.
//
// Usage:
//   node scripts/cache-bust.mjs            -> auto version (date + short id)
//   node scripts/cache-bust.mjs 20260605a  -> explicit version
//
// Run this BEFORE committing whenever you change anything in public/css or
// public/js. The HTML is served with max-age=0 (revalidated), so updated
// asset URLs are picked up on the next page load.
import fs from 'fs';
import path from 'path';

const VERSION =
  process.argv[2] ||
  new Date().toISOString().slice(0, 10).replace(/-/g, '') +
    '-' +
    Date.now().toString(36).slice(-4);

const ROOT = 'public';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.html') ? [p] : [];
  });
}

// Match src/href pointing at a local .css or .js file, with or without an
// existing ?v= stamp. External (http(s):// or //) URLs are skipped.
const RE = /(\b(?:src|href)=")([^"]+\.(?:css|js))(?:\?v=[^"]*)?(")/g;

let files = 0;
let refs = 0;
for (const file of walk(ROOT)) {
  const orig = fs.readFileSync(file, 'utf8');
  const out = orig.replace(RE, (m, pre, url, post) => {
    if (/^(https?:)?\/\//i.test(url)) return m; // external CDN/script — leave alone
    refs++;
    return `${pre}${url}?v=${VERSION}${post}`;
  });
  if (out !== orig) {
    fs.writeFileSync(file, out);
    files++;
  }
}

console.log(`cache-bust v=${VERSION}: ${files} files updated, ${refs} asset refs stamped`);
