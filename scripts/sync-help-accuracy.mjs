// Keep the visible Help answers and FAQ structured data aligned with the
// current product. This avoids stale or over-broad trust claims.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(process.cwd(), 'public', 'help.html');
const before = readFileSync(file, 'utf8');
let after = before;

const answers = new Map([
  ['How does auto edge detection work?', {
    text: 'CamMaster first attempts an ONNX document-corner model in the browser. If the model cannot load or does not return a reliable quadrilateral, an OpenCV.js multi-method fallback looks for a likely document boundary. Automatic detection can be wrong, so inspect and adjust all four crop handles before applying the crop.',
  }],
  ['What filters are available and what do they do?', {
    text: 'The current choices are Original, Enhance, Magic Pro, Lighten, No Shadow, B&W, B&W Soft, Grayscale and Eco. Each filter changes pixels differently, and no preset is best for every photo. Compare small text, names, numbers, stamps and colour details with the source before exporting.',
    html: '<ul><li><strong>Original</strong> — keeps the cropped pixels unchanged</li><li><strong>Enhance</strong> — adjusts illumination, levels and contrast</li><li><strong>Magic Pro</strong> — applies stronger shadow and readability processing with a browser fallback</li><li><strong>Lighten</strong> — brightens darker page pixels</li><li><strong>No Shadow</strong> — reduces uneven page illumination</li><li><strong>B&amp;W</strong> — creates high-contrast black-and-white output</li><li><strong>B&amp;W Soft</strong> — keeps more grey transitions than B&amp;W</li><li><strong>Grayscale</strong> — removes colour</li><li><strong>Eco</strong> — produces a lighter output intended to use less ink</li></ul><p>Compare every result with the source; a filter can improve one document and damage detail in another.</p>',
  }],
  ['Can I compress a PDF? What about images inside a PDF?', {
    text: 'Yes. Use the separate Compress PDF tool. Its presets rasterize PDF pages at selected dimensions and image quality, so selectable text, forms, links, signatures or vector detail may change. Keep the original and verify readability, page count and important document features before using the compressed copy.',
    html: 'Yes. Use the separate <a href="tools/compress-pdf.html">Compress PDF tool</a>. Its presets rasterize PDF pages at selected dimensions and image quality, so selectable text, forms, links, signatures or vector detail may change. Keep the original and verify readability, page count and important document features before using the compressed copy.',
  }],
  ["What's the maximum file size supported?", {
    text: 'There is no single guaranteed maximum because available memory, browser limits, page count, image dimensions and the selected tool all matter. If a large file is slow or the browser reports a memory error, try fewer pages, smaller source images or separate batches. Keep the original until the output has been checked.',
  }],
  ['What data does PDFdukan store about me?', {
    text: 'Basic tools may store preferences and recent document names in browser storage. Core local-processing tools do not intentionally send selected file contents to PDFdukan servers. Accounts, contact messages, analytics, third-party library downloads and optional Google Drive saves have separate data flows described in the Privacy Policy.',
    html: 'Basic tools may store preferences and recent document names in browser storage. Core local-processing tools do not intentionally send selected file contents to PDFdukan servers. Accounts, contact messages, analytics, third-party library downloads and optional Google Drive saves have separate data flows described in the <a href="privacy.html">Privacy Policy</a>.',
  }],
  ['Is CamMaster safe for sensitive documents?', {
    text: 'No website can give a blanket safety guarantee for every device or document. CamMaster core crop, filter and export processing runs in the browser, but ordinary page requests, optional Drive saves, accounts and analytics are separate. Use a trusted, updated device, inspect the destination, and avoid processing material you are not authorised to handle.',
  }],
  ['Do I need an account to use CamMaster?', {
    text: 'No. The listed basic scanner and document tools can be used without an account. Sign-in is optional and is used for account features and connecting Google Drive when you choose to save a selected output there.',
  }],
  ['What can Google Sign-In do?', {
    text: 'Google Sign-In can authenticate your PDFdukan account and request the drive.file permission used to create or access files selected through the app. When Drive is connected, you can save a chosen output to the PDFdukan folder in your Google Drive. It does not make core scanner processing server-side.',
  }],
]);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const faqMatch = after.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/i);
if (!faqMatch) throw new Error('Help FAQ schema not found');
const faq = JSON.parse(faqMatch[1]);
for (const entity of faq.mainEntity || []) {
  const replacement = answers.get(entity.name);
  if (replacement) entity.acceptedAnswer.text = replacement.text;
}
after = after.replace(faqMatch[0], `<script type="application/ld+json">${JSON.stringify(faq)}</script>`);

for (const [question, answer] of answers) {
  const pattern = new RegExp(`(<button class="faq-q"[^>]*>${escapeRegex(question)}<\\/button>\\s*<div class="faq-a">)[\\s\\S]*?(<\\/div>)`, 'i');
  const visible = answer.html || answer.text;
  if (!pattern.test(after)) throw new Error(`Visible Help answer not found: ${question}`);
  after = after.replace(pattern, `$1${visible}$2`);
}

if (after !== before) {
  writeFileSync(file, after, 'utf8');
  console.log('updated public/help.html');
}
