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

  function init() {
    _bindDropZone('dropZone', 'fileInput', addImages);
    const btn = document.getElementById('downloadBtn');
    if (btn) btn.onclick = download;
  }

  function addImages(files) {
    const imgs = files.filter(f => f.type.startsWith('image/'));
    if (!imgs.length) { toast('Please add image files (JPG, PNG, WEBP)', 'error'); return; }

    imgs.forEach(f => {
      const id = Date.now() + Math.random();
      const reader = new FileReader();
      reader.onload = e => {
        images.push({ id, file: f, src: e.target.result });
        renderImageList();
      };
      reader.readAsDataURL(f);
    });
  }

  function renderImageList() {
    const list = document.getElementById('fileList');
    if (!list) return;
    list.classList.toggle('img-grid', images.length > 0);
    list.innerHTML = images.map((img, i) => `
      <div class="img-card" data-id="${img.id}" title="Drag to reorder">
        <span class="img-card-num">${i + 1}</span>
        <div class="img-card-thumb"><img src="${img.src}" alt="" style="transform:rotate(${img.rot || 0}deg)"></div>
        <div class="img-card-name">${img.file.name}</div>
        <div class="img-card-meta">${_fmtBytes(img.file.size)}${img.rot ? ' · ' + img.rot + '°' : ''}</div>
        <div class="img-card-actions">
          <button type="button" onclick="ImageToPDF.rotate('${img.id}')" title="Rotate 90°">↻</button>
          <button type="button" class="img-card-del" onclick="ImageToPDF.remove('${img.id}')" title="Remove">✕</button>
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
    renderImageList();
  }

  // Rotate an image by 90° steps; applied to the thumbnail immediately and
  // baked into the page when the PDF is generated.
  function rotate(id) {
    const img = images.find(im => im.id == id);
    if (!img) return;
    img.rot = ((img.rot || 0) + 90) % 360;
    renderImageList();
  }

  // Sort the image list by file name. dir = 'asc' | 'desc'. Uses natural
  // (numeric-aware) ordering so img2 comes before img10.
  function sort(dir) {
    images.sort((a, b) => {
      const cmp = a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' });
      return dir === 'desc' ? -cmp : cmp;
    });
    renderImageList();
  }

  async function generate() {
    if (!images.length) { toast('Add at least one image', 'error'); return; }
    _showProgress(10, 'Starting…');

    const { jsPDF } = window.jspdf;
    const pageSize   = document.getElementById('pageSize')?.value || 'a4';
    const orientation = document.getElementById('orientation')?.value || 'portrait';
    const quality    = +(document.getElementById('imgQuality')?.value || 0.85);
    const margin     = +(document.getElementById('pageMargin')?.value || 5);

    try {
      const doc  = new jsPDF({ orientation, unit: 'mm', format: pageSize });
      const fullW = doc.internal.pageSize.getWidth();
      const fullH = doc.internal.pageSize.getHeight();
      const pW   = fullW - margin * 2;
      const pH   = fullH - margin * 2;

      for (let i = 0; i < images.length; i++) {
        _showProgress(10 + Math.round((i / images.length) * 80), `Processing page ${i + 1}…`);
        if (i > 0) doc.addPage();

        const img = new Image();
        await new Promise(r => { img.onload = r; img.src = images[i].src; });

        // Compress via canvas at user-selected quality, baking in rotation
        const rot = images[i].rot || 0;
        const iw0 = img.naturalWidth  || img.width;
        const ih0 = img.naturalHeight || img.height;
        const c = document.createElement('canvas');
        if (rot % 180 === 0) { c.width = iw0; c.height = ih0; }
        else                 { c.width = ih0; c.height = iw0; }
        const ctx = c.getContext('2d');
        ctx.save();
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate(rot * Math.PI / 180);
        ctx.drawImage(img, -iw0 / 2, -ih0 / 2);
        ctx.restore();
        const compSrc = c.toDataURL('image/jpeg', quality);

        const ar  = c.width / c.height;
        const pAr = pW / pH;
        let iw, ih;
        if (ar > pAr) { iw = pW; ih = pW / ar; }
        else          { ih = pH; iw = pH * ar; }
        const x = margin + (pW - iw) / 2;
        const y = margin + (pH - ih) / 2;

        doc.addImage(compSrc, 'JPEG', x, y, iw, ih, undefined, 'FAST');
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
      toast('PDF generation failed: ' + e.message, 'error');
      console.error(e);
    }
  }

  function download() {
    if (!pdfBlob) return;
    _downloadBlob(pdfBlob, `CamMaster_images_${Date.now()}.pdf`, 'Image to PDF', 'convert');
    toast('PDF downloaded! ✓', 'success');
  }

  return { init, addImages, generate, remove, rotate, sort, download };
})();

/* ================================================================
   2. PDF → IMAGES
================================================================ */
const PDFToImages = (() => {
  let pdfFile = null;
  let renderedPages = [];
  let scale = 2.0;

  function init() {
    _bindDropZone('dropZone', 'fileInput', loadPDF);
    const btn = document.getElementById('downloadBtn');
    if (btn) btn.onclick = downloadZIP;

    const scaleInput = document.getElementById('renderScale');
    if (scaleInput) scaleInput.addEventListener('change', () => { scale = +scaleInput.value || 2.0; });
  }

  async function loadPDF(files) {
    const file = files.find(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (!file) { toast('Please upload a PDF file', 'error'); return; }
    pdfFile = file;
    const pc = document.getElementById('progressCard');
    if (pc) pc.style.display = 'block';
    await renderPages();
  }

  async function renderPages() {
    if (!pdfFile) return;
    renderedPages = [];
    _showProgress(5, 'Loading PDF…');

    try {
      const ab = await pdfFile.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
      const total = pdf.numPages;

      const previewWrap = document.getElementById('pagesPreview');
      if (previewWrap) previewWrap.innerHTML = '';

      for (let p = 1; p <= total; p++) {
        _showProgress(5 + Math.round((p / total) * 90), `Rendering page ${p} of ${total}…`);
        const page = await pdf.getPage(p);
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;

        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
        renderedPages.push({ blob, page: p, w: vp.width, h: vp.height, sel: true });

        if (previewWrap) {
          const thumb = document.createElement('div');
          thumb.className = 'page-thumb pt-selected';
          thumb.style.position = 'relative';
          const check = document.createElement('span');
          check.className = 'pt-check';
          check.textContent = '✓';
          const tc = document.createElement('canvas');
          const ts = Math.min(150 / vp.width, 180 / vp.height, 1);
          tc.width = Math.round(vp.width * ts); tc.height = Math.round(vp.height * ts);
          tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height);
          const info = document.createElement('div');
          info.className = 'pt-info';
          info.innerHTML = `<div class="page-num">Page ${p}</div>`;
          const dlBtn = document.createElement('button');
          dlBtn.type = 'button';
          dlBtn.textContent = '⬇ JPG';
          dlBtn.style.cssText = 'margin-top:6px;font-size:11px;padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--primary);cursor:pointer;font-weight:600';
          const pageIdx = p - 1;
          dlBtn.onclick = ev => { ev.stopPropagation(); downloadOne(pageIdx); };
          thumb.onclick = () => toggleSel(pageIdx);
          info.appendChild(dlBtn);
          thumb.appendChild(check); thumb.appendChild(tc); thumb.appendChild(info);
          previewWrap.appendChild(thumb);
        }
      }

      _showProgress(100, `${total} pages ready`);
      const stat = document.getElementById('statPages');
      const statDims = document.getElementById('statDims');
      if (stat) stat.textContent = total;
      if (statDims && renderedPages[0]) statDims.textContent = `${Math.round(renderedPages[0].w)} × ${Math.round(renderedPages[0].h)}`;
      _showResult();
      _setDownloadBtn(true);
      _updateSelUI();
      toast(`${total} pages rendered ✓`, 'success');
    } catch (e) {
      toast('PDF render failed: ' + e.message, 'error');
      console.error(e);
    }
  }

  function downloadOne(i) {
    const pg = renderedPages[i];
    if (!pg) return;
    _downloadBlob(pg.blob, `page_${pg.page}.jpg`, 'PDF to JPG', 'convert');
    toast(`Page ${pg.page} downloaded ✓`, 'success');
  }

  // ── Page selection ──
  function toggleSel(i) {
    const pg = renderedPages[i];
    if (!pg) return;
    pg.sel = !pg.sel;
    const thumbs = document.querySelectorAll('#pagesPreview .page-thumb');
    if (thumbs[i]) thumbs[i].classList.toggle('pt-selected', pg.sel);
    _updateSelUI();
  }

  function selectAll(on) {
    renderedPages.forEach(p => { p.sel = on; });
    document.querySelectorAll('#pagesPreview .page-thumb')
      .forEach(t => t.classList.toggle('pt-selected', on));
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
      btn.innerHTML = n === 1 ? '<span>🖼️</span> Download JPG'
        : (n === total ? '<span>📦</span> Download All as ZIP'
                       : `<span>📦</span> Download ${n} Selected as ZIP`);
    }
  }

  async function downloadZIP() {
    const sel = renderedPages.filter(p => p.sel);
    if (!sel.length) { toast('Select at least one page', 'error'); return; }
    // Single page — no point wrapping one JPG in a ZIP, download it directly.
    if (sel.length === 1) { downloadOne(renderedPages.indexOf(sel[0])); return; }
    _showProgress(10, 'Zipping…');
    const zip = new JSZip();
    const folder = zip.folder('pages');
    sel.forEach(p => {
      folder.file(`page_${String(p.page).padStart(3, '0')}.jpg`, p.blob);
    });
    _showProgress(70, 'Compressing…');
    const content = await zip.generateAsync({ type: 'blob' });
    _showProgress(100, 'Done!');
    _downloadBlob(content, `CamMaster_pdf_pages_${Date.now()}.zip`, 'PDF to Images', 'convert');
    toast(`ZIP with ${sel.length} pages downloaded! ✓`, 'success');
  }

  return { init, loadPDF, downloadZIP, downloadOne, toggleSel, selectAll };
})();

/* ================================================================
   3. MERGE PDF  — Advanced workspace with per-file page selection
================================================================ */
const MergePDF = (() => {
  // pdfFiles: [{ id, file, name, size, totalPages, pageChecks: [bool…] }]
  let pdfFiles   = [];
  let mergedBlob = null;

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
    const pdfs = files.filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (!pdfs.length) { toast('Please add PDF files', 'error'); return; }

    // Show a brief loading indicator while reading page counts
    const mergeBtn = document.getElementById('mergeBtn');
    if (mergeBtn) mergeBtn.textContent = '⏳ Loading…';

    for (const file of pdfs) {
      try {
        const ab = await file.arrayBuffer();
        const { PDFDocument } = PDFLib;
        const doc = await PDFDocument.load(ab, { ignoreEncryption: true });
        const totalPages = doc.getPageCount();
        pdfFiles.push({
          id: Date.now() + '_' + Math.random().toString(36).slice(2),
          file, name: file.name, size: file.size,
          totalPages,
          pageChecks: new Array(totalPages).fill(true),
        });
      } catch(e) {
        toast(`Could not read ${file.name}: ${e.message}`, 'error');
      }
    }

    if (mergeBtn) mergeBtn.textContent = '🔗 Merge PDFs';
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
              <div class="pfc-name" title="${f.name}">${f.name}</div>
              <div class="pfc-meta">${_fmtBytes(f.size)} · ${f.totalPages} page${f.totalPages !== 1 ? 's' : ''}</div>
            </div>
            <div class="pfc-controls">
              <button class="pfc-btn" onclick="MergePDF.selectAll(${fileIdx},true)" title="Select all">All</button>
              <button class="pfc-btn" onclick="MergePDF.selectAll(${fileIdx},false)" title="Deselect all">None</button>
              <button class="pfc-btn" onclick="MergePDF.promptRange(${fileIdx})" title="Select range">Range…</button>
              <button class="pfc-del" onclick="MergePDF.remove(${fileIdx})" title="Remove file">✕</button>
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
    const newChecks = new Array(f.totalPages).fill(false);
    raw.split(',').forEach(seg => {
      seg = seg.trim();
      if (!seg) return;
      if (seg.includes('-')) {
        const [a, b] = seg.split('-').map(n => parseInt(n.trim(), 10) - 1);
        const start = Math.max(0, a);
        const end   = Math.min(f.totalPages - 1, isNaN(b) ? start : b);
        for (let i = start; i <= end; i++) newChecks[i] = true;
      } else {
        const p = parseInt(seg, 10) - 1;
        if (p >= 0 && p < f.totalPages) newChecks[p] = true;
      }
    });
    const selected = newChecks.filter(Boolean).length;
    if (!selected) { toast('No valid pages in that range', 'error'); return; }
    pdfFiles[fileIdx].pageChecks = newChecks;
    renderList();
    toast(`${selected} pages selected for ${f.name}`, 'success');
  }

  function remove(idx) {
    pdfFiles.splice(idx, 1);
    renderList();
  }

  function reorder(from, to) {
    if (from < 0 || to < 0 || from >= pdfFiles.length || to >= pdfFiles.length) return;
    const moved = pdfFiles.splice(from, 1)[0];
    pdfFiles.splice(to, 0, moved);
    renderList();
  }

  // Sort merged files. by = 'name' | 'size'; dir = 'asc' | 'desc'.
  function sort(by, dir) {
    pdfFiles.sort((a, b) => {
      let cmp;
      if (by === 'size') cmp = a.size - b.size;
      else cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      return dir === 'desc' ? -cmp : cmp;
    });
    renderList();
  }

  async function merge() {
    if (pdfFiles.length < 2) { toast('Add at least 2 PDFs', 'error'); return; }
    const totalSelected = pdfFiles.reduce((s, f) => s + f.pageChecks.filter(Boolean).length, 0);
    if (!totalSelected) { toast('Select at least one page to merge', 'error'); return; }

    const pc = document.getElementById('progressCard');
    if (pc) pc.style.display = 'block';
    _showProgress(5, 'Merging…');

    try {
      const { PDFDocument } = PDFLib;
      const merged = await PDFDocument.create();

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
      toast('Merge failed: ' + e.message, 'error');
      console.error(e);
    }
  }

  function download() {
    if (!mergedBlob) return;
    _downloadBlob(mergedBlob, `CamMaster_merged_${Date.now()}.pdf`, 'Merge PDF', 'merge');
    toast('Merged PDF downloaded! ✓', 'success');
  }

  return { init, addPDFs, merge, remove, reorder, sort, togglePage, selectAll, promptRange, download };
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
        const pdf = pending.find(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
        if (pdf) loadPDF([pdf]);
      }
    }
  }

  function _updateModeUI() {
    const mode = document.querySelector('input[name="splitMode"]:checked')?.value || 'all';
    document.querySelectorAll('.split-option').forEach(el => el.classList.remove('show'));
    const target = document.getElementById('opt_' + mode);
    if (target) target.classList.add('show');
    const gridSection = document.getElementById('pageGridSection');
    if (gridSection) gridSection.style.display = mode === 'visual' ? 'block' : 'none';
    _updateGroupLabel();
  }

  async function loadPDF(files) {
    const file = files.find(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (!file) { toast('Please upload a PDF', 'error'); return; }
    pdfFile = file;
    splitPoints.clear();

    const pc = document.getElementById('progressCard');
    if (pc) pc.style.display = 'block';
    _showProgress(5, 'Loading PDF…');

    try {
      const ab = await file.arrayBuffer();
      const { PDFDocument } = PDFLib;
      const doc = await PDFDocument.load(ab);
      totalPages = doc.getPageCount();

      const info = document.getElementById('pdfInfo');
      if (info) { info.textContent = `${file.name} — ${totalPages} pages`; info.style.display = 'block'; }

      const splitBtn = document.getElementById('splitBtn');
      if (splitBtn) splitBtn.disabled = false;

      _showProgress(30, 'Rendering previews…');

      // Render page thumbnails if PDF.js is available
      if (window.pdfjsLib) {
        await _renderGrid(ab);
      } else {
        _renderGridPlaceholder();
      }

      _showProgress(100, `${totalPages} pages loaded`);
      if (pc) pc.style.display = 'none';
      _updateGroupLabel();
      toast(`${totalPages} pages loaded`, 'success');
    } catch(e) {
      toast('Could not load PDF: ' + e.message, 'error');
      console.error(e);
      const pc2 = document.getElementById('progressCard');
      if (pc2) pc2.style.display = 'none';
    }
  }

  async function _renderGrid(ab) {
    const container = document.getElementById('pageGrid');
    if (!container) return;
    container.innerHTML = '';

    const gridSection = document.getElementById('pageGridSection');
    if (gridSection) gridSection.style.display = 'block';

    const pdfDoc = await pdfjsLib.getDocument({ data: ab.slice(0) }).promise;
    const limit  = Math.min(totalPages, 60); // render at most 60 thumbs

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
    const gridSection = document.getElementById('pageGridSection');
    if (gridSection) gridSection.style.display = 'block';

    for (let p = 1; p <= Math.min(totalPages, 60); p++) {
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
    const pc = document.getElementById('progressCard');
    if (pc) pc.style.display = 'block';
    _showProgress(5, 'Splitting…');

    const mode = document.querySelector('input[name="splitMode"]:checked')?.value || 'all';
    const { PDFDocument } = PDFLib;
    const ab     = await pdfFile.arrayBuffer();
    const srcDoc = await PDFDocument.load(ab);
    const zip    = new JSZip();
    const folder = zip.folder('pages');

    try {
      let splits = [];

      if (mode === 'all') {
        splits = Array.from({ length: totalPages }, (_, i) => [i]);
      } else if (mode === 'every') {
        const n = Math.max(1, +(document.getElementById('everyN')?.value || 1));
        for (let i = 0; i < totalPages; i += n)
          splits.push(Array.from({ length: Math.min(n, totalPages - i) }, (_, j) => i + j));
      } else if (mode === 'ranges') {
        const str = document.getElementById('rangesInput')?.value || '';
        splits = _parseRanges(str, totalPages);
        if (!splits.length) { toast('Enter valid page ranges (e.g. 1-3, 5, 8-10)', 'error'); return; }
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
        const name  = `part_${String(i + 1).padStart(3, '0')}.pdf`;
        parts.push({ bytes, name, pageCount: splits[i].length });
        folder.file(name, bytes);
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
      toast('Split failed: ' + e.message, 'error');
      console.error(e);
    }
  }

  function _parseRanges(str, total) {
    const parts = [];
    str.split(',').forEach(seg => {
      seg = seg.trim();
      if (!seg) return;
      if (seg.includes('-')) {
        const [a, b] = seg.split('-').map(n => parseInt(n.trim(), 10) - 1);
        const start  = Math.max(0, a);
        const end    = Math.min(total - 1, isNaN(b) ? start : b);
        parts.push(Array.from({ length: end - start + 1 }, (_, i) => start + i));
      } else {
        const p = parseInt(seg, 10) - 1;
        if (p >= 0 && p < total) parts.push([p]);
      }
    });
    return parts.filter(p => p.length > 0);
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
    _downloadBlob(zipBlob, `CamMaster_split_${Date.now()}.zip`, 'Split PDF', 'split');
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
  let _aspectLocked = true;
  let _outputFormat = 'image/jpeg';

  /* ── INIT ─────────────────────────────────────────────────── */
  function init() {
    _bindDropZone('dropZone', 'fileInput', loadImage);

    // Quality slider label sync
    const qualSlider = document.getElementById('quality');
    const qualVal    = document.getElementById('qualityVal');
    if (qualSlider && qualVal) {
      qualSlider.addEventListener('input', () => {
        qualVal.textContent = qualSlider.value + '%';
      });
    }

    // Scale % slider → update W/H inputs (keeps aspect ratio)
    const scaleSlider = document.getElementById('scaleSlider');
    const scaleVal    = document.getElementById('scaleVal');
    if (scaleSlider) {
      scaleSlider.addEventListener('input', () => {
        const pct = +scaleSlider.value;
        scaleVal.textContent = pct + '%';
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
        if (!_aspectLocked || !_origW) return;
        const w = +wIn.value;
        if (w > 0) hIn.value = Math.round(w * _origH / _origW);
      });
    }
    if (hIn) {
      hIn.addEventListener('input', () => {
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
  }

  /* ── LOAD IMAGE ───────────────────────────────────────────── */
  function loadImage(files) {
    const file = files.find(f => f.type.startsWith('image/'));
    if (!file) { toast('Please upload an image file', 'error'); return; }

    _origFileSize = file.size;
    const reader  = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        _srcImg = img;
        _origW  = img.naturalWidth;
        _origH  = img.naturalHeight;

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

        // Show settings card
        const sc = document.getElementById('settingsCard');
        if (sc) sc.style.display = '';

        const cb = document.getElementById('compressBtn');
        if (cb) cb.disabled = false;
      };
      img.onerror = () => toast('Failed to load image', 'error');
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* ── APPLY TEMPLATE ───────────────────────────────────────── */
  function applyTemplate(btn) {
    const w = +btn.dataset.w;
    const h = +btn.dataset.h;
    document.querySelectorAll('.tpl-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Templates override aspect lock — set exact px
    _setDimInputs(w, h, false);
    // Reset scale slider to custom
    const scaleSlider = document.getElementById('scaleSlider');
    const scaleVal    = document.getElementById('scaleVal');
    if (scaleSlider) { scaleSlider.value = 100; }
    if (scaleVal)    { scaleVal.textContent = '100%'; }
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

      // Clamp to sane maximums
      outW = Math.max(1, Math.min(outW, 16000));
      outH = Math.max(1, Math.min(outH, 16000));

      const targetKbEl = document.getElementById('targetKb');
      const targetKb   = targetKbEl ? +targetKbEl.value : 0;
      const quality    = +(document.getElementById('quality')?.value || 85) / 100;
      const format     = _outputFormat;

      // Draw source onto output-sized canvas
      const srcCanvas  = document.createElement('canvas');
      srcCanvas.width  = outW;
      srcCanvas.height = outH;
      srcCanvas.getContext('2d').drawImage(_srcImg, 0, 0, outW, outH);

      let blob;
      let finalQuality = quality;

      if (targetKb > 0 && format !== 'image/png') {
        // Target-size mode: binary search quality until under targetKb
        blob = await _compressToTargetKb(srcCanvas, format, targetKb);
        finalQuality = blob._quality; // stashed by helper
        _el('targetKbStatus', `✓ Hit ${(blob.size / 1024).toFixed(1)} KB at ${Math.round(finalQuality * 100)}% quality`);
      } else {
        blob = await _canvasToBlob(srcCanvas, format, quality);
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
      const saving = Math.max(0, Math.round((1 - blob.size / _origFileSize) * 100));
      _el('statCompSize',      _fmtBytes(blob.size));
      _el('cpCompSizeTag',     _fmtBytes(blob.size));
      _el('statCompDims',      `${outW} × ${outH}`);
      _el('statFinalQuality',  Math.round(finalQuality * 100) + '%');
      const savEl = document.getElementById('statSaving');
      if (savEl) {
        savEl.textContent  = saving > 0 ? `${saving}% smaller` : 'No reduction';
        savEl.className    = 'rs-value' + (saving > 0 ? ' positive' : '');
      }

      // Show result card
      const rs = document.getElementById('resultSection');
      if (rs) rs.style.display = '';
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
        bestBlob._quality = mid;
        lo = mid; // try higher quality while still under target
      } else {
        hi = mid;
      }

      if (hi - lo < 0.005) break;
    }

    if (!bestBlob) {
      // Even quality=0.01 is too large — return it anyway
      const blob = await _canvasToBlob(canvas, format, 0.01);
      blob._quality = 0.01;
      toast('Image too large to meet target KB at current dimensions', 'warning');
      return blob;
    }
    return bestBlob;
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

  function _el(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function download() {
    if (!_result) return;
    const ext = _result.format.split('/')[1].replace('jpeg', 'jpg');
    _downloadBlob(_result.blob, `PDFdukan_compressed_${Date.now()}.${ext}`, 'Image Compressor', 'compress');
    toast('Image downloaded! ✓', 'success');
  }

  return { init, loadImage, compress, download, applyTemplate, setFormat };
})();

/* ================================================================
   6. OCR TEXT EXTRACTION
================================================================ */
const OCRTool = (() => {
  function init() {
    _bindDropZone('dropZone', 'fileInput', loadImage);

    const copyBtn = document.getElementById('copyBtn');
    const downBtn = document.getElementById('downloadTxtBtn');
    if (copyBtn) copyBtn.onclick = copyText;
    if (downBtn) downBtn.onclick = downloadTxt;
  }

  async function loadImage(files) {
    const file = files.find(f => f.type.startsWith('image/'));
    if (!file) { toast('Please upload an image', 'error'); return; }

    const lang = document.getElementById('ocrLang')?.value || 'eng';
    const pc = document.getElementById('progressCard');
    if (pc) pc.style.display = 'block';

    const preview = document.getElementById('imgPreview');
    if (preview) {
      const reader = new FileReader();
      reader.onload = e => { preview.src = e.target.result; preview.style.display = 'block'; };
      reader.readAsDataURL(file);
    }

    _showProgress(5, 'Starting OCR engine…');
    try {
      const logger = m => {
        // Show real progress for EVERY phase — not just recognizing
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

      let data;
      try {
        // Tesseract.js v5 API — createWorker(lang, oem, options) loads the language itself
        const worker = await Tesseract.createWorker(lang, 1, { logger });
        ({ data } = await worker.recognize(file));
        await worker.terminate();
      } catch (apiErr) {
        // Older Tesseract build still cached (v2/v4 API) — one-shot API works on every version
        console.warn('OCR: createWorker path failed, falling back to Tesseract.recognize()', apiErr);
        ({ data } = await Tesseract.recognize(file, lang, { logger }));
      }

      _showProgress(100, 'Complete!');
      const output = document.getElementById('ocrOutput');
      if (output) output.textContent = data.text.trim() || '(No text detected in image — try a clearer photo)';

      const confEl = document.getElementById('statConf');
      const wordEl = document.getElementById('statWords');
      const charEl = document.getElementById('statChars');
      if (confEl) confEl.textContent = Math.round(data.confidence) + '%';
      if (wordEl) wordEl.textContent = data.words?.length || 0;
      if (charEl) charEl.textContent = data.text.length;
      _showResult();
      toast('Text extracted! ✓', 'success');
    } catch (e) {
      _showProgress(0, '');
      const pc = document.getElementById('progressCard');
      if (pc) pc.style.display = 'none';
      const why = (e && e.message) ? ' (' + e.message + ')' : '';
      toast('OCR failed — try a clearer image or different browser.' + why, 'error');
      console.error('OCR error:', e);
    }
  }

  function copyText() {
    const text = document.getElementById('ocrOutput')?.textContent || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard! ✓', 'success'));
  }

  function downloadTxt() {
    const text = document.getElementById('ocrOutput')?.textContent || '';
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain' });
    _downloadBlob(blob, `CamMaster_ocr_${Date.now()}.txt`, 'OCR Text', 'extract');
    toast('Text file downloaded! ✓', 'success');
  }

  return { init, loadImage, copyText, downloadTxt };
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
window.MergePDF      = MergePDF;
window.SplitPDF      = SplitPDF;
window.CompressImage = CompressImage;
window.OCRTool       = OCRTool;
window.AgeCalc       = AgeCalc;
window.BMICalc       = BMICalc;
window.DiscountCalc  = DiscountCalc;
