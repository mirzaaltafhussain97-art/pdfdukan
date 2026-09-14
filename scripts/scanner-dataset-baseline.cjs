// Local component baseline. Source photos are only read; artifacts stay outside public/.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { createCanvas, loadImage } = require(process.env.PDFDUKAN_CANVAS || '@napi-rs/canvas');
const source = path.resolve(process.argv[2]);
const output = path.resolve('tmp/scanner-dataset-baseline');
const scope = { window: {}, document: { createElement: () => createCanvas(1, 1) } };
for (const name of ['paper-detector', 'scan-edge-refiner']) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js', name + '.js'), 'utf8'), scope);
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const files = fs.readdirSync(source).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  const results = [];
  for (const [index, file] of files.entries()) {
    const row = { id: index + 1, file };
    try {
      const image = await loadImage(path.join(source, file));
      row.width = image.width; row.height = image.height;
      const start = performance.now();
      row.paper = scope.window.detectPaperBoundary(image, null);
      row.refined = row.paper ? scope.window.refineDocumentEdges(image, row.paper) : null;
      row.ms = Math.round(performance.now() - start);
      const ratio = Math.min(280 / image.width, 330 / image.height);
      const canvas = createCanvas(300, 370), ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 300, 370);
      ctx.drawImage(image, 10, 10, image.width * ratio, image.height * ratio);
      if (row.refined) {
        ctx.strokeStyle = '#ff2800'; ctx.lineWidth = 2; ctx.beginPath();
        ['tl', 'tr', 'br', 'bl'].forEach((k, i) => {
          const p = row.refined[k];
          ctx[i ? 'lineTo' : 'moveTo'](10 + p.x * ratio, 10 + p.y * ratio);
        });
        ctx.closePath(); ctx.stroke();
      }
      ctx.fillStyle = '#111'; ctx.font = '14px sans-serif';
      ctx.fillText(`${row.id}: ${row.paper ? 'Paper candidate' : 'No paper candidate'}`, 10, 358);
      fs.writeFileSync(path.join(output, `${row.id}.png`), canvas.toBuffer('image/png'));
    } catch (error) { row.error = error.message; }
    results.push(row);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({
      scope: 'Pale-paper component only, not the complete ML/OpenCV scanner; no accuracy labels yet',
      source, total: files.length, processed: results.length, results
    }, null, 2));
    console.log(`${row.id}/${files.length}: ${row.error || (row.paper ? 'candidate' : 'no candidate')}`);
  }
  console.log(JSON.stringify({ total: results.length, candidates: results.filter(r => r.paper).length,
    errors: results.filter(r => r.error).length, output }));
})().catch(error => { console.error(error); process.exitCode = 1; });
