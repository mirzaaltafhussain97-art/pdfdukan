// One-shot bulk SEO injector: OG/Twitter tags + hreflang (en + x-default).
// Idempotent: skips a block if the file already has it. Run from project root:
//   node scripts/seo-bulk.mjs
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('public');
const OG_IMAGE = 'https://pdfdukan.com/og-image.jpg';
const SITE = 'https://pdfdukan.com';

function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

function attr(html, re) {
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function urlForFile(file) {
  let rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (rel === 'index.html') return SITE + '/';
  return SITE + '/' + rel;
}

const report = { ogAdded: [], hreflangAdded: [], canonicalAdded: [], skipped: [], noTitle: [] };

for (const file of walk(ROOT)) {
  let html = fs.readFileSync(file, 'utf8');
  const orig = html;
  const url = urlForFile(file);
  const isBlog = file.split(path.sep).includes('blog');

  const title = attr(html, /<title>([\s\S]*?)<\/title>/i);
  let desc = attr(html, /<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']\s*\/?>/i);
  if (!title) { report.noTitle.push(file); continue; }
  if (!desc) desc = title;

  // escape double quotes for attribute safety
  const esc = (s) => s.replace(/"/g, '&quot;');
  const ogTitle = esc(title);
  const ogDesc = esc(desc);

  const hasCanonical = /rel=["']canonical["']/i.test(html);
  const hasOg = /property=["']og:/i.test(html);
  const hasHreflang = /hreflang=/i.test(html);

  // 1) Ensure canonical exists (anchor for the rest). Insert after description or after <title>.
  if (!hasCanonical) {
    const canonTag = `<link rel="canonical" href="${url}">`;
    const after = html.match(/<meta\s+name=["']description["'][\s\S]*?>/i) || html.match(/<title>[\s\S]*?<\/title>/i);
    if (after) {
      html = html.replace(after[0], after[0] + '\n' + canonTag);
      report.canonicalAdded.push(file);
    }
  }

  const canonLine = html.match(/<link\s+rel=["']canonical["'][^>]*>/i);
  const anchor = canonLine ? canonLine[0] : (html.match(/<meta\s+name=["']description["'][\s\S]*?>/i) || html.match(/<title>[\s\S]*?<\/title>/i))[0];

  let insert = '';

  // 2) hreflang (en + x-default only — no fake Urdu)
  if (!hasHreflang) {
    insert += `\n<link rel="alternate" hreflang="en" href="${url}">` +
              `\n<link rel="alternate" hreflang="x-default" href="${url}">`;
    report.hreflangAdded.push(file);
  }

  // 3) Open Graph + Twitter
  if (!hasOg) {
    insert += `\n<!-- Open Graph -->` +
      `\n<meta property="og:type" content="${isBlog ? 'article' : 'website'}">` +
      `\n<meta property="og:site_name" content="PDFdukan">` +
      `\n<meta property="og:url" content="${url}">` +
      `\n<meta property="og:title" content="${ogTitle}">` +
      `\n<meta property="og:description" content="${ogDesc}">` +
      `\n<meta property="og:image" content="${OG_IMAGE}">` +
      `\n<meta property="og:image:width" content="1200">` +
      `\n<meta property="og:image:height" content="630">` +
      `\n<meta property="og:locale" content="en_US">` +
      `\n<!-- Twitter -->` +
      `\n<meta name="twitter:card" content="summary_large_image">` +
      `\n<meta name="twitter:site" content="@pdfdukan">` +
      `\n<meta name="twitter:title" content="${ogTitle}">` +
      `\n<meta name="twitter:description" content="${ogDesc}">` +
      `\n<meta name="twitter:image" content="${OG_IMAGE}">`;
    report.ogAdded.push(file);
  }

  if (insert) {
    html = html.replace(anchor, anchor + insert);
  }

  if (html !== orig) fs.writeFileSync(file, html, 'utf8');
  else report.skipped.push(file);
}

const rel = (a) => a.map((f) => path.relative('.', f).split(path.sep).join('/'));
console.log('OG added:        ', report.ogAdded.length);
console.log('hreflang added:  ', report.hreflangAdded.length);
console.log('canonical added: ', report.canonicalAdded.length, rel(report.canonicalAdded));
console.log('skipped (nochange):', report.skipped.length, rel(report.skipped));
console.log('no <title> (skipped):', report.noTitle.length, rel(report.noTitle));
