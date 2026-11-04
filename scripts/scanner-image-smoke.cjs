/* Read-only source inventory + current JS filter fallback smoke coverage.
   This checks file compatibility; it does not certify corner accuracy or a
   fresh browser UI import. PDFs are deliberately excluded. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {createCanvas,loadImage}=require(process.env.PDFDUKAN_CANVAS),window={};
new Function('window',fs.readFileSync('public/js/filters.js','utf8'))(window);
const root=path.resolve('output/scanner-fast-import-20261103'),manifest=JSON.parse(fs.readFileSync(root+'/manifest.json')),files=manifest.batches.flat(),out=root+'/image-smoke';fs.mkdirSync(out,{recursive:true});
const filters=['original','enhance','magicpro','lighten','noshadow','bw','eco'];
(async()=>{const rows=[];let errors=0;for(const file of files){const start=Date.now(),row={id:file.id,sourceSha256:file.sha256,errors:[],filters:[]};
 try{
  const bytes=fs.readFileSync(file.source_path);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256,'Approved fixture must be unchanged');
  const image=await loadImage(bytes),s=Math.min(1,512/Math.max(image.width,image.height)),w=Math.max(1,Math.round(image.width*s)),h=Math.max(1,Math.round(image.height*s)),c=createCanvas(w,h),ctx=c.getContext('2d');
  assert.ok(w&&h);row.sourceSize=[image.width,image.height];row.previewSize=[w,h];
  for(const filter of filters){ctx.clearRect(0,0,w,h);ctx.drawImage(image,0,0,w,h);const before=ctx.getImageData(0,0,w,h).data,t=Date.now();window.applyFilterToContext(ctx,w,h,filter);const data=ctx.getImageData(0,0,w,h).data;assert.equal(data.length,w*h*4);for(let i=3;i<data.length;i+=4)assert.equal(data[i],before[i],'Treatment must preserve alpha');row.filters.push({id:filter,milliseconds:Date.now()-t});}
 }catch(error){errors++;row.errors.push(error.message);}
 row.milliseconds=Date.now()-start;rows.push(row);fs.writeFileSync(out+'/'+file.id+'.json',JSON.stringify(row));
 if(rows.length%12===0){console.log(JSON.stringify({done:rows.length,total:files.length,errors}));global.gc?.();}
 }
 const result={kind:'Offline image decode, unchanged source hashes and seven JS filter fallback smoke checks',images:rows.length,pdfsSkipped:manifest.pdf_skipped,filterRuns:rows.reduce((n,r)=>n+r.filters.length,0),errors,allImageIds:rows.map(r=>r.id),limitations:['Native canvas decoding; not fresh browser inference or UI coverage','Smoke outputs are bounded to 512px long edge','No automatic assertion of physical crop accuracy or CamScanner parity','Handwriting removal is evaluated separately']};fs.writeFileSync(out+'/RESULTS.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(errors)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
