// filters.js has no DOM dependency in its pixel-processing functions.
self.window = self;
importScripts('filters.js?v=20261114b');
self.onmessage = async ({ data: { pixels, bitmap, filter, adjustments } }) => {
  try {
    if(['bw','bwsoft','noshadow','enhance','grayscale'].includes(filter)){
      if(!self.scanCvReady)importScripts('scan-cv-runtime.js?v=20261105_fixes');
      await self.scanCvReady;
    }
    const canvas = new OffscreenCanvas(bitmap?.width||pixels.width,bitmap?.height||pixels.height);
    const ctx = canvas.getContext('2d');
    if(bitmap)ctx.drawImage(bitmap,0,0);else ctx.putImageData(pixels, 0, 0);
    const ready=self.cvReady;if(filter==='magicpro')self.cvReady=false;
    applyFilterToContext(ctx, canvas.width, canvas.height, filter, adjustments);
    self.cvReady=ready;
    const result=canvas.transferToImageBitmap();self.postMessage({bitmap:result},[result]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }finally{bitmap?.close();}
};
