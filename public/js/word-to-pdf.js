/* PDFdukan Word to PDF — high-fidelity, browser-local conversion controller. */
(function () {
  'use strict';

  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const A4 = { width: 595.2756, height: 841.8898 };
  const MAX_FILE_BYTES = 50 * 1024 * 1024;

  let pdfBlob = null;
  let pdfUrl = null;
  let docxBytes = null;
  let fileName = 'document';
  let paper = { ...A4 };
  let enginePromise = null;
  let engine = null;
  let engineResolve = null;
  let engineReject = null;

  function byId(id) { return document.getElementById(id); }

  function notify(message, type) {
    if (typeof window.toast === 'function') window.toast(message, type || 'success');
  }

  function progress(percent, message) {
    const card = byId('progressCard');
    const fill = byId('progressFill');
    const label = byId('progressLabel');
    if (card) card.style.display = '';
    if (fill) fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
    if (label) label.textContent = message;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }

  function wordAttr(element, name) {
    if (!element) return null;
    return element.getAttributeNS(W_NS, name) || element.getAttribute('w:' + name) || element.getAttribute(name);
  }

  function parseXml(text) {
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new Error('Invalid DOCX XML.');
    return xml;
  }

  async function inspectDocx(arrayBuffer) {
    const zip = await window.JSZip.loadAsync(arrayBuffer);
    const documentEntry = zip.file('word/document.xml');
    if (!documentEntry) throw new Error('This file is not a valid DOCX document.');

    const documentText = await documentEntry.async('text');
    const documentXml = parseXml(documentText);
    const sections = Array.from(documentXml.getElementsByTagNameNS(W_NS, 'sectPr'));
    const finalSection = sections[sections.length - 1];
    const pageSize = finalSection && finalSection.getElementsByTagNameNS(W_NS, 'pgSz')[0];
    const widthTwips = Number(wordAttr(pageSize, 'w'));
    const heightTwips = Number(wordAttr(pageSize, 'h'));
    if (widthTwips > 0 && heightTwips > 0) {
      paper = { width: widthTwips / 20, height: heightTwips / 20 };
    } else {
      paper = { ...A4 };
    }

    const complexFeatures = [];
    if (documentText.includes('<w:txbxContent')) complexFeatures.push('text boxes');
    if (documentText.includes('<wp:anchor')) complexFeatures.push('floating images');
    if (documentText.includes('<v:shape') || documentText.includes('<w:pict')) complexFeatures.push('shapes');
    return complexFeatures;
  }

  async function renderContentCheck(arrayBuffer) {
    const preview = byId('docPreview');
    if (!preview || !window.mammoth) return;
    try {
      const result = await window.mammoth.convertToHtml({ arrayBuffer }, {
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          'b => strong',
          'i => em',
        ],
        convertImage: window.mammoth.images.imgElement(image => image.read('base64').then(base64 => ({
          src: 'data:' + image.contentType + ';base64,' + base64,
        }))),
      });
      preview.innerHTML = result.value || '<p style="color:#777">No flowing text was found. The office engine will still inspect shapes and images.</p>';
    } catch {
      preview.innerHTML = '<p style="color:#777">Content preview is unavailable. You can still run the high-fidelity conversion.</p>';
    }
  }

  async function loadFile(files) {
    const file = Array.from(files || []).find(item =>
      /\.docx$/i.test(item.name) || item.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    if (!file) {
      notify('Please choose a .docx Word document.', 'error');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      notify('This DOCX is over 50 MB. Use a smaller file to avoid exhausting browser memory.', 'error');
      return;
    }

    resetResultOnly();
    fileName = file.name.replace(/\.docx$/i, '');
    progress(12, 'Reading DOCX structure locally...');

    try {
      const source = await file.arrayBuffer();
      docxBytes = source.slice(0);
      const features = await inspectDocx(source.slice(0));
      progress(55, 'Checking content and page settings...');
      // Only the generated PDF is a layout preview.

      byId('wtpFileName').textContent = file.name;
      byId('wtpFileSize').textContent = formatBytes(file.size) + ' · DOCX';

      const note = byId('engineNote');
      if (note) {
        const detected = features.length ? ' Detected: ' + features.join(', ') + '.' : '';
        note.innerHTML = '<strong>High-fidelity local conversion:</strong> this document is sent to the preview server on this computer and converted with the best installed office engine.' + detected + ' Temporary conversion files are removed afterward.';
      }

      progress(100, 'Ready for high-fidelity conversion');
      byId('progressCard').style.display = 'none';
      byId('settingsCard').style.display = '';
      byId('convertBtn').disabled = false;
      notify('DOCX checked. Run the high-fidelity conversion and inspect the PDF preview.', 'success');
    } catch (error) {
      console.error(error);
      byId('progressCard').style.display = 'none';
      docxBytes = null;
      notify('Could not read this DOCX: ' + error.message, 'error');
    }
  }

  function loadEngine() {
    if (enginePromise) return enginePromise;
    enginePromise = new Promise(async (resolve, reject) => {
      let settled = false;
      const onUnhandledRejection = event => {
        const reason = event.reason;
        const message = reason && reason.message ? reason.message : String(reason || '');
        if (!/wasm|fetch|network|abort/i.test(message)) return;
        event.preventDefault();
        fail(new Error('The office engine download was interrupted. Reload the page and try again on a stable connection.'));
      };
      const cleanup = () => {
        clearTimeout(loadTimer);
        window.removeEventListener('unhandledrejection', onUnhandledRejection);
      };
      const fail = error => {
        if (settled) return;
        settled = true;
        cleanup();
        enginePromise = null;
        reject(error instanceof Error ? error : new Error(String(error || 'Office engine loading failed.')));
      };
      const loadTimer = setTimeout(() => {
        fail(new Error('Office engine loading timed out. Check your connection, then reload the page and try again.'));
      }, 180000);
      window.addEventListener('unhandledrejection', onUnhandledRejection);

      try {
        progress(18, 'Loading full office engine — first use can take 30–90 seconds...');
        const module = await import('https://cdn.jsdelivr.net/npm/zetajs@1.2.0/source/zetaHelper.js');
        const workerUrl = new URL('/js/word-to-pdf-worker.js?v=20260914b', location.origin).href;
        const runtimeUrl = 'https://cdn.zetaoffice.net/zetaoffice_latest/';
        const loadOfficeRuntime = new Promise((resolve, reject) => {
          const existing = Array.from(document.scripts).find(script => script.src === runtimeUrl + 'soffice.js');
          if (existing) { resolve(); return; }
          const script = document.createElement('script');
          script.src = runtimeUrl + 'soffice.js';
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('The office runtime could not be downloaded. Check the connection or CDN availability.'));
          document.head.appendChild(script);
        });
        await loadOfficeRuntime;
        const helper = new module.ZetaHelperMain(workerUrl, {
          threadJsType: 'module',
          wasmPkg: 'free',
        });
        helper.Module.onAbort = reason => {
          fail(new Error('The office engine stopped while loading: ' + String(reason || 'download interrupted.')));
        };
        helper.start(() => {
          helper.thrPort.onmessage = event => {
            if (event.data.cmd === 'start') {
              if (settled) return;
              settled = true;
              cleanup();
              engine = helper;
              progress(45, 'Office engine ready. Opening DOCX...');
              resolve(helper);
              return;
            }
            if (event.data.cmd === 'converted' && engineResolve) {
              const done = engineResolve;
              engineResolve = null;
              engineReject = null;
              done(event.data);
              return;
            }
            if (event.data.cmd === 'error' && engineReject) {
              const fail = engineReject;
              engineResolve = null;
              engineReject = null;
              fail(new Error(event.data.message || 'The office engine could not convert this DOCX.'));
            }
          };
        });
        const officeScript = Array.from(document.scripts).find(script => script.src === runtimeUrl + 'soffice.js');
        if (officeScript) {
          officeScript.addEventListener('load', () => {
            const runtimePromise = helper.Module && helper.Module.uno_main;
            if (runtimePromise && typeof runtimePromise.catch === 'function') {
              runtimePromise.catch(error => fail(error));
            }
          }, { once: true });
          officeScript.addEventListener('error', () => {
            fail(new Error('The office engine could not be downloaded. Check your connection, then reload the page.'));
          }, { once: true });
        }
      } catch (error) {
        fail(error);
      }
    });
    return enginePromise;
  }

  function convertWithEngine(helper, forcedFitFactor) {
    return new Promise((resolve, reject) => {
      engineResolve = resolve;
      engineReject = reject;
      const inputPath = '/tmp/pdfdukan-input.docx';
      const outputPath = '/tmp/pdfdukan-output.pdf';
      try { window.FS.unlink(inputPath); } catch {}
      try { window.FS.unlink(outputPath); } catch {}
      window.FS.writeFile(inputPath, new Uint8Array(docxBytes));
      helper.thrPort.postMessage({
        cmd: 'convert',
        name: fileName,
        from: inputPath,
        to: outputPath,
        targetPages: 0,
        forcedFitFactor: forcedFitFactor || 0,
      });
    });
  }

  function takeEnginePdf(result) {
    const bytes = new Uint8Array(window.FS.readFile(result.to));
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    try { window.FS.unlink(result.from); } catch {}
    try { window.FS.unlink(result.to); } catch {}
    return copy;
  }

  async function pdfPageCount(bytes) {
    const source = await window.PDFLib.PDFDocument.load(bytes);
    return source.getPageCount();
  }

  async function normalisePaperSize(bytes) {
    const PDFDocument = window.PDFLib.PDFDocument;
    const source = await PDFDocument.load(bytes);
    const output = await PDFDocument.create();
    const title = fileName + '.pdf';
    output.setTitle(title);
    output.setCreator('PDFdukan high-fidelity Word to PDF');
    output.setProducer('ZetaOffice 24.2 + PDFdukan');

    for (let index = 0; index < source.getPageCount(); index += 1) {
      const sourcePage = source.getPage(index);
      const embedded = await output.embedPage(sourcePage);
      const sourceSize = sourcePage.getSize();
      const scale = Math.min(paper.width / sourceSize.width, paper.height / sourceSize.height);
      const drawWidth = sourceSize.width * scale;
      const drawHeight = sourceSize.height * scale;
      const page = output.addPage([paper.width, paper.height]);
      page.drawPage(embedded, {
        x: (paper.width - drawWidth) / 2,
        y: paper.height - drawHeight,
        width: drawWidth,
        height: drawHeight,
      });
    }
    return new Uint8Array(await output.save({ useObjectStreams: true }));
  }

  async function convert() {
    const button = byId('convertBtn');
    if (!docxBytes) {
      notify('Choose a DOCX file first.', 'error');
      return;
    }
    button.disabled = true;
    button.textContent = '⏳ High-fidelity conversion...';
    byId('resultSection').style.display = 'none';

    try {
      progress(20, 'Checking the local office converter...');
      let healthData = null;
      try {
        const health = await fetch('/api/word-to-pdf', { cache: 'no-store' });
        if (health.ok) healthData = await health.json();
      } catch (_) { /* Hosted static deployments use the browser engine below. */ }

      let bytes, engineLabel;
      if (healthData && healthData.ready) {
        engineLabel = healthData.label || 'Office engine';
        progress(45, engineLabel + ' is rendering your document...');
        const response = await fetch('/api/word-to-pdf', {
          method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, body: docxBytes
        });
        if (!response.ok) throw new Error((await response.json()).error || 'Conversion failed.');
        bytes = new Uint8Array(await response.arrayBuffer());
      } else {
        engineLabel = 'Browser office engine';
        progress(30, 'Loading the browser office engine...');
        const helper = await loadEngine();
        progress(65, 'Browser office engine is rendering your document...');
        bytes = takeEnginePdf(await convertWithEngine(helper, 0));
      }
      const pages = await pdfPageCount(bytes);

      // Keep the office engine's native page geometry. Re-embedding every
      // page onto A4 changes margins, apparent font sizes, column widths and
      // image coordinates.
      progress(90, 'Preserving the original Word page geometry...');
      pdfBlob = new Blob([bytes], { type: 'application/pdf' });
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      pdfUrl = URL.createObjectURL(pdfBlob);
      byId('pdfPreview').src = pdfUrl + '#view=FitH';

      byId('resultMeta').innerHTML = '<strong>Native layout check:</strong> ' + engineLabel + ' generated ' + pages +
        ' page' + (pages === 1 ? '' : 's') + ' using the document\'s own page geometry. Review the actual PDF preview before important use.';

      progress(100, 'PDF ready');
      byId('progressCard').style.display = 'none';
      byId('resultSection').style.display = '';
      byId('resultSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
      notify('High-fidelity PDF created. Please inspect the preview.', 'success');
    } catch (error) {
      console.error(error);
      byId('progressCard').style.display = 'none';
      notify('Conversion failed: ' + (error.message || 'Unknown error.'), 'error');
    } finally {
      button.disabled = false;
      button.textContent = '📄 High-Fidelity Convert';
    }
  }

  function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function download() {
    if (!pdfBlob) {
      notify('No PDF is ready yet.', 'error');
      return;
    }
    const defaultName = fileName + '_converted.pdf';
    const finish = chosenName => {
      if (!chosenName) return;
      triggerDownload(pdfBlob, chosenName);
      if (window.CMLogs) window.CMLogs.log({
        tool: 'Word to PDF', action: 'convert', input: fileName + '.docx', output: chosenName, size: pdfBlob.size,
      });
      notify('PDF downloaded.', 'success');
    };
    if (window.CMFilename) window.CMFilename.prompt(defaultName).then(finish);
    else finish(defaultName);
  }

  function resetResultOnly() {
    pdfBlob = null;
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = null;
    if (byId('pdfPreview')) byId('pdfPreview').removeAttribute('src');
    if (byId('resultSection')) byId('resultSection').style.display = 'none';
  }

  function reset() {
    resetResultOnly();
    docxBytes = null;
    paper = { ...A4 };
    byId('settingsCard').style.display = 'none';
    byId('docPreview').innerHTML = '';
    byId('fileInput').value = '';
    byId('convertBtn').disabled = true;
    notify('Ready for a new DOCX document.', 'success');
  }

  function init() {
    const zone = byId('dropZone');
    const input = byId('fileInput');
    if (!zone || !input) return;
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        input.click();
      }
    });
    ['dragenter', 'dragover'].forEach(name => zone.addEventListener(name, event => {
      event.preventDefault();
      zone.classList.add('drag');
    }));
    ['dragleave', 'drop'].forEach(name => zone.addEventListener(name, event => {
      event.preventDefault();
      zone.classList.remove('drag');
    }));
    zone.addEventListener('drop', event => loadFile(event.dataTransfer.files));
    input.addEventListener('change', event => loadFile(event.target.files));
  }

  window.WordToPDF = { init, loadFile, convert, download, reset };
  document.addEventListener('DOMContentLoaded', init);
})();
