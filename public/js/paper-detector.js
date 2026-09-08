/* A second, independent candidate for pale paper on coloured/busy surfaces.
   Connected paper area and straight boundary support are required; the ML
   candidate remains available for coloured cards and ambiguous scenes. */
window.detectPaperBoundary = function(image, prior) {
  const W=image.naturalWidth||image.width,H=image.naturalHeight||image.height;
  const scale=Math.min(1,800/Math.max(W,H));
  const canvas=document.createElement('canvas');canvas.width=Math.round(W*scale);canvas.height=Math.round(H*scale);
  const w=canvas.width,h=canvas.height,ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,w,h);
  const rgba=ctx.getImageData(0,0,w,h).data,mask=new Uint8Array(w*h);
  for(let p=0;p<mask.length;p++) {
    const r=rgba[p*4],g=rgba[p*4+1],b=rgba[p*4+2],hi=Math.max(r,g,b),lo=Math.min(r,g,b);
    mask[p]=lo>95 && (hi-lo)<hi*.19 ? 1:0;
  }
  const queue=new Int32Array(w*h);let largest=[];
  for(let start=0;start<mask.length;start++) {
    if(mask[start]!==1)continue;
    let head=0,tail=1;queue[0]=start;mask[start]=2;
    while(head<tail) {
      const p=queue[head++],x=p%w;
      for(const q of [x>0?p-1:-1,x<w-1?p+1:-1,p>=w?p-w:-1,p<w*(h-1)?p+w:-1]) {
        if(q>=0&&mask[q]===1){mask[q]=2;queue[tail++]=q;}
      }
    }
    if(tail>largest.length)largest=Array.from(queue.subarray(0,tail));
  }
  if(largest.length<w*h*.22)return null;
  const rows=new Map();
  for(const p of largest) {
    const y=Math.floor(p/w),x=p%w,row=rows.get(y)||[w,0];row[0]=Math.min(row[0],x);row[1]=Math.max(row[1],x);rows.set(y,row);
  }
  const points=[];for(const [y,[a,b]]of rows){points.push({x:a,y},{x:b,y});}
  points.sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const half=list=>{const hull=[];for(const p of list){while(hull.length>1&&cross(hull[hull.length-2],hull[hull.length-1],p)<=0)hull.pop();hull.push(p);}return hull;};
  const lower=half(points),upper=half(points.slice().reverse());lower.pop();upper.pop();
  const hull=lower.concat(upper),quad=hull.slice();
  while(quad.length>4) {
    let index=0,smallest=Infinity;
    for(let i=0;i<quad.length;i++){const area=Math.abs(cross(quad[(i+quad.length-1)%quad.length],quad[i],quad[(i+1)%quad.length]));if(area<smallest){smallest=area;index=i;}}
    quad.splice(index,1);
  }
  if(quad.length!==4)return null;
  const area=poly=>Math.abs(poly.reduce((s,p,i)=>s+p.x*poly[(i+1)%poly.length].y-p.y*poly[(i+1)%poly.length].x,0))/2;
  const qa=area(quad);
  if(qa<w*h*.25 || qa>w*h*.97 || largest.length/qa<.70 || area(hull)/qa>1.08)return null;
  let first=0;for(let i=1;i<4;i++)if(quad[i].x+quad[i].y<quad[first].x+quad[first].y)first=i;
  const ordered=quad.map((_,i)=>quad[(i+first)%4]);
  if(prior) {
    const old=['tl','tr','br','bl'].map(k=>({x:prior[k].x*scale,y:prior[k].y*scale}));
    // Do not mistake a white panel within a coloured card for the whole card.
    if(qa/area(old)<.70 || qa/area(old)>1.35)return null;
  }
  // A straight paper side must be represented by actual boundary pixels.
  const sideSupports=[];
  for(let side=0;side<4;side++) {
    const a=ordered[side],b=ordered[(side+1)%4],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    if(len<Math.min(w,h)*.18)return null;
    let support=0;
    for(let step=1;step<=20;step++) {
      const t=step/21,x=a.x+dx*t,y=a.y+dy*t;
      if(points.some(p=>Math.abs((p.x-x)*dy-(p.y-y)*dx)/len<4 && Math.abs((p.x-x)*dx+(p.y-y)*dy)/len<len/35))support++;
    }
    // Row extrema cannot represent horizontal borders; use hull proximity there.
    if(Math.abs(dy)>Math.abs(dx))sideSupports.push(support);
  }
  // Fingers and curled paper can hide part of one side. Allow that only
  // when the opposite side is strong and the interior is predominantly paper.
  if(sideSupports.some(n=>n<12) && !(sideSupports.every(n=>n>=8) && Math.max(...sideSupports)>=16 && largest.length/qa>=.90))return null;
  return Object.fromEntries(['tl','tr','br','bl'].map((k,i)=>[k,{x:ordered[i].x/scale,y:ordered[i].y/scale}]));
};

