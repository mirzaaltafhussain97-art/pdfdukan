/* One full-resolution treatment for preview, thumbnails and every export.
   Keep only the most recent result, rather than retaining a canvas per page. */
window.ScanRenderer = (() => {
  const workerUrl = new URL('scan-filter-worker.js?v=20260908g', document.currentScript.src);
  let worker, workerFailed = false, cached, queue = Promise.resolve();

  async function process(canvas, filter, adjustments) {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || workerFailed) {
      applyFilterToContext(canvas.getContext('2d'), canvas.width, canvas.height, filter, adjustments);
      return;
    }
    try {
      worker ||= new Worker(workerUrl);
      const ctx = canvas.getContext('2d');
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Image processing timed out')), 60000);
        worker.onmessage = ({ data }) => {
          clearTimeout(timer);
          data.error ? reject(new Error(data.error)) : resolve(data);
        };
        worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
        worker.postMessage({ pixels, filter, adjustments }, [pixels.data.buffer]);
      });
      ctx.putImageData(result.pixels, 0, 0);
    } catch (error) {
      console.warn('Using local filter fallback:', error);
      worker?.terminate(); worker = null; workerFailed = true;
      // The source canvas is unchanged; never filter a partially processed result.
      applyFilterToContext(canvas.getContext('2d'), canvas.width, canvas.height, filter, adjustments);
    }
  }

  function render(image, filter, adjustments = {}, isCurrent = () => true) {
    const settings = { ...adjustments };
    const key = JSON.stringify([filter, settings.brightness || 0, settings.contrast || 0,
      settings.sharpness || 0, settings.saturation || 0]);
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
      ctx.drawImage(image, 0, 0);
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
  return { render, fit };
})();
