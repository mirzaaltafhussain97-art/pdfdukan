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
window.cvReady = false;

function _cropBrandColor() {
  return typeof getComputedStyle === 'function'
    ? getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#ff6333'
    : '#ff6333';
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

function waitForCvReady(timeoutMs = 3000) {
  if (window.cvReady && typeof cv !== 'undefined' && cv.Mat) return Promise.resolve(true);
  return new Promise(resolve => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (typeof cv !== 'undefined' && cv.Mat) {
        window.cvReady = true;
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 50);
  });
}

(function pollCvReady() {
  if(typeof WorkerGlobalScope==='undefined'&&typeof Worker==='function'&&typeof OffscreenCanvas!=='undefined')return;
  if (window.cvReady) return;
  if (typeof cv !== 'undefined' && cv.Mat) { onOpenCvReady(); }
  else setTimeout(pollCvReady, 200);
})();

/* ═══════════════════════════════════════════════════════════════
   ML DETECTOR — DocAligner (point-regression LCNet050) via ONNX Runtime
   ─────────────────────────────────────────────────────────────────
   Deep-learning corner detection, CamScanner-style. Runs 100% in the
   browser (no upload). Model: 4.9MB, input [1,3,256,256] BGR /255,
   outputs points[1,8] (normalised) + has_obj[1,1].
   Falls back silently to the 4-method OpenCV pipeline on any failure.
═══════════════════════════════════════════════════════════════ */
const MLDetector = (() => {
  const inWorker   = typeof WorkerGlobalScope!=='undefined'&&self instanceof WorkerGlobalScope;
  const modelPath  = name => inWorker ? new URL('../models/'+name,self.location.href).href : 'models/'+name;
  // Heatmap DocAligner (fastvit_t8 / lcnet100) locates page corners far more
  // precisely than the point-regression fallback; use it whenever it exists.
  const HEATMAP_MODELS = ['lcnet100_h_e_bifpn_256_fp32.onnx', 'fastvit_t8_h_e_bifpn_256_fp32.onnx'].map(modelPath);
  const POINT_MODEL = modelPath('docaligner.onnx');
  const MARGINS = [0, 0.1, 0.2, 0.3, 0.4];
  let _kind = null, _lastConfidence = 0, _heat = [], _lastDebug = null;
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
        // Two complementary heatmap models; each one alone misses some photos.
        // Inside the document worker the heavier model loads on a helper
        // thread (in parallel with the light one) so both can run at once.
        const helper = inWorker ? startHelper(HEATMAP_MODELS[1]) : null;
        // A second copy of the light model on another thread takes the wider
        // paddings, so hard photos finish sooner. Same model, same inputs:
        // identical answers, only computed in parallel. Used once it is ready.
        const assist = inWorker && (self.navigator && navigator.hardwareConcurrency || 2) >= 4 ? startHelper(HEATMAP_MODELS[0]) : null;
        try { _heat.push({ session: await ort.InferenceSession.create(HEATMAP_MODELS[0], { executionProviders: ['wasm'] }) }); } catch (_) {}
        if (assist && _heat[0]) { const first = _heat[0]; assist.ready.then(ok => { if (ok) first.assist = assist; }); }
        if (helper && await helper.ready) _heat.push({ remote: helper });
        else { try { _heat.push({ session: await ort.InferenceSession.create(HEATMAP_MODELS[1], { executionProviders: ['wasm'] }) }); } catch (_) {} }
        if (_heat.length) { _session = _heat[0]; _kind = 'heatmap'; }
        else { _session = await ort.InferenceSession.create(POINT_MODEL, { executionProviders: ['wasm'] }); _kind = 'point'; }
        console.log('✓ DocAligner ML model loaded ('+_kind+')');
        return _session;
      } catch (e) {
        console.warn('ML model load failed, using OpenCV fallback:', e);
        _failed = true;
        return null;
      }
    })();
    return _loading;
  }

  /* Helper thread for the second heatmap model. Any failure resolves to
     `failed`, and the caller then runs that inference locally instead. */
  function startHelper(modelUrl) {
    let worker;
    try { worker = new Worker(new URL('scan-model-worker.js?v=20261105_fixes', self.location.href)); }
    catch (_) { return null; }
    const jobs = new Map(); let sequence = 0, broken = false, resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const timer = setTimeout(() => { broken = true; resolveReady(false); }, 60000);
    const failAll = () => { broken = true; resolveReady(false); for (const job of jobs.values()) job.slots.forEach(s => s.resolve({ failed: true })); jobs.clear(); };
    worker.onerror = event => { event.preventDefault?.(); failAll(); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'loaded') { clearTimeout(timer); if (data.error) { broken = true; worker.terminate(); } resolveReady(!data.error); return; }
      const job = jobs.get(data.id); if (!job) return;
      if (data.type === 'done') { job.slots.forEach(s => s.resolve({ failed: true })); jobs.delete(data.id); return; }
      job.slots[data.i].resolve(data.empty ? { empty: true } : { heat: { dims: data.dims, data: data.data } });
    };
    worker.postMessage({ type: 'load', ort: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js', wasm: WASM_PATHS, model: modelUrl });
    function run(inputs, side) {
      const id = ++sequence, slots = inputs.map(() => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; });
      if (broken) { slots.forEach(s => s.resolve({ failed: true })); return { get: i => slots[i].promise, cancel() {} }; }
      jobs.set(id, { slots });
      const copies = inputs.map(f => f.slice());
      worker.postMessage({ type: 'run', id, inputs: copies, side }, copies.map(f => f.buffer));
      // A slot that already resolved keeps its value; `done` only fills the rest.
      return { get: i => slots[i].promise, cancel() { if (jobs.delete(id)) worker.postMessage({ type: 'cancel', id }); } };
    }
    return { ready, run };
  }
  let _localFallback = null;
  async function localSession(url) {
    if (!_localFallback) _localFallback = ort.InferenceSession.create(url, { executionProviders: ['wasm'] }).catch(() => null);
    return _localFallback;
  }

  /* Returns ordered corners {tl,tr,br,bl} in ORIGINAL image pixels, or null. */
  async function detect(img) {
    const session = await load();
    if (!session) return null;

    const W = img.naturalWidth  || img.width;
    const H = img.naturalHeight || img.height;
    if (!W || !H) return null;
    if (_kind === 'heatmap') return detectHeatmapEnsemble(img, W, H);

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

    _lastConfidence = 0;
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


  /* Decode one 4-channel heatmap: largest blob >= 0.3 per corner, weighted centroid. */
  function decodeHeatmap(t, side) {
    const [, C, h, w] = t.dims, data = t.data, plane = h * w, seen = new Uint8Array(plane), queue = new Int32Array(plane), pts = [];
    let weakest = 1;
    for (let c = 0; c < Math.min(4, C); c++) {
      const base = c * plane; let bestSum = 0, bx = 0, by = 0, peak = 0; seen.fill(0);
      for (let start = 0; start < plane; start++) {
        if (seen[start] || data[base + start] < 0.3) continue;
        let head = 0, tail = 1, sum = 0, sx = 0, sy = 0, top = 0; queue[0] = start; seen[start] = 1;
        while (head < tail) {
          const i = queue[head++], x = i % w, y = (i / w) | 0, v = data[base + i];
          sum += v; sx += v * x; sy += v * y; if (v > top) top = v;
          if (x > 0 && !seen[i-1] && data[base+i-1] >= 0.3) { seen[i-1] = 1; queue[tail++] = i-1; }
          if (x < w-1 && !seen[i+1] && data[base+i+1] >= 0.3) { seen[i+1] = 1; queue[tail++] = i+1; }
          if (y > 0 && !seen[i-w] && data[base+i-w] >= 0.3) { seen[i-w] = 1; queue[tail++] = i-w; }
          if (y < h-1 && !seen[i+w] && data[base+i+w] >= 0.3) { seen[i+w] = 1; queue[tail++] = i+w; }
        }
        if (sum > bestSum) { bestSum = sum; bx = sx / sum; by = sy / sum; peak = top; }
      }
      if (!bestSum) return null;
      weakest = Math.min(weakest, peak);
      pts.push({ x: (bx + 0.5) / w * side, y: (by + 0.5) / h * side });
    }
    return pts.length === 4 ? { pts, conf: weakest } : null;
  }

  /* Image-border strips: a page that really fills the frame shows smooth,
     bright paper at the border; a textured scene there means the frame is
     not the page edge (the model saw the photo rectangle, not the sheet). */
  function borderPaperScores(img, W, H) {
    const s = Math.min(1, 400 / Math.max(W, H)), w = Math.max(8, Math.round(W * s)), h = Math.max(8, Math.round(H * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data, L = new Float32Array(w * h);
    for (let i = 0; i < L.length; i++) L[i] = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
    const k = Math.max(4, Math.round(0.04 * Math.min(w, h)));
    const strip = (x0, x1, y0, y1) => { let e = 0, n = 0, lum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { if (x >= w-1 || y >= h-1) continue; const v = L[y*w+x]; lum += v; n++;
        if (Math.max(Math.abs(L[y*w+x+1]-v), Math.abs(L[(y+1)*w+x]-v)) > 20) e++; }
      e /= Math.max(1, n); lum /= Math.max(1, n); return (e < 0.06 && lum > 140) ? 1 : (e < 0.10 && lum > 120 ? 0.5 : 0); };
    return { T: strip(0, w, 0, k), R: strip(w-1-k, w-1, 0, h), B: strip(0, w, h-1-k, h-1), L: strip(0, k, 0, h) };
  }

  const _paperCache = new WeakMap();
  /* Fraction of the quad interior that looks like paper (bright, neutral, smooth). */
  function paperness(img, W, H, q) {
    const s = Math.min(1, 300 / Math.max(W, H)), w = Math.max(8, Math.round(W * s)), h = Math.max(8, Math.round(H * s));
    let d = _paperCache.get(img);
    if (!d) { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, w, h); d = ctx.getImageData(0, 0, w, h).data; _paperCache.set(img, d); }
    const P = ['tl','tr','br','bl'].map(k => ({ x: q[k].x * s, y: q[k].y * s }));
    const inside = (x, y) => { for (let i = 0; i < 4; i++) { const a = P[i], b = P[(i+1)%4]; if ((b.x-a.x)*(y-a.y) - (b.y-a.y)*(x-a.x) < 0) return false; } return true; };
    let n = 0, paper = 0, smooth = 0;
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w; x++) { if (!inside(x + 0.5, y + 0.5)) continue; const i = (y*w+x)*4, r = d[i], g = d[i+1], b = d[i+2];
      const hi = Math.max(r,g,b), lo = Math.min(r,g,b), lum = (r+g+b)/3, below = ((y+1)*w+x)*4; n++;
      if (lum > 140 && (hi - lo) < 0.25 * hi) paper++;
      if (Math.abs((d[below]+d[below+1]+d[below+2])/3 - lum) < 10) smooth++; }
    return n < 50 ? 0 : 0.5 * paper / n + 0.5 * smooth / n;
  }

  /* CamScanner-style detection: run both heatmap models on the photo with
     several amounts of surrounding padding (a page that fills the frame is
     only recognised once it has room around it), group agreeing answers,
     snap each group's outline to the real paper edges and keep the group
     with the best agreement, edge evidence and paper-like interior. */
  async function detectHeatmapEnsemble(img, W, H) {
    const S = 256, side0 = Math.max(W, H), runs = []; let settled = false;
    const canvas = document.createElement('canvas'); canvas.width = S; canvas.height = S;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Light model first over all paddings, heavier model only if still unsettled.
    const tensors = new Map();
    const tensorFor = margin => { if (tensors.has(margin)) return tensors.get(margin);
      const side = side0 * (1 + 2 * margin), ox = (side - W) / 2, oy = (side - H) / 2, k = S / side;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S); ctx.drawImage(img, ox * k, oy * k, W * k, H * k);
      const px = ctx.getImageData(0, 0, S, S).data, plane = S * S, f = new Float32Array(3 * plane);
      for (let i = 0; i < plane; i++) { f[i] = px[i*4+2] / 255; f[plane+i] = px[i*4+1] / 255; f[2*plane+i] = px[i*4] / 255; }
      const entry = { tensor: new ort.Tensor('float32', f, [1, 3, S, S]), side, ox, oy }; tensors.set(margin, entry); return entry; };
    const borders = borderPaperScores(img, W, H), tol = 0.015 * Math.max(W, H);
    const sceneFrameClaim = q => {
      const c = q.map(p => ({ x: Math.max(0, Math.min(W, p.x)), y: Math.max(0, Math.min(H, p.y)) })); let bad = 0;
      for (let i = 0; i < 4; i++) { const A = c[i], B = c[(i+1)%4];
        const b = (A.y < tol && B.y < tol) ? 'T' : (A.x > W-tol && B.x > W-tol) ? 'R' : (A.y > H-tol && B.y > H-tol) ? 'B' : (A.x < tol && B.x < tol) ? 'L' : null;
        if (b && borders[b] === 0) bad++; }
      return bad >= 2; };
    const touchesFrame = q => q.filter(p => p.x < tol || p.y < tol || p.x > W - tol || p.y > H - tol).length >= 2;
    // The helper model starts on its own thread right away; its answers are
    // read in exactly the same order the sequential loop used to produce them.
    const remotes = _heat.map(runner => runner.remote ? runner.remote.run(MARGINS.map(m => tensorFor(m).tensor.data), S) : null);
    const ASSIST_FROM = 2, assists = _heat.map(runner => runner.assist ? runner.assist.run(MARGINS.slice(ASSIST_FROM).map(m => tensorFor(m).tensor.data), S) : null);
    try {
    for (let r_i = 0; r_i < _heat.length; r_i++) {
      const runner = _heat[r_i], remote = remotes[r_i];
      for (let m_i = 0; m_i < MARGINS.length; m_i++) {
        const margin = MARGINS[m_i];
        const { tensor, side, ox, oy } = tensorFor(margin);
        let heat = null;
        const assist = assists[r_i];
        const answer = remote ? await remote.get(m_i) : (assist && m_i >= ASSIST_FROM ? await assist.get(m_i - ASSIST_FROM) : null);
        if (answer && answer.empty) continue;
        if (answer && answer.heat) heat = answer.heat;
        else {
          const session = runner.session || await localSession(HEATMAP_MODELS[1]);
          if (!session) continue;
          let out; try { out = await session.run({ img: tensor }); } catch (_) { continue; }
          heat = out.heatmap;
        }
        const r = heat ? decodeHeatmap(heat, side) : null;
        if (!r || r.conf < 0.35) continue;
        const run = { conf: r.conf, q: r.pts.map(p => ({ x: p.x - ox, y: p.y - oy })) };
        // Early exit: two confident, agreeing answers settle the page (most cards
        // and clear documents finish after 2 runs instead of 10). An answer that
        // claims the photo frame where the border is visibly not paper (tiles,
        // cloth, a hand) is the padding rectangle, not the sheet: never settle on it.
        if (run.conf >= 0.85 && !touchesFrame(run.q) && runs.some(o => o.conf >= 0.85 && o.q.reduce((a, p, i) => a + Math.hypot(p.x - run.q[i].x, p.y - run.q[i].y), 0) / 4 < 0.015 * Math.hypot(W, H))) { runs.push(run); settled = true; break; }
        runs.push(run);
      }
      if (settled) break;
    }
    } finally { remotes.forEach(remote => remote && remote.cancel()); assists.forEach(a => a && a.cancel()); }
    if (!runs.length) return null;
    const diag = Math.hypot(W, H), dist = (a, b) => a.q.reduce((acc, p, i) => acc + Math.hypot(p.x - b.q[i].x, p.y - b.q[i].y), 0) / 4;
    const clusters = [];
    for (const r of runs.slice().sort((a, b) => b.conf - a.conf)) { const c = clusters.find(c => dist(c[0], r) < 0.03 * diag); c ? c.push(r) : clusters.push([r]); }
    const support = c => c.reduce((acc, r) => acc + r.conf, 0), maxSupport = Math.max(...clusters.map(support));
    let best = null; const dbg = [], allClusters = [];
    for (const c of clusters) {
      const sum = support(c), avg = [0,1,2,3].map(i => ({ x: c.reduce((a, r) => a + r.q[i].x * r.conf, 0) / sum, y: c.reduce((a, r) => a + r.q[i].y * r.conf, 0) / sum }));
      const quad = ensureCornerOrder({ tl: avg[0], tr: avg[1], br: avg[2], bl: avg[3] });
      for (const k of ['tl','tr','br','bl']) { quad[k].x = Math.max(0, Math.min(W, quad[k].x)); quad[k].y = Math.max(0, Math.min(H, quad[k].y)); }
      const snapped = snapQuadToEdges(img, quad), info = snapped.sideInliers || [0,0,0,0];
      const keys = ['tl','tr','br','bl'], sides = [];
      for (let i = 0; i < 4; i++) {
        const A = quad[keys[i]], B = quad[keys[(i+1)%4]];
        const border = (A.y < tol && B.y < tol) ? 'T' : (A.x > W-tol && B.x > W-tol) ? 'R' : (A.y > H-tol && B.y > H-tol) ? 'B' : (A.x < tol && B.x < tol) ? 'L' : null;
        sides.push(border && !snapped.sideSnapped?.[i] ? borders[border] : info[i] / 48);
      }
      const edge = sides.reduce((a, b) => a + b, 0) / 4, pp = paperness(img, W, H, quad);
      const score = 0.3 * sum / maxSupport + 0.3 * edge + 0.4 * pp;
      dbg.push({ n: c.length, sum: +sum.toFixed(2), edge: +edge.toFixed(2), sides: sides.map(v => +v.toFixed(2)), pp: +pp.toFixed(2), score: +score.toFixed(3), q: [quad.tl, quad.tr, quad.br, quad.bl].map(p => [Math.round(p.x), Math.round(p.y)]) });
      const onFrame = [0,1,2,3].every(i => { const A = snapped[keys[i]], B = snapped[keys[(i+1)%4]];
        return (A.y < tol && B.y < tol) || (A.x > W-tol && B.x > W-tol) || (A.y > H-tol && B.y > H-tol) || (A.x < tol && B.x < tol); });
      const entry = { score, sum, conf: c[0].conf, frameOnly: onFrame, frameSides: edge, raw: quad, snapEdge: edge, corners: { tl: snapped.tl, tr: snapped.tr, br: snapped.br, bl: snapped.bl } };
      allClusters.push(entry);
      if (!best || score > best.score) best = entry;
    }
    _lastConfidence = best.conf; _lastDebug = { runs: runs.length, clusters: dbg };
    // Every answer is "the whole photo" while the photo border is plainly not
    // paper: the model saw the padded photo rectangle, not a sheet (typical for
    // a small card on a dark surface). Hand over to the contour detectors.
    // "Whole photo" won, but the model also outlined a smaller object, and all
    // printed detail sits inside that object while the rest of the photo is
    // plain (a card on a bedsheet or on white paper). That object is the scan.
    const frameSidesOf = (q, tf = 1) => { const ks = ['tl','tr','br','bl'], t = tol * tf; let n = 0; for (let i = 0; i < 4; i++) { const A = q[ks[i]], B = q[ks[(i+1)%4]];
      if ((A.y < t && B.y < t) || (A.x > W-t && B.x > W-t) || (A.y > H-t && B.y > H-t) || (A.x < t && B.x < t)) n++; } return n; };
    const squarish = (q, par = true) => { const ks = ['tl','tr','br','bl']; return ks.every((k, i) => { const p = q[k], a = q[ks[(i+3)%4]], b = q[ks[(i+1)%4]];
      const ux = a.x-p.x, uy = a.y-p.y, vx = b.x-p.x, vy = b.y-p.y, c = (ux*vx + uy*vy) / Math.max(1e-6, Math.hypot(ux, uy) * Math.hypot(vx, vy)); return Math.abs(c) < 0.42; })
      // opposite sides close to parallel (a flat object seen from a normal angle)
      && (!par || [0, 1].every(i => { const d = j => Math.atan2(q[ks[(j+1)%4]].y - q[ks[j]].y, q[ks[(j+1)%4]].x - q[ks[j]].x);
        let g = Math.abs(d(i) - d(i+2)) % (2*Math.PI); g = Math.abs(g - Math.PI); return g < 8 * Math.PI / 180; })); };
    // (one frame side is enough when another outline has most of the support)
    if (best.frameOnly || frameSidesOf(best.corners) >= 1) {
      const fa = q => Math.abs(['tl','tr','br','bl'].reduce((a, k, i, ks) => { const p = q[k], r = q[ks[(i+1)%4]]; return a + p.x*r.y - r.x*p.y; }, 0)) / 2 / (W*H);
      const alts = allClusters.filter(c => c !== best && frameSidesOf(c.raw, 2) <= 2 && frameSidesOf(c.raw) < frameSidesOf(best.corners) && squarish(c.raw) && c.sum >= (frameSidesOf(best.corners) >= 2 || best.frameOnly ? 0.3 : 0.6) * best.sum && fa(c.raw) >= 0.03 && fa(c.raw) <= 0.8 && fa(c.raw) < 0.85 * fa(best.corners)).sort((a, b) => fa(b.raw) - fa(a.raw));
      for (const alt of alts) {
        const pick = fa(alt.corners) / Math.max(1e-6, fa(alt.raw)) > 0.85 && fa(alt.corners) / Math.max(1e-6, fa(alt.raw)) < 1.18 ? alt.corners : alt.raw;
        const dd = _detailInOut(img, pick, best.corners);
        _lastDebug.inner = { inD: +dd.inD.toFixed(4), outD: +dd.outD.toFixed(4) };
        if (dd.outN > 50 && dd.outD < 0.012 && dd.inD > Math.max(0.02, 5 * dd.outD)) { _lastDebug.innerPicked = true; best = Object.assign({}, alt, { corners: pick }); break; }
      }
    }
    // Still the whole photo, and its border is visibly not paper: give up
    // here so the contour detectors can look for the sheet instead.
    if (best.frameOnly && best.frameSides < 0.5) { _lastDebug.rejected = 'scene-frame'; return null; }
    // The winner may be one half of a folded sheet: a larger outline with
    // comparable support shares its other sides, and every side where they
    // differ shows the same paper on both sides (a crease, not an edge).
    if (!best.frameOnly && !_lastDebug.innerPicked) {
      const ks = ['tl','tr','br','bl'], diag = Math.hypot(W, H), fa = q => Math.abs(ks.reduce((a, k, i) => { const p = q[k], r = q[ks[(i+1)%4]]; return a + p.x*r.y - r.x*p.y; }, 0)) / 2;
      // Distance of one outline's side from the other's side LINE: collinear
      // sides (the same sheet edge, just longer) count as shared.
      const sideDist = (q1, q2, i) => { const a = q2[ks[i]], b = q2[ks[(i+1)%4]], L = Math.hypot(b.x-a.x, b.y-a.y) || 1;
        return Math.max(...[q1[ks[i]], q1[ks[(i+1)%4]]].map(p => Math.abs((b.x-a.x)*(p.y-a.y) - (b.y-a.y)*(p.x-a.x)) / L)); };
      for (const alt of allClusters.filter(c => c !== best && !c.frameOnly && squarish(c.raw, false) && c.sum >= 0.7 * best.sum && fa(c.raw) >= 1.3 * fa(best.corners)).sort((a, b) => b.score - a.score)) {
        const differ = [0,1,2,3].filter(i => sideDist(best.corners, alt.raw, i) > 0.03 * diag);
        if (!differ.length || differ.length > 2) continue;
        if (differ.every(i => _sideSameBothWays(img, best.corners, i) >= 0.45)) { _lastDebug.unfolded = true;
          best = Object.assign({}, alt, { corners: fa(alt.corners) >= 0.9 * fa(alt.raw) ? alt.corners : alt.raw }); break; }
      }
    }
    if (!best.frameOnly) { const grown = expandSidesToBackground(img, best.corners); if (grown !== best.corners) _lastDebug.expanded = true; return grown; }
    return best.corners;
  }

  return { load, detect, get kind() { return _kind; }, get confidence() { return _lastConfidence; }, get lastDebug() { return _lastDebug; } };
})();

/* ═══════════════════════════════════════════════════════════════
   EDGE SNAP — move each side of an approximate quad onto the real
   paper edge nearby (strongest consistent colour step, paper brighter
   inside), robustly fitted as a straight line. Sides with no clear
   edge are kept as given, so a good prediction is never made worse.
═══════════════════════════════════════════════════════════════ */
const _snapCache = new WeakMap();
/* Blurred RGB copy of the photo at a working size, cached per image and
   shared by edge snapping and side expansion. */
function _blurField(img, w, h) {
  // Blurred RGB at working size, cached per image (several outlines are
  // snapped against the same photo during one detection).
  let a = _snapCache.get(img);
  if (!a || a.w !== w || a.h !== h) {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, w, h);
    const raw = ctx.getImageData(0, 0, w, h).data, n = w * h, src = new Float32Array(n * 3), tmp = new Float32Array(n * 3), dst = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { src[i*3] = raw[i*4]; src[i*3+1] = raw[i*4+1]; src[i*3+2] = raw[i*4+2]; }
    // 3-tap box blur, horizontal then vertical, applied twice (≈ Gaussian σ≈1.2).
    const pass = (from, to, horizontal) => {
      const len = horizontal ? w : h, lines = horizontal ? h : w, step = horizontal ? 3 : w * 3;
      for (let l = 0; l < lines; l++) { const base = horizontal ? l * w * 3 : l * 3;
        for (let c = 0; c < 3; c++) for (let i = 0; i < len; i++) { const at = base + i * step + c;
          const prev = i > 0 ? from[at - step] : from[at], next = i < len - 1 ? from[at + step] : from[at];
          to[at] = (prev + from[at] + next) / 3; } } };
    pass(src, tmp, true); pass(tmp, dst, false); pass(dst, tmp, true); pass(tmp, dst, false);
    a = dst; a.w = w; a.h = h; _snapCache.set(img, a);
  }
  const sample = (x, y, out) => {
    if (x < 1 || y < 1 || x > w - 2 || y > h - 2) return false;
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i00 = (y0*w+x0)*3, i10 = i00 + 3, i01 = i00 + w*3, i11 = i01 + 3;
    for (let c = 0; c < 3; c++) out[c] = a[i00+c]*(1-fx)*(1-fy) + a[i10+c]*fx*(1-fy) + a[i01+c]*(1-fx)*fy + a[i11+c]*fx*fy;
    return true; };
  return { a, sample };
}

/* SIDE EXPANSION — a printed band along a card or form edge (a coloured
   header, a dark footer strip) can be mistaken for the outside. When the
   strip just outside a side is clearly NOT the surrounding table (different
   colour, not merely a darker shadow of it) and the table appears again a
   little further out along the whole side, move that side out to it. */
function expandSidesToBackground(img, corners) {
  const keys = ['tl','tr','br','bl'];
  if (!corners || !keys.every(k => corners[k] && Number.isFinite(corners[k].x))) return corners;
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const s = Math.min(1, 900 / Math.max(W, H)), w = Math.max(2, Math.round(W * s)), h = Math.max(2, Math.round(H * s));
  const { sample } = _blurField(img, w, h);
  const P = keys.map(k => ({ x: corners[k].x * s, y: corners[k].y * s }));
  const cx = P.reduce((a, p) => a + p.x, 0) / 4, cy = P.reduce((a, p) => a + p.y, 0) / 4;
  const chroma = c => { const t = c[0] + c[1] + c[2] + 30; return [c[0] / t, c[1] / t]; };
  const geo = [];
  for (let i = 0; i < 4; i++) { const A = P[i], B = P[(i+1)%4], len = Math.hypot(B.x-A.x, B.y-A.y); if (len < 20) return corners;
    let nx = (B.y-A.y)/len, ny = -(B.x-A.x)/len; if (((A.x+B.x)/2-cx)*nx + ((A.y+B.y)/2-cy)*ny < 0) { nx = -nx; ny = -ny; }
    const perp = Math.min(Math.hypot(P[(i+1)%4].x-P[(i+2)%4].x, P[(i+1)%4].y-P[(i+2)%4].y), Math.hypot(P[i].x-P[(i+3)%4].x, P[i].y-P[(i+3)%4].y));
    geo.push({ A, B, nx, ny, perp }); }
  // Table colour: median of a ring well outside the quad on all four sides.
  const ring = [], c = [0,0,0];
  for (const g of geo) { const R = Math.max(14, 0.2 * g.perp);
    for (let j = 0; j < 16; j++) { const t = 0.1 + 0.8 * j / 15; if (sample(g.A.x + (g.B.x-g.A.x)*t + g.nx*R, g.A.y + (g.B.y-g.A.y)*t + g.ny*R, c)) ring.push(c.slice()); } }
  if (ring.length < 14) return corners;
  const bg = [0,1,2].map(k => ring.map(v => v[k]).sort((a, b) => a - b)[ring.length >> 1]);
  const bgSpread = ring.filter(v => Math.hypot(v[0]-bg[0], v[1]-bg[1], v[2]-bg[2]) < 30).length / ring.length;
  if (bgSpread < 0.6) return corners;                 // busy surroundings: no reliable table colour
  const bgC = chroma(bg), isBg = v => Math.hypot(v[0]-bg[0], v[1]-bg[1], v[2]-bg[2]) < 32;
  // Foreign = clearly not the table: another hue, much brighter, or a dark
  // printed band far darker than any shadow (a shadow keeps ~half the light).
  const foreign = v => { const k = chroma(v), sv = v[0]+v[1]+v[2], sb = bg[0]+bg[1]+bg[2];
    const neutral = Math.abs(v[0]/(sv+1) - 1/3) < 0.04 && Math.abs(v[1]/(sv+1) - 1/3) < 0.04 && Math.abs(v[2]/(sv+1) - 1/3) < 0.04;
    return Math.hypot(k[0]-bgC[0], k[1]-bgC[1]) > 0.035 || sv > sb + 90 || (sb > 240 && sv < 0.42 * sb && neutral); };
  const lines = []; let moved = 0;
  for (const g of geo) {
    const maxD = Math.max(6, 0.14 * g.perp), found = [], stripCols = []; let tested = 0, strip = 0;
    for (let j = 0; j < 21; j++) { const t = 0.12 + 0.76 * j / 20, px = g.A.x + (g.B.x-g.A.x)*t, py = g.A.y + (g.B.y-g.A.y)*t;
      if (!sample(px + g.nx*5, py + g.ny*5, c)) continue; tested++;
      if (isBg(c) || !foreign(c)) continue; strip++; stripCols.push(c.slice());
      const inkBand = (c[0]+c[1]+c[2]) < 0.42 * (bg[0]+bg[1]+bg[2]);
      for (let d = 6; d <= maxD; d += 0.5) { if (!sample(px + g.nx*d, py + g.ny*d, c)) { if (d > 7 && inkBand) found.push(d - 1); break; }
        if (isBg(c) && sample(px + g.nx*(d+3), py + g.ny*(d+3), c) && isBg(c)) {
          // The edge itself is the sharpest colour step before the table shows.
          let bestD = d, bestG = -1; const u = [0,0,0], v = [0,0,0];
          for (let e = 3; e <= d + 1; e += 0.5) { if (!sample(px + g.nx*(e-1.5), py + g.ny*(e-1.5), u) || !sample(px + g.nx*(e+1.5), py + g.ny*(e+1.5), v)) continue;
            const gr = Math.hypot(u[0]-v[0], u[1]-v[1], u[2]-v[2]); if (gr > bestG) { bestG = gr; bestD = e; } }
          found.push(bestD); break; } } }
    // A printed band is one even colour along the side; patterned cloth is not.
    const sd = stripCols.length ? Math.max(...[0,1,2].map(k => { const v = stripCols.map(x => x[k]), mu = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b-mu)*(b-mu), 0) / v.length); })) : 99;
    let shift = 0;
    if (tested >= 12 && strip >= 0.7 * tested && found.length >= 0.7 * tested && sd < 22) {
      found.sort((a, b) => a - b); const med = found[found.length >> 1], q1 = found[(found.length * 0.25) | 0], q3 = found[(found.length * 0.75) | 0];
      if (q3 - q1 <= Math.max(2.5, 0.25 * med)) { shift = Math.max(0, med); moved++; } }
    lines.push({ x: g.A.x + g.nx*shift, y: g.A.y + g.ny*shift, dx: g.B.x - g.A.x, dy: g.B.y - g.A.y });
  }
  if (!moved) return corners;
  const meet = (p, q) => { const den = p.dx*q.dy - p.dy*q.dx; if (Math.abs(den) < 1e-9) return null; const u = ((q.x-p.x)*q.dy - (q.y-p.y)*q.dx) / den; return { x: p.x + p.dx*u, y: p.y + p.dy*u }; };
  const out = {};
  for (let i = 0; i < 4; i++) { const q = meet(lines[(i+3)%4], lines[i]); if (!q) return corners; out[keys[i]] = { x: Math.max(0, Math.min(W, q.x / s)), y: Math.max(0, Math.min(H, q.y / s)) }; }
  return out;
}

/* Printed detail (text, photo, QR) inside vs outside a quad. Used to tell a
   card lying on plain cloth/paper apart from "the whole photo is the page". */
function _detailInOut(img, corners, outer) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height, s = Math.min(1, 520 / Math.max(W, H));
  const w = Math.max(8, Math.round(W * s)), h = Math.max(8, Math.round(H * s));
  let f = _detailCache.get(img);
  if (!f || f.w !== w) {
    const cv0 = document.createElement('canvas'); cv0.width = w; cv0.height = h; const x = cv0.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, L = new Float32Array(w*h), B = new Float32Array(w*h), T = new Float32Array(w*h);
    for (let i = 0; i < w*h; i++) L[i] = .299*d[i*4] + .587*d[i*4+1] + .114*d[i*4+2];
    const r = 4;
    for (let y = 0; y < h; y++) { let acc = 0; for (let k = -r; k <= r; k++) acc += L[y*w + Math.min(w-1, Math.max(0, k))]; for (let xx = 0; xx < w; xx++) { T[y*w+xx] = acc / (2*r+1); acc += L[y*w + Math.min(w-1, xx+r+1)] - L[y*w + Math.max(0, xx-r)]; } }
    for (let xx = 0; xx < w; xx++) { let acc = 0; for (let k = -r; k <= r; k++) acc += T[Math.min(h-1, Math.max(0, k))*w + xx]; for (let y = 0; y < h; y++) { B[y*w+xx] = acc / (2*r+1); acc += T[Math.min(h-1, y+r+1)*w + xx] - T[Math.max(0, y-r)*w + xx]; } }
    const det = new Uint8Array(w*h); for (let i = 0; i < w*h; i++) det[i] = B[i] - L[i] > 28 ? 1 : 0;
    f = { w, h, det }; _detailCache.set(img, f);
  }
  const P = ['tl','tr','br','bl'].map(k => ({ x: corners[k].x * s, y: corners[k].y * s }));
  const cx = P.reduce((a, p) => a + p.x, 0) / 4, cy = P.reduce((a, p) => a + p.y, 0) / 4;
  const inside = (x, y, grow) => P.every((a, i) => { const b = P[(i+1)%4]; return (b.x-a.x)*(y-a.y) - (b.y-a.y)*(x-a.x) >= -grow * Math.hypot(b.x-a.x, b.y-a.y); });
  const margin = 0.03 * Math.max(w, h);
  const O = outer && ['tl','tr','br','bl'].map(k => ({ x: outer[k].x * s, y: outer[k].y * s }));
  const inOuter = (x, y) => !O || O.every((a, i) => { const b = O[(i+1)%4]; return (b.x-a.x)*(y-a.y) - (b.y-a.y)*(x-a.x) >= margin * Math.hypot(b.x-a.x, b.y-a.y); });
  let ni = 0, di = 0, no = 0, dO = 0;
  for (let y = 2; y < h - 2; y += 2) for (let x = 2; x < w - 2; x += 2) {
    const v = f.det[y*w+x];
    if (inside(x, y, -margin)) { ni++; di += v; } else if (!inside(x, y, margin) && inOuter(x, y)) { no++; dO += v; } }
  return { inD: ni ? di / ni : 0, outD: no ? dO / no : 1, outN: no };
}
const _detailCache = new WeakMap();

/* Fraction of a side where the colour is the same a little inside and a little
   outside: a fold or printed rule across one sheet, not the sheet's edge. */
function _sideSameBothWays(img, corners, side) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const s = Math.min(1, 900 / Math.max(W, H)), w = Math.max(2, Math.round(W * s)), h = Math.max(2, Math.round(H * s));
  const { sample } = _blurField(img, w, h), ks = ['tl','tr','br','bl'];
  const P = ks.map(k => ({ x: corners[k].x * s, y: corners[k].y * s })), cx = P.reduce((a, p) => a + p.x, 0) / 4, cy = P.reduce((a, p) => a + p.y, 0) / 4;
  const A = P[side], B = P[(side+1)%4], len = Math.hypot(B.x-A.x, B.y-A.y); if (len < 10) return 0;
  let nx = (B.y-A.y)/len, ny = -(B.x-A.x)/len; if (((A.x+B.x)/2-cx)*nx + ((A.y+B.y)/2-cy)*ny < 0) { nx = -nx; ny = -ny; }
  let n = 0, same = 0; const u = [0,0,0], v = [0,0,0];
  for (let j = 0; j < 17; j++) { const t = 0.1 + 0.8 * j / 16, px = A.x + (B.x-A.x)*t, py = A.y + (B.y-A.y)*t;
    if (!sample(px - nx*9, py - ny*9, u) || !sample(px + nx*9, py + ny*9, v)) continue; n++;
    // Same paper in shade still has the same hue; brightness may drop across a fold.
    const su = u[0]+u[1]+u[2]+1, sv = v[0]+v[1]+v[2]+1, ratio = sv / su;
    if (Math.hypot(u[0]/su - v[0]/sv, u[1]/su - v[1]/sv) < 0.03 && ratio > 0.55 && ratio < 1.8) same++; }
  return n >= 8 ? same / n : 0;
}

function snapQuadToEdges(img, corners, options = {}) {
  const keys = ['tl','tr','br','bl'];
  if (!corners || !keys.every(k => corners[k] && Number.isFinite(corners[k].x) && Number.isFinite(corners[k].y))) return corners;
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const s = Math.min(1, (options.maxSide || 900) / Math.max(W, H)), w = Math.max(2, Math.round(W * s)), h = Math.max(2, Math.round(H * s));
  const { a, sample } = _blurField(img, w, h);
  const P = keys.map(k => ({ x: corners[k].x * s, y: corners[k].y * s }));
  const cx = (P[0].x+P[1].x+P[2].x+P[3].x)/4, cy = (P[0].y+P[1].y+P[2].y+P[3].y)/4;
  const lines = [], inn = [0,0,0], out = [0,0,0], T = 48, sideInliers = [], sideSnapped = [];
  let snapped = 0;
  for (let side = 0; side < 4; side++) {
    const A = P[side], B = P[(side+1)%4], len = Math.hypot(B.x-A.x, B.y-A.y);
    if (len < 12) return corners;
    const tx = (B.x-A.x)/len, ty = (B.y-A.y)/len; let nx = ty, ny = -tx;
    if (((A.x+B.x)/2 - cx) * nx + ((A.y+B.y)/2 - cy) * ny < 0) { nx = -nx; ny = -ny; }
    const perp = Math.min(Math.hypot(P[(side+1)%4].x-P[(side+2)%4].x, P[(side+1)%4].y-P[(side+2)%4].y), Math.hypot(P[side].x-P[(side+3)%4].x, P[side].y-P[(side+3)%4].y));
    const R = Math.max(8, (options.band || 0.07) * perp), cand = [];
    const edgeTol = 0.015 * Math.max(w, h), onBorder = (A.y < edgeTol && B.y < edgeTol) || (A.y > h - edgeTol && B.y > h - edgeTol) || (A.x < edgeTol && B.x < edgeTol) || (A.x > w - edgeTol && B.x > w - edgeTol);
    if (onBorder) { lines.push({ x: A.x, y: A.y, dx: B.x - A.x, dy: B.y - A.y }); sideInliers.push(0); sideSnapped.push(false); continue; }
    for (let j = 0; j < T; j++) {
      const t = 0.08 + 0.84 * j / (T - 1), px = A.x + (B.x-A.x)*t, py = A.y + (B.y-A.y)*t;
      const profile = [];
      for (let d = -R; d <= R; d += 0.5) {
        const x = px + nx*d, y = py + ny*d;
        if (!sample(x - nx*2, y - ny*2, inn) || !sample(x + nx*2, y + ny*2, out)) continue;
        const g0 = inn[0]-out[0], g1 = inn[1]-out[1], g2 = inn[2]-out[2];
        let m = Math.sqrt((g0*g0+g1*g1+g2*g2)/3);
        if ((inn[0]+inn[1]+inn[2]) < (out[0]+out[1]+out[2]) - 6) m *= 0.35; // paper is brighter than the scene
        profile.push({ d, m });
      }
      // The sheet boundary is the OUTERMOST clear step; printed lines and
      // dark text bars inside the page can be stronger but lie further in.
      let peak = 0; for (const p of profile) if (p.m > peak) peak = p.m;
      if (peak > 6) {
        let pick = null;
        const far = [0,0,0];
        for (let i = profile.length - 1; i >= 0; i--) { const p = profile[i];
          if (p.m < 8 || (i > 0 && p.m < profile[i-1].m) || (i < profile.length - 1 && p.m < profile[i+1].m)) continue;
          // A printed stroke is dark only briefly: paper reappears just beyond it.
          sample(px + nx*(p.d - 2), py + ny*(p.d - 2), inn);
          if (sample(px + nx*(p.d + 12), py + ny*(p.d + 12), far) && (far[0]+far[1]+far[2]) >= (inn[0]+inn[1]+inn[2]) - 45) continue;
          if (p.m >= Math.max(8, 0.2 * peak)) { pick = p; break; } }
        if (pick) cand.push({ t, d: pick.d, m: pick.m });
      }
    }
    let inliers = null;
    if (cand.length >= 8) {
      let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      for (let it = 0; it < 200; it++) {
        const p = cand[(rnd()*cand.length)|0], q = cand[(rnd()*cand.length)|0];
        if (Math.abs(p.t - q.t) < 0.2) continue;
        const m = (q.d - p.d) / (q.t - p.t), c = p.d - m * p.t;
        const set = cand.filter(r => Math.abs(r.d - (m*r.t + c)) < 1.6);
        const strength = set.reduce((acc, r) => acc + r.m, 0);
        if (!inliers || set.length > inliers.length || (set.length === inliers.length && strength > inliers.strength)) { inliers = set; inliers.strength = strength; }
      }
    }
    let fit = null;
    if (inliers && inliers.length >= 0.45 * T) {
      let st = 0, sd = 0, stt = 0, std = 0; const k = inliers.length;
      for (const r of inliers) { st += r.t; sd += r.d; stt += r.t*r.t; std += r.t*r.d; }
      const m = (k*std - st*sd) / Math.max(1e-9, k*stt - st*st), c = (sd - m*st) / k;
      // Moving a side OUTWARD is only right when the strip it crosses is the
      // same paper as just inside the prediction. On checked cloth, tiles or a
      // patterned mat, the strip is pattern: keep the predicted side instead.
      let crossed = 0, paperLike = 0, lines = 0, patterned = 0; const ref = [0,0,0], mid = [0,0,0], q0 = [0,0,0], q1 = [0,0,0];
      for (let j = 0; j < 11; j++) { const t = 0.1 + 0.8 * j / 10, off = m * t + c;
        if (off < 3) continue; const px = A.x + (B.x-A.x)*t, py = A.y + (B.y-A.y)*t;
        if (!sample(px - nx*4, py - ny*4, ref)) continue;
        for (const f of [0.35, 0.7]) { if (!sample(px + nx*off*f, py + ny*off*f, mid)) continue; crossed++;
          if (Math.hypot(mid[0]-ref[0], mid[1]-ref[1], mid[2]-ref[2]) < 38) paperLike++; }
        // Pattern test: a strip of paper is smooth; tiles/checks have sharp steps inside it.
        if (off >= 6) { lines++; let step = 0;
          for (let d = 1; d + 2 <= off - 1.5; d += 1) { if (!sample(px + nx*d, py + ny*d, q0) || !sample(px + nx*(d+2), py + ny*(d+2), q1)) break;
            step = Math.max(step, Math.hypot(q1[0]-q0[0], q1[1]-q0[1], q1[2]-q0[2]) / 1.732); }
          if (step > 35) patterned++; } }
      if (crossed < 6 || paperLike >= 0.75 * crossed || !lines || patterned < 0.35 * lines) fit = { m, c };
    }
    if (fit) {
      const { m, c } = fit;
      lines.push({ x: A.x + nx*c, y: A.y + ny*c, dx: (B.x + nx*(m+c)) - (A.x + nx*c), dy: (B.y + ny*(m+c)) - (A.y + ny*c) });
      snapped++; sideInliers.push(inliers.length); sideSnapped.push(true);
    } else { lines.push({ x: A.x, y: A.y, dx: B.x - A.x, dy: B.y - A.y }); sideInliers.push(inliers ? inliers.length : 0); sideSnapped.push(false); }
  }
  const meet = (p, q) => { const den = p.dx*q.dy - p.dy*q.dx; if (Math.abs(den) < 1e-9) return null; const u = ((q.x-p.x)*q.dy - (q.y-p.y)*q.dx) / den; return { x: p.x + p.dx*u, y: p.y + p.dy*u }; };
  const result = {};
  for (let i = 0; i < 4; i++) { const q = meet(lines[(i+3)%4], lines[i]); if (!q) return corners; result[keys[i]] = { x: Math.max(0, Math.min(W, q.x / s)), y: Math.max(0, Math.min(H, q.y / s)) }; }
  // Reject a snap that collapses or wildly reshapes the quad.
  const area = q => Math.abs(keys.reduce((acc, k, i) => { const p1 = q[k], p2 = q[keys[(i+1)%4]]; return acc + p1.x*p2.y - p2.x*p1.y; }, 0)) / 2;
  const ratio = area(result) / Math.max(1, area(corners));
  if (ratio < 0.75 || ratio > 1.33) return Object.assign({}, corners, { sideInliers: [0,0,0,0], sideSnapped: [false,false,false,false] });
  result.snappedSides = snapped; result.sideInliers = sideInliers; result.sideSnapped = sideSnapped;
  return result;
}

/* ═══════════════════════════════════════════════════════════════
   MASTER ENTRY — runs all 4 methods, returns highest-confidence result
═══════════════════════════════════════════════════════════════ */
function detectDocumentCornersWithScore(img) {
  if (!window.cvReady || typeof cv === 'undefined' || !cv.Mat) {
    return { corners: getFallbackCorners(img), score: 0 };
  }

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

  /* ── 0: Background vs Document Otsu Segmentation (CamScanner Core) ── */
  const rOtsu = _methodOtsu(canvas, dW, dH, dArea);
  if (rOtsu && rOtsu.score > bestScore) {
    bestScore = rOtsu.score;
    best = rOtsu.corners;
  }

  /* ── A: Enhanced Canny — 6 parameter sets (runs if Otsu score < 0.70) ── */
  if (bestScore < 0.70) {
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

  return { corners: best, score: bestScore };
}

function detectDocumentCorners(img) {
  const res = detectDocumentCornersWithScore(img);
  if (res && res.corners) {
    console.log(`✓ Document detected — method score: ${res.score.toFixed(3)}`);
    _showDetectionBadge(res.score);
    return res.corners;
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
   METHOD 0 — Background vs Document Segmentation (CamScanner Core)
   Separates document sheet from tablecloth, bedsheet, or desk.
   Handles both light paper on dark surface and dark paper on light surface.
   Uses multi-scale morphological closing to ensure full page boundary is closed.
═══════════════════════════════════════════════════════════════ */
function _methodOtsu(canvas, W, H, imgArea) {
  const mats = [];
  const T = m => { mats.push(m); return m; };
  try {
    const src  = T(cv.imread(canvas));
    const gray = T(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    let best = null, bestScore = 0;

    for (const blurK of [11, 21]) {
      const blurred = T(new cv.Mat());
      cv.GaussianBlur(gray, blurred, new cv.Size(blurK, blurK), 0);

      for (const inv of [false, true]) {
        const thresh = T(new cv.Mat());
        const type = inv ? (cv.THRESH_BINARY_INV + cv.THRESH_OTSU) : (cv.THRESH_BINARY + cv.THRESH_OTSU);
        cv.threshold(blurred, thresh, 0, 255, type);

        for (const morphK of [11, 21]) {
          const k = T(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(morphK, morphK)));
          const closed = T(new cv.Mat());
          cv.morphologyEx(thresh, closed, cv.MORPH_CLOSE, k);

          const contours = T(new cv.MatVector());
          const hier = T(new cv.Mat());
          cv.findContours(closed, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

          for (let i = 0; i < contours.size(); i++) {
            const cnt = contours.get(i);
            const area = cv.contourArea(cnt);
            if (area > imgArea * 0.20 && area < imgArea * 0.98) {
              const peri = cv.arcLength(cnt, true);
              for (const eps of [0.015, 0.02, 0.025, 0.03, 0.04]) {
                const approx = T(new cv.Mat());
                cv.approxPolyDP(cnt, approx, eps * peri, true);
                if (approx.rows >= 4 && approx.rows <= 8) {
                  const pts = [];
                  for (let j = 0; j < approx.rows; j++) {
                    pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
                  }
                  const sorted = _sortCorners(pts);
                  const score = _scoreQuad(sorted, imgArea);
                  if (score > bestScore) {
                    bestScore = score;
                    best = sorted;
                  }
                }
              }
            }
            cnt.delete();
          }
        }
      }
    }
    return best ? { corners: best, score: bestScore } : null;
  } catch (e) {
    return null;
  } finally {
    mats.forEach(m => { try { m.delete(); } catch(e) {} });
  }
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

    /* Try increasingly loose epsilon to find polygon with 4 to 8 vertices.
       Tightest epsilon = most precise corners; stop at first success.
       Extracts the 4 extreme quadrant corners to handle rounded/dog-eared corners. */
    let found = false;
    for (const eps of [0.01, 0.02, 0.03, 0.04, 0.06, 0.08, 0.10]) {
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, eps * peri, true);

      if (approx.rows >= 4 && approx.rows <= 8) {
        const pts = [];
        for (let j = 0; j < approx.rows; j++)
          pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });

        const sorted = _sortCorners(pts);
        const score  = _scoreQuad(sorted, imgArea);

        if (score > bestScore) { bestScore = score; best = sorted; }
        approx.delete();
        found = true;
        break;  // stop — tightest epsilon that gives a valid quad is the best
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

function _calcQuadArea(c) {
  if (!c || !c.tl || !c.tr || !c.br || !c.bl) return 0;
  return 0.5 * Math.abs(
    c.tl.x * (c.tr.y - c.bl.y) +
    c.tr.x * (c.br.y - c.tl.y) +
    c.br.x * (c.bl.y - c.tr.y) +
    c.bl.x * (c.tl.y - c.br.y)
  );
}

/* ═══════════════════════════════════════════════════════════════
   CROP EDITOR
   Visual overlay with corner + edge handles, perspective warp.
   Updated: professional L-bracket corners (like a document scanner)
   + subtle orange tint fill inside selection.
═══════════════════════════════════════════════════════════════ */
/* White letterbox bars added around a photo by an app (full-height columns or
   full-width rows of plain white at the edges). Returns the picture area. */
function _letterboxContent(img) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height, s = Math.min(1, 700 / Math.max(W, H));
  const w = Math.max(8, Math.round(W * s)), h = Math.max(8, Math.round(H * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, lum = i => .299*d[i] + .587*d[i+1] + .114*d[i+2];
  const plainCol = cx => { for (let y = 0; y < h; y++) if (lum((y*w+cx)*4) < 242) return false; return true; };
  const plainRow = cy => { for (let xx = 0; xx < w; xx++) if (lum((cy*w+xx)*4) < 242) return false; return true; };
  let L = 0, R = w - 1, T = 0, B = h - 1;
  while (L < w * 0.4 && plainCol(L)) L++;
  while (R > w * 0.6 && plainCol(R)) R--;
  while (T < h * 0.4 && plainRow(T)) T++;
  while (B > h * 0.6 && plainRow(B)) B--;
  const minBar = 0.025;
  // A real bar ends abruptly in picture: the first column/row after it is
  // mostly non-white. A blank page margin ends in a few text strokes only.
  const fillCol = cx => { let n = 0; for (let y = 0; y < h; y++) if (lum((y*w+cx)*4) < 242) n++; return n / h; };
  const fillRow = cy => { let n = 0; for (let xx = 0; xx < w; xx++) if (lum((cy*w+xx)*4) < 242) n++; return n / w; };
  const bar = (size, total, fill) => size >= total * minBar && fill >= 0.6;
  const l = bar(L, w, fillCol(Math.min(w-1, L+2))) ? L + 1 : 0, r = bar(w - 1 - R, w, fillCol(Math.max(0, R-2))) ? R - 1 : w - 1;
  const t = bar(T, h, fillRow(Math.min(h-1, T+2))) ? T + 1 : 0, b = bar(h - 1 - B, h, fillRow(Math.max(0, B-2))) ? B - 1 : h - 1;
  if (l === 0 && r === w - 1 && t === 0 && b === h - 1) return null;
  if (r - l < w * 0.3 || b - t < h * 0.3) return null;
  return { x: Math.round(l / s), y: Math.round(t / s), w: Math.round((r - l + 1) / s), h: Math.round((b - t + 1) / s) };
}

class CropEditor {
  constructor(canvasId) {
    this.canvas  = document.getElementById(canvasId);
    this.ctx     = this.canvas ? this.canvas.getContext('2d') : null;
    this.img     = null;
    this.corners = null;
    this.scale   = 1;
    this.rotation = 0;
    this.displayInset = 16;
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

  /* Async variant: Awaits OpenCV readiness, runs multi-scale Otsu/Canny
     and DocAligner ML model, then uses intelligent arbitration:
     If OpenCV finds the physical document paper boundary (area >= 35% of frame,
     score >= 0.55), it wins over inner table/photo boxes. */
  async setImageAsync(img) {
    // Photos exported by some phone/scanner apps carry plain white bars on the
    // sides (letterboxing). Those bars look like paper and pull the outline
    // onto the photo frame, so detect inside the real picture area instead.
    if (!this._inLetterbox) {
      const box = _letterboxContent(img);
      if (box) {
        const sub = document.createElement('canvas'); sub.width = box.w; sub.height = box.h;
        sub.getContext('2d').drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
        const inner = new CropEditor(null); inner.silent = true; inner._inLetterbox = true;
        await inner.setImageAsync(sub);
        const shift = q => q && Object.fromEntries(['tl','tr','br','bl'].map(k => [k, { x: q[k].x + box.x, y: q[k].y + box.y }]));
        this.img = img; this.rotation = 0;
        this.corners = shift(inner.corners); this.legacyCorners = shift(inner.legacyCorners || inner.corners);
        this.detectionNeedsReview = inner.detectionNeedsReview; this.hasPhotoPadding = !!inner.hasPhotoPadding;
        this.lastBoundary = Object.assign({}, inner.lastBoundary || {}, { letterbox: box });
        this.draw(); return;
      }
    }
    this.img      = img;
    this.rotation = 0;
    this.hasPhotoPadding = false;

    const W = img.naturalWidth  || img.width;
    const H = img.naturalHeight || img.height;
    const totalArea = W * H;

    // 0. Fast path (CamScanner-style): a confident heatmap model gives the
    //    page corners directly; snap each side to the real paper edge.
    let fastML;
    try {
      const fast = fastML = window.MLDetector ? await window.MLDetector.detect(img) : null;
      if (fast && window.MLDetector.kind === 'heatmap' && window.MLDetector.confidence >= 0.45) {
        const sides = 4;
        this.corners = { tl: fast.tl, tr: fast.tr, br: fast.br, bl: fast.bl };
        this.legacyCorners = JSON.parse(JSON.stringify(this.corners));
        this.detectionNeedsReview = window.MLDetector.confidence < 0.6;
        this.lastBoundary = { selected_name: 'heatmap-model-snapped', ensemble: window.MLDetector.lastDebug, confidence: window.MLDetector.confidence, snappedSides: sides, corners: this.corners, uncertain: this.detectionNeedsReview };
        if (!this.silent) _showMLBadge();
        this.draw();
        return;
      }
    } catch (e) { console.warn('Heatmap fast path unavailable:', e); }

    // 1. Wait up to 2500ms for OpenCV to compile/load
    await waitForCvReady(2500);

    // 2. Run OpenCV multi-method corner detection
    let cvRes = null;
    try {
      cvRes = detectDocumentCornersWithScore(img);
    } catch (e) {
      console.warn('OpenCV detection error:', e);
    }
    const cvCorners = cvRes ? cvRes.corners : null;
    const cvScore   = cvRes ? cvRes.score : 0;
    const cvArea    = cvCorners ? _calcQuadArea(cvCorners) : 0;
    const cvAreaRatio = totalArea > 0 ? cvArea / totalArea : 0;

    // 3. Run ML detector if available
    let mlCorners = null;
    try {
      mlCorners = fastML !== undefined ? fastML : (window.MLDetector ? await window.MLDetector.detect(img) : null);
    } catch (e) { mlCorners = null; }
    const mlArea = mlCorners ? _calcQuadArea(mlCorners) : 0;
    const mlAreaRatio = totalArea > 0 ? mlArea / totalArea : 0;

    console.log(`[Auto-Crop] CV: score=${cvScore.toFixed(3)}, area=${(cvAreaRatio*100).toFixed(1)}% | ML: area=${(mlAreaRatio*100).toFixed(1)}%`);

    // 4. Intelligent Arbitration between CV and ML:
    // When a document has inner printed tables/boxes (like an official certificate),
    // ML often mistakenly snaps to the inner table (< 30% area).
    // Otsu segmentation finds the true physical sheet of paper (> 40% area).
    if (cvCorners && cvAreaRatio >= 0.35 && cvScore >= 0.55) {
      this.corners = cvCorners;
      if (!this.silent) _showDetectionBadge(cvScore);
      console.log('✓ Auto-Crop selected full paper boundary (OpenCV Otsu)');
    } else if (mlCorners && mlAreaRatio >= 0.35) {
      this.corners = mlCorners;
      if (!this.silent) _showMLBadge();
      console.log('✓ Auto-Crop selected ML boundary');
    } else if (cvCorners && cvScore >= 0.35) {
      this.corners = cvCorners;
      if (!this.silent) _showDetectionBadge(cvScore);
    } else if (mlCorners) {
      this.corners = mlCorners;
      if (!this.silent) _showMLBadge();
    } else if (cvCorners) {
      this.corners = cvCorners;
      if (!this.silent) _showDetectionBadge(cvScore);
    } else {
      this.corners = getFallbackCorners(img);
      if (!this.silent) _showDetectionBadge(0);
    }
    // Preserve the pre-update result so every image can switch back instantly.
    this.legacyCorners = JSON.parse(JSON.stringify(this.corners));
    // Verify CV/ML against the visible paper boundary before committing a crop.
    this.detectionNeedsReview = false;
    if (window.selectDocumentBoundary) {
      try {
        const verified = window.improveDocumentBoundary
          ? await window.improveDocumentBoundary(img, this.corners, cvRes, mlCorners, window.MLDetector?.kind === 'heatmap' ? undefined : window.MLDetector?.detect)
          : window.selectDocumentBoundary(img, this.corners, cvRes, mlCorners);
        this.lastBoundary = verified;
        this.corners = verified.corners;
        this.detectionNeedsReview = verified.uncertain;
        this.hasPhotoPadding = !!verified.hasPhotoPadding;
        if (!this.silent) _showDetectionBadge(verified.uncertain ? 0.25 : 0.8);
        if (!verified.uncertain) {
          const badge = document.getElementById('detectionBadge');
          if (badge && !this.silent) badge.textContent = 'Corners suggested — check page edges';
        }
      } catch (error) {
        console.warn('Boundary verification unavailable; keeping initial corners:', error);
      }
    }
    this.draw();
  }

  _getRotatedImg() {
    if (this.rotation === 0) { this._rotationCache = null; return this.img; }
    if (this._rotationCache?.image === this.img && this._rotationCache.rotation === this.rotation) return this._rotationCache.canvas;
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
    this._rotationCache = {image:this.img,rotation:this.rotation,canvas:c};
    return c;
  }

  draw() {
    if (!this.canvas || !this.img || !this.corners) return;
    const src  = this._getRotatedImg();
    const srcW = src.width  || src.naturalWidth;
    const srcH = src.height || src.naturalHeight;

    const inset = this.displayInset || 0;
    this.scale       = Math.min(Math.max(1,this._maxW-inset*2) / srcW, Math.max(1,this._maxH-inset*2) / srcH, 1);
    this.canvas.width  = Math.round(srcW * this.scale) + inset*2;
    this.canvas.height = Math.round(srcH * this.scale) + inset*2;
    const ctx = this.ctx, s = this.scale;
    this._brandColor = _cropBrandColor();

    ctx.drawImage(src, inset, inset, this.canvas.width-inset*2, this.canvas.height-inset*2);

    /* Shade only the area outside the selection. Clearing with
       destination-out would also erase the document image underneath. */
    const cp = this._scaledCorners(s);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.50)';
    ctx.beginPath();
    ctx.rect(0, 0, this.canvas.width, this.canvas.height);
    ctx.moveTo(cp.tl.x, cp.tl.y); ctx.lineTo(cp.tr.x, cp.tr.y);
    ctx.lineTo(cp.br.x, cp.br.y); ctx.lineTo(cp.bl.x, cp.bl.y);
    ctx.closePath(); ctx.fill('evenodd');
    ctx.restore();

    /* Selection border (green while a dragged side is locked onto a paper edge) */
    ctx.strokeStyle = this._drag && this._snapped ? '#22c55e' : this._brandColor;
    ctx.lineWidth   = this._drag && this._snapped ? 3 : 2.5;
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

    const ix   = (pt.x-(this.displayInset||0)) / s, iy = (pt.y-(this.displayInset||0)) / s;
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
    ctx.strokeStyle = this._brandColor; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = this._brandColor; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lx - R + 8, ly); ctx.lineTo(lx + R - 8, ly);
    ctx.moveTo(lx, ly - R + 8); ctx.lineTo(lx, ly + R - 8);
    ctx.stroke();
    ctx.fillStyle = this._brandColor;
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
    ctx.strokeStyle = this._brandColor;
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
    ctx.strokeStyle = this._brandColor;
    ctx.lineWidth   = W;
    ctx.beginPath();
    ctx.moveTo(x + sx * ARM, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * ARM);
    ctx.stroke();

    /* Filled dot as drag target */
    ctx.fillStyle   = this._brandColor;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    ctx.restore();
  }

  _drawEdgeHandle(ctx, x, y) {
    ctx.fillStyle   = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = this._brandColor;
    ctx.lineWidth   = 2;
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  _scaledCorners(s) {
    return {
      tl: { x: this.corners.tl.x * s+(this.displayInset||0), y: this.corners.tl.y * s+(this.displayInset||0) },
      tr: { x: this.corners.tr.x * s+(this.displayInset||0), y: this.corners.tr.y * s+(this.displayInset||0) },
      br: { x: this.corners.br.x * s+(this.displayInset||0), y: this.corners.br.y * s+(this.displayInset||0) },
      bl: { x: this.corners.bl.x * s+(this.displayInset||0), y: this.corners.bl.y * s+(this.displayInset||0) },
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

  /* MAGNETIC EDGES — while a corner or side is dragged, the side(s) it moves
     are pulled onto a clear paper edge within a small radius, the way phone
     scanner apps do. Away from any edge nothing snaps, so free placement
     still works. Returns corners in image pixels. */
  _magnetField() {
    const src = this._getRotatedImg(), W = src.width || src.naturalWidth, H = src.height || src.naturalHeight;
    const k = Math.min(1, 900 / Math.max(W, H)), w = Math.max(2, Math.round(W * k)), h = Math.max(2, Math.round(H * k));
    const { sample } = _blurField(src, w, h);
    return { sample, k, W, H };
  }
  // Best parallel shift of segment A→B (image px) toward a strong straight
  // edge, within ±R image px. Only the part of the side near `focus` counts
  // (0 = A end, 1 = B end, null = whole side).
  _magnetSide(f, A, B, R, focus) {
    const ax = A.x * f.k, ay = A.y * f.k, bx = B.x * f.k, by = B.y * f.k, len = Math.hypot(bx-ax, by-ay);
    if (len < 12) return null;
    const nx = -(by-ay) / len, ny = (bx-ax) / len, r = Math.max(3, R * f.k), u = [0,0,0], v = [0,0,0];
    const ts = []; for (let j = 0; j < 24; j++) { const t = focus == null ? 0.08 + 0.84 * j / 23 : (focus ? 0.55 + 0.4 * j / 23 : 0.05 + 0.4 * j / 23); ts.push(t); }
    let best = { off: 0, g: -1 }, g0 = 0; const prof = [];
    for (let off = -r; off <= r; off += 0.5) {
      // A paper edge is a STEP: one colour on one side all along the line,
      // another on the other. Text and printed rules average out here.
      let n = 0; const su = [0,0,0], sv = [0,0,0];
      for (const t of ts) { const px = ax + (bx-ax)*t + nx*off, py = ay + (by-ay)*t + ny*off;
        if (!f.sample(px - nx*3, py - ny*3, u) || !f.sample(px + nx*3, py + ny*3, v)) continue; n++;
        for (let c = 0; c < 3; c++) { su[c] += u[c]; sv[c] += v[c]; } }
      if (n < 8) continue;
      const g = Math.hypot(su[0]-sv[0], su[1]-sv[1], su[2]-sv[2]) / n;
      if (Math.abs(off) < 0.26) g0 = g;
      prof.push({ off, g });
      if (g > best.g) best = { off, g };
    }
    // Snap only to a clear edge, clearly stronger than where the side is now;
    // of several strong edges (a card's printed header line), take the nearest.
    if (best.g < 32) return null;
    const peaks = prof.filter((q, i) => (i === 0 || q.g >= prof[i-1].g) && (i === prof.length - 1 || q.g >= prof[i+1].g));
    // The sheet's edge is the OUTERMOST clear step (inside it there can be
    // printed headers or text rows). For clockwise corners the outward
    // direction is negative offset.
    for (const q of peaks.sort((a, b) => a.off - b.off)) if (q.g >= 0.4 * best.g && q.g >= 32) { best = q; break; }
    const d = best.off / f.k;
    return { A: { x: A.x + nx/1 * d, y: A.y + ny * d }, B: { x: B.x + nx * d, y: B.y + ny * d } };
  }
  _magnetApply() {
    if (!this._drag || this.magnet === false) return;
    const f = this._magnetField(), ks = ['tl','tr','br','bl'], C = this.corners, R = 10 / Math.max(1e-6, this.scale);
    const meet = (p1, p2, q1, q2) => { const d = (p2.x-p1.x)*(q2.y-q1.y) - (p2.y-p1.y)*(q2.x-q1.x); if (Math.abs(d) < 1e-9) return null;
      const t = ((q1.x-p1.x)*(q2.y-q1.y) - (q1.y-p1.y)*(q2.x-q1.x)) / d; return { x: p1.x + (p2.x-p1.x)*t, y: p1.y + (p2.y-p1.y)*t }; };
    const inside = p => p && p.x >= -1 && p.y >= -1 && p.x <= f.W + 1 && p.y <= f.H + 1;
    if (this._drag.type === 'corner') {
      const i = ks.indexOf(this._drag.key), P = C[ks[i]], prev = C[ks[(i+3)%4]], next = C[ks[(i+1)%4]];
      const s1 = this._magnetSide(f, prev, P, R, 1), s2 = this._magnetSide(f, P, next, R, 0);
      const L1 = s1 ? [s1.A, s1.B] : [prev, P], L2 = s2 ? [s2.A, s2.B] : [P, next];
      if (!s1 && !s2) { this._snapped = false; return; }
      const q = meet(L1[0], L1[1], L2[0], L2[1]);
      if (inside(q) && Math.hypot(q.x - P.x, q.y - P.y) <= R * 1.5) { C[ks[i]] = { x: Math.max(0, Math.min(f.W, q.x)), y: Math.max(0, Math.min(f.H, q.y)) }; this._snapped = true; }
      else this._snapped = false;
    } else {
      const map = { top: [0, 1], right: [1, 2], bottom: [2, 3], left: [3, 0] }[this._drag.key], a = ks[map[0]], b = ks[map[1]];
      const sd = this._magnetSide(f, C[a], C[b], R, null);
      if (!sd) { this._snapped = false; return; }
      const pa = C[ks[(map[0]+3)%4]], nb = C[ks[(map[1]+1)%4]];
      const qa = meet(sd.A, sd.B, pa, C[a]), qb = meet(sd.A, sd.B, C[b], nb);
      if (inside(qa) && inside(qb)) { C[a] = qa; C[b] = qb; this._snapped = true; } else this._snapped = false;
    }
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
      try { this._magnetApply(); } catch (err) { this._snapped = false; }
      this.draw();
    };

    const onUp = () => {
      const wasDragging = !!this._drag;
      this._drag = null; this._snapped = false;
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

  useOriginalDetection() {
    if (!this.legacyCorners) return;
    this.corners = JSON.parse(JSON.stringify(this.legacyCorners));
    this.detectionNeedsReview = true;
    _showDetectionBadge(0.25);
    this.draw();
  }

  async resetCorners() {
    if (this.img) await this.setImageAsync(this._getRotatedImg());
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
    if (!this.img || deg % 90 !== 0) return;
    const source = this._getRotatedImg();
    let width = source.naturalWidth || source.width;
    let height = source.naturalHeight || source.height;
    const steps = ((deg % 360) + 360) % 360 / 90;
    // Rotate the selected quadrilateral with the pixels. Re-detecting here
    // discarded manual adjustments and could select a different inner box.
    for (let step = 0; step < steps; step++) {
      const turn = point => ({ x: height - point.y, y: point.x });
      const old = this.corners;
      this.corners = { tl: turn(old.bl), tr: turn(old.tl), br: turn(old.tr), bl: turn(old.br) };
      if (this.legacyCorners) {
        const previous = this.legacyCorners;
        this.legacyCorners = { tl: turn(previous.bl), tr: turn(previous.tl), br: turn(previous.tr), bl: turn(previous.br) };
      }
      [width, height] = [height, width];
    }
    this.rotation = (this.rotation + deg + 360) % 360;
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

  const rOtsu = _methodOtsu(canvas, W, H, dArea);
  if (rOtsu && rOtsu.score > bestScore) {
    bestScore = rOtsu.score;
    best = rOtsu.corners;
  }
  if (bestScore >= 0.70) return best;

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
window.snapQuadToEdges       = snapQuadToEdges;
window.getFallbackCorners    = getFallbackCorners;
window.ensureCornerOrder     = ensureCornerOrder;
window.onOpenCvReady         = onOpenCvReady;
window._perspectiveWarpCanvas = _perspectiveWarpCanvas;
window._computeHomography    = _computeHomography;
window._detectFromCanvas     = _detectFromCanvas;
