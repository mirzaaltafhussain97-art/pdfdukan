/* Bounded interactive previews; exports always render the full source size. */
window.ScanRenderer = (() => {
  const workerUrl = new URL('scan-filter-worker.js?v=20261126a', document.currentScript.src);
  let worker, workerFailed = false, cached, queue = Promise.resolve();
  let previewCache = [];
  const settingsKey = (filter, settings) => JSON.stringify([!!window.cvReady, filter,
    settings.brightness || 0, settings.contrast || 0, settings.sharpness || 0, settings.saturation || 0]);

  async function process(canvas, filter, adjustments) {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || workerFailed) {
      applyFilterToContext(canvas.getContext('2d'), canvas.width, canvas.height, filter, adjustments);
      return;
    }
    try {
      worker ||= new Worker(workerUrl);
      const ctx = canvas.getContext('2d');
      const bitmap = typeof createImageBitmap==='function'?await createImageBitmap(canvas):null;
      const pixels = bitmap?null:ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Image processing timed out')), 60000);
        worker.onmessage = ({ data }) => {
          clearTimeout(timer);
          data.error ? reject(new Error(data.error)) : resolve(data);
        };
        worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
        worker.postMessage({ pixels, bitmap, filter, adjustments }, bitmap?[bitmap]:[pixels.data.buffer]);
      });
      if(result.bitmap){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(result.bitmap,0,0);result.bitmap.close();}
      else ctx.putImageData(result.pixels, 0, 0);
    } catch (error) {
      console.warn('Using local filter fallback:', error);
      worker?.terminate(); worker = null; workerFailed = true;
      // The source canvas is unchanged; never filter a partially processed result.
      applyFilterToContext(canvas.getContext('2d'), canvas.width, canvas.height, filter, adjustments);
    }
  }

  function render(image, filter, adjustments = {}, isCurrent = () => true) {
    const settings = { ...adjustments };
    const key = settingsKey(filter, settings);
    const task = queue.then(async () => {
      // Rapid filter/slider changes can queue work behind the worker. Discard
      // superseded previews before allocating or processing full-size pixels.
      if (!isCurrent()) return null;
      if (cached?.image === image && cached.key === key) return cached.canvas;
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      if (!canvas.width || !canvas.height) throw new Error('The scan image is not ready.');
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      // Original with neutral controls already has exactly the requested pixels.
      // Avoid a full-image readback, worker transfer and writeback in this case.
      if (filter !== 'original' || settings.brightness || settings.contrast ||
          settings.sharpness || settings.saturation) {
        await process(canvas, filter, settings);
      }
      cached = { image, key, canvas };
      return canvas;
    });
    queue = task.catch(() => {});
    return task;
  }

  function fit(source, target, width, height) {
    const scale = Math.min(width / source.width, height / source.height, 1);
    target.width = Math.max(1, Math.round(source.width * scale));
    target.height = Math.max(1, Math.round(source.height * scale));
    target.getContext('2d').drawImage(source, 0, 0, target.width, target.height);
  }
  // Filtered previews of the last few pages stay ready, so moving between
  // pages (wheel, swipe, page list) shows the treated page at once instead of
  // the untreated photo while the filter runs again.
  const PREVIEW_KEEP = 8, inflight = [];
  let sourceOf = { image: null, source: null };
  function remember(image, key, canvas) {
    previewCache = [{ image, key, canvas }, ...previewCache.filter(e => !(e.image === image && e.key === key))].slice(0, PREVIEW_KEEP);
  }
  function peek(image, filter, adjustments = {}) {
    if (!image) return null;
    const key = settingsKey(filter, { ...adjustments }), hit = previewCache.find(e => e.image === image && e.key === key);
    if (hit) remember(image, key, hit.canvas);
    return hit ? hit.canvas : null;
  }
  function sourceFor(image) {
    if (sourceOf.image === image) return sourceOf.source;
    const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
    const scale = Math.min(1, 1400 / Math.max(w, h), Math.sqrt(1_400_000 / (w*h)));
    let source = image;
    if (scale < 1) {
      source = document.createElement('canvas');
      source.width = Math.max(1, Math.round(w*scale));
      source.height = Math.max(1, Math.round(h*scale));
      source.getContext('2d').drawImage(image, 0, 0, source.width, source.height);
    }
    sourceOf = { image, source };
    return source;
  }
  async function preview(image, filter, adjustments = {}, isCurrent = () => true) {
    if (!isCurrent()) return null;
    const settings = { ...adjustments }, key = settingsKey(filter, settings);
    const hit = peek(image, filter, settings);
    if (hit) return hit;
    // One job per page and treatment: a page prefetched in the background and
    // then opened by the user is rendered once, not twice.
    let job = inflight.find(j => j.image === image && j.key === key);
    if (!job) {
      job = { image, key, askers: [] };
      job.promise = render(sourceFor(image), filter, settings, () => job.askers.some(f => f()))
        .then(result => { if (result) remember(image, key, result); return result; })
        .finally(() => { const i = inflight.indexOf(job); if (i >= 0) inflight.splice(i, 1); });
      inflight.push(job);
    }
    job.askers.push(isCurrent);
    const result = await job.promise;
    // skipped while nobody wanted it, but wanted again now: render it
    if (!result && isCurrent()) return preview(image, filter, adjustments, isCurrent);
    return result;
  }
  function warmup(){
    if(typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined')return Promise.resolve();
    // Compile the filter runtime before the first treatment click. A single
    // transparent pixel keeps this background preparation cheap to transfer.
    const pixel=document.createElement('canvas');pixel.width=pixel.height=1;
    return render(pixel,'enhance').then(()=>{});
  }
  return { render, preview, peek, fit, warmup };
})();
