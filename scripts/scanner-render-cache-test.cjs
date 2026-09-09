const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let processed=0;
const scope={window:{},URL,document:{currentScript:{src:'http://localhost/js/scan-renderer.js'},createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){},drawImage(){}})})},applyFilterToContext(){processed++;},console};
vm.runInNewContext(fs.readFileSync('public/js/scan-renderer.js','utf8'),scope);
(async()=>{
 const image={width:1200,height:1600};
 const r=scope.window.ScanRenderer;
 const skipped=await r.render(image,'magicpro',{},()=>false);
 assert.equal(skipped,null);assert.equal(processed,0);
 const first=await r.render(image,'magicpro');
 const reused=await r.render(image,'magicpro');
 assert.equal(first,reused);assert.equal(processed,1);
 assert.equal(first.width,1200);assert.equal(first.height,1600);
 await r.render(image,'enhance');assert.equal(processed,2);
 console.log('PASS: stale work skipped, identical preview/export reused, full dimensions retained, changed filter rendered.');
})();
