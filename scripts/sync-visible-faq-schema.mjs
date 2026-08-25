// Keep FAQPage JSON-LD aligned with the FAQ questions and answers visitors can
// actually read. This script is intentionally idempotent and scans all public
// HTML pages so future wording updates do not leave stale structured data.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC_ROOT = join(process.cwd(), 'public');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const file = join(dir, name);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
}

function plainText(value) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&rsquo;/gi, '’')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rdquo;/gi, '”')
    .replace(/&ldquo;/gi, '“')
    .replace(/&hellip;/gi, '…')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function visibleFaqs(html) {
  const items = [];
  const itemRe = /<button\b[^>]*class="[^"]*\bfaq-q\b[^"]*"[^>]*>([\s\S]*?)<\/button>\s*<div\b[^>]*class="[^"]*\bfaq-a\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let match;
  while ((match = itemRe.exec(html))) {
    const name = plainText(match[1]);
    const text = plainText(match[2]);
    if (name && text) {
      items.push({
        '@type': 'Question',
        name,
        acceptedAnswer: { '@type': 'Answer', text },
      });
    }
  }
  return items;
}

let changed = 0;
let checked = 0;

for (const file of walk(PUBLIC_ROOT).filter((name) => name.endsWith('.html'))) {
  const before = readFileSync(file, 'utf8');
  const faqs = visibleFaqs(before);
  if (!faqs.length || !before.includes('FAQPage')) continue;
  checked++;

  let keptFaqSchema = false;
  const after = before.replace(
    /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
    (block, json) => {
      let data;
      try {
        data = JSON.parse(json);
      } catch {
        return block;
      }

      if (Array.isArray(data['@graph'])) {
        const nextGraph = [];
        let graphHadFaq = false;
        for (const node of data['@graph']) {
          if (node?.['@type'] !== 'FAQPage') {
            nextGraph.push(node);
            continue;
          }
          graphHadFaq = true;
          if (!keptFaqSchema) {
            nextGraph.push({ '@type': 'FAQPage', mainEntity: faqs });
            keptFaqSchema = true;
          }
        }
        if (!graphHadFaq) return block;
        data['@graph'] = nextGraph;
        return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
      }

      if (data?.['@type'] === 'FAQPage') {
        if (keptFaqSchema) return '';
        keptFaqSchema = true;
        return `<script type="application/ld+json">${JSON.stringify({
          '@context': data['@context'] || 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faqs,
        })}</script>`;
      }

      return block;
    },
  );

  if (after !== before) {
    writeFileSync(file, after, 'utf8');
    changed++;
    console.log(`synced ${file.slice(PUBLIC_ROOT.length + 1)} (${faqs.length} FAQs)`);
  }
}

console.log(`FAQ schema checked: ${checked}; files changed: ${changed}`);
