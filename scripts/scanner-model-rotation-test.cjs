const fs=require('node:fs'),assert=require('node:assert/strict');
const {createCanvas}=require(process.env.PDFDUKAN_CANVAS),window={},document={createElement:()=>createCanvas(1,1),getElementById:()=>null};
new Function('window','document','setTimeout',fs.readFileSync('public/js/crop.js','utf8')+'\nwindow.sortForTest=_sortCorners;')(window,document,()=>{});
new Function('window','document','_sortCorners',fs.readFileSync('public/js/document-boundary.js','utf8'))(window,document,window.sortForTest);
const W=3464,H=4619,truth={tl:{x:400,y:300},tr:{x:3000,y:500},br:{x:3100,y:4200},bl:{x:350,y:4100}},keys=['tl','tr','br','bl'];
let i=0;
(async()=>{const image=createCanvas(10,10);image.width=W;image.height=H;const result=await window.rotatedModelCandidates(image,async canvas=>{
 assert.equal(canvas.width,256);assert.equal(canvas.height,256,'Model rotation must not allocate a full-resolution canvas');const angle=[90,180,270][i++];
 return window.sortForTest(keys.map(k=>{const p=truth[k],x=p.x/W,y=p.y/H;return angle===90?{x:(1-y)*256,y:x*256}:angle===180?{x:(1-x)*256,y:(1-y)*256}:{x:y*256,y:(1-x)*256};}));
 });assert.equal(result.length,3);for(const row of result)for(const key of keys)assert.ok(Math.hypot(row.corners[key].x-truth[key].x,row.corners[key].y-truth[key].y)<1e-8,'Rotated coordinates must map back to the original document');console.log('PASS: three model rotations use bounded 256px inputs and recover exact source coordinates.');})().catch(e=>{console.error(e);process.exitCode=1;});
