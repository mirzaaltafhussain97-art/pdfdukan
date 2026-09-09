/* ================================================================
   CamMaster — Scanner Flow
   Upload → Crop → Filter → Pages → Export
================================================================ */

const ScannerApp = (() => {

  const LIB_URLS = {
    pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    sortable: 'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.14.0/Sortable.min.js',
  };

  async function _ensureLibrary(url, isReady, label) {
    if (isReady()) return;
    if (!window.loadScriptOnce) throw new Error(label + ' loader is unavailable');
    await window.loadScriptOnce(url);
    if (!isReady()) throw new Error(label + ' could not initialize');
  }

  async function _ensurePdfJs() {
    await _ensureLibrary(LIB_URLS.pdfjs, () => !!window.pdfjsLib, 'PDF import');
    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  }

  const _ensureJsPdf = () => _ensureLibrary(LIB_URLS.jspdf, () => !!window.jspdf?.jsPDF, 'PDF export');
  const _ensureZip = () => _ensureLibrary(LIB_URLS.jszip, () => typeof window.JSZip !== 'undefined', 'ZIP export');
  const _ensureSortable = () => _ensureLibrary(LIB_URLS.sortable, () => typeof window.Sortable !== 'undefined', 'Page reorder');

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
    quickScan: false,
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
      const uploadZone = document.getElementById('uploadZone');
      ['pointerdown', 'dragover', 'keydown', 'touchstart'].forEach(ev =>
        uploadZone?.addEventListener(ev, warm, { once: true, passive: true }));
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
    const quickInput = document.getElementById('fileInputQuickScan');
    if (quickInput) quickInput.addEventListener('change', e => { handleFiles([...e.target.files], true); e.target.value = ''; });

    // PDF import input (separate input for accept=".pdf")
    const pdfInput = document.getElementById('fileInputPdfScan');
    if (pdfInput) pdfInput.addEventListener('change', e => handleFiles([...e.target.files]));
  }

  function handleFiles(files, quickScan = false) {
    if (!files.length) return;
    // Signup optional — no login gate; process files for everyone.
    state.queue = files.map(f => ({ file: f, type: f.type }));
    state.queueIndex = 0;
    state.editingIndex = -1;
    state.quickScan = quickScan;
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
      showProcessing('Loading PDF engine…');
      await _ensurePdfJs();
      showProcessing('Rendering PDF pages…');
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
      catch (e) { console.warn('Document detection failed:', e); cropEditor.setImage(img); }   // hard fallback
      hideProcessing();
      if (state.quickScan && cropEditor.autoDetected) {
        await _applyCrop();
        return;
      }
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
      // Skip really keeps the complete image, including the chosen rotation.
      const img = cropEditor._getRotatedImg();
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
      state.currentFilter = state.quickScan ? 'magicpro' : 'enhance';
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
    const rail=document.getElementById('scanPageRail');
    if(rail){
      rail.replaceChildren();
      const currentNumber=state.editingIndex>=0?state.editingIndex+1:state.pages.length+1;
      const pages=state.pages.map((page,i)=>({image:page.croppedImg,number:i+1}));
      if(state.editingIndex<0)pages.push({image:croppedImg,number:currentNumber});
      pages.forEach(page=>{
        const item=document.createElement('div');item.className='scan-rail-page'+(page.number===currentNumber?' current':'');
        const thumb=document.createElement('canvas');ScanRenderer.fit(page.number===currentNumber?croppedImg:page.image,thumb,70,100);
        item.append(thumb,document.createTextNode('Page '+page.number));
        if(page.number===currentNumber)item.setAttribute('aria-current','page');
        rail.append(item);
      });
    }
    buildFilterStrip('filterStrip', croppedImg, state.currentFilter, fid => {
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

  let previewVersion = 0, previewTimer;
  function _reprocess() {
    const version = ++previewVersion;
    clearTimeout(previewTimer);
    const status = document.getElementById('scanPreviewStatus');
    if (status) status.textContent = 'Preparing full-quality preview…';
    const canvas = document.getElementById('previewCanvas');
    if (canvas) canvas.style.opacity = '.45';
    const doneButtons = ['btnAddPage', 'btnAddPageMain', 'btnBatchAll'];
    doneButtons.forEach(id => { const button = document.getElementById(id); if (button) button.disabled = true; });
    previewTimer = setTimeout(async () => {
      try {
        const result = await ScanRenderer.render(state._currentCropped, state.currentFilter, state.adjustments, () => version === previewVersion);
        if (!result || version !== previewVersion) return;
        ScanRenderer.fit(result, canvas, 1320, 1000);
        canvas.style.opacity = '1';
        const mini = document.getElementById('procMini');
        if (mini) ScanRenderer.fit(result, mini, 280, 200);
        doneButtons.forEach(id => { const button = document.getElementById(id); if (button) button.disabled = false; });
        if (status) status.textContent = 'Ready to save · Check the text and edges before continuing.';
      } catch (error) {
        if (version !== previewVersion) return;
        if (status) status.textContent = 'Preview failed. Please retry or choose Original.';
        toast(error.message, 'error');
      }
    }, 140);
  }

  function _backToCrop(restore = false) {
    // Restore this page's source and corners, never another page's crop state.
    const saved = state.editingIndex >= 0 ? state.pages[state.editingIndex].cropState : null;
    if (restore === true && saved) {
      cropEditor.img = saved.img;
      cropEditor.rotation = saved.rotation;
      cropEditor.corners = JSON.parse(JSON.stringify(saved.corners));
      cropEditor.draw();
    } else if (restore === true && state.editingIndex >= 0) {
      cropEditor.setImage(state._currentCropped);
      cropEditor.fitFull();
    }
    showScreen('crop');
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
    if (btnBackCrop)     btnBackCrop.onclick     = _backToCrop;
    if (btnBackCropMain) btnBackCropMain.onclick = _backToCrop;
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

    const wasEditing = state.editingIndex >= 0;
    const cropState = { img: cropEditor.img, rotation: cropEditor.rotation, corners: JSON.parse(JSON.stringify(cropEditor.corners)) };
    if (wasEditing) {
      state.pages[state.editingIndex].cropState = cropState;
      // Update existing page
      state.pages[state.editingIndex].croppedImg  = img;
      state.pages[state.editingIndex].filter      = state.currentFilter;
      state.pages[state.editingIndex].adjustments = { ...state.adjustments };
      state.editingIndex = -1;
    } else {
      state.pages.push({
        id: Date.now() + Math.random(),
        croppedImg: img,
        cropState,
        filter: state.currentFilter,
        adjustments: { ...state.adjustments },
      });
    }

    if (!wasEditing) state.queueIndex++;
    if (!wasEditing && state.queueIndex < state.queue.length) {
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
      ScanRenderer.render(page.croppedImg, page.filter, page.adjustments).then(result => {
        if (c.isConnected) ScanRenderer.fit(result, c, 160, 180);
      }).catch(error => { if (c.isConnected) c.replaceWith(document.createTextNode('Preview unavailable')); console.warn(error); });
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

    // Load drag-reorder only when the pages screen is actually used.
    if (!grid._pdfDukanSortable) {
      _ensureSortable().then(() => {
        if (!grid.isConnected || grid._pdfDukanSortable) return;
        grid._pdfDukanSortable = Sortable.create(grid, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: e => {
          const moved = state.pages.splice(e.oldIndex, 1)[0];
          state.pages.splice(e.newIndex, 0, moved);
        },
      });
      }).catch(error => console.warn('Page reorder library could not load:', error));
    }
  }

  // Export one page (with its filter/adjustments applied) as a standalone JPG,
  // so multi-page scans don't force a ZIP download for a single page.
  async function _downloadPage(idx) {
    const page = state.pages[idx];
    if (!page) return;
    try {
      const blob = await _pageToBlob(page, 'jpeg');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'PDFdukan.com_page_' + (idx + 1) + '.jpg';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Page downloaded', 'success');
    } catch (error) { toast('Download failed: ' + error.message, 'error'); }
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
    _backToCrop(true);
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
    const jpgButton = document.getElementById('btnDownloadJPG');
    const zipButton = document.getElementById('btnDownloadZIP');
    const isMultiPage = state.pages.length > 1;
    if (jpgButton) jpgButton.style.display = isMultiPage ? 'none' : '';
    if (zipButton) zipButton.style.display = isMultiPage ? '' : 'none';
    _updateImageExportLabels();
  }

  function _selectedImageFormat() {
    return document.getElementById('imageExportFormat')?.value === 'png' ? 'png' : 'jpeg';
  }

  function _updateImageExportLabels() {
    const format = _selectedImageFormat();
    const label = format === 'png' ? 'PNG' : 'JPG';
    const imageButton = document.getElementById('btnDownloadJPG');
    const zipButton = document.getElementById('btnDownloadZIP');
    if (imageButton) imageButton.innerHTML = `<span>🖼️</span> Download ${label}`;
    if (zipButton) zipButton.innerHTML = `<span>📦</span> Download ${label} ZIP (all pages)`;
  }

  function _bindExportControls() {
    const btnDownloadPDF = document.getElementById('btnDownloadPDF');
    const btnDownloadJPG = document.getElementById('btnDownloadJPG');
    const btnDownloadZIP = document.getElementById('btnDownloadZIP');
    const btnBackPages   = document.getElementById('btnBackToPages');
    const imageFormat    = document.getElementById('imageExportFormat');

    if (btnDownloadPDF) btnDownloadPDF.onclick = exportAsPDF;
    if (btnDownloadJPG) btnDownloadJPG.onclick = () => exportAsImages(_selectedImageFormat());
    if (btnDownloadZIP) btnDownloadZIP.onclick = () => exportAsZIP(_selectedImageFormat());
    if (btnBackPages)   btnBackPages.onclick   = () => { showScreen('pages'); _renderPages(); };
    if (imageFormat) imageFormat.onchange = _updateImageExportLabels;
  }

  async function exportAsPDF() {
    if (!state.pages.length) { toast('No pages to export', 'error'); return; }
    showProcessing('Creating PDF…');

    const pageSize = document.getElementById('pdfPageSize')?.value || 'a4';
    const orientation = document.getElementById('pdfOrientation')?.value || 'portrait';
    const quality = +(document.getElementById('pdfQuality')?.value || 0.97);

    try {
      showProcessing('Loading PDF export engine…');
      await _ensureJsPdf();
      showProcessing('Creating PDF…');
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation, unit: 'mm', format: pageSize });
      const pW = doc.internal.pageSize.getWidth();
      const pH = doc.internal.pageSize.getHeight();

      for (let i = 0; i < state.pages.length; i++) {
        const page = state.pages[i];
        if (i > 0) doc.addPage();

        const c = await ScanRenderer.render(page.croppedImg, page.filter, page.adjustments);

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

      doc.save(`PDFdukan.com_${Date.now()}.pdf`);
      hideProcessing();
      toast('PDF downloaded! ✓', 'success');
    } catch (e) {
      hideProcessing();
      console.error('PDF export error:', e);
      toast('PDF export failed: ' + e.message, 'error');
    }
  }

  // Render one page (cropped + filtered) to an image blob.
  async function _pageToBlob(page, format) {
    const c = await ScanRenderer.render(page.croppedImg, page.filter, page.adjustments);
    return await new Promise((resolve, reject) => c.toBlob(blob => blob ? resolve(blob) : reject(new Error('The browser could not encode a scan page.')), 'image/' + format, format === 'jpeg' ? 0.95 : 1.0));
  }

  // Strip illegal filename characters and any extension the user typed.
  function _sanitizeBaseName(name, fallback) {
    const cleaned = (name || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\.(jpe?g|png|zip)$/i, '');
    return cleaned || fallback;
  }

  // Export pages as images. Browsers block multiple automatic downloads, so a
  // single page downloads directly while multiple pages are bundled into ONE ZIP
  // (named "<base>.zip") with files auto-numbered "<base>_01.jpg", "<base>_02.jpg"…
  // — this is the only reliable way to get every page in a single download.
  async function exportAsImages(format) {
    if (!state.pages.length) { toast('No pages to export', 'error'); return; }
    const ext = format === 'jpeg' ? 'jpg' : format;
    const multi = state.pages.length > 1;
    const fallback = 'PDFdukan.com_' + new Date().toISOString().slice(0, 10);

    // Ask for a file name; the rest are auto-numbered in the same pattern.
    const promptMsg = multi
      ? `Enter a file name for your ${state.pages.length} images.\n\n` +
        `They will be saved together in one ZIP as:\n` +
        `"<name>_01.${ext}", "<name>_02.${ext}", …`
      : `Enter a file name for your image:`;
    const input = prompt(promptMsg, fallback);
    if (input === null) return; // user cancelled
    const base = _sanitizeBaseName(input, fallback);

    showProcessing(multi ? `Packaging ${state.pages.length} ${ext.toUpperCase()} images…` : 'Preparing download…');
    try {
      if (!multi) {
        const blob = await _pageToBlob(state.pages[0], format);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${base}.${ext}`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        hideProcessing();
        toast('Image downloaded! ✓', 'success');
        return;
      }

      // Multiple pages → one ZIP so they all download together, every page named
      // in the same pattern. padStart width grows with page count (01.. / 001..).
      showProcessing('Loading ZIP engine…');
      await _ensureZip();
      const zip = new JSZip();
      const pad = Math.max(2, String(state.pages.length).length);
      for (let i = 0; i < state.pages.length; i++) {
        const blob = await _pageToBlob(state.pages[i], format);
        zip.file(`${base}_${String(i + 1).padStart(pad, '0')}.${ext}`, blob);
      }
      const content = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, meta => {
        showProcessing(`Packaging ${state.pages.length} ${ext.toUpperCase()} images… ${Math.round(meta.percent)}%`);
      });
      const zipUrl = URL.createObjectURL(content);
      const zipLink = document.createElement('a');
      zipLink.href = zipUrl; zipLink.download = `${base}.zip`;
      document.body.appendChild(zipLink); zipLink.click(); document.body.removeChild(zipLink);
      setTimeout(() => URL.revokeObjectURL(zipUrl), 4000);
      hideProcessing();
      toast(`${state.pages.length} ${ext.toUpperCase()} images downloaded as ${base}.zip ✓`, 'success');
    } catch (e) {
      hideProcessing();
      console.error('Image export error:', e);
      toast('Image export failed', 'error');
    }
  }

  async function exportAsZIP(format = 'jpeg') {
    if (!state.pages.length) { toast('No pages to export', 'error'); return; }
    showProcessing('Creating ZIP…');

    try {
      await _ensureZip();
      const zip = new JSZip();
      const folder = zip.folder('CamMaster');

      for (let i = 0; i < state.pages.length; i++) {
        const page = state.pages[i];
        const blob = await _pageToBlob(page, format);
        const ext = format === 'jpeg' ? 'jpg' : format;
        folder.file(`page_${String(i + 1).padStart(3, '0')}.${ext}`, blob);
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = `PDFdukan.com_${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
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
    if (typeof showBrandLoader === 'function') {
      showBrandLoader(msg || 'Processing…', 'PDFdukan · CamMaster');
      return;
    }
    const overlay = document.getElementById('processingOverlay');
    const msgEl   = document.getElementById('processingMsg');
    if (overlay) overlay.classList.add('show');
    if (msgEl)   msgEl.textContent = msg || 'Processing…';
  }
  function hideProcessing() {
    if (typeof hideBrandLoader === 'function') hideBrandLoader();
    const overlay = document.getElementById('processingOverlay');
    if (overlay) overlay.classList.remove('show');
  }

  return { init, handleFiles, showScreen, showProcessing, hideProcessing, exportAsPDF, exportAsZIP };
})();

document.addEventListener('DOMContentLoaded', () => {
  ScannerApp.init();
});
