# OCR comparison report — 12 September 2026

## Scope

This review compares the user-provided CamScanner result with its original image and inspects the live PDFdukan OCR page. The paired files were:

- Input: `C:\Users\ANM\Downloads\TT\Input Sample Sample.jpeg` (302,855 bytes)
- CamScanner output: `C:\Users\ANM\Downloads\Output Result of Sample.docx` (25,964 bytes)

The original image and the supplied output were read only. No Windows files or project files were deleted, moved, or overwritten.

## What the CamScanner output did well

The output reconstructed the page as editable document content rather than returning only a picture. It preserved the main hierarchy: the FPSC heading, exam title, boxed instructions, `PART-II`, Q2 and Q3 headings, question marks, marks, and paragraph blocks. It also produced a Word table, which indicates that the page structure was interpreted rather than flattened into one uninterrupted line.

For this printed English page, most ordinary words and sentences were recognisable. The output is therefore useful as a first OCR draft and substantially better than a raw image-only workflow.

## Verified accuracy issues in the supplied CamScanner DOCX

The result is not 99% exact on this sample. The following issues were directly visible in extracted DOCX text:

1. **Character recognition:** `FEDEKAL PUBLIC SERVICE COMMISSION` was produced instead of `FEDERAL PUBLIC SERVICE COMMISSION`; `pre-emmptive` appeared where the source reads `pre-emptive`.
2. **Unicode and punctuation:** several curly quotes and apostrophes became replacement characters such as `�`, including `pr�cis`, `�independence�`, `�annex�`, `Grandfather�s`, and `�freedom fries�`.
3. **Word spacing:** examples include `long,beautifully`, `objective.The`, `arrivalof`, and `bringingrelief` where spaces were lost.
4. **Document fidelity:** the DOCX is editable and structured, but OCR text extraction alone cannot guarantee that every visual line break, typographic quote, dash, table boundary, or page-level position matches the source.

These are small relative to the total page, but they affect names, punctuation, searchability, and copy/paste quality. An honest product claim should describe this as strong OCR with review required, rather than a universal fixed accuracy percentage.

## PDFdukan OCR page inspected

The live page at `https://pdfdukan.com/tools/ocr.html` exposes a sensible control surface:

- one JPG/PNG/WEBP image per run, up to 30 MB and 40 megapixels;
- language selection including English, Urdu, Arabic, English + Urdu, and English + Arabic;
- image treatment choices: original pixels, document contrast, and grayscale;
- layout choices: automatic page, single text block, single column, sparse text/screenshot, and one text line;
- editable result, copy, and UTF-8 TXT export;
- browser worker processing using Tesseract.js, with language data downloaded when needed.

The page correctly explains that sharpness, blur, page structure, script, and language selection affect recognition. It also states that the image pixels are intended to remain in the browser while engine and language resources are fetched from CDNs.

## Live upload limitation

The requested TT sample was selected as the test candidate, but the connected Chrome extension refused the automated file-chooser `setFiles` operation. The page remained at its initial state with `Extract Text` disabled, so there is no valid live OCR output to score from that attempt. I have not represented a guessed or locally fabricated result as a live result.

## Required implementation direction for a CamScanner-level OCR workflow

1. Keep the original image path untouched and create an OCR working copy.
2. Apply page flattening, orientation correction, border removal, illumination correction, and resolution-aware preprocessing before recognition.
3. Choose language and layout automatically from the page, while keeping the visible manual selectors as overrides.
4. Preserve UTF-8 throughout worker messages, result fields, clipboard output, and TXT/DOCX export. Never replace a character with `�` silently.
5. Reconstruct paragraphs and columns using line geometry, but avoid aggressive word joining. A spacing correction must be confidence-gated and reversible.
6. Add confidence and review cues for uncertain words, especially names, numbers, dates, IDs, punctuation, and Urdu/Arabic text.
7. Test against the whole TT folder across clean scans, photographed pages, mixed scripts, blur, perspective, shadows, tables, and sparse text before claiming production accuracy.
8. Measure character accuracy, word accuracy, spacing accuracy, layout retention, and processing time separately. A single percentage hides the cases that matter most.

## Conclusion

CamScanner’s supplied DOCX demonstrates the target workflow and structure, but this sample itself contains recognition, Unicode, and spacing errors. PDFdukan already has the right OCR control categories; the next Astra implementation should focus on preprocessing, layout reconstruction, Unicode-safe export, confidence-guided correction, and a measured TT-folder benchmark. The live PDFdukan upload could not be completed through the connected browser file chooser, so a live-versus-live accuracy conclusion is intentionally pending.
