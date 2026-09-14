# Scanner review — awaiting user testing

This is a local review build, not a published release or a claim of CamScanner parity.

## Changes

- One full-resolution processing path for preview and PDF/JPG/PNG/ZIP output, with a filter worker and local fallback.
- Fixed sharpening that changed uniform brightness, Skip Crop applying a crop, incorrect active filter on re-edit, and restoring another page's crop state.
- Refined model-predicted boundaries using nearby image edges; invalid model quadrilaterals are rejected.
- Magic Pro adjusts paper tint, lifts near-neutral highlights and applies mild sharpening while retaining colour.
- Quick Scan attempts automatic crop plus Magic Pro and opens the result for review. When the ML prediction is unavailable it opens crop review. A valid prediction can still be inaccurate.

## Evidence and limits

- The supplied card photo was processed locally. The current Quick Scan UI produced a 717 × 1109 preview with Magic Pro selected, then successfully added the page and opened export settings.
- Pure image-edge regression tests passed: mean corner error 0.76 px for a synthetic straight card and 0.25 px for a synthetic perspective card. A blank input retained its original prediction. These numbers describe the synthetic tests, not accuracy on all photos.
- Earlier browser regression results covered nine filters, worker/fallback equality, preview/PNG equality, mobile overflow, page re-edit, two-page PDF and ZIP output. Those results predate the latest Quick Scan and highlight changes; they are not a complete regression of the latest build.
- In the latest interactive PDF check the app reported success but the browser download-event wait timed out. The latest PDF download is not fully verified.
- Current syntax and whitespace checks passed.

## CamScanner inspected live

Chrome access worked after the sandbox problem cleared. Inspected the supplied saved card, Magic Pro preview, crop controls, Page, Convert, and Tools catalog. Temporary Magic Pro changes were discarded using Don't Save; no saved document was overwritten.

Observed features include original/enhance/Magic Pro/lighten/B&W/eco presets, rotation and flip controls, auto/manual crop, apply-to-all, text/brush/sign/watermark/title controls, page extract/split/insert/reorder, and text/Word/Excel/PPT/PDF conversion entries. No Shadow and Remove Handwriting displayed restriction icons. Menu availability is not proof of successful end-to-end operation.

Fresh Import Images testing was blocked when the Chrome extension file chooser returned Not allowed. The extension's file-URL permission needs user action. Local in-app uploading worked. The saved-document crop test did not demonstrate successful auto-detection, so fresh import auto-crop comparison remains pending.

## Remaining gaps

- No claim of identical crop, colour, sharpness or OCR accuracy. A later paper example includes an exported CamScanner reference; no pixel-equivalence claim has been established.
- Integrated multipage searchable OCR, book dewarping, handwriting removal, cloud document management and full Office fidelity have not been implemented in this change.
- Difficult boundaries, dense colour backgrounds, severe shadows, low-resolution text, large batches and physical-phone behaviour still need broader validation.
- User should test original card and other documents with Quick Scan, inspect small Urdu text/QR/stamps/edges, compare PNG and PDF downloads, and report issues before final approval.

Source photos and derived review images stay under tmp; they were not added to public assets. Unrelated existing Word-to-PDF/config changes were preserved.

## Paper-on-board correction (latest review)

Added an independent pale-paper component detector with area, convexity, boundary-support and prior-size checks. This addresses the supplied paper-on-cardboard photo where the older fallback selected the map and board. Partial edge occlusion is accepted only with strong opposite-side evidence and high paper coverage. The badge identifies paper detection separately from ML detection. Versioned scripts prevent the browser from reusing earlier code.

The first live browser attempt still rejected the paper despite the offline test passing. Browser resampling and the partly hidden/curved left edge produced insufficient boundary support. The guarded occlusion rule corrected this; live crop handles now follow the paper, without manually moving them. The processed preview is 923 x 1454 pixels. The prior coloured card also reached Magic Pro automatically and retained both its white and coloured portions.

Validation: JavaScript syntax checks; synthetic straight/perspective edge tests; blank and small-patch rejection; supplied paper offline overlay; live browser paper crop and Magic Pro; prior-card Quick Scan. These are focused checks, not a broad accuracy benchmark.

Remaining visible differences: slightly curved physical paper cannot be perfectly represented by four straight edges; small finger portions, a narrow top-edge sliver and some lower-page colour remain. Magic Pro is not equivalent to the supplied CamScanner output. No publication or final approval has occurred.
