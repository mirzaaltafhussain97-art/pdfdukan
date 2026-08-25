// One-time cleanup of legacy template claims that were broader than the
// browser-only implementation can prove. Visible FAQ text is synchronized to
// JSON-LD separately by sync-visible-faq-schema.mjs.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'public');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const file = join(dir, name);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
}

const replacements = new Map([
  [
    'Yes. PDFdukan is 100% free with no hidden charges, no subscription, and no credit card required.',
    'This tool is currently free to use without a subscription, credit card or account.',
  ],
  [
    'No. All processing happens entirely inside your browser using JavaScript. Your files never leave your device and are never seen by any server.',
    'Core file processing runs in your browser rather than being sent to PDFdukan for conversion. The page can still request normal site assets, analytics and third-party libraries.',
  ],
  [
    'Yes. All PDFdukan tools work in any modern browser — Chrome, Safari, Firefox, Edge — on phones, tablets, and computers.',
    'The interface is designed for current mobile and desktop browsers. Large or complex files may exceed a device’s memory or browser limits, so verify the output on your device.',
  ],
  [
    'Yes. PDF to Word conversion on PDFdukan is 100% free — no subscription, no trial limits, no credit card, and no account required.',
    'PDFdukan currently offers this conversion without a subscription, credit card or account. Browser memory and file complexity still set practical limits.',
  ],
  [
    'No. The conversion runs entirely in your browser using JavaScript. Your document never leaves your device — important when converting confidential contracts, financial statements, or personal documents.',
    'Core conversion runs with client-side JavaScript rather than sending the selected PDF to PDFdukan for conversion. The page can still request normal site assets, analytics and third-party libraries.',
  ],
  [
    'No. PDFdukan uses mammoth.js and jsPDF — two JavaScript libraries — to read and convert your document entirely inside your browser. Your file never leaves your computer or phone. This is especially important for confidential documents like CVs with personal details, contracts, salary information, or medical reports.',
    'Core DOCX reading and PDF generation use client-side Mammoth and jsPDF. The selected document is not sent to PDFdukan for conversion, although the page can still request normal site assets, analytics and third-party libraries.',
  ],
  [
    'Yes. Converting Word to PDF on PDFdukan is 100% free with no subscription, no per-file fee, no file size cap, and no account required. You can convert as many documents as you need every day.',
    'PDFdukan currently offers this conversion without a subscription, per-file fee or account. Browser memory, document complexity and device limits determine the practical file size.',
  ],
  [
    "If you have Microsoft Word installed, using File → Save as PDF gives the most accurate result because Word renders its own file format. PDFdukan is the best alternative when you don't have Word installed, when you're on a phone, or when you need a quick conversion without opening the desktop app. For 100% formatting accuracy on complex documents, Microsoft Word's own PDF export is ideal.",
    "Microsoft Word's own PDF export usually preserves complex Word layouts most faithfully because Word renders its native format. PDFdukan is a browser-based option when Word is unavailable; always preview fonts, pagination, tables and images before relying on the result.",
  ],
  [
    'Everything runs in your browser, so the file never leaves your device.',
    'Core compression runs in your browser rather than sending the selected PDF to PDFdukan for processing. The page can still request normal site assets, analytics and third-party libraries.',
  ],
  [
    'The signed PDF is created in your browser — nothing is uploaded.',
    'Core editing and export run in your browser rather than sending the selected PDF to PDFdukan for signing. The page can still request normal site assets, analytics and third-party libraries.',
  ],
  [
    'Your signature is drawn in your browser and never leaves your device. It is embedded directly into the PDF during export.',
    'The signature is handled by the client-side editing flow and embedded in the exported PDF. Keep the downloaded file secure and verify the signature placement before sharing it.',
  ],
  [
    'The exported image is automatically straightened to your chosen angle, so a tilted region comes out perfectly upright.',
    'The exported image is rotated to the angle you selected; inspect the preview and fine-tune the handle when exact alignment matters.',
  ],
  [
    'Place your CNIC flat on a dark surface. Open CamMaster on your phone and use the camera to capture the card — the AI will detect the edges automatically. After processing, use the enhance filter for a sharp black-and-white scan. Repeat for the back side, then combine both into one PDF using Batch Mode or the Merge PDF tool .',
    'Place the card flat on a contrasting surface with even light. CamMaster will attempt to find the edges, but automatic detection can be wrong, so inspect and adjust all four crop handles. Compare the available enhancement filters, repeat for the back, and export both sides with Batch Mode or combine them with Merge PDF.',
  ],
  [
    'Free online document scanner with AI-powered enhancement.',
    'Free browser-based document scanner with assisted corner detection, manual crop correction, perspective correction and selectable readability filters.',
  ],
  [
    'CamMaster is a free online document scanner by PDFdukan. It lets you scan, crop, enhance, and convert documents to PDF directly in your web browser — no app installation required. Perfect alternative to CamScanner and other paid apps.',
    'CamMaster is a free browser-based document scanner by PDFdukan. It attempts corner detection, lets you correct the crop, compare readability filters, and export PDF or image output without installing an app. Results depend on the source photo and should be inspected.',
  ],
  [
    'Sign in is optional for all basic features. Signing in with Google lets you save documents to your Google Drive, access them from any device, and sync settings. We never access your existing Drive files.',
    'Sign-in is optional for the listed basic tools. Connecting Google Drive lets you save selected outputs to your account; the requested drive.file scope is intended for files the app creates or that you explicitly open with it. Review the destination before saving sensitive documents.',
  ],
  [
    'CamMaster uses OpenCV.js-based edge detection. Results vary with lighting, contrast, background, and camera angle. You can manually adjust the document corners when needed.',
    'CamMaster attempts an ONNX corner model with an OpenCV.js fallback. Results vary with lighting, contrast, background and camera angle, so inspect and manually adjust all four corners.',
  ],
  [
    'Input: JPG, JPEG, PNG, WEBP, and PDF. Output: PDF (single or multi-page), JPG, PNG, ZIP. All tools support standard PDF formats.',
    'CamMaster accepts supported JPG, JPEG, PNG, WebP and PDF input. It can export PDF, JPG, PNG or a ZIP for multiple images; exact options and practical limits are shown in the scanner.',
  ],
]);

let changed = 0;
for (const file of walk(ROOT).filter((name) => name.endsWith('.html'))) {
  const before = readFileSync(file, 'utf8');
  let after = before;
  for (const [oldText, newText] of replacements) {
    after = after.split(oldText).join(newText);
  }

  if (file.endsWith(join('tools', 'pdf-to-word.html'))) {
    after = after
      .replace('<strong>⚡ Instant Conversion</strong><p style="margin:6px 0 0;font-size:13px;color:var(--text-2)">No upload queues or processing wait. Conversion starts immediately and most documents finish in under ten seconds.</p>', '<strong>⚡ Browser-Based Conversion</strong><p style="margin:6px 0 0;font-size:13px;color:var(--text-2)">Conversion starts on your device after selection. Processing time varies with page count, layout complexity, embedded images and available memory.</p>')
      .replace('<strong>🆓 Free, No Limits</strong><p style="margin:6px 0 0;font-size:13px;color:var(--text-2)">Convert unlimited PDFs every day. No subscription, no daily cap, no account registration, no watermarks.</p>', '<strong>🆓 Free to Use</strong><p style="margin:6px 0 0;font-size:13px;color:var(--text-2)">No subscription or account is currently required. Browser memory and document complexity set practical limits.</p>');
  }

  if (after !== before) {
    writeFileSync(file, after, 'utf8');
    changed++;
    console.log(`normalized ${file.slice(ROOT.length + 1)}`);
  }
}

console.log(`Trust wording files changed: ${changed}`);
