/**
 * AEO FAQ Upgrade — replaces generic 4-question FAQ with tool-specific
 * AEO-structured Q&A on 16 tool pages.
 * Teacher Tahir framework: each page must answer
 * "What is it? Who needs it? What problem does it solve?"
 * Run: node scripts/aeo-faq-upgrade.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dir, '../public');

// Tool-specific AEO FAQ data
// Each entry: { file, title, what, who, problem, specific[], schema[] }
const TOOLS = [
  {
    file: 'tools/compress-pdf.html',
    title: 'PDF Compressor',
    what: 'PDFdukan\'s PDF Compressor reduces the file size of a PDF document while keeping the content readable. It works entirely in your browser — no file is uploaded to any server.',
    who: 'Students sending assignments via email, professionals sharing reports, and anyone whose PDF is too large to upload to a government portal or email attachment limit.',
    problem: 'Large PDFs are rejected by email servers (Gmail limits attachments to 25MB), university portals, and job application forms. This tool shrinks PDFs so they pass any file-size limit.',
    specific: [
      { q: 'How much can this tool reduce my PDF size?', a: 'Depending on content, file size typically reduces by 30–70%. PDFs with large embedded images compress the most. Text-only PDFs compress less because text is already compact.' },
      { q: 'Does compressing a PDF reduce image quality?', a: 'Mild compression reduces quality slightly but keeps text sharp and readable. The tool balances size reduction with readability. For archiving, use lower compression; for email sharing, higher compression is fine.' },
      { q: 'What is the maximum PDF size I can compress?', a: 'Because processing happens in your browser, the limit depends on your device\'s available RAM. Most modern phones and laptops handle PDFs up to 50MB without issues.' },
    ],
  },
  {
    file: 'tools/pdf-to-img.html',
    title: 'PDF to JPG Converter',
    what: 'This tool converts each page of a PDF into a high-quality JPG image. You can download images individually (one per page) or as a ZIP archive. All processing happens in your browser.',
    who: 'Designers extracting page previews, students sharing a single page as an image, social media users posting document content, and anyone who needs a PDF page as a picture.',
    problem: 'PDFs cannot be viewed on all platforms or inserted into presentations and social posts as images. Converting PDF pages to JPG makes them universally shareable.',
    specific: [
      { q: 'Can I extract just one page instead of the whole PDF?', a: 'Yes. After upload, each page appears as a thumbnail with its own download button. Click the download icon on any specific page to save just that page as a JPG.' },
      { q: 'What resolution will the output JPG be?', a: 'Pages are rendered at 150 DPI by default, which is sharp enough for screen sharing and most print uses. For very large PDFs, your browser\'s available memory affects the maximum quality.' },
      { q: 'Will the text in my PDF be readable in the JPG?', a: 'Yes. Text, graphics, and images from the PDF are all rendered into the JPG at high quality. The output is a pixel-perfect screenshot of each page.' },
    ],
  },
  {
    file: 'tools/pdf-to-word.html',
    title: 'PDF to Word Converter',
    what: 'This tool converts a PDF file into an editable Word document (.docx). It extracts text, attempts to preserve formatting, and produces a file you can open in Microsoft Word or Google Docs.',
    who: 'Anyone who received a PDF they need to edit — employees editing contracts, students modifying submitted forms, and professionals updating old PDF reports.',
    problem: 'PDFs are read-only by design. When you need to edit a PDF\'s content, you must first convert it to a Word document. This tool does that conversion instantly, for free.',
    specific: [
      { q: 'How accurate is the conversion from PDF to Word?', a: 'Text extraction is highly accurate for most PDFs. Complex layouts with multiple columns, tables, or special fonts may need minor manual cleanup after conversion.' },
      { q: 'Can it convert scanned PDFs (images) to Word?', a: 'For scanned PDFs, use the OCR tool first to extract text, then copy that text into a Word document. The PDF to Word tool works best on PDFs with selectable (digital) text.' },
      { q: 'Will my formatting be preserved?', a: 'Basic formatting (bold, italics, font size, paragraphs) is preserved. Complex multi-column layouts or embedded graphics may not transfer perfectly — the result depends on how the original PDF was created.' },
    ],
  },
  {
    file: 'tools/word-to-pdf.html',
    title: 'Word to PDF Converter',
    what: 'This tool converts a Microsoft Word document (.docx) into a PDF file. The conversion happens in your browser — your document is never uploaded to any server.',
    who: 'Job applicants submitting CVs, students submitting assignments, and professionals sharing documents that must not be edited by the recipient.',
    problem: 'Word documents look different on different computers and can be accidentally edited. Converting to PDF locks the layout and makes the document look identical on every device.',
    specific: [
      { q: 'Does it support .doc (older Word format) files?', a: 'The tool is optimised for .docx (Word 2007 and later). Older .doc files may need to be re-saved as .docx in Microsoft Word or Google Docs first.' },
      { q: 'Will my images and tables be included?', a: 'Yes. Images, tables, headings, and most Word formatting are included in the output PDF. Very complex templates or embedded charts may vary.' },
      { q: 'Is there a page limit for the Word file?', a: 'No fixed page limit. The practical limit is your device\'s memory. Documents up to 100 pages convert reliably on any modern device.' },
    ],
  },
  {
    file: 'tools/split-pdf.html',
    title: 'PDF Splitter',
    what: 'This tool splits a PDF into separate files — either every page as its own PDF, or custom ranges you define. It works entirely in your browser with no upload.',
    who: 'Anyone who receives a long merged PDF and needs to extract specific pages — a single contract from a batch, one chapter from an e-book, or one form from a multi-form PDF.',
    problem: 'When a PDF contains many documents merged together, you cannot easily share just one part. This tool lets you extract exactly the pages you need.',
    specific: [
      { q: 'Can I extract a specific page range, not the whole PDF?', a: 'Yes. You can define any range (e.g. pages 3–7) and the tool extracts only those pages into a new PDF.' },
      { q: 'Can I split a PDF into every individual page?', a: 'Yes. The "Split every page" option creates one separate PDF file per page, packaged into a ZIP archive for download.' },
      { q: 'What is the maximum number of pages I can split?', a: 'No hard limit — it depends on your device\'s RAM. PDFs up to 200 pages split reliably on most devices.' },
    ],
  },
  {
    file: 'tools/excel-to-pdf.html',
    title: 'Excel to PDF Converter',
    what: 'This tool converts Excel spreadsheets (.xlsx) into PDF documents. The layout of your spreadsheet is preserved in the output PDF.',
    who: 'Accountants sharing financial reports, students submitting data assignments, and anyone who needs to share a spreadsheet that cannot be edited.',
    problem: 'Excel files require Microsoft Excel or Google Sheets to open. PDFs open on any device without software. Converting your Excel file to PDF ensures anyone can view it as intended.',
    specific: [
      { q: 'Will all my spreadsheet columns fit on the PDF page?', a: 'The tool fits your spreadsheet data onto A4 pages. Very wide spreadsheets may be scaled down or split across multiple pages. For best results, set your Excel print area before converting.' },
      { q: 'Does it convert charts and graphs?', a: 'Yes. Charts, graphs, and images embedded in the spreadsheet are included in the PDF output.' },
      { q: 'Can it convert multiple sheets at once?', a: 'The tool converts the active (first) sheet by default. For multi-sheet workbooks, export each sheet separately.' },
    ],
  },
  {
    file: 'tools/pdf-to-excel.html',
    title: 'PDF to Excel Converter',
    what: 'This tool extracts tables from a PDF and converts them into an Excel (.xlsx) spreadsheet, letting you edit, sort, and calculate the data.',
    who: 'Finance professionals re-using PDF reports in Excel, data analysts extracting table data, and students working with PDF-based datasets.',
    problem: 'Data locked inside a PDF cannot be sorted, filtered, or calculated. This tool extracts the table data so you can work with it in Excel or Google Sheets.',
    specific: [
      { q: 'What if my PDF has multiple tables on one page?', a: 'The tool extracts all detected tables from the PDF. Each table is output to a separate sheet in the Excel file.' },
      { q: 'Does it work on scanned PDFs?', a: 'Scanned PDFs (image-only) need OCR processing first. Use the OCR tool to extract the text, then manually paste it into Excel. PDF to Excel works best on digital/searchable PDFs.' },
      { q: 'Will the column structure be preserved?', a: 'For well-structured PDFs with clearly defined table borders, column alignment is preserved accurately. Loosely formatted tables may need minor adjustment after conversion.' },
    ],
  },
  {
    file: 'tools/ppt-to-pdf.html',
    title: 'PowerPoint to PDF Converter',
    what: 'This tool converts PowerPoint presentations (.pptx) into PDF documents. Each slide becomes a page in the PDF, preserving your design exactly.',
    who: 'Students submitting presentations, speakers sharing slide decks with audiences, and professionals sending presentations that must not be editable.',
    problem: 'PowerPoint files may display differently on computers without Microsoft Office installed. A PDF presentation looks identical on every device and screen size.',
    specific: [
      { q: 'Will animations and transitions appear in the PDF?', a: 'Animations and transitions are not included in the PDF — each slide is captured in its final static state. This is standard behaviour for PDF exports from any tool.' },
      { q: 'Does it support .ppt (older format) files?', a: 'The tool is optimised for .pptx (PowerPoint 2007+). Convert older .ppt files to .pptx first in Microsoft PowerPoint or Google Slides.' },
      { q: 'What happens to speaker notes?', a: 'Speaker notes are not included in the current output. Only the slide content is exported to PDF.' },
    ],
  },
  {
    file: 'tools/pdf-to-ppt.html',
    title: 'PDF to PowerPoint Converter',
    what: 'This tool converts a PDF file into a PowerPoint presentation (.pptx). Each page of the PDF becomes a slide in the output presentation.',
    who: 'Presenters who received a PDF report and need to turn it into slides, and professionals re-purposing existing PDF content for presentations.',
    problem: 'PDFs cannot be edited or presented slide-by-slide. Converting to PowerPoint lets you edit content, add animations, and present in slideshow mode.',
    specific: [
      { q: 'Can I edit the text in the converted PowerPoint?', a: 'Each PDF page is embedded as an image slide. Text is part of the image and not directly editable. For editable text, use the PDF to Word tool first, then copy content into slides manually.' },
      { q: 'How many pages can I convert at once?', a: 'No fixed limit — large PDFs (100+ pages) may take a few seconds. Processing happens in your browser so speed depends on your device.' },
      { q: 'What is the output slide size?', a: 'Slides are set to standard 16:9 widescreen (1920×1080 equivalent). PDF pages are scaled to fit.' },
    ],
  },
  {
    file: 'tools/watermark.html',
    title: 'PDF Watermark Tool',
    what: 'This tool adds a custom text watermark to every page of a PDF. You can control the text, colour, size, opacity, and position. No upload required.',
    who: 'Businesses protecting confidential documents, photographers watermarking portfolios, educators stamping draft assignments, and anyone marking PDFs as "Confidential" or "Draft".',
    problem: 'Shared PDFs can be misused or distributed without permission. Adding a watermark signals ownership and discourages unauthorised redistribution.',
    specific: [
      { q: 'Can I customise the watermark text, colour, and position?', a: 'Yes. You can set any text (e.g. "CONFIDENTIAL", your company name, or a date), choose the colour, adjust opacity from 10–100%, set font size, and position it diagonally, horizontally, or in a corner.' },
      { q: 'Will the watermark appear on every page?', a: 'Yes. The watermark is applied to every page in the PDF automatically.' },
      { q: 'Can the watermark be removed by the recipient?', a: 'A basic text watermark can be removed by someone with PDF editing software. For stronger protection, combine the watermark with PDF password locking.' },
    ],
  },
  {
    file: 'tools/delete-pages.html',
    title: 'Delete PDF Pages Tool',
    what: 'This tool lets you remove specific pages from a PDF. Select the pages you want to delete and download the cleaned PDF — all in your browser.',
    who: 'Anyone who received a PDF with unwanted pages — blank pages, cover pages, advertisements, or confidential pages they want removed before sharing.',
    problem: 'A PDF with unnecessary pages wastes space and may contain content you should not share. This tool removes those pages without affecting the rest of the document.',
    specific: [
      { q: 'Can I delete multiple non-consecutive pages at once?', a: 'Yes. Select any combination of pages — for example, pages 1, 3, and 7 — and delete them all in one step.' },
      { q: 'Will removing pages affect the remaining content?', a: 'No. Only the selected pages are removed. All other pages remain unchanged, including their formatting, images, and text.' },
      { q: 'Can I preview pages before deleting?', a: 'Yes. Each page is shown as a thumbnail after upload so you can confirm which pages to remove before downloading.' },
    ],
  },
  {
    file: 'tools/page-numbers.html',
    title: 'Add Page Numbers to PDF',
    what: 'This tool adds page numbers to a PDF document. You can choose the position (top/bottom, left/right/centre) and the starting number.',
    who: 'Students formatting thesis documents, professionals adding page references to reports, and anyone preparing a PDF for printing or formal submission.',
    problem: 'PDFs created from images or merged from multiple sources often lack page numbers. Reviewers and readers need page numbers to navigate and reference content.',
    specific: [
      { q: 'Can I choose where the page number appears?', a: 'Yes. Position options include top-left, top-centre, top-right, bottom-left, bottom-centre, and bottom-right.' },
      { q: 'Can I start numbering from a page other than 1?', a: 'Yes. You can set any starting number, for example if the first pages are a cover and table of contents and you want numbering to begin from page 3.' },
      { q: 'Can I exclude the first page from numbering?', a: 'Yes. An option lets you skip the first page so your cover page does not get a number.' },
    ],
  },
  {
    file: 'tools/fill-sign.html',
    title: 'Fill & Sign PDF Tool',
    what: 'This tool lets you fill in text fields on a PDF form and add your signature. The signed PDF is created in your browser — nothing is uploaded.',
    who: 'Anyone who receives a PDF form to complete — job applicants, tenants signing lease agreements, students filling admission forms, and professionals signing contracts.',
    problem: 'PDF forms normally require Adobe Acrobat to fill in and sign. This tool removes that requirement — fill and sign any PDF form for free, on any device.',
    specific: [
      { q: 'How do I add my signature?', a: 'Draw your signature with your finger (on mobile) or mouse, type your name in signature style, or upload an image of your signature. Place it anywhere on the PDF.' },
      { q: 'Is my signature secure?', a: 'Your signature is drawn in your browser and never leaves your device. It is embedded directly into the PDF during export.' },
      { q: 'Can I fill text fields that are not interactive form fields?', a: 'Yes. If the PDF does not have clickable form fields, you can still add text boxes anywhere on the page manually, just like a sticky note.' },
    ],
  },
  {
    file: 'tools/html-to-pdf.html',
    title: 'HTML to PDF Converter',
    what: 'This tool converts a web page or HTML code into a PDF document. Paste HTML or enter a URL and download the result as a PDF.',
    who: 'Developers saving web page output, businesses archiving online invoices and receipts, and anyone who needs a permanent PDF copy of a web page.',
    problem: 'Web pages change over time and "Print to PDF" from browsers can have inconsistent results. This tool gives you a clean, reliable PDF from any HTML content.',
    specific: [
      { q: 'Can I convert an entire website or just one page?', a: 'This tool converts a single page or HTML code at a time. For multi-page websites, convert each page separately.' },
      { q: 'Will CSS styles and images be included?', a: 'For pasted HTML, only inline CSS is reliably included. For best results with styled pages, use your browser\'s built-in "Print > Save as PDF" feature.' },
      { q: 'Can I convert a URL directly?', a: 'Depending on your browser\'s security settings, external URLs may be restricted. Pasting the HTML source code directly is the most reliable method.' },
    ],
  },
  {
    file: 'tools/ai-summarize.html',
    title: 'AI Text Summarizer',
    what: 'This AI tool reads a block of text and generates a concise summary. It uses AI to identify the key points and condenses them into a shorter version.',
    who: 'Students summarising research papers, professionals digesting long reports, and anyone who needs to quickly understand a large block of text.',
    problem: 'Reading long documents takes time. This tool extracts the essential information so you understand the core content in seconds without reading everything.',
    specific: [
      { q: 'How long can the text I paste be?', a: 'The tool handles texts up to several thousand words. Very long texts are automatically chunked and summarised in sections.' },
      { q: 'How accurate is the AI summary?', a: 'The AI captures main points accurately for most texts. For technical, legal, or medical content, always verify the summary against the original before relying on it.' },
      { q: 'Can I summarise content in languages other than English?', a: 'The tool works best with English. Other languages may produce lower-quality summaries depending on the AI model\'s training data.' },
    ],
  },
  {
    file: 'tools/pdf-editor.html',
    title: 'PDF Editor',
    what: 'This tool lets you view a PDF and add annotations — text boxes, highlights, and drawings — directly on the page. The annotated PDF can be downloaded.',
    who: 'Reviewers marking up documents, teachers annotating student work, and anyone who needs to add comments or corrections to a PDF without editing the original text.',
    problem: 'PDFs are not editable by default. This tool adds a layer of annotations on top of the existing content so you can mark up any PDF without changing the underlying document.',
    specific: [
      { q: 'Can I edit the existing text inside the PDF?', a: 'This tool adds annotations on top of the PDF — it does not change existing text. To edit the actual text, use the PDF to Word converter first.' },
      { q: 'Will my annotations be saved if I close the browser?', a: 'Download your annotated PDF immediately after editing. Browser tabs do not save changes automatically.' },
      { q: 'Can I add multiple text boxes on one page?', a: 'Yes. You can add as many text boxes, drawings, or highlights as you need on any page.' },
    ],
  },
];

// Shared base questions for all tools
function baseQuestions() {
  return [
    { q: 'Is this tool completely free?', a: 'Yes. PDFdukan is 100% free with no hidden charges, no subscription, and no credit card required.' },
    { q: 'Do I need to create an account?', a: 'No account is needed for basic use. Sign in only if you want to save files directly to your Google Drive.' },
    { q: 'Are my files uploaded to a server?', a: 'No. All processing happens entirely inside your browser using JavaScript. Your files never leave your device and are never seen by any server.' },
    { q: 'Does it work on mobile and tablets?', a: 'Yes. All PDFdukan tools work in any modern browser — Chrome, Safari, Firefox, Edge — on phones, tablets, and computers.' },
  ];
}

function buildSeoSection(tool) {
  const allQ = [
    { q: `What is a ${tool.title}?`, a: tool.what },
    { q: `Who needs a ${tool.title}?`, a: tool.who },
    { q: `What problem does the ${tool.title} solve?`, a: tool.problem },
    ...tool.specific,
    ...baseQuestions(),
  ];

  const faqItems = allQ.map(({ q, a }) =>
    `<div class="faq-item"><button class="faq-q" onclick="toggleFAQ(this)" aria-expanded="false">${q}</button><div class="faq-a">${a}</div></div>`
  ).join('');

  const schemaEntities = allQ.map(({ q, a }) =>
    `{"@type":"Question","name":${JSON.stringify(q)},"acceptedAnswer":{"@type":"Answer","text":${JSON.stringify(a)}}}`
  ).join(',');

  const html =
    `<section class="seo-section" style="max-width:800px;margin:24px auto;padding:0 20px">` +
    `<h2>What is the ${tool.title}?</h2>` +
    `<p>${tool.what}</p>` +
    `<h2>Who needs this tool?</h2>` +
    `<p>${tool.who}</p>` +
    `<h2>What problem does it solve?</h2>` +
    `<p>${tool.problem}</p>` +
    `<h2>How to Use</h2>` +
    `<ol><li>Upload your file.</li><li>Choose your options.</li><li>Click the action button.</li><li>Download the result.</li></ol>` +
    `<h2>Frequently Asked Questions</h2>` +
    faqItems +
    `</section>` +
    `\n<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[${schemaEntities}]}<\/script>`;

  return html;
}

// Generic old section pattern
const OLD_PATTERN = /<section class="seo-section"[^>]*>[\s\S]*?<\/section>\s*\n<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"FAQPage"[\s\S]*?<\/script>/;

let updated = 0, skipped = 0;

for (const tool of TOOLS) {
  const filePath = join(PUBLIC, tool.file);
  let html;
  try {
    html = readFileSync(filePath, 'utf8');
  } catch {
    console.log(`SKIP (not found): ${tool.file}`);
    skipped++;
    continue;
  }

  if (!OLD_PATTERN.test(html)) {
    console.log(`SKIP (pattern not found): ${tool.file}`);
    skipped++;
    continue;
  }

  const newSection = buildSeoSection(tool);
  const newHtml = html.replace(OLD_PATTERN, newSection);
  writeFileSync(filePath, newHtml, 'utf8');
  console.log(`UPDATED: ${tool.file}`);
  updated++;
}

console.log(`\nDone: ${updated} updated, ${skipped} skipped.`);
