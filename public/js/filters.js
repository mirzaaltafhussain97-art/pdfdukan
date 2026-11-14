/* ================================================================
   CamMaster — Professional Document Filter Engine
   Browser-local document enhancement pipelines:
   • Magic Color (Magic Pro): High-Dynamic-Range document normalization +
     unsharp masking + deep-black tone curve (0..12) + pure white paper (255)
   • B&W: Adaptive Gaussian Thresholding (handles shadows, keeps faint handwriting)
   • B&W Soft: High-contrast anti-aliased grayscale document (CamScanner B&W 2)
   • No Shadow: Multi-scale background leveling preserving color stamps & signatures
   • Enhance: Auto-level color balance + contrast stretch
   • Lighten, Grayscale, Eco: Tuned for document readability
================================================================ */

const FILTERS = [
  { id: 'magicpro',  name: 'Magic Pro', icon: '🌟' },
  { id: 'enhance',   name: 'Enhance',     icon: '✨' },
  { id: 'noshadow',  name: 'No Shadow',   icon: '🔆' },
  { id: 'bw',        name: 'B&W',         icon: '⬛' },
  { id: 'bwsoft',    name: 'B&W Soft',    icon: '🌫️' },
  { id: 'grayscale', name: 'Grayscale',   icon: '🔲' },
  { id: 'invert',    name: 'Invert',      icon: '◐' },
  { id: 'lighten',   name: 'Lighten',     icon: '☀️'  },
  { id: 'eco',       name: 'Eco',         icon: '🌿' },
  { id: 'original',  name: 'Original',    icon: '📷' },
];

/* ── MAIN ENTRY ──────────────────────────────────────────────── */
function applyFilterToContext(ctx, w, h, filterId, adjustments = {}) {
  const { brightness = 0, contrast = 0, sharpness = 0, saturation = 0 } = adjustments;

  if (filterId === 'original') {
    if (brightness !== 0 || contrast !== 0 || saturation !== 0) {
      const id2 = ctx.getImageData(0, 0, w, h);
      _applyAdjustments(id2.data, brightness, contrast, saturation);
      ctx.putImageData(id2, 0, 0);
    }
    if (sharpness > 0) _applySharpen(ctx, w, h, sharpness);
    return;
  }

  // ── OpenCV Paths (direct WebAssembly execution) ──
  if (window.cvReady && typeof cv !== 'undefined' && cv.Mat) {
    let cvHandled = false;
    try {
      switch (filterId) {
        case 'magicpro':
          _applyMagicProCV(ctx, w, h);
          cvHandled = true;
          break;
        case 'bw':
          _applyBWCV(ctx, w, h);
          cvHandled = true;
          break;
        case 'bwsoft':
          _applyBWSoftCV(ctx, w, h);
          cvHandled = true;
          break;
        case 'noshadow':
          _applyNoShadowCV(ctx, w, h);
          cvHandled = true;
          break;
        case 'enhance':
          _applyEnhanceCV(ctx, w, h);
          cvHandled = true;
          break;
        case 'grayscale':
          _applyGrayscaleCV(ctx, w, h);
          cvHandled = true;
          break;
      }
    } catch (e) {
      console.warn('OpenCV filter execution failed, falling back to JS:', e);
      cvHandled = false;
    }

    if (cvHandled) {
      if (brightness !== 0 || contrast !== 0 || saturation !== 0) {
        const id2 = ctx.getImageData(0, 0, w, h);
        _applyAdjustments(id2.data, brightness, contrast, saturation);
        ctx.putImageData(id2, 0, 0);
      }
      if (sharpness > 0) _applySharpen(ctx, w, h, sharpness);
      return;
    }
  }

  // ── Pure-JS Fallback Path ──
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  switch (filterId) {
    case 'enhance':   _applyEnhance(data, w, h); break;
    case 'magicpro':  _applyMagicPro(data, w, h); break;
    case 'lighten':   _applyLighten(data, w, h); break;
    case 'noshadow':  _applyNoShadow(data, w, h); break;
    case 'bw':        _applyBW(data, w, h); break;
    case 'bwsoft':    _applyBWSoft(data, w, h); break;
    case 'grayscale': _applyGrayscale(data, w, h); break;
    case 'invert':    _applyInvert(data); break;
    case 'eco':       _applyEco(data, w, h); break;
  }

  if (brightness !== 0 || contrast !== 0 || saturation !== 0) {
    _applyAdjustments(data, brightness, contrast, saturation);
  }

  ctx.putImageData(imageData, 0, 0);

  if (sharpness > 0) _applySharpen(ctx, w, h, sharpness);
}

/* ═══════════════════════════════════════════════════════════════
   1. MAGIC COLOR (MAGIC PRO) — OPENCV PIPELINE
   Browser-local document enhancement:
   • 100% pure snow-white paper (255)
   • Crisp deep black text (0..12) with unsharp masking on ink strokes
   • Facial photos and halftone stamps retain clear midtone gradients
   • Blue ink signatures and official red stamps pop with vibrant color
═══════════════════════════════════════════════════════════════ */
function _applyMagicProCV(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  _applyMagicPro(img.data, w, h);
  ctx.putImageData(img, 0, 0);
}

/* ═══════════════════════════════════════════════════════════════
   2. B&W (BINARY SCAN) — OPENCV ADAPTIVE GAUSSIAN THRESHOLD
   CamScanner's crisp 1-bit scan:
   • Removes paper grain & shadows completely.
   • Deep shadows on the page NEVER turn black.
   • Faint ballpoint pen and pencil handwriting stay solid black.
═══════════════════════════════════════════════════════════════ */
function _applyBWCV(ctx, w, h) {
  let src, gray, blur, dst;
  try {
    src  = cv.imread(ctx.canvas);
    gray = new cv.Mat();
    blur = new cv.Mat();
    dst  = new cv.Mat();

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0);

    let blockSize = Math.round(Math.min(w, h) / 30);
    if (blockSize % 2 === 0) blockSize++;
    blockSize = Math.max(15, Math.min(51, blockSize));

    cv.adaptiveThreshold(
      blur, dst, 255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      blockSize,
      10
    );

    cv.imshow(ctx.canvas, dst);
  } finally {
    [src, gray, blur, dst].forEach(m => {
      if (m && m.delete) try { m.delete(); } catch(e) {}
    });
  }
}

/* ═══════════════════════════════════════════════════════════════
   3. B&W SOFT (SMOOTH GRAYSCALE DOCUMENT) — OPENCV PIPELINE
   Matches CamScanner "B&W 2":
   Flattens background to pure white while preserving smooth anti-aliased
   edges on font strokes so high-DPI scans look sharp without pixelation.
═══════════════════════════════════════════════════════════════ */
function _applyBWSoftCV(ctx, w, h) {
  let src, gray, ds, dilated, kDil, bgSmall, bgUp;
  try {
    src  = cv.imread(ctx.canvas);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    const scale = 4;
    const bW = Math.max(8, Math.round(w / scale));
    const bH = Math.max(8, Math.round(h / scale));
    ds = new cv.Mat();
    cv.resize(gray, ds, new cv.Size(bW, bH), 0, 0, cv.INTER_AREA);

    dilated = new cv.Mat();
    kDil = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(15, 15));
    cv.dilate(ds, dilated, kDil);

    bgSmall = new cv.Mat();
    cv.GaussianBlur(dilated, bgSmall, new cv.Size(31, 31), 0);

    bgUp = new cv.Mat();
    cv.resize(bgSmall, bgUp, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR);

    const grayData = gray.data;
    const bgData   = bgUp.data;
    const img = ctx.getImageData(0, 0, w, h);
    const d   = img.data;

    for (let px = 0, i = 0; px < w * h; px++, i += 4) {
      const bg = Math.max(bgData[px], 25);
      const lumaIn = (grayData[px] / bg) * 255;

      let lumaOut;
      if (lumaIn >= 205) {
        lumaOut = 255;
      } else if (lumaIn <= 100) {
        lumaOut = (lumaIn / 100) * 12;
      } else {
        const t = (lumaIn - 100) / (205 - 100);
        lumaOut = 12 + t * t * (3 - 2 * t) * (255 - 12);
      }

      const v = _clamp(lumaOut);
      d[i] = d[i+1] = d[i+2] = v;
    }
    ctx.putImageData(img, 0, 0);
  } finally {
    [src, gray, ds, dilated, kDil, bgSmall, bgUp].forEach(m => {
      if (m && m.delete) try { m.delete(); } catch(e) {}
    });
  }
}

/* ═══════════════════════════════════════════════════════════════
   4. NO SHADOW — OPENCV PIPELINE
   Eliminates shadows from hands, phones, and uneven room lighting
   while preserving natural document colors.
═══════════════════════════════════════════════════════════════ */
/* Enhance, Lighten and Eco share the paper-light correction: shadows and
   creases go first, then each filter applies its own tone. */
function _fieldTone(data, w, h, mode) {
  if (_scanPhotoFrame(data, w, h)) return false;
  const field = _paperField(data, w, h), ar = Math.max(w, h) / Math.max(1, Math.min(w, h));
  if (!field || field.covered > 0.55 || (mode !== 'eco' && ar > 1.45 && ar < 1.75 && field.tinted2 > 0.2)) return false;
  _applyPaperTone(data, w, h, field, mode); return true;
}
/* No Shadow: same light correction as Magic Pro, natural tones kept. */
function _noShadowField(data, w, h) {
  if (_scanPhotoFrame(data, w, h)) return false;
  const field = _paperField(data, w, h);
  const ar = Math.max(w, h) / Math.max(1, Math.min(w, h));
  if (!field || field.covered > 0.55 || (ar > 1.45 && ar < 1.75 && field.tinted2 > 0.2)) return false;   // ID cards keep their colours
  _applyPaperTone(data, w, h, field, 'soft'); return true;
}
function _applyNoShadowCV(ctx, w, h) {
  { const im = ctx.getImageData(0, 0, w, h); if (_noShadowField(im.data, w, h)) { ctx.putImageData(im, 0, 0); return; } }
  let src, gray, ds, dilated, kDil, bgSmall, bgUp;
  try {
    src  = cv.imread(ctx.canvas);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    const scale = 4;
    const bW = Math.max(8, Math.round(w / scale));
    const bH = Math.max(8, Math.round(h / scale));
    ds = new cv.Mat();
    cv.resize(gray, ds, new cv.Size(bW, bH), 0, 0, cv.INTER_AREA);

    dilated = new cv.Mat();
    kDil = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(15, 15));
    cv.dilate(ds, dilated, kDil);

    bgSmall = new cv.Mat();
    cv.GaussianBlur(dilated, bgSmall, new cv.Size(31, 31), 0);

    bgUp = new cv.Mat();
    cv.resize(bgSmall, bgUp, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR);

    const bgData = bgUp.data;
    const img = ctx.getImageData(0, 0, w, h);
    const d   = img.data;

    for (let px = 0, i = 0; px < w * h; px++, i += 4) {
      const bgVal = Math.max(bgData[px], 32);
      const gain  = Math.min(2.5, 235 / bgVal);

      let r = d[i]     * gain;
      let g = d[i + 1] * gain;
      let b = d[i + 2] * gain;

      const luma   = 0.299 * r + 0.587 * g + 0.114 * b;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);

      if (chroma < 30 && luma > 195) {
        const t = (luma - 195) / (255 - 195);
        const f = t * t * (3 - 2 * t);
        r = r + (255 - r) * f;
        g = g + (255 - g) * f;
        b = b + (255 - b) * f;
      }

      d[i]   = _clamp(r);
      d[i+1] = _clamp(g);
      d[i+2] = _clamp(b);
    }
    ctx.putImageData(img, 0, 0);
  } finally {
    [src, gray, ds, dilated, kDil, bgSmall, bgUp].forEach(m => {
      if (m && m.delete) try { m.delete(); } catch(e) {}
    });
  }
}

/* ═══════════════════════════════════════════════════════════════
   5. ENHANCE — OPENCV PIPELINE
   Balances illumination, auto-levels yellow paper tint, and boosts text clarity.
═══════════════════════════════════════════════════════════════ */
function _applyEnhanceCV(ctx, w, h) {
  { const im = ctx.getImageData(0, 0, w, h); if (_fieldTone(im.data, w, h, 'enhance')) { ctx.putImageData(im, 0, 0); return; } }
  const imgData = ctx.getImageData(0, 0, w, h);
  _applyEnhance(imgData.data, w, h);
  ctx.putImageData(imgData, 0, 0);
}

/* ═══════════════════════════════════════════════════════════════
   6. GRAYSCALE — OPENCV PIPELINE
   Plain luminance grayscale; preserves the original illumination.
═══════════════════════════════════════════════════════════════ */
function _applyGrayscaleCV(ctx, w, h) {
  const imageData = ctx.getImageData(0, 0, w, h);
  _applyGrayscale(imageData.data, w, h);
  ctx.putImageData(imageData, 0, 0);
}

function _applyEnhance(data, w, h) {
  if (_fieldTone(data, w, h, 'enhance')) return;
  const rBg = Math.max(50, Math.round(Math.min(w, h) / 6));
  const bgMap = _buildLocalMean(data, w, h, rBg);
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    const f = Math.min(2.4, 230 / Math.max(bgMap[px], 35));
    data[i]   = _clamp(data[i]   * f);
    data[i+1] = _clamp(data[i+1] * f);
    data[i+2] = _clamp(data[i+2] * f);
  }

  // Per-channel auto-levels (eliminates yellow/aged paper tint)
  const total  = data.length / 4;
  const cutoff = Math.ceil(total * 0.008);
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

  // Subtle contrast stretch
  for (let i = 0; i < data.length; i += 4) {
    data[i]   = _clamp((data[i]   - 128) * 1.15 + 134);
    data[i+1] = _clamp((data[i+1] - 128) * 1.15 + 134);
    data[i+2] = _clamp((data[i+2] - 128) * 1.15 + 134);
  }
}

function _fastDilate(src, w, h, r) {
  const tmp = new Uint8Array(w * h);
  const dst = new Uint8Array(w * h);

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const xMin = Math.max(0, x - r);
      const xMax = Math.min(w - 1, x + r);
      let m = 0;
      for (let k = xMin; k <= xMax; k++) {
        const v = src[row + k];
        if (v > m) m = v;
      }
      tmp[row + x] = m;
    }
  }

  // Vertical pass
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const yMin = Math.max(0, y - r);
      const yMax = Math.min(h - 1, y + r);
      let m = 0;
      for (let k = yMin; k <= yMax; k++) {
        const v = tmp[k * w + x];
        if (v > m) m = v;
      }
      dst[y * w + x] = m;
    }
  }
  return dst;
}

function _fastBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const dst = new Uint8Array(w * h);

  // Horizontal moving average
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0, count = 0;
    for (let x = 0; x < Math.min(w, r); x++) { sum += src[row + x]; count++; }
    for (let x = 0; x < w; x++) {
      const addX = x + r;
      const subX = x - r - 1;
      if (addX < w) { sum += src[row + addX]; count++; }
      if (subX >= 0) { sum -= src[row + subX]; count--; }
      tmp[row + x] = sum / count;
    }
  }

  // Vertical moving average
  for (let x = 0; x < w; x++) {
    let sum = 0, count = 0;
    for (let y = 0; y < Math.min(h, r); y++) { sum += tmp[y * w + x]; count++; }
    for (let y = 0; y < h; y++) {
      const addY = y + r;
      const subY = y - r - 1;
      if (addY < h) { sum += tmp[addY * w + x]; count++; }
      if (subY >= 0) { sum -= tmp[subY * w + x]; count--; }
      dst[y * w + x] = Math.round(sum / count);
    }
  }
  return dst;
}

/* Background-normalized Magic Color. Estimate paper per channel at a small
   working size, interpolate it smoothly, and preserve low-contrast ink. */
function _bilinearSample(bgMap, sW, sH, fx, fy) {
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, sW - 1), y1 = Math.min(y0 + 1, sH - 1);
  const dx = fx - x0, dy = fy - y0;
  return bgMap[y0*sW+x0]*(1-dx)*(1-dy) + bgMap[y0*sW+x1]*dx*(1-dy) +
         bgMap[y1*sW+x0]*(1-dx)*dy + bgMap[y1*sW+x1]*dx*dy;
}

/* Illumination correction with separate treatment for ink and continuous tones.
   The paper field uses a bounded resolution so export and preview agree. */
function _scanPhotoFrame(data,w,h){
  // PDF generators often place a gray photograph on a white page. That white
  // surround must not be used as the photograph's illumination reference.
  const s=Math.min(1,320/Math.max(w,h)),sw=Math.max(1,Math.round(w*s)),sh=Math.max(1,Math.round(h*s));
  if(sw<80||sh<80)return null;
  const mask=new Uint8Array(sw*sh);
  for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){const i=(Math.min(h-1,Math.floor((y+.5)*h/sh))*w+Math.min(w-1,Math.floor((x+.5)*w/sw)))*4;mask[y*sw+x]=Math.min(data[i],data[i+1],data[i+2])<242?1:0;}
  const pw=Math.max(2,Math.round(sw*.025)),ph=Math.max(2,Math.round(sh*.025));
  let whiteCorners=0;for(const[a,b]of [[0,0],[sw-pw,0],[0,sh-ph],[sw-pw,sh-ph]]){let dark=0;for(let y=b;y<b+ph;y++)for(let x=a;x<a+pw;x++)dark+=mask[y*sw+x];if(dark/(pw*ph)<=.02)whiteCorners++;}if(whiteCorners<3)return null;
  const row=y=>{let n=0;for(let x=0;x<sw;x++)n+=mask[y*sw+x];return n/sw;};
  let top=0,bottom=sh-1;while(top<sh*.20&&row(top)<.55)top++;while(bottom>sh*.80&&row(bottom)<.55)bottom--;
  if(top>=sh*.20||bottom<=sh*.80)return null;
  const col=x=>{let n=0;for(let y=top;y<=bottom;y++)n+=mask[y*sw+x];return n/(bottom-top+1);};
  let left=0,right=sw-1;while(left<sw*.20&&col(left)<.55)left++;while(right>sw*.80&&col(right)<.55)right--;
  if(left>=sw*.20||right<=sw*.80||[left,sw-1-right,top,sh-1-bottom].filter(n=>n>=2).length<2)return null;
  // Only the illumination region changes; every pixel outside it is retained.
  // Keep white frame samples out so dilation cannot turn a gray photo edge black.
  const x=Math.max(0,Math.ceil(left/sw*w)),y=Math.max(0,Math.ceil(top/sh*h)),x2=Math.min(w,Math.floor((right+1)/sw*w)),y2=Math.min(h,Math.floor((bottom+1)/sh*h));
  return {x,y,width:x2-x,height:y2-y};
}
/* ═══════════════════════════════════════════════════════════════
   PAPER FIELD — the light falling on the sheet, estimated per channel.
   A sheet photographed by phone is paper × illumination. Shadows of the
   hand or phone, creases and a warm lamp all live in the illumination,
   so dividing the photo by it gives flat white paper.
   • Morphological closing (dilate then erode) removes text and thin
     strokes but keeps shadow and crease edges where they are.
   • Printed dark blocks (sharp, strong edges) and coloured areas
     (highlighter, wide marker strokes, photos) are NOT light: the field
     under them is filled in from the paper around them, so they keep
     their own tones and never produce a colour halo.
═══════════════════════════════════════════════════════════════ */
function _boxBlurF(src, w, h, r) {
  const tmp = new Float32Array(w * h), dst = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { const row = y * w; let sum = 0, cnt = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) { sum += src[row + x]; cnt++; }
    tmp[row] = sum / cnt;
    for (let x = 1; x < w; x++) { if (x + r < w) { sum += src[row + x + r]; cnt++; } if (x - r - 1 >= 0) { sum -= src[row + x - r - 1]; cnt--; } tmp[row + x] = sum / cnt; } }
  for (let x = 0; x < w; x++) { let sum = 0, cnt = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) { sum += tmp[y * w + x]; cnt++; }
    dst[x] = sum / cnt;
    for (let y = 1; y < h; y++) { if (y + r < h) { sum += tmp[(y + r) * w + x]; cnt++; } if (y - r - 1 >= 0) { sum -= tmp[(y - r - 1) * w + x]; cnt--; } dst[y * w + x] = sum / cnt; } }
  return dst;
}
function _fastErode(src, w, h, r) {
  const inv = new Uint8Array(src.length); for (let i = 0; i < src.length; i++) inv[i] = 255 - src[i];
  const d = _fastDilate(inv, w, h, r); for (let i = 0; i < d.length; i++) d[i] = 255 - d[i]; return d;
}
function _paperField(data, w, h) {
  const scale = Math.min(1, 448 / Math.max(w, h)), sw = Math.max(1, Math.round(w * scale)), sh = Math.max(1, Math.round(h * scale)), n = sw * sh;
  if (sw < 24 || sh < 24) return null;
  const ch = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
  for (let sy = 0; sy < sh; sy++) for (let sx = 0; sx < sw; sx++) {
    const x0 = Math.floor(sx * w / sw), x1 = Math.max(x0 + 1, Math.floor((sx + 1) * w / sw)), y0 = Math.floor(sy * h / sh), y1 = Math.max(y0 + 1, Math.floor((sy + 1) * h / sh));
    let r = 0, g = 0, b = 0, c = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; c++; }
    const p = sy * sw + sx; ch[0][p] = r / c; ch[1][p] = g / c; ch[2][p] = b / c;
  }
  const rad = Math.max(3, Math.round(Math.min(sw, sh) * 0.012));
  const close = ch.map(c => _fastErode(_fastDilate(c, sw, sh, rad), sw, sh, rad));
  const lum = new Float32Array(n);
  for (let p = 0; p < n; p++) lum[p] = .299 * close[0][p] + .587 * close[1][p] + .114 * close[2][p];

  // Paper colour: median chroma of the brighter half of the closed image.
  const order = Array.from({ length: Math.min(n, 6000) }, (_, i) => Math.floor(i * n / Math.min(n, 6000))).sort((a, b) => lum[b] - lum[a]).slice(0, Math.max(50, Math.min(n, 6000) >> 1));
  const med = k => { const v = order.map(p => close[k][p] / Math.max(1, close[0][p] + close[1][p] + close[2][p])).sort((a, b) => a - b); return v[v.length >> 1]; };
  const pr = med(0), pg = med(1), pb = 1 - pr - pg, pmax = Math.max(pr, pg, pb), pmin = Math.min(pr, pg, pb), paperSat = (pmax - pmin) / Math.max(1e-6, pmax);

  // 1) coloured areas: chroma far from the paper's
  const mask = new Float32Array(n); let tinted = 0, tinted2 = 0;
  for (let p = 0; p < n; p++) { const s = Math.max(1, close[0][p] + close[1][p] + close[2][p]), d = Math.hypot(close[0][p] / s - pr, close[1][p] / s - pg);
    if (d > 0.018) tinted++; if (d > 0.009) tinted2++;
    if (d > 0.045) mask[p] = Math.min(1, (d - 0.045) / 0.035); }
  // 2) printed dark blocks: a strong step within 2 px (a shadow's edge is a ramp).
  //    Seed the dark side, then grow through pixels about as dark as the seed.
  const dark = new Uint8Array(n), limit = new Float32Array(n), queue = new Int32Array(n); let qh = 0, qt = 0;
  const seed = (p, bright) => { if (!dark[p]) { dark[p] = 1; limit[p] = Math.min(bright * 0.8, lum[p] * 1.3 + 6); queue[qt++] = p; } };
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const p = y * sw + x, a = lum[p];
    if (x + 2 < sw) { const b = lum[p + 2]; if (a < b * 0.66) seed(p, b); else if (b < a * 0.66) seed(p + 2, a); }
    if (y + 2 < sh) { const b = lum[p + 2 * sw]; if (a < b * 0.66) seed(p, b); else if (b < a * 0.66) seed(p + 2 * sw, a); } }
  while (qh < qt) { const p = queue[qh++], x = p % sw, lim = limit[p];
    const visit = q => { if (!dark[q] && lum[q] <= lim) { dark[q] = 1; limit[q] = lim; queue[qt++] = q; } };
    if (x > 0) visit(p - 1); if (x < sw - 1) visit(p + 1); if (p >= sw) visit(p - sw); if (p < n - sw) visit(p + sw); }
  let darkCount = 0, colourCount = 0;
  for (let p = 0; p < n; p++) { if (mask[p] > 0.5) colourCount++; if (dark[p]) { darkCount++; mask[p] = 1; } }
  const covered = (darkCount + colourCount) / n;

  // Fill the field under masked areas from the surrounding paper.
  const valid = new Float32Array(n); let anyValid = 0;
  for (let p = 0; p < n; p++) { valid[p] = mask[p] < 0.5 ? 1 : 0; anyValid += valid[p]; }
  const maps = close.map(c => Float32Array.from(c));
  if (anyValid > n * 0.05 && anyValid < n) {
    const filled = Uint8Array.from(valid);
    for (const R of [rad, rad * 3, rad * 8, Math.max(sw, sh)]) {
      let missing = 0; for (let p = 0; p < n; p++) if (!filled[p]) { missing = 1; break; }
      if (!missing) break;
      const wv = new Float32Array(n); for (let p = 0; p < n; p++) wv[p] = filled[p];
      const wB = _boxBlurF(wv, sw, sh, R), blurred = maps.map(m => { const a = new Float32Array(n); for (let p = 0; p < n; p++) a[p] = filled[p] ? m[p] : 0; return _boxBlurF(a, sw, sh, R); });
      for (let p = 0; p < n; p++) if (!filled[p] && wB[p] > 0.04) { for (let k = 0; k < 3; k++) maps[k][p] = blurred[k][p] / wB[p]; filled[p] = 2; }
      for (let p = 0; p < n; p++) if (filled[p] === 2) filled[p] = 1;
    }
  }
  const soft = _boxBlurF(mask, sw, sh, 2);
  for (let k = 0; k < 3; k++) maps[k] = _boxBlurF(maps[k], sw, sh, 1);
  // A warm or cool light cast lies on the yellow–blue axis and is removed;
  // any other tint (a green card, a pink form) is the paper's own colour.
  const onAxis = (pr >= pg - 0.004 && pg >= pb - 0.004) || (pb >= pg - 0.004 && pg >= pr - 0.004);
  const st = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const keepHue = onAxis ? st(0.26, 0.38, paperSat) : st(0.06, 0.14, paperSat);
  return { sw, sh, maps, mask: soft, covered, tinted: tinted / n, tinted2: tinted2 / n, keepHue, paper: [pr * 3, pg * 3, pb * 3] };
}

/* MAGIC PRO — flat white paper, dark crisp ink, colours kept.
   mode 'magic': paper is pushed to pure white (creases and shadows vanish).
   mode 'soft' : same light correction, gentle tone (No Shadow). */
function _applyPaperTone(data, w, h, field, mode) {
  const { sw, sh, maps, mask, keepHue, paper } = field;
  const eco = mode === 'eco', magic = mode === 'magic' || eco;
  const P = { soft: [0.03, 0.985, 1.0, 1.05], enhance: [0.07, 0.94, 1.15, 1.2], lighten: [0.0, 0.93, 0.78, 1.0] }[mode] || [0.07, 0.92, 1.6, 1.22];
  const black = P[0], white = P[1], gamma = P[2], satBoost = P[3];
  const kx = (sw - 1) / Math.max(1, w - 1), ky = (sh - 1) / Math.max(1, h - 1);
  const rowR = new Float32Array(w), rowG = new Float32Array(w), rowB = new Float32Array(w), rowM = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    const fy = y * ky, y0 = Math.floor(fy), y1 = Math.min(y0 + 1, sh - 1), dy = fy - y0;
    for (let x = 0; x < w; x++) { const fx = x * kx, x0 = Math.floor(fx), x1 = Math.min(x0 + 1, sw - 1), dx = fx - x0;
      const a = y0 * sw + x0, b = y0 * sw + x1, c = y1 * sw + x0, d = y1 * sw + x1, wa = (1 - dx) * (1 - dy), wb = dx * (1 - dy), wc = (1 - dx) * dy, wd = dx * dy;
      rowR[x] = maps[0][a] * wa + maps[0][b] * wb + maps[0][c] * wc + maps[0][d] * wd;
      rowG[x] = maps[1][a] * wa + maps[1][b] * wb + maps[1][c] * wc + maps[1][d] * wd;
      rowB[x] = maps[2][a] * wa + maps[2][b] * wb + maps[2][c] * wc + maps[2][d] * wd;
      rowM[x] = mask[a] * wa + mask[b] * wb + mask[c] * wc + mask[d] * wd; }
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      let br = Math.max(24, rowR[x]), bg = Math.max(24, rowG[x]), bb = Math.max(24, rowB[x]);
      if (keepHue > 0) {                                          // the paper's own tint is kept
        const kr = 1 + (paper[0] - 1) * keepHue, kg = 1 + (paper[1] - 1) * keepHue, kb = 1 + (paper[2] - 1) * keepHue;
        const kl = .299 * kr + .587 * kg + .114 * kb; br *= kl / kr; bg *= kl / kg; bb *= kl / kb; }
      const nr = Math.min(1.6, data[i] / br), ng = Math.min(1.6, data[i + 1] / bg), nb = Math.min(1.6, data[i + 2] / bb);
      const L = .299 * nr + .587 * ng + .114 * nb, m = rowM[x];
      // paper/ink curve
      const cmax = nr > ng ? (nr > nb ? nr : nb) : (ng > nb ? ng : nb), cmin = nr < ng ? (nr < nb ? nr : nb) : (ng < nb ? ng : nb);
      // clearly coloured pixel (highlighter, stamp, coloured pen) keeps its own tone
      let tint = (cmax - cmin - 0.10) / 0.12; tint = tint < 0 ? 0 : tint > 1 ? 1 : tint;
      let t, L2;
      if (magic) {
        // Ink curve: how far below the paper is this pixel? Faint marks left by
        // creases and noise (under ~10 %) become white; real strokes, even
        // light pencil, are deepened towards black.
        const d = L >= 1 ? 0 : 1 - L; let wk = (d - 0.08) / 0.12; wk = wk < 0 ? 0 : wk > 1 ? 1 : wk; wk = wk * wk * (3 - 2 * wk);
        const dk = d * 2.4, Lk = 1 - wk * (dk > 1 ? 1 : dk), Lc = L > 1 ? 1 : L;
        L2 = Lk + (Lc - Lk) * tint; t = L2;
      } else { t = (L - black) / (white - black); t = t < 0 ? 0 : t > 1 ? 1 : t; L2 = gamma === 1 ? t : Math.pow(t, gamma); t = L2; }
      const s = L > 1e-4 ? L2 / L : 0;
      let fade = magic ? 1 - t * t * t * t * t * t : 1; if (tint > fade) fade = tint;
      const sb = satBoost * fade + (1 - fade) * keepHue;
      let r = L2 + (nr * s - L2) * sb, g = L2 + (ng * s - L2) * sb, b = L2 + (nb * s - L2) * sb;
      if (m > 0.01) {                                             // photos, highlighter, printed blocks: natural tones
        const e = magic ? 1.04 : 1.0, pr = Math.min(1, nr * e), pg = Math.min(1, ng * e), pb = Math.min(1, nb * e);
        r += (pr - r) * m; g += (pg - g) * m; b += (pb - b) * m; }
      if (eco) { const y = 1 - (1 - (.299 * r + .587 * g + .114 * b)) * 0.55; r = g = b = y; }   // grey ink, less toner
      data[i] = r <= 0 ? 0 : r >= 1 ? 255 : (r * 255 + .5) | 0;
      data[i + 1] = g <= 0 ? 0 : g >= 1 ? 255 : (g * 255 + .5) | 0;
      data[i + 2] = b <= 0 ? 0 : b >= 1 ? 255 : (b * 255 + .5) | 0;
    }
  }
}

function _applyMagicPro(data,w,h){
  // A grey photograph on a white PDF page, a colour card, or an image that
  // is mostly picture: keep the tone-preserving treatment.
  if(_scanPhotoFrame(data,w,h)||_isColourCard(data,w,h)){_applyMagicProLegacy(data,w,h);return;}
  const field=_paperField(data,w,h);
  // An ID-card-shaped scan with a tinted security background keeps its colours.
  const ar=Math.max(w,h)/Math.max(1,Math.min(w,h)),idCard=field&&ar>1.45&&ar<1.75&&field.tinted2>0.2;
  if(!field||idCard||field.covered>0.55||field.tinted>0.25){_applyMagicProLegacy(data,w,h);return;}
  _applyPaperTone(data,w,h,field,'magic');
}
/* Broad, varied colour across the sheet (security card, certificate art). */
function _isColourCard(data,w,h){
  const s=Math.min(1,200/Math.max(w,h)),sw=Math.max(1,Math.round(w*s)),sh=Math.max(1,Math.round(h*s)),n=sw*sh;let colored=0;const cr=new Float32Array(n),cg=new Float32Array(n);
  for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){const i=(Math.min(h-1,Math.floor((y+.5)*h/sh))*w+Math.min(w-1,Math.floor((x+.5)*w/sw)))*4,r=data[i],g=data[i+1],b=data[i+2],hi=Math.max(r,g,b),lo=Math.min(r,g,b),p=y*sw+x,sum=Math.max(1,r+g+b);
    cr[p]=r/sum;cg[p]=g/sum;if(hi>60&&(hi-lo)/Math.max(1,hi)>.10)colored++;}
  // chroma spread of the middle 70 %: one light cast gives one chroma, card art gives many
  const spread=a=>{const v=Array.from(a).sort((p,q)=>p-q);return v[Math.floor(n*.85)]-v[Math.floor(n*.15)];};
  _isColourCard.last={colored:colored/n,spread:spread(cr)+spread(cg)};
  return colored/n>.45&&spread(cr)+spread(cg)>.045;
}
function _applyMagicProLegacy(data,w,h,isolated=false){
  const frame=!isolated&&_scanPhotoFrame(data,w,h);
  if(frame){
    const pixels=new Uint8ClampedArray(frame.width*frame.height*4);
    for(let y=0;y<frame.height;y++){const start=((y+frame.y)*w+frame.x)*4;pixels.set(data.subarray(start,start+frame.width*4),y*frame.width*4);}
    _applyMagicProLegacy(pixels,frame.width,frame.height,true);
    for(let y=0;y<frame.height;y++)data.set(pixels.subarray(y*frame.width*4,(y+1)*frame.width*4),((y+frame.y)*w+frame.x)*4);
    return;
  }
  const scale=Math.min(1,384/Math.max(w,h)),sw=Math.max(1,Math.round(w*scale)),sh=Math.max(1,Math.round(h*scale)),n=sw*sh;
  const channels=[new Uint8Array(n),new Uint8Array(n),new Uint8Array(n)],gray=new Uint8Array(n);
  for(let sy=0;sy<sh;sy++)for(let sx=0;sx<sw;sx++){
    const x0=Math.floor(sx*w/sw),x1=Math.max(x0+1,Math.floor((sx+1)*w/sw)),y0=Math.floor(sy*h/sh),y1=Math.max(y0+1,Math.floor((sy+1)*h/sh)),sum=[0,0,0];let count=0;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*w+x)*4;for(let k=0;k<3;k++)sum[k]+=data[i+k];count++;}
    const p=sy*sw+sx;for(let k=0;k<3;k++)channels[k][p]=Math.round(sum[k]/count);gray[p]=Math.round(.299*channels[0][p]+.587*channels[1][p]+.114*channels[2][p]);
  }
  const radius=Math.max(2,Math.round(Math.min(sw,sh)*.022)),blur=Math.max(2,Math.round(Math.min(sw,sh)*.026));
  const maps=channels.map(ch=>_fastBlur(_fastDilate(ch,sw,sh,radius),sw,sh,blur));
  const bgGray=new Uint8Array(n),darkMask=new Uint8Array(n);let colored=0,sr=0,sg=0,srr=0,sgg=0;
  for(let p=0;p<n;p++){
    const r=maps[0][p],g=maps[1][p],b=maps[2][p],hi=Math.max(r,g,b),lo=Math.min(r,g,b);bgGray[p]=.299*r+.587*g+.114*b;
    darkMask[p]=gray[p]<bgGray[p]*.83?255:0;
    if((hi-lo)/Math.max(1,hi)>.055)colored++;
    const rg=g-r,gb=g-b;sr+=rg;sg+=gb;srr+=rg*rg;sgg+=gb*gb;
  }
  // Broad varied colour belongs to the document (e.g. a security card), while
  // a uniform warm light cast on plain paper can still be corrected.
  // Trim colour outliers so a thin red table edge cannot classify an entire
  // warm-lit white page as a coloured card.
  const spread=channel=>{
    const hist=new Uint32Array(511);for(let p=0;p<n;p++)hist[maps[1][p]-maps[channel][p]+255]++;
    let count=0,sum=0,squares=0,position=0;
    for(let v=0;v<hist.length;v++){const end=position+hist[v],take=Math.max(0,Math.min(end,n*.85)-Math.max(position,n*.15));position=end;count+=take;sum+=(v-255)*take;squares+=(v-255)**2*take;}
    return count?Math.max(0,squares/count-(sum/count)**2):0;
  };
  const colorVariance=spread(0)+spread(2);
  const colorDocument=colored/n>.30&&colorVariance>8;
  const sortedPaper=Uint8Array.from(bgGray).sort();
  const photoPaper=Math.max(70,sortedPaper[Math.min(n-1,Math.floor(n*.90))]);
  const colorMask=new Uint8Array(n);
  if(colorVariance>8)for(let p=0;p<n;p++){
    const hi=Math.max(channels[0][p],channels[1][p],channels[2][p]),lo=Math.min(channels[0][p],channels[1][p],channels[2][p]);
    colorMask[p]=(hi-lo)/Math.max(1,hi)>.055?255:0;
  }
  const colorDensity=_fastBlur(colorMask,sw,sh,Math.max(4,radius));
  const density=_fastBlur(darkMask,sw,sh,Math.max(4,Math.round(Math.min(sw,sh)*.035)));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const fx=x/Math.max(1,w-1)*(sw-1),fy=y/Math.max(1,h-1)*(sh-1),i=(y*w+x)*4;
    const r=data[i],g=data[i+1],b=data[i+2];
    const br=Math.max(40,_bilinearSample(maps[0],sw,sh,fx,fy)),bg=Math.max(40,_bilinearSample(maps[1],sw,sh,fx,fy)),bb=Math.max(40,_bilinearSample(maps[2],sw,sh,fx,fy));
    const paper=Math.max(40,_bilinearSample(bgGray,sw,sh,fx,fy)),lum=.299*r+.587*g+.114*b;
    const nr=Math.min(1.15,r/br),ng=Math.min(1.15,g/bg),nb=Math.min(1.15,b/bb),nl=.299*nr+.587*ng+.114*nb;
    const tone=255*Math.pow(Math.min(1,nl),1.85)/Math.max(.001,nl);
    // Large connected tonal areas are usually photographs, seals or card art;
    // avoid posterizing them through a paper/ink curve.
    const localDensity=_bilinearSample(density,sw,sh,fx,fy)/255;
    const photo=Math.max(0,Math.min(1,(localDensity-.23)/.34));
    const localColor=_bilinearSample(colorDensity,sw,sh,fx,fy)/255;
    const protection=Math.max(photo,colorDocument ? .88 : 0,Math.max(0,Math.min(1,(localColor-.35)/.45)));
    // A photographic area must share one exposure gain. Dividing each pixel
    // by its own local maximum flattens facial shading and smooth gradients.
    const gain=Math.min(2.4,250/photoPaper),normalizedLum=Math.min(1,lum*gain/255),photoLum=255*Math.pow(normalizedLum,.96);
    const photoGain=photoLum/Math.max(1,lum);
    data[i]=_clamp(Math.min(255,nr*tone)*(1-protection)+Math.min(255,r*photoGain)*protection);
    data[i+1]=_clamp(Math.min(255,ng*tone)*(1-protection)+Math.min(255,g*photoGain)*protection);
    data[i+2]=_clamp(Math.min(255,nb*tone)*(1-protection)+Math.min(255,b*photoGain)*protection);
  }
}


/* ── 3. LIGHTEN (JS) ─────────────────────────────────────────── */
function _applyLighten(data, w, h) {
  if (_fieldTone(data, w, h, 'lighten')) return;
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

/* ── 4. NO SHADOW (JS Fallback) ──────────────────────────────── */
function _applyNoShadow(data, w, h) {
  if (_noShadowField(data, w, h)) return;
  const scale = 4;
  const sW = Math.max(8, Math.floor(w / scale));
  const sH = Math.max(8, Math.floor(h / scale));
  const sTotal = sW * sH;

  const sR = new Uint8Array(sTotal);
  const sG = new Uint8Array(sTotal);
  const sB = new Uint8Array(sTotal);

  for (let sy = 0; sy < sH; sy++) {
    const srcY = Math.min(h - 1, sy * scale);
    const rowOffset = srcY * w;
    const sRowOffset = sy * sW;
    for (let sx = 0; sx < sW; sx++) {
      const srcX = Math.min(w - 1, sx * scale);
      const idx = (rowOffset + srcX) * 4;
      const sIdx = sRowOffset + sx;
      sR[sIdx] = data[idx];
      sG[sIdx] = data[idx + 1];
      sB[sIdx] = data[idx + 2];
    }
  }

  const dR = _fastDilate(sR, sW, sH, 4);
  const dG = _fastDilate(sG, sW, sH, 4);
  const dB = _fastDilate(sB, sW, sH, 4);

  const bR = _fastBlur(dR, sW, sH, 6);
  const bG = _fastBlur(dG, sW, sH, 6);
  const bB = _fastBlur(dB, sW, sH, 6);

  for (let y = 0; y < h; y++) {
    const sy = Math.min(sH - 1, Math.floor(y / scale));
    const sRowOffset = sy * sW;
    const rowOffset = y * w;

    for (let x = 0; x < w; x++) {
      const sx = Math.min(sW - 1, Math.floor(x / scale));
      const sIdx = sRowOffset + sx;
      const idx = (rowOffset + x) * 4;

      const rIn = data[idx];
      const gIn = data[idx + 1];
      const bIn = data[idx + 2];

      const bgR = Math.max(bR[sIdx], 30);
      const bgG = Math.max(bG[sIdx], 30);
      const bgB = Math.max(bB[sIdx], 30);

      const rNorm = Math.min(255, (rIn / bgR) * 240);
      const gNorm = Math.min(255, (gIn / bgG) * 240);
      const bNorm = Math.min(255, (bIn / bgB) * 240);

      data[idx]     = _clamp(rNorm);
      data[idx + 1] = _clamp(gNorm);
      data[idx + 2] = _clamp(bNorm);
    }
  }
}

/* ── 5. B&W (CamScanner Adaptive Scan) ───────────────────────── */
function _applyBW(data, w, h) {
  const scale = 4;
  const sW = Math.max(8, Math.floor(w / scale));
  const sH = Math.max(8, Math.floor(h / scale));
  const sTotal = sW * sH;
  const sGray = new Uint8Array(sTotal);

  for (let sy = 0; sy < sH; sy++) {
    const srcY = Math.min(h - 1, sy * scale);
    const rowOffset = srcY * w;
    const sRowOffset = sy * sW;
    for (let sx = 0; sx < sW; sx++) {
      const srcX = Math.min(w - 1, sx * scale);
      const idx = (rowOffset + srcX) * 4;
      sGray[sRowOffset + sx] = Math.round(0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2]);
    }
  }

  const dGray = _fastDilate(sGray, sW, sH, 4);
  const bGray = _fastBlur(dGray, sW, sH, 6);

  for (let y = 0; y < h; y++) {
    const sy = Math.min(sH - 1, Math.floor(y / scale));
    const sRowOffset = sy * sW;
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(sW - 1, Math.floor(x / scale));
      const sIdx = sRowOffset + sx;
      const idx = (rowOffset + x) * 4;

      const bg = Math.max(bGray[sIdx], 25);
      const lum = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
      const thresh = bg * 0.72;
      const v = lum < thresh ? 0 : 255;
      data[idx] = data[idx+1] = data[idx+2] = v;
    }
  }
}

/* ── 6. B&W SOFT (CamScanner B&W 2 — Smooth Grayscale Document) ─ */
function _applyBWSoft(data, w, h) {
  const scale = 4;
  const sW = Math.max(8, Math.floor(w / scale));
  const sH = Math.max(8, Math.floor(h / scale));
  const sTotal = sW * sH;
  const sGray = new Uint8Array(sTotal);

  for (let sy = 0; sy < sH; sy++) {
    const srcY = Math.min(h - 1, sy * scale);
    const rowOffset = srcY * w;
    const sRowOffset = sy * sW;
    for (let sx = 0; sx < sW; sx++) {
      const srcX = Math.min(w - 1, sx * scale);
      const idx = (rowOffset + srcX) * 4;
      sGray[sRowOffset + sx] = Math.round(0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2]);
    }
  }

  const dGray = _fastDilate(sGray, sW, sH, 4);
  const bGray = _fastBlur(dGray, sW, sH, 6);

  for (let y = 0; y < h; y++) {
    const sy = Math.min(sH - 1, Math.floor(y / scale));
    const sRowOffset = sy * sW;
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(sW - 1, Math.floor(x / scale));
      const sIdx = sRowOffset + sx;
      const idx = (rowOffset + x) * 4;

      const bg = Math.max(bGray[sIdx], 25);
      const lum = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
      const lumaIn = (lum / bg) * 255;

      let lumaOut;
      if (lumaIn >= 198) {
        lumaOut = 255;
      } else if (lumaIn <= 110) {
        lumaOut = (lumaIn / 110) * 10;
      } else {
        const t = (lumaIn - 110) / (198 - 110);
        lumaOut = 10 + t * t * (3 - 2 * t) * (255 - 10);
      }
      const v = _clamp(lumaOut);
      data[idx] = data[idx+1] = data[idx+2] = v;
    }
  }
}

/* ── 7. GRAYSCALE (JS Fallback) ──────────────────────────────── */
function _applyGrayscale(data, w, h) {
  for (let i = 0; i < data.length; i += 4) {
    const value = _clamp(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    data[i] = data[i + 1] = data[i + 2] = value;
  }
}

// Invert each color channel; preserve transparency and the original dimensions.
function _applyInvert(data) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
}

/* ── 8. ECO (JS) ─────────────────────────────────────────────── */
function _applyEco(data, w, h) {
  if (_fieldTone(data, w, h, 'eco')) return;
  const r  = Math.max(45, Math.round(Math.min(w, h) / 6));
  const bg = _buildLocalMean(data, w, h, r);
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    const f = Math.min(2.0, 215 / Math.max(bg[px], 38));
    data[i]   = _clamp(data[i]   * f);
    data[i+1] = _clamp(data[i+1] * f);
    data[i+2] = _clamp(data[i+2] * f);
  }
  for (let i = 0; i < data.length; i += 4) {
    const g = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    data[i]   = _clamp((data[i]   * 0.4 + g * 0.6) * 1.05 + 5);
    data[i+1] = _clamp((data[i+1] * 0.4 + g * 0.6) * 1.05 + 5);
    data[i+2] = _clamp((data[i+2] * 0.4 + g * 0.6) * 1.05 + 5);
  }
}

/* ── FAST 2-PASS INTEGRAL / BOX MEAN FOR SHADOWS ─────────────── */
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

    requestAnimationFrame(() => renderFilterThumbnail(canvas, f.id, image));
  });
}

/* ── HELPERS ─────────────────────────────────────────────────── */
function _clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }

// Expose globally
window.FILTERS = FILTERS;
window.applyFilterToContext = applyFilterToContext;
window.renderFilterThumbnail = renderFilterThumbnail;
window.buildFilterStrip = buildFilterStrip;
