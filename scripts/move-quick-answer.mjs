// move-quick-answer.mjs — move the AEO "Quick Answer" box from between the
// hero and the tool (where it pushes the tool below the fold) to just above
// the SEO content section, i.e. below the working tool area.
//
// Idempotent: pages where the box already sits right before the SEO section
// are skipped. Usage: node scripts/move-quick-answer.mjs

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const TOOLS = join(process.cwd(), 'public', 'tools');
let moved = 0;

for (const name of readdirSync(TOOLS)) {
  if (!name.endsWith('.html')) continue;
  const file = join(TOOLS, name);
  let html = readFileSync(file, 'utf8');

  const qa = html.match(/[ \t]*<div class="quick-answer"[\s\S]*?<\/div>\s*\n/);
  if (!qa) continue;

  // Anchor = start of the tag that contains the first "seo-section" class
  const seoIdx = html.indexOf('seo-section');
  if (seoIdx === -1) { console.error(`✗ ${name}: no seo-section anchor`); continue; }
  const tagStart = html.lastIndexOf('<', seoIdx);

  // Already below the tool? (box ends within 5 chars of the seo anchor tag)
  const qaEnd = qa.index + qa[0].length;
  if (qa.index > tagStart - 5 || /^\s*$/.test(html.slice(qaEnd, tagStart))) {
    console.log(`= ${name}: already in place`); continue;
  }

  html = html.slice(0, qa.index) + html.slice(qaEnd);
  const newTagStart = html.lastIndexOf('<', html.indexOf('seo-section'));
  const block = qa[0].replace(/\s+$/, '') + '\n\n';
  html = html.slice(0, newTagStart) + block + '  ' + html.slice(newTagStart);

  writeFileSync(file, html);
  moved++;
  console.log(`✓ ${name}: quick-answer moved below tool`);
}

console.log(`\nDone — moved on ${moved} page(s).`);
