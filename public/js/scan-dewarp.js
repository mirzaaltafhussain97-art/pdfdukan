/* Text-line dewarp: straightens the curved lines of a book page or a bent
   sheet after the perspective crop. It finds the printed text lines, fits a
   smooth curve to each, and moves every column up or down so those curves
   become straight. Pages whose lines are already straight are left alone.
   Works on a canvas (or OffscreenCanvas) and returns a new one, or null. */
(function (root) {
  'use strict';

  function grayOf(canvas, w, h) {
    const Canvas = typeof OffscreenCanvas !== 'undefined' ? OffscreenCanvas : null;
    let c, x;
    if (Canvas) { c = new Canvas(w, h); } else { c = document.createElement('canvas'); c.width = w; c.height = h; }
    x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(canvas, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
    for (let i = 0, p = 0; p < g.length; i += 4, p++) g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return g;
  }

  // Ink: noticeably darker than the local paper level (box mean of a wide window).
  function inkMask(g, w, h) {
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { s += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s; } }
    const r = Math.max(6, Math.round(Math.min(w, h) / 28)), m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), n = (y1 - y0) * (x1 - x0);
        const mean = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / n;
        if (g[y * w + x] < mean * 0.78 && g[y * w + x] < mean - 18) m[y * w + x] = 1;
      }
    }
    return m;
  }

  // Smear ink sideways so the words of one line join into one long blob.
  function smear(m, w, h, gap) {
    const s = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      let last = -1e9;
      for (let x = 0; x < w; x++) {
        if (m[y * w + x]) { if (x - last <= gap && last >= 0) for (let k = last + 1; k < x; k++) s[y * w + k] = 1; s[y * w + x] = 1; last = x; }
      }
    }
    return s;
  }

  function components(s, w, h) {
    const lab = new Int32Array(w * h), out = [], stack = new Int32Array(w * h);
    for (let p0 = 0; p0 < w * h; p0++) {
      if (!s[p0] || lab[p0]) continue;
      const id = out.length + 1; let sp = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0;
      stack[sp++] = p0; lab[p0] = id;
      while (sp) {
        const p = stack[--sp], y = (p / w) | 0, x = p - y * w; n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && s[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
        if (x < w - 1 && s[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && s[p - w] && !lab[p - w]) { lab[p - w] = id; stack[sp++] = p - w; }
        if (y < h - 1 && s[p + w] && !lab[p + w]) { lab[p + w] = id; stack[sp++] = p + w; }
      }
      out.push({ id, x0, x1, y0, y1, n });
    }
    return { lab, comps: out };
  }

  // Least squares y = a + b t + c t^2 (t = x scaled to [-1, 1]).
  function fitQuad(pts) {
    let S = [0, 0, 0, 0, 0], T = [0, 0, 0];
    for (const [t, y, wt] of pts) { const t2 = t * t; S[0] += wt; S[1] += wt * t; S[2] += wt * t2; S[3] += wt * t2 * t; S[4] += wt * t2 * t2; T[0] += wt * y; T[1] += wt * y * t; T[2] += wt * y * t2; }
    const A = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]];
    const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(A); if (Math.abs(D) < 1e-9) return null;
    const col = (k) => A.map((r, i) => r.map((v, j) => (j === k ? T[i] : v)));
    return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
  }

  function findLines(g, w, h) {
    const m = inkMask(g, w, h), s = smear(m, w, h, Math.max(4, Math.round(w * 0.022)));
    const { lab, comps } = components(s, w, h), lines = [];
    for (const c of comps) {
      const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
      if (cw < w * 0.28 || ch > h * 0.07 || ch < 2 || cw / ch < 10) continue;
      const bin = Math.max(3, Math.round(w / 120)), pts = [];
      for (let bx = c.x0; bx <= c.x1; bx += bin) {
        let sy = 0, k = 0;
        for (let y = c.y0; y <= c.y1; y++) for (let x = bx; x < Math.min(c.x1 + 1, bx + bin); x++) { const p = y * w + x; if (lab[p] === c.id && m[p]) { sy += y; k++; } }
        if (k >= 2) pts.push([(bx + bin / 2), sy / k, k]);
      }
      if (pts.length < 8) continue;
      const cx = (c.x0 + c.x1) / 2, half = Math.max(1, cw / 2);
      let P = pts.map(([x, y, k]) => [(x - cx) / half, y, Math.min(k, 12)]), f = fitQuad(P);
      if (!f) continue;
      // one robust pass: drop points far from the first fit (ascenders, stray marks)
      const res = P.map(([t, y]) => y - (f[0] + f[1] * t + f[2] * t * t)), sd = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / res.length);
      P = P.filter((_, i) => Math.abs(res[i]) <= Math.max(1.5, 2 * sd));
      if (P.length < 8) continue;
      f = fitQuad(P); if (!f) continue;
      const rms = Math.sqrt(P.reduce((a, [t, y]) => { const r = y - (f[0] + f[1] * t + f[2] * t * t); return a + r * r; }, 0) / P.length);
      if (rms > Math.max(1.2, ch * 0.35)) continue;
      // The line's own path (smoothed samples) follows a curl near the
      // binding better than the curve; the curve only vouches that it is a line.
      const keep = P.map(([t, y]) => [cx + t * half, y]).sort((a, b) => a[0] - b[0]);
      const ys = keep.map((_, i) => { let a = 0, k = 0; for (let j = Math.max(0, i - 2); j <= Math.min(keep.length - 1, i + 2); j++) { a += keep[j][1]; k++; } return a / k; });
      lines.push({ cx, half, x0: c.x0, x1: c.x1, f, yc: f[0], px: keep.map(k => k[0]), py: ys });
    }
    return lines.sort((a, b) => a.yc - b.yc);
  }

  // One smooth surface for the whole page, fitted to every line at once:
  // D(x, y) = sum_k sum_j c[k][j] * hat_k(x) * P_j(y), plus a free offset per
  // line. A single noisy line end cannot bend the page, gaps between lines are
  // filled smoothly, and the binding curl is still followed (K knots across).
  function solve(A, b, n) {
    for (let i = 0; i < n; i++) {
      let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r * n + i]) > Math.abs(A[p * n + i])) p = r;
      if (Math.abs(A[p * n + i]) < 1e-12) return null;
      if (p !== i) { for (let c = 0; c < n; c++) { const t = A[i * n + c]; A[i * n + c] = A[p * n + c]; A[p * n + c] = t; } const t = b[i]; b[i] = b[p]; b[p] = t; }
      for (let r = i + 1; r < n; r++) { const f = A[r * n + i] / A[i * n + i]; if (!f) continue; for (let c = i; c < n; c++) A[r * n + c] -= f * A[i * n + c]; b[r] -= f * b[i]; }
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) { let v = b[i]; for (let c = i + 1; c < n; c++) v -= A[i * n + c] * x[c]; x[i] = v / A[i * n + i]; }
    return x;
  }

  function fitField(lines, w, h, J) {
    const K = 24, NC = K * J, N = NC + lines.length;
    let ymin = Infinity, ymax = -Infinity, xmin = Infinity, xmax = -Infinity;
    for (const L of lines) { ymin = Math.min(ymin, L.yc); ymax = Math.max(ymax, L.yc); xmin = Math.min(xmin, L.px[0]); xmax = Math.max(xmax, L.px[L.px.length - 1]); }
    const ymid = (ymin + ymax) / 2, yh = Math.max(1, (ymax - ymin) / 2), P = v => [1, v, v * v - 1 / 3].slice(0, J);
    const S = [];
    lines.forEach((L, li) => { const pv = P((L.yc - ymid) / yh); for (let i = 0; i < L.px.length; i++) S.push({ x: L.px[i], pv, t: L.py[i] - L.yc, li, on: 1 }); });
    const row = sm => { const u = Math.max(0, Math.min(K - 1, sm.x / (w - 1) * (K - 1))), k0 = Math.min(K - 2, Math.floor(u)), tt = u - k0, r = []; for (let j = 0; j < J; j++) { r.push([k0 * J + j, (1 - tt) * sm.pv[j]], [(k0 + 1) * J + j, tt * sm.pv[j]]); } r.push([NC + sm.li, 1]); return r; };
    let c = null;
    for (let pass = 0; pass < 2; pass++) {
      const A = new Float64Array(N * N), b = new Float64Array(N); let n = 0;
      for (const sm of S) { if (!sm.on) continue; n++; const r = row(sm); for (const [i, vi] of r) { b[i] += vi * sm.t; for (const [k, vk] of r) A[i * N + k] += vi * vk; } }
      const per = n / K, mu = 0.2 * per, nu = 0.03 * per;
      for (let j = 0; j < J; j++) {
        for (let k = 1; k < K - 1; k++) { const id = [(k - 1) * J + j, k * J + j, (k + 1) * J + j], cf = [1, -2, 1]; for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) A[id[p] * N + id[q]] += mu * cf[p] * cf[q]; }
        for (let k = 0; k < K - 1; k++) { const i0 = k * J + j, i1 = (k + 1) * J + j; A[i0 * N + i0] += nu; A[i1 * N + i1] += nu; A[i0 * N + i1] -= nu; A[i1 * N + i0] -= nu; }
      }
      for (let i = 0; i < NC; i++) A[i * N + i] += 1e-6 * per;
      for (let i = NC; i < N; i++) A[i * N + i] += 1e-3 * per;
      c = solve(A, b, N); if (!c) return null;
      // second pass without the samples that sit far off the surface (ascenders, marks)
      const res = S.map(sm => { let v = 0; for (const [i, vi] of row(sm)) v += vi * c[i]; return Math.abs(v - sm.t); });
      const on = res.filter((_, i) => S[i].on).sort((a, b) => a - b), mad = on[on.length >> 1] || 0, cut = Math.max(1.2, 3.5 * 1.4826 * mad);
      if (pass === 0) S.forEach((sm, i) => { sm.on = res[i] <= cut ? 1 : 0; });
      else c.rms = Math.sqrt(on.reduce((a, r) => a + r * r, 0) / Math.max(1, on.length));
    }
    // Evaluate on the small grid. Outside the lines (above, below, beside)
    // the surface keeps its edge value instead of guessing further.
    const D = new Float32Array(w * h), e = new Float64Array(K), maxShift = h * 0.06, gx = Math.max(0, xmin - w * 0.02), hx = Math.min(w - 1, xmax + w * 0.02);
    for (let y = 0; y < h; y++) {
      const pv = P(Math.max(-1, Math.min(1, (y - ymid) / yh)));
      for (let k = 0; k < K; k++) { let v = 0; for (let j = 0; j < J; j++) v += c[k * J + j] * pv[j]; e[k] = v; }
      for (let x = 0; x < w; x++) {
        const u = Math.max(gx, Math.min(hx, x)) / (w - 1) * (K - 1), k0 = Math.min(K - 2, Math.floor(u)), tt = u - k0;
        D[y * w + x] = Math.max(-maxShift, Math.min(maxShift, e[k0] * (1 - tt) + e[k0 + 1] * tt));
      }
    }
    return { D, rms: c.rms };
  }

  // Share of the field where the shift changes too fast between rows (glyph stretch).
  function steepest(D, w, h) {
    let bad = 0, worst = 0, wx = 0, wy = 0, tot = 0;
    for (let y = 2; y < h - 2; y += 2) for (let x = 0; x < w; x += 2) {
      const g = Math.abs(D[(y + 2) * w + x] - D[(y - 2) * w + x]) / 4; tot++;
      if (g > 0.3) { bad++; if (g > worst) { worst = g; wx = x; wy = y; } }
    }
    return { share: bad / Math.max(1, tot), x: wx, y: wy };
  }

  function dewarp(canvas, opts) {
    opts = opts || {};
    const W = canvas.width, H = canvas.height; if (W < 200 || H < 200) return null;
    const s = Math.min(1, 1000 / Math.max(W, H)), w = Math.max(50, Math.round(W * s)), h = Math.max(50, Math.round(H * s));
    const g = grayOf(canvas, w, h), lines = findLines(g, w, h);
    if (lines.length < 3) return null;
    // How bent are the lines? Curvature only; a small common tilt is not a reason to warp.
    const bend = lines.map(L => Math.abs(L.f[2])).sort((a, b) => a - b), medBend = bend[bend.length >> 1];
    const tilts = lines.map(L => L.f[1] / L.half).sort((a, b) => a - b), medTilt = tilts[tilts.length >> 1];
    if (!opts.force && medBend < h * 0.0025 && Math.abs(medTilt) * w < h * 0.004) return null;
    // Fit the page surface; fall back to simpler shapes in y if the richer
    // one would stretch or squash letters (a sign of a wrong line).
    let D = null, used = 0;
    for (let J = lines.length >= 6 ? 3 : 2; J >= 1 && !D; J--) {
      const f = fitField(lines, w, h, J);
      if (!f || f.rms > 3) continue;
      if (steepest(f.D, w, h).share < 0.004) { D = f.D; used = J; }
    }
    if (!D) return null;
    // Full-resolution remap: out(x, y) = in(x, y + D).
    const Canvas = typeof OffscreenCanvas !== 'undefined' ? OffscreenCanvas : null;
    const mk = (cw, chh) => { if (Canvas) return new Canvas(cw, chh); const c = document.createElement('canvas'); c.width = cw; c.height = chh; return c; };
    const src = mk(W, H), sx = src.getContext('2d', { willReadFrequently: true }); sx.drawImage(canvas, 0, 0);
    const sd = sx.getImageData(0, 0, W, H).data, out = mk(W, H), ox = out.getContext('2d'), od = ox.createImageData(W, H), o = od.data;
    const kx = (w - 1) / Math.max(1, W - 1), ky = (h - 1) / Math.max(1, H - 1);
    for (let Y = 0; Y < H; Y++) {
      const fy = Y * ky, y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
      for (let X = 0; X < W; X++) {
        const fx = X * kx, x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
        const d = (D[y0 * w + x0] * (1 - tx) + D[y0 * w + x1] * tx) * (1 - ty) + (D[y1 * w + x0] * (1 - tx) + D[y1 * w + x1] * tx) * ty;
        let sy = Y + d / s; if (sy < 0) sy = 0; if (sy > H - 1) sy = H - 1;
        const a = Math.floor(sy), b = Math.min(H - 1, a + 1), u = sy - a, i = (Y * W + X) * 4, ia = (a * W + X) * 4, ib = (b * W + X) * 4;
        o[i] = sd[ia] + (sd[ib] - sd[ia]) * u; o[i + 1] = sd[ia + 1] + (sd[ib + 1] - sd[ia + 1]) * u; o[i + 2] = sd[ia + 2] + (sd[ib + 2] - sd[ia + 2]) * u; o[i + 3] = 255;
      }
    }
    ox.putImageData(od, 0, 0);
    if (Canvas) src.width = src.height = 1;
    if (opts.debug) out._dewarp = { lines: lines.length, J: used, medBend, medTilt };
    return out;
  }

  root.ScanDewarp = { dewarp, _findLines: findLines };
})(typeof self !== 'undefined' ? self : this);
