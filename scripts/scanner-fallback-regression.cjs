const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const scope = { window: {}, console };
vm.runInNewContext(fs.readFileSync('public/js/crop.js', 'utf8'), scope);
for (const [width, height] of [[540, 960], [899, 1599], [1600, 1200]]) {
  const corners = scope.window.getFallbackCorners({ width, height });
  assert.equal(corners.tl.x, 0); assert.equal(corners.tl.y, 0);
  assert.equal(corners.tr.x, width); assert.equal(corners.tr.y, 0);
  assert.equal(corners.br.x, width); assert.equal(corners.br.y, height);
  assert.equal(corners.bl.x, 0); assert.equal(corners.bl.y, height);
}
console.log('PASS: failed detection preserves the full image in portrait and landscape.');
const image = {width:1000,height:800};
const full = scope.window.getFallbackCorners(image);
assert.equal(scope._validDetectedQuad(full,image),true);
assert.equal(scope._validDetectedQuad(null,image),false);
assert.equal(scope._validDetectedQuad({...full,tl:{x:NaN,y:0}},image),false);
assert.equal(scope._validDetectedQuad({...full,tr:{x:1001,y:0}},image),false);
assert.equal(scope._validDetectedQuad({...full,tr:full.bl,bl:full.tr},image),true);
assert.equal(scope._validDetectedQuad({...full,tr:full.br,br:full.tr},image),false);
console.log('PASS: bounds, finite coordinates and convex corner ordering validated.');
