// remove-ai-tools.mjs — removes all Gemini/AI-API-dependent tools from the site.
// Deletes the 12 tool pages, strips every link/card/nav-entry/map-entry/sitemap
// row that points at them, drops the empty "AI-Powered" section on tools.html,
// and registers 301 redirects (old URL -> /tools.html) in public/.htaccess.
// Idempotent: safe to re-run.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd(), 'public');

const TOOLS = [
  'ai-detector', 'ai-humanizer', 'ai-pdf-chat', 'ai-pdf-summarizer',
  'ai-summarize', 'assignment-writer', 'cover-letter-generator', 'essay-writer',
  'mcq-generator', 'notes-generator', 'research-summarizer', 'resume-analyzer',
];
const ALT = TOOLS.map(t => t.replace(/[-]/g, '\\-')).join('|');
// openTool() ids used on the homepage cards == the tool basenames
const IDS = [...TOOLS, 'ai-summarize'].map(t => t.replace(/[-]/g, '\\-')).join('|');

// 1) anchor (link/card/nav-entry) removal — non-nested, tolerates nested divs/spans
const ANCHOR = new RegExp(
  `<a\\b[^>]*href="[^"]*(?:${ALT})\\.html"[^>]*>(?:(?!</a>)[\\s\\S])*?</a>\\s*`,
  'g'
);
// homepage tool-card divs use onclick="openTool('id')" (no href). Each card ends
// with its <span class="tc-badge">…</span> right before the wrapper </div>.
const CARD = new RegExp(
  `<div class="tool-card[^"]*"[^>]*onclick="openTool\\('(?:${IDS})'\\)"[^>]*>` +
  `[\\s\\S]*?<span class="tc-badge"[^>]*>[^<]*</span>\\s*</div>\\s*`,
  'g'
);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT);
let changed = 0;

for (const f of files) {
  const rel = path.relative(ROOT, f);
  const ext = path.extname(f).toLowerCase();
  if (!['.html', '.xml', '.js', '.txt'].includes(ext)) continue;
  // don't bother rewriting the doomed tool pages themselves
  if (ext === '.html' && TOOLS.some(t => rel.endsWith(`${t}.html`))) continue;

  let src = fs.readFileSync(f, 'utf8');
  const before = src;

  if (ext === '.html') {
    src = src.replace(ANCHOR, '');
    src = src.replace(CARD, '');
    // index.html: drop the all-AI "AI Study Tools" section wholesale
    src = src.replace(
      /<!--[^>]*-->\s*<section aria-label="AI Study Tools for Students">[\s\S]*?<\/section>\s*/g,
      ''
    );
    src = src.replace(
      /<section aria-label="AI Study Tools for Students">[\s\S]*?<\/section>\s*/g,
      ''
    );
    // index.html: drop the "Career & Writing AI" label + now-empty grid
    src = src.replace(
      /(?:<!--[^>]*-->\s*)?<div class="tool-category-label">[^<]*Career[^<]*<\/div>\s*<div class="tools-grid"[^>]*>\s*<\/div>\s*/g,
      ''
    );
    // tools.html: drop the now-empty "Free AI-Powered Tools" section
    src = src.replace(
      /<div class="category-section" id="cat-ai">\s*<h2[^>]*>[^<]*<\/h2>\s*<div class="big-tools-grid">\s*<\/div>\s*<\/div>\s*/g,
      ''
    );
  } else if (ext === '.xml') {
    // sitemap rows are one <url>…</url> per line
    src = src.split('\n').filter(
      line => !TOOLS.some(t => line.includes(`/${t}.html`))
    ).join('\n');
  } else if (ext === '.js') {
    // app.js tool-map entries + header.js nav-link concat lines + app.js
    // search-index objects ({ id:'…' }) for the AI tools
    const idLine = new RegExp(`\\bid:'(?:${IDS})'`);
    src = src.split('\n').filter(line =>
      !TOOLS.some(t => line.includes(`tools/${t}.html`)) && !idLine.test(line)
    ).join('\n');
    // drop the now-orphaned "AI tools (… Gemini)" comment in app.js
    src = src.replace(/^\s*\/\*[^\n]*AI tools[^\n]*Gemini[^\n]*\*\/\s*\n/gm, '');
    // i18n.js: strip orphaned 'tool.ai-summarize' / 'desc.ai-summarize' labels
    // (may be inline alongside other keys on the same line)
    src = src.replace(/'(?:tool|desc)\.ai-summarize':\s*'[^']*',?/g, '');
  } else if (ext === '.txt') {
    src = src.split('\n').filter(
      line => !TOOLS.some(t => line.includes(`/${t}.html`))
    ).join('\n');
  }

  // tidy up runs of blank lines left behind
  src = src.replace(/\n{3,}/g, '\n\n');

  if (src !== before) {
    fs.writeFileSync(f, src);
    console.log('edited  ', rel);
    changed++;
  }
}

// 2) delete the tool pages
let deleted = 0;
for (const t of TOOLS) {
  const p = path.join(ROOT, 'tools', `${t}.html`);
  if (fs.existsSync(p)) { fs.unlinkSync(p); console.log('deleted ', `tools/${t}.html`); deleted++; }
}

// 3) orphaned gemini-config.js (only the AI tools used it)
const gem = path.join(ROOT, 'js', 'gemini-config.js');
if (fs.existsSync(gem)) { fs.unlinkSync(gem); console.log('deleted ', 'js/gemini-config.js'); }

// 4) 301 redirects in .htaccess (Hostinger serves /public statically; .htaccess
//    is the layer that fires for paths once the files are gone)
const HT = path.join(ROOT, '.htaccess');
let ht = fs.existsSync(HT) ? fs.readFileSync(HT, 'utf8') : '';
const MARK = '# --- retired AI tools (API-dependent) -> tools hub ---';
if (!ht.includes(MARK)) {
  const block = ['', MARK,
    ...TOOLS.map(t => `Redirect 301 /tools/${t}.html /tools.html`)
  ].join('\n') + '\n';
  ht = ht.replace(/\s*$/, '\n') + block;
  fs.writeFileSync(HT, ht);
  console.log('edited   .htaccess (+12 redirects)');
}

console.log(`\nDone. ${changed} files edited, ${deleted} tool pages deleted.`);
