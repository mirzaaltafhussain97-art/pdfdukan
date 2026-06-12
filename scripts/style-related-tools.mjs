// style-related-tools.mjs — convert plain "Related Tools" middot-separated
// link paragraphs into the existing .related-tools-grid card design used by
// the AEO-injected sections, so the look is consistent sitewide.
//
// Idempotent: only matches the <h2>Related Tools</h2><p>…links…</p> form.
// Usage: node scripts/style-related-tools.mjs

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const TOOLS = join(process.cwd(), 'public', 'tools');

const ICONS = {
  'merge-pdf': '🔗', 'split-pdf': '✂️', 'rotate-pdf': '🔄', 'compress-pdf': '📉',
  'pdf-to-img': '🖼️', 'img-to-pdf': '📑', 'ocr': '🔤', 'pdf-to-word': '📝',
  'word-to-pdf': '📄', 'pdf-to-excel': '📊', 'excel-to-pdf': '📈',
  'pdf-text-extractor': '📋', 'ai-pdf-chat': '💬', 'ai-pdf-summarizer': '🤖',
  'ai-summarize': '✨', 'ai-detector': '🕵️', 'ai-humanizer': '🧑‍💻',
  'essay-writer': '✍️', 'assignment-writer': '📚', 'notes-generator': '🗒️',
  'mcq-generator': '❓', 'research-summarizer': '🔬', 'resume-analyzer': '📊',
  'cover-letter-generator': '💼', 'qr-generator': '🔳', 'barcode-generator': '🏷️',
  'searchable-pdf': '🔍', 'delete-pages': '🗑️', 'page-numbers': '🔢',
  'watermark': '💧', 'fill-sign': '✒️', 'unlock-pdf': '🔓', 'pdf-metadata': '🏷️',
  'reorder-pdf': '🔀', 'pdf-editor': '🖊️', 'pdf-organizer': '🗂️',
  'inheritance-calc': '☪️', 'inheritance-calc-advanced': '☪️',
  'age-calc': '📅', 'bmi-calc': '⚖️', 'discount-calc': '🏷️',
  'compress': '🗜️', 'html-to-pdf': '🌐', 'pdf-to-ppt': '📽️', 'ppt-to-pdf': '📽️',
};

let changed = 0;

for (const name of readdirSync(TOOLS)) {
  if (!name.endsWith('.html')) continue;
  const file = join(TOOLS, name);
  let html = readFileSync(file, 'utf8');

  const re = /<h2>Related Tools<\/h2>\s*<p>([\s\S]*?)<\/p>/;
  const m = html.match(re);
  if (!m) continue;

  const links = [...m[1].matchAll(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  if (!links.length) continue;

  const cards = links.map(([, href, label]) => {
    const slug = href.replace(/^.*\//, '').replace(/\.html$/, '');
    const icon = ICONS[slug] || '🔧';
    return `    <a href="${href}" class="related-tool-card"><span class="rtc-icon">${icon}</span>${label.trim()}</a>`;
  }).join('\n');

  html = html.replace(re, `<h2>Related Tools</h2>\n    <div class="related-tools-grid">\n${cards}\n    </div>`);
  writeFileSync(file, html);
  changed++;
  console.log(`✓ ${name}`);
}

console.log(`\nDone — restyled Related Tools on ${changed} page(s).`);
