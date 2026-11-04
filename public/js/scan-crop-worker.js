importScripts('scan-cv-runtime.js?v=20261104_autocrop','crop.js?v=20261104_autocrop','document-boundary.js?v=20261104_autocrop','scan-paper-profile.js?v=20261104_autocrop');
const editor=new CropEditor('worker');editor.silent=true;
async function warp(image,corners,preview=false){
 const ordered=ensureCornerOrder(corners),dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),W=Math.max(dist(ordered.tl,ordered.tr),dist(ordered.bl,ordered.br)),H=Math.max(dist(ordered.tl,ordered.bl),dist(ordered.tr,ordered.br));
 const scale=preview?Math.min(1,1800/Math.max(W,H),Math.sqrt(1_400_000/(W*H))):1;
 const source=new OffscreenCanvas(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));source.getContext('2d').drawImage(image,0,0,source.width,source.height);
 const q=Object.fromEntries(['tl','tr','br','bl'].map(k=>[k,{x:ordered[k].x*scale,y:ordered[k].y*scale}])),w=Math.max(100,Math.round(W*scale)),h=Math.max(100,Math.round(H*scale));
 if(!self.cvReady)return _perspectiveWarpCanvas(source,q,w,h);
 let src,dst,from,to,matrix;
 try{src=cv.imread(source);dst=new cv.Mat();from=cv.matFromArray(4,1,cv.CV_32FC2,['tl','tr','br','bl'].flatMap(k=>[q[k].x,q[k].y]));to=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,w,0,w,h,0,h]);matrix=cv.getPerspectiveTransform(from,to);cv.warpPerspective(src,dst,matrix,new cv.Size(w,h),cv.INTER_CUBIC,cv.BORDER_REPLICATE);const result=new OffscreenCanvas(w,h);cv.imshow(result,dst);return result;}
 finally{for(const mat of[src,dst,from,to,matrix])mat?.delete();source.width=source.height=1;}
}
self.onmessage=async({data:{id,method,bitmap,options={}}})=>{
 try{
  await self.scanCvReady;
  if(method==='warmup'){self.postMessage({id,ready:true});return;}
  let corners=options.corners,previousCorners,needsReview=false,hasPhotoPadding=false;
  if(method==='detect'){await editor.setImageAsync(bitmap);corners=editor.corners;previousCorners=editor.legacyCorners;needsReview=editor.detectionNeedsReview;hasPhotoPadding=editor.hasPhotoPadding;}
  const full=['tl','tr','br','bl'].every(k=>{const x=k.includes('r')?bitmap.width:0,y=k.includes('b')?bitmap.height:0;return Math.hypot(corners[k].x-x,corners[k].y-y)<2;});
  let blob=null,previewOnly=false;
  if(options.crop!==false&&!(method==='detect'&&full)){
   let output=await warp(bitmap,corners,!!options.preview);previewOnly=!!options.preview;
   if((method==='detect'&&hasPhotoPadding)||options.rectify)output=rectifyScanPaperBands(output);
   blob=await output.convertToBlob({type:'image/png'});output.width=output.height=1;
  }
  self.postMessage({id,corners,previousCorners,needsReview,hasPhotoPadding,previewOnly,blob,...(options.debug?{debug:editor.lastBoundary}: {})});
 }catch(error){self.postMessage({id,error:error.message});}finally{bitmap?.close();editor.img=null;}
};
