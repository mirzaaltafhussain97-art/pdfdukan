const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createCanvas,loadImage}=require(process.env.PDFDUKAN_CANVAS);
const root=path.resolve('output/scanner-workspace-20261103'),prior=path.resolve('output/scanner-corner-repair-20261102');
const document={createElement:()=>createCanvas(1,1),getElementById:()=>null};
const scope={window:{},document,console,setTimeout,clearTimeout};
const source=['crop.js','document-boundary.js','filters.js'].map(f=>fs.readFileSync('public/js/'+f,'utf8')).join('\n');
const detachedTimeout=(...args)=>{const timer=setTimeout(...args);timer.unref();return timer;};
new Function('window','document','console','setTimeout','clearTimeout',source+'\nwindow.testWarp=_perspectiveWarpCanvas;')(scope.window,document,console,detachedTimeout,clearTimeout);
scope._perspectiveWarpCanvas=scope.window.testWarp;
const oldFilters={window:{}};new Function('window',fs.readFileSync(root+'/before/filters.js','utf8'))(oldFilters.window);
const keys=['tl','tr','br','bl'];
function meanError(a,b){return keys.reduce((s,k)=>s+Math.hypot(a[k].x-b[k].x,a[k].y-b[k].y),0)/4;}
function scaled(q,s){return Object.fromEntries(keys.map(k=>[k,{x:q[k].x*s,y:q[k].y*s}]));}
function filter(c,version=scope){version.window.applyFilterToContext(c.getContext('2d'),c.width,c.height,'magicpro');return c;}
function cloneCanvas(img){const c=createCanvas(img.width,img.height);c.getContext('2d').drawImage(img,0,0);return c;}
function unit(){
 const c=createCanvas(640,800),ctx=c.getContext('2d');ctx.fillStyle='rgb(50,130,80)';ctx.fillRect(0,0,640,800);ctx.fillStyle='rgb(160,80,90)';ctx.fillRect(80,90,480,620);
 const truth={tl:{x:80,y:90},tr:{x:560,y:90},br:{x:560,y:710},bl:{x:80,y:710}},guess={tl:{x:75,y:85},tr:{x:565,y:85},br:{x:565,y:715},bl:{x:75,y:715}};
 const refined=scope.window.refineDocumentEdges(c,guess);assert.ok(meanError(refined,truth)<2,'Equal-brightness coloured border refinement: '+meanError(refined,truth));
 const selected={corners:guess,selected_name:'control',uncertain:true,candidates:[{corners:guess,quality:{score:.4}}]};
 assert.ok(meanError(scope.window.refineSelectedBoundary(c,selected).corners,truth)<2,'Guarded correction must recover the observed colour edge');
 assert.equal(scope.window.refineSelectedBoundary(c,{...selected,candidates:[{corners:guess,quality:{score:.9}}]}).corners,guess,'A strong established outline must stay unchanged');
 assert.equal(scope.window.refineSelectedBoundary(c,selected,true).corners,guess,'Header-preservation geometry must stay unchanged');
 const tiny=createCanvas(2,2),tc=tiny.getContext('2d');tc.fillStyle='#89956d';tc.fillRect(0,0,2,2);filter(tiny);const t=tc.getImageData(0,0,2,2).data;assert.ok(t[0]+t[1]+t[2]>100,'Tiny images must not normalize to black');for(let i=3;i<t.length;i+=4)assert.equal(t[i],255);
 const photo=createCanvas(384,480),pc=photo.getContext('2d');pc.fillStyle='#dedede';pc.fillRect(0,0,384,480);const gradient=pc.createLinearGradient(80,100,300,380);gradient.addColorStop(0,'#263f37');gradient.addColorStop(.5,'#63786e');gradient.addColorStop(1,'#a1b5a8');pc.fillStyle=gradient;pc.fillRect(80,100,220,280);filter(photo);
 const tones=new Set();for(let y=150;y<350;y++)tones.add(pc.getImageData(190,y,1,1).data[0]);assert.ok(tones.size>=50,'Continuous-tone photo must keep its gradient: '+tones.size);
 console.log('PASS: equal-brightness RGB borders, tiny image normalization and continuous photo tones.');
}
function choose(image,row){
 const extras=(row.proposal?.candidates||[]).filter(c=>c.corners&&!['baseline','cv','ml','paper','neutral-paper'].includes(c.name)&&!c.name.endsWith('-refined')).map(c=>({name:c.name,corners:c.corners}));
 const proposal=scope.window.evaluateBoundaryCandidates(image,row.old,row.cv,row.ml,extras);
 const result=scope.window.guardUnsupportedFrame(image,scope.window.rankBoundaryCandidates(image,{old:row.old,proposal}));
 const header=scope.window.extendClippedNeutralHeader(image,result.corners);if(header.changed)result.corners=header.corners;
 return scope.window.refineSelectedBoundary(image,result,header.changed);
}
async function fixture(){
 const cases=JSON.parse(fs.readFileSync(prior+'/cases-public.json')).cases,rows=[];
 for(const entry of cases){const image=await loadImage(entry.path),row=JSON.parse(fs.readFileSync(prior+'/runs-integration-final/'+entry.id+'.json')),result=choose(image,row);
  if(entry.expected_corners)rows.push({id:entry.id,previous_error:meanError(row.current,entry.expected_corners),new_error:meanError(result.corners,entry.expected_corners)});
 }
 fs.writeFileSync(root+'/controlled-corners.json',JSON.stringify(rows,null,2));console.log(JSON.stringify({controlled:rows.length,previousMean:rows.reduce((n,r)=>n+r.previous_error,0)/rows.length,newMean:rows.reduce((n,r)=>n+r.new_error,0)/rows.length,worse:rows.filter(r=>r.new_error>r.previous_error+2)}));
}
async function dataset(){
 const entries=JSON.parse(fs.readFileSync(prior+'/cases.json')).cases,review=new Set(['f0001','f0014','f0043','f0074','f0076','f0087','f0110','f0140','f0180','f0228','f0270','f0315','f0342','f0367','f0370']);
 fs.mkdirSync(root+'/coverage-guarded',{recursive:true});fs.mkdirSync(root+'/review',{recursive:true});let done=0,errors=0;
 for(const entry of entries){
  const out={id:entry.id,kind:entry.kind,errors:[]};
  try{
   const old=JSON.parse(fs.readFileSync(prior+'/runs-v1/'+entry.id+'.json')),before=JSON.parse(fs.readFileSync(prior+'/runs-final/'+entry.id+'.json'));let image=await loadImage(entry.path);
   const size=old.workSize||[image.width,image.height];if(image.width!==size[0]||image.height!==size[1]){const c=createCanvas(...size);c.getContext('2d').drawImage(image,0,0,...size);image=c;}
   // Candidate selection is unchanged. Test the new, bounded correction on
   // its saved browser-selected outline, preserving measured browser scores.
   // Native canvas decoding/resampling is not a substitute for browser inference.
   const priorResult=before.proposal,selected=priorResult.candidates.find(c=>c.name===priorResult.selected_name&&JSON.stringify(c.corners)===JSON.stringify(before.proposed));
   priorResult.corners=selected?selected.corners:before.proposed;
   const result=scope.window.refineSelectedBoundary(image,priorResult,!!before.headerAdjustment?.changed);
   out.corners=result.corners;out.previousCorners=before.proposed;out.meanCornerChange=meanError(result.corners,before.proposed);out.needsReview=result.uncertain;
   const s=Math.min(1,640/Math.max(image.width,image.height)),small=createCanvas(Math.round(image.width*s),Math.round(image.height*s));small.getContext('2d').drawImage(image,0,0,small.width,small.height);
   const q=scaled(result.corners,s),width=Math.max(100,Math.round(Math.max(Math.hypot(q.tl.x-q.tr.x,q.tl.y-q.tr.y),Math.hypot(q.bl.x-q.br.x,q.bl.y-q.br.y)))),height=Math.max(100,Math.round(Math.max(Math.hypot(q.tl.x-q.bl.x,q.tl.y-q.bl.y),Math.hypot(q.tr.x-q.br.x,q.tr.y-q.br.y))));
   const cropped=scope._perspectiveWarpCanvas(small,q,width,height);assert.ok(cropped,'Valid crop warp');const enhanced=filter(cloneCanvas(cropped));const px=enhanced.getContext('2d').getImageData(0,0,enhanced.width,enhanced.height).data;
   assert.ok(px.length>0);for(let i=3;i<px.length;i+=4)assert.equal(px[i],255,'Opaque document pixels');
   out.magicSmokeDimensions=[enhanced.width,enhanced.height];
   if(review.has(entry.id)){
    fs.writeFileSync(root+'/review/'+entry.id+'-original.jpg',cropped.toBuffer('image/jpeg'));
    fs.writeFileSync(root+'/review/'+entry.id+'-before.jpg',filter(cloneCanvas(cropped),oldFilters).toBuffer('image/jpeg'));
    fs.writeFileSync(root+'/review/'+entry.id+'-magic.jpg',enhanced.toBuffer('image/jpeg'));
   }
   small.width=small.height=1;cropped.width=cropped.height=1;enhanced.width=enhanced.height=1;
  }catch(error){errors++;out.errors.push(error.stack||String(error));}
  fs.writeFileSync(root+'/coverage-guarded/'+entry.id+'.json',JSON.stringify(out));done++;
  if(done%10===0){console.log(JSON.stringify({done,total:entries.length,errors}));global.gc?.();}
 }
 console.log(JSON.stringify({complete:true,total:done,errors}));if(errors)process.exitCode=1;
}
(async()=>{unit();await fixture();if(process.argv.includes('--dataset'))await dataset();})().catch(error=>{console.error(error);process.exitCode=1;});
