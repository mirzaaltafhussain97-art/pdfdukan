const fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
const{createCanvas,loadImage}=require(process.env.PDFDUKAN_CANVAS),window={},document={currentScript:{src:'http://127.0.0.1:3130/js/scan-renderer.js'},createElement:()=>createCanvas(1,1)};
new Function('window',fs.readFileSync('public/js/filters.js','utf8'))(window);
new Function('window','document','URL','applyFilterToContext',fs.readFileSync('public/js/scan-renderer.js','utf8'))(window,document,URL,window.applyFilterToContext);
(async()=>{
 const image=await loadImage('D:/website data/PdfDukan/pk24updates/Data Folder (CamMaster)/2/page_019.jpg'),s=Math.min(1,Math.sqrt(16_000_000/(image.width*image.height))),source=createCanvas(Math.round(image.width*s),Math.round(image.height*s));source.getContext('2d').drawImage(image,0,0,source.width,source.height);
 const api=window.ScanRenderer,start=performance.now();await api.render(source,'magicpro');const full=performance.now()-start;
 const a=performance.now(),preview=await api.preview(source,'magicpro'),first=performance.now()-a;
 await api.preview(source,'enhance');const b=performance.now();await api.preview(source,'magicpro');const cached=performance.now()-b;
 const result={engine:'Native canvas + current JS fallback; not a measured browser UI benchmark',sourceSize:[source.width,source.height],previewSize:[preview.width,preview.height],fullMagicMilliseconds:Math.round(full),firstPreviewMagicMilliseconds:Math.round(first),cachedFilterSwitchMilliseconds:Math.round(cached*100)/100};
 fs.writeFileSync('output/scanner-fast-import-20261103/preview-benchmark.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;});
