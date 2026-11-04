/* Bounded interactive previews; exports always render the full source size. */
window.ScanRenderer = (() => {
  const workerUrl = new URL('scan-filter-worker.js?v=20261104_autocrop', document.currentScript.src);
  let worker, workerFailed = false, cached, queue = Promise.resolve();
  let previewImage, previewSource, previewCache = [];
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
  async function preview(image, filter, adjustments = {}, isCurrent = () => true) {
    if (!isCurrent()) return null;
    const settings = { ...adjustments }, key = settingsKey(filter, settings);
    if (previewImage !== image) {
      // Keep only one page's source and four recent treatments in memory.
      previewImage = image; previewCache = [];
      const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
      const scale = Math.min(1, 1400 / Math.max(w, h), Math.sqrt(1_400_000 / (w*h)));
      if (scale === 1) previewSource = image;
      else {
        previewSource = document.createElement('canvas');
        previewSource.width = Math.max(1, Math.round(w*scale));
        previewSource.height = Math.max(1, Math.round(h*scale));
        previewSource.getContext('2d').drawImage(image, 0, 0, previewSource.width, previewSource.height);
      }
    }
    const hit = previewCache.find(entry => entry.key === key);
    if (hit) return hit.canvas;
    const result = await render(previewSource, filter, settings, isCurrent);
    if (result && isCurrent() && previewImage === image) {
      previewCache = [{key, canvas:result}, ...previewCache.filter(entry => entry.key !== key)].slice(0,4);
    }
    return result;
  }
  function warmup(){
    if(typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined')return Promise.resolve();
    // Compile the filter runtime before the first treatment click. A single
    // transparent pixel keeps this background preparation cheap to transfer.
    const pixel=document.createElement('canvas');pixel.width=pixel.height=1;
    return render(pixel,'enhance').then(()=>{});
  }
  return { render, preview, fit, warmup };
})();
