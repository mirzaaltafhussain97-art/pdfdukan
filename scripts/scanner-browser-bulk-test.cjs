/* One real Chrome import of every authorized image and PDF, entirely offline. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve('.'),OUT=path.join(ROOT,'output/scanner-bulk-20261103');fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(OUT,'tmp'),{recursive:true});process.env.TMP=process.env.TEMP=path.join(OUT,'tmp');
const{chromium}=require('C:/Users/ANM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const files=JSON.parse(fs.readFileSync('output/scanner-corner-repair-20261102/source-inventory.json')).files;
const expected=files.flatMap(f=>f.kind==='pdf'?Array.from({length:f.pages},(_,n)=>path.basename(f.source_path)+' — page '+(n+1)):[path.basename(f.source_path)]);
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const save=(name,data)=>fs.writeFileSync(path.join(OUT,name+'.json'),JSON.stringify(data,null,2));
(async()=>{
 for(const f of files)assert.equal(sha(f.source_path),f.sha256);
 const context=await chromium.launchPersistentContext(path.join(OUT,'profile'),{channel:'chrome',headless:true,viewport:{width:1200,height:860},acceptDownloads:true,downloadsPath:path.join(OUT,'downloads'),args:['--disable-background-networking','--disable-component-update','--disable-sync','--disable-crash-reporter','--disable-breakpad','--no-first-run']});
 try{
  await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'||u.protocol==='data:'||u.protocol==='blob:'?route.continue():route.abort();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('crash',()=>errors.push('Browser page crashed'));
  await page.addInitScript(()=>{window.__bulk={tasks:[],workerErrors:[],detects:[],heartbeat:0};setInterval(()=>window.__bulk.heartbeat++,100);new PerformanceObserver(list=>window.__bulk.tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({entryTypes:['longtask']});const W=Worker;window.Worker=class extends W{constructor(url,opt){super(url,opt);this.addEventListener('message',({data})=>{if(data.error)window.__bulk.workerErrors.push({url:String(url),error:data.error});if(data.corners)window.__bulk.detects.push({id:data.id,corners:data.corners,needsReview:data.needsReview});});this.addEventListener('error',e=>window.__bulk.workerErrors.push({url:String(url),error:e.message}));}};});
  await page.goto('http://127.0.0.1:3130/scanner.html?qa=all-files-bulk',{waitUntil:'domcontentloaded'});const started=Date.now();
  await page.locator('#fileInputScanner').setInputFiles(files.map(f=>f.source_path),{timeout:120000});
  const progress=()=>page.evaluate(()=>({pages:document.querySelectorAll('#scanPageList .scan-page').length,pending:document.querySelectorAll('#scanPageList [data-auto-status="pending"],#scanPageList [data-auto-status="processing"]').length,review:document.querySelectorAll('#scanPageList .scan-page-warning').length,importing:document.querySelector('#scanAddImages').disabled,status:document.querySelector('#scanImportStatus').textContent,heartbeat:window.__bulk.heartbeat,largestTask:Math.max(0,...window.__bulk.tasks.map(t=>t.duration)),workerErrors:window.__bulk.workerErrors.length}));
  let lastCount=-1,importedMs;
  for(let step=0;step<720;step++){
   const p=await progress();save('progress',{...p,elapsedMs:Date.now()-started,expectedPages:expected.length});
   if(p.pages!==lastCount||step%6===0){console.log(JSON.stringify({stage:'import',...p,elapsedMs:Date.now()-started}));lastCount=p.pages;}
   if(p.pages===expected.length&&!p.importing){importedMs=Date.now()-started;break;}
   assert.deepEqual(errors,[]);await page.waitForTimeout(1000);
  }
  assert.ok(importedMs,'All source files must finish one bulk import');
  const names=await page.locator('#scanPageList .scan-page').evaluateAll(nodes=>nodes.map(n=>n.title));assert.deepEqual(names,expected,'Bulk PDF/image names and PDF page order must match all originals');
  await page.locator('#applyToAll').check();
  await page.evaluate(()=>{for(const f of ['bw','enhance','eco','lighten','magicpro'])document.querySelector('#filterStrip [data-filter="'+f+'"]').click();});
  for(let step=0;step<360;step++){
   const p=await progress();save('progress',{...p,elapsedMs:Date.now()-started,expectedPages:expected.length});console.log(JSON.stringify({stage:'auto-crop',...p,elapsedMs:Date.now()-started}));
   if(!p.pending)break;
   assert.deepEqual(errors,[]);await page.waitForTimeout(5000);
  }
  assert.equal((await progress()).pending,0,'Every bulk page must finish detection or be marked for review');
  assert.equal(await page.locator('#scanPageList .scan-page').count(),expected.length);
  const detectedMs=Date.now()-started,filterMs=[];
  for(const filter of ['original','enhance','magicpro','lighten','noshadow','bw','eco']){
   const t=Date.now();await page.locator('#filterStrip [data-filter="'+filter+'"]').click();await page.locator('#previewCanvas[aria-busy="false"]').waitFor({timeout:120000});
   const labels=await page.locator('#scanPageList .scan-page-meta').allTextContents();assert.ok(labels.every(label=>label.startsWith(({original:'Original',enhance:'Enhance',magicpro:'Magic Pro',lighten:'Lighten',noshadow:'No Shadow',bw:'B&W',eco:'Eco'})[filter])),'Apply-to-all labels must identify the treatment for every page');
   filterMs.push({filter,milliseconds:Date.now()-t});
  }
  await page.locator('#filterStrip [data-filter="magicpro"]').click();await page.locator('#previewCanvas[aria-busy="false"]').waitFor({timeout:120000});
  // Visit every page after the bulk run: no off-screen page may be corrupt.
  const samples=[];fs.mkdirSync(path.join(OUT,'previews'),{recursive:true});
  for(let i=0;i<expected.length;i++){
   await page.locator('#scanPageList .scan-page').nth(i).click();await page.locator('#previewCanvas[aria-busy="false"]').waitFor({timeout:120000});
   const preview=await page.locator('#previewCanvas').evaluate(canvas=>{const c=document.createElement('canvas'),s=Math.min(1,520/Math.max(canvas.width,canvas.height));c.width=Math.max(1,Math.round(canvas.width*s));c.height=Math.max(1,Math.round(canvas.height*s));c.getContext('2d').drawImage(canvas,0,0,c.width,c.height);return {width:canvas.width,height:canvas.height,url:c.toDataURL('image/jpeg',.9)};});
   assert.ok(preview.width>0&&preview.height>0);fs.writeFileSync(path.join(OUT,'previews',String(i+1).padStart(3,'0')+'.jpg'),Buffer.from(preview.url.split(',')[1],'base64'));samples.push({page:i+1,name:expected[i],width:preview.width,height:preview.height});
   if((i+1)%12===0)console.log(JSON.stringify({stage:'page-preview',done:i+1,total:expected.length}));
  }
  for(const f of files)assert.equal(sha(f.source_path),f.sha256);
  const runtime=await page.evaluate(()=>window.__bulk);assert.deepEqual(runtime.workerErrors,[]);assert.deepEqual(errors,[]);
  const result={files:files.length,images:files.filter(f=>f.kind==='image').length,pdfs:files.filter(f=>f.kind==='pdf').length,pages:expected.length,importedMs,detectedMs,elapsedMs:Date.now()-started,filterMs,allSourceHashesUnchanged:true,allPagePreviews:samples,markedForReview:(await progress()).review,largestMainThreadTask:Math.max(0,...runtime.tasks.map(t=>t.duration)),workerErrors:runtime.workerErrors,errors,limits:['One-machine offline browser run, not universal performance or CamScanner parity','All seven filters selected with Apply to All; every page rendered in final Magic Pro, not seven full-resolution exports per page','Ambiguous crops retain original pixels and show Check crop']};save('RESULTS',result);save('runtime',runtime);await page.screenshot({path:path.join(OUT,'complete.png')});console.log(JSON.stringify({complete:true,files:result.files,pages:result.pages,elapsedMs:result.elapsedMs,review:result.markedForReview,errors:errors.length}));
 }finally{await context.close();}
})().catch(error=>{save('FAILURE',{message:error.message,stack:error.stack});console.error(error);process.exitCode=1;});
