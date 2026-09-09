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

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  switch (filterId) {
    case 'original':  break;
    case 'enhance':   _applyEnhance(data, w, h); break;
    case 'magicpro':  _applyMagicPro(data, w, h); break;
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

  if (filterId === 'magicpro') _applySharpen(ctx, w, h, 8);
  if (sharpness > 0) _applySharpen(ctx, w, h, sharpness);
}

/* Estimate paper from the brighter pixels in local tiles. Unlike a mean,
   printed ink does not pull the paper estimate down as strongly. Interpolate
   the estimate smoothly; never threshold faint writing in colour modes. */
function _normalizePaper(data, w, h, target, gamma) {
  const tile = Math.max(16, Math.round(Math.min(w, h) / 24));
  const cols = Math.ceil(w / tile), rows = Math.ceil(h / tile);
  const paper = new Float32Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
    const hist = new Uint32Array(256);
    let count = 0;
    for (let y = gy * tile; y < Math.min(h, (gy + 1) * tile); y++) {
      for (let x = gx * tile; x < Math.min(w, (gx + 1) * tile); x++) {
        const i = (y * w + x) * 4;
        hist[Math.round(.299 * data[i] + .587 * data[i+1] + .114 * data[i+2])]++;
        count++;
      }
    }
    let total = 0, level = 255;
    for (let v = 0; v < 256; v++) {
      total += hist[v];
      if (total >= count * .85) { level = v; break; }
    }
    paper[gy * cols + gx] = Math.max(40, level);
  }
  // Horizontal interpolation is identical on every row. Calculate it once;
  // Float64 storage preserves the existing arithmetic and output precision.
  const left=new Int32Array(w),right=new Int32Array(w),mix=new Float64Array(w);
  for(let x=0;x<w;x++){
    const fx=Math.max(0,Math.min(cols-1,(x+.5)/tile-.5));
    left[x]=Math.floor(fx);right[x]=Math.min(cols-1,left[x]+1);mix[x]=fx-left[x];
  }
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(rows - 1, (y + .5) / tile - .5));
    const y0 = Math.floor(fy), y1 = Math.min(rows - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const x0=left[x],x1=right[x],tx=mix[x];
      const top = paper[y0 * cols + x0] * (1-tx) + paper[y0 * cols + x1] * tx;
      const bottom = paper[y1 * cols + x0] * (1-tx) + paper[y1 * cols + x1] * tx;
      const gain = Math.min(2.8, target / (top * (1-ty) + bottom * ty));
      const i = (y * w + x) * 4;
      // A common gain and common tone multiplier preserve channel ratios.
      const peak = Math.max(data[i], data[i+1], data[i+2]);
      const safeGain = Math.min(gain, 255 / Math.max(1, peak));
      const luma = (.299 * data[i] + .587 * data[i+1] + .114 * data[i+2]) * safeGain / 255;
      const tone = Math.pow(Math.max(.001, luma), gamma - 1);
      for (let ch = 0; ch < 3; ch++) data[i+ch] = _clamp(data[i+ch] * safeGain * tone);
    }
  }
}

function _applyEnhance(data, w, h) { _normalizePaper(data, w, h, 245, 1.08); }
function _applyMagicPro(data, w, h) {
  // Security cards and certificates carry meaningful pale colour and facial
  // detail. Detect that before normalization and use a gentler treatment;
  // plain paper keeps the stronger cleanup intended for photographed pages.
  let chromatic=0,samples=0;
  const step=Math.max(4,Math.floor((w*h)/50000))*4;
  for(let i=0;i<data.length;i+=step){
    const hi=Math.max(data[i],data[i+1],data[i+2]),lo=Math.min(data[i],data[i+1],data[i+2]);
    if(hi>55&&hi-lo>16)chromatic++; samples++;
  }
  const colourDocument=samples>0&&chromatic/samples>.34;
  _normalizePaper(data,w,h,colourDocument?202:250,colourDocument?1.0:1.2);
  // Increase ink contrast smoothly, without a binary threshold that drops
  // thin writing or pale stamps. Keep the hue of coloured areas.
  for(let i=0;i<data.length;i+=4) {
    const y=(.299*data[i]+.587*data[i+1]+.114*data[i+2])/255;
    const exponent=colourDocument?1.12:1.65;
    const mapped=y < .86 ? .86*Math.pow(y/.86,exponent) : y;
    const gain=y>0 ? mapped/y : 1;
    for(let c=0;c<3;c++)data[i+c]=_clamp(data[i+c]*gain);
  }
  // Estimate the paper tint only from bright, nearly neutral pixels. Strong
  // colours (stamps, highlights, security backgrounds) do not set white balance.
  const hist=[new Uint32Array(256),new Uint32Array(256),new Uint32Array(256)];
  let count=0;
  for(let i=0;i<data.length;i+=4) {
    const hi=Math.max(data[i],data[i+1],data[i+2]),lo=Math.min(data[i],data[i+1],data[i+2]);
    if(lo<190 || hi-lo>hi*.13)continue;
    count++;for(let c=0;c<3;c++)hist[c][data[i+c]]++;
  }
  if(count<w*h*.03)return;
  const whites=hist.map(channel=>{
    let total=0;
    for(let v=0;v<256;v++){total+=channel[v];if(total>=count*.9)return v;}
    return 255;
  });
  const gains=whites.map(white=>Math.min(colourDocument?1:1.12,255/Math.max(1,white)));
  for(let i=0;i<data.length;i+=4) {
    for(let c=0;c<3;c++)data[i+c]=_clamp(data[i+c]*gains[c]);
    // Roll off nearly neutral paper highlights smoothly. Coloured security
    // patterns and mid-tone/faint writing remain below this white shoulder.
    const hi=Math.max(data[i],data[i+1],data[i+2]),lo=Math.min(data[i],data[i+1],data[i+2]);
    const luma=.299*data[i]+.587*data[i+1]+.114*data[i+2];
    const neutral=Math.max(0,1-(hi-lo)/Math.max(1,hi*.12));
    const shoulder=Math.max(0,Math.min(1,(luma-210)/40));
    const blend=neutral*shoulder*shoulder*(colourDocument?.08:1);
    for(let c=0;c<3;c++)data[i+c]=_clamp(data[i+c]+(255-data[i+c])*blend);
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
function _applyNoShadow(data, w, h) { _normalizePaper(data, w, h, 245, 1); }

/* ── 5. B&W ───────────────────────────────────────────────────────
   CamScanner B&W: shadow removal first so paper in shadow doesn't
   turn solid black, then hard threshold for crisp binary output.    */
function _applyBW(data, w, h) {
  // Estimate illumination from paper highlights, not an average containing
  // dark text. Threshold relative to that normalized paper to retain thin ink.
  _normalizePaper(data, w, h, 250, 1);
  for (let i = 0; i < data.length; i += 4) {
    const v = (0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]) > 215 ? 255 : 0;
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
        const lap = 4 * center
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
    const card = document.createElement('button');
    card.type = 'button';
    card.setAttribute('aria-pressed', String(f.id === activeFilter));
    card.className = 'filter-card' + (f.id === activeFilter ? ' active' : '');
    card.onclick = () => {
      container.querySelectorAll('.filter-card').forEach(c => { c.classList.remove('active'); c.setAttribute('aria-pressed','false'); });
      card.classList.add('active');
      card.setAttribute('aria-pressed','true');
      if (onSelect) onSelect(f.id);
    };

    const glyphs = {
      original:'<rect x="9" y="5" width="22" height="30" rx="3"/><path d="M14 13h12M14 20h12M14 27h8"/>',
      enhance:'<path d="M5 32l10-23 8 17 5-10 8 16z"/>',
      magicpro:'<path d="M20 4l4 11 12 5-12 4-4 12-5-12-11-4 11-5z"/><path d="M32 3v7M29 6h7"/>',
      lighten:'<circle cx="20" cy="20" r="8"/><path d="M20 2v5M20 33v5M2 20h5M33 20h5M7 7l4 4M29 29l4 4M7 33l4-4M29 11l4-4"/>',
      noshadow:'<rect x="7" y="5" width="26" height="30" rx="3"/><path d="M11 9l18 22M11 18l11 13M20 9l9 11"/>',
      bw:'<circle cx="15" cy="20" r="11" fill="currentColor"/><circle cx="25" cy="20" r="11" fill="white"/>',
      bwsoft:'<circle cx="15" cy="20" r="11" fill="#8b949e"/><circle cx="25" cy="20" r="11" fill="white"/>',
      grayscale:'<rect x="5" y="8" width="30" height="24" rx="3"/><path d="M15 8v24M25 8v24"/>',
      eco:'<path d="M31 7C9 5 5 20 14 29c9 8 22-2 17-22zM10 34l17-20"/>'
    };
    const icon=document.createElement('span');icon.className='fc-icon';
    icon.innerHTML='<svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'+glyphs[f.id]+'</svg>';
    card.appendChild(icon);

    const label = document.createElement('div');
    label.className = 'fc-label';
    label.textContent = f.name;
    card.appendChild(label);

    container.appendChild(card);

  });
}

/* ── HELPERS ─────────────────────────────────────────────────── */
function _clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// Expose globally
window.FILTERS = FILTERS;
window.applyFilterToContext = applyFilterToContext;
window.renderFilterThumbnail = renderFilterThumbnail;
window.buildFilterStrip = buildFilterStrip;
