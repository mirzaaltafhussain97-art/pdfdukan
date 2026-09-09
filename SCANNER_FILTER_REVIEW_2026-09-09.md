# Scanner editor and filters

The editor now displays a page strip, central document and two-column SVG filter controls. On a 390px viewport the strip becomes horizontal and filters use three columns. Comparison and fine adjustment controls are collapsible. Filter controls are keyboard-accessible buttons with selected states.

Magic Pro applies a gradual ink contrast curve. B&W normalizes paper highlights before thresholding; the previous treatment removed thin text in the supplied paper photo. Paper and card were inspected in the browser, including the paper-to-card add-page flow. This is not evidence of equivalence to CamScanner's proprietary processing or complete dashboard features.

Performance changes remove nine thumbnail filter jobs per editor opening, skip obsolete queued previews and precompute horizontal interpolation coefficients. Full-resolution filtering/export and the existing heavy-engine fallbacks remain. Renderer tests verified unchanged dimensions, cache reuse and obsolete-work rejection. All nine presets passed offline dimension/alpha checks; saved-pixel comparison passed after interpolation optimization, and B&W retained a thin gray test line. These tests do not establish mobile performance scores or CamScanner speed parity.

Known limits: the rail shows page context, with editing/reordering still on the Pages screen. Four-corner crop does not remove fingers or flatten curved paper. Some tint and fine-detail differences remain against CamScanner. Handwriting removal and book dewarping are not implemented.
