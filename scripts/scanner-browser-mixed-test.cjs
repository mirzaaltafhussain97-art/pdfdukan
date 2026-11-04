/* Real local browser test of combined PDF/image imports and rapid filter changes. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve('.'),OUT=path.join(ROOT,'output/scanner-responsive-20261103/mixed');fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(OUT,'tmp'),{recursive:true});process.env.TMP=process.env.TEMP=path.join(OUT,'tmp');
const{chromium}=require('C:/Users/ANM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const inventory=JSON.parse(fs.readFileSync('output/scanner-corner-repair-20261102/source-inventory.json')).files;
const entries=['f0119','f0068','f0158'].map(id=>inventory.find(f=>f.id===id));
(async()=>{const context=await chromium.launchPersistentContext(path.join(OUT,'profile'),{channel:'chrome',headless:true,viewport:{width:1200,height:860},acceptDownloads:true,downloadsPath:path.join(OUT,'downloads'),args:['--disable-background-networking','--disable-component-update','--disable-sync','--disable-crash-reporter','--disable-breakpad','--no-first-run']});
try{
 await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'||u.protocol==='data:'||u.protocol==='blob:'?route.continue():route.abort();});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3130/scanner.html?qa=final-mixed',{waitUntil:'domcontentloaded'});
 const start=Date.now();await page.locator('#fileInputScanner').setInputFiles(entries.map(e=>e.source_path));
 await page.waitForFunction(()=>document.querySelectorAll('#scanPageList .scan-page').length===6);await page.locator('#scanAddImages:not([disabled])').waitFor({timeout:120000});
 const importedMs=Date.now()-start,expected=[entries[0].relative_path,...Array.from({length:4},(_,n)=>entries[1].relative_path+' — page '+(n+1)),entries[2].relative_path];
 const names=await page.locator('#scanPageList .scan-page').evaluateAll(nodes=>nodes.map(n=>n.title));assert.deepEqual(names,expected,'Combined files must keep their own names and PDF page order');
 await page.locator('#applyToAll').uncheck();
 // Switch treatments while the independent crop worker is still working.
 await page.evaluate(()=>{for(const f of ['bw','enhance','eco','lighten','magicpro'])document.querySelector('#filterStrip [data-filter="'+f+'"]').click();});
 await page.locator('#previewCanvas[aria-busy="false"]').waitFor({timeout:120000});
 await page.waitForFunction(()=>!document.querySelector('#scanPageList [data-auto-status="pending"],#scanPageList [data-auto-status="processing"]'),undefined,{timeout:240000});
 await page.locator('#previewCanvas[aria-busy="false"]').waitFor({timeout:120000});
 const detectedMs=Date.now()-start;
 const filterMs=[];
 for(const filter of ['original','enhance','magicpro','lighten','noshadow','bw','eco']){const t=Date.now();await page.locator('#filterStrip [data-filter="'+filter+'"]').click();await page.locator('#previewCanvas[aria-busy="false"]').waitFor({timeout:120000});filterMs.push({filter,milliseconds:Date.now()-t});}
 await page.locator('#scanPageList .scan-page').nth(5).click();await page.locator('#filterStrip [data-filter="bw"]').click();await page.locator('#previewCanvas[aria-busy="false"]').waitFor({timeout:120000});
 await page.locator('#scanPageList .scan-page').first().click();assert.equal(await page.locator('#filterStrip [aria-pressed="true"]').getAttribute('data-filter'),'eco','Per-page treatments must survive switching');
 await page.locator('#previewCanvas[aria-busy="false"]').waitFor({timeout:120000});
 assert.deepEqual(await page.locator('#scanPageList .scan-page').evaluateAll(nodes=>nodes.map(n=>n.title)),expected);
 await page.screenshot({path:path.join(OUT,'mixed-import.png')});
 assert.deepEqual(errors,[]);const result={combinedFiles:entries.length,pages:6,names,importedMs,detectedMs,filterMs,rapidFilterChanges:true,perPageTreatmentsPreserved:true,errors};fs.writeFileSync(path.join(OUT,'RESULTS.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 // Review buttons must start a fresh batch, including the local PDF fixture.
 await page.goto('http://127.0.0.1:3130/review.html?test=responsive2',{waitUntil:'domcontentloaded'});
 const frame=page.frameLocator('iframe');await frame.locator('#scanPageList .scan-page').nth(2).waitFor({timeout:120000});await page.locator('#pdf:not([disabled])').click();await frame.locator('#scanPageList .scan-page').nth(3).waitFor({timeout:120000});await page.locator('#pdf:not([disabled])').waitFor({timeout:120000});assert.equal(await frame.locator('#scanPageList .scan-page').count(),4);
 console.log('PASS: review defaults to the three reported photos; PDF button replaces them with four PDF pages.');
}finally{await context.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
