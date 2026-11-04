/* Actual local Chrome import/filter/manual-crop/export tests of every approved PDF. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const ROOT=path.resolve('.'),OUT=path.join(ROOT,'output/scanner-pdf-20261103');fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(OUT,'tmp'),{recursive:true});process.env.TMP=process.env.TEMP=path.join(OUT,'tmp');
const{chromium}=require('C:/Users/ANM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const files=JSON.parse(fs.readFileSync('output/scanner-corner-repair-20261102/source-inventory.json')).files.filter(f=>f.kind==='pdf');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
(async()=>{const context=await chromium.launchPersistentContext(path.join(OUT,'browser-profile'),{channel:'chrome',headless:true,viewport:{width:1200,height:860},acceptDownloads:true,downloadsPath:path.join(OUT,'downloads'),args:['--disable-background-networking','--disable-component-update','--disable-sync','--disable-crash-reporter','--disable-breakpad','--no-first-run']});
try{
 await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'||u.protocol==='blob:'||u.protocol==='data:'?route.continue():route.abort();});
 const rows=[];
 for(const file of files){
  assert.equal(sha(file.source_path),file.sha256);const page=await context.newPage(),errors=[],warnings=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning'||m.type()==='error')warnings.push(m.text().slice(0,300));});
  await page.addInitScript(()=>{window.__pdfTasks=[];window.__workerErrors=[];const W=Worker;window.Worker=class extends W{constructor(url,opt){super(url,opt);this.addEventListener('message',({data})=>{if(data.error)window.__workerErrors.push({url:String(url),error:data.error});});this.addEventListener('error',e=>window.__workerErrors.push({url:String(url),error:e.message}));}};new PerformanceObserver(list=>window.__pdfTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({entryTypes:['longtask']});});
  await page.goto('http://127.0.0.1:3130/scanner.html?qa=pdf-'+file.id,{waitUntil:'domcontentloaded'});const started=Date.now();
  await page.locator('#fileInputPdfScan').setInputFiles(file.source_path);
  await page.waitForFunction(n=>document.querySelectorAll('#scanPageList .scan-page').length===n,file.pages,{timeout:240000});
  await page.locator('#scanAddImages:not([disabled])').waitFor({timeout:240000});const importMs=Date.now()-started;
  const names=await page.locator('#scanPageList .scan-page').evaluateAll(nodes=>nodes.map(n=>n.title));assert.deepEqual(names,Array.from({length:file.pages},(_,i)=>file.relative_path+' — page '+(i+1)),'PDF page identities/order must match the original');
  const filterTimes=[];await page.locator('#applyToAll').uncheck();
  for(const filter of ['original','enhance','magicpro','lighten','noshadow','bw','eco']){const t=Date.now();await page.locator('#filterStrip [data-filter="'+filter+'"]').click();await page.locator('#previewCanvas[aria-busy="false"]').waitFor({timeout:120000});filterTimes.push({filter,milliseconds:Date.now()-t});}
  await page.locator('#filterStrip [data-filter="magicpro"]').click();await page.locator('#previewCanvas[aria-busy="false"]').waitFor({timeout:120000});await page.locator('#applyToAll').check();
  await page.waitForFunction(()=>!document.querySelector('#scanPageList [data-auto-status="pending"],#scanPageList [data-auto-status="processing"]'),undefined,{timeout:240000});
  const detectedMs=Date.now()-started,reviewCount=await page.locator('#scanPageList .scan-page-warning').count();
  await page.locator('#scanPageList .scan-page').last().click();await page.locator('#previewCanvas[aria-busy="false"]').waitFor({timeout:120000});await page.screenshot({path:path.join(OUT,file.id+'-preview.png')});
  await page.locator('#scanCropToggle').click();await page.locator('#btnFitCrop').click();
  const boxes=await page.evaluate(()=>{const c=document.querySelector('#cropCanvas').getBoundingClientRect(),t=document.querySelector('#scanCropOptions').getBoundingClientRect();return {canvasBottom:c.bottom,toolbarTop:t.top};});assert.ok(boxes.canvasBottom<boxes.toolbarTop,'PDF bottom crop handles must stay above the toolbar');
  await page.locator('#scanConfirm').click();await page.locator('#scanStageBusy').waitFor({state:'hidden',timeout:120000});await page.locator('#previewCanvas[aria-busy="false"]').waitFor({timeout:120000});
  await page.locator('#scanConfirm').click();assert.equal(await page.locator('#pdfQuality').inputValue(),'0.98');
  const downloadPromise=page.waitForEvent('download',{timeout:360000}),exportStart=Date.now();await page.locator('#btnDownloadPDF').click();const download=await downloadPromise,output=path.join(OUT,file.id+'-export.pdf');await download.saveAs(output);
  const tasks=await page.evaluate(()=>window.__pdfTasks),workerErrors=await page.evaluate(()=>window.__workerErrors);assert.deepEqual(workerErrors,[]);assert.deepEqual(errors,[]);assert.equal(sha(file.source_path),file.sha256);
  const row={id:file.id,source:file.source_path,sourceHash:file.sha256,pages:file.pages,importMs,detectedMs,exportMs:Date.now()-exportStart,filterTimes,markedForReview:reviewCount,output,outputBytes:fs.statSync(output).size,cropHandles:boxes,longTasks:tasks,workerErrors,errors,warnings};rows.push(row);fs.writeFileSync(path.join(OUT,file.id+'.json'),JSON.stringify(row,null,2));fs.writeFileSync(path.join(OUT,'RESULTS.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify({id:file.id,pages:file.pages,importMs,detectedMs,exportMs:row.exportMs,reviewCount,largestMainThreadTask:Math.max(0,...tasks.map(t=>t.duration)),errors:errors.length+workerErrors.length}));await page.close();
 }
 console.log(JSON.stringify({complete:true,pdfs:rows.length,pages:rows.reduce((n,r)=>n+r.pages,0),exports:rows.length}));
}finally{await context.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
