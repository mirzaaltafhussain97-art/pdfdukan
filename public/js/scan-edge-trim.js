/* Edge-strip trim: after the automatic crop, a thin band of table cloth,
   desk or the next page can remain along a side (the page filled the photo,
   so its own edge was hard to find). For each side this looks for a band that
   starts at the border, is clearly not paper, and ends on a straight page
   edge; the crop is then pulled in to that edge. Printed content near the
   border is left alone: the band must be consistent along the side.
   trim(canvas) -> null | { tl, tr, br, bl } in the canvas's own pixels. */
(function (root) {
  'use strict';

  function features(canvas) {
    const W = canvas.width, H = canvas.height, s = Math.min(1, 600 / Math.max(W, H));
    const w = Math.max(40, Math.round(W * s)), h = Math.max(40, Math.round(H * s));
    const C = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const x = C.getContext('2d', { willReadFrequently: true }); x.drawImage(canvas, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, n = w * h;
    // 3x3 box blur first so text strokes and JPEG noise do not break the walk
    const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let X = 0; X < w; X++) {
      let r = 0, g = 0, b = 0, k = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) for (let xx = Math.max(0, X - 1); xx <= Math.min(w - 1, X + 1); xx++) { const i = (yy * w + xx) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; k++; }
      const p = y * w + X; R[p] = r / k; G[p] = g / k; B[p] = b / k;
    }
    const lum = new Float32Array(n), sat = new Float32Array(n), cr = new Float32Array(n), cg = new Float32Array(n);
    for (let p = 0; p < n; p++) { const r = R[p], g = G[p], b = B[p], mx = Math.max(r, g, b), mn = Math.min(r, g, b), sm = Math.max(1, r + g + b); lum[p] = .299 * r + .587 * g + .114 * b; sat[p] = mx > 0 ? (mx - mn) / mx : 0; cr[p] = r / sm; cg[p] = g / sm; }
    // paper reference: the brighter half of the middle of the page
    const mid = []; for (let y = Math.floor(h * .25); y < h * .75; y += 2) for (let X = Math.floor(w * .25); X < w * .75; X += 2) mid.push(y * w + X);
    mid.sort((a, b) => lum[b] - lum[a]); const top = mid.slice(0, Math.max(20, mid.length >> 1));
    const med = a => { const v = top.map(p => a[p]).sort((p, q) => p - q); return v[v.length >> 1]; };
    return { w, h, s, lum, sat, cr, cg, Lp: med(lum), Sp: med(sat), CRp: med(cr), CGp: med(cg) };
  }

  // depth (pixels from the border) where paper starts, along one side
  function sideDepths(F, side, N) {
    const { w, h, lum, sat, cr, cg, Lp, Sp, CRp, CGp } = F;
    const along = side === 'top' || side === 'bottom' ? w : h, across = side === 'top' || side === 'bottom' ? h : w;
    const maxD = Math.round(across * 0.12), out = [];
    const paper = p => lum[p] >= Lp * 0.72 && sat[p] <= Math.max(0.2, Sp + 0.12) && Math.hypot(cr[p] - CRp, cg[p] - CGp) <= 0.05;
    const at = (a, d) => { // a along, d inward
      if (side === 'top') return d * w + a; if (side === 'bottom') return (h - 1 - d) * w + a;
      if (side === 'left') return a * w + d; return a * w + (w - 1 - d);
    };
    for (let k = 0; k < N; k++) {
      const a = Math.round(along * (0.06 + 0.88 * k / (N - 1)));
      let depth = NaN, run = 0, bg = 0, bgs = 0, bgL = 0, bgL2 = 0;
      for (let d = 0; d <= maxD; d++) {
        const p = at(a, d);
        if (paper(p)) { if (++run >= 3) { depth = d - 2; break; } }
        else { run = 0; bg++; bgs += sat[p]; bgL += lum[p]; bgL2 += lum[p] * lum[p]; }
      }
      // A real page edge is a sharp step; a shadow (the book's gutter, a
      // hand) fades in slowly and is not a strip to cut away.
      if (depth > 2) {
        const pi = at(a, Math.min(maxD, depth + 2)), po = at(a, Math.max(0, depth - 3));
        const sharp = (lum[pi] - lum[po]) / Lp > 0.16 || Math.hypot(cr[pi] - cr[po], cg[pi] - cg[po]) > 0.04 || sat[po] - sat[pi] > 0.15;
        if (!sharp) depth = NaN;
      }
      out.push({ t: k / (N - 1), d: depth, bg, sat: bg ? bgs / bg : 0, L: bg ? bgL / bg : 0, L2: bg ? bgL2 / bg : 0 });
    }
    return { out, across };
  }

  function fitSide(F, side) {
    const N = 48, { out, across } = sideDepths(F, side, N);
    const valid = out.filter(o => !isNaN(o.d)); if (valid.length < N * 0.7) return null;
    const minD = Math.max(2, across * 0.004), tol = Math.max(2, across * 0.008), strip = valid.filter(o => o.d > minD);
    if (strip.length < N * 0.3) return null;
    // robust line through the strip samples; samples where the edge has left
    // the frame (line below zero) must show no strip there
    let best = null;
    for (let i = 0; i < strip.length; i++) for (let j = i + 1; j < strip.length; j++) {
      const A = strip[i], Bq = strip[j]; if (Math.abs(Bq.t - A.t) < 0.15) continue;
      const b = (Bq.d - A.d) / (Bq.t - A.t), a = A.d - b * A.t; let inl = 0;
      for (const o of valid) { const L = a + b * o.t; if ((L <= minD && o.d <= minD + tol) || Math.abs(o.d - L) <= tol) inl++; }
      if (!best || inl > best.inl) best = { a, b, inl };
    }
    if (!best || best.inl < valid.length * 0.75) return null;
    // refine on inliers that carry a strip
    let S = [0, 0, 0, 0, 0], used = [];
    for (const o of strip) if (Math.abs(o.d - (best.a + best.b * o.t)) <= tol) { S[0]++; S[1] += o.t; S[2] += o.t * o.t; S[3] += o.d; S[4] += o.t * o.d; used.push(o); }
    const den = S[0] * S[2] - S[1] * S[1];
    const b = den > 1e-9 ? (S[0] * S[4] - S[1] * S[3]) / den : 0, a = S[0] ? (S[3] - b * S[1]) / S[0] : 0;
    const dMax = Math.max(a, a + b);
    if (dMax > across * 0.1 || dMax < minD) return null;
    // A uniform, saturated band is more likely a printed banner than cloth.
    let L = 0, L2 = 0, sat = 0; for (const o of used) { L += o.L; L2 += o.L2; sat += o.sat; }
    const m = used.length || 1, mean = L / m, sd = Math.sqrt(Math.max(0, L2 / m - mean * mean)), sm = sat / m;
    if (sd < 7 && sm > 0.25 && mean > F.Lp * 0.35) return null;
    return { a: a + 1, b, across, sd, sm, mean: mean / F.Lp };   // one pixel of margin
  }

  function trim(canvas, opts) {
    if (!canvas || canvas.width < 120 || canvas.height < 120) return null;
    // opts.sides: sides where any background band may go; on the other sides
    // only a clearly coloured one (cloth), never a grey or dark band that
    // could be a printed header or footer.
    const free = (opts && opts.sides) || ['top', 'bottom', 'left', 'right'];
    const F = features(canvas), fits = {};
    let any = false, area = 0;
    for (const side of ['top', 'bottom', 'left', 'right']) { const f = fitSide(F, side); if (f && (free.includes(side) || f.sm >= 0.3)) { fits[side] = f; any = true; area += (Math.max(0, f.a) + Math.max(0, f.a + f.b)) / 2 / f.across; } }
    if (!any || area > 0.18) return null;
    const { w, h, s } = F, W = canvas.width, H = canvas.height;
    // side lines in small-image pixels: depth(t) = a + b t, clamped at 0
    const dep = (side, t) => { const f = fits[side]; return f ? Math.max(0, f.a + f.b * t) : 0; };
    // corners: iterate the two crossing lines (slopes are small)
    const corner = (vs, hs) => { // vs: 'left'|'right', hs: 'top'|'bottom'
      let x = vs === 'left' ? 0 : w - 1, y = hs === 'top' ? 0 : h - 1;
      for (let k = 0; k < 6; k++) {
        const ty = Math.max(-0.1, Math.min(1.1, (y / Math.max(1, h - 1) - 0.06) / 0.88)), tx = Math.max(-0.1, Math.min(1.1, (x / Math.max(1, w - 1) - 0.06) / 0.88));
        x = vs === 'left' ? dep('left', ty) : w - 1 - dep('right', ty);
        y = hs === 'top' ? dep('top', tx) : h - 1 - dep('bottom', tx);
      }
      return { x: Math.max(0, Math.min(W, x / s)), y: Math.max(0, Math.min(H, y / s)) };
    };
    return { tl: corner('left', 'top'), tr: corner('right', 'top'), br: corner('right', 'bottom'), bl: corner('left', 'bottom'), sides: Object.keys(fits), stats: Object.fromEntries(Object.entries(fits).map(([k, f]) => [k, [+f.sd.toFixed(1), +f.sm.toFixed(2), +f.mean.toFixed(2), +Math.max(f.a, f.a + f.b).toFixed(1)]])) };
  }

  // Map points from the warped rectangle back to the photo (4-point homography).
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) { const { x, y } = src[i], X = dst[i].x, Y = dst[i].y; A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X); A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y); }
    for (let i = 0; i < 8; i++) { let p = i; for (let r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]]; if (Math.abs(A[i][i]) < 1e-12) return null;
      for (let r = 0; r < 8; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c < 8; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; } }
    const m = b.map((v, i) => v / A[i][i]);
    return p => { const z = m[6] * p.x + m[7] * p.y + 1; return { x: (m[0] * p.x + m[1] * p.y + m[2]) / z, y: (m[3] * p.x + m[4] * p.y + m[5]) / z }; };
  }

  root.ScanEdgeTrim = { trim, homography, _features: features, _fitSide: fitSide };
})(typeof self !== 'undefined' ? self : this);
