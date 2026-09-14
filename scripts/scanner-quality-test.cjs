/* Local scanner regression checks. No documents are sent to remote services. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PDFDUKAN_PLAYWRIGHT || 'playwright');
const out = path.resolve('tmp/scanner-review');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page = await browser.newPage({viewport:{width:1360,height:1000},acceptDownloads:true});
  const errors = [];
  page.on('dialog', dialog => dialog.accept('scanner-test'));
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto((process.argv[2] || 'http://localhost:3001') + '/scanner.html', {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => typeof ScannerApp !== 'undefined' && !!window.ScanRenderer);
    await page.evaluate(() => document.getElementById('cmCookieBanner')?.remove());
    const source = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width=1200; c.height=1600;
      const ctx=c.getContext('2d'); ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
      ctx.fillStyle='#111';ctx.font='bold 54px Arial';ctx.fillText('SCAN QUALITY CHECK',100,140);
      ctx.font='30px Arial';
      for(let i=0;i<16;i++){ctx.fillStyle=i===5?'#aaa':'#222';ctx.fillText('Invoice '+(1000+i)+' — readable details 0123456789',100,260+i*60);}
      ctx.fillStyle='#2050b0';ctx.fillText('Blue signature / stamp',100,1340);
      ctx.strokeStyle='#bb2020';ctx.lineWidth=4;ctx.strokeRect(750,1250,320,180);
      ctx.fillStyle='#bb2020';ctx.fillText('PAID',840,1350);
      const shade=ctx.createLinearGradient(0,0,1200,0);shade.addColorStop(0,'rgba(0,0,0,.60)');shade.addColorStop(.7,'rgba(0,0,0,.08)');shade.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=shade;ctx.fillRect(0,0,1200,1600);
      return c.toDataURL('image/png').split(',')[1];
    });
    fs.writeFileSync(path.join(out,'sample-shadow.png'),Buffer.from(source,'base64'));
    const math = await page.evaluate(async (source) => {
      const c=document.createElement('canvas');c.width=80;c.height=80;
      const ctx=c.getContext('2d');ctx.fillStyle='rgb(100,100,100)';ctx.fillRect(0,0,80,80);
      applyFilterToContext(ctx,80,80,'original',{sharpness:100});
      const flat=[...ctx.getImageData(40,40,1,1).data];
      const img=new Image();img.src='data:image/png;base64,'+source;await img.decode();
      const results=[];
      for(const {id} of FILTERS){
        const rendered=await ScanRenderer.render(img,id,{sharpness:25});
        const direct=document.createElement('canvas');direct.width=img.width;direct.height=img.height;
        const dc=direct.getContext('2d');dc.drawImage(img,0,0);applyFilterToContext(dc,img.width,img.height,id,{sharpness:25});
        const a=rendered.getContext('2d').getImageData(0,0,img.width,img.height).data;
        const b=dc.getImageData(0,0,img.width,img.height).data;
        let different=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])different++;
        results.push({filter:id,different});
      }
      const enhanced=await ScanRenderer.render(img,'enhance');
      const ec=enhanced.getContext('2d');
      const left=ec.getImageData(30,1500,1,1).data[0],right=ec.getImageData(1150,1500,1,1).data[0];
      return {flat,results,paper:{left,right,difference:Math.abs(left-right)},enhanced:enhanced.toDataURL('image/png').split(',')[1]};
    },source);
    assert.deepEqual(math.flat,[100,100,100,255], 'Sharpen must preserve uniform brightness');
    for(const result of math.results)assert.equal(result.different,0,'Worker and fallback differ: '+result.filter);
    assert.ok(page.workers().some(worker=>worker.url().includes('scan-filter-worker')), 'Filter worker did not start');
    assert.ok(math.paper.left>225 && math.paper.difference<18,'Shadow normalization failed');
    fs.writeFileSync(path.join(out,'sample-enhanced.png'),Buffer.from(math.enhanced,'base64'));delete math.enhanced;
    await page.locator('#fileInputScanner').setInputFiles(path.join(out,'sample-shadow.png'));
    await page.waitForSelector('#screen-crop.active',{timeout:90000});
    // Skip must retain every original pixel, even when auto-crop chose corners.
    await page.click('#btnSkipCrop');
    await page.waitForFunction(() => document.getElementById('scanPreviewStatus').textContent.startsWith('Preview ready'));
    assert.deepEqual(await page.locator('#origMini').evaluate(c=>[c.width,c.height]),[150,200],'Skip did not retain the original page aspect and dimensions');
    await page.getByText('Magic Pro',{exact:true}).click();
    await page.waitForFunction(() => document.getElementById('scanPreviewStatus').textContent.startsWith('Preview ready'));
    await page.screenshot({path:path.join(out,'desktop-preview.png'),fullPage:true});
    await page.locator('.filter-layout').screenshot({path:path.join(out,'scanner-preview.png')});
    await page.click('#btnAddPageMain');
    await page.locator('.page-thumb').first().click();
    assert.equal(await page.locator('.filter-card.active .fc-label').innerText(),'Magic Pro');
    await page.click('#btnBackToCropMain');
    await page.waitForSelector('#screen-crop.active');
    await page.click('#btnSkipCrop');
    await page.waitForFunction(() => document.getElementById('scanPreviewStatus').textContent.startsWith('Preview ready'));
    await page.click('#btnAddPageMain');
    assert.equal(await page.locator('.page-thumb').count(),1,'Editing duplicated a page');
    await page.click('#btnGoExport');
    const pdfWait=page.waitForEvent('download');await page.click('#btnDownloadPDF');
    const pdf=await pdfWait;await pdf.saveAs(path.join(out,'scan.pdf'));
    assert.ok(fs.statSync(path.join(out,'scan.pdf')).size>1000);
    // A lossless download and the main preview must come from the same pixels.
    await page.selectOption('#imageExportFormat','png');
    const pngWait=page.waitForEvent('download');await page.click('#btnDownloadJPG');
    await Promise.race([pngWait, page.locator('#cmFnameDl').waitFor({state:'visible'}).then(()=>page.click('#cmFnameDl'))]);
    const png=await pngWait;await png.saveAs(path.join(out,'scan.png'));
    const pngBase64=fs.readFileSync(path.join(out,'scan.png')).toString('base64');
    const exported=await page.evaluate(async base64=>{
      const img=new Image();img.src='data:image/png;base64,'+base64;await img.decode();
      const expected=document.createElement('canvas');ScanRenderer.fit(img,expected,1320,1000);
      return {previewMatches:expected.toDataURL()===document.getElementById('previewCanvas').toDataURL(),width:img.naturalWidth,height:img.naturalHeight};
    },pngBase64);
    assert.equal(exported.previewMatches,true,'PNG download does not match approved preview');
    assert.deepEqual([exported.width,exported.height],[1200,1600],'Lossless export changed the original pixel dimensions');
    await page.setViewportSize({width:390,height:844});
    await page.click('#btnBackToPages');await page.locator('.page-thumb').first().click();
    await page.waitForFunction(() => document.getElementById('scanPreviewStatus').textContent.startsWith('Preview ready'));
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
    assert.equal(overflow,false,'Mobile layout overflows');
    await page.screenshot({path:path.join(out,'mobile-preview.png'),fullPage:true});
    await page.click('#btnAddPageMain');
    const second=await page.evaluate(async source=>{
      const img=new Image();img.src='data:image/png;base64,'+source;await img.decode();
      const c=document.createElement('canvas');c.width=800;c.height=1000;c.getContext('2d').drawImage(img,0,0,800,1000);
      return c.toDataURL('image/png').split(',')[1];
    },source);
    await page.locator('#fileInputScanner').setInputFiles({name:'second-page.png',mimeType:'image/png',buffer:Buffer.from(second,'base64')});
    await page.waitForSelector('#screen-crop.active',{timeout:90000});
    await page.click('#btnFitCrop');await page.click('#btnApplyCrop');
    await page.waitForFunction(() => document.getElementById('scanPreviewStatus').textContent.startsWith('Preview ready'));
    await page.click('#btnAddPageMain');
    assert.equal(await page.locator('.page-thumb').count(),2);
    await page.locator('.page-thumb').first().click();await page.click('#btnBackToCropMain');
    await page.click('#btnSkipCrop');
    await page.waitForFunction(() => document.getElementById('scanPreviewStatus').textContent.startsWith('Preview ready'));
    assert.deepEqual(await page.locator('#origMini').evaluate(c=>[c.width,c.height]),[150,200],'Editing did not restore page one');
    await page.click('#btnAddPageMain');await page.click('#btnGoExport');
    const multiWait=page.waitForEvent('download');await page.click('#btnDownloadPDF');
    const multi=await multiWait;await multi.saveAs(path.join(out,'scan-two-pages.pdf'));
    const pdfText=fs.readFileSync(path.join(out,'scan-two-pages.pdf'),'latin1');
    assert.equal((pdfText.match(/\/Type\s*\/Page\b/g)||[]).length,2,'PDF lost a page');
    const zipWait=page.waitForEvent('download');await page.click('#btnDownloadZIP');
    await Promise.race([zipWait,page.locator('#cmFnameDl').waitFor({state:'visible'}).then(()=>page.click('#cmFnameDl'))]);
    const zip=await zipWait;await zip.saveAs(path.join(out,'scan-pages.zip'));
    const zipBase64=fs.readFileSync(path.join(out,'scan-pages.zip')).toString('base64');
    const zipPages=await page.evaluate(async data=>{
      const archive=await JSZip.loadAsync(data,{base64:true});
      return Object.values(archive.files).filter(file=>!file.dir).map(file=>file.name);
    },zipBase64);
    assert.equal(zipPages.length,2,'ZIP lost a page');
    assert.deepEqual(errors,[],'Browser errors');
    fs.writeFileSync(path.join(out,'test-results.json'),JSON.stringify({passed:true,...exported,zipPages,...math,errors},null,2));
    console.log(JSON.stringify({passed:true,...exported,zipPages,...math,errors,output:out},null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
