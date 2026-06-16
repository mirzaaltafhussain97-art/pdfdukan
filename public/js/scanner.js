/* ================================================================
   CamMaster — Scanner Flow
   Upload → Crop → Filter → Pages → Export
================================================================ */

const ScannerApp = (() => {

  const SCREENS = ['upload', 'crop', 'filter', 'pages', 'export'];
  let state = {
    screen: 'upload',
    queue: [],          // Files pending processing
    queueIndex: 0,
    pages: [],          // [{id, croppedImg, filter, adjustments, canvas}]
    editingIndex: -1,   // Which page is being edited (-1 = new)
    currentFilter: 'enhance',
    adjustments: { brightness: 0, contrast: 0, sharpness: 0, saturation: 0 },
    applyToAll: false,
  };

  let cropEditor = null;

  /* ── INIT ─────────────────────────────────────────────────── */
  function init() {
    cropEditor = new CropEditor('cropCanvas');

    /* Warm up the AI corner-detection model on the user's first interaction
       (not at page load) so visitors who never scan don't download it, while
       anyone about to scan gets it preloaded before the crop step. */
    if (window.MLDetector) {
      const warm = () => { window.MLDetector.load().catch(() => {}); };
      ['pointerdown', 'dragover', 'keydown', 'touchstart'].forEach(ev =>
        window.addEventListener(ev, warm, { once: true, passive: true }));
    }

    _bindUploadZone();
    _bindCropControls();
    _bindFilterControls();
    _bindPagesControls();
    _bindExportControls();

    showScreen('upload');

    // Consume any file that was pre-loaded from the homepage unified drop UX
    if (typeof consumePendingFiles === 'function') {
      const pending = consumePendingFiles();
      if (pending && pending.length) {
        setTimeout(() => handleFiles(pending), 100);
      }
    }

    console.log('ScannerApp initialized');
  }

  /* ── SCREEN MANAGEMENT ────────────────────────────────────── */
  function showScreen(name) {
    SCREENS.forEach(s => {
      const el = document.getElementById('screen-' + s);
      if (el) el.classList.toggle('active', s === name);
    });
    state.screen = name;

    // Update step indicator
    document.querySelectorAll('.scanner-step').forEach((el, i) => {
      const stepName = el.dataset.step;
      const stepIdx = SCREENS.indexOf(stepName);
      const curIdx = SCREENS.indexOf(name);
      el.classList.toggle('active', stepName === name);
      el.classList.toggle('done', stepIdx < curIdx);
    });
  }

  /* ── UPLOAD ZONE ──────────────────────────────────────────── */
  function _bindUploadZone() {
    const zone = document.getElementById('uploadZone');
    if (!zone) return;

    ['dragenter', 'dragover'].forEach(ev =>
      zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('drag-over'); })
    );
    ['dragleave', 'drop'].forEach(ev =>
      zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('drag-over'); })
    );
    zone.addEventListener('drop', e => {
      const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
      if (files.length) handleFiles(files);
    });
    zone.addEventListener('click', () => document.getElementById('fileInputScanner').click());

    const fileInput = document.getElementById('fileInputScanner');
    if (fileInput) fileInput.addEventListener('change', e => handleFiles([...e.target.files]));

    // PDF import input (separate input for accept=".pdf")
    const pdfInput = document.getElementById('fileInputPdfScan');
    if (pdfInput) pdfInput.addEventListener('change', e => handleFiles([...e.target.files]));
  }

  function handleFiles(files) {
    if (!files.length) return;
    // Signup optional — no login gate; process files for everyone.
    state.queue = files.map(f => ({ file: f, type: f.type }));
    state.queueIndex = 0;
    state.editingIndex = -1;
    _processNextInQueue();
  }

  function _processNextInQueue() {
    if (state.queueIndex >= state.queue.length) {
      if (state.pages.length > 0) showScreen('pages');
      else showScreen('upload');
      return;
    }

    const item = state.queue[state.queueIndex];
    if (item.img) {
      // pre-rendered image (e.g. a rasterised PDF page) — run it through the
      // same crop + filter pipeline as a photo so all editing tools apply.
      _startCropScreen(item.img);
    } else if (item.file.type === 'application/pdf') {
      _processPDFFile(item.file);
    } else {
      _processImageFile(item.file);
    }
  }

  const MAX_IMAGE_PX = 16_000_000; // 16MP — above this we resize before processing

  function _processImageFile(file) {
    showProcessing('Loading image…');
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const px = (img.naturalWidth || img.width) * (img.naturalHeight || img.height);
        if (px > MAX_IMAGE_PX) {
          // Downscale to fit within MAX_IMAGE_PX, preserving aspect ratio
          showProcessing('Resizing large image…');
          const scale = Math.sqrt(MAX_IMAGE_PX / px);
          const nW = Math.round((img.naturalWidth  || img.width)  * scale);
          const nH = Math.round((img.naturalHeight || img.height) * scale);
          const c  = document.createElement('canvas');
          c.width = nW; c.height = nH;
          c.getContext('2d').drawImage(img, 0, 0, nW, nH);
          const resized = new Image();
          resized.onload = () => { hideProcessing(); _startCropScreen(resized); };
          resized.src = c.toDataURL('image/jpeg', 0.95);
        } else {
          hideProcessing();
          _startCropScreen(img);
        }
      };
      img.onerror = () => { hideProcessing(); toast('Failed to load image', 'error'); };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  async function _processPDFFile(file) {
    showProcessing('Rendering PDF pages…');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const allImgs = [];

      for (let pg = 1; pg <= pdf.numPages; pg++) {
        const page = await pdf.getPage(pg);
        const vp = page.getViewport({ scale: 2.0 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const img = new Image();
        await new Promise(r => { img.onload = r; img.src = c.toDataURL('image/png'); });
        allImgs.push(img);
      }

      hideProcessing();
      if (!allImgs.length) {
        toast('PDF has no pages', 'error');
        state.queueIndex++;
        _processNextInQueue();
        return;
      }
      // Expand this PDF item into one queue item per rendered page, then run
      // them through the normal crop + filter pipeline (so crop/filter/adjust
      // tools all apply to PDF pages, just like uploaded photos).
      const items = allImgs.map(img => ({ img }));
      state.queue.splice(state.queueIndex, 1, ...items);
      _processNextInQueue();
    } catch (e) {
      hideProcessing();
      toast('Failed to load PDF', 'error');
      console.error(e);
    }
  }

  /* ── CROP SCREEN ──────────────────────────────────────────── */
  function _startCropScreen(img) {
    showProcessing('Detecting document edges…');
    setTimeout(async () => {
      try { await cropEditor.setImageAsync(img); }
      catch (e) { cropEditor.setImage(img); }   // hard fallback
      hideProcessing();
      showScreen('crop');
    }, 100);
  }

  function _bindCropControls() {
    const btnApply      = document.getElementById('btnApplyCrop');
    const btnReset      = document.getElementById('btnResetCrop');
    const btnFit        = document.getElementById('btnFitCrop');
    const btnRotateL    = document.getElementById('btnRotateL');
    const btnRotateR    = document.getElementById('btnRotateR');
    const btnSkip       = document.getElementById('btnSkipCrop');
    const btnBackUpload = document.getElementById('btnBackToUpload');

    if (btnApply)      btnApply.onclick      = _applyCrop;
    if (btnReset)      btnReset.onclick      = () => cropEditor.resetCorners();
    if (btnFit)        btnFit.onclick        = () => cropEditor.fitFull();
    if (btnRotateL)    btnRotateL.onclick    = () => cropEditor.rotate(-90);
    if (btnRotateR)    btnRotateR.onclick    = () => cropEditor.rotate(90);
    if (btnBackUpload) btnBackUpload.onclick = () => showScreen('upload');
    if (btnSkip)    btnSkip.onclick    = async () => {
      showProcessing('Processing…');
      const img = await cropEditor.perspectiveCrop().catch(() => cropEditor.img);
      hideProcessing();
      _startFilterScreen(img);
    };
  }

  async function _applyCrop() {
    showProcessing('Flattening document…');
    try {
      let img;
      if (window.cvReady) {
        // Use OpenCV for best quality when available
        img = await cropEditor.applyCrop();
      } else {
        // Pure JS homography warp — always accurate, no OpenCV dependency
        img = await cropEditor.perspectiveCrop();
      }
      hideProcessing();
      _startFilterScreen(img);
    } catch (e) {
      console.error('Crop error:', e);
      hideProcessing();
      toast('Retrying with fallback engine…', 'warning');
      try {
        // Second attempt: pure JS warp
        const img = await cropEditor.perspectiveCrop();
        _startFilterScreen(img);
      } catch (e2) {
        // Absolute last resort: bounding-box crop
        const img = await cropEditor.simpleCrop();
        _startFilterScreen(img);
      }
    }
  }

  /* ── FILTER SCREEN ────────────────────────────────────────── */
  function _startFilterScreen(croppedImg) {
    state._currentCropped = croppedImg;
    // Only reset filter/adjustments when processing a fresh image (not re-editing an existing page)
    if (state.editingIndex < 0) {
      state.currentFilter = 'enhance';
      state.adjustments = { brightness: 0, contrast: 0, sharpness: 0, saturation: 0 };
    }

    // Reset sliders to current state
    ['brightness', 'contrast', 'sharpness', 'saturation'].forEach(k => {
      const sl = document.getElementById('sl_' + k);
      const vl = document.getElementById('sv_' + k);
      if (sl) sl.value = state.adjustments[k] ?? 0;
      if (vl) vl.textContent = String(state.adjustments[k] ?? 0);
    });

    // Show batch banner when multiple images are queued
    const remaining = state.queue.length - state.queueIndex - 1;
    const banner = document.getElementById('batchBanner');
    const bannerMsg = document.getElementById('batchBannerMsg');
    if (banner) {
      banner.style.display = remaining > 0 ? 'block' : 'none';
      if (bannerMsg && remaining > 0) {
        bannerMsg.textContent = `${remaining} more image${remaining > 1 ? 's' : ''} will be auto-cropped and processed with these same settings.`;
      }
    }

    // Build filter strip
    buildFilterStrip('filterStrip', croppedImg, 'enhance', fid => {
      state.currentFilter = fid;
      _reprocess();
    });

    // Draw original mini
    const origCanvas = document.getElementById('origMini');
    if (origCanvas) {
      const ms = Math.min(280 / croppedImg.width, 200 / croppedImg.height, 1);
      origCanvas.width = Math.round(croppedImg.width * ms);
      origCanvas.height = Math.round(croppedImg.height * ms);
      origCanvas.getContext('2d').drawImage(croppedImg, 0, 0, origCanvas.width, origCanvas.height);
    }

    showScreen('filter');
    _reprocess();
  }

  function _reprocess() {
    const img = state._currentCropped;
    if (!img) return;

    const canvas = document.getElementById('previewCanvas');
    if (!canvas) return;

    const MAX_W = 660, MAX_H = 500;
    const s = Math.min(MAX_W / img.width, MAX_H / img.height, 1);
    canvas.width = Math.round(img.width * s);
    canvas.height = Math.round(img.height * s);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    applyFilterToContext(ctx, canvas.width, canvas.height, state.currentFilter, state.adjustments);

    // Update processed mini
    const procCanvas = document.getElementById('procMini');
    if (procCanvas) {
      const ms = Math.min(280 / img.width, 200 / img.height, 1);
      procCanvas.width = Math.round(img.width * ms);
      procCanvas.height = Math.round(img.height * ms);
      const mctx = procCanvas.getContext('2d');
      mctx.drawImage(img, 0, 0, procCanvas.width, procCanvas.height);
      applyFilterToContext(mctx, procCanvas.width, procCanvas.height, state.currentFilter, state.adjustments);
    }
  }

  function _bindFilterControls() {
    ['brightness', 'contrast', 'sharpness', 'saturation'].forEach(k => {
      const sl = document.getElementById('sl_' + k);
      const vl = document.getElementById('sv_' + k);
      if (sl) {
        sl.addEventListener('input', () => {
          state.adjustments[k] = +sl.value;
          if (vl) vl.textContent = sl.value;
          _reprocess();
        });
      }
    });

    const btnAddPage         = document.getElementById('btnAddPage');
    const btnAddPageMain     = document.getElementById('btnAddPageMain');
    const btnBackCrop        = document.getElementById('btnBackToCrop');
    const btnBackCropMain    = document.getElementById('btnBackToCropMain');
    const applyAll           = document.getElementById('applyToAll');
    const btnBatchAll        = document.getElementById('btnBatchAll');

    if (btnAddPage)      btnAddPage.onclick      = _addPage;
    if (btnAddPageMain)  btnAddPageMain.onclick  = _addPage;
    if (btnBackCrop)     btnBackCrop.onclick     = () => showScreen('crop');
    if (btnBackCropMain) btnBackCropMain.onclick = () => showScreen('crop');
    if (applyAll) applyAll.addEventListener('change', e => { state.applyToAll = e.target.checked; });
    if (btnBatchAll)     btnBatchAll.onclick     = _batchProcessRemaining;
  }

  /* ── BATCH AUTO-PROCESS ───────────────────────────────────────
     Auto-crops and applies current filter to all remaining queue
     items without stopping for user input on each one.         */
  async function _batchProcessRemaining() {
    const img = state._currentCropped;
    if (!img) return;

    // First: save the current image as a page
    state.pages.push({
      id: Date.now() + Math.random(),
      croppedImg: img,
      filter: state.currentFilter,
      adjustments: { ...state.adjustments },
    });
    state.queueIndex++;

    const savedFilter      = state.currentFilter;
    const savedAdjustments = { ...state.adjustments };
    const remaining        = state.queue.length - state.queueIndex;

    if (remaining === 0) { showScreen('pages'); _renderPages(); return; }

    showProcessing(`Auto-processing ${remaining} remaining image${remaining > 1 ? 's' : ''}…`);

    for (let i = state.queueIndex; i < state.queue.length; i++) {
      const item = state.queue[i];
      const processedImg = item.img
        ? await _autoProcessLoadedImage(item.img)   // pre-rendered PDF page
        : await _autoProcessImage(item.file);
      if (processedImg) {
        state.pages.push({
          id: Date.now() + Math.random(),
          croppedImg: processedImg,
          filter: savedFilter,
          adjustments: { ...savedAdjustments },
        });
      }
      // Update progress message
      const done = i - state.queueIndex + 1;
      showProcessing(`Processed ${done} of ${remaining} images…`);
    }

    state.queueIndex = state.queue.length;
    hideProcessing();
    toast(`✓ All ${state.pages.length} pages ready!`, 'success');
    showScreen('pages');
    _renderPages();
  }

  /* Load an image file, auto-detect edges, return cropped image */
  async function _autoProcessImage(file) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload  = () => _autoProcessLoadedImage(img).then(resolve);
        img.onerror = () => resolve(null);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  /* Auto-detect edges + perspective-correct an already-loaded Image */
  async function _autoProcessLoadedImage(img) {
    try {
      // Downscale if needed
      const px = (img.naturalWidth || img.width) * (img.naturalHeight || img.height);
      let sourceImg = img;
      if (px > MAX_IMAGE_PX) {
        const scale = Math.sqrt(MAX_IMAGE_PX / px);
        const nW = Math.round((img.naturalWidth  || img.width)  * scale);
        const nH = Math.round((img.naturalHeight || img.height) * scale);
        const c  = document.createElement('canvas');
        c.width = nW; c.height = nH;
        c.getContext('2d').drawImage(img, 0, 0, nW, nH);
        sourceImg = new Image();
        await new Promise(r => { sourceImg.onload = r; sourceImg.src = c.toDataURL('image/jpeg', 0.95); });
      }
      // Auto-detect + perspective-correct
      await cropEditor.setImageAsync(sourceImg).catch(() => cropEditor.setImage(sourceImg));
      const cropped = await cropEditor.perspectiveCrop().catch(() => sourceImg);
      return cropped;
    } catch (err) {
      console.warn('Auto-process failed for image, using original:', err);
      return img;
    }
  }

  function _addPage() {
    const img = state._currentCropped;
    if (!img) return;

    // If applyToAll, apply current filter/adjustments to all existing pages
    if (state.applyToAll && state.pages.length > 0) {
      state.pages.forEach(p => {
        p.filter = state.currentFilter;
        p.adjustments = { ...state.adjustments };
      });
    }

    if (state.editingIndex >= 0) {
      // Update existing page
      state.pages[state.editingIndex].croppedImg  = img;
      state.pages[state.editingIndex].filter      = state.currentFilter;
      state.pages[state.editingIndex].adjustments = { ...state.adjustments };
      state.editingIndex = -1;
    } else {
      state.pages.push({
        id: Date.now() + Math.random(),
        croppedImg: img,
        filter: state.currentFilter,
        adjustments: { ...state.adjustments },
      });
    }

    state.queueIndex++;
    if (state.queueIndex < state.queue.length) {
      _processNextInQueue();
    } else {
      showScreen('pages');
      _renderPages();
    }
  }

  /* ── PAGES SCREEN ─────────────────────────────────────────── */
  function _renderPages() {
    const grid = document.getElementById('pagesGrid');
    if (!grid) return;

    if (!state.pages.length) {
      grid.innerHTML = '<div class="empty-state"><div class="es-icon">📄</div><p>No pages yet</p></div>';
      return;
    }

    grid.innerHTML = '';
    state.pages.forEach((page, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'page-thumb';
      thumb.dataset.id = page.id;

      const imgWrap = document.createElement('div');
      imgWrap.className = 'pt-img';

      const c = document.createElement('canvas');
      const s = Math.min(160 / page.croppedImg.width, 180 / page.croppedImg.height, 1);
      c.width = Math.round(page.croppedImg.width * s);
      c.height = Math.round(page.croppedImg.height * s);
      const ctx = c.getContext('2d');
      ctx.drawImage(page.croppedImg, 0, 0, c.width, c.height);
      applyFilterToContext(ctx, c.width, c.height, page.filter, page.adjustments);
      imgWrap.appendChild(c);

      const info = document.createElement('div');
      info.className = 'pt-info';
      info.innerHTML = `<div class="page-num">Page ${idx + 1}</div><div class="page-filter">${page.filter}</div>`;

      const dl = document.createElement('button');
      dl.type = 'button';
      dl.textContent = '⬇ JPG';
      dl.title = 'Download this page as JPG';
      dl.style.cssText = 'margin-top:6px;font-size:11px;padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--primary);cursor:pointer;font-weight:600';
      dl.onclick = (e) => { e.stopPropagation(); _downloadPage(idx); };
      info.appendChild(dl);

      const del = document.createElement('button');
      del.className = 'page-del';
      del.innerHTML = '✕';
      del.title = 'Remove page';
      del.onclick = (e) => { e.stopPropagation(); _deletePage(idx); };

      thumb.appendChild(imgWrap);
      thumb.appendChild(info);
      thumb.appendChild(del);
      thumb.addEventListener('click', () => _editPage(idx));
      grid.appendChild(thumb);
    });

    // Init Sortable for drag reorder
    if (typeof Sortable !== 'undefined') {
      Sortable.create(grid, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: e => {
          const moved = state.pages.splice(e.oldIndex, 1)[0];
          state.pages.splice(e.newIndex, 0, moved);
        },
      });
    }
  }

  // Export one page (with its filter/adjustments applied) as a standalone JPG,
  // so multi-page scans don't force a ZIP download for a single page.
  function _downloadPage(idx) {
    const page = state.pages[idx];
    if (!page) return;
    const c = document.createElement('canvas');
    c.width = page.croppedImg.width || page.croppedImg.naturalWidth;
    c.height = page.croppedImg.height || page.croppedImg.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(page.croppedImg, 0, 0);
    applyFilterToContext(ctx, c.width, c.height, page.filter, page.adjustments);
    c.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `CamMaster_page_${idx + 1}.jpg`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Page ${idx + 1} downloaded ✓`, 'success');
    }, 'image/jpeg', 0.92);
  }

  function _deletePage(idx) {
    state.pages.splice(idx, 1);
    _renderPages();
    if (state.pages.length === 0) showScreen('upload');
  }

  function _editPage(idx) {
    state.editingIndex = idx;
    const page = state.pages[idx];
    state._currentCropped = page.croppedImg;
    state.currentFilter = page.filter;
    state.adjustments = { ...page.adjustments };
    _startFilterScreen(page.croppedImg);
  }

  function _bindPagesControls() {
    const btnAddMore = document.getElementById('btnAddMore');
    const btnExport  = document.getElementById('btnGoExport');

    if (btnAddMore) btnAddMore.onclick = () => {
      document.getElementById('fileInputScanner').click();
    };
    if (btnExport) btnExport.onclick = () => {
      showScreen('export');
      _renderExportPreview();
    };
  }

  /* ── EXPORT SCREEN ────────────────────────────────────────── */
  function _renderExportPreview() {
    const count = document.getElementById('exportPageCount');
    if (count) count.textContent = `${state.pages.length} page${state.pages.length !== 1 ? 's' : ''}`;
  }

  function _bindExportControls() {
    const btnDownloadPDF = document.getElementById('btnDownloadPDF');
    const btnDownloadJPG = document.getElementById('btnDownloadJPG');
    const btnDownloadZIP = document.getElementById('btnDownloadZIP');
    const btnBackPages   = document.getElementById('btnBackToPages');

    if (btnDownloadPDF) btnDownloadPDF.onclick = exportAsPDF;
    if (btnDownloadJPG) btnDownloadJPG.onclick = () => exportAsImages('jpeg');
    if (btnDownloadZIP) btnDownloadZIP.onclick = exportAsZIP;
    if (btnBackPages)   btnBackPages.onclick   = () => { showScreen('pages'); _renderPages(); };
  }

  async function exportAsPDF() {
    if (!state.pages.length) { toast('No pages to export', 'error'); return; }
    showProcessing('Creating PDF…');

    const { jsPDF } = window.jspdf;
    const pageSize = document.getElementById('pdfPageSize')?.value || 'a4';
    const orientation = document.getElementById('pdfOrientation')?.value || 'portrait';
    const quality = +(document.getElementById('pdfQuality')?.value || 0.92);

    try {
      const doc = new jsPDF({ orientation, unit: 'mm', format: pageSize });
      const pW = doc.internal.pageSize.getWidth();
      const pH = doc.internal.pageSize.getHeight();

      for (let i = 0; i < state.pages.length; i++) {
        const page = state.pages[i];
        if (i > 0) doc.addPage();

        // Render page to canvas at full resolution
        const c = document.createElement('canvas');
        c.width = page.croppedImg.width || page.croppedImg.naturalWidth;
        c.height = page.croppedImg.height || page.croppedImg.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(page.croppedImg, 0, 0);
        applyFilterToContext(ctx, c.width, c.height, page.filter, page.adjustments);

        const dataUrl = c.toDataURL('image/jpeg', quality);

        // Fit image to page maintaining aspect ratio
        const imgAR = c.width / c.height;
        const pageAR = pW / pH;
        let iw, ih;
        if (imgAR > pageAR) { iw = pW; ih = pW / imgAR; }
        else { ih = pH; iw = pH * imgAR; }
        const x = (pW - iw) / 2;
        const y = (pH - ih) / 2;

        doc.addImage(dataUrl, 'JPEG', x, y, iw, ih);
      }

      doc.save(`CamMaster_${Date.now()}.pdf`);
      hideProcessing();
      toast('PDF downloaded! ✓', 'success');
    } catch (e) {
      hideProcessing();
      console.error('PDF export error:', e);
      toast('PDF export failed: ' + e.message, 'error');
    }
  }

  async function exportAsImages(format) {
    if (!state.pages.length) { toast('No pages to export', 'error'); return; }

    if (state.pages.length === 1) {
      showProcessing('Preparing download…');
      const page = state.pages[0];
      const c = document.createElement('canvas');
      c.width = page.croppedImg.width || page.croppedImg.naturalWidth;
      c.height = page.croppedImg.height || page.croppedImg.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(page.croppedImg, 0, 0);
      applyFilterToContext(ctx, c.width, c.height, page.filter, page.adjustments);

      c.toBlob(blob => {
        hideProcessing();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `CamMaster_${Date.now()}.${format === 'jpeg' ? 'jpg' : format}`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('Image downloaded! ✓', 'success');
      }, 'image/' + format, format === 'jpeg' ? 0.92 : 1.0);
    } else {
      await exportAsZIP(format);
    }
  }

  async function exportAsZIP(format = 'jpeg') {
    if (!state.pages.length) { toast('No pages to export', 'error'); return; }
    showProcessing('Creating ZIP…');

    try {
      const zip = new JSZip();
      const folder = zip.folder('CamMaster');

      for (let i = 0; i < state.pages.length; i++) {
        const page = state.pages[i];
        const c = document.createElement('canvas');
        c.width = page.croppedImg.width || page.croppedImg.naturalWidth;
        c.height = page.croppedImg.height || page.croppedImg.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(page.croppedImg, 0, 0);
        applyFilterToContext(ctx, c.width, c.height, page.filter, page.adjustments);

        const blob = await new Promise(r => c.toBlob(r, 'image/' + format, format === 'jpeg' ? 0.92 : 1.0));
        const ext = format === 'jpeg' ? 'jpg' : format;
        folder.file(`page_${String(i + 1).padStart(3, '0')}.${ext}`, blob);
      }

      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `CamMaster_${Date.now()}.zip`);
      hideProcessing();
      toast('ZIP downloaded! ✓', 'success');
    } catch (e) {
      hideProcessing();
      console.error('ZIP export error:', e);
      toast('ZIP export failed', 'error');
    }
  }

  /* ── PROCESSING OVERLAY ───────────────────────────────────── */
  function showProcessing(msg) {
    const overlay = document.getElementById('processingOverlay');
    const msgEl   = document.getElementById('processingMsg');
    if (overlay) overlay.classList.add('show');
    if (msgEl)   msgEl.textContent = msg || 'Processing…';
  }
  function hideProcessing() {
    const overlay = document.getElementById('processingOverlay');
    if (overlay) overlay.classList.remove('show');
  }

  return { init, handleFiles, showScreen, showProcessing, hideProcessing, exportAsPDF, exportAsZIP };
})();

document.addEventListener('DOMContentLoaded', () => {
  ScannerApp.init();
});
