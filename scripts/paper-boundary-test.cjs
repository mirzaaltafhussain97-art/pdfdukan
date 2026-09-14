const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createCanvas,loadImage}=require(process.env.PDFDUKAN_CANVAS||'@napi-rs/canvas');
(async()=>{
 const scope={window:{},document:{createElement:()=>createCanvas(1,1)}};
 for(const f of ['paper-detector','scan-edge-refiner'])vm.runInNewContext(fs.readFileSync('public/js/'+f+'.js','utf8'),scope);
 const blank=createCanvas(600,800),blankCtx=blank.getContext('2d');
 blankCtx.fillStyle='#ddd';blankCtx.fillRect(0,0,600,800);
 assert.equal(scope.window.detectPaperBoundary(blank,null),null,'Uniform background must not be called paper');
 blankCtx.fillStyle='#333';blankCtx.fillRect(0,0,600,800);
 blankCtx.fillStyle='#ddd';blankCtx.fillRect(180,200,140,350);
 assert.equal(scope.window.detectPaperBoundary(blank,null),null,'Small pale patches must not override document detection');
 const positive=createCanvas(600,800),positiveCtx=positive.getContext('2d');
 positiveCtx.fillStyle='#333';positiveCtx.fillRect(0,0,600,800);
 positiveCtx.fillStyle='#fff';positiveCtx.beginPath();positiveCtx.moveTo(75,65);positiveCtx.lineTo(535,90);positiveCtx.lineTo(510,735);positiveCtx.lineTo(95,710);positiveCtx.closePath();positiveCtx.fill();
 const positiveCorners=scope.window.detectPaperBoundary(positive,null);
 assert.ok(positiveCorners,'Large high-contrast paper must be detected');
 const img=process.argv[2]?await loadImage(process.argv[2]):positive;
 const detected=scope.window.detectPaperBoundary(img,null);
 console.log(JSON.stringify({size:[img.width,img.height],fallbackCorners:detected,positiveCorners},null,2));
 // Real camera photos may intentionally fall through to the ML/OpenCV stages.
 // This component test requires its synthetic positive case, not every full-pipeline input.
 const corners=detected||positiveCorners,refined=scope.window.refineDocumentEdges(detected?img:positive,corners);
 const reviewImage=detected?img:positive;
 const c=createCanvas(reviewImage.width,reviewImage.height),ctx=c.getContext('2d');ctx.drawImage(reviewImage,0,0);ctx.strokeStyle='red';ctx.lineWidth=4;ctx.beginPath();
 ['tl','tr','br','bl'].forEach((k,i)=>i?ctx.lineTo(refined[k].x,refined[k].y):ctx.moveTo(refined[k].x,refined[k].y));ctx.closePath();ctx.stroke();
 fs.mkdirSync('tmp/paper-review',{recursive:true});fs.writeFileSync('tmp/paper-review/edges.png',c.toBuffer('image/png'));
 console.log('Refined:',JSON.stringify(refined));
})();
