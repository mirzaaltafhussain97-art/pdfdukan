const fs=require('node:fs'),assert=require('node:assert/strict');const source=fs.readFileSync('public/js/scanner.js','utf8'),fn=source.slice(source.indexOf('  async function _reprocess('),source.indexOf('  function _paintImmediate('));
const original={name:'original'},cropped={name:'cropped'},page={croppedImg:original,autoStatus:'pending'},state={pages:[page],editingIndex:0,_currentCropped:original,currentFilter:'magicpro',adjustments:{}};
const requests=[],draws=[],fields={previewCanvas:{setAttribute(k,v){this[k]=v;},getContext:()=>({drawImage:image=>draws.push(image.name)})},scanPreviewStatus:{textContent:''}};
const renderer={preview(image,filter,settings,current){return new Promise(resolve=>requests.push({image,filter,current,resolve}));}};
const run=new Function('state','$','ScanRenderer','window','_applyZoom','_cacheThumbnail','_renderPages','_thumbnailKey','_renderFiltered',`let previewRevision=0;${fn};return _reprocess;`)(state,id=>fields[id],renderer,{ScanRenderer:renderer},()=>{},()=>{},()=>{},()=>'',()=>{});
const rendered=name=>({name,width:200,height:300});
(async()=>{
 const first=run();assert.equal(requests.length,1,'Filtering must start while document detection is pending');
 state.currentFilter='bw';const second=run();requests[0].resolve(rendered('stale magic'));await first;assert.equal(draws.length,0,'An older selected filter must not repaint the page');
 requests[1].resolve(rendered('latest bw'));await second;assert.deepEqual(draws,['latest bw']);assert.equal(fields.previewCanvas['aria-busy'],'false');assert.ok(fields.scanPreviewStatus.textContent.includes('Finding document edges'));
 const pending=run();page.croppedImg=cropped;page.autoStatus='ready';state._currentCropped=cropped;const updated=run();requests[2].resolve(rendered('old original'));await pending;assert.deepEqual(draws,['latest bw'],'An un-cropped preview must not overwrite the finished crop');
 requests[3].resolve(rendered('finished crop'));await updated;assert.deepEqual(draws,['latest bw','finished crop']);assert.equal(fields.scanPreviewStatus.textContent,'');
 console.log('PASS: filters update during auto-crop; rapid changes discard stale treatments; finished crop cannot be overwritten by an old original preview.');
})().catch(e=>{console.error(e);process.exitCode=1;});
