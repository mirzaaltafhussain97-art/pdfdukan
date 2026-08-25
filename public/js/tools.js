/* ================================================================
   CamMaster — Tools Module
   All 7 tools: img→pdf, pdf→img, merge, split, compress, ocr, age
================================================================ */

/* ── SHARED HELPERS ──────────────────────────────────────────── */
function _fmtBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}
function _escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}
function _showProgress(pct, msg) {
  const bar = document.getElementById('progressFill');
  const lbl = document.getElementById('progressLabel');
  if (bar) bar.style.width = pct + '%';
  if (lbl) lbl.textContent = msg || pct + '%';
}
function _showResult() {
  const rs = document.getElementById('resultSection');
  if (rs) rs.classList.add('show');
}
function _setDownloadBtn(enabled) {
  const btn = document.getElementById('downloadBtn');
  if (btn) btn.disabled = !enabled;
}
function _bindDropZone(zoneId, inputId, onFiles) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  if (!zone) return;
  zone.addEventListener('click', () => input && input.click());
  ['dragenter', 'dragover'].forEach(ev =>
    zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('drag'); })
  );
  ['dragleave', 'drop'].forEach(ev =>
    zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('drag'); })
  );
  zone.addEventListener('drop', e => {
    const files = [...e.dataTransfer.files];
    if (files.length) onFiles(files);
  });
  if (input) input.addEventListener('change', e => onFiles([...e.target.files]));
}
function _downloadBlob(blob, filename, toolName, action) {
  if (window.CMFilename) {
    window.CMFilename.prompt(filename).then(function(chosenName) {
      if (!chosenName) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = chosenName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(url); }, 1500);
      if (window.CMLogs) {
        window.CMLogs.log({
          tool: toolName || document.body.dataset.tool || 'Unknown',
          action: action || 'download',
          output: chosenName,
          size: blob.size
        });
      }
    });
  } else {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1500);
  }
}

/* ── FAQ Toggle (shared across all tool pages) ───────────────── */
function toggleFAQ(btn) {
  const item = btn.closest('.faq-item');
  if (!item) return;
  const isOpen = item.classList.contains('open');
  // Close all others
  document.querySelectorAll('.faq-item.open').forEach(el => {
    el.classList.remove('open');
    const q = el.querySelector('.faq-q');
    if (q) q.setAttribute('aria-expanded', 'false');
  });
  if (!isOpen) {
    item.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
  }
}

/* ================================================================
   1. IMAGE → PDF
================================================================ */
const ImageToPDF = (() => {
  let images = [];
  let pdfBlob = null;
  let isProcessing = false;

  function init() {
    _bindDropZone('dropZone', 'fileInput', addImages);
    const btn = document.getElementById('downloadBtn');
    if (btn) btn.onclick = download;
    ['pageSize', 'orientation', 'imgQuality', 'pageMargin'].forEach(id => {
      const control = document.getElementById(id);
      if (control) control.addEventListener('change', _resetResult);
    });
  }

  async function addImages(files) {
    const supported = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const imgs = files.filter(f => supported.has(f.type.toLowerCase()));
    if (!imgs.length) { toast('Please add image files (JPG, PNG, WEBP)', 'error'); return; }
    const added = await Promise.all(imgs.map(async (file, index) => ({
      id: `${Date.now()}_${index}_${Math.random().toString(36).slice(2)}`,
      file,
      src: await _readDataURL(file),
      rot: 0,
    })));
    images.push(...added);
    _resetResult();
    renderImageList();
  }

  function renderImageList() {
    const list = document.getElementById('fileList');
    if (!list) return;
    list.classList.toggle('img-grid', images.length > 0);
    list.innerHTML = images.map((img, i) => `
      <div class="img-card" data-id="${img.id}" title="Drag to reorder">
        <span class="img-card-num">${i + 1}</span>
        <div class="img-card-thumb"><img src="${img.src}" alt="" style="transform:rotate(${img.rot || 0}deg)"></div>
        <div class="img-card-name" title="${_escapeHTML(img.file.name)}">${_escapeHTML(img.file.name)}</div>
        <div class="img-card-meta">${_fmtBytes(img.file.size)}${img.rot ? ' · ' + img.rot + '°' : ''}</div>
        <div class="img-card-actions">
          <button type="button" onclick="ImageToPDF.move(${i},-1)" title="Move image up" aria-label="Move ${_escapeHTML(img.file.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" onclick="ImageToPDF.move(${i},1)" title="Move image down" aria-label="Move ${_escapeHTML(img.file.name)} down" ${i === images.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" onclick="ImageToPDF.rotate('${img.id}')" title="Rotate 90°">↻</button>
          <button type="button" class="img-card-del" onclick="ImageToPDF.remove('${img.id}')" title="Remove" aria-label="Remove ${_escapeHTML(img.file.name)}">✕</button>
        </div>
      </div>`).join('');

    // Drag-to-reorder (Sortable.js, also works with touch)
    if (window.Sortable && !list._sortable) {
      list._sortable = Sortable.create(list, {
        animation: 150,
        ghostClass: 'img-card-ghost',
        onEnd: e => {
          if (e.oldIndex === e.newIndex) return;
          const [moved] = images.splice(e.oldIndex, 1);
          images.splice(e.newIndex, 0, moved);
          _resetResult();
          renderImageList();
        }
      });
    }

    const genBtn = document.getElementById('generateBtn');
    if (genBtn) genBtn.disabled = !images.length;

    const bar = document.getElementById('imgSortBar');
    if (bar) bar.style.display = images.length > 0 ? 'flex' : 'none';
  }

  function remove(id) {
    images = images.filter(img => img.id != id);
    _resetResult();
    renderImageList();
  }

  // Rotate an image by 90° steps; applied to the thumbnail immediately and
  // baked into the page when the PDF is generated.
  function rotate(id) {
    const img = images.find(im => im.id == id);
    if (!img) return;
    img.rot = ((img.rot || 0) + 90) % 360;
    _resetResult();
    renderImageList();
  }

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    const [moved] = images.splice(index, 1);
    images.splice(target, 0, moved);
    _resetResult();
    renderImageList();
  }

  // Sort the image list by file name. dir = 'asc' | 'desc'. Uses natural
  // (numeric-aware) ordering so img2 comes before img10.
  function sort(dir) {
    images.sort((a, b) => {
      const cmp = a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' });
      return dir === 'desc' ? -cmp : cmp;
    });
    _resetResult();
    renderImageList();
  }

  async function generate() {
    if (!images.length) { toast('Add at least one image', 'error'); return; }
    if (isProcessing) return;
    isProcessing = true;
    const pc = document.getElementById('progressCard');
    if (pc) pc.style.display = 'block';
    const genBtn = document.getElementById('generateBtn');
    if (genBtn) genBtn.disabled = true;
    _resetResult();
    _showProgress(10, 'Starting…');

    const { jsPDF } = window.jspdf;
    const pageSize   = document.getElementById('pageSize')?.value || 'a4';
    const orientation = document.getElementById('orientation')?.value || 'portrait';
    const quality    = +(document.getElementById('imgQuality')?.value || 0.85);
    const margin     = +(document.getElementById('pageMargin')?.value || 5);

    try {
      const doc  = new jsPDF({ orientation, unit: 'mm', format: pageSize });
      doc.setProperties({ title: 'Images to PDF', creator: 'PDFdukan Image to PDF' });
      const fullW = doc.internal.pageSize.getWidth();
      const fullH = doc.internal.pageSize.getHeight();
      const pW   = fullW - margin * 2;
      const pH   = fullH - margin * 2;

      for (let i = 0; i < images.length; i++) {
        _showProgress(10 + Math.round((i / images.length) * 80), `Processing page ${i + 1}…`);
        if (i > 0) doc.addPage();

        const img = await _loadImage(images[i].src);

        // Compress via canvas at user-selected quality, baking in rotation
        const rot = images[i].rot || 0;
        const iw0 = img.naturalWidth  || img.width;
        const ih0 = img.naturalHeight || img.height;
        const preserveOriginal = quality >= 0.97 && rot === 0;
        let compSrc = images[i].src;
        let imgFormat = images[i].file.type === 'image/png' ? 'PNG' : images[i].file.type === 'image/webp' ? 'WEBP' : 'JPEG';
        let outW = iw0, outH = ih0;
        if (!preserveOriginal) {
          const c = document.createElement('canvas');
          if (rot % 180 === 0) { c.width = iw0; c.height = ih0; }
          else                 { c.width = ih0; c.height = iw0; }
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.save();
          ctx.translate(c.width / 2, c.height / 2);
          ctx.rotate(rot * Math.PI / 180);
          ctx.drawImage(img, -iw0 / 2, -ih0 / 2);
          ctx.restore();
          compSrc = c.toDataURL('image/jpeg', quality);
          imgFormat = 'JPEG';
          outW = c.width; outH = c.height;
        }

        const ar  = outW / outH;
        const pAr = pW / pH;
        let iw, ih;
        if (ar > pAr) { iw = pW; ih = pW / ar; }
        else          { ih = pH; iw = pH * ar; }
        const x = margin + (pW - iw) / 2;
        const y = margin + (pH - ih) / 2;

        doc.addImage(compSrc, imgFormat, x, y, iw, ih, undefined, preserveOriginal ? 'NONE' : 'MEDIUM');
      }

      pdfBlob = doc.output('blob');
      _showProgress(100, 'Done!');

      const stat = document.getElementById('statPages');
      const statSize = document.getElementById('statSize');
      if (stat) stat.textContent = images.length;
      if (statSize) statSize.textContent = _fmtBytes(pdfBlob.size);
      _showResult();
      _setDownloadBtn(true);
      toast(`PDF created — ${images.length} pages ✓`, 'success');
    } catch (e) {
      toast('PDF generation failed. Check the image format and try a smaller batch.', 'error');
      console.error(e);
    } finally {
      isProcessing = false;
      if (pc) pc.style.display = 'none';
      if (genBtn) genBtn.disabled = !images.length;
    }
  }

  function _readDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  function _loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode an image.'));
      img.src = src;
    });
  }

  function _resetResult() {
    pdfBlob = null;
    const result = document.getElementById('resultSection');
    if (result) result.classList.remove('show');
    _setDownloadBtn(false);
  }

  function download() {
    if (!pdfBlob) return;
    _downloadBlob(pdfBlob, `PDFdukan.com_images_${Date.now()}.pdf`, 'Image to PDF', 'convert');
    toast('PDF downloaded! ✓', 'success');
  }

  return { init, addImages, generate, remove, rotate, move, sort, download };
})();

/* ================================================================
   2. PDF → IMAGES
================================================================ */
const PDFToImages = (() => {
  let pdfFile = null;
  let renderedPages = [];
  let scale = 2.0;
  let isRendering = false;
  let isZipping = false;
  // Output format state (set from UI at render time)
  let fmt = 'image/jpeg', quality = 0.92, ext = 'jpg';
  // Browser canvas safety limits — oversized pages (e.g. GIS/poster PDFs) blow
  // past these and silently render blank/black, so we clamp the render scale.
  const MAX_DIM = 8000;          // longest side in px
  const MAX_AREA = 64 * 1e6;     // total pixels (≈ 8000 × 8000)

  function init() {
    _bindDropZone('dropZone', 'fileInput', loadPDF);
    const btn = document.getElementById('downloadBtn');
    if (btn) btn.onclick = downloadZIP;

    const scaleInput = document.getElementById('renderScale');
    if (scaleInput) scaleInput.addEventListener('change', () => { scale = +scaleInput.value || 2.0; });

    // Quality slider — live label + hide it for lossless PNG
    const q = document.getElementById('jpgQuality');
    const qVal = document.getElementById('qualityVal');
    if (q && qVal) q.addEventListener('input', () => { qVal.textContent = q.value + '%'; });

    const f = document.getElementById('outFormat');
    const qGroup = document.getElementById('qualityGroup');
    if (f && qGroup) f.addEventListener('change', () => {
      qGroup.style.opacity = f.value === 'image/png' ? '.4' : '1';
      const qi = document.getElementById('jpgQuality'); if (qi) qi.disabled = f.value === 'image/png';
    });

    // Page range — reveal the custom input only when "Custom range" is picked
    const pr = document.getElementById('pageRange');
    const prInput = document.getElementById('pageRangeInput');
    if (pr && prInput) pr.addEventListener('change', () => {
      prInput.style.display = pr.value === 'custom' ? 'block' : 'none';
    });
  }

  function _readOpts() {
    const f = document.getElementById('outFormat');
    fmt = f ? f.value : 'image/jpeg';
    ext = fmt === 'image/png' ? 'png' : fmt === 'image/webp' ? 'webp' : 'jpg';
    const q = document.getElementById('jpgQuality');
    quality = q ? (Math.max(60, Math.min(100, +q.value || 92)) / 100) : 0.92;
    const s = document.getElementById('renderScale');
    scale = s ? (+s.value || 2) : 2;
  }

  // Parse "1-3, 5, 8-10" into a sorted unique page list.
  function _selectedPageNumbers(total) {
    const sel = document.getElementById('pageRange');
    if (!sel || sel.value !== 'custom') return { pages: null, error: '' };
    const raw = ((document.getElementById('pageRangeInput') || {}).value || '').trim();
    if (!raw) return { pages: [], error: 'Enter page numbers, for example 1-3, 5.' };
    const parts = raw.split(',').map(part => part.trim());
    if (parts.some(part => !part)) return { pages: [], error: 'Remove empty entries between commas.' };
    const set = new Set();
    for (const part of parts) {
      const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) return { pages: [], error: `“${part}” is not valid. Use formats like 3 or 3-7.` };
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : start;
      if (start < 1 || end < 1 || start > total || end > total) return { pages: [], error: `Enter pages from 1 to ${total}.` };
      if (start > end) return { pages: [], error: `“${part}” runs backwards. Use ${end}-${start} instead.` };
      for (let page = start; page <= end; page++) set.add(page);
    }
    return { pages: [...set].sort((a, b) => a - b), error: '' };
  }

  async function loadPDF(files) {
    const file = files.find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!file) { toast('Please upload a PDF file', 'error'); return; }
    pdfFile = file;
    _resetResult();
    const pc = document.getElementById('progressCard');
    if (pc) pc.style.display = 'block';
    await renderPages();
  }

  // Re-run with the current options (format / quality / range) on the loaded file
  async function rerender() {
    if (!pdfFile) { toast('Upload a PDF first', 'error'); return; }
    const pc = document.getElementById('progressCard');
    if (pc) pc.style.display = 'block';
    await renderPages();
  }

  // Render one page to a white-backed canvas, clamping scale to browser limits.
  // White fill is essential: PDFs with a transparent page background (GIS/vector
  // exports) otherwise render as a black image once flattened to JPEG/WebP.
  async function _renderPageCanvas(page, reqScale) {
    const base = page.getViewport({ scale: 1 });
    let s = reqScale;
    const longest = Math.max(base.width, base.height) * s;
    if (longest > MAX_DIM) s *= MAX_DIM / longest;
    const area = (base.width * s) * (base.height * s);
    if (area > MAX_AREA) s *= Math.sqrt(MAX_AREA / area);

    const vp = page.getViewport({ scale: s });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d');
    if (fmt !== 'image/png') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
    }
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return { canvas: c, w: c.width, h: c.height, dpi: Math.round(s * 72), clamped: s < reqScale - 1e-6 };
  }

  async function renderPages() {
    if (!pdfFile) return;
    if (isRendering) return;
    isRendering = true;
    _readOpts();
    _resetResult();
    _showProgress(5, 'Loading PDF…');
    const pc = document.getElementById('progressCard');
    if (pc) pc.style.display = 'block';
    const applyBtn = document.getElementById('applyBtn');
    if (applyBtn) applyBtn.disabled = true;

    try {
      const ab = await pdfFile.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
      const total = pdf.numPages;

      const selection = _selectedPageNumbers(total);
      if (selection.error) throw new Error(selection.error);
      const pages = selection.pages || Array.from({ length: total }, (_, i) => i + 1);

      const previewWrap = document.getElementById('pagesPreview');
      if (previewWrap) previewWrap.innerHTML = '';

      let clampedAny = false;
      for (let k = 0; k < pages.length; k++) {
        const p = pages[k];
        _showProgress(5 + Math.round(((k + 1) / pages.length) * 90), `Rendering page ${p} (${k + 1} of ${pages.length})…`);
        const page = await pdf.getPage(p);
        const { canvas: c, w, h, dpi, clamped } = await _renderPageCanvas(page, scale);
        if (clamped) clampedAny = true;

        const blob = await new Promise(r => c.toBlob(r, fmt, fmt === 'image/png' ? undefined : quality));
        if (!blob) throw new Error(`Browser could not encode page ${p} as ${ext.toUpperCase()}.`);
        renderedPages.push({ blob, page: p, w, h, dpi, sel: true });

        if (previewWrap) {
          const thumb = document.createElement('div');
          thumb.className = 'page-thumb pt-selected';
          thumb.style.position = 'relative';
          thumb.tabIndex = 0;
          thumb.setAttribute('role', 'checkbox');
          thumb.setAttribute('aria-checked', 'true');
          thumb.setAttribute('aria-label', `Select page ${p}`);
          const check = document.createElement('span');
          check.className = 'pt-check';
          check.textContent = '✓';
          const tc = document.createElement('canvas');
          const ts = Math.min(150 / w, 180 / h, 1);
          tc.width = Math.round(w * ts); tc.height = Math.round(h * ts);
          tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height);
          const info = document.createElement('div');
          info.className = 'pt-info';
          info.innerHTML = `<div class="page-num">Page ${p}</div>`;
          const dlBtn = document.createElement('button');
          dlBtn.type = 'button';
          dlBtn.className = 'pt-dl-btn';
          dlBtn.textContent = '⬇ Download ' + ext.toUpperCase();
          const pageIdx = k;
          dlBtn.onclick = ev => { ev.stopPropagation(); downloadOne(pageIdx); };
          thumb.onclick = () => toggleSel(pageIdx);
          thumb.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleSel(pageIdx); } };
          info.appendChild(dlBtn);
          thumb.appendChild(check); thumb.appendChild(tc); thumb.appendChild(info);
          previewWrap.appendChild(thumb);
        }
      }

      _showProgress(100, `${pages.length} page${pages.length !== 1 ? 's' : ''} ready`);
      const stat = document.getElementById('statPages');
      const statDims = document.getElementById('statDims');
      if (stat) stat.textContent = pages.length;
      if (statDims && renderedPages[0]) statDims.textContent = `${Math.round(renderedPages[0].w)} × ${Math.round(renderedPages[0].h)} · ${renderedPages[0].dpi} DPI · ${ext.toUpperCase()}`;
      _showResult();
      _setDownloadBtn(true);
      _updateSelUI();
      if (applyBtn) applyBtn.style.display = 'inline-flex';
      toast(`${pages.length} page${pages.length !== 1 ? 's' : ''} rendered ✓`, 'success');
      if (clampedAny) toast(`Large page detected — rendered at max safe size (${MAX_DIM}px) for full browser compatibility`, 'info');
    } catch (e) {
      const expected = /Enter page|empty entries|not valid|runs backwards/.test(e.message || '');
      toast(expected ? e.message : (/password|encrypt/i.test(e.message || '') ? 'This PDF appears locked or encrypted. Unlock it first.' : 'PDF rendering failed. The file may be damaged, locked or unsupported.'), 'error');
      if (!expected) console.error(e);
    } finally {
      isRendering = false;
      if (pc) pc.style.display = 'none';
      if (applyBtn) applyBtn.disabled = false;
    }
  }

  function downloadOne(i) {
    const pg = renderedPages[i];
    if (!pg) return;
    _downloadBlob(pg.blob, `page_${String(pg.page).padStart(3, '0')}.${ext}`, 'PDF to JPG', 'convert');
    toast(`Page ${pg.page} downloaded ✓`, 'success');
  }

  // ── Page selection ──
  function toggleSel(i) {
    const pg = renderedPages[i];
    if (!pg) return;
    pg.sel = !pg.sel;
    const thumbs = document.querySelectorAll('#pagesPreview .page-thumb');
    if (thumbs[i]) {
      thumbs[i].classList.toggle('pt-selected', pg.sel);
      thumbs[i].setAttribute('aria-checked', String(pg.sel));
    }
    _updateSelUI();
  }

  function selectAll(on) {
    renderedPages.forEach(p => { p.sel = on; });
    document.querySelectorAll('#pagesPreview .page-thumb')
      .forEach(t => { t.classList.toggle('pt-selected', on); t.setAttribute('aria-checked', String(on)); });
    _updateSelUI();
  }

  function _updateSelUI() {
    const n     = renderedPages.filter(p => p.sel).length;
    const total = renderedPages.length;
    const bar   = document.getElementById('pageSelectBar');
    if (bar) bar.style.display = total > 1 ? 'flex' : 'none';
    const cnt = document.getElementById('selCount');
    if (cnt) cnt.textContent = `${n} of ${total} selected`;
    const btn = document.getElementById('downloadBtn');
    if (btn) {
      btn.disabled = n === 0;
      btn.innerHTML = n === 1 ? `<span>🖼️</span> Download ${ext.toUpperCase()}`
        : (n === total ? '<span>📦</span> Download All as ZIP'
                       : `<span>📦</span> Download ${n} Selected as ZIP`);
    }
  }

  async function downloadZIP() {
    if (isZipping) return;
    const sel = renderedPages.filter(p => p.sel);
    if (!sel.length) { toast('Select at least one page', 'error'); return; }
    // Single page — no point wrapping one JPG in a ZIP, download it directly.
    if (sel.length === 1) { downloadOne(renderedPages.indexOf(sel[0])); return; }
    isZipping = true;
    const pc = document.getElementById('progressCard');
    if (pc) pc.style.display = 'block';
    try {
      _showProgress(10, 'Creating ZIP…');
      const zip = new JSZip();
      sel.forEach(p => zip.file(`page_${String(p.page).padStart(3, '0')}.${ext}`, p.blob));
      _showProgress(70, 'Compressing…');
      const content = await zip.generateAsync({ type: 'blob' });
      _showProgress(100, 'Done!');
      _downloadBlob(content, `PDFdukan.com_pdf_pages_${Date.now()}.zip`, 'PDF to Images', 'convert');
      toast(`ZIP with ${sel.length} pages downloaded! ✓`, 'success');
    } catch (e) {
      toast('Could not create the ZIP. Try fewer pages.', 'error');
      console.error(e);
    } finally {
      isZipping = false;
      if (pc) pc.style.display = 'none';
    }
  }

  function _resetResult() {
    renderedPages = [];
    const result = document.getElementById('resultSection');
    if (result) result.classList.remove('show');
    const preview = document.getElementById('pagesPreview');
    if (preview) preview.innerHTML = '';
    _setDownloadBtn(false);
  }

  return { init, loadPDF, rerender, downloadZIP, downloadOne, toggleSel, selectAll };
})();

/* ================================================================
   2b. CROP PDF  — Draw a region on a page, export it at full quality
================================================================ */
const PDFCrop = (() => {
  let pdf = null, pageNum = 1, numPages = 1, fileName = 'document';
  let previewScale = 1;          // preview-canvas px per PDF point
  let bg = null;                 // offscreen canvas holding the rendered page
  // regions: free quadrilaterals in preview-canvas px { p: [tl, tr, br, bl] }
  let regions = [], active = -1;
  let drag = null;               // { mode, key, ... }
  let isExporting = false;
  let zoom = 1, baseFit = 1, baseCanvasW = 0, maxZoom = 4;  // preview zoom state
  const MIN = 18;                // smallest region side (preview px)
  const MAX_DIM = 8000, MAX_AREA = 64 * 1e6;  // browser canvas safety limits

  function _cv() { return document.getElementById('previewCanvas'); }
  function _ctx() { return _cv().getContext('2d'); }

  function init() {
    _bindDropZone('dropZone', 'fileInput', loadPDF);

    const q = document.getElementById('cropQuality');
    const qv = document.getElementById('cropQualityVal');
    if (q && qv) q.addEventListener('input', () => { qv.textContent = q.value + '%'; });

    const f = document.getElementById('cropFormat');
    const qg = document.getElementById('cropQualityGroup');
    if (f && qg) f.addEventListener('change', () => {
      qg.style.opacity = f.value === 'image/png' ? '.4' : '1';
      if (q) q.disabled = f.value === 'image/png';
    });

    const sc = document.getElementById('cropScale');
    if (sc) sc.addEventListener('change', _updateInfo);

    const stage = document.getElementById('cropStage');
    if (stage) {
      stage.addEventListener('pointerdown', _onDown);
      window.addEventListener('pointermove', _onMove);
      window.addEventListener('pointerup', _onUp);
    }
  }

  async function loadPDF(files) {
    const file = files.find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!file) { toast('Please upload a PDF file', 'error'); return; }
    if (!file.size) { toast('This PDF file is empty', 'error'); return; }
    if (file.size > 200 * 1024 * 1024) { toast('Please choose a PDF no larger than 200 MB', 'error'); return; }
    fileName = file.name.replace(/\.pdf$/i, '');
    const pc = document.getElementById('progressCard');
    if (pc) pc.style.display = 'block';
    _showProgress(20, 'Loading PDF…');
    try {
      const ab = await file.arrayBuffer();
      pdf = await pdfjsLib.getDocument({ data: ab }).promise;
      numPages = pdf.numPages;
      pageNum = 1;
      _showProgress(100, 'Ready');
      // Reveal the editor BEFORE rendering so the canvas can measure its container.
      const card = document.getElementById('cropCard');
      const opts = document.getElementById('optionsCard');
      if (card) card.classList.add('show');
      if (opts) opts.style.display = 'block';
      await _renderPreview();
      if (pc) pc.style.display = 'none';
    } catch (e) {
      toast('Could not open PDF: ' + e.message, 'error');
      if (pc) pc.style.display = 'none';
      console.error(e);
    }
  }

  // Full (re)load of a page: resets zoom + selections, then renders.
  async function _renderPreview() {
    const page = await pdf.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    // Fit the whole page inside a ~1000px box at zoom 1
    baseFit = Math.min(1000 / base.width, 1000 / base.height, 2);
    baseCanvasW = Math.floor(base.width * baseFit);
    // Cap zoom so the re-rendered page never exceeds a browser-safe ~6000px
    maxZoom = Math.max(3, Math.min(8, 8000 / (baseFit * Math.max(base.width, base.height))));
    zoom = 1; regions = []; active = -1;
    await _renderPage();

    const bar = document.getElementById('pageBar');
    if (bar) bar.style.display = numPages > 1 ? 'flex' : 'none';
    const lbl = document.getElementById('pageLabel');
    if (lbl) lbl.textContent = `Page ${pageNum} of ${numPages}`;
    const pv = document.getElementById('prevPage'); if (pv) pv.disabled = pageNum <= 1;
    const nx = document.getElementById('nextPage'); if (nx) nx.disabled = pageNum >= numPages;
  }

  // Render the current page at the current zoom (keeps existing selections).
  async function _renderPage() {
    const page = await pdf.getPage(pageNum);
    previewScale = baseFit * zoom;
    const vp = page.getViewport({ scale: previewScale });
    bg = document.createElement('canvas');
    bg.width = Math.floor(vp.width); bg.height = Math.floor(vp.height);
    const bctx = bg.getContext('2d');
    bctx.fillStyle = '#ffffff';
    bctx.fillRect(0, 0, bg.width, bg.height);
    await page.render({ canvasContext: bctx, viewport: vp }).promise;

    const c = _cv();
    c.width = bg.width; c.height = bg.height;
    // Display size drives the visual zoom; the scroll container handles overflow.
    const wrap = c.closest('.crop-stage-wrap');
    const aspect = bg.width / bg.height;
    const availW = ((wrap && wrap.clientWidth) ? wrap.clientWidth : baseCanvasW) - 20;
    const availH = Math.max(220, window.innerHeight * 0.72 - 20);   // matches .crop-stage-wrap max-height
    const baseDispW = Math.max(50, Math.min(availW, availH * aspect, baseCanvasW));
    c.style.maxWidth = 'none';
    c.style.width = Math.round(baseDispW * zoom) + 'px';
    c.style.height = 'auto';
    draw(); _updateInfo();
    const zl = document.getElementById('zoomLabel'); if (zl) zl.textContent = Math.round(zoom * 100) + '%';
  }

  // Zoom keeps selections: rescale region points by the zoom factor, then re-render sharp.
  // The visible centre is preserved so the page zooms symmetrically (from the middle),
  // not anchored to the top-left corner.
  async function setZoom(z) {
    if (!pdf) return;
    const nz = Math.max(1, Math.min(maxZoom, z));
    if (Math.abs(nz - zoom) < 1e-3) return;
    const wrap = _cv().closest('.crop-stage-wrap');
    let fx = 0.5, fy = 0.5;
    if (wrap && wrap.scrollWidth > wrap.clientWidth) fx = (wrap.scrollLeft + wrap.clientWidth / 2) / wrap.scrollWidth;
    if (wrap && wrap.scrollHeight > wrap.clientHeight) fy = (wrap.scrollTop + wrap.clientHeight / 2) / wrap.scrollHeight;
    const f = nz / zoom;
    regions.forEach(r => { r.p = r.p.map(q => ({ x: q.x * f, y: q.y * f })); });
    zoom = nz;
    await _renderPage();
    if (wrap) {
      wrap.scrollLeft = fx * wrap.scrollWidth - wrap.clientWidth / 2;
      wrap.scrollTop = fy * wrap.scrollHeight - wrap.clientHeight / 2;
    }
  }
  function zoomIn() { setZoom(zoom * 1.4); }
  function zoomOut() { setZoom(zoom / 1.4); }
  function zoomReset() { setZoom(1); }

  /* ── Geometry (free quadrilateral: region.p = [tl, tr, br, bl]) ─ */
  const ROT_OFF = 30, HR = 15, XR = 13;     // rotation offset, handle/remove hit radii
  const WARP_MAX = 4500, WARP_AREA = 20 * 1e6;  // limits for the perspective (warp) path
  function _centroid(r) { const p = r.p; return { x: (p[0].x + p[1].x + p[2].x + p[3].x) / 4, y: (p[0].y + p[1].y + p[2].y + p[3].y) / 4 }; }
  function _emid(r, i) { const a = r.p[i], b = r.p[(i + 1) % 4]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function _rotHandle(r) { const tm = _emid(r, 0), ct = _centroid(r); let nx = tm.x - ct.x, ny = tm.y - ct.y; const L = Math.hypot(nx, ny) || 1; return { x: tm.x + nx / L * ROT_OFF, y: tm.y + ny / L * ROT_OFF }; }
  function _xBtn(r) { const tr = r.p[1], ct = _centroid(r); let nx = tr.x - ct.x, ny = tr.y - ct.y; const L = Math.hypot(nx, ny) || 1; return { x: tr.x + nx / L * 20, y: tr.y + ny / L * 20 }; }
  function _inside(r, p) { let s = 0; for (let i = 0; i < 4; i++) { const a = r.p[i], b = r.p[(i + 1) % 4]; const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); const sg = cr >= 0 ? 1 : -1; if (i === 0) s = sg; else if (sg !== s) return false; } return true; }
  function _edgeLens(r) { const p = r.p, d = (a, b) => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y); return { wPx: Math.max(d(0, 1), d(3, 2)), hPx: Math.max(d(0, 3), d(1, 2)) }; }
  function _valid(r) { const { wPx, hPx } = _edgeLens(r); return wPx >= MIN && hPx >= MIN; }
  function _area(r) { const p = r.p; let a = 0; for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; a += p[i].x * p[j].y - p[j].x * p[i].y; } return Math.abs(a) / 2; }
  function _topAngle(r) { return Math.atan2(r.p[1].y - r.p[0].y, r.p[1].x - r.p[0].x); }
  // A quad is "rectangular" (affine-renderable from vector) if it's a parallelogram with a ~right angle.
  function _isRect(p) {
    const m1 = { x: (p[0].x + p[2].x) / 2, y: (p[0].y + p[2].y) / 2 }, m2 = { x: (p[1].x + p[3].x) / 2, y: (p[1].y + p[3].y) / 2 };
    if (Math.hypot(m1.x - m2.x, m1.y - m2.y) > 2) return false;
    const v1 = { x: p[1].x - p[0].x, y: p[1].y - p[0].y }, v2 = { x: p[3].x - p[0].x, y: p[3].y - p[0].y };
    const mg = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1;
    return Math.abs((v1.x * v2.x + v1.y * v2.y) / mg) < 0.03;
  }
  function _rectPts(x0, y0, x1, y1) { return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]; }
  function _clone(r) { return { p: r.p.map(q => ({ x: q.x, y: q.y })) }; }

  function _pos(e) {
    const c = _cv(), rect = c.getBoundingClientRect();
    const k = c.width / rect.width;
    return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k };
  }
  function _clampPt(p) { const c = _cv(); return { x: Math.max(0, Math.min(c.width, p.x)), y: Math.max(0, Math.min(c.height, p.y)) }; }

  /* ── Pointer handling ─────────────────────────────────────── */
  function _updateCursor(p) {
    const c = _cv(); if (!c || !pdf) return;
    let cur = 'crosshair';
    if (active >= 0 && regions[active]) {
      const r = regions[active];
      if (Math.hypot(p.x - _xBtn(r).x, p.y - _xBtn(r).y) < XR) cur = 'pointer';
      else if (Math.hypot(p.x - _rotHandle(r).x, p.y - _rotHandle(r).y) < HR) cur = 'grab';
      else if (r.p.some((_, k) => Math.hypot(p.x - r.p[k].x, p.y - r.p[k].y) < HR)) cur = 'nwse-resize';
      else if ([0,1,2,3].some(k => { const m = _emid(r,k); return Math.hypot(p.x-m.x, p.y-m.y) < HR; })) cur = 'nesw-resize';
      else if (_inside(r, p)) cur = 'move';
    }
    if (cur === 'crosshair') {
      for (let i = regions.length - 1; i >= 0; i--)
        if (_inside(regions[i], p)) { cur = 'move'; break; }
    }
    c.style.cursor = cur;
  }

  function _onDown(e) {
    if (!pdf) return;
    e.preventDefault();
    const p = _pos(e);
    // Remove (✕) button on any region
    for (let i = regions.length - 1; i >= 0; i--) {
      const xb = _xBtn(regions[i]);
      if (Math.hypot(p.x - xb.x, p.y - xb.y) < XR) {
        regions.splice(i, 1); active = regions.length ? Math.min(active, regions.length - 1) : -1;
        draw(); _updateInfo(); return;
      }
    }
    // Active region's handles take priority
    if (active >= 0) {
      const r = regions[active], ct = _centroid(r);
      if (Math.hypot(p.x - _rotHandle(r).x, p.y - _rotHandle(r).y) < HR) {
        drag = { mode: 'rotate', idx: active, orig: _clone(r), ct, a0: Math.atan2(p.y - ct.y, p.x - ct.x) };
        _cv().style.cursor = 'grabbing'; return;
      }
      for (let k = 0; k < 4; k++) if (Math.hypot(p.x - r.p[k].x, p.y - r.p[k].y) < HR) {
        drag = { mode: 'corner', key: k, idx: active }; _cv().style.cursor = 'grabbing'; return;
      }
      for (let k = 0; k < 4; k++) { const m = _emid(r, k); if (Math.hypot(p.x - m.x, p.y - m.y) < HR) {
        drag = { mode: 'edge', key: k, idx: active, start: p, orig: _clone(r) }; _cv().style.cursor = 'grabbing'; return;
      } }
      if (_inside(r, p)) { drag = { mode: 'move', idx: active, start: p, orig: _clone(r) }; _cv().style.cursor = 'grabbing'; return; }
    }
    // Click inside another region → select & move it
    for (let i = regions.length - 1; i >= 0; i--) {
      if (_inside(regions[i], p)) {
        active = i; drag = { mode: 'move', idx: i, start: p, orig: _clone(regions[i]) };
        _cv().style.cursor = 'grabbing'; draw(); _updateInfo(); return;
      }
    }
    // Start drawing a new region
    regions.push({ p: [{ x: p.x, y: p.y }, { x: p.x, y: p.y }, { x: p.x, y: p.y }, { x: p.x, y: p.y }] });
    active = regions.length - 1;
    drag = { mode: 'new', idx: active, start: p };
    draw();
  }

  function _onMove(e) {
    const p = _pos(e);
    if (!drag) { _updateCursor(p); return; }
    e.preventDefault();
    const r = regions[drag.idx], o = drag.orig;

    if (drag.mode === 'new') {
      const x0 = Math.min(drag.start.x, p.x), y0 = Math.min(drag.start.y, p.y);
      const x1 = Math.max(drag.start.x, p.x), y1 = Math.max(drag.start.y, p.y);
      r.p = _rectPts(x0, y0, x1, y1);
    } else if (drag.mode === 'move') {
      const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      r.p = o.p.map(q => ({ x: q.x + dx, y: q.y + dy }));
    } else if (drag.mode === 'corner') {                          // each corner moves independently
      const c = _clampPt(p); r.p[drag.key] = { x: c.x, y: c.y };
    } else if (drag.mode === 'edge') {                            // move a full edge (its 2 corners)
      const dx = p.x - drag.start.x, dy = p.y - drag.start.y, i = drag.key, j = (i + 1) % 4;
      r.p = o.p.map(q => ({ x: q.x, y: q.y }));
      r.p[i] = { x: o.p[i].x + dx, y: o.p[i].y + dy };
      r.p[j] = { x: o.p[j].x + dx, y: o.p[j].y + dy };
    } else if (drag.mode === 'rotate') {                          // rotate the whole quad around its centre
      let da = Math.atan2(p.y - drag.ct.y, p.x - drag.ct.x) - drag.a0;
      if (e.shiftKey) da = Math.round(da / (Math.PI / 12)) * (Math.PI / 12);   // snap 15°
      const ca = Math.cos(da), sa = Math.sin(da), ct = drag.ct;
      r.p = o.p.map(q => { const dx = q.x - ct.x, dy = q.y - ct.y; return { x: ct.x + dx * ca - dy * sa, y: ct.y + dx * sa + dy * ca }; });
    }
    draw(); _updateInfo();
  }

  function _onUp(e) {
    if (!drag) return;
    if (drag.mode === 'new' && !_valid(regions[drag.idx])) {
      regions.splice(drag.idx, 1); active = regions.length ? regions.length - 1 : -1;
    }
    drag = null;
    if (e) _updateCursor(_pos(e)); else _cv().style.cursor = 'crosshair';
    draw(); _updateInfo();
  }

  /* ── Toolbar actions ──────────────────────────────────────── */
  function _rotateRegion(r, rad) {
    const ct = _centroid(r), ca = Math.cos(rad), sa = Math.sin(rad);
    r.p = r.p.map(q => { const dx = q.x - ct.x, dy = q.y - ct.y; return { x: ct.x + dx * ca - dy * sa, y: ct.y + dx * sa + dy * ca }; });
  }
  function addRegion() {
    const c = _cv(); if (!c || !c.width) return;
    const x = c.width * 0.25, y = c.height * 0.25;
    regions.push({ p: _rectPts(x, y, x + c.width * 0.5, y + c.height * 0.5) });
    active = regions.length - 1; draw(); _updateInfo();
  }
  function fitPage() {
    const c = _cv(); if (!c || !c.width) return;
    const r = { p: _rectPts(0, 0, c.width, c.height) };
    if (active >= 0) regions[active] = r; else { regions.push(r); active = regions.length - 1; }
    draw(); _updateInfo();
  }
  function deleteRegion() {
    if (active < 0) return;
    regions.splice(active, 1); active = regions.length ? regions.length - 1 : -1; draw(); _updateInfo();
  }
  function rotate(deg) {
    if (active < 0) { toast('Add a crop box first', 'error'); return; }
    _rotateRegion(regions[active], deg * Math.PI / 180); draw(); _updateInfo();
  }
  function resetAngle() { if (active >= 0) { _rotateRegion(regions[active], -_topAngle(regions[active])); draw(); _updateInfo(); } }

  /* ── Drawing ──────────────────────────────────────────────── */
  function _polyP(ctx, p) { ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(p[i].x, p[i].y); ctx.closePath(); }
  function _dot(ctx, x, y, rad) { ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fillStyle = '#ff6333'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke(); }
  function _xMark(ctx, x, y) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#e53935'; ctx.stroke();
    ctx.lineWidth = 2.2; ctx.beginPath();
    ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke();
    ctx.restore();
  }

  function draw() {
    const c = _cv(); if (!c || !bg) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(bg, 0, 0);

    // Dim the area OUTSIDE the crop boxes — but only when at least one box
    // exists, so the page shows in its original colours while nothing is selected.
    if (regions.some(r => _area(r) > 4)) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.globalCompositeOperation = 'destination-out';
      regions.forEach(r => { if (_area(r) > 4) { _polyP(ctx, r.p); ctx.fill(); } });
      ctx.restore();
    }

    regions.forEach((r, i) => {
      if (_area(r) < 4) return;
      // tint + border
      ctx.save();
      _polyP(ctx, r.p); ctx.fillStyle = 'rgba(255,99,51,0.06)'; ctx.fill();
      ctx.strokeStyle = '#ff6333'; ctx.lineWidth = i === active ? 2.5 : 1.5;
      if (i !== active) ctx.setLineDash([6, 4]);
      _polyP(ctx, r.p); ctx.stroke();
      ctx.restore();

      _xMark(ctx, _xBtn(r).x, _xBtn(r).y);   // remove (✕) button on every region

      if (i === active) {
        // rotation handle: line from top-edge mid to the rot dot
        const tm = _emid(r, 0), rh = _rotHandle(r);
        ctx.strokeStyle = '#ff6333'; ctx.lineWidth = 2; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(tm.x, tm.y); ctx.lineTo(rh.x, rh.y); ctx.stroke();
        _dot(ctx, rh.x, rh.y, 7);
        for (let k = 0; k < 4; k++) { const m = _emid(r, k); _dot(ctx, m.x, m.y, 5.5); }   // edge handles
        for (let k = 0; k < 4; k++) _dot(ctx, r.p[k].x, r.p[k].y, 7);                        // corner handles
      }
    });
  }

  /* ── Info + buttons ───────────────────────────────────────── */
  function _outScale() { const s = document.getElementById('cropScale'); return s ? (+s.value || 4) : 4; }
  function _plan(r) {
    const { wPx, hPx } = _edgeLens(r);
    const wPt = wPx / previewScale, hPt = hPx / previewScale;
    const rect = _isRect(r.p);
    let S = _outScale();
    const md = rect ? MAX_DIM : WARP_MAX, ma = rect ? MAX_AREA : WARP_AREA;
    const lo = Math.max(wPt, hPt) * S; if (lo > md) S *= md / lo;
    if ((wPt * S) * (hPt * S) > ma) S *= Math.sqrt(ma / ((wPt * S) * (hPt * S)));
    if (!rect) {
      const xs = r.p.map(q => q.x), ys = r.p.map(q => q.y);
      const bw = (Math.max(...xs) - Math.min(...xs)) / previewScale, bh = (Math.max(...ys) - Math.min(...ys)) / previewScale;
      const bl = Math.max(bw, bh) * S; if (bl > MAX_DIM) S *= MAX_DIM / bl;
    }
    return { rect, S, requestedS: _outScale(), outW: Math.max(1, Math.round(wPt * S)), outH: Math.max(1, Math.round(hPt * S)) };
  }
  function _updateInfo() {
    const info = document.getElementById('cropInfo');
    const al = document.getElementById('angleLabel');
    const dl = document.getElementById('cropDownloadBtn');
    const da = document.getElementById('cropDownloadAllBtn');
    const valid = regions.filter(_valid).length;
    if (al) al.textContent = active >= 0 ? `${Math.round((((_topAngle(regions[active]) * 180 / Math.PI) % 360) + 360) % 360)}°` : '0°';
    if (dl) dl.disabled = !(active >= 0 && _valid(regions[active]));
    if (da) da.style.display = valid > 1 ? 'flex' : 'none';
    if (!info) return;
    if (!valid) { info.textContent = 'No crop yet — drag on the page'; return; }
    if (active >= 0 && _valid(regions[active])) {
      const d = _plan(regions[active]);
      const dpi = Math.round(d.S * 72), capped = d.S + 0.001 < d.requestedS;
      info.innerHTML = `<strong>${valid}</strong> crop${valid > 1 ? 's' : ''} · selected: <strong>${d.outW} × ${d.outH}px</strong> · about <strong>${dpi} DPI</strong>${capped ? ' <span style="color:var(--warning)">(browser-safe cap applied)</span>' : ''}${d.rect ? '' : ' <span style="color:var(--text-3)">(perspective)</span>'}`;
    } else {
      info.innerHTML = `<strong>${valid}</strong> crop${valid > 1 ? 's' : ''}`;
    }
  }

  function prevPage() { if (pageNum > 1) { if (regions.length) toast('Crop boxes apply only to one page and were cleared when you changed pages.', 'info'); pageNum--; _renderPreview(); } }
  function nextPage() { if (pageNum < numPages) { if (regions.length) toast('Crop boxes apply only to one page and were cleared when you changed pages.', 'info'); pageNum++; _renderPreview(); } }

  /* ── Perspective warp helpers (pure JS, for non-rectangular quads) ── */
  function _solve8(A, b) {
    const n = 8, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let pr = c, pv = Math.abs(M[c][c]);
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > pv) { pv = Math.abs(M[r][c]); pr = r; }
      if (pv < 1e-10) return null;
      const t = M[c]; M[c] = M[pr]; M[pr] = t;
      for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  }
  function _homography(s, d) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const sx = s[i].x, sy = s[i].y, dx = d[i].x, dy = d[i].y;
      A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]); b.push(dx);
      A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]); b.push(dy);
    }
    const h = _solve8(A, b); if (!h) return null;
    return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  }
  function _inv3(m) {
    const [[a, b, c], [d, e, f], [g, h, k]] = m;
    const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-12) return null; const i = 1 / det;
    return [[(e * k - f * h) * i, (c * h - b * k) * i, (b * f - c * e) * i],
            [(f * g - d * k) * i, (a * k - c * g) * i, (c * d - a * f) * i],
            [(d * h - e * g) * i, (b * g - a * h) * i, (a * e - b * d) * i]];
  }
  function _warp(src, srcQuad, outW, outH) {
    const H = _homography(srcQuad, [{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }]);
    if (!H) return null; const Hi = _inv3(H); if (!Hi) return null;
    const [[a, b, c], [d, e, f], [g, h, k]] = Hi;
    const sctx = src.getContext('2d'), sw = src.width, sh = src.height, sd = sctx.getImageData(0, 0, sw, sh).data;
    const out = document.createElement('canvas'); out.width = outW; out.height = outH;
    const octx = out.getContext('2d'), od = octx.createImageData(outW, outH), o = od.data;
    for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
      const wx = a * x + b * y + c, wy = d * x + e * y + f, ww = g * x + h * y + k;
      const sx = wx / ww, sy = wy / ww, oi = (y * outW + x) * 4;
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) { o[oi] = o[oi + 1] = o[oi + 2] = o[oi + 3] = 255; continue; }
      const x0 = sx | 0, y0 = sy | 0, x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
      const tx = sx - x0, ty = sy - y0, itx = 1 - tx, ity = 1 - ty;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      for (let ch = 0; ch < 4; ch++) o[oi + ch] = (sd[i00 + ch] * itx * ity + sd[i10 + ch] * tx * ity + sd[i01 + ch] * itx * ty + sd[i11 + ch] * tx * ty) + 0.5 | 0;
    }
    octx.putImageData(od, 0, 0); return out;
  }

  /* ── Export (each region from the PDF vector, high-DPI) ───── */
  async function _renderRegion(r, fmt, quality) {
    const page = await pdf.getPage(pageNum);
    const plan = _plan(r), S = plan.S, outW = plan.outW, outH = plan.outH;

    if (plan.rect) {
      // Affine de-rotate: o = O + S·R(-θ)·(p − C)
      const ct = _centroid(r), cxPt = ct.x / previewScale, cyPt = ct.y / previewScale;
      const th = _topAngle(r), ca = Math.cos(th), sa = Math.sin(th);
      const aa = S * ca, cc = S * sa, bb = -S * sa, dd = S * ca;
      const ee = outW / 2 - (aa * cxPt + cc * cyPt), ff = outH / 2 - (bb * cxPt + dd * cyPt);
      const cv2 = document.createElement('canvas'); cv2.width = outW; cv2.height = outH;
      const ctx = cv2.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, outW, outH);
      await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: 1 }), transform: [aa, bb, cc, dd, ee, ff] }).promise;
      const blob = await new Promise((res, reject) => cv2.toBlob(b => b ? res(b) : reject(new Error('This browser could not encode the crop.')), fmt, fmt === 'image/png' ? undefined : quality));
      return { blob, w: outW, h: outH };
    }

    // Non-rectangular quad: render the bounding box from vector, then perspective-warp it straight.
    const xs = r.p.map(q => q.x), ys = r.p.map(q => q.y);
    const minXpx = Math.min(...xs), minYpx = Math.min(...ys), maxXpx = Math.max(...xs), maxYpx = Math.max(...ys);
    const minXpt = minXpx / previewScale, minYpt = minYpx / previewScale;
    const bw = Math.max(1, Math.round((maxXpx - minXpx) / previewScale * S));
    const bh = Math.max(1, Math.round((maxYpx - minYpx) / previewScale * S));
    const srcC = document.createElement('canvas'); srcC.width = bw; srcC.height = bh;
    const sctx = srcC.getContext('2d'); sctx.fillStyle = '#ffffff'; sctx.fillRect(0, 0, bw, bh);
    await page.render({ canvasContext: sctx, viewport: page.getViewport({ scale: 1 }), transform: [S, 0, 0, S, -minXpt * S, -minYpt * S] }).promise;
    const srcQuad = r.p.map(q => ({ x: (q.x - minXpx) / previewScale * S, y: (q.y - minYpx) / previewScale * S }));
    const out = _warp(srcC, srcQuad, outW, outH);
    if (!out) throw new Error('perspective warp failed');
    const blob = await new Promise((res, reject) => out.toBlob(b => b ? res(b) : reject(new Error('This browser could not encode the crop.')), fmt, fmt === 'image/png' ? undefined : quality));
    return { blob, w: outW, h: outH };
  }

  function _fmtOpts() {
    const fmt = (document.getElementById('cropFormat') || {}).value || 'image/jpeg';
    const ext = fmt === 'image/png' ? 'png' : fmt === 'image/webp' ? 'webp' : 'jpg';
    const q = document.getElementById('cropQuality');
    const quality = q ? Math.max(60, Math.min(100, +q.value || 95)) / 100 : 0.95;
    return { fmt, ext, quality };
  }

  async function downloadActive() {
    if (isExporting) return;
    if (active < 0 || !_valid(regions[active])) { toast('Draw or select a crop first', 'error'); return; }
    isExporting = true;
    const { fmt, ext, quality } = _fmtOpts();
    const pc = document.getElementById('progressCard');
    if (pc) pc.style.display = 'block';
    _showProgress(40, 'Rendering crop…');
    try {
      const { blob, w, h } = await _renderRegion(regions[active], fmt, quality);
      _showProgress(100, 'Done!');
      _downloadBlob(blob, `${fileName}_crop_${w}x${h}.${ext}`, 'Crop PDF', 'convert');
      toast(`Crop saved — ${w} × ${h}px ✓`, 'success');
      if (pc) pc.style.display = 'none';
    } catch (e) {
      toast('Crop failed: ' + e.message, 'error');
      if (pc) pc.style.display = 'none';
      console.error(e);
    } finally {
      isExporting = false;
    }
  }

  async function downloadAll() {
    if (isExporting) return;
    const list = regions.filter(_valid);
    if (!list.length) { toast('Add at least one crop', 'error'); return; }
    if (list.length === 1) { active = regions.indexOf(list[0]); return downloadActive(); }
    if (typeof JSZip === 'undefined') { toast('ZIP library still loading — try again', 'error'); return; }
    isExporting = true;
    const { fmt, ext, quality } = _fmtOpts();
    const pc = document.getElementById('progressCard');
    if (pc) pc.style.display = 'block';
    try {
      const zip = new JSZip();
      for (let i = 0; i < list.length; i++) {
        _showProgress(Math.round((i / list.length) * 80) + 10, `Rendering crop ${i + 1} of ${list.length}…`);
        const { blob } = await _renderRegion(list[i], fmt, quality);
        zip.file(`${fileName}_page_${String(pageNum).padStart(3, '0')}_crop_${String(i + 1).padStart(2, '0')}.${ext}`, blob);
      }
      _showProgress(90, 'Zipping…');
      const content = await zip.generateAsync({ type: 'blob' });
      _showProgress(100, 'Done!');
      _downloadBlob(content, `${fileName}_crops_${Date.now()}.zip`, 'Crop PDF', 'convert');
      toast(`${list.length} crops downloaded ✓`, 'success');
      if (pc) pc.style.display = 'none';
    } catch (e) {
      toast('Export failed: ' + e.message, 'error');
      if (pc) pc.style.display = 'none';
      console.error(e);
    } finally {
      isExporting = false;
    }
  }

  return { init, loadPDF, prevPage, nextPage, addRegion, fitPage, deleteRegion, rotate, resetAngle, zoomIn, zoomOut, zoomReset, downloadActive, downloadAll };
})();

/* ================================================================
   3. MERGE PDF  — Advanced workspace with per-file page selection
================================================================ */
const MergePDF = (() => {
  // pdfFiles: [{ id, file, name, size, totalPages, pageChecks: [bool…] }]
  let pdfFiles   = [];
  let mergedBlob = null;
  let isProcessing = false;

  function init() {
    _bindDropZone('dropZone', 'fileInput', addPDFs);
    const btn = document.getElementById('downloadBtn');
    if (btn) btn.onclick = download;

    // Consume pending files from homepage drop/import
    if (typeof consumePendingFiles === 'function') {
      const pending = consumePendingFiles();
      if (pending && pending.length) addPDFs(pending);
    }
  }

  async function addPDFs(files) {
    const pdfs = files.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) { toast('Please add PDF files', 'error'); return; }

    // Show a brief loading indicator while reading page counts
    const mergeBtn = document.getElementById('mergeBtn');
    if (mergeBtn) mergeBtn.textContent = '⏳ Loading…';

    for (const file of pdfs) {
      try {
        const ab = await file.arrayBuffer();
        const { PDFDocument } = PDFLib;
        const doc = await PDFDocument.load(ab);
        const totalPages = doc.getPageCount();
        if (!totalPages) throw new Error('This PDF has no pages.');
        pdfFiles.push({
          id: Date.now() + '_' + Math.random().toString(36).slice(2),
          file, name: file.name, size: file.size,
          totalPages,
          pageChecks: new Array(totalPages).fill(true),
        });
      } catch(e) {
        const reason = /encrypt|password/i.test(e.message)
          ? 'it is locked or encrypted'
          : 'it may be damaged or unsupported';
        toast(`Could not add ${file.name}: ${reason}.`, 'error');
      }
    }

    if (mergeBtn) mergeBtn.textContent = '🔗 Merge PDFs';
    _resetResult();
    renderList();
  }

  function renderList() {
    const list = document.getElementById('fileList');
    if (!list) return;

    list.innerHTML = pdfFiles.map((f, fileIdx) => {
      const checkedCount = f.pageChecks.filter(Boolean).length;
      const pagesHTML = f.pageChecks.map((checked, pi) => `
        <label class="pfc-page${checked ? '' : ' unchecked'}" title="Page ${pi + 1}">
          <input type="checkbox" ${checked ? 'checked' : ''}
            onchange="MergePDF.togglePage(${fileIdx},${pi},this.checked)">
          <span class="pp-num">${pi + 1}</span>
        </label>`).join('');

      return `
        <div class="pdf-file-card" data-id="${f.id}">
          <div class="pfc-header">
            <span class="pfc-drag" title="Drag to reorder">⠿</span>
            <span class="pfc-doc-icon">📄</span>
            <div class="pfc-info">
              <div class="pfc-name" title="${_escapeHTML(f.name)}">${_escapeHTML(f.name)}</div>
              <div class="pfc-meta">${_fmtBytes(f.size)} · ${f.totalPages} page${f.totalPages !== 1 ? 's' : ''}</div>
            </div>
            <div class="pfc-controls">
              <button class="pfc-btn" onclick="MergePDF.move(${fileIdx},-1)" title="Move file up" aria-label="Move ${_escapeHTML(f.name)} up" ${fileIdx === 0 ? 'disabled' : ''}>↑</button>
              <button class="pfc-btn" onclick="MergePDF.move(${fileIdx},1)" title="Move file down" aria-label="Move ${_escapeHTML(f.name)} down" ${fileIdx === pdfFiles.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="pfc-btn" onclick="MergePDF.selectAll(${fileIdx},true)" title="Select all pages">All</button>
              <button class="pfc-btn" onclick="MergePDF.selectAll(${fileIdx},false)" title="Deselect all pages">None</button>
              <button class="pfc-btn" onclick="MergePDF.promptRange(${fileIdx})" title="Select a page range">Range…</button>
              <button class="pfc-del" onclick="MergePDF.remove(${fileIdx})" title="Remove file" aria-label="Remove ${_escapeHTML(f.name)}">✕</button>
            </div>
          </div>
          <div class="pfc-pages">${pagesHTML}</div>
          <div class="pfc-summary" id="pfcsum_${fileIdx}">
            ${checkedCount} / ${f.totalPages} pages selected
          </div>
        </div>`;
    }).join('');

    const mergeBtn = document.getElementById('mergeBtn');
    if (mergeBtn) mergeBtn.disabled = pdfFiles.length < 2;

    const sortBar = document.getElementById('mergeSortBar');
    if (sortBar) sortBar.style.display = pdfFiles.length > 0 ? 'flex' : 'none';

    // Re-init Sortable after DOM rebuild
    if (window.Sortable) {
      if (list._sortable) { try { list._sortable.destroy(); } catch(e){} }
      if (list.children.length > 1) {
        list._sortable = Sortable.create(list, {
          animation: 150,
          handle: '.pfc-drag',
          ghostClass: 'sortable-ghost',
          onEnd: e => { MergePDF.reorder(e.oldIndex, e.newIndex); },
        });
      }
    }
  }

  function togglePage(fileIdx, pageIdx, checked) {
    if (!pdfFiles[fileIdx]) return;
    pdfFiles[fileIdx].pageChecks[pageIdx] = checked;
    _resetResult();
    const sum = document.getElementById(`pfcsum_${fileIdx}`);
    if (sum) {
      const f = pdfFiles[fileIdx];
      const c = f.pageChecks.filter(Boolean).length;
      sum.textContent = `${c} / ${f.totalPages} pages selected`;
    }
    // Update visual class on the label without full re-render
    const list = document.getElementById('fileList');
    if (list) {
      const card  = list.children[fileIdx];
      if (card) {
        const labels = card.querySelectorAll('.pfc-page');
        if (labels[pageIdx]) labels[pageIdx].classList.toggle('unchecked', !checked);
      }
    }
  }

  function selectAll(fileIdx, checked) {
    if (!pdfFiles[fileIdx]) return;
    pdfFiles[fileIdx].pageChecks = pdfFiles[fileIdx].pageChecks.map(() => checked);
    _resetResult();
    renderList();
  }

  function promptRange(fileIdx) {
    const f = pdfFiles[fileIdx];
    if (!f) return;
    const raw = prompt(
      `Select pages for "${f.name}" (total: ${f.totalPages})\nExamples: "1-3, 5, 7-10"`,
      ''
    );
    if (raw === null) return;
    const parsed = _parsePageSelection(raw, f.totalPages);
    if (parsed.error) { toast(parsed.error, 'error'); return; }
    const selected = parsed.checks.filter(Boolean).length;
    pdfFiles[fileIdx].pageChecks = parsed.checks;
    _resetResult();
    renderList();
    toast(`${selected} pages selected for ${f.name}`, 'success');
  }

  function remove(idx) {
    pdfFiles.splice(idx, 1);
    _resetResult();
    renderList();
  }

  function reorder(from, to) {
    if (from < 0 || to < 0 || from >= pdfFiles.length || to >= pdfFiles.length) return;
    const moved = pdfFiles.splice(from, 1)[0];
    pdfFiles.splice(to, 0, moved);
    _resetResult();
    renderList();
  }

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= pdfFiles.length) return;
    reorder(index, target);
  }

  // Sort merged files. by = 'name' | 'size'; dir = 'asc' | 'desc'.
  function sort(by, dir) {
    pdfFiles.sort((a, b) => {
      let cmp;
      if (by === 'size') cmp = a.size - b.size;
      else cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      return dir === 'desc' ? -cmp : cmp;
    });
    _resetResult();
    renderList();
  }

  async function merge() {
    if (pdfFiles.length < 2) { toast('Add at least 2 PDFs', 'error'); return; }
    if (isProcessing) return;
    const totalSelected = pdfFiles.reduce((s, f) => s + f.pageChecks.filter(Boolean).length, 0);
    if (!totalSelected) { toast('Select at least one page to merge', 'error'); return; }
    isProcessing = true;

    const pc = document.getElementById('progressCard');
    if (pc) pc.style.display = 'block';
    _showProgress(5, 'Merging…');
    const mergeBtn = document.getElementById('mergeBtn');
    if (mergeBtn) mergeBtn.disabled = true;

    try {
      const { PDFDocument } = PDFLib;
      const merged = await PDFDocument.create();
      merged.setTitle('Merged PDF');
      merged.setCreator('PDFdukan Merge PDF');
      merged.setProducer('PDFdukan using pdf-lib');

      for (let i = 0; i < pdfFiles.length; i++) {
        const pf = pdfFiles[i];
        const indices = pf.pageChecks.reduce((acc, c, idx) => { if (c) acc.push(idx); return acc; }, []);
        if (!indices.length) continue;
        _showProgress(5 + Math.round(((i + 1) / pdfFiles.length) * 85), `Adding ${pf.name}…`);
        const ab  = await pf.file.arrayBuffer();
        const doc = await PDFDocument.load(ab);
        const pages = await merged.copyPages(doc, indices);
        pages.forEach(p => merged.addPage(p));
      }

      _showProgress(95, 'Saving…');
      const bytes = await merged.save();
      mergedBlob = new Blob([bytes], { type: 'application/pdf' });
      _showProgress(100, 'Done!');

      const stat     = document.getElementById('statPages');
      const statSize = document.getElementById('statSize');
      if (stat)     stat.textContent     = merged.getPageCount() + ' pages';
      if (statSize) statSize.textContent = _fmtBytes(mergedBlob.size);
      _showResult();
      _setDownloadBtn(true);
      toast(`Merged ${merged.getPageCount()} pages from ${pdfFiles.length} files ✓`, 'success');
    } catch (e) {
      toast('Merge failed. Check that every PDF is unlocked and supported, then try again.', 'error');
      console.error(e);
    } finally {
      isProcessing = false;
      if (pc) pc.style.display = 'none';
      if (mergeBtn) mergeBtn.disabled = pdfFiles.length < 2;
    }
  }

  function _parsePageSelection(raw, total) {
    const value = raw.trim();
    if (!value) return { checks: [], error: 'Enter pages, for example 1-3, 5, 7-10.' };
    const segments = value.split(',').map(s => s.trim());
    if (segments.some(s => !s)) return { checks: [], error: 'Remove empty entries between commas.' };
    const checks = new Array(total).fill(false);
    for (const segment of segments) {
      const match = segment.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) return { checks: [], error: `“${segment}” is not valid. Use formats like 3 or 3-7.` };
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : start;
      if (start < 1 || end < 1 || start > total || end > total) return { checks: [], error: `Enter pages from 1 to ${total}.` };
      if (start > end) return { checks: [], error: `“${segment}” runs backwards. Use ${end}-${start} instead.` };
      for (let page = start; page <= end; page++) checks[page - 1] = true;
    }
    return { checks, error: '' };
  }

  function _resetResult() {
    mergedBlob = null;
    const result = document.getElementById('resultSection');
    if (result) result.classList.remove('show');
    _setDownloadBtn(false);
  }

  function download() {
    if (!mergedBlob) return;
    _downloadBlob(mergedBlob, `PDFdukan.com_merged_${Date.now()}.pdf`, 'Merge PDF', 'merge');
    toast('Merged PDF downloaded! ✓', 'success');
  }

  return { init, addPDFs, merge, remove, reorder, move, sort, togglePage, selectAll, promptRange, download };
})();

/* ================================================================
   4. SPLIT PDF  — Visual page grid with click-to-split breakpoints
================================================================ */
const SplitPDF = (() => {
  let pdfFile    = null;
  let totalPages = 0;
  let zipBlob    = null;
  let parts      = []; // [{ bytes, name, pageCount }] — for per-part downloads
  let splitPoints = new Set(); // page indices (1-based) AFTER which to split
  let isProcessing = false;
  const VISUAL_PREVIEW_LIMIT = 60;

  function init() {
    _bindDropZone('dropZone', 'fileInput', loadPDF);
    const dlBtn   = document.getElementById('downloadBtn');
    if (dlBtn) dlBtn.onclick = download;
    const splBtn  = document.getElementById('splitBtn');
    if (splBtn) splBtn.onclick = split;

    document.querySelectorAll('input[name="splitMode"]').forEach(inp =>
      inp.addEventListener('change', _updateModeUI)
    );

    // Consume pending files from homepage drop
    if (typeof consumePendingFiles === 'function') {
      const pending = consumePendingFiles();
      if (pending) {
        const pdf = pending.find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
        if (pdf) loadPDF([pdf]);
      }
    }
  }

  function _updateModeUI() {
    let mode = document.querySelector('input[name="splitMode"]:checked')?.value || 'all';
    if (mode === 'visual' && totalPages > VISUAL_PREVIEW_LIMIT) {
      const ranges = document.querySelector('input[name="splitMode"][value="ranges"]');
      if (ranges) ranges.checked = true;
      mode = 'ranges';
      toast(`Visual Split supports previews for up to ${VISUAL_PREVIEW_LIMIT} pages. Use Custom Ranges for this PDF.`, 'error');
    }
    document.querySelectorAll('.split-option').forEach(el => el.classList.remove('show'));
    const target = document.getElementById('opt_' + mode);
    if (target) target.classList.add('show');
    const gridSection = document.getElementById('pageGridSection');
    if (gridSection) gridSection.style.display = mode === 'visual' ? 'block' : 'none';
    _updateGroupLabel();
  }

  async function loadPDF(files) {
    const file = files.find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!file) { toast('Please upload a PDF', 'error'); return; }
    pdfFile = file;
    splitPoints.clear();
    _resetResult();

    const pc = document.getElementById('progressCard');
    if (pc) pc.style.display = 'block';
    _showProgress(5, 'Loading PDF…');

    try {
      const ab = await file.arrayBuffer();
      const { PDFDocument } = PDFLib;
      const doc = await PDFDocument.load(ab);
      totalPages = doc.getPageCount();
      if (!totalPages) throw new Error('This PDF has no pages.');

      const info = document.getElementById('pdfInfo');
      if (info) { info.textContent = `${file.name} — ${totalPages} pages`; info.style.display = 'block'; }

      const splitBtn = document.getElementById('splitBtn');
      if (splitBtn) splitBtn.disabled = false;
      const everyN = document.getElementById('everyN');
      if (everyN) everyN.max = String(totalPages);
      const visualInput = document.querySelector('input[name="splitMode"][value="visual"]');
      const visualCard = visualInput?.closest('.mode-card');
      if (visualInput) visualInput.disabled = totalPages > VISUAL_PREVIEW_LIMIT;
      if (visualCard) {
        visualCard.classList.toggle('mode-disabled', totalPages > VISUAL_PREVIEW_LIMIT);
        visualCard.setAttribute('aria-disabled', totalPages > VISUAL_PREVIEW_LIMIT ? 'true' : 'false');
        const desc = visualCard.querySelector('.mc-desc');
        if (desc) desc.textContent = totalPages > VISUAL_PREVIEW_LIMIT
          ? `Use ranges above ${VISUAL_PREVIEW_LIMIT} pages`
          : 'Click between pages below';
      }

      _showProgress(30, 'Rendering previews…');

      // Render page thumbnails if PDF.js is available
      if (window.pdfjsLib) {
        await _renderGrid(ab);
      } else {
        _renderGridPlaceholder();
      }

      _showProgress(100, `${totalPages} pages loaded`);
      if (pc) pc.style.display = 'none';
      _updateModeUI();
      _updateGroupLabel();
      toast(`${totalPages} pages loaded`, 'success');
    } catch(e) {
      const msg = /encrypt|password/i.test(e.message)
        ? 'This PDF appears locked or encrypted. Unlock it first, then try again.'
        : 'Could not load this PDF. It may be damaged or unsupported.';
      toast(msg, 'error');
      console.error(e);
      const pc2 = document.getElementById('progressCard');
      if (pc2) pc2.style.display = 'none';
    }
  }

  async function _renderGrid(ab) {
    const container = document.getElementById('pageGrid');
    if (!container) return;
    container.innerHTML = '';

    const pdfDoc = await pdfjsLib.getDocument({ data: ab.slice(0) }).promise;
    const limit  = Math.min(totalPages, VISUAL_PREVIEW_LIMIT);

    for (let p = 1; p <= limit; p++) {
      _showProgress(30 + Math.round(((p - 1) / limit) * 65), `Page ${p} / ${limit}…`);

      // Split-point separator BEFORE page p (i.e. after page p-1)
      if (p > 1) {
        const afterIdx = p - 1; // the page number after which the split occurs
        const sep = document.createElement('div');
        sep.className = 'sp-sep' + (splitPoints.has(afterIdx) ? ' active' : '');
        sep.dataset.after = afterIdx;
        sep.innerHTML = `
          <div class="sp-line"></div>
          <button class="sp-btn" title="Toggle split after page ${afterIdx}">✂️ split here</button>
          <div class="sp-line"></div>`;
        sep.addEventListener('click', () => _toggleSplit(afterIdx, sep));
        container.appendChild(sep);
      }

      // Page thumbnail
      const page = await pdfDoc.getPage(p);
      const vp = page.getViewport({ scale: 0.4 });
      const c  = document.createElement('canvas');
      c.width  = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;

      const pgEl = document.createElement('div');
      pgEl.className = 'sg-page';
      pgEl.innerHTML = `<span class="sg-num">p${p}</span>`;
      const img = document.createElement('img');
      img.src = c.toDataURL('image/jpeg', 0.7);
      img.alt = `Page ${p}`;
      pgEl.insertBefore(img, pgEl.firstChild);
      container.appendChild(pgEl);
    }

    if (totalPages > limit) {
      const note = document.createElement('p');
      note.style.cssText = 'grid-column:1/-1;text-align:center;padding:8px;font-size:12px;color:var(--text-3)';
      note.textContent   = `Showing first ${limit} of ${totalPages} pages. Use "Custom Ranges" for large documents.`;
      container.appendChild(note);
    }
  }

  function _renderGridPlaceholder() {
    const container = document.getElementById('pageGrid');
    if (!container) return;
    container.innerHTML = '';
    for (let p = 1; p <= Math.min(totalPages, VISUAL_PREVIEW_LIMIT); p++) {
      if (p > 1) {
        const afterIdx = p - 1;
        const sep = document.createElement('div');
        sep.className = 'sp-sep' + (splitPoints.has(afterIdx) ? ' active' : '');
        sep.dataset.after = afterIdx;
        sep.innerHTML = `
          <div class="sp-line"></div>
          <button class="sp-btn">✂️ split here</button>
          <div class="sp-line"></div>`;
        sep.addEventListener('click', () => _toggleSplit(afterIdx, sep));
        container.appendChild(sep);
      }
      const pgEl = document.createElement('div');
      pgEl.className = 'sg-page sg-placeholder';
      pgEl.innerHTML = `<span class="sg-icon">📄</span><span class="sg-num">p${p}</span>`;
      container.appendChild(pgEl);
    }
  }

  function _toggleSplit(afterPage, el) {
    if (splitPoints.has(afterPage)) {
      splitPoints.delete(afterPage);
      el.classList.remove('active');
    } else {
      splitPoints.add(afterPage);
      el.classList.add('active');
    }
    _updateGroupLabel();
  }

  function _updateGroupLabel() {
    const el = document.getElementById('splitGroupCount');
    if (!el) return;
    const mode = document.querySelector('input[name="splitMode"]:checked')?.value || 'all';
    if (mode !== 'visual') { el.textContent = ''; return; }
    const count = splitPoints.size;
    el.textContent = count > 0
      ? `${count + 1} parts defined (${count} split point${count !== 1 ? 's' : ''})`
      : 'Click ✂️ between pages to define split points';
  }

  async function split() {
    if (!pdfFile) { toast('Please upload a PDF', 'error'); return; }
    if (isProcessing) return;
    isProcessing = true;
    const pc = document.getElementById('progressCard');
    if (pc) pc.style.display = 'block';
    _showProgress(5, 'Splitting…');

    const splitBtn = document.getElementById('splitBtn');
    if (splitBtn) splitBtn.disabled = true;

    try {
      const mode = document.querySelector('input[name="splitMode"]:checked')?.value || 'all';
      const { PDFDocument } = PDFLib;
      const ab     = await pdfFile.arrayBuffer();
      const srcDoc = await PDFDocument.load(ab);
      const zip    = new JSZip();
      let splits = [];

      if (mode === 'all') {
        splits = Array.from({ length: totalPages }, (_, i) => [i]);
      } else if (mode === 'every') {
        const raw = document.getElementById('everyN')?.value || '';
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > totalPages) {
          throw new Error(`Enter a whole number from 1 to ${totalPages} for pages per group.`);
        }
        for (let i = 0; i < totalPages; i += n)
          splits.push(Array.from({ length: Math.min(n, totalPages - i) }, (_, j) => i + j));
      } else if (mode === 'ranges') {
        const str = document.getElementById('rangesInput')?.value || '';
        const parsed = _parseRanges(str, totalPages);
        if (parsed.error) throw new Error(parsed.error);
        splits = parsed.parts;
      } else if (mode === 'visual') {
        const pts = [...splitPoints].sort((a, b) => a - b);
        let start = 0;
        for (const afterPage of pts) {
          splits.push(Array.from({ length: afterPage - start }, (_, i) => start + i));
          start = afterPage;
        }
        splits.push(Array.from({ length: totalPages - start }, (_, i) => start + i));
        splits = splits.filter(s => s.length > 0);
        if (!splits.length) splits = [Array.from({ length: totalPages }, (_, i) => i)];
      }

      parts = [];
      for (let i = 0; i < splits.length; i++) {
        _showProgress(5 + Math.round(((i + 1) / splits.length) * 90), `Part ${i + 1} of ${splits.length}…`);
        const newDoc = await PDFDocument.create();
        const pages  = await newDoc.copyPages(srcDoc, splits[i]);
        pages.forEach(p => newDoc.addPage(p));
        const bytes = await newDoc.save();
        const name = _partName(splits[i], i);
        parts.push({ bytes, name, pageCount: splits[i].length });
        zip.file(name, bytes);
      }

      if (parts.length > 1) {
        _showProgress(98, 'Compressing…');
        zipBlob = await zip.generateAsync({ type: 'blob' });
      } else {
        zipBlob = null; // single part — direct PDF download, no ZIP needed
      }
      _showProgress(100, 'Done!');

      const statParts = document.getElementById('statParts');
      const statPages = document.getElementById('statPages');
      if (statParts) statParts.textContent = splits.length + ' parts';
      if (statPages) statPages.textContent = totalPages + ' pages';
      _renderPartsList();
      _showResult();
      _setDownloadBtn(true);
      toast(`Split into ${splits.length} parts ✓`, 'success');
    } catch (e) {
      toast(e.message || 'Split failed. Please check the PDF and try again.', 'error');
      if (!/Enter a whole number|Enter page ranges|empty range|not a valid range|outside this PDF|runs backwards/.test(e.message || '')) {
        console.error(e);
      }
    } finally {
      isProcessing = false;
      if (splitBtn) splitBtn.disabled = !pdfFile;
      if (pc) pc.style.display = 'none';
    }
  }

  function _parseRanges(str, total) {
    const value = str.trim();
    if (!value) return { parts: [], error: 'Enter page ranges, for example 1-3, 5, 8-10.' };
    const segments = value.split(',').map(s => s.trim());
    if (segments.some(s => !s)) return { parts: [], error: 'Remove empty range entries between commas.' };

    const parsed = [];
    for (const segment of segments) {
      const match = segment.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) return { parts: [], error: `“${segment}” is not a valid range. Use formats like 3 or 3-7.` };
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : start;
      if (start < 1 || end < 1 || start > total || end > total) {
        return { parts: [], error: `“${segment}” is outside this PDF. Enter pages from 1 to ${total}.` };
      }
      if (start > end) return { parts: [], error: `“${segment}” runs backwards. Use ${end}-${start} instead.` };
      parsed.push(Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i));
    }
    return { parts: parsed, error: '' };
  }

  function _partName(pageIndexes, index) {
    const first = pageIndexes[0] + 1;
    const last = pageIndexes[pageIndexes.length - 1] + 1;
    const label = first === last ? `page_${String(first).padStart(3, '0')}` : `pages_${String(first).padStart(3, '0')}-${String(last).padStart(3, '0')}`;
    return `${String(index + 1).padStart(2, '0')}_${label}.pdf`;
  }

  function _resetResult() {
    zipBlob = null;
    parts = [];
    const result = document.getElementById('resultSection');
    if (result) result.classList.remove('show');
    const list = document.getElementById('partsList');
    if (list) list.innerHTML = '';
    _setDownloadBtn(false);
  }

  // Per-part download list inside the result card, so users can grab any
  // individual PDF without unzipping. Also relabels the main button when
  // there is only one part (direct PDF, no ZIP).
  function _renderPartsList() {
    const dlBtn = document.getElementById('downloadBtn');
    let list = document.getElementById('partsList');
    if (!list && dlBtn) {
      list = document.createElement('div');
      list.id = 'partsList';
      list.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:14px 0;justify-content:center';
      dlBtn.parentNode.insertBefore(list, dlBtn);
    }
    if (!list) return;
    list.innerHTML = '';
    if (dlBtn) dlBtn.innerHTML = parts.length === 1
      ? '<span>📄</span> Download PDF'
      : '<span>📦</span> Download ZIP (all parts)';
    if (parts.length <= 1) return; // single part — main button covers it
    parts.forEach((part, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `⬇ ${part.name} (${part.pageCount} pg)`;
      b.style.cssText = 'font-size:12px;padding:6px 12px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--primary);cursor:pointer;font-weight:600';
      b.onclick = () => downloadPart(i);
      list.appendChild(b);
    });
  }

  function downloadPart(i) {
    const part = parts[i];
    if (!part) return;
    const blob = new Blob([part.bytes], { type: 'application/pdf' });
    _downloadBlob(blob, part.name, 'Split PDF', 'split');
    toast(`${part.name} downloaded ✓`, 'success');
  }

  function download() {
    if (parts.length === 1) { downloadPart(0); return; }
    if (!zipBlob) return;
    _downloadBlob(zipBlob, `PDFdukan.com_split_${Date.now()}.zip`, 'Split PDF', 'split');
    toast('Split ZIP downloaded! ✓', 'success');
  }

  return { init, loadPDF, split, download, downloadPart };
})();

/* ================================================================
   5. COMPRESS IMAGE — Full resizer / compressor engine
================================================================ */
const CompressImage = (() => {
  let _result       = null;
  let _srcImg       = null;   // original HTMLImageElement
  let _origW        = 0;
  let _origH        = 0;
  let _origFileSize = 0;
  let _sourceName   = 'image';
  let _aspectLocked = true;
  let _outputFormat = 'image/jpeg';
  let _fitInsideCanvas = false;
  const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
  const MAX_SOURCE_PIXELS = 80 * 1000 * 1000;

  /* ── INIT ─────────────────────────────────────────────────── */
  function init() {
    _bindDropZone('dropZone', 'fileInput', loadImage);

    // Quality slider label sync
    const qualSlider = document.getElementById('quality');
    const qualVal    = document.getElementById('qualityVal');
    if (qualSlider && qualVal) {
      qualSlider.addEventListener('input', () => {
        qualVal.textContent = qualSlider.value + '%';
        _resetResult();
      });
    }

    // Scale % slider → update W/H inputs (keeps aspect ratio)
    const scaleSlider = document.getElementById('scaleSlider');
    const scaleVal    = document.getElementById('scaleVal');
    if (scaleSlider) {
      scaleSlider.addEventListener('input', () => {
        const pct = +scaleSlider.value;
        scaleVal.textContent = pct + '%';
        _fitInsideCanvas = false;
        _clearTemplate();
        _resetResult();
        if (_origW && _origH) {
          _setDimInputs(
            Math.round(_origW * pct / 100),
            Math.round(_origH * pct / 100),
            false  // don't re-trigger scale slider
          );
        }
      });
    }

    // Width / Height inputs — keep aspect ratio if locked
    const wIn = document.getElementById('outWidth');
    const hIn = document.getElementById('outHeight');
    if (wIn) {
      wIn.addEventListener('input', () => {
        _fitInsideCanvas = false;
        _clearTemplate();
        _resetResult();
        if (!_aspectLocked || !_origW) return;
        const w = +wIn.value;
        if (w > 0) hIn.value = Math.round(w * _origH / _origW);
      });
    }
    if (hIn) {
      hIn.addEventListener('input', () => {
        _fitInsideCanvas = false;
        _clearTemplate();
        _resetResult();
        if (!_aspectLocked || !_origH) return;
        const h = +hIn.value;
        if (h > 0) wIn.value = Math.round(h * _origW / _origH);
      });
    }

    // Aspect ratio lock toggle
    const lockBtn = document.getElementById('lockAspect');
    if (lockBtn) {
      lockBtn.addEventListener('click', () => {
        _aspectLocked = !_aspectLocked;
        lockBtn.textContent = _aspectLocked ? '🔒' : '🔓';
        lockBtn.classList.toggle('locked', _aspectLocked);
      });
    }
    const targetKb = document.getElementById('targetKb');
    if (targetKb) targetKb.addEventListener('input', _resetResult);
  }

  /* ── LOAD IMAGE ───────────────────────────────────────────── */
  function loadImage(files) {
    const file = files.find(f => SUPPORTED_IMAGE_TYPES.has(f.type.toLowerCase()));
    if (!file) { toast('Choose a JPG, PNG or WebP image.', 'error'); return; }
    if (file.size > MAX_SOURCE_BYTES) { toast('This image is over the 50 MB browser-processing limit.', 'error'); return; }

    _srcImg = null;
    _resetResult();
    _origFileSize = file.size;
    _sourceName = file.name.replace(/\.[^.]+$/, '') || 'image';
    const reader  = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        _srcImg = img;
        _origW  = img.naturalWidth;
        _origH  = img.naturalHeight;
        if (_origW * _origH > MAX_SOURCE_PIXELS) {
          _srcImg = null;
          toast('This image exceeds the 80-megapixel browser-processing limit.', 'error');
          return;
        }

        // Draw original preview
        const origCanvas = document.getElementById('origPreview');
        if (origCanvas) {
          const s = Math.min(300 / _origW, 250 / _origH, 1);
          origCanvas.width  = Math.round(_origW * s);
          origCanvas.height = Math.round(_origH * s);
          origCanvas.getContext('2d').drawImage(img, 0, 0, origCanvas.width, origCanvas.height);
        }

        _el('statOrigSize',   _fmtBytes(_origFileSize));
        _el('cpOrigSizeTag',  _fmtBytes(_origFileSize));
        _el('statOrigDims', `${_origW} × ${_origH}`);

        // Pre-fill dimension inputs
        _setDimInputs(_origW, _origH, true);
        _fitInsideCanvas = false;
        _clearTemplate();
        _resetResult();
        _el('targetKbStatus', 'Enter a KB limit to auto-reduce quality');

        // Show settings card
        const sc = document.getElementById('settingsCard');
        if (sc) sc.style.display = '';

        const cb = document.getElementById('compressBtn');
        if (cb) cb.disabled = false;
      };
      img.onerror = () => toast('Failed to load image', 'error');
      img.src = e.target.result;
    };
    reader.onerror = () => toast('Failed to read image file', 'error');
    reader.readAsDataURL(file);
  }

  /* ── APPLY TEMPLATE ───────────────────────────────────────── */
  function applyTemplate(btn) {
    const w = +btn.dataset.w;
    const h = +btn.dataset.h;
    document.querySelectorAll('.tpl-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Templates create an exact canvas while preserving the image aspect ratio.
    _fitInsideCanvas = true;
    _setDimInputs(w, h, false);
    // Reset scale slider to custom
    const scaleSlider = document.getElementById('scaleSlider');
    const scaleVal    = document.getElementById('scaleVal');
    if (scaleSlider) { scaleSlider.value = 100; }
    if (scaleVal)    { scaleVal.textContent = 'Preset canvas'; }
    _resetResult();
  }

  /* ── SET FORMAT ───────────────────────────────────────────── */
  function setFormat(btn) {
    _outputFormat = btn.dataset.fmt;
    document.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // PNG is lossless — quality slider irrelevant, dim it
    const qualSlider = document.getElementById('quality');
    const qualGroup  = qualSlider ? qualSlider.closest('.slider-group') : null;
    if (qualGroup) qualGroup.style.opacity = _outputFormat === 'image/png' ? '0.4' : '1';
    if (qualSlider) qualSlider.disabled = _outputFormat === 'image/png';
    const targetKb = document.getElementById('targetKb');
    if (targetKb) targetKb.disabled = _outputFormat === 'image/png';
    _el('targetKbStatus', _outputFormat === 'image/png'
      ? 'PNG uses lossless encoding; quality and target-KB controls do not apply'
      : 'Enter a KB limit to auto-reduce quality');
    _resetResult();
  }

  /* ── MAIN COMPRESS ────────────────────────────────────────── */
  async function compress() {
    if (!_srcImg) { toast('No image loaded', 'error'); return; }

    const btn = document.getElementById('compressBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Processing…'; }

    try {
      // Resolve output dimensions
      const wIn = +(document.getElementById('outWidth')?.value  || 0);
      const hIn = +(document.getElementById('outHeight')?.value || 0);
      let outW = wIn  > 0 ? wIn  : _origW;
      let outH = hIn  > 0 ? hIn  : _origH;

      // Guard browser canvas limits instead of silently changing requested dimensions.
      outW = Math.round(outW);
      outH = Math.round(outH);
      const maxDimension = 16000;
      const maxArea = 64000000;
      if (outW < 1 || outH < 1 || outW > maxDimension || outH > maxDimension || outW * outH > maxArea) {
        throw new Error('Output is too large for safe browser processing. Use dimensions up to 16,000 px and 64 megapixels.');
      }

      const targetKbEl = document.getElementById('targetKb');
      const targetKb   = targetKbEl ? +targetKbEl.value : 0;
      const quality    = +(document.getElementById('quality')?.value || 85) / 100;
      const format     = _outputFormat;

      // Draw source onto output-sized canvas
      const srcCanvas  = document.createElement('canvas');
      srcCanvas.width  = outW;
      srcCanvas.height = outH;
      const srcCtx = srcCanvas.getContext('2d');
      if (format === 'image/jpeg') {
        srcCtx.fillStyle = '#ffffff';
        srcCtx.fillRect(0, 0, outW, outH);
      }
      if (_fitInsideCanvas) {
        const scale = Math.min(outW / _origW, outH / _origH);
        const drawW = Math.max(1, Math.round(_origW * scale));
        const drawH = Math.max(1, Math.round(_origH * scale));
        const drawX = Math.round((outW - drawW) / 2);
        const drawY = Math.round((outH - drawH) / 2);
        srcCtx.drawImage(_srcImg, drawX, drawY, drawW, drawH);
      } else {
        srcCtx.drawImage(_srcImg, 0, 0, outW, outH);
      }

      let blob;
      let finalQuality = quality;

      if (targetKb > 0 && format !== 'image/png') {
        // Target-size mode: binary search quality until under targetKb
        const targetResult = await _compressToTargetKb(srcCanvas, format, targetKb);
        blob = targetResult.blob;
        finalQuality = targetResult.quality;
        _el('targetKbStatus', targetResult.metTarget
          ? `✓ ${(blob.size / 1024).toFixed(1)} KB at ${Math.round(finalQuality * 100)}% quality`
          : `Could not reach ${targetKb} KB at these dimensions; smallest tested output is ${(blob.size / 1024).toFixed(1)} KB`);
      } else {
        blob = await _canvasToBlob(srcCanvas, format, quality);
        if (format !== 'image/png') _el('targetKbStatus', 'No target size selected');
      }

      _result = { blob, format, w: outW, h: outH, quality: finalQuality };

      // Draw compressed preview
      const compCanvas = document.getElementById('compPreview');
      if (compCanvas) {
        const s   = Math.min(300 / outW, 250 / outH, 1);
        compCanvas.width  = Math.round(outW * s);
        compCanvas.height = Math.round(outH * s);
        const url = URL.createObjectURL(blob);
        const pImg = new Image();
        pImg.onload = () => {
          compCanvas.getContext('2d').drawImage(pImg, 0, 0, compCanvas.width, compCanvas.height);
          URL.revokeObjectURL(url);
        };
        pImg.src = url;
      }

      // Stats
      const sizeDelta = (blob.size - _origFileSize) / _origFileSize * 100;
      _el('statCompSize',      _fmtBytes(blob.size));
      _el('cpCompSizeTag',     _fmtBytes(blob.size));
      _el('statCompDims',      `${outW} × ${outH}`);
      _el('statFinalQuality',  format === 'image/png' ? 'Lossless PNG' : Math.round(finalQuality * 100) + '%');
      const savEl = document.getElementById('statSaving');
      if (savEl) {
        const rounded = Math.round(Math.abs(sizeDelta));
        savEl.textContent = sizeDelta < -0.5 ? `${rounded}% smaller` : sizeDelta > 0.5 ? `${rounded}% larger` : 'About the same size';
        savEl.className = 'rs-value' + (sizeDelta < -0.5 ? ' positive' : sizeDelta > 0.5 ? ' negative' : '');
      }

      // Show result card
      const rs = document.getElementById('resultSection');
      if (rs) {
        rs.style.display = 'block';
        rs.classList.add('show', 'visible');
      }
      rs?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (err) {
      console.error('Compress error:', err);
      toast('Compression failed: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🗜️ Compress & Process'; }
    }
  }

  /* ── TARGET-KB BINARY SEARCH ──────────────────────────────── */
  async function _compressToTargetKb(canvas, format, targetKb) {
    const targetBytes = targetKb * 1024;
    let lo = 0.01, hi = 1.0, bestBlob = null;

    // Up to 14 iterations of binary search
    for (let i = 0; i < 14; i++) {
      const mid  = (lo + hi) / 2;
      const blob = await _canvasToBlob(canvas, format, mid);

      if (blob.size <= targetBytes) {
        bestBlob = blob;
        lo = mid; // try higher quality while still under target
      } else {
        hi = mid;
      }

      if (hi - lo < 0.005) break;
    }

    if (!bestBlob) {
      // Even quality=0.01 is too large — return it anyway
      const blob = await _canvasToBlob(canvas, format, 0.01);
      toast('Image too large to meet target KB at current dimensions', 'warning');
      return { blob, quality: 0.01, metTarget: false };
    }
    return { blob: bestBlob, quality: lo, metTarget: true };
  }

  /* ── HELPERS ──────────────────────────────────────────────── */
  function _canvasToBlob(canvas, format, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('toBlob returned null'));
      }, format, quality);
    });
  }

  function _setDimInputs(w, h, updateScale) {
    const wIn = document.getElementById('outWidth');
    const hIn = document.getElementById('outHeight');
    if (wIn) wIn.value = w;
    if (hIn) hIn.value = h;
    if (updateScale && _origW) {
      const pct = Math.round(w / _origW * 100);
      const scaleSlider = document.getElementById('scaleSlider');
      const scaleVal    = document.getElementById('scaleVal');
      if (scaleSlider) scaleSlider.value = Math.min(100, pct);
      if (scaleVal)    scaleVal.textContent = Math.min(100, pct) + '%';
    }
  }

  function _clearTemplate() {
    document.querySelectorAll('.tpl-btn.active').forEach(button => button.classList.remove('active'));
  }

  function _resetResult() {
    _result = null;
    const result = document.getElementById('resultSection');
    if (result) {
      result.style.display = 'none';
      result.classList.remove('show', 'visible');
    }
  }

  function _el(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function download() {
    if (!_result) return;
    const ext = _result.format.split('/')[1].replace('jpeg', 'jpg');
    const safeBase = _sourceName.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'image';
    _downloadBlob(_result.blob, `${safeBase}-compressed.${ext}`, 'Image Compressor', 'compress');
    toast('Image downloaded! ✓', 'success');
  }

  return { init, loadImage, compress, download, applyTemplate, setFormat };
})();

/* ================================================================
   6. OCR TEXT EXTRACTION
================================================================ */
const OCRTool = (() => {
  const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const MAX_FILE_BYTES = 30 * 1024 * 1024;
  const MAX_IMAGE_PIXELS = 40 * 1000 * 1000;
  let selectedFile = null;
  let selectedObjectUrl = '';
  let sourceWidth = 0;
  let sourceHeight = 0;
  let activeWorker = null;
  let isBusy = false;
  let wasCancelled = false;

  function init() {
    _bindDropZone('dropZone', 'fileInput', loadImage);

    const copyBtn = document.getElementById('copyBtn');
    const downBtn = document.getElementById('downloadTxtBtn');
    const runBtn = document.getElementById('ocrRunBtn');
    const clearBtn = document.getElementById('ocrClearBtn');
    const cancelBtn = document.getElementById('ocrCancelBtn');
    const langSelect = document.getElementById('ocrLang');
    const dropZone = document.getElementById('dropZone');
    if (copyBtn) copyBtn.onclick = copyText;
    if (downBtn) downBtn.onclick = downloadTxt;
    if (runBtn) runBtn.onclick = recognizeSelected;
    if (clearBtn) clearBtn.onclick = clear;
    if (cancelBtn) cancelBtn.onclick = cancel;
    if (langSelect) langSelect.addEventListener('change', updateTextDirection);
    if (dropZone) {
      dropZone.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          document.getElementById('fileInput')?.click();
        }
      });
    }
    updateTextDirection();
  }

  async function loadImage(files) {
    const file = files[0];
    if (!file || !SUPPORTED_TYPES.has(file.type)) {
      toast('Choose a JPG, PNG or WEBP image.', 'error');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast('This image is over 30 MB. Use a smaller source image so browser OCR can run safely.', 'error');
      return;
    }

    if (selectedObjectUrl) URL.revokeObjectURL(selectedObjectUrl);
    selectedObjectUrl = URL.createObjectURL(file);
    const preview = document.getElementById('imgPreview');
    try {
      const dimensions = await getImageDimensions(file);
      sourceWidth = dimensions.width;
      sourceHeight = dimensions.height;
      const pixels = sourceWidth * sourceHeight;
      if (!sourceWidth || !sourceHeight || pixels > MAX_IMAGE_PIXELS) {
        selectedFile = null;
        setButtonState(false);
        setFileInfo(`${escapeHtml(file.name)} · ${_fmtBytes(file.size)} · ${sourceWidth || '?'} × ${sourceHeight || '?'} px — too large for the 40-megapixel browser safeguard`, true);
        toast('This image exceeds the 40-megapixel browser safeguard. Crop it into smaller sections without lowering text quality.', 'error');
        return;
      }
      selectedFile = file;
      setButtonState(true);
      setFileInfo(`${escapeHtml(file.name)} · ${_fmtBytes(file.size)} · ${sourceWidth} × ${sourceHeight} px`);
      if (preview) {
        preview.src = selectedObjectUrl;
        preview.style.display = 'block';
      }
      resetResult();
    } catch (_) {
      selectedFile = null;
      setButtonState(false);
      setFileInfo('The browser could not decode this image.', true);
      toast('The selected image could not be opened.', 'error');
    }
  }

  async function recognizeSelected() {
    if (!selectedFile || isBusy) return;

    const langValue = document.getElementById('ocrLang')?.value || 'eng';
    const langs = langValue.split('+');
    const layout = document.getElementById('ocrLayout')?.value || '3';
    const enhance = document.getElementById('ocrEnhance')?.value || 'original';
    const pc = document.getElementById('progressCard');
    const runBtn = document.getElementById('ocrRunBtn');
    const clearBtn = document.getElementById('ocrClearBtn');
    isBusy = true;
    wasCancelled = false;
    if (pc) pc.style.display = 'block';
    if (runBtn) runBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    setResultActions(false);
    resetResult();

    _showProgress(3, enhance === 'original' ? 'Preparing original image…' : 'Preparing enhanced image…');
    try {
      const input = await prepareInput(selectedFile, enhance);
      if (wasCancelled) return;

      if (typeof Tesseract === 'undefined') {
        _showProgress(6, 'Downloading OCR engine…');
        await window.loadScriptOnce('https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js');
      }
      const logger = m => {
        if (!m || !m.status) return;
        const s = m.status;
        const p = m.progress || 0;
        if (s === 'loading tesseract core') {
          _showProgress(8, 'Loading OCR core…');
        } else if (s === 'initializing tesseract') {
          _showProgress(18, 'Initializing OCR engine…');
        } else if (s === 'loading language traineddata') {
          _showProgress(20 + Math.round(p * 30), `Loading language data… ${Math.round(p * 100)}%`);
        } else if (s === 'initializing api') {
          _showProgress(55, 'Preparing recognition…');
        } else if (s === 'recognizing text') {
          _showProgress(60 + Math.round(p * 35), `Recognizing text… ${Math.round(p * 100)}%`);
        }
      };

      activeWorker = await Tesseract.createWorker(langs.length > 1 ? langs : langs[0], 1, { logger });
      await activeWorker.setParameters({
        tessedit_pageseg_mode: layout,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300'
      });
      const { data } = await activeWorker.recognize(input, { rotateAuto: true });
      if (wasCancelled) return;

      _showProgress(100, 'Complete!');
      const output = document.getElementById('ocrOutput');
      const cleanText = (data.text || '').trim();
      if (output) {
        output.value = cleanText;
        output.readOnly = false;
        output.placeholder = cleanText ? '' : 'No text was detected. Try Original pixels, another layout, the correct language, or a clearer image.';
      }

      const confEl = document.getElementById('statConf');
      const wordEl = document.getElementById('statWords');
      const charEl = document.getElementById('statChars');
      if (confEl) confEl.textContent = Number.isFinite(data.confidence) ? Math.round(data.confidence) + '%' : '—';
      if (wordEl) wordEl.textContent = cleanText ? cleanText.split(/\s+/u).length : 0;
      if (charEl) charEl.textContent = cleanText.length;
      _showResult();
      setResultActions(Boolean(cleanText));
      toast(cleanText ? 'Text extracted — review it against the image.' : 'No text detected. Try another language, layout or image treatment.', cleanText ? 'success' : 'info');
    } catch (e) {
      if (wasCancelled) return;
      const why = (e && e.message) ? ' (' + e.message + ')' : '';
      toast('OCR failed — try a clearer image or different browser.' + why, 'error');
      console.error('OCR error:', e);
    } finally {
      if (activeWorker) {
        try { await activeWorker.terminate(); } catch (_) {}
        activeWorker = null;
      }
      isBusy = false;
      if (runBtn) runBtn.disabled = !selectedFile;
      if (clearBtn) clearBtn.disabled = !selectedFile;
      if (wasCancelled && pc) pc.style.display = 'none';
    }
  }

  async function copyText() {
    const output = document.getElementById('ocrOutput');
    const text = output?.value.trim() || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      output.focus();
      output.select();
      document.execCommand('copy');
      output.setSelectionRange(0, 0);
    }
    toast('Text copied to clipboard! ✓', 'success');
  }

  function downloadTxt() {
    const text = document.getElementById('ocrOutput')?.value.trim() || '';
    if (!text) return;
    const blob = new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' });
    _downloadBlob(blob, `PDFdukan.com_ocr_${Date.now()}.txt`, 'OCR Text', 'extract');
    toast('Text file downloaded! ✓', 'success');
  }

  async function cancel() {
    if (!isBusy) return;
    wasCancelled = true;
    _showProgress(0, 'Cancelling OCR…');
    if (activeWorker) {
      try { await activeWorker.terminate(); } catch (_) {}
      activeWorker = null;
    }
    toast('OCR cancelled.', 'info');
  }

  function clear() {
    if (isBusy) return;
    selectedFile = null;
    sourceWidth = 0;
    sourceHeight = 0;
    if (selectedObjectUrl) URL.revokeObjectURL(selectedObjectUrl);
    selectedObjectUrl = '';
    const input = document.getElementById('fileInput');
    const preview = document.getElementById('imgPreview');
    const info = document.getElementById('ocrFileInfo');
    const result = document.getElementById('resultSection');
    const progress = document.getElementById('progressCard');
    if (input) input.value = '';
    if (preview) { preview.removeAttribute('src'); preview.style.display = 'none'; }
    if (info) { info.textContent = ''; info.classList.remove('show'); }
    if (result) result.classList.remove('show');
    if (progress) progress.style.display = 'none';
    setButtonState(false);
    resetResult();
  }

  function setButtonState(hasFile) {
    const runBtn = document.getElementById('ocrRunBtn');
    const clearBtn = document.getElementById('ocrClearBtn');
    if (runBtn) runBtn.disabled = !hasFile;
    if (clearBtn) clearBtn.disabled = !hasFile;
  }

  function setResultActions(enabled) {
    const copyBtn = document.getElementById('copyBtn');
    const downBtn = document.getElementById('downloadTxtBtn');
    if (copyBtn) copyBtn.disabled = !enabled;
    if (downBtn) downBtn.disabled = !enabled;
  }

  function resetResult() {
    const output = document.getElementById('ocrOutput');
    if (output) {
      output.value = '';
      output.readOnly = true;
      output.placeholder = 'Recognised text will appear here. You can edit it before copying or downloading.';
    }
    ['statConf', 'statWords', 'statChars'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    setResultActions(false);
  }

  function setFileInfo(html, isError = false) {
    const info = document.getElementById('ocrFileInfo');
    if (!info) return;
    info.innerHTML = `${isError ? '⚠️' : '✓'} ${html}`;
    info.classList.add('show');
  }

  function escapeHtml(value) {
    const span = document.createElement('span');
    span.textContent = value;
    return span.innerHTML;
  }

  function updateTextDirection() {
    const output = document.getElementById('ocrOutput');
    const lang = document.getElementById('ocrLang')?.value || 'eng';
    if (!output) return;
    output.dir = (lang === 'urd' || lang === 'ara') ? 'rtl' : 'auto';
  }

  async function getImageDimensions(file) {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    }
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
        URL.revokeObjectURL(url);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Image decode failed'));
      };
      image.src = url;
    });
  }

  async function prepareInput(file, mode) {
    if (mode === 'original') return file;
    if (typeof createImageBitmap !== 'function') return file;
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = imageData.data;
      for (let i = 0; i < px.length; i += 4) {
        const gray = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
        const value = mode === 'document'
          ? Math.max(0, Math.min(255, Math.round((gray - 128) * 1.45 + 142)))
          : gray;
        px[i] = value;
        px[i + 1] = value;
        px[i + 2] = value;
      }
      ctx.putImageData(imageData, 0, 0);
      return canvas;
    } finally {
      bitmap.close();
    }
  }

  return { init, loadImage, copyText, downloadTxt, recognizeSelected, cancel, clear };
})();

/* ================================================================
   7. AGE CALCULATOR
================================================================ */
const AgeCalc = (() => {
  let _timer = null;

  function init() {
    const input = document.getElementById('birthdate');
    if (input) {
      input.addEventListener('change', () => calculate(input.value));
      input.max = new Date().toISOString().split('T')[0];
    }
  }

  function calculate(birthdateStr) {
    if (_timer) clearInterval(_timer);
    if (!birthdateStr) return;

    const display = () => {
      const now = new Date();
      const birth = new Date(birthdateStr);
      if (isNaN(birth.getTime()) || birth > now) {
        toast('Please enter a valid past date', 'error');
        return;
      }

      // Years, months, days
      let years  = now.getFullYear() - birth.getFullYear();
      let months = now.getMonth() - birth.getMonth();
      let days   = now.getDate() - birth.getDate();

      if (days < 0) {
        months--;
        const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        days += prevMonth.getDate();
      }
      if (months < 0) { years--; months += 12; }

      // Total units
      const totalMs      = now - birth;
      const totalSeconds = Math.floor(totalMs / 1000);
      const totalMinutes = Math.floor(totalMs / 60000);
      const totalHours   = Math.floor(totalMs / 3600000);
      const totalDays    = Math.floor(totalMs / 86400000);
      const totalWeeks   = Math.floor(totalDays / 7);
      const totalMonths  = years * 12 + months;

      _set('valYears',   years);
      _set('valMonths',  months);
      _set('valDays',    days);
      _set('valHours',   totalHours.toLocaleString());
      _set('valMinutes', totalMinutes.toLocaleString());
      _set('valSeconds', totalSeconds.toLocaleString());
      _set('valWeeks',   totalWeeks.toLocaleString());
      _set('valTotalDays', totalDays.toLocaleString());
      _set('valTotalMonths', totalMonths);

      // Next birthday
      let nextBirth = new Date(now.getFullYear(), birth.getMonth(), birth.getDate());
      if (nextBirth <= now) nextBirth.setFullYear(now.getFullYear() + 1);
      const daysUntil = Math.ceil((nextBirth - now) / 86400000);
      const nbEl = document.getElementById('nextBirthday');
      if (nbEl) {
        nbEl.textContent = daysUntil === 0
          ? '🎂 Happy Birthday!'
          : `🎂 Next birthday in ${daysUntil} day${daysUntil !== 1 ? 's' : ''} (${nextBirth.toDateString()})`;
      }

      const result = document.getElementById('ageResult');
      if (result) result.style.display = 'grid';
    };

    display();
    _timer = setInterval(display, 1000);
  }

  function _set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  return { init, calculate };
})();

/* ================================================================
   8. BMI CALCULATOR
================================================================ */
const BMICalc = (() => {
  let _system = 'metric'; // 'metric' | 'imperial'

  function init() {
    // Allow Enter key on any input to trigger calculate
    document.querySelectorAll('[id^="weight"],[id^="height"]').forEach(el => {
      el.addEventListener('keydown', e => { if (e.key === 'Enter') calculate(); });
    });
  }

  /* ── switchSystem ──────────────────────────────────────── */
  function switchSystem(btn) {
    _system = btn.dataset.system;
    document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('metricInputs').style.display   = _system === 'metric'   ? '' : 'none';
    document.getElementById('imperialInputs').style.display  = _system === 'imperial' ? '' : 'none';
    // Hide result until recalculated
    const res = document.getElementById('bmiResult');
    if (res) res.style.display = 'none';
  }

  /* ── calculate ─────────────────────────────────────────── */
  function calculate() {
    let weightKg, heightM;

    if (_system === 'metric') {
      weightKg = +document.getElementById('weightKg')?.value;
      const heightCm = +document.getElementById('heightCm')?.value;
      if (!weightKg || !heightCm) { toast('Please fill in weight and height', 'error'); return; }
      if (weightKg < 1 || weightKg > 500)  { toast('Enter a valid weight (1–500 kg)', 'error'); return; }
      if (heightCm < 50 || heightCm > 300) { toast('Enter a valid height (50–300 cm)', 'error'); return; }
      heightM = heightCm / 100;
    } else {
      weightKg = +document.getElementById('weightLbs')?.value * 0.453592;
      const ft = +document.getElementById('heightFt')?.value || 0;
      const inches = +document.getElementById('heightIn')?.value || 0;
      const totalInches = ft * 12 + inches;
      if (!document.getElementById('weightLbs')?.value || !ft) { toast('Please fill in weight and height', 'error'); return; }
      if (totalInches < 20 || totalInches > 120) { toast('Enter a valid height', 'error'); return; }
      heightM = totalInches * 0.0254;
    }

    const bmi = weightKg / (heightM * heightM);
    if (!isFinite(bmi) || bmi <= 0) { toast('Invalid values — please check your inputs', 'error'); return; }

    _renderResult(bmi, weightKg, heightM);
  }

  /* ── _renderResult ──────────────────────────────────────── */
  function _renderResult(bmi, weightKg, heightM) {
    const bmiRounded = Math.round(bmi * 10) / 10;
    const cat = _bmiCategory(bmi);

    // Show result card
    const res = document.getElementById('bmiResult');
    if (res) res.style.display = '';

    const valEl = document.getElementById('bmiValue');
    const catEl = document.getElementById('bmiCategory');
    if (valEl) valEl.textContent = bmiRounded.toFixed(1);
    if (catEl) { catEl.textContent = cat.label; catEl.style.color = cat.color; }

    // Move needle: map BMI 10–40+ → 0–100%
    const needle = document.getElementById('bmiNeedle');
    if (needle) needle.style.left = _needlePos(bmi) + '%';

    // Highlight range block
    ['rangeUnder','rangeNormal','rangeOver','rangeObese'].forEach(id => {
      document.getElementById(id)?.classList.remove('active-range');
    });
    if (cat.rangeId) document.getElementById(cat.rangeId)?.classList.add('active-range');

    // Ideal weight range for this height (BMI 18.5 – 24.9)
    const idealLow  = Math.round(18.5 * heightM * heightM * 10) / 10;
    const idealHigh = Math.round(24.9 * heightM * heightM * 10) / 10;

    const idealEl = document.getElementById('idealWeight');
    if (idealEl) {
      if (_system === 'metric') {
        idealEl.textContent = `${idealLow} – ${idealHigh} kg`;
      } else {
        idealEl.textContent = `${Math.round(idealLow * 2.205)} – ${Math.round(idealHigh * 2.205)} lbs`;
      }
    }

    // Weight delta to reach normal range
    const deltaEl = document.getElementById('weightDelta');
    if (deltaEl) {
      let delta = 0, verb = '';
      if (weightKg < idealLow)  { delta = idealLow  - weightKg; verb = 'gain'; }
      if (weightKg > idealHigh) { delta = weightKg  - idealHigh; verb = 'lose'; }

      if (delta < 0.5) {
        deltaEl.textContent = '✓ Healthy weight';
      } else if (_system === 'metric') {
        deltaEl.textContent = `${verb} ${Math.round(delta * 10) / 10} kg`;
      } else {
        deltaEl.textContent = `${verb} ${Math.round(delta * 2.205 * 10) / 10} lbs`;
      }
    }
  }

  /* ── _bmiCategory ───────────────────────────────────────── */
  function _bmiCategory(bmi) {
    if (bmi < 16)   return { label: 'Severely Underweight', color: '#1565c0', rangeId: 'rangeUnder' };
    if (bmi < 18.5) return { label: 'Underweight',          color: '#3b82f6', rangeId: 'rangeUnder' };
    if (bmi < 25)   return { label: 'Normal Weight',        color: '#10b981', rangeId: 'rangeNormal' };
    if (bmi < 30)   return { label: 'Overweight',           color: '#f59e0b', rangeId: 'rangeOver' };
    if (bmi < 35)   return { label: 'Obese Class I',        color: '#ef4444', rangeId: 'rangeObese' };
    if (bmi < 40)   return { label: 'Obese Class II',       color: '#dc2626', rangeId: 'rangeObese' };
    return           { label: 'Obese Class III',            color: '#991b1b', rangeId: 'rangeObese' };
  }

  /* ── _needlePos ─────────────────────────────────────────── */
  function _needlePos(bmi) {
    // Map BMI range [10, 40] → [2%, 98%]
    const clamped = Math.max(10, Math.min(bmi, 40));
    return 2 + ((clamped - 10) / 30) * 96;
  }

  return { init, switchSystem, calculate };
})();

/* ================================================================
   9. DISCOUNT & PERCENTAGE CALCULATOR
================================================================ */
const DiscountCalc = (() => {
  let _mode = 'discount'; // 'discount' | 'percentage' | 'tax'
  let _history = [];      // max 5 entries

  function init() {
    // Keyboard enter support
    document.querySelectorAll('[id^="d_"],[id^="p_"],[id^="t_"]').forEach(el => {
      el.addEventListener('keydown', e => { if (e.key === 'Enter') calculate(); });
    });
  }

  /* ── switchMode ─────────────────────────────────────────── */
  function switchMode(btn) {
    _mode = btn.dataset.mode;
    document.querySelectorAll('.mode-tab').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');

    document.getElementById('panelDiscount').style.display   = _mode === 'discount'   ? '' : 'none';
    document.getElementById('panelPercentage').style.display = _mode === 'percentage' ? '' : 'none';
    document.getElementById('panelTax').style.display        = _mode === 'tax'        ? '' : 'none';

    // Clear results
    const res = document.getElementById('dcResults');
    if (res) { res.innerHTML = ''; res.classList.remove('show'); }
  }

  /* ── calculate ─────────────────────────────────────────── */
  function calculate() {
    if (_mode === 'discount')   _calcDiscount();
    else if (_mode === 'percentage') _calcPercentage();
    else if (_mode === 'tax')   _calcTax();
  }

  /* ── Mode 1: original + discount% → final + savings ──── */
  function _calcDiscount() {
    const orig = +document.getElementById('d_origPrice')?.value;
    const pct  = +document.getElementById('d_discPct')?.value;

    if (!orig || orig <= 0) { toast('Enter a valid original price', 'error'); return; }
    if (isNaN(pct) || pct < 0 || pct > 100) { toast('Enter a discount between 0 and 100%', 'error'); return; }

    const savings = orig * pct / 100;
    const final   = orig - savings;
    const html = `
      <div class="dc-result-card primary-card">
        <div class="dcr-label">Final Price</div>
        <div class="dcr-value big highlight">${_fmt(final)}</div>
        <div class="dcr-sub">after ${pct}% off</div>
      </div>
      <div class="dc-result-card">
        <div class="dcr-label">You Save</div>
        <div class="dcr-value" style="color:#10b981">${_fmt(savings)}</div>
        <div class="dcr-sub">${pct}% discount</div>
      </div>
      <div class="dc-result-card">
        <div class="dcr-label">Original Price</div>
        <div class="dcr-value">${_fmt(orig)}</div>
        <div class="dcr-sub">before discount</div>
      </div>
      <div class="savings-banner" style="grid-column:1/-1">
        <div class="sb-icon">🎉</div>
        <div class="sb-text">
          <div class="sb-title">Great savings! You save ${_fmt(savings)} (${pct}% off)</div>
          <div class="sb-sub">Pay ${_fmt(final)} instead of ${_fmt(orig)}</div>
        </div>
      </div>`;
    _showResults(html);
    _addHistory(`${_fmt(orig)} − ${pct}%`, _fmt(final));
  }

  /* ── Mode 2: original + final → discount% ─────────────── */
  function _calcPercentage() {
    const orig  = +document.getElementById('p_origPrice')?.value;
    const final = +document.getElementById('p_finalPrice')?.value;

    if (!orig || orig <= 0)  { toast('Enter a valid original price', 'error'); return; }
    if (!final || final < 0) { toast('Enter a valid final price', 'error'); return; }
    if (final > orig)        { toast('Final price cannot be greater than the original', 'error'); return; }

    const savings = orig - final;
    const pct     = (savings / orig) * 100;
    const html = `
      <div class="dc-result-card primary-card">
        <div class="dcr-label">Discount Applied</div>
        <div class="dcr-value big highlight">${pct.toFixed(2)}%</div>
        <div class="dcr-sub">percentage off</div>
      </div>
      <div class="dc-result-card">
        <div class="dcr-label">Amount Saved</div>
        <div class="dcr-value" style="color:#10b981">${_fmt(savings)}</div>
        <div class="dcr-sub">in absolute terms</div>
      </div>
      <div class="dc-result-card">
        <div class="dcr-label">Price Paid</div>
        <div class="dcr-value">${_fmt(final)}</div>
        <div class="dcr-sub">of ${_fmt(orig)} original</div>
      </div>`;
    _showResults(html);
    _addHistory(`${_fmt(orig)} → ${_fmt(final)}`, pct.toFixed(2) + '%');
  }

  /* ── Mode 3: price + tax rate → tax + total ──────────── */
  function _calcTax() {
    const price   = +document.getElementById('t_price')?.value;
    const taxRate = +document.getElementById('t_taxRate')?.value;

    if (!price || price <= 0)        { toast('Enter a valid price', 'error'); return; }
    if (isNaN(taxRate) || taxRate < 0) { toast('Enter a valid tax rate', 'error'); return; }

    const taxAmt = price * taxRate / 100;
    const total  = price + taxAmt;
    const html = `
      <div class="dc-result-card primary-card">
        <div class="dcr-label">Total (incl. tax)</div>
        <div class="dcr-value big highlight">${_fmt(total)}</div>
        <div class="dcr-sub">including ${taxRate}% tax</div>
      </div>
      <div class="dc-result-card">
        <div class="dcr-label">Tax Amount</div>
        <div class="dcr-value" style="color:#f59e0b">${_fmt(taxAmt)}</div>
        <div class="dcr-sub">${taxRate}% of ${_fmt(price)}</div>
      </div>
      <div class="dc-result-card">
        <div class="dcr-label">Pre-Tax Price</div>
        <div class="dcr-value">${_fmt(price)}</div>
        <div class="dcr-sub">before tax</div>
      </div>
      <div class="savings-banner" style="grid-column:1/-1;background:linear-gradient(135deg,rgba(245,158,11,.15),rgba(245,158,11,.05));border-color:rgba(245,158,11,.25)">
        <div class="sb-icon">🧾</div>
        <div class="sb-text">
          <div class="sb-title">Tax breakdown: ${_fmt(price)} + ${_fmt(taxAmt)} tax = ${_fmt(total)}</div>
          <div class="sb-sub">${taxRate}% applied on pre-tax amount</div>
        </div>
      </div>`;
    _showResults(html);
    _addHistory(`${_fmt(price)} + ${taxRate}% tax`, _fmt(total));
  }

  /* ── helpers ─────────────────────────────────────────────── */
  function _fmt(n) {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function _showResults(html) {
    const res = document.getElementById('dcResults');
    if (!res) return;
    res.innerHTML = html;
    res.classList.add('show');
    res.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function _addHistory(desc, result) {
    _history.unshift({ desc, result });
    if (_history.length > 5) _history.pop();
    _renderHistory();
  }

  function _renderHistory() {
    const card = document.getElementById('historyCard');
    const list = document.getElementById('historyList');
    if (!card || !list) return;
    card.style.display = '';
    list.innerHTML = _history.map(h => `
      <div class="history-item">
        <span class="hi-desc">${h.desc}</span>
        <span class="hi-result">= ${h.result}</span>
      </div>`).join('');
  }

  return { init, switchMode, calculate };
})();

/* ── AUTO-INIT ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.tool;
  if (page === 'img-to-pdf')    ImageToPDF.init();
  if (page === 'pdf-to-img')    PDFToImages.init();
  if (page === 'crop-pdf')      PDFCrop.init();
  if (page === 'merge-pdf')     MergePDF.init();
  if (page === 'split-pdf')     SplitPDF.init();
  if (page === 'compress')      CompressImage.init();
  if (page === 'ocr')           OCRTool.init();
  if (page === 'age-calc')      AgeCalc.init();
  if (page === 'bmi-calc')      BMICalc.init();
  if (page === 'discount-calc') DiscountCalc.init();
});

window.ImageToPDF    = ImageToPDF;
window.PDFToImages   = PDFToImages;
window.PDFCrop       = PDFCrop;
window.MergePDF      = MergePDF;
window.SplitPDF      = SplitPDF;
window.CompressImage = CompressImage;
window.OCRTool       = OCRTool;
window.AgeCalc       = AgeCalc;
window.BMICalc       = BMICalc;
window.DiscountCalc  = DiscountCalc;
