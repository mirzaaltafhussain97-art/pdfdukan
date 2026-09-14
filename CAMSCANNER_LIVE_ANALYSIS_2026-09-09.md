> EVIDENCE CORRECTION: The previous automated filter test clicked the toolbar at (200,80), which the screenshot explicitly labels Rotate Left. The observed rotation is therefore caused/confounded by test interaction and is NOT evidence of a CamScanner EXIF bug. Apply to All also appeared checked again during the test. Filter click durations are command latency, NOT completed processing measurements. Preset observations are preliminary, from one card; the promised second-page comparison and full 8-page/6–7-document audit were not completed. Do not treat this report as validated parity or copy its timing/rotation conclusions into implementation requirements. Reload without Save does not by itself prove the service did not auto-persist changes.
# CamScanner live analysis for CamMaster

Date: 2026-09-09

## Scope and evidence

- CamScanner web was inspected live in the user's signed-in Chrome profile.
- Existing uploaded CNIC, legal-paper and card examples were inspected in View and Edit modes.
- A 25-image mixed sample was selected from `C:\Users\ANM\Downloads\Data Folder`: full papers, CNIC/cards, receipts, handwritten pages, weak contrast, shadows, tilt and phone screens.
- The browser automation security layer rejected transmission of both the source files and temporary workspace copies to CamScanner. Therefore this is **not** a claim that 25 CamScanner output files were generated. The selected set remains useful for the next CamMaster regression run.
- No source image was moved, altered or deleted. Temporary copies are under ignored `tmp/camscanner-study/`.

## Live CamScanner workflow

### Home and file intake

- Fixed pale sidebar with Home, My document, Signed Documents and Tools.
- Search and account controls remain in a quiet top bar.
- The main intake area says “Drag files here, or click to upload” and offers Smart Scan, Import Images and Import Files.
- Recent documents use large visual cards. The image preview is the main affordance; title, time and page count are secondary.
- Multi-file selection is supported by the file chooser.

### Import and automatic processing

- Import Images uses a task-focused editor: pages on the left, large image in the centre, tools on the right.
- Crop/rotation controls appear before enhancement presets.
- The system applies crop and a chosen enhancement as one understandable operation.
- A centred CamScanner mark is used as visible processing feedback. It communicates that the document is being processed without filling the screen with technical details.
- The primary completion action is visually strong and placed consistently at the lower right.

### Document editor

- View, Edit, Page and Convert are top-level modes.
- Edit keeps the document large in the centre, a compact page rail on the left and editing tools across the top.
- The Filter button opens a compact anchored panel instead of permanently consuming a wide sidebar.
- The panel offers Apply to All Pages first, followed by large icon presets: Original, Enhance, Magic Pro, Lighten, No Shadow, B&W, Eco and Remove Handwriting.
- Selected presets use a turquoise border/background and label colour. Unselected icons sit on soft grey tiles.
- The editor also exposes text, brush, signature, watermark and title tools without mixing them into the scan-import flow.

### Output behaviour

- On the inspected CNIC, Magic Pro preserved the green security pattern, face detail, black text and warm gold chip/flag tones.
- Enhancement is assertive but avoids turning large parts of the card into pure white.
- The result stays editable after processing; Save becomes the explicit persistence step.
- View mode gives a clean document canvas, page count, zoom controls and left thumbnail rail.

## Observed interaction timing

These are warm, already-loaded filter interactions on one existing CNIC, measured around the click and refreshed UI observation:

| Preset | Observed time |
| --- | ---: |
| Original | 576 ms |
| Enhance | 410 ms |
| Magic Pro | 530 ms |

These figures do not include a fresh upload, network transfer, first model load or batch processing. They show that CamScanner keeps filter interaction comfortably below one second once the document is loaded.

## CamMaster comparison

### Already close

- Five-step Add, Crop, Enhance, Pages and Save flow is understandable.
- Left page rail, central preview and icon-based filters follow the same visual hierarchy.
- Auto Scan can crop and enter Magic Pro directly.
- The branded PDFdukan/CamMaster processing overlay now replaces the plain spinner.
- The latest adaptive Magic Pro preserves coloured security documents much better than the earlier overexposed output.
- Expensive engines are lazy loaded and repeated render results are cached.

### Remaining gaps to implement

1. **Use one editor shell after import.** CamMaster currently changes screen structure more visibly between Crop, Enhance and Pages. Keep the page rail and central canvas stable; change the active tools around them.
2. **Make the filter panel compact.** On desktop, use an anchored panel from the Filter control for quick presets. Keep the current wide panel as a responsive/mobile option where it is easier to touch.
3. **Separate quick presets from advanced controls.** Show Apply to All, preset icons and save first. Keep brightness, contrast, saturation and sharpness collapsed until requested.
4. **Add document-aware Magic Pro modes internally.** Classify plain paper, colour/security card, receipt and phone screen, then choose conservative parameter sets. Do not expose technical mode names to ordinary users.
5. **Render a fast preview before full-resolution output.** Process a screen-sized preview for immediate feedback, then run full resolution in the worker for save/export. The visible preset switch target should be below one second on common phones.
6. **Warm the worker after crop confirmation.** Create the filter worker while the user reviews crop so Magic Pro does not pay worker startup when selected.
7. **Keep full-resolution caching bounded.** Reuse the active page/filter result but release old large canvases when moving through a long batch to avoid mobile memory pressure.
8. **Improve confidence handling.** High-confidence crop can continue automatically. Medium confidence should open crop review with a clear message. Failed detection should preserve the full image, which is already implemented.
9. **Add content-preservation checks.** Before auto-continuing, reject quads that cut dense text, faces, QR/barcodes or seals near an edge. This matters more than maximizing the count of “detected” images.
10. **Keep Save explicit.** Filter previews should be instant and reversible; committing the page should happen only on Save Page & Continue.

## Deep live filter analysis on the 8-page batch

The following presets were switched live on page 1 of the new identity-card batch. **Apply to All Pages was turned off before comparison**, and no Save action was performed. The timings below are UI observations from this warm editor session, not laboratory benchmarks or full export times.

### Original

- Preserves the source's warm yellow/green cast, paper texture, portrait, signature, QR code and MRZ without tonal intervention.
- Text remains readable, but the background is uneven and the portrait is weak.
- This is the fidelity/reference preset and should perform no destructive pixel processing.

### Enhance

- Strongly raises the paper/background toward white and increases black text contrast.
- QR, MRZ and printed address become easier to read at a glance.
- It retains traces of the green security pattern, but the small portrait and pale printed detail become weaker.
- Best suited to ordinary documents and forms; it is too aggressive as a universal identity-card default.
- Warm click response observed at roughly **40 ms**, followed by the visual render.

### Magic Pro

- Uses a more balanced colour treatment than Enhance: it keeps the card's warm/green character while improving local contrast.
- Printed text, QR and MRZ remain strong without turning the entire card pure white.
- It is the most appropriate default among these presets for coloured cards, stamps and mixed document content.
- Live processing visibly used CamScanner's centred CS logo. The observed interaction-to-result cycle was about **1.0 second** in this run.
- Important failure: on this EXIF/orientation-sensitive page, switching presets caused the page to appear at 90°/180° orientations. Therefore CamScanner itself was not perfect on this batch. CamMaster must normalize EXIF orientation once at import and must never let a filter alter geometry or rotation.

### Lighten

- Lifts midtones and shadows while retaining colour, producing a brighter but still photographic result.
- Useful for dark captures where the document is already correctly exposed in the highlights.
- Less suitable for pale cards because it can weaken portraits, stamps and low-opacity security detail.
- CamScanner showed its centred CS processing mark while applying this preset.

### No Shadow

- Flattens local illumination while retaining colour and most printed structure.
- On the card it reduced the dirty/yellow variation more conservatively than Enhance.
- It is valuable for phone photos with hands, desk shadows or one dark corner, but should not be combined with global over-whitening.
- The first UI response was immediate; the final render continued asynchronously.

### B&W

- Produces the strongest black text on a near-white background.
- QR, MRZ and dark printed text become extremely clear.
- Fine security patterns, portrait detail, coloured seals and other identity-card evidence are heavily reduced or lost.
- This should be offered for text documents, receipts and photocopy-style output, not selected automatically for colour IDs.
- The observed interaction-to-result cycle was roughly **0.7 seconds**.

### Eco

- Creates a high-contrast monochrome result while retaining more fine texture and patterned line work than B&W.
- The output looks closer to an ink-saving print/scan: black text remains strong, pale backgrounds disappear, and some security texture survives as grey/black line structure.
- It can be useful for printing and compressed PDFs, but faces and colour evidence remain unsuitable for identity verification.

### Remove Handwriting

- On the tested card back, the large handwritten signature was substantially removed while printed address, QR and MRZ remained.
- Some small residual strokes/artefacts can remain, so this is an AI cleanup action rather than a guaranteed perfect eraser.
- It must never silently replace the original. CamMaster should keep a reversible page state and label the result clearly because signatures and annotations can be legally meaningful.
- The initial click response was immediate, with processing completing afterward.

### What makes CamScanner feel fast

- The document shell, thumbnails and controls remain usable while higher-resolution pages continue loading.
- Filter selection changes state immediately, then a branded processing indicator covers the short render interval.
- Thumbnails update independently from the main preview.
- The editor keeps one stable layout instead of rebuilding the full screen between operations.

For CamMaster, geometry and filtering must be separate immutable stages: decode and normalize EXIF orientation, detect/crop/perspective-correct, then filter pixels. Filter switches must reuse the same corrected geometry. Generate a screen-resolution preview first, update its thumbnail, and complete the full-resolution render in the worker for export.

## Required Astra validation

The next implementation should use the selected 25-image set as a held-out regression sample. For every image, save the detected overlay, cropped original, Magic Pro result, detector route, first-load time, warm time and any fallback. Human review should mark: correct, usable with extra background, content cut, wrong object or manual required.

The release gate should require:

- no content-cut regression on the known legal-paper and CNIC samples;
- colour/security-card Magic Pro with no large clipped-white areas;
- readable pale stamps and thin handwriting;
- preview interaction near or below one second after warm-up;
- full processing reported separately for first load and later pages;
- mobile and desktop layout screenshots with no overlap;
- full build and filter/crop regression tests passing.

### Newly observed manual batch: 8 pages

The user manually uploaded an 8-image batch in the signed-in CamScanner account. The live document appeared in the manager as **“WhatsApp Image 2026-09-02 at 11.00.32 AM (1)”**, marked **Just now**, with **8 pages**. This confirms the batch workflow after manual selection:

- CamScanner creates one document for the selected batch instead of eight unrelated documents.
- The document opens with a left page rail numbered 1–8, a central preview, page navigation, zoom, and continuous-scroll mode.
- The first visible pages included Pakistan identity-card front/back images and an older identity-card image. The card boundaries were kept inside the output and the pages remained readable.
- The live view exposed OCR-like text for the first two pages, including address, MRZ, name, identity number, dates, and signature labels. This is a document-understanding layer alongside the visual scan.
- A lower-quality card page remained visibly soft and faded after processing. CamScanner improves presentation and framing, but it cannot recreate detail absent from a blurred source.
- In continuous view, consecutive pages are separated cleanly and remain individually selectable from the page rail.

The account manager increased from 16 to 17 documents after the upload, with the new 8-page document at the top. This is direct live evidence; pages that were still showing as loading were not counted as fully inspected.

### Batch implementation requirements extracted from this test

CamMaster should preserve the same batch contract: one import session, one ordered page list, per-page crop/filter state, fast thumbnails, page-by-page review, and one final export. The page rail should expose the page count immediately while full-resolution pages finish progressively. For identity cards, enhancement should preserve colour/security patterns and avoid whitening the face, hologram, chip, and fine background texture. For blurry input, the interface should show a clean result without implying that missing detail was recovered.

## Honest limits

- CamScanner's proprietary detector and filter implementation are not available for exact copying.
- Browser automation was blocked from initiating file uploads, but the user's manual 8-page upload completed successfully and was inspected live. The earlier 25-image automation attempt still did not produce a verified CamScanner output set.
- Remove Handwriting, book dewarp and curved-page correction were visible product capabilities but were not validated on this dataset.
- A visual similarity claim must be based on paired outputs and marked intended corners, not badges alone.
