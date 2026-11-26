importScripts('scan-cv-runtime.js?v=20261105_fixes','crop.js?v=20261114b','document-boundary.js?v=20261113c','scan-paper-profile.js?v=20261105_fixes','scan-dewarp.js?v=20261126a','scan-edge-trim.js?v=20261126a');
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
  if(method==='warmup'){if(options.models){try{await self.MLDetector?.load();}catch(error){console.warn('Model preload unavailable:',error);}}self.postMessage({id,ready:true});return;}
  let corners=options.corners,previousCorners,needsReview=false,hasPhotoPadding=false;
  if(method==='detect'){await editor.setImageAsync(bitmap);corners=editor.corners;previousCorners=editor.legacyCorners;needsReview=editor.detectionNeedsReview;hasPhotoPadding=editor.hasPhotoPadding;}
  // A thin band of cloth or desk left along a side is cut away; the corners
  // move, so the crop editor and the full-size export follow it too.
  let probe=null,trimmed=false;
  if(method==='detect'&&!hasPhotoPadding&&options.trim!==false&&self.ScanEdgeTrim){
   try{
   // Only sides where the crop gave up and hugged the photo border (or the
   // whole crop when the detector was unsure); a confident edge stays put.
   const o0=ensureCornerOrder(corners),W0=bitmap.width,H0=bitmap.height,m=0.015,on=(p,side)=>side==='top'?p.y<H0*m:side==='bottom'?p.y>H0*(1-m):side==='left'?p.x<W0*m:p.x>W0*(1-m);
   const pairs={top:['tl','tr'],bottom:['bl','br'],left:['tl','bl'],right:['tr','br']},sides=needsReview?Object.keys(pairs):Object.keys(pairs).filter(sd=>pairs[sd].every(k=>on(o0[k],sd)));
   {probe=await warp(bitmap,corners,true);const t=ScanEdgeTrim.trim(probe,{sides});
    if(t){const o=ensureCornerOrder(corners),keys=['tl','tr','br','bl'],map=ScanEdgeTrim.homography([{x:0,y:0},{x:probe.width,y:0},{x:probe.width,y:probe.height},{x:0,y:probe.height}],keys.map(k=>o[k]));
     if(map){const next={};for(const k of keys){const q=map(t[k]);next[k]={x:Math.max(0,Math.min(bitmap.width,q.x)),y:Math.max(0,Math.min(bitmap.height,q.y))};}corners=next;trimmed=true;}
     probe.width=probe.height=1;probe=null;}}
   }catch(error){console.warn('Edge trim skipped:',error);probe=null;}
  }
  const full=['tl','tr','br','bl'].every(k=>{const x=k.includes('r')?bitmap.width:0,y=k.includes('b')?bitmap.height:0;return Math.hypot(corners[k].x-x,corners[k].y-y)<2;});
  let blob=null,previewOnly=false,dewarped=false;
  // Book pages and bent sheets: straighten curved text lines after the crop.
  // A whole-photo page (no edges found) is only re-encoded when its lines bend.
  const fullDetect=method==='detect'&&full,mayDewarp=options.dewarp!==false&&!!self.ScanDewarp;
  if(options.crop!==false&&(!fullDetect||mayDewarp)){
   let output=probe&&options.preview?probe:await warp(bitmap,corners,!!options.preview);if(output!==probe&&probe){probe.width=probe.height=1;}probe=null;
   if((method==='detect'&&hasPhotoPadding)||options.rectify)output=rectifyScanPaperBands(output);
   if(mayDewarp){try{const straight=ScanDewarp.dewarp(output,{force:options.dewarp==='force'});if(straight){output.width=output.height=1;output=straight;dewarped=true;}}catch(error){console.warn('Line straightening skipped:',error);}}
   if(!fullDetect||dewarped){previewOnly=!!options.preview;blob=await output.convertToBlob({type:'image/png'});}
   output.width=output.height=1;
  }
  if(probe){probe.width=probe.height=1;}
  self.postMessage({id,corners,previousCorners,needsReview,hasPhotoPadding,previewOnly,dewarped,trimmed,blob,...(options.debug?{debug:editor.lastBoundary}: {})});
 }catch(error){self.postMessage({id,error:error.message});}finally{bitmap?.close();editor.img=null;}
};
