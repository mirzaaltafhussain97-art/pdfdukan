// Add the generated feature visuals to tool and static/legal pages.
// Idempotent: pages carrying data-page-feature are left unchanged.

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const publicRoot = join(process.cwd(), 'public');

const tools = {
  'fill-sign': ['fill-sign.svg', 'PDF page with text fields, a drawn signature and a completion check', 'Add text or a signature, position it on the selected page, then verify the flattened output.'],
  'html-to-pdf': ['html-to-pdf.svg', 'HTML code moving through a browser print workflow into a PDF', 'Preview HTML and CSS first, then use the browser print dialog to save the rendered result as PDF.'],
  'page-numbers': ['page-numbers.svg', 'Three PDF pages receiving ordered page numbers', 'Choose the number format and position before creating a separately numbered PDF copy.'],
  'pdf-editor': ['pdf-editor.svg', 'PDF page with an editable text box, annotation control and drawing tool', 'Add visible annotations and replacement overlays, then inspect the flattened PDF output.'],
  'pdf-organizer': ['pdf-organizer.svg', 'Four PDF page thumbnails being reordered and rotated', 'Reorder, rotate or remove page thumbnails before downloading the organized copy.'],
  'pdf-to-excel': ['pdf-to-excel.svg', 'PDF content moving into a grid-based Excel workbook', 'Extract page text and table-like rows into workbook sheets, then verify the spreadsheet structure.'],
  'pdf-to-ppt': ['pdf-to-ppt.svg', 'PDF page moving into an image-based PowerPoint slide', 'Each PDF page becomes a slide image, preserving appearance rather than editable source elements.'],
  'pdf-to-word': ['pdf-to-word.svg', 'PDF text moving into an editable Word document', 'Extract readable text and images into a Word-compatible document, then review the reconstructed layout.'],
  'watermark': ['watermark.svg', 'PDF page receiving a diagonal sample watermark with opacity control', 'Set watermark text or image, opacity, angle and size before applying it to the PDF pages.'],
  'word-to-pdf': ['word-to-pdf.svg', 'Word document content moving into a fixed-layout PDF', 'Render DOCX content in the browser, compare the preview and then export the PDF.'],
};

const statics = {
  'about': ['about-product.svg', 'PDFdukan document tools connected in one browser-based product', 'A visual summary of PDFdukan’s browser-based document workflow.'],
  'contact': ['contact-support.svg', 'Support message envelope with an add-details symbol', 'Send enough detail to help reproduce a question or technical issue.'],
  'privacy': ['privacy-protection.svg', 'Document beside a shield and lock representing privacy controls', 'Privacy depends on the selected tool, browser storage and any optional connected service.'],
  'terms': ['terms-agreement.svg', 'Terms document with clearly checked clauses', 'The Terms explain permitted use, limitations and user responsibilities.'],
  'cookies': ['cookies-storage.svg', 'Browser storage illustration with a cookie and local data markers', 'Cookies and local storage support preferences, consent and selected site features.'],
  'disclaimer': ['disclaimer-verification.svg', 'Document beside a verification warning symbol', 'Automated document outputs should be checked before important use.'],
  'help': ['help-guide.svg', 'Help document beside a clear question-mark guide', 'Start with the relevant workflow guidance, then contact support if the issue continues.'],
  'press': ['press-media.svg', 'PDFdukan information sheet beside a media megaphone', 'A concise visual introduction to PDFdukan for media and reference use.'],
};

function figure(src, alt, caption, prefix='../') {
  return `\n  <figure class="page-feature-figure" data-page-feature>
    <img src="${prefix}images/${src}" width="720" height="420" loading="lazy" decoding="async" alt="${alt}">
    <figcaption>${caption}</figcaption>
  </figure>\n`;
}

function insertAfterBalancedDiv(html, marker, block) {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const tokens = /<div\b[^>]*>|<\/div>/gi;
  tokens.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tokens.exec(html))) {
    if (/^<div\b/i.test(match[0])) depth++;
    else if (--depth === 0) return html.slice(0, tokens.lastIndex) + block + html.slice(tokens.lastIndex);
  }
  return null;
}

for (const [slug, [src, alt, caption]] of Object.entries(tools)) {
  const file = join(publicRoot, 'tools', `${slug}.html`);
  let html = readFileSync(file, 'utf8');
  if (html.includes('data-page-feature')) continue;
  const block = figure(src, alt, caption);
  if (slug === 'pdf-editor') {
    html = html.replace(/(<div class="dz-sub">[\s\S]*?<\/div>)/, `$1${block}`);
  } else {
    const updated = insertAfterBalancedDiv(html, '<div class="tool-hero">', block);
    if (!updated) throw new Error(`Could not locate tool hero in ${slug}`);
    html = updated;
  }
  writeFileSync(file, html, 'utf8');
  console.log('updated tool', slug);
}

for (const [slug, [src, alt, caption]] of Object.entries(statics)) {
  const file = join(publicRoot, `${slug}.html`);
  let html = readFileSync(file, 'utf8');
  if (html.includes('data-page-feature')) continue;
  const block = figure(src, alt, caption, '');

  if (['about','contact','help'].includes(slug)) {
    const updated = insertAfterBalancedDiv(html, '<div class="page-hero', block);
    if (!updated) throw new Error(`Could not locate page hero in ${slug}`);
    html = updated;
  } else if (['privacy','terms','cookies'].includes(slug)) {
    const h1 = html.indexOf('<h1>');
    const metaEnd = html.indexOf('</p>', h1);
    if (h1 < 0 || metaEnd < 0) throw new Error(`Could not locate legal heading in ${slug}`);
    html = html.slice(0, metaEnd + 4) + block + html.slice(metaEnd + 4);
  } else if (slug === 'disclaimer') {
    html = html.replace(/(<p style="color:var\(--text-3\)">Last updated:[\s\S]*?<\/p>)/, `$1${block}`);
  } else if (slug === 'press') {
    html = html.replace(/(<h1>Press &amp; Media<\/h1>)/, `$1${block}`);
  }

  if (!html.includes('data-page-feature')) throw new Error(`Could not insert visual in ${slug}`);
  writeFileSync(file, html, 'utf8');
  console.log('updated static page', slug);
}

