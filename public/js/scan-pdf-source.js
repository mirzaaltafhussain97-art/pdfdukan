/* Retain the original PDF for 300dpi export; use bounded high-quality previews. */
window.ScanPdf=(()=>{
 const image=blob=>new Promise((resolve,reject)=>{const url=URL.createObjectURL(blob),img=new Image();img.decoding='async';img.onload=()=>{const decoded=typeof img.decode==='function'?img.decode():Promise.resolve();decoded.then(()=>resolve(img),reject).finally(()=>URL.revokeObjectURL(url));};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('PDF page image could not be read'));};img.src=url;});
 async function open(file){const document=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;return {document,refs:0,fileName:file.name};}
 async function render(owner,number,full=false){
  const page=await owner.document.getPage(number),base=page.getViewport({scale:1}),s=full?Math.min(300/72,Math.sqrt(16_000_000/(base.width*base.height))):Math.min(150/72,1800/Math.max(base.width,base.height),Math.sqrt(2_500_000/(base.width*base.height))),viewport=page.getViewport({scale:s}),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(viewport.width));canvas.height=Math.max(1,Math.round(viewport.height));
  try{const task=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'});task.onContinue=resume=>requestAnimationFrame(resume);await task.promise;return canvas;}finally{page.cleanup();}
 }
 function flat(canvas){const c=document.createElement('canvas');c.width=c.height=128;c.getContext('2d').drawImage(canvas,0,0,128,128);const p=c.getContext('2d').getImageData(0,0,128,128).data;let border=0,n=0;for(let y=0;y<128;y++)for(let x=0;x<128;x++)if(x<3||y<3||x>=125||y>=125){const i=(y*128+x)*4;n++;if(Math.min(p[i],p[i+1],p[i+2])>=242)border++;}return border/n>.90;}
 async function preview(owner,number){const canvas=await render(owner,number),isFlat=flat(canvas),blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.98));canvas.width=canvas.height=1;if(!blob)throw new Error('PDF page encoding failed');return {image:await image(blob),flat:isFlat};}
 function transform(source,kind){const quarter=kind==='left'||kind==='right',c=document.createElement('canvas');c.width=quarter?source.height:source.width;c.height=quarter?source.width:source.height;const ctx=c.getContext('2d');if(quarter){ctx.translate(c.width/2,c.height/2);ctx.rotate((kind==='left'?-1:1)*Math.PI/2);ctx.drawImage(source,-source.width/2,-source.height/2);}else{ctx.translate(kind==='horizontal'?c.width:0,kind==='vertical'?c.height:0);ctx.scale(kind==='horizontal'?-1:1,kind==='vertical'?-1:1);ctx.drawImage(source,0,0);}return c;}
 async function exportSource(page){
  let source=await render(page.pdfSource.owner,page.pdfSource.number,true);
  for(const kind of page.sourceOperations||[]){const next=transform(source,kind);source.width=source.height=1;source=next;}
  const sx=source.width/(page.sourceImg.naturalWidth||page.sourceImg.width),sy=source.height/(page.sourceImg.naturalHeight||page.sourceImg.height),q=Object.fromEntries(['tl','tr','br','bl'].map(k=>[k,{x:page.cropCorners[k].x*sx,y:page.cropCorners[k].y*sy}]));
  const full=['tl','tr','br','bl'].every(k=>Math.hypot(q[k].x-(k.includes('r')?source.width:0),q[k].y-(k.includes('b')?source.height:0))<3);
  if(full)return source;
  try{
   if(window.ScanProcessor?.available){const result=await ScanProcessor.warp(source,q,{rectify:!!page.autoProfile});return await image(result.blob);}
   const editor=new CropEditor('pdf-export');editor.silent=true;editor.img=source;editor.corners=q;return window.cvReady?await editor.applyCrop():await editor.perspectiveCrop();
  }finally{source.width=source.height=1;}
 }
 function release(page){const owner=page.pdfSource?.owner;if(owner&&--owner.refs===0)owner.document.destroy().catch(console.warn);}
 return {open,preview,exportSource,release};
})();
