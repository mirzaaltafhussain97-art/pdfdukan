/* ================================================================
   CamMaster — OpenCV Crop Module v3 — Precision Document Detection
   ─────────────────────────────────────────────────────────────────
   Four independent detection methods, best-result selection:

   A) Enhanced Canny + Contour
      – Histogram equalisation (CLAHE-like) before Canny
      – Morphological closing fills broken edge segments
      – 6 parameter sets covering noisy, blurry, low-contrast photos

   B) Adaptive Threshold + Contour
      – Bilateral filter + adaptiveThreshold (GAUSSIAN_C, BINARY_INV)
      – Best for white document on white/light table (low Canny contrast)

   C) Hough Line Intersection
      – HoughLinesP → cluster H/V lines → intersect for 4 corners
      – Most precise for clean, straight-edged document scans

   D) Content-Density Heatmap
      – Divide image into 16×16 cells, count Canny edge pixels/cell
      – High-density zone = printed text ⟹ bounding box = document
      – Fallback when all other methods fail on featureless backgrounds

   Scoring: areaRatio (55%) + diagonalRectangularity (45%)
   Validity: convexity check + min-edge check + area range [5%–97%]
================================================================ */

/* Single source of truth: stored on window so crop.js, filters.js and
   scanner.js all read the SAME flag. Previously this was a script-local
   `let cvReady`, so window.cvReady (checked by filters.js + scanner.js) was
   always undefined → Magic Pro and OpenCV crop never ran. */
window.cvReady = !!(window.cv && window.cv.Mat);

let _openCvLoadPromise = null;

/* OpenCV is almost 10 MB before browser compilation. Loading it in <head>
   made the scanner feel stuck on slow phones even before a file was chosen.
   Keep the full OpenCV fallback, but fetch it only if the compact ML detector
   cannot find the document corners. */
function ensureOpenCvReady() {
  if (window.cvReady && window.cv && window.cv.Mat) return Promise.resolve(true);
  if (_openCvLoadPromise) return _openCvLoadPromise;

  _openCvLoadPromise = (async () => {
    if (!window.loadScriptOnce) throw new Error('Script loader is unavailable');
    await window.loadScriptOnce('/vendor/opencv/opencv.js?v=4.8.0');

    const started = Date.now();
    while (!(window.cv && window.cv.Mat)) {
      if (Date.now() - started > 30000) throw new Error('OpenCV initialization timed out');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    onOpenCvReady();
    return true;
  })().catch(error => {
    _openCvLoadPromise = null;
    console.warn('OpenCV fallback could not load; using the adjustable crop fallback:', error);
    return false;
  });

  return _openCvLoadPromise;
}

function onOpenCvReady() {
  if (typeof cv !== 'undefined' && cv.Mat) {
    window.cvReady = true;
    const el = document.getElementById('cvStatus');
    if (el) { el.textContent = '✓ OpenCV Ready'; el.className = 'cv-badge ready'; }
    console.log('✓ OpenCV.js loaded and ready');
  } else {
    setTimeout(onOpenCvReady, 200);
  }
}

/* ═══════════════════════════════════════════════════════════════
   ML DETECTOR — DocAligner (point-regression LCNet050) via ONNX Runtime
   ─────────────────────────────────────────────────────────────────
   Deep-learning corner detection, CamScanner-style. Runs 100% in the
   browser (no upload). Model: 4.9MB, input [1,3,256,256] BGR /255,
   outputs points[1,8] (normalised) + has_obj[1,1].
   Falls back silently to the 4-method OpenCV pipeline on any failure.
═══════════════════════════════════════════════════════════════ */
const MLDetector = (() => {
  const MODEL_URL  = 'models/docaligner.onnx';
  const WASM_PATHS = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
  const S = 256;                 // model input side

  let _session = null, _loading = null, _failed = false;

  async function load() {
    if (_session) return _session;
    if (_failed)  return null;
    if (_loading) return _loading;
    _loading = (async () => {
      try {
        // Lazy-load onnxruntime-web only when corner detection is first needed.
        if (typeof ort === 'undefined' && window.loadScriptOnce) {
          try { await window.loadScriptOnce('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js'); }
          catch (_) { /* fall through to OpenCV fallback below */ }
        }
        if (typeof ort === 'undefined') { _failed = true; return null; }
        ort.env.wasm.wasmPaths  = WASM_PATHS;
        ort.env.wasm.numThreads = 1;       // single-thread → no worker dependency
        _session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
        console.log('✓ DocAligner ML model loaded');
        return _session;
      } catch (e) {
        console.warn('ML model load failed, using OpenCV fallback:', e);
        _failed = true;
        return null;
      }
    })();
    return _loading;
  }

  /* Returns ordered corners {tl,tr,br,bl} in ORIGINAL image pixels, or null. */
  async function detect(img) {
    const session = await load();
    if (!session) return null;

    const W = img.naturalWidth  || img.width;
    const H = img.naturalHeight || img.height;
    if (!W || !H) return null;

    /* Resize whole image to 256×256 (matches DocAligner preprocess) */
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    c.getContext('2d').drawImage(img, 0, 0, S, S);
    const px = c.getContext('2d').getImageData(0, 0, S, S).data;

    /* Build NCHW float32 tensor, BGR order, /255 */
    const plane = S * S;
    const f = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      f[i]             = px[i*4 + 2] / 255;  // B
      f[plane + i]     = px[i*4 + 1] / 255;  // G
      f[2*plane + i]   = px[i*4]     / 255;  // R
    }

    let out;
    try {
      const tensor = new ort.Tensor('float32', f, [1, 3, S, S]);
      out = await session.run({ img: tensor });
    } catch (e) { console.warn('ML inference failed:', e); return null; }

    const pts    = out.points  && out.points.data;
    const hasObj = out.has_obj && out.has_obj.data ? out.has_obj.data[0] : 0;
    if (!pts || pts.length < 8 || hasObj <= 0.5) return null;

    /* Map normalised coords → original pixels */
    const raw = [];
    for (let k = 0; k < 4; k++) raw.push({ x: pts[k*2] * W, y: pts[k*2+1] * H });

    /* Reject degenerate quads (area < 5% of image) */
    const area = Math.abs(
      raw[0].x*(raw[1].y-raw[3].y) + raw[1].x*(raw[2].y-raw[0].y) +
      raw[2].x*(raw[3].y-raw[1].y) + raw[3].x*(raw[0].y-raw[2].y)
    ) / 2;
    if (area < 0.05 * W * H) return null;

    const o = ensureCornerOrder({ tl: raw[0], tr: raw[1], br: raw[2], bl: raw[3] });
    return {
      tl: { x: o.tl.x, y: o.tl.y }, tr: { x: o.tr.x, y: o.tr.y },
      br: { x: o.br.x, y: o.br.y }, bl: { x: o.bl.x, y: o.bl.y },
    };
  }

  return { load, detect };
})();

/* ═══════════════════════════════════════════════════════════════
   MASTER ENTRY — runs all 4 methods, returns highest-confidence result
═══════════════════════════════════════════════════════════════ */
function detectDocumentCorners(img) {
  if (!window.cvReady) return getFallbackCorners(img);

  /* Build a canvas from the image at full resolution
     (CropEditor already down-scales for display; we work at source res) */
  const W   = img.naturalWidth  || img.width;
  const H   = img.naturalHeight || img.height;
  const imgArea = W * H;

  /* For very large images (>2 MP), resize to ≤1024 for speed */
  const MAX_PX  = 1024;
  const scale   = Math.min(1, MAX_PX / Math.max(W, H));
  const dW      = Math.round(W * scale);
  const dH      = Math.round(H * scale);
  const canvas  = document.createElement('canvas');
  canvas.width  = dW;
  canvas.height = dH;
  canvas.getContext('2d').drawImage(img, 0, 0, dW, dH);
  const dArea   = dW * dH;

  let best = null, bestScore = 0;

  /* ── A: Enhanced Canny — 6 parameter sets ── */
  const cannyParams = [
    { blur:5,  lo:50,  hi:150, dilate:1, close:2 },
    { blur:7,  lo:30,  hi:100, dilate:2, close:3 },
    { blur:3,  lo:80,  hi:220, dilate:1, close:1 },
    { blur:9,  lo:20,  hi:80,  dilate:3, close:3 },
    { blur:5,  lo:100, hi:280, dilate:0, close:1 },
    { blur:11, lo:15,  hi:60,  dilate:3, close:4 },
  ];
  for (const p of cannyParams) {
    const r = _methodCanny(canvas, p, dArea);
    if (r && r.score > bestScore) { bestScore = r.score; best = r.corners; }
  }

  /* ── B: Adaptive threshold ── */
  const rB = _methodAdaptive(canvas, dArea);
  if (rB && rB.score > bestScore) { bestScore = rB.score; best = rB.corners; }

  /* ── C: Hough lines ── */
  const rC = _methodHough(canvas, dW, dH, dArea);
  if (rC && rC.score > bestScore) { bestScore = rC.score; best = rC.corners; }

  /* ── D: Content density (last resort) ── */
  if (!best || bestScore < 0.3) {
    const rD = _methodContentDensity(canvas, dW, dH, dArea);
    if (rD && rD.score > bestScore) { bestScore = rD.score; best = rD.corners; }
  }

  /* Scale corners back to original image resolution if we down-scaled */
  if (best && scale < 1) {
    const inv = 1 / scale;
    best = {
      tl: { x: best.tl.x * inv, y: best.tl.y * inv },
      tr: { x: best.tr.x * inv, y: best.tr.y * inv },
      br: { x: best.br.x * inv, y: best.br.y * inv },
      bl: { x: best.bl.x * inv, y: best.bl.y * inv },
    };
  }

  if (best) {
    console.log(`✓ Document detected — method score: ${bestScore.toFixed(3)}`);
    _showDetectionBadge(bestScore);
    return best;
  }
  console.log('⚠ All detection methods failed — using fallback corners');
  _showDetectionBadge(0);
  return getFallbackCorners(img);
}

function _showMLBadge() {
  const badge = document.getElementById('detectionBadge');
  if (!badge) return;
  badge.textContent = '🤖 AI Detected';
  badge.className = 'detect-badge good';
  badge.style.display = 'inline-block';
}

function _showDetectionBadge(score) {
  const badge = document.getElementById('detectionBadge');
  if (!badge) return;
  if (score >= 0.55) {
    badge.textContent = '✓ Document Detected';
    badge.className = 'detect-badge good';
  } else if (score >= 0.2) {
    badge.textContent = '⚠ Adjust Corners Manually';
    badge.className = 'detect-badge warn';
  } else {
    badge.textContent = '✕ Not Detected — Adjust Manually';
    badge.className = 'detect-badge bad';
  }
  badge.style.display = 'inline-block';
}

/* ═══════════════════════════════════════════════════════════════
   METHOD A — Enhanced Canny + Contour
   Key improvement over v1: histogram equalization normalises contrast
   so faint document edges get amplified before Canny runs.
   Morphological CLOSE fills tiny gaps caused by torn/creased paper.
═══════════════════════════════════════════════════════════════ */
function _methodCanny(canvas, p, imgArea) {
  const mats = [];
  const T = m => { mats.push(m); return m; };
  try {
    const src       = T(cv.imread(canvas));
    const gray      = T(new cv.Mat());
    const equalized = T(new cv.Mat());
    const blurred   = T(new cv.Mat());
    const edges     = T(new cv.Mat());
    const processed = T(new cv.Mat());
    const contours  = T(new cv.MatVector());
    const hierarchy = T(new cv.Mat());

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    /* Histogram equalization: redistributes pixel intensities across 0–255.
       This amplifies faint document borders that Canny would otherwise miss. */
    cv.equalizeHist(gray, equalized);
    cv.GaussianBlur(equalized, blurred, new cv.Size(p.blur, p.blur), 0);
    cv.Canny(blurred, edges, p.lo, p.hi);

    if (p.close > 0) {
      /* MORPH_CLOSE = dilate then erode: bridges small gaps in edges */
      const kClose = T(cv.Mat.ones(p.close * 2 + 1, p.close * 2 + 1, cv.CV_8U));
      cv.morphologyEx(edges, processed, cv.MORPH_CLOSE, kClose);
    } else {
      edges.copyTo(processed);
    }

    if (p.dilate > 0) {
      const kDil = T(cv.Mat.ones(3, 3, cv.CV_8U));
      for (let i = 0; i < p.dilate; i++) cv.dilate(processed, processed, kDil);
    }

    cv.findContours(processed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    return _findBestQuad(contours, imgArea);
  } catch (e) {
    return null;
  } finally {
    mats.forEach(m => { try { m.delete(); } catch (e) {} });
  }
}

/* ═══════════════════════════════════════════════════════════════
   METHOD B — Adaptive Threshold + Contour
   Unlike Canny (which needs a global threshold), adaptiveThreshold
   computes per-region thresholds — handles uneven lighting and
   white-on-white (where global threshold completely fails).
═══════════════════════════════════════════════════════════════ */
function _methodAdaptive(canvas, imgArea) {
  const mats = [];
  const T = m => { mats.push(m); return m; };
  try {
    const src      = T(cv.imread(canvas));
    const gray     = T(new cv.Mat());
    const filtered = T(new cv.Mat());
    const binary   = T(new cv.Mat());
    const closed   = T(new cv.Mat());
    const contours = T(new cv.MatVector());
    const hierarchy= T(new cv.Mat());

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    /* Bilateral filter: reduces noise while keeping edges sharp.
       d=9, sigmaColor=75, sigmaSpace=75 — safe for doc photos. */
    cv.bilateralFilter(gray, filtered, 9, 75, 75);

    /* Adaptive Gaussian threshold, inverted:
       document paper (bright) → 0 | text/shadow/border (dark) → 255
       blockSize=21 handles gradients across the full page */
    cv.adaptiveThreshold(
      filtered, binary, 255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV,
      21, 4
    );

    /* Close gaps so the document border forms a closed ring */
    const kClose = T(cv.Mat.ones(7, 7, cv.CV_8U));
    cv.morphologyEx(binary, closed, cv.MORPH_CLOSE, kClose);

    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    return _findBestQuad(contours, imgArea);
  } catch (e) {
    return null;
  } finally {
    mats.forEach(m => { try { m.delete(); } catch (e) {} });
  }
}

/* ═══════════════════════════════════════════════════════════════
   METHOD C — Hough Line Intersection
   Works like a ruler: finds all dominant straight lines, then
   groups them into the 4 outermost lines (top/bottom/left/right),
   and computes their intersections to get precise corner coordinates.
   This can nail corners to sub-pixel accuracy on clean scans.
═══════════════════════════════════════════════════════════════ */
function _methodHough(canvas, W, H, imgArea) {
  const mats = [];
  const T = m => { mats.push(m); return m; };
  try {
    const src       = T(cv.imread(canvas));
    const gray      = T(new cv.Mat());
    const equalized = T(new cv.Mat());
    const blurred   = T(new cv.Mat());
    const edges     = T(new cv.Mat());
    const lines     = T(new cv.Mat());

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    /* Histogram equalization: same as Method A — amplifies faint document
       borders that standard Canny would miss on low-contrast photos */
    cv.equalizeHist(gray, equalized);
    cv.GaussianBlur(equalized, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 40, 120);

    /* HoughLinesP params:
       - vote threshold: scale with image size (larger image → more votes needed)
       - min line = 20% of shorter dimension; maxGap = 25px */
    const minLen    = Math.max(Math.min(W, H) * 0.18, 40);
    const voteThresh = Math.max(40, Math.round(Math.min(W, H) * 0.07));
    cv.HoughLinesP(edges, lines, 1, Math.PI / 180, voteThresh, minLen, 25);

    if (!lines.rows || lines.rows < 4) return null;

    /* Extract all segments with angle, midpoint, length */
    const segs = [];
    for (let i = 0; i < lines.rows; i++) {
      const x1 = lines.data32S[i * 4],     y1 = lines.data32S[i * 4 + 1];
      const x2 = lines.data32S[i * 4 + 2], y2 = lines.data32S[i * 4 + 3];
      /* Normalise angle to [0°, 180°) */
      const angle = ((Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI) % 180 + 180) % 180;
      segs.push({
        x1, y1, x2, y2, angle,
        cx: (x1 + x2) / 2, cy: (y1 + y2) / 2,
        len: Math.hypot(x2 - x1, y2 - y1),
      });
    }

    /* Cluster into near-horizontal (±30° from 0/180°) and near-vertical (60°–120°).
       Narrower bands reject diagonal noise while still catching tilted docs (up to 30°). */
    const horiz = segs.filter(s => s.angle < 30 || s.angle > 150).sort((a, b) => a.cy - b.cy);
    const vert  = segs.filter(s => s.angle >= 60 && s.angle <= 120).sort((a, b) => a.cx - b.cx);

    if (horiz.length < 2 || vert.length < 2) return null;

    /* Take outermost 30% of each cluster and build a representative spanning line.
       We use length-weighted average of (cx, cy, angle) — NOT raw endpoints —
       because HoughLinesP returns segments in arbitrary direction, so averaging
       x1/x2/y1/y2 directly can produce a degenerate (very short) representative. */
    const topGroup    = horiz.slice(0, Math.max(1, Math.ceil(horiz.length  * 0.3)));
    const bottomGroup = horiz.slice(Math.max(0, Math.floor(horiz.length * 0.7)));
    const leftGroup   = vert.slice(0,  Math.max(1, Math.ceil(vert.length  * 0.3)));
    const rightGroup  = vert.slice(Math.max(0, Math.floor(vert.length * 0.7)));

    /* Build a spanning line from a group using weighted centroid + angle.
       For horizontal groups: extend to x=0 and x=W.
       For vertical groups:   extend to y=0 and y=H. */
    const avgLine = (group, isHoriz) => {
      const totalLen = group.reduce((s, l) => s + l.len, 0) || 1;
      let cx = 0, cy = 0, ax = 0, ay = 0;
      group.forEach(l => {
        const w = l.len / totalLen;
        cx += l.cx * w;
        cy += l.cy * w;
        /* Average direction vector (use atan2 → unit vector to avoid angle-wrap issues) */
        const a = Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
        ax += Math.cos(a) * w;
        ay += Math.sin(a) * w;
      });
      /* Reconstruct two distant points from centroid + average direction */
      if (isHoriz) {
        /* Parametric: point on line at x=0 and x=W */
        const slope = Math.abs(ax) > 1e-6 ? ay / ax : 0;
        return {
          x1: 0,   y1: cy - slope * cx,
          x2: W,   y2: cy + slope * (W - cx),
        };
      } else {
        /* Parametric: point on line at y=0 and y=H */
        const slope = Math.abs(ay) > 1e-6 ? ax / ay : 0;
        return {
          x1: cx - slope * cy,       y1: 0,
          x2: cx + slope * (H - cy), y2: H,
        };
      }
    };

    const topL    = avgLine(topGroup,    true);
    const bottomL = avgLine(bottomGroup, true);
    const leftL   = avgLine(leftGroup,   false);
    const rightL  = avgLine(rightGroup,  false);

    const tl = _lineIntersect(topL, leftL);
    const tr = _lineIntersect(topL, rightL);
    const br = _lineIntersect(bottomL, rightL);
    const bl = _lineIntersect(bottomL, leftL);

    if (!tl || !tr || !br || !bl) return null;

    const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const corners = {
      tl: { x: cl(tl.x, 0, W), y: cl(tl.y, 0, H) },
      tr: { x: cl(tr.x, 0, W), y: cl(tr.y, 0, H) },
      br: { x: cl(br.x, 0, W), y: cl(br.y, 0, H) },
      bl: { x: cl(bl.x, 0, W), y: cl(bl.y, 0, H) },
    };

    const score = _scoreQuad(corners, imgArea);
    return score > 0.05 ? { corners, score } : null;
  } catch (e) {
    return null;
  } finally {
    mats.forEach(m => { try { m.delete(); } catch (e) {} });
  }
}

/* ═══════════════════════════════════════════════════════════════
   METHOD D — Content-Density Heatmap
   For the hardest case: document with NO visible border (white on white).
   Strategy: printed text/lines create dense edge pixels INSIDE the doc.
   Divide image into a grid → find cells with high edge density →
   bounding box of dense cells = document boundary.
═══════════════════════════════════════════════════════════════ */
function _methodContentDensity(canvas, W, H, imgArea) {
  const mats = [];
  const T = m => { mats.push(m); return m; };
  try {
    const src   = T(cv.imread(canvas));
    const gray  = T(new cv.Mat());
    const edges = T(new cv.Mat());

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.Canny(gray, edges, 20, 60);  // very low thresholds to capture faint text

    const edgeData = edges.data;  // Uint8ClampedArray, single channel

    /* Build 16×16 density grid */
    const GRID = 16;
    const cellW = Math.max(1, Math.floor(W / GRID));
    const cellH = Math.max(1, Math.floor(H / GRID));
    const density = Array.from({ length: GRID }, () => new Float32Array(GRID));

    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (edgeData[r * W + c] > 0) {
          const gc = Math.min(Math.floor(c / cellW), GRID - 1);
          const gr = Math.min(Math.floor(r / cellH), GRID - 1);
          density[gr][gc]++;
        }
      }
    }

    /* Normalise by cell area so small cells aren't disadvantaged */
    const cellArea = cellW * cellH;
    let maxDens = 1e-9;
    density.forEach(row => row.forEach((v, i, arr) => {
      arr[i] = v / cellArea;
      if (arr[i] > maxDens) maxDens = arr[i];
    }));

    /* Threshold at 15% of max density */
    const thresh = maxDens * 0.15;
    let minC = GRID, maxC = 0, minR = GRID, maxR = 0, foundAny = false;

    density.forEach((row, r) => row.forEach((v, c) => {
      if (v > thresh) {
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        foundAny = true;
      }
    }));

    if (!foundAny) return null;

    /* Add 1-cell padding and clamp */
    minC = Math.max(0, minC - 1); minR = Math.max(0, minR - 1);
    maxC = Math.min(GRID - 1, maxC + 1); maxR = Math.min(GRID - 1, maxR + 1);

    const px = (gc, end) => end ? Math.min(W, (gc + 1) * cellW) : gc * cellW;
    const py = (gr, end) => end ? Math.min(H, (gr + 1) * cellH) : gr * cellH;

    const corners = {
      tl: { x: px(minC, false), y: py(minR, false) },
      tr: { x: px(maxC, true),  y: py(minR, false) },
      br: { x: px(maxC, true),  y: py(maxR, true)  },
      bl: { x: px(minC, false), y: py(maxR, true)  },
    };

    /* Downweight this method: it's rectangular by construction, not from actual edge */
    const score = _scoreQuad(corners, imgArea) * 0.65;
    return score > 0.02 ? { corners, score } : null;
  } catch (e) {
    return null;
  } finally {
    mats.forEach(m => { try { m.delete(); } catch (e) {} });
  }
}

/* ═══════════════════════════════════════════════════════════════
   SHARED: Find highest-scoring quadrilateral among detected contours
═══════════════════════════════════════════════════════════════ */
function _findBestQuad(contours, imgArea) {
  let best = null, bestScore = 0;

  for (let i = 0; i < contours.size(); i++) {
    const cnt  = contours.get(i);
    const area = cv.contourArea(cnt);

    /* Skip very small contours (< 6% of image area) */
    if (area < imgArea * 0.06) { cnt.delete(); continue; }

    const peri = cv.arcLength(cnt, true);

    /* Try increasingly loose epsilon until we get exactly 4 vertices.
       Tightest epsilon = most precise corners; stop at first success. */
    let found = false;
    for (const eps of [0.01, 0.02, 0.03, 0.04, 0.06, 0.08, 0.10]) {
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, eps * peri, true);

      if (approx.rows === 4) {
        const pts = [];
        for (let j = 0; j < 4; j++)
          pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });

        const sorted = _sortCorners(pts);
        const score  = _scoreQuad(sorted, imgArea);

        if (score > bestScore) { bestScore = score; best = sorted; }
        approx.delete();
        found = true;
        break;  // stop — tightest epsilon that gives 4 vertices is the best
      }
      approx.delete();
    }
    cnt.delete();
  }

  return best ? { corners: best, score: bestScore } : null;
}

/* ═══════════════════════════════════════════════════════════════
   SCORING — composite: area ratio + diagonal rectangularity
   Returns 0 for invalid/degenerate quads (concave, too small/large,
   any edge shorter than 4% of image diagonal).
═══════════════════════════════════════════════════════════════ */
function _scoreQuad(corners, imgArea) {
  const pts = [corners.tl, corners.tr, corners.br, corners.bl];

  /* Shoelace area of the quadrilateral */
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  area = Math.abs(area) / 2;

  const areaRatio = area / imgArea;
  if (areaRatio < 0.05 || areaRatio > 0.97) return 0;

  /* Convexity test: all cross products must have the same sign */
  let prevSign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4], c = pts[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const sign  = cross >= 0 ? 1 : -1;
    if (!prevSign) prevSign = sign;
    else if (sign !== prevSign) return 0;  // concave → reject
  }

  /* Diagonal rectangularity:
     A perfect rectangle has equal diagonals → ratio = 1.0
     A trapezoid or parallelogram → ratio < 1.0 */
  const d1 = _dist(corners.tl, corners.br);
  const d2 = _dist(corners.tr, corners.bl);
  const diagRatio = Math.min(d1, d2) / (Math.max(d1, d2) + 1e-9);

  /* Minimum edge length: reject degenerate/collapsed quads */
  const minEdge = Math.min(
    _dist(corners.tl, corners.tr), _dist(corners.tr, corners.br),
    _dist(corners.br, corners.bl), _dist(corners.bl, corners.tl)
  );
  if (minEdge < Math.sqrt(imgArea) * 0.04) return 0;

  return areaRatio * 0.55 + diagRatio * 0.45;
}

/* ── HELPERS ──────────────────────────────────────────────── */

/** Intersection of two lines (a and b), each defined by two endpoints. */
function _lineIntersect(a, b) {
  const { x1, y1, x2, y2 } = a;
  const { x1: x3, y1: y3, x2: x4, y2: y4 } = b;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-8) return null;  // parallel
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

function _sortCorners(pts) {
  const sums  = pts.map(p => p.x + p.y);
  const diffs = pts.map(p => p.y - p.x);
  return {
    tl: pts[sums.indexOf(Math.min(...sums))],
    br: pts[sums.indexOf(Math.max(...sums))],
    tr: pts[diffs.indexOf(Math.min(...diffs))],
    bl: pts[diffs.indexOf(Math.max(...diffs))],
  };
}

function getFallbackCorners(img) {
  const w  = img.naturalWidth  || img.width;
  const h  = img.naturalHeight || img.height;
  const px = Math.round(Math.min(w, h) * 0.05);
  return {
    tl: { x: px,     y: px     },
    tr: { x: w - px, y: px     },
    br: { x: w - px, y: h - px },
    bl: { x: px,     y: h - px },
  };
}

function _dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/* ═══════════════════════════════════════════════════════════════
   CROP EDITOR
   Visual overlay with corner + edge handles, perspective warp.
   Updated: professional L-bracket corners (like a document scanner)
   + subtle orange tint fill inside selection.
═══════════════════════════════════════════════════════════════ */
class CropEditor {
  constructor(canvasId) {
    this.canvas  = document.getElementById(canvasId);
    this.ctx     = this.canvas ? this.canvas.getContext('2d') : null;
    this.img     = null;
    this.corners = null;
    this.scale   = 1;
    this.rotation = 0;
    this._drag   = null;
    this._maxW   = 960;
    this._maxH   = 560;
    if (this.canvas) this._bindEvents();
  }

  setImage(img) {
    this.img     = img;
    this.rotation = 0;
    this.corners = detectDocumentCorners(img);
    this.draw();
  }

  /* Async variant: try the DocAligner ML model first (CamScanner-style),
     fall back to the 4-method OpenCV pipeline if it is unavailable or
     returns nothing. Updates the detection badge to reflect which ran. */
  async setImageAsync(img) {
    this.img      = img;
    this.rotation = 0;

    let mlCorners = null;
    try {
      mlCorners = window.MLDetector ? await window.MLDetector.detect(img) : null;
    } catch (e) { mlCorners = null; }

    if (mlCorners) {
      this.corners = mlCorners;
      _showMLBadge();
    } else {
      /* Preserve the high-quality OpenCV fallback without making every page
         visitor pay its download/compile cost. */
      await ensureOpenCvReady();
      this.corners = detectDocumentCorners(img);   // shows its own badge
    }
    this.draw();
  }

  _getRotatedImg() {
    if (this.rotation === 0) return this.img;
    const w = this.img.naturalWidth  || this.img.width;
    const h = this.img.naturalHeight || this.img.height;
    const swap = this.rotation % 180 !== 0;
    const c   = document.createElement('canvas');
    c.width   = swap ? h : w;
    c.height  = swap ? w : h;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(this.rotation * Math.PI / 180);
    ctx.drawImage(this.img, -w / 2, -h / 2);
    return c;
  }

  draw() {
    if (!this.canvas || !this.img || !this.corners) return;
    const src  = this._getRotatedImg();
    const srcW = src.width  || src.naturalWidth;
    const srcH = src.height || src.naturalHeight;

    this.scale       = Math.min(this._maxW / srcW, this._maxH / srcH, 1);
    this.canvas.width  = Math.round(srcW * this.scale);
    this.canvas.height = Math.round(srcH * this.scale);
    const ctx = this.ctx, s = this.scale;

    ctx.drawImage(src, 0, 0, this.canvas.width, this.canvas.height);

    /* Dark vignette outside selection */
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.50)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    /* Clear inside selection to show image */
    ctx.globalCompositeOperation = 'destination-out';
    const cp = this._scaledCorners(s);
    ctx.beginPath();
    ctx.moveTo(cp.tl.x, cp.tl.y); ctx.lineTo(cp.tr.x, cp.tr.y);
    ctx.lineTo(cp.br.x, cp.br.y); ctx.lineTo(cp.bl.x, cp.bl.y);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    /* Subtle orange tint inside selection */
    ctx.save();
    ctx.fillStyle = 'rgba(255,99,51,0.06)';
    ctx.beginPath();
    ctx.moveTo(cp.tl.x, cp.tl.y); ctx.lineTo(cp.tr.x, cp.tr.y);
    ctx.lineTo(cp.br.x, cp.br.y); ctx.lineTo(cp.bl.x, cp.bl.y);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    /* Selection border */
    ctx.strokeStyle = '#ff6333';
    ctx.lineWidth   = 2.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cp.tl.x, cp.tl.y); ctx.lineTo(cp.tr.x, cp.tr.y);
    ctx.lineTo(cp.br.x, cp.br.y); ctx.lineTo(cp.bl.x, cp.bl.y);
    ctx.closePath(); ctx.stroke();

    /* Edge mid-handles */
    const mids = this._edgeMids(cp);
    ['top', 'right', 'bottom', 'left'].forEach(k =>
      this._drawEdgeHandle(ctx, mids[k].x, mids[k].y));

    /* Corner L-bracket handles (professional scanner style) */
    ['tl', 'tr', 'br', 'bl'].forEach(k =>
      this._drawCornerHandle(ctx, cp[k].x, cp[k].y, k));

    /* Magnifier loupe while dragging a corner — lets the user place the
       corner precisely on the document edge (the finger/cursor hides the
       exact point, so we show a zoomed view in the opposite screen corner). */
    if (this._drag && this._drag.type === 'corner') {
      this._drawMagnifier(ctx, cp);
    }
  }

  /**
   * Zoomed loupe centred on the corner currently being dragged.
   * Rendered into whichever screen corner is farthest from the drag point
   * so it's never hidden under the user's finger.
   */
  _drawMagnifier(ctx, cp) {
    const pt   = cp[this._drag.key];
    const src  = this._getRotatedImg();
    const s    = this.scale;
    const R    = 72;     // loupe radius (canvas px)
    const ZOOM = 2.4;    // magnification relative to the main view
    const M    = 14;     // margin from canvas edge

    const lx = (pt.x < this.canvas.width  / 2) ? (this.canvas.width  - R - M) : (R + M);
    const ly = (pt.y < this.canvas.height / 2) ? (this.canvas.height - R - M) : (R + M);

    const ix   = pt.x / s, iy = pt.y / s;        // corner in image-space px
    const half = R / (s * ZOOM);                 // half source region (image px)

    /* Zoomed image inside a circular clip */
    ctx.save();
    ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = '#111'; ctx.fill();
    ctx.clip();
    try {
      ctx.drawImage(src, ix - half, iy - half, half * 2, half * 2,
                         lx - R,   ly - R,   R * 2,    R * 2);
    } catch (e) {}
    ctx.restore();

    /* Ring + crosshair + centre dot */
    ctx.save();
    ctx.strokeStyle = '#ff6333'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,99,51,0.95)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lx - R + 8, ly); ctx.lineTo(lx + R - 8, ly);
    ctx.moveTo(lx, ly - R + 8); ctx.lineTo(lx, ly + R - 8);
    ctx.stroke();
    ctx.fillStyle = '#ff6333';
    ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /**
   * Professional L-bracket corner handle.
   * The bracket arms extend INWARD along the selection edges,
   * with a filled circle as the drag target.
   */
  _drawCornerHandle(ctx, x, y, key) {
    const ARM  = 20;   // bracket arm length in px
    const W    = 3;    // line width
    const R    = 8;    // dot radius

    /* Direction the bracket arms point inward toward selection centre */
    const sx = (key === 'tr' || key === 'br') ? -1 : 1;
    const sy = (key === 'bl' || key === 'br') ? -1 : 1;

    ctx.save();
    ctx.strokeStyle = '#ff6333';
    ctx.lineWidth   = W;
    ctx.lineCap     = 'square';
    ctx.lineJoin    = 'miter';

    /* L-bracket: horizontal arm then vertical arm */
    ctx.beginPath();
    ctx.moveTo(x + sx * ARM, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * ARM);
    ctx.stroke();

    /* White halo for visibility on dark and light backgrounds */
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth   = W + 2;
    ctx.beginPath();
    ctx.moveTo(x + sx * ARM, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * ARM);
    ctx.stroke();

    /* Re-draw orange bracket on top */
    ctx.strokeStyle = '#ff6333';
    ctx.lineWidth   = W;
    ctx.beginPath();
    ctx.moveTo(x + sx * ARM, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * ARM);
    ctx.stroke();

    /* Filled dot as drag target */
    ctx.fillStyle   = '#ff6333';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    ctx.restore();
  }

  _drawEdgeHandle(ctx, x, y) {
    ctx.fillStyle   = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = '#ff6333';
    ctx.lineWidth   = 2;
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  _scaledCorners(s) {
    return {
      tl: { x: this.corners.tl.x * s, y: this.corners.tl.y * s },
      tr: { x: this.corners.tr.x * s, y: this.corners.tr.y * s },
      br: { x: this.corners.br.x * s, y: this.corners.br.y * s },
      bl: { x: this.corners.bl.x * s, y: this.corners.bl.y * s },
    };
  }

  _edgeMids(cp) {
    return {
      top:    { x: (cp.tl.x + cp.tr.x) / 2, y: (cp.tl.y + cp.tr.y) / 2 },
      right:  { x: (cp.tr.x + cp.br.x) / 2, y: (cp.tr.y + cp.br.y) / 2 },
      bottom: { x: (cp.br.x + cp.bl.x) / 2, y: (cp.br.y + cp.bl.y) / 2 },
      left:   { x: (cp.bl.x + cp.tl.x) / 2, y: (cp.bl.y + cp.tl.y) / 2 },
    };
  }

  _getEventPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const t    = e.touches ? e.touches[0] : e;
    return {
      x: (t.clientX - rect.left)  * (this.canvas.width  / rect.width),
      y: (t.clientY - rect.top)   * (this.canvas.height / rect.height),
    };
  }

  _findHandle(pos) {
    const cp    = this._scaledCorners(this.scale);
    const mids  = this._edgeMids(cp);
    const CR    = 30;  // generous hit-radius so corners are easy to grab (touch)
    const ER    = 22;

    for (const k of ['tl', 'tr', 'br', 'bl']) {
      if (Math.hypot(pos.x - cp[k].x, pos.y - cp[k].y) < CR)
        return { type: 'corner', key: k };
    }
    for (const k of ['top', 'right', 'bottom', 'left']) {
      if (Math.hypot(pos.x - mids[k].x, pos.y - mids[k].y) < ER)
        return { type: 'edge', key: k };
    }
    return null;
  }

  _bindEvents() {
    const c    = this.canvas;
    const deep = obj => JSON.parse(JSON.stringify(obj));

    const onDown = e => {
      e.preventDefault();
      const pos    = this._getEventPos(e);
      const handle = this._findHandle(pos);
      if (handle) {
        this._drag = { ...handle, startX: pos.x, startY: pos.y, origCorners: deep(this.corners) };
        c.classList.add('grabbing');
      }
    };

    const onMove = e => {
      if (!this._drag) return;
      e.preventDefault();
      const pos  = this._getEventPos(e);
      const dx   = (pos.x - this._drag.startX) / this.scale;
      const dy   = (pos.y - this._drag.startY) / this.scale;
      const orig = this._drag.origCorners;
      const src  = this._getRotatedImg();
      const srcW = src.width  || src.naturalWidth;
      const srcH = src.height || src.naturalHeight;

      const cl   = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const cx   = v => cl(v, 0, srcW);
      const cy   = v => cl(v, 0, srcH);

      if (this._drag.type === 'corner') {
        const k = this._drag.key;
        this.corners[k] = { x: cx(orig[k].x + dx), y: cy(orig[k].y + dy) };
      } else {
        const edgeMap = {
          top:    ['tl', 'tr'],
          bottom: ['bl', 'br'],
          left:   ['tl', 'bl'],
          right:  ['tr', 'br'],
        };
        for (const k of edgeMap[this._drag.key]) {
          this.corners[k] = { x: cx(orig[k].x + dx), y: cy(orig[k].y + dy) };
        }
      }
      this.draw();
    };

    const onUp = () => {
      const wasDragging = !!this._drag;
      this._drag = null;
      c.classList.remove('grabbing');
      if (wasDragging) this.draw();   // final redraw clears the magnifier loupe
    };

    c.addEventListener('mousedown',  onDown);
    c.addEventListener('mousemove',  onMove);
    c.addEventListener('mouseup',    onUp);
    c.addEventListener('mouseleave', onUp);
    c.addEventListener('touchstart', onDown, { passive: false });
    c.addEventListener('touchmove',  onMove, { passive: false });
    c.addEventListener('touchend',   onUp);
  }

  resetCorners() {
    if (this.img) this.corners = detectDocumentCorners(this.img);
    this.draw();
  }

  /* Select the entire page at full size — corners snap to the image edges.
     Useful when auto-detect grabbed only part of the document. */
  fitFull() {
    if (!this.img) return;
    const src = this._getRotatedImg();
    const w = src.width  || src.naturalWidth;
    const h = src.height || src.naturalHeight;
    this.corners = { tl:{x:0,y:0}, tr:{x:w,y:0}, br:{x:w,y:h}, bl:{x:0,y:h} };
    this.draw();
  }

  rotate(deg) {
    this.rotation = (this.rotation + deg + 360) % 360;
    const src  = this._getRotatedImg();
    const w    = src.width  || src.naturalWidth;
    const h    = src.height || src.naturalHeight;

    // Re-run smart detection on the rotated image instead of plain fallback
    if (window.cvReady) {
      const tmpImg = new Image();
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = w; tmpCanvas.height = h;
      tmpCanvas.getContext('2d').drawImage(src, 0, 0);
      tmpImg.width = w; tmpImg.height = h;
      tmpImg.naturalWidth = w; tmpImg.naturalHeight = h;
      // Use canvas as image source for detection
      const detected = _detectFromCanvas(tmpCanvas, w, h);
      this.corners = detected || getFallbackCorners({ naturalWidth: w, naturalHeight: h, width: w, height: h });
    } else {
      const px = Math.round(Math.min(w, h) * 0.05);
      this.corners = { tl:{x:px,y:px}, tr:{x:w-px,y:px}, br:{x:w-px,y:h-px}, bl:{x:px,y:h-px} };
    }
    this.draw();
  }

  /* ── PERSPECTIVE TRANSFORM (OpenCV) ──────────────────────────── */
  async applyCrop() {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        let src, dst, M, srcPts, dstPts;
        try {
          const rotImg = this._getRotatedImg();
          const srcW   = rotImg.width  || rotImg.naturalWidth;
          const srcH   = rotImg.height || rotImg.naturalHeight;

          const srcCanvas = document.createElement('canvas');
          srcCanvas.width  = srcW;
          srcCanvas.height = srcH;
          srcCanvas.getContext('2d').drawImage(rotImg, 0, 0);

          const pts   = ensureCornerOrder(this.corners);
          const wTop  = _dist(pts.tl, pts.tr), wBot = _dist(pts.bl, pts.br);
          const hLeft = _dist(pts.tl, pts.bl), hRight = _dist(pts.tr, pts.br);
          const outW  = Math.max(Math.round(Math.max(wTop, wBot)), 100);
          const outH  = Math.max(Math.round(Math.max(hLeft, hRight)), 100);

          src    = cv.imread(srcCanvas);
          dst    = new cv.Mat();
          srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
            pts.tl.x, pts.tl.y, pts.tr.x, pts.tr.y,
            pts.br.x, pts.br.y, pts.bl.x, pts.bl.y,
          ]);
          dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
            0, 0, outW, 0, outW, outH, 0, outH,
          ]);

          M = cv.getPerspectiveTransform(srcPts, dstPts);
          cv.warpPerspective(src, dst, M, new cv.Size(outW, outH),
            cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));

          const outCanvas = document.createElement('canvas');
          outCanvas.width = outW; outCanvas.height = outH;
          cv.imshow(outCanvas, dst);

          outCanvas.toBlob(blob => {
            if (!blob) { reject(new Error('Canvas toBlob failed')); return; }
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => reject(new Error('Image load failed'));
            img.src = url;
          }, 'image/png', 1.0);
        } catch (err) {
          reject(err);
        } finally {
          [srcPts, dstPts, src, dst, M].forEach(m => { try { if (m) m.delete(); } catch (e) {} });
        }
      }, 50);
    });
  }

  /* ── PURE-JS PERSPECTIVE WARP (fallback if OpenCV fails) ─────── */
  async perspectiveCrop() {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const rotImg = this._getRotatedImg();
          const srcW   = rotImg.width  || rotImg.naturalWidth;
          const srcH   = rotImg.height || rotImg.naturalHeight;

          const srcCanvas = document.createElement('canvas');
          srcCanvas.width  = srcW; srcCanvas.height = srcH;
          srcCanvas.getContext('2d').drawImage(rotImg, 0, 0);

          const pts  = ensureCornerOrder(this.corners);
          const outW = Math.max(Math.round(Math.max(_dist(pts.tl, pts.tr), _dist(pts.bl, pts.br))), 100);
          const outH = Math.max(Math.round(Math.max(_dist(pts.tl, pts.bl), _dist(pts.tr, pts.br))), 100);

          const dstCanvas = _perspectiveWarpCanvas(srcCanvas, pts, outW, outH);
          if (!dstCanvas) { reject(new Error('Homography failed')); return; }

          dstCanvas.toBlob(blob => {
            if (!blob) { reject(new Error('toBlob failed')); return; }
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => reject(new Error('Image load failed'));
            img.src = url;
          }, 'image/png', 1.0);
        } catch (err) {
          reject(err);
        }
      }, 50);
    });
  }

  async simpleCrop() {
    return new Promise(resolve => {
      const pts  = this.corners;
      const minX = Math.min(pts.tl.x, pts.tr.x, pts.br.x, pts.bl.x);
      const minY = Math.min(pts.tl.y, pts.tr.y, pts.br.y, pts.bl.y);
      const maxX = Math.max(pts.tl.x, pts.tr.x, pts.br.x, pts.bl.x);
      const maxY = Math.max(pts.tl.y, pts.tr.y, pts.br.y, pts.bl.y);
      const w = maxX - minX, h = maxY - minY;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(this.img, minX, minY, w, h, 0, 0, w, h);
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = c.toDataURL('image/png');
    });
  }
}

/* ═══════════════════════════════════════════════════════════════
   PURE-JS PERSPECTIVE WARP ENGINE (DLT homography)
   Used as fallback when OpenCV warpPerspective is unavailable.
═══════════════════════════════════════════════════════════════ */
function _solveDLT(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivotRow = col, pivotVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > pivotVal) { pivotVal = Math.abs(M[row][col]); pivotRow = row; }
    }
    if (pivotVal < 1e-10) return null;
    const tmp = M[col]; M[col] = M[pivotRow]; M[pivotRow] = tmp;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = M[row][col] / M[col][col];
      for (let j = col; j <= n; j++) M[row][j] -= f * M[col][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function _computeHomography(srcPts, dstPts) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const sx = srcPts[i].x, sy = srcPts[i].y;
    const dx = dstPts[i].x, dy = dstPts[i].y;
    A.push([sx, sy, 1,  0,  0, 0, -sx*dx, -sy*dx]); b.push(dx);
    A.push([ 0,  0, 0, sx, sy, 1, -sx*dy, -sy*dy]); b.push(dy);
  }
  const h = _solveDLT(A, b);
  if (!h) return null;
  return [[h[0],h[1],h[2]],[h[3],h[4],h[5]],[h[6],h[7],1.0]];
}

function _invertMatrix3x3(m) {
  const [[a,b,c],[d,e,f],[g,h,k]] = m;
  const det = a*(e*k-f*h) - b*(d*k-f*g) + c*(d*h-e*g);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    [(e*k-f*h)*inv, (c*h-b*k)*inv, (b*f-c*e)*inv],
    [(f*g-d*k)*inv, (a*k-c*g)*inv, (c*d-a*f)*inv],
    [(d*h-e*g)*inv, (b*g-a*h)*inv, (a*e-b*d)*inv],
  ];
}

function _perspectiveWarpCanvas(srcCanvas, pts, outW, outH) {
  const srcPtsList = [pts.tl, pts.tr, pts.br, pts.bl];
  const dstPtsList = [{x:0,y:0},{x:outW,y:0},{x:outW,y:outH},{x:0,y:outH}];
  const H  = _computeHomography(srcPtsList, dstPtsList);
  if (!H) return null;
  const Hi = _invertMatrix3x3(H);
  if (!Hi) return null;

  const [[hi00,hi01,hi02],[hi10,hi11,hi12],[hi20,hi21,hi22]] = Hi;
  const srcCtx  = srcCanvas.getContext('2d');
  const sW = srcCanvas.width, sH = srcCanvas.height;
  const srcData = srcCtx.getImageData(0, 0, sW, sH).data;

  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = outW; dstCanvas.height = outH;
  const dstCtx    = dstCanvas.getContext('2d');
  const dstImgData= dstCtx.createImageData(outW, outH);
  const dst       = dstImgData.data;

  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
      const wx = hi00*dx + hi01*dy + hi02;
      const wy = hi10*dx + hi11*dy + hi12;
      const ww = hi20*dx + hi21*dy + hi22;
      const sx = wx / ww, sy = wy / ww;
      const dstIdx = (dy * outW + dx) * 4;
      if (sx < 0 || sy < 0 || sx >= sW || sy >= sH) {
        dst[dstIdx] = dst[dstIdx+1] = dst[dstIdx+2] = dst[dstIdx+3] = 255;
        continue;
      }
      const x0=sx|0, y0=sy|0;
      const x1=Math.min(x0+1,sW-1), y1=Math.min(y0+1,sH-1);
      const tx=sx-x0, ty=sy-y0, itx=1-tx, ity=1-ty;
      const i00=(y0*sW+x0)*4, i10=(y0*sW+x1)*4;
      const i01=(y1*sW+x0)*4, i11=(y1*sW+x1)*4;
      for (let ch=0; ch<4; ch++) {
        dst[dstIdx+ch] = (
          srcData[i00+ch]*itx*ity + srcData[i10+ch]*tx*ity +
          srcData[i01+ch]*itx*ty  + srcData[i11+ch]*tx*ty
        ) + 0.5 | 0;
      }
    }
  }
  dstCtx.putImageData(dstImgData, 0, 0);
  return dstCanvas;
}

/* ── CORNER ORDER HELPER ──────────────────────────────────── */
function ensureCornerOrder(pts) {
  const arr = [
    { x: pts.tl.x, y: pts.tl.y },
    { x: pts.tr.x, y: pts.tr.y },
    { x: pts.br.x, y: pts.br.y },
    { x: pts.bl.x, y: pts.bl.y },
  ].map(p => ({ ...p, sum: p.x + p.y, diff: p.y - p.x }));
  return {
    tl: arr.reduce((m, p) => p.sum  < m.sum  ? p : m),
    br: arr.reduce((m, p) => p.sum  > m.sum  ? p : m),
    tr: arr.reduce((m, p) => p.diff < m.diff ? p : m),
    bl: arr.reduce((m, p) => p.diff > m.diff ? p : m),
  };
}

/* ── DETECT FROM CANVAS (used by rotate re-detection) ──────── */
function _detectFromCanvas(canvas, W, H) {
  const dArea = W * H;
  let best = null, bestScore = 0;
  const cannyParams = [
    { blur:5, lo:50,  hi:150, dilate:1, close:2 },
    { blur:7, lo:30,  hi:100, dilate:2, close:3 },
    { blur:3, lo:80,  hi:220, dilate:1, close:1 },
  ];
  for (const p of cannyParams) {
    const r = _methodCanny(canvas, p, dArea);
    if (r && r.score > bestScore) { bestScore = r.score; best = r.corners; }
  }
  const rB = _methodAdaptive(canvas, dArea);
  if (rB && rB.score > bestScore) { bestScore = rB.score; best = rB.corners; }
  return best || null;
}

/* ── GLOBAL EXPORTS ───────────────────────────────────────── */
window.CropEditor            = CropEditor;
window.detectDocumentCorners = detectDocumentCorners;
window.MLDetector            = MLDetector;
window.getFallbackCorners    = getFallbackCorners;
window.ensureCornerOrder     = ensureCornerOrder;
window.onOpenCvReady         = onOpenCvReady;
window.ensureOpenCvReady     = ensureOpenCvReady;
window._perspectiveWarpCanvas = _perspectiveWarpCanvas;
window._computeHomography    = _computeHomography;
window._detectFromCanvas     = _detectFromCanvas;
