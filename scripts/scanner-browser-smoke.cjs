/* Isolated, unauthenticated source test. This never attaches to the user's
   browser/profile. All profile/temp/download files stay in the project. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve('.'),OUT=path.join(ROOT,'output/scanner-responsive-20261103');
fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(OUT,'tmp'),{recursive:true});
process.env.TMP=process.env.TEMP=path.join(OUT,'tmp');
const {chromium}=require('C:/Users/ANM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const manifest=JSON.parse(fs.readFileSync('output/scanner-fast-import-20261103/manifest.json'));
const fixture=manifest.batches.flat().find(f=>f.id===(process.argv[2]||'f0158'));
(async()=>{const context=await chromium.launchPersistentContext(path.join(OUT,'browser-profile'),{channel:'chrome',headless:true,viewport:{width:1100,height:800},acceptDownloads:true,downloadsPath:path.join(OUT,'downloads'),args:['--disable-background-networking','--disable-component-update','--disable-sync','--disable-crash-reporter','--disable-breakpad','--no-first-run']});
try{
 await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'||u.protocol==='data:'||u.protocol==='blob:'?route.continue():route.abort();});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{window.__qaLongTasks=[];window.__qaWorkers=[];const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(url,options){super(url,options);this.addEventListener('message',({data})=>window.__qaWorkers.push({url:String(url),id:data.id,error:data.error,ready:data.ready,hasCorners:!!data.corners,corners:data.corners,needsReview:data.needsReview,blobSize:data.blob?.size,debug:data.debug}));this.addEventListener('error',event=>window.__qaWorkers.push({url:String(url),error:event.message}));}postMessage(data,transfer){if(data.method==='detect')data.options={...data.options,debug:true};super.postMessage(data,transfer);}};new PerformanceObserver(list=>window.__qaLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({entryTypes:['longtask']});});
 await page.goto('http://127.0.0.1:3130/scanner.html?qa=responsive',{waitUntil:'domcontentloaded'});
 const started=Date.now();await page.locator('#fileInputScanner').setInputFiles(fixture.source_path);
 await page.locator('#scanPageList .scan-page[data-auto-status="ready"]').waitFor({timeout:120000});
 await page.locator('#previewCanvas[aria-busy="false"]').waitFor({timeout:120000});
 if(fixture.id==='f0119'){
  const detected=await page.evaluate(()=>window.__qaWorkers.find(w=>w.hasCorners).corners);
  assert.ok(detected.tl.x>130&&detected.tl.x<190&&detected.tl.y>25&&detected.tl.y<80,'The card top must exclude blue cloth');
  assert.ok(detected.br.x>1000&&detected.br.x<1080&&detected.br.y>1420&&detected.br.y<1500,'The card bottom must exclude blue cloth');
 }
 await page.screenshot({path:path.join(OUT,fixture.id+'-auto.png')});
 await page.locator('#scanCropToggle').click();await page.locator('#btnFitCrop').click();
 const capture=async(name)=>{await page.waitForTimeout(250);const geometry=await page.evaluate(()=>{const canvas=document.querySelector('#cropCanvas'),toolbar=document.querySelector('#scanCropOptions'),viewport=document.querySelector('#screen-crop'),c=canvas.getBoundingClientRect(),t=toolbar.getBoundingClientRect(),v=viewport.getBoundingClientRect();return {canvas:{x:c.x,y:c.y,width:c.width,height:c.height,right:c.right,bottom:c.bottom,nativeWidth:canvas.width,nativeHeight:canvas.height},toolbar:{x:t.x,y:t.y,width:t.width,height:t.height,bottom:t.bottom},viewport:{x:v.x,y:v.y,right:v.right,bottom:v.bottom},screen:[innerWidth,innerHeight]};});
  assert.ok(geometry.canvas.bottom<=geometry.toolbar.y-2,'Toolbar must reserve its own row below all crop handles');assert.ok(geometry.canvas.y>=geometry.viewport.y-1);assert.ok(geometry.canvas.right<=geometry.viewport.right+1);assert.ok(geometry.canvas.bottom<=geometry.viewport.bottom+1);
  await page.screenshot({path:path.join(OUT,name+'.png')});return geometry;};
 const desktop=await capture('crop-desktop');await page.setViewportSize({width:390,height:844});const mobile=await capture('crop-mobile');
 const c=mobile.canvas,left=c.x+16*c.width/c.nativeWidth,bottom=c.bottom-16*c.height/c.nativeHeight;
 await page.mouse.move(left,bottom);await page.mouse.down();await page.mouse.move(left+12,bottom-30,{steps:6});await page.mouse.up();
 await page.locator('#scanConfirm').click();await page.locator('#scanStageBusy').waitFor({state:'hidden',timeout:120000});await page.locator('#previewCanvas[aria-busy="false"]').waitFor({timeout:120000});
 const applied=await page.evaluate(()=>window.__qaWorkers.filter(w=>w.hasCorners).at(-1).corners);
 assert.ok(applied.bl.x>0&&applied.bl.y<applied.br.y,'The bottom-left handle must be draggable and its change must be applied');
 assert.equal(applied.tl.x,0);assert.equal(applied.tl.y,0);assert.equal(applied.tr.y,0);
 const sourceScale=(c.nativeWidth-32)/applied.tr.x;
 assert.ok(Math.abs(applied.bl.x-12/sourceScale)<2&&Math.abs(applied.bl.y-(applied.br.y-30/sourceScale))<2,'The visible gutter must not offset the applied source coordinates');
 const workers=await page.evaluate(()=>window.__qaWorkers);assert.ok(workers.some(w=>w.hasCorners),'Detector must return real worker corner results');assert.ok(!workers.some(w=>w.error),'No crop/filter worker errors');
 assert.deepEqual(errors,[]);
 const result={kind:'Isolated Chrome source UI test; no existing user browser access',elapsedMilliseconds:Date.now()-started,desktop,mobile,bottomHandleApplied:applied,longTasks:await page.evaluate(()=>window.__qaLongTasks),workers,errors};
 fs.writeFileSync(path.join(OUT,'browser-smoke.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({elapsedMilliseconds:result.elapsedMilliseconds,bottomHandleApplied:applied,selected:workers.find(w=>w.debug)?.debug.selected_name,mainThreadTasks:result.longTasks,errors}));
}finally{await context.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
