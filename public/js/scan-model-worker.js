/* Second DocAligner heatmap model on its own thread. The document worker keeps
   the light model; this helper runs the heavier one at the same time, so a
   hard photo no longer waits for ten inferences in a row. Results stream back
   per padding step and a job is dropped as soon as the light model settles. */
let session = null;
const cancelled = new Set();
self.onmessage = async ({ data }) => {
  if (data.type === 'load') {
    try {
      if (typeof ort === 'undefined') importScripts(data.ort);
      ort.env.wasm.wasmPaths = data.wasm;
      ort.env.wasm.numThreads = 1;
      session = await ort.InferenceSession.create(data.model, { executionProviders: ['wasm'] });
      self.postMessage({ type: 'loaded' });
    } catch (error) {
      self.postMessage({ type: 'loaded', error: String(error && error.message || error) });
    }
    return;
  }
  if (data.type === 'cancel') { cancelled.add(data.id); return; }
  if (data.type !== 'run') return;
  const { id, inputs, side } = data;
  for (let i = 0; i < inputs.length; i++) {
    // Yield so a cancel message for this job can arrive between inferences.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (cancelled.has(id)) break;
    try {
      const out = await session.run({ img: new ort.Tensor('float32', inputs[i], [1, 3, side, side]) });
      const heat = out.heatmap;
      if (!heat) { self.postMessage({ type: 'out', id, i, empty: true }); continue; }
      const copy = new Float32Array(heat.data);
      self.postMessage({ type: 'out', id, i, dims: heat.dims, data: copy }, [copy.buffer]);
    } catch (error) {
      self.postMessage({ type: 'out', id, i, empty: true });
    }
  }
  cancelled.delete(id);
  self.postMessage({ type: 'done', id });
};
