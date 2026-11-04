const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const width = 640, height = 800;
const truth = {tl:{x:80,y:90},tr:{x:560,y:90},br:{x:560,y:710},bl:{x:80,y:710}};
const inner = {tl:{x:100,y:240},tr:{x:540,y:240},br:{x:540,y:580},bl:{x:100,y:580}};
function select(blank, initial, cvScore) {
  const pixels = new Uint8ClampedArray(width*height*4);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const inside=x>=80&&x<=560&&y>=90&&y<=710;
    const value=x>290&&x<345?75:220;
    const color=blank?[180,180,180]:inside?[value,value,value]:[40,60,45];
    const i=(y*width+x)*4;pixels.set([...color,255],i);
  }
  const scope={window:{},document:{createElement:()=>{const canvas={width:0,height:0};canvas.getContext=()=>({drawImage(){},getImageData(){const data=new Uint8ClampedArray(canvas.width*canvas.height*4);for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const from=(Math.min(height-1,Math.floor(y*height/canvas.height))*width+Math.min(width-1,Math.floor(x*width/canvas.width)))*4;data.set(pixels.subarray(from,from+4),(y*canvas.width+x)*4);}return {data};}});return canvas;}}};
  vm.runInNewContext(fs.readFileSync('public/js/document-boundary.js','utf8'),scope);
  return scope.window.selectDocumentBoundary({width,height},initial,{corners:initial,score:cvScore},null);
}
const recovered=select(false,inner,.62);
const error=['tl','tr','br','bl'].reduce((sum,k)=>sum+Math.hypot(recovered.corners[k].x-truth[k].x,recovered.corners[k].y-truth[k].y),0)/4;
assert.ok(error<4,'A dark fold must not make the scanner crop to an inner panel: '+error);
const blank=select(true,inner,0);
assert.ok(blank.uncertain,'An unobserved boundary needs manual review');
assert.equal(JSON.stringify(blank.corners),JSON.stringify({tl:{x:0,y:0},tr:{x:width,y:0},br:{x:width,y:height},bl:{x:0,y:height}}),'A missing boundary must preserve the full source');
const malformed=select(true,{...inner,tl:{x:NaN,y:0}},.9);
assert.equal(JSON.stringify(malformed.corners),JSON.stringify(blank.corners),'Invalid predictions must not reach perspective warp');
const scope={window:{},document:{getElementById:()=>null,createElement:()=>({getContext:()=>({translate(){},rotate(){},drawImage(){}})})},setTimeout(){},console};
vm.runInNewContext(fs.readFileSync('public/js/crop.js','utf8'),scope);
const editor=new scope.window.CropEditor('unused');editor.img={width,height};editor.corners=JSON.parse(JSON.stringify(truth));editor.legacyCorners=JSON.parse(JSON.stringify(truth));editor.draw=()=>{};
editor.rotate(90);assert.equal(editor.rotation,90);assert.equal(editor.corners.tl.x,height-truth.bl.y);assert.equal(editor.corners.tl.y,truth.bl.x);
editor.rotate(-90);assert.equal(editor.rotation,0);assert.equal(JSON.stringify(editor.corners),JSON.stringify(truth),'Rotation must preserve manually chosen corners');
editor.corners=JSON.parse(JSON.stringify(inner));editor.useOriginalDetection();assert.equal(JSON.stringify(editor.corners),JSON.stringify(truth),'Previous detection must restore the saved original result');
console.log('PASS: shadowed outer page recovered; missing/invalid borders retain full source; rotation preserves selected corners.');
