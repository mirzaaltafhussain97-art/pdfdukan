const fs=require('node:fs'),assert=require('node:assert/strict');
const {createCanvas}=require(process.env.PDFDUKAN_CANVAS);
const source=fs.readFileSync('public/js/scanner.js','utf8');
const functions=source.slice(source.indexOf('  function _thumbnailKey('),source.indexOf('  function _renderPages('));
const frames=[],state={pages:[]},window={cvReady:false},document={createElement:()=>createCanvas(1,1)};
const api=new Function('state','window','document','requestAnimationFrame','setTimeout','applyFilterToContext','_renderPages','_fullCorners',`const thumbnailJobs=new Map();let thumbnailTask=null;${functions};return {key:_thumbnailKey,cache:_cacheThumbnail,valid:_thumbnailCurrent,label:_pageCropLabel,queue(page){thumbnailJobs.set(page.id,{page,image:page.croppedImg,key:_thumbnailKey(page),filter:page.filter,adjustments:{...page.adjustments}});_queueThumbnails();},done:()=>thumbnailTask};`)(state,window,document,cb=>frames.push(cb),cb=>cb(),(ctx,w,h,id)=>{ctx.fillStyle=id==='bw'?'#000':'#f00';ctx.fillRect(0,0,w,h);},()=>{},image=>({tl:{x:0,y:0},tr:{x:image.width,y:0},br:{x:image.width,y:image.height},bl:{x:0,y:image.height}}));
const image=createCanvas(200,300),page={id:'a',sourceImg:image,croppedImg:image,filter:'magicpro',adjustments:{},autoStatus:'ready'};state.pages=[page];
(async()=>{
 api.queue(page);page.filter='bw';api.queue(page);frames.shift()();await api.done();
 assert.equal(page._thumbnail.key,api.key(page));assert.equal(page._thumbnail.canvas.getContext('2d').getImageData(0,0,1,1).data[0],0,'Newest filter is painted into the thumbnail');
 const oldJob={page,image,key:api.key(page)};state.pages.reverse();assert.ok(api.valid(oldJob),'Reordering does not redirect a treatment');
 page.croppedImg=createCanvas(120,180);assert.ok(!api.valid(oldJob),'A new crop invalidates the old image thumbnail');
 api.queue(page);const task=api.done();state.pages=[];frames.shift()();await task;assert.equal(page._thumbnail.source,image,'Deleted pages must not accept queued treatments');
 page.autoStatus='pending';assert.equal(api.label(page),'Finding edges');page.autoStatus='ready';page.needsCropReview=true;assert.equal(api.label(page),'Check crop');
 console.log('PASS: thumbnail shows the latest treatment; crop changes/deletion discard stale results; per-page crop status remains explicit.');
})().catch(e=>{console.error(e);process.exitCode=1;});
