// filters.js has no DOM dependency in its pixel-processing functions.
self.window = self;
importScripts('filters.js?v=20260908b');
self.onmessage = ({ data: { pixels, filter, adjustments } }) => {
  try {
    const canvas = new OffscreenCanvas(pixels.width, pixels.height);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(pixels, 0, 0);
    applyFilterToContext(ctx, canvas.width, canvas.height, filter, adjustments);
    const result = ctx.getImageData(0, 0, canvas.width, canvas.height);
    self.postMessage({ pixels: result }, [result.data.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
