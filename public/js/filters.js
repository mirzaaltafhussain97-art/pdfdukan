/* ================================================================
   CamMaster — Filter Engine
   9 filters with real pixel processing (not CSS)
   Magic Pro preserves text while removing shadows
================================================================ */

const FILTERS = [
  { id: 'original',  name: 'Original',  icon: '📷' },
  { id: 'enhance',   name: 'Enhance',   icon: '✨' },
  { id: 'magicpro',  name: 'Magic Pro', icon: '🌟' },
  { id: 'lighten',   name: 'Lighten',   icon: '☀️'  },
  { id: 'noshadow',  name: 'No Shadow', icon: '🔆' },
  { id: 'bw',        name: 'B&W',       icon: '⬛' },
  { id: 'bwsoft',    name: 'B&W Soft',  icon: '🌫️' },
  { id: 'grayscale', name: 'Grayscale', icon: '🔲' },
  { id: 'eco',       name: 'Eco',       icon: '🌿' },
];

/* ── MAIN ENTRY ──────────────────────────────────────────────── */
function applyFilterToContext(ctx, w, h, filterId, adjustments = {}) {
  const { brightness = 0, contrast = 0, sharpness = 0, saturation = 0 } = adjustments;

  // ── OpenCV Magic Pro: takes a separate path (writes directly to canvas) ──
  if (filterId === 'magicpro' && window.cvReady) {
    _applyMagicProCV(ctx, w, h);
    // Apply fine-tune adjustments on top of the OpenCV result
    if (brightness !== 0 || contrast !== 0 || saturation !== 0) {
      const id2 = ctx.getImageData(0, 0, w, h);
      _applyAdjustments(id2.data, brightness, contrast, saturation);
      ctx.putImageData(id2, 0, 0);
    }
    if (sharpness > 0) _applySharpen(ctx, w, h, sharpness);
    return;  // done — don't fall through to imageData path
  }

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  switch (filterId) {
    case 'original':  break;
    case 'enhance':   _applyEnhance(data, w, h); break;
    case 'magicpro':  _applyMagicPro(data, w, h); break;  // JS fallback
    case 'lighten':   _applyLighten(data, w, h); break;
    case 'noshadow':  _applyNoShadow(data, w, h); break;
    case 'bw':        _applyBW(data, w, h); break;
    case 'bwsoft':    _applyBWSoft(data); break;
    case 'grayscale': _applyGrayscale(data, w, h); break;
    case 'eco':       _applyEco(data, w, h); break;
  }

  if (brightness !== 0 || contrast !== 0 || saturation !== 0) {
    _applyAdjustments(data, brightness, contrast, saturation);
  }

  ctx.putImageData(imageData, 0, 0);

  if (sharpness > 0) _applySharpen(ctx, w, h, sharpness);
}

/* ── 1. ENHANCE ──────────────────────────────────────────────── */
/* Three-stage pipeline — matches CamScanner "Enhance" quality:
   Stage 1: Shadow removal — large-radius normalization (rBg = H/5)
            Larger radius captures the full shadow gradient with less
            contamination from sparse ink pixels.
            Max scale capped at 2.5× to avoid over-brightening.
   Stage 2: Per-channel auto-levels — removes yellow paper cast
   Stage 3: Contrast boost → paper→white, ink→dark */
function _applyEnhance(data, w, h) {
  /* ── Stage 1: Shadow removal ──
     rBg = H/5 (was /7) → larger window better captures page-level shadow.
     Target 230 with max scale 2.5 → shadow paper lifts from ~107 to ~190+. */
  const rBg  = Math.max(55, Math.round(Math.min(w, h) / 5));
  const bgMap = _buildLocalMean(data, w, h, rBg);
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    const f = Math.min(2.5, 230 / Math.max(bgMap[px], 35));
    data[i]   = _clamp(data[i]   * f);
    data[i+1] = _clamp(data[i+1] * f);
    data[i+2] = _clamp(data[i+2] * f);
  }

  /* ── Stage 2: Per-channel auto-levels ──
     Symmetric 1% / 1% clip per R/G/B channel.
     Stretches histogram → removes colour cast from yellowish/aged paper. */
  const total  = data.length / 4;
  const cutoff = Math.ceil(total * 0.01);
  for (let ch = 0; ch < 3; ch++) {
    const hist = new Int32Array(256);
    for (let i = ch; i < data.length; i += 4) hist[data[i]]++;
    let black = 0, cum = 0;
    for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum >= cutoff) { black = v; break; } }
    let white = 255; cum = 0;
    for (let v = 255; v >= 0; v--) { cum += hist[v]; if (cum >= cutoff) { white = v; break; } }
    const scale = 255 / Math.max(1, white - black);
    for (let i = ch; i < data.length; i += 4) {
      data[i] = _clamp((data[i] - black) * scale);
    }
  }

  /* ── Stage 3: Contrast boost ──
     ×1.2 around 128 + lift +8 → clean bright document look.
     Lighter boost than Magic Pro — preserves natural colors. */
  for (let i = 0; i < data.length; i += 4) {
    data[i]   = _clamp((data[i]   - 128) * 1.2 + 136);
    data[i+1] = _clamp((data[i+1] - 128) * 1.2 + 136);
    data[i+2] = _clamp((data[i+2] - 128) * 1.2 + 136);
  }
}

/* ── 2a. MAGIC PRO — OpenCV.js path (preferred when cv is loaded) ─────
 *
 *   Pipeline (tuned + verified against real shadowed phone photos):
 *   1. Background estimate: downsample 4× → GaussianBlur 21×21 → upsample 4×
 *      (smooth illumination map that captures shadows/gradients).
 *   2. Normalise: norm = gray / bg × 220 — paper → ~210-220 everywhere,
 *      ink → ~0-40, regardless of shadow.
 *   3. HoughLinesP on the normalised image → text-line skew angle.
 *   4. Deskew the GRAYSCALE normalised image (white border).
 *   5. Sigmoid tone-curve (NOT a hard threshold): paper → white, ink → black,
 *      strokes stay CONTINUOUS. Hard thresholds (Otsu/adaptive) shatter faint
 *      gray body text into dashes — the sigmoid keeps it solid & readable.
 * ────────────────────────────────────────────────────────────────── */
function _applyMagicProCV(ctx, w, h) {
  let src, gray, ds, bgSmall, bgUp, grayF, bgF, normF, normalized,
      blurred, edges, lines, output, rotated, M;
  try {
    src  = cv.imread(ctx.canvas);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    /* ── Step 1: Background estimation via downsample → blur → upsample ── */
    const bgScale = 4;
    const bW = Math.max(8, Math.round(w / bgScale));
    const bH = Math.max(8, Math.round(h / bgScale));
    ds      = new cv.Mat();
    bgSmall = new cv.Mat();
    bgUp    = new cv.Mat();
    cv.resize(gray, ds, new cv.Size(bW, bH), 0, 0, cv.INTER_AREA);
    cv.GaussianBlur(ds, bgSmall, new cv.Size(21, 21), 0);
    cv.resize(bgSmall, bgUp, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR);

    /* ── Step 2: Normalise illumination: norm = gray / bgUp × 220 ──
       Shadow paper (gray=130, bg=160) → 130/160×220 ≈ 179 → white
       Lit paper   (gray=220, bg=220) → 220/220×220 = 220 → white
       Ink         (gray=30,  bg=180) →  30/180×220 ≈ 37  → black  */
    grayF      = new cv.Mat();
    bgF        = new cv.Mat();
    normF      = new cv.Mat();
    normalized = new cv.Mat();
    gray.convertTo(grayF, cv.CV_32F);
    bgUp.convertTo(bgF,   cv.CV_32F);
    cv.divide(grayF, bgF, normF, 220.0);
    normF.convertTo(normalized, cv.CV_8U);  // values >255 clamp automatically

    /* ── Step 3: Detect text-line skew on the normalised image ── */
    blurred = new cv.Mat();
    cv.GaussianBlur(normalized, blurred, new cv.Size(3, 3), 0);
    edges = new cv.Mat();
    lines = new cv.Mat();
    cv.Canny(blurred, edges, 50, 150, 3, false);
    const houghThresh = Math.max(30, Math.round(w / 18));
    const minLen      = Math.max(40, Math.round(w / 14));
    cv.HoughLinesP(edges, lines, 1, Math.PI / 180, houghThresh, minLen, 18);

    let angleSum = 0, angleCount = 0;
    for (let i = 0; i < lines.rows; i++) {
      const x1 = lines.data32S[i * 4],     y1 = lines.data32S[i * 4 + 1];
      const x2 = lines.data32S[i * 4 + 2], y2 = lines.data32S[i * 4 + 3];
      const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      if (Math.abs(ang) < 20) { angleSum += ang; angleCount++; }
    }

    /* ── Step 4: Deskew the normalised GRAYSCALE image (not a binary one) ── */
    let toShow = normalized;
    if (angleCount > 0) {
      const skew = angleSum / angleCount;
      if (Math.abs(skew) > 0.4 && Math.abs(skew) < 20) {
        rotated = new cv.Mat();
        const center = new cv.Point(w / 2, h / 2);
        M = cv.getRotationMatrix2D(center, skew, 1.0);
        cv.warpAffine(normalized, rotated, M, new cv.Size(w, h),
          cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
        toShow = rotated;
      }
    }

    /* ── Step 5: Render the normalised grayscale to the canvas ── */
    output = new cv.Mat();
    cv.cvtColor(toShow, output, cv.COLOR_GRAY2RGBA);
    cv.imshow(ctx.canvas, output);

    /* ── Step 6: Sigmoid tone-curve (THE key step) ──
       A hard threshold (Otsu/adaptive) makes a per-pixel black/white decision;
       on faint gray body text that pixel is ambiguous, so strokes shatter into
       dashes (the bug the user reported). Instead we apply a steep but SMOOTH
       S-curve: paper → pure white, ink → near-black, and crucially the strokes
       stay CONTINUOUS (anti-aliased grayscale). Faint text becomes solid and
       readable. Centre 190 / steepness 0.09; extremes snapped for a clean scan
       look. Built as a 256-entry LUT for speed (cv.LUT isn't in this build). */
    const idata = ctx.getImageData(0, 0, w, h);
    const dd    = idata.data;
    const curve = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      let o = 255 / (1 + Math.exp(-0.09 * (v - 190)));
      if (o < 22)  o = 0;     // snap deep ink to pure black
      if (o > 225) o = 255;   // snap bright paper to pure white
      curve[v] = o;
    }
    for (let i = 0; i < dd.length; i += 4) {
      const o = curve[dd[i]];
      dd[i] = dd[i + 1] = dd[i + 2] = o;
    }
    ctx.putImageData(idata, 0, 0);

  } catch (err) {
    console.error('Magic Pro (OpenCV) error — falling back to JS:', err);
    const imgData = ctx.getImageData(0, 0, w, h);
    _applyMagicPro(imgData.data, w, h);
    ctx.putImageData(imgData, 0, 0);
  } finally {
    [src, gray, ds, bgSmall, bgUp, grayF, bgF, normF, normalized,
     blurred, edges, lines, output, rotated, M]
      .forEach(m => { if (m && m.delete) try { m.delete(); } catch(e) {} });
  }
}

/* ── 2b. MAGIC PRO — Pure-JS fallback (no OpenCV) ──────────────────
 * Dual-radius adaptive thresholding:
 *   • Large-radius mean (big window) → remove page-level shadow/gradient
 *   • Small-radius mean (tight window) → detect individual ink strokes
 *
 * Tuned to match OpenCV path quality:
 *   • Background → pure #ffffff  (was leaving grayish remnants)
 *   • Ink/text   → near #000000  (was only 70% dark — now 88%)
 *   • Final binary snap: >210 → 255 (white), <40 → 0 (black)
 * ────────────────────────────────────────────────────────────────── */
function _applyMagicPro(data, w, h) {
  /* Large radius: captures full illumination gradient across the page.
     Increased from /12 to /8 so shadows are more completely captured. */
  const rLarge = Math.max(40, Math.round(Math.min(w, h) / 8));
  /* Small radius: tight local neighbourhood for crisp ink detection. */
  const rSmall = Math.max(6,  Math.round(Math.min(w, h) / 50));

  const largeMean = _buildLocalMean(data, w, h, rLarge);
  const smallMean = _buildLocalMean(data, w, h, rSmall);

  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];

    /* Normalise against large-scale illumination so shadow areas are
       treated the same as well-lit areas. Target brightness = 220. */
    const normIllum = gray * (220 / Math.max(largeMean[px], 35));

    /* Ink detection: how much darker is this pixel vs its tight neighbourhood?
       Lower threshold (12 + 0.04×mean) catches lighter pencil/faded ink
       that the old (18 + 0.06×mean) was missing. */
    const localContrast = smallMean[px] - gray;
    const inkThreshold  = 12 + smallMean[px] * 0.04;

    let out;
    if (localContrast > inkThreshold) {
      /* Ink stroke — push toward near-black.
         88% darkening (was 70%) gives proper black text, not gray. */
      const strength = Math.min(1.0, (localContrast - inkThreshold) / 28);
      out = _clamp(gray * (1 - strength * 0.88));

    } else if (normIllum > 130) {
      /* Paper / background — ramp aggressively to pure white.
         Was 150 threshold; lowered to 130 so light shadows are removed too. */
      out = _clamp(200 + (normIllum - 130) * (55 / 125));

    } else if (normIllum > 65) {
      /* Mid-tone zone (residual shadow) — push strongly toward white. */
      out = _clamp(110 + (normIllum - 65) * (90 / 65));

    } else {
      /* Very dark pixel (thick pen, stamp) — keep dark. */
      out = _clamp(normIllum * 0.5);
    }

    data[i] = data[i+1] = data[i+2] = out;
  }

  /* ── Final binary snap pass ──────────────────────────────────────
     Anything still grayish after the main pass gets snapped to pure
     black or pure white. This is what gives the crisp "printed page"
     look that CamScanner Magic Pro produces. */
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i];
    if      (v > 205) { data[i] = data[i+1] = data[i+2] = 255; }  // paper → white
    else if (v <  45) { data[i] = data[i+1] = data[i+2] = 0;   }  // ink → black
    // mid-range (45–205) is left as-is — these are legitimately semi-dark areas
  }
}

/* ── 3. LIGHTEN ───────────────────────────────────────────────────
   CamScanner Lighten: very bright paper, text still visible, some
   shadow removal. Two stages:
   1. Background normalisation (modest: target 200, cap 2×) to lift
      shadow areas without killing ink
   2. Gamma 0.55 curve to push all bright values toward white      */
function _applyLighten(data, w, h) {
  const r  = Math.max(40, Math.round(Math.min(w, h) / 6));
  const bg = _buildLocalMean(data, w, h, r);
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    const f = Math.min(2.0, 200 / Math.max(bg[px], 40));
    data[i]   = _clamp(data[i]   * f);
    data[i+1] = _clamp(data[i+1] * f);
    data[i+2] = _clamp(data[i+2] * f);
  }
  for (let i = 0; i < data.length; i += 4) {
    data[i]   = _clamp(255 * Math.pow(data[i]   / 255, 0.55));
    data[i+1] = _clamp(255 * Math.pow(data[i+1] / 255, 0.55));
    data[i+2] = _clamp(255 * Math.pow(data[i+2] / 255, 0.55));
  }
}

/* ── 4. NO SHADOW ─────────────────────────────────────────────────
   CamScanner No Shadow: excellent shadow removal, very clean paper.
   Key fixes vs old: radius /8 (was /15) — 2× larger window captures
   the full illumination gradient. Target 230 (was 215). Cap 2.5×.  */
function _applyNoShadow(data, w, h) {
  const r  = Math.max(55, Math.round(Math.min(w, h) / 6));
  const bg = _buildLocalMean(data, w, h, r);
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    const f = Math.min(2.5, 230 / Math.max(bg[px], 38));
    data[i]   = _clamp(data[i]   * f);
    data[i+1] = _clamp(data[i+1] * f);
    data[i+2] = _clamp(data[i+2] * f);
  }
}

/* ── 5. B&W ───────────────────────────────────────────────────────
   CamScanner B&W: shadow removal first so paper in shadow doesn't
   turn solid black, then hard threshold for crisp binary output.    */
function _applyBW(data, w, h) {
  /* Shadow removal so shadowed paper → white instead of black */
  const r  = Math.max(50, Math.round(Math.min(w, h) / 6));
  const bg = _buildLocalMean(data, w, h, r);
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    const f = Math.min(2.5, 225 / Math.max(bg[px], 38));
    data[i]   = _clamp(data[i]   * f);
    data[i+1] = _clamp(data[i+1] * f);
    data[i+2] = _clamp(data[i+2] * f);
  }
  /* Hard threshold at 160 (higher after normalisation) */
  for (let i = 0; i < data.length; i += 4) {
    const v = (0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]) > 160 ? 255 : 0;
    data[i] = data[i+1] = data[i+2] = v;
  }
}

/* ── 6. B&W SOFT ─────────────────────────────────────────────────
   Softer sigmoid curve — keeps near-threshold values as mid-grays   */
function _applyBWSoft(data) {
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    const v = _clamp(255 / (1 + Math.exp(-(gray - 128) * 0.038)));
    data[i] = data[i+1] = data[i+2] = v;
  }
}

/* ── 7. GRAYSCALE ─────────────────────────────────────────────────
   CamScanner Grayscale: clean even tone with shadow removed.
   Background normalise lightly then convert to luminance.            */
function _applyGrayscale(data, w, h) {
  const r  = Math.max(45, Math.round(Math.min(w, h) / 6));
  const bg = _buildLocalMean(data, w, h, r);
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    const f = Math.min(2.0, 210 / Math.max(bg[px], 38));
    data[i]   = _clamp(data[i]   * f);
    data[i+1] = _clamp(data[i+1] * f);
    data[i+2] = _clamp(data[i+2] * f);
  }
  for (let i = 0; i < data.length; i += 4) {
    const v = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    data[i] = data[i+1] = data[i+2] = v;
  }
}

/* ── 8. ECO ───────────────────────────────────────────────────────
   CamScanner Eco: shadow removed, paper bright, colour kept but
   desaturated ~60% — a "printer-friendly" warm-neutral look.        */
function _applyEco(data, w, h) {
  /* Shadow removal */
  const r  = Math.max(45, Math.round(Math.min(w, h) / 6));
  const bg = _buildLocalMean(data, w, h, r);
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    const f = Math.min(2.0, 215 / Math.max(bg[px], 38));
    data[i]   = _clamp(data[i]   * f);
    data[i+1] = _clamp(data[i+1] * f);
    data[i+2] = _clamp(data[i+2] * f);
  }
  /* Desaturate 60% and mild brightness lift */
  for (let i = 0; i < data.length; i += 4) {
    const g = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    data[i]   = _clamp((data[i]   * 0.4 + g * 0.6) * 1.05 + 5);
    data[i+1] = _clamp((data[i+1] * 0.4 + g * 0.6) * 1.05 + 5);
    data[i+2] = _clamp((data[i+2] * 0.4 + g * 0.6) * 1.05 + 5);
  }
}

/* ── LOCAL MEAN (Fast 2-pass box blur for shadows) ───────────── */
function _buildLocalMean(data, w, h, radius) {
  const r = Math.round(radius);
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
  }

  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0, cnt = 0;
    const row = y * w;
    for (let x = 0; x <= Math.min(r, w - 1); x++) { sum += gray[row + x]; cnt++; }
    tmp[row] = sum / cnt;
    for (let x = 1; x < w; x++) {
      if (x + r < w) { sum += gray[row + x + r]; cnt++; }
      if (x - r - 1 >= 0) { sum -= gray[row + x - r - 1]; cnt--; }
      tmp[row + x] = sum / cnt;
    }
  }

  const map = new Float32Array(w * h);
  for (let x = 0; x < w; x++) {
    let sum = 0, cnt = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) { sum += tmp[y * w + x]; cnt++; }
    map[x] = sum / cnt;
    for (let y = 1; y < h; y++) {
      if (y + r < h) { sum += tmp[(y + r) * w + x]; cnt++; }
      if (y - r - 1 >= 0) { sum -= tmp[(y - r - 1) * w + x]; cnt--; }
      map[y * w + x] = sum / cnt;
    }
  }
  return map;
}

/* ── USER ADJUSTMENTS ────────────────────────────────────────── */
function _applyAdjustments(data, br, ct, sat) {
  const brF  = br * 2.55;
  const ctF  = (ct + 100) / 100;
  const satF = (sat + 100) / 100;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]   + brF;
    let g = data[i+1] + brF;
    let b = data[i+2] + brF;

    r = (r - 128) * ctF + 128;
    g = (g - 128) * ctF + 128;
    b = (b - 128) * ctF + 128;

    if (sat !== 0) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * satF;
      g = gray + (g - gray) * satF;
      b = gray + (b - gray) * satF;
    }

    data[i]   = _clamp(r);
    data[i+1] = _clamp(g);
    data[i+2] = _clamp(b);
  }
}

/* ── SHARPNESS (Unsharp mask via laplacian) ──────────────────── */
function _applySharpen(ctx, w, h, amount) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const src = imgData.data;
  const copy = new Uint8ClampedArray(src);
  const k = amount * 0.035;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = copy[i + c];
        const lap = 5 * center
          - copy[i - 4 + c]
          - copy[i + 4 + c]
          - copy[(y - 1) * w * 4 + x * 4 + c]
          - copy[(y + 1) * w * 4 + x * 4 + c];
        src[i + c] = _clamp(center + k * lap);
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

/* ── THUMBNAIL RENDERING ─────────────────────────────────────── */
function renderFilterThumbnail(canvas, filterId, image) {
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  applyFilterToContext(ctx, canvas.width, canvas.height, filterId);
}

function buildFilterStrip(containerId, image, activeFilter, onSelect) {
  const container = document.getElementById(containerId);
  if (!container || !image) return;

  container.innerHTML = '';
  FILTERS.forEach(f => {
    const card = document.createElement('div');
    card.className = 'filter-card' + (f.id === activeFilter ? ' active' : '');
    card.onclick = () => {
      container.querySelectorAll('.filter-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      if (onSelect) onSelect(f.id);
    };

    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 70;
    card.appendChild(canvas);

    const label = document.createElement('div');
    label.className = 'fc-label';
    label.textContent = f.name;
    card.appendChild(label);

    container.appendChild(card);

    // Render thumbnail asynchronously
    requestAnimationFrame(() => renderFilterThumbnail(canvas, f.id, image));
  });
}

/* ── HELPERS ─────────────────────────────────────────────────── */
function _clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// Expose globally
window.FILTERS = FILTERS;
window.applyFilterToContext = applyFilterToContext;
window.renderFilterThumbnail = renderFilterThumbnail;
window.buildFilterStrip = buildFilterStrip;
