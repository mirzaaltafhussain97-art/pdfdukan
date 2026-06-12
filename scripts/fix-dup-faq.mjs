// fix-dup-faq.mjs — one-time/idempotent cleanup for the 8 tool pages that got
// expanded SEO content (2026-06) on top of the older injected AEO FAQ block,
// leaving two visible "Frequently Asked Questions" sections and duplicate
// FAQPage/HowTo JSON-LD.
//
// Per page:
//   1. Remove the injected AEO visible FAQ <section> (keeps Related Tools).
//   2. Rebuild the FAQPage node inside the head @graph from the questions that
//      are actually visible in the expanded FAQ section (Google requires
//      FAQPage schema to match on-page content).
//   3. Remove standalone body <script> blocks whose @type is FAQPage or HowTo
//      when the @graph already carries that type (schema must appear once).
//
// Usage: node scripts/fix-dup-faq.mjs

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(process.cwd(), 'public', 'tools');
const PAGES = [
  'ocr', 'merge-pdf', 'img-to-pdf', 'ai-pdf-summarizer',
  'compress-pdf', 'pdf-to-word', 'pdf-to-excel', 'split-pdf',
];

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&nbsp;': ' ', '&ndash;': '–', '&mdash;': '—',
  '&rsquo;': '’', '&lsquo;': '‘', '&rdquo;': '”',
  '&ldquo;': '“', '&hellip;': '…',
};

function plainText(html) {
  let t = html.replace(/<[^>]+>/g, ' ');
  for (const [ent, ch] of Object.entries(ENTITIES)) t = t.split(ent).join(ch);
  return t.replace(/\s+/g, ' ').trim();
}

let totalChanged = 0;

for (const page of PAGES) {
  const file = join(ROOT, `${page}.html`);
  let html = readFileSync(file, 'utf8');
  const before = html;

  // 1. Drop the injected AEO FAQ section (comment + <section>), keep Related Tools.
  html = html.replace(
    /<!-- AEO: FAQ \+ Related Tools \(injected for GEO\/AEO\/SXO\) -->\s*<section class="tool-seo-section" aria-label="Frequently Asked Questions">[\s\S]*?<\/section>\s*/,
    '<!-- Related Tools (injected for GEO/AEO/SXO) -->\n'
  );

  // 2. Collect the visible FAQ items that remain (the expanded section).
  const faqItems = [];
  const itemRe = /<button class="faq-q"[^>]*>([\s\S]*?)<\/button>\s*<div class="faq-a">([\s\S]*?)<\/div>\s*<\/div>/g;
  let m;
  while ((m = itemRe.exec(html)) !== null) {
    const q = plainText(m[1]);
    const a = plainText(m[2]);
    if (q && a) faqItems.push({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    });
  }
  if (faqItems.length === 0) {
    console.error(`✗ ${page}: no visible FAQ items found — skipped`);
    continue;
  }

  // 3. Walk every JSON-LD block: rebuild FAQPage in @graph, drop duplicate
  //    standalone FAQPage/HowTo scripts.
  let graphHasHowTo = false;
  const scriptRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  const blocks = [...html.matchAll(scriptRe)];

  // First pass: find what the @graph holds.
  for (const b of blocks) {
    try {
      const data = JSON.parse(b[1]);
      if (Array.isArray(data['@graph'])) {
        graphHasHowTo = data['@graph'].some(n => n['@type'] === 'HowTo');
      }
    } catch { /* not JSON we manage */ }
  }

  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b[1]); } catch { continue; }

    if (Array.isArray(data['@graph'])) {
      const graph = data['@graph'].filter(n => n['@type'] !== 'FAQPage');
      graph.push({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqItems,
      });
      data['@graph'] = graph;
      html = html.replace(b[0], `<script type="application/ld+json">${JSON.stringify(data)}</script>`);
    } else if (data['@type'] === 'FAQPage') {
      html = html.replace(b[0] + '\n', '').replace(b[0], '');
    } else if (data['@type'] === 'HowTo' && graphHasHowTo) {
      html = html.replace(b[0] + '\n', '').replace(b[0], '');
    }
  }

  if (html !== before) {
    writeFileSync(file, html);
    totalChanged++;
    const h2s = (html.match(/<h2>Frequently Asked Questions<\/h2>/g) || []).length;
    const faqSchemas = (html.match(/"@type":"FAQPage"/g) || []).length;
    const howtos = (html.match(/"@type":"HowTo"/g) || []).length;
    console.log(`✓ ${page}: ${faqItems.length} visible FAQs → schema | FAQ H2s: ${h2s}, FAQPage: ${faqSchemas}, HowTo: ${howtos}`);
  } else {
    console.log(`= ${page}: already clean`);
  }
}

console.log(`\nDone — ${totalChanged} file(s) updated.`);
