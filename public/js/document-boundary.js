/* Uniform export padding is not part of the photograph. Analysing its edges
   as paper hides the real page boundary and changes the model's aspect ratio. */
window.getScanPhotoFrame=function(image){
 const W=image.naturalWidth||image.width,H=image.naturalHeight||image.height,s=Math.min(1,600/Math.max(W,H));
 const c=document.createElement('canvas');c.width=Math.max(1,Math.round(W*s));c.height=Math.max(1,Math.round(H*s));const ctx=c.getContext('2d');ctx.drawImage(image,0,0,c.width,c.height);const p=ctx.getImageData(0,0,c.width,c.height).data,w=c.width,h=c.height;
 const white=x=>{let n=0;for(let y=0;y<h;y++){const i=(y*w+x)*4;if(Math.min(p[i],p[i+1],p[i+2])>=248)n++;}return n/h;};
 let left=0,right=w-1;while(left<w*.27&&white(left)>.997)left++;while(right>w*.73&&white(right)>.997)right--;
 // Both sides must be external white bands adjoining a continuous photograph.
 // Ordinary white document margins with intermittent text are left untouched.
 if(left<w*.025||w-1-right<w*.025||right-left<w*.45||white(Math.min(w-1,left+4))>.15||white(Math.max(0,right-4))>.15)return null;
 const x=Math.round(left/w*W),width=Math.round((right-left+1)/w*W),out=document.createElement('canvas');out.width=width;out.height=H;out.getContext('2d').drawImage(image,x,0,width,H,0,0,width,H);
 return {canvas:out,x,y:0,width,height:H};
};
/* Browser-local document border proposals and content-preserving selection. */
/* Document boundary verification: browser-local pixels, bounded working resolution.
   Independent candidates recover shadowed paper and partially hidden borders.
   Ambiguous frame contours retain the full source for manual review. */
(function () {
"use strict";
/* A second, independent candidate for pale paper on coloured/busy surfaces.
   Connected paper area and straight boundary support are required; the ML
   candidate remains available for coloured cards and ambiguous scenes. */
function detectPaperBoundary(image, prior, neutral = false, bridgeInk = false) {
  const W=image.naturalWidth||image.width,H=image.naturalHeight||image.height;
  const scale=Math.min(1,800/Math.max(W,H));
  const canvas=document.createElement('canvas');canvas.width=Math.round(W*scale);canvas.height=Math.round(H*scale);
  const w=canvas.width,h=canvas.height,ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,w,h);
  const rgba=ctx.getImageData(0,0,w,h).data,mask=new Uint8Array(w*h);
  for(let p=0;p<mask.length;p++) {
    const r=rgba[p*4],g=rgba[p*4+1],b=rgba[p*4+2],hi=Math.max(r,g,b),lo=Math.min(r,g,b);
    mask[p]=lo>(neutral ? 65 : 95) && (hi-lo)<hi*(neutral ? .12 : .19) ? 1:0;
  }
  if(bridgeInk){
    // Notebook ruling must not split one sheet into hundreds of components.
    const pass=(input,horizontal,erode)=>{const out=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=erode?1:0;for(let d=-2;d<=2;d++){const xx=horizontal?Math.max(0,Math.min(w-1,x+d)):x,yy=horizontal?y:Math.max(0,Math.min(h-1,y+d)),p=input[yy*w+xx];if(erode&&!p){v=0;break;}if(!erode&&p){v=1;break;}}out[y*w+x]=v;}return out;};
    mask.set(pass(pass(pass(pass(mask,true,false),false,false),true,true),false,true));
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
  if(bridgeInk){
    // A pale table or another sheet can join the page at one lower corner.
    // Recover the dominant bottom edge from many columns, with a visible
    // paper-to-scene transition, before that attachment expands the hull.
    const ends=new Int32Array(w).fill(-1);
    for(const p of largest)ends[p%w]=Math.max(ends[p%w],Math.floor(p/w));
    const samples=[];for(let x=Math.ceil(w*.06);x<w*.94;x+=Math.max(1,Math.floor(w/80)))if(ends[x]>h*.55)samples.push({x,y:ends[x]});
    let best=[];
    const tolerance=Math.max(3,h*.015);
    for(let a=0;a<samples.length;a++)for(let b=a+1;b<samples.length;b++){
      if(samples[b].x-samples[a].x<w*.4)continue;
      const slope=(samples[b].y-samples[a].y)/(samples[b].x-samples[a].x);if(Math.abs(slope)>.35)continue;
      const intercept=samples[a].y-slope*samples[a].x,inliers=samples.filter(p=>Math.abs(p.y-slope*p.x-intercept)<=tolerance);
      if(inliers.length>best.length)best=inliers;
    }
    if(best.length>=samples.length*.72&&best.length>=20&&best.at(-1).x-best[0].x>w*.65){
      const n=best.length,sx=best.reduce((s,p)=>s+p.x,0),sy=best.reduce((s,p)=>s+p.y,0),sxx=best.reduce((s,p)=>s+p.x*p.x,0),sxy=best.reduce((s,p)=>s+p.x*p.y,0);
      const slope=(n*sxy-sx*sy)/Math.max(1,n*sxx-sx*sx),intercept=(sy-slope*sx)/n;
      const offsets=best.map(p=>p.y-slope*p.x-intercept).sort((a,b)=>a-b),outset=offsets[Math.floor(offsets.length*.97)]+2;
      const luminance=(x,y)=>{if(y<0||y>=h)return null;const i=(Math.round(y)*w+x)*4;return .299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2];};
      let hits=0,used=0;
      for(const p of best){const y=slope*p.x+intercept,inside=luminance(p.x,y-5),outside=luminance(p.x,y+5);if(inside===null||outside===null)continue;used++;if(inside-outside>12)hits++;}
      if(used>=best.length*.8&&hits/used>=.65)largest=largest.filter(p=>Math.floor(p/w)<=slope*(p%w)+intercept+outset);
    }
  }
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
  let ordered=quad.map((_,i)=>quad[(i+first)%4]);
  if(bridgeInk){
    // A four-point approximation must cover the paper hull, not shave off a
    // curved notebook header or the bottom of a signature.
    const lines=ordered.map((a,i)=>{const b=ordered[(i+1)%4],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len;let offset=0;for(const p of hull)offset=Math.min(offset,(p.x-a.x)*nx+(p.y-a.y)*ny);return {a:{x:a.x+nx*offset,y:a.y+ny*offset},b:{x:b.x+nx*offset,y:b.y+ny*offset}};});
    const meet=(l,m)=>{const dx=l.b.x-l.a.x,dy=l.b.y-l.a.y,ux=m.b.x-m.a.x,uy=m.b.y-m.a.y,det=dx*uy-dy*ux;if(Math.abs(det)<1e-8)return null;const t=((m.a.x-l.a.x)*uy-(m.a.y-l.a.y)*ux)/det;return {x:Math.max(0,Math.min(w-1,l.a.x+t*dx)),y:Math.max(0,Math.min(h-1,l.a.y+t*dy))};};
    const expanded=ordered.map((_,i)=>meet(lines[(i+3)%4],lines[i]));if(expanded.every(Boolean))ordered=expanded;
  }
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


window.detectNeutralPaperBoundary=image=>detectPaperBoundary(image,null,true,true);
/* Refine an approximate document quadrilateral against nearby image edges.
   Keep the original prediction when the boundary is weak or inconsistent. */
function refineCandidateDocumentEdges(image, corners) {
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  const scale = Math.min(1, 1200 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const points = ['tl','tr','br','bl'].map(key => ({x: corners[key].x * scale, y: corners[key].y * scale}));
  const lengths = points.map((p,i) => Math.hypot(p.x-points[(i+1)%4].x,p.y-points[(i+1)%4].y));
  const radius = Math.max(4, Math.min(...lengths) * .035);
  const luminance = (x,y) => {
    if (x<1 || y<1 || x>=canvas.width-1 || y>=canvas.height-1) return null;
    const i=(Math.round(y)*canvas.width+Math.round(x))*4;
    return .299*data[i]+.587*data[i+1]+.114*data[i+2];
  };
  const median = list => {const sorted=list.slice().sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
  const fit = samples => {
    let n=samples.length, sx=0, sy=0, sxx=0, sxy=0;
    for (const p of samples) {sx+=p.t;sy+=p.d;sxx+=p.t*p.t;sxy+=p.t*p.d;}
    const slope=(n*sxy-sx*sy)/Math.max(1e-8,n*sxx-sx*sx);
    return {slope,intercept:(sy-slope*sx)/n};
  };
  const lines=[];
  for(let side=0;side<4;side++) {
    const a=points[side], b=points[(side+1)%4], len=lengths[side];
    if(len<25)return corners;
    const tx=(b.x-a.x)/len, ty=(b.y-a.y)/len, nx=-ty, ny=tx;
    const samples=[];
    // Sample most of each side so an occluded middle can use visible end segments.
    for(let k=0;k<40;k++) {
      const t=.04+.92*k/39, x=a.x+(b.x-a.x)*t, y=a.y+(b.y-a.y)*t;
      let best=null;
      for(let d=-Math.ceil(radius);d<=radius;d++) {
        let inside=0,outside=0,count=0;
        for(let v=-2;v<=2;v++) {
          const ip=luminance(x+nx*(d+3)+tx*v,y+ny*(d+3)+ty*v);
          const op=luminance(x+nx*(d-3)+tx*v,y+ny*(d-3)+ty*v);
          const nearIn=luminance(x+nx*(d+.8)+tx*v,y+ny*(d+.8)+ty*v);
          const nearOut=luminance(x+nx*(d-.8)+tx*v,y+ny*(d-.8)+ty*v);
          if(ip!==null&&op!==null&&nearIn!==null&&nearOut!==null){inside+=ip*.3+nearIn*.7;outside+=op*.3+nearOut*.7;count++;}
        }
        if(count<3)continue;
        const signed=(inside-outside)/count;
        const score=Math.abs(signed)-Math.abs(d)*.12;
        if(!best||score>best.score)best={t,d,score,signed};
      }
      if(best&&best.score>=6)samples.push(best);
    }
    if(samples.length<14){lines.push({a,b});continue;}
    const sign=Math.sign(median(samples.map(p=>p.signed)));
    let inliers=samples.filter(p=>Math.sign(p.signed)===sign);
    if(inliers.length<14){lines.push({a,b});continue;}
    // Median pairwise slopes avoids a few text/shadow edges pulling the fit.
    const slopes=[];
    for(let i=0;i<inliers.length;i++)for(let j=i+1;j<inliers.length;j++) {
      if(inliers[j].t-inliers[i].t>.2)slopes.push((inliers[j].d-inliers[i].d)/(inliers[j].t-inliers[i].t));
    }
    if(!slopes.length)return corners;
    const slope=median(slopes), intercept=median(inliers.map(p=>p.d-slope*p.t));
    inliers=inliers.filter(p=>Math.abs(p.d-intercept-slope*p.t)<3);
    if(inliers.length<14){lines.push({a,b});continue;}
    const line=fit(inliers);
    lines.push({a:{x:a.x+nx*line.intercept,y:a.y+ny*line.intercept},b:{x:b.x+nx*(line.intercept+line.slope),y:b.y+ny*(line.intercept+line.slope)}});
  }
  const intersect=(l,m)=>{
    const ux=l.b.x-l.a.x,uy=l.b.y-l.a.y,vx=m.b.x-m.a.x,vy=m.b.y-m.a.y;
    const det=ux*vy-uy*vx;
    if(Math.abs(det)<1e-6)return null;
    const t=((m.a.x-l.a.x)*vy-(m.a.y-l.a.y)*vx)/det;
    return {x:l.a.x+t*ux,y:l.a.y+t*uy};
  };
  const refined=points.map((p,i)=>intersect(lines[(i+3)%4],lines[i]));
  for(let i=0;i<4;i++) {
    const p=refined[i];
    if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>canvas.width||p.y>canvas.height||Math.hypot(p.x-points[i].x,p.y-points[i].y)>radius*2)return corners;
    const a=refined[(i+1)%4],b=refined[(i+2)%4];
    if(!a||!b||(a.x-p.x)*(b.y-a.y)-(a.y-p.y)*(b.x-a.x)<=0)return corners;
  }
  return Object.fromEntries(['tl','tr','br','bl'].map((key,i)=>[key,{x:refined[i].x/scale,y:refined[i].y/scale}]));
};

function refineColoredDocumentEdges(image, corners) {
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  const scale = Math.min(1, 1200 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const points = ['tl','tr','br','bl'].map(key => ({x: corners[key].x * scale, y: corners[key].y * scale}));
  const lengths = points.map((p,i) => Math.hypot(p.x-points[(i+1)%4].x,p.y-points[(i+1)%4].y));
  const radius = Math.max(4, Math.min(...lengths) * .035);
  const luminance = (x,y) => {
    if (x<1 || y<1 || x>=canvas.width-1 || y>=canvas.height-1) return null;
    const i=(Math.round(y)*canvas.width+Math.round(x))*4;
    return [data[i],data[i+1],data[i+2]];
  };
  const median = list => {const sorted=list.slice().sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
  const fit = samples => {
    let n=samples.length, sx=0, sy=0, sxx=0, sxy=0;
    for (const p of samples) {sx+=p.t;sy+=p.d;sxx+=p.t*p.t;sxy+=p.t*p.d;}
    const slope=(n*sxy-sx*sy)/Math.max(1e-8,n*sxx-sx*sx);
    return {slope,intercept:(sy-slope*sx)/n};
  };
  const lines=[];
  for(let side=0;side<4;side++) {
    const a=points[side], b=points[(side+1)%4], len=lengths[side];
    if(len<25)return corners;
    const tx=(b.x-a.x)/len, ty=(b.y-a.y)/len, nx=-ty, ny=tx;
    const samples=[];
    // Sample most of each side so an occluded middle can use visible end segments.
    for(let k=0;k<40;k++) {
      const t=.04+.92*k/39, x=a.x+(b.x-a.x)*t, y=a.y+(b.y-a.y)*t;
      let best=null;
      for(let d=-Math.ceil(radius);d<=radius;d++) {
        let inside=[0,0,0],outside=[0,0,0],count=0;
        for(let v=-2;v<=2;v++) {
          const ip=luminance(x+nx*(d+3)+tx*v,y+ny*(d+3)+ty*v);
          const op=luminance(x+nx*(d-3)+tx*v,y+ny*(d-3)+ty*v);
          const nearIn=luminance(x+nx*(d+.8)+tx*v,y+ny*(d+.8)+ty*v);
          const nearOut=luminance(x+nx*(d-.8)+tx*v,y+ny*(d-.8)+ty*v);
          if(ip!==null&&op!==null&&nearIn!==null&&nearOut!==null){for(let c=0;c<3;c++){inside[c]+=ip[c]*.3+nearIn[c]*.7;outside[c]+=op[c]*.3+nearOut[c]*.7;}count++;}
        }
        if(count<3)continue;
        // Equal-brightness coloured borders disappear in a grayscale gradient.
        // Use RGB contrast, with a consistent dominant-channel polarity, too.
        const difference=inside.map((v,c)=>(v-outside[c])/count);
        const dominant=difference.reduce((a,b)=>Math.abs(a)>Math.abs(b)?a:b);
        const signed=dominant;
        const score=Math.hypot(...difference)/Math.sqrt(3)-Math.abs(d)*.12;
        if(!best||score>best.score)best={t,d,score,signed};
      }
      if(best&&best.score>=6)samples.push(best);
    }
    if(samples.length<14){lines.push({a,b});continue;}
    const sign=Math.sign(median(samples.map(p=>p.signed)));
    let inliers=samples.filter(p=>Math.sign(p.signed)===sign);
    if(inliers.length<14){lines.push({a,b});continue;}
    // Median pairwise slopes avoids a few text/shadow edges pulling the fit.
    const slopes=[];
    for(let i=0;i<inliers.length;i++)for(let j=i+1;j<inliers.length;j++) {
      if(inliers[j].t-inliers[i].t>.2)slopes.push((inliers[j].d-inliers[i].d)/(inliers[j].t-inliers[i].t));
    }
    if(!slopes.length)return corners;
    const slope=median(slopes), intercept=median(inliers.map(p=>p.d-slope*p.t));
    inliers=inliers.filter(p=>Math.abs(p.d-intercept-slope*p.t)<3);
    if(inliers.length<14){lines.push({a,b});continue;}
    const line=fit(inliers);
    lines.push({a:{x:a.x+nx*line.intercept,y:a.y+ny*line.intercept},b:{x:b.x+nx*(line.intercept+line.slope),y:b.y+ny*(line.intercept+line.slope)}});
  }
  const intersect=(l,m)=>{
    const ux=l.b.x-l.a.x,uy=l.b.y-l.a.y,vx=m.b.x-m.a.x,vy=m.b.y-m.a.y;
    const det=ux*vy-uy*vx;
    if(Math.abs(det)<1e-6)return null;
    const t=((m.a.x-l.a.x)*vy-(m.a.y-l.a.y)*vx)/det;
    return {x:l.a.x+t*ux,y:l.a.y+t*uy};
  };
  const refined=points.map((p,i)=>intersect(lines[(i+3)%4],lines[i]));
  for(let i=0;i<4;i++) {
    const p=refined[i];
    if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>canvas.width||p.y>canvas.height||Math.hypot(p.x-points[i].x,p.y-points[i].y)>radius*2)return corners;
    const a=refined[(i+1)%4],b=refined[(i+2)%4];
    if(!a||!b||(a.x-p.x)*(b.y-a.y)-(a.y-p.y)*(b.x-a.x)<=0)return corners;
  }
  return Object.fromEntries(['tl','tr','br','bl'].map((key,i)=>[key,{x:refined[i].x/scale,y:refined[i].y/scale}]));
};

window.refineDocumentEdges=refineColoredDocumentEdges;
window.refineSelectedBoundary=function(image,result,headerExpanded=false){
  const keys=['tl','tr','br','bl'],W=image.naturalWidth||image.width,H=image.naturalHeight||image.height;
  const selected=result.candidates?.find(c=>c.corners===result.corners),quality=selected?.quality?.score;
  // Keep established outlines and content-preservation/header guards intact.
  if(headerExpanded||quality===undefined||quality<.25||quality>=.65)return result;
  const q=refineColoredDocumentEdges(image,result.corners),limit=Math.min(W,H)*.025;
  if(keys.some(k=>Math.hypot(q[k].x-result.corners[k].x,q[k].y-result.corners[k].y)>limit))return result;
  const scale=Math.min(1,800/Math.max(W,H)),c=document.createElement('canvas');c.width=Math.round(W*scale);c.height=Math.round(H*scale);const ctx=c.getContext('2d');ctx.drawImage(image,0,0,c.width,c.height);const px=ctx.getImageData(0,0,c.width,c.height).data;
  function support(quad){const sides=[];for(let side=0;side<4;side++){
    const a=quad[keys[side]],b=quad[keys[(side+1)%4]],dx=(b.x-a.x)*scale,dy=(b.y-a.y)*scale,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len;let hits=0,count=0;
    for(let j=0;j<30;j++){
      const t=.08+j*.84/29,x=(a.x+(b.x-a.x)*t)*scale,y=(a.y+(b.y-a.y)*t)*scale;
      const ix=Math.round(x+nx*2.5),iy=Math.round(y+ny*2.5),ox=Math.round(x-nx*2.5),oy=Math.round(y-ny*2.5);
      if(Math.min(ix,ox,iy,oy)<1||Math.max(ix,ox)>=c.width-1||Math.max(iy,oy)>=c.height-1)continue;
      const p=(iy*c.width+ix)*4,r=(oy*c.width+ox)*4;if(Math.hypot(px[p]-px[r],px[p+1]-px[r+1],px[p+2]-px[r+2])/Math.sqrt(3)>8)hits++;count++;
    }sides.push(count>=24?hits/count:0);
  }return sides;}
  const before=support(result.corners),after=support(q),mean=a=>a.reduce((s,x)=>s+x,0)/4;
  if(after.every(v=>v>=.65)&&mean(after)>=mean(before)+.18)return {...result,corners:q,selected_name:result.selected_name+'-color-edge-refined',uncertain:result.uncertain};
  return result;
};
/* Score actual boundary contrast rather than contour area alone. */
window.evaluateBoundaryCandidates = function(image, baseline, cvResult, ml, extras = []) {
 const W=image.naturalWidth||image.width,H=image.naturalHeight||image.height,keys=['tl','tr','br','bl'];
 const scale=Math.min(1,1100/Math.max(W,H)),canvas=document.createElement('canvas');canvas.width=Math.round(W*scale);canvas.height=Math.round(H*scale);
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data,w=canvas.width,h=canvas.height;
 const area=q=>Math.abs(keys.reduce((s,k,i)=>{const p=q[k],r=q[keys[(i+1)%4]];return s+p.x*r.y-p.y*r.x},0))/2;
 function valid(q){if(!q||!keys.every(k=>q[k]&&Number.isFinite(q[k].x)&&Number.isFinite(q[k].y)&&q[k].x>=-W*.005&&q[k].y>=-H*.005&&q[k].x<=W*1.005&&q[k].y<=H*1.005))return false;const p=keys.map(k=>q[k]);const signs=p.map((a,i)=>{const b=p[(i+1)%4],c=p[(i+2)%4];return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)});return signs.every(x=>x>0)&&area(q)>W*H*.04;}
 const sample=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x<1||y<1||x>=w-1||y>=h-1)return null;const i=(y*w+x)*4;return [pixels[i],pixels[i+1],pixels[i+2]]};
 function quality(q){if(!valid(q))return {score:-1,support:[0,0,0,0],area:0};const p=keys.map(k=>({x:q[k].x*scale,y:q[k].y*scale})),support=[],contrast=[];
  for(let i=0;i<4;i++){const a=p[i],b=p[(i+1)%4],len=Math.hypot(b.x-a.x,b.y-a.y),tx=(b.x-a.x)/len,ty=(b.y-a.y)/len,nx=-ty,ny=tx;let hits=0,strength=0,used=0;
   for(let j=0;j<40;j++){const t=.12+.76*j/39,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,inside=[0,0,0],outside=[0,0,0];let n=0;
    for(let v=-2;v<=2;v++){const ii=sample(x+nx*2.5+tx*v,y+ny*2.5+ty*v),oo=sample(x-nx*2.5+tx*v,y-ny*2.5+ty*v);if(ii&&oo){for(let k=0;k<3;k++){inside[k]+=ii[k];outside[k]+=oo[k]}n++;}}
    if(n<3)continue;const c=Math.hypot(...inside.map((v,k)=>(v-outside[k])/n))/Math.sqrt(3);if(c>=6)hits++;strength+=Math.min(1,c/32);used++;
   }
   support.push(used>=25?hits/used:0);contrast.push(used>=25?strength/used:0);
  }
  const avg=support.reduce((a,b)=>a+b,0)/4,min=support.slice().sort((a,b)=>a-b)[1],c=contrast.reduce((a,b)=>a+b,0)/4;return {score:.5*avg+.35*min+.15*c,support,contrast,area:area(q)/(W*H)};
 }
 const candidates=[{name:'baseline',corners:baseline},{name:'cv',corners:cvResult&&cvResult.corners},{name:'ml',corners:ml},...extras];
 for(const c of candidates){const q=c.corners;if(!q||!keys.every(k=>q[k]&&Number.isFinite(q[k].x)&&Number.isFinite(q[k].y)))continue;
  const nearFrame=keys.every(k=>q[k].x>=-W*.04&&q[k].y>=-H*.04&&q[k].x<=W*1.04&&q[k].y<=H*1.04);
  if(nearFrame&&keys.some(k=>q[k].x<0||q[k].y<0||q[k].x>W-1||q[k].y>H-1))c.corners=Object.fromEntries(keys.map(k=>[k,{x:Math.max(0,Math.min(W-1,q[k].x)),y:Math.max(0,Math.min(H-1,q[k].y))}]));
 }
 const paper=detectPaperBoundary(image,ml);candidates.push({name:'paper',corners:paper});const neutral=detectPaperBoundary(image,ml,true);candidates.push({name:'neutral-paper',corners:neutral});
 // A wrong model box must not veto an independently observed outer sheet.
 candidates.push({name:'independent-paper',corners:detectPaperBoundary(image,null,true,true)});
 for(const candidate of candidates.filter(c=>valid(c.corners)).sort((a,b)=>quality(b.corners).score-quality(a.corners).score).slice(0,12))if(valid(candidate.corners)){try{candidates.push({name:candidate.name+'-refined',corners:refineCandidateDocumentEdges(image,candidate.corners)})}catch{}}
 for(const c of candidates)c.quality=quality(c.corners);
 const base=candidates[0];let selected=base;const baseArea=valid(baseline)?area(baseline):0;
 for(const c of candidates.slice(1)){
  if(c.quality.score<0)continue;
  // A smaller inner panel must not replace a credible full-sheet candidate.
  if(baseArea&&base.quality.score>=.70&&base.quality.support.every(v=>v>=.55)&&area(c.corners)/baseArea<.70){c.rejected='nested-smaller-panel';continue;}
  const strongSides=c.quality.support.filter(v=>v>=.5).length;const largerOuter=valid(selected.corners)&&area(c.corners)>area(selected.corners)*1.12&&c.quality.support.every(v=>v>=.55)&&c.quality.score>=selected.quality.score-.10;if(c.quality.score>=.42&&strongSides>=3&&(c.quality.score>selected.quality.score+.07||largerOuter))selected=c;
 }
 let uncertain=selected.quality.score<.5;
 if(!valid(selected.corners)){selected={name:'invalid-full-frame',corners:{tl:{x:0,y:0},tr:{x:W,y:0},br:{x:W,y:H},bl:{x:0,y:H}},quality:selected.quality};}
 return {selected_name:selected.name,corners:selected.corners,uncertain,baseline_quality:base.quality,candidates};
};

function findPaperRegion(image) {
 const W=image.naturalWidth||image.width,H=image.naturalHeight||image.height,scale=Math.min(1,200/Math.max(W,H)),c=document.createElement('canvas');c.width=Math.round(W*scale);c.height=Math.round(H*scale);const w=c.width,h=c.height,ctx=c.getContext('2d');ctx.drawImage(image,0,0,w,h);const px=ctx.getImageData(0,0,w,h).data,raw=new Uint8Array(w*h),dil=new Uint8Array(w*h),mask=new Uint8Array(w*h);
 for(let i=0;i<raw.length;i++){const a=px[i*4],b=px[i*4+1],d=px[i*4+2],hi=Math.max(a,b,d),lo=Math.min(a,b,d);raw[i]=lo>55&&(hi-lo)<hi*.28?1:0;}
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(y+dy>=0&&y+dy<h&&x+dx>=0&&x+dx<w)v|=raw[(y+dy)*w+x+dx];dil[y*w+x]=v;}
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=1;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(y+dy>=0&&y+dy<h&&x+dx>=0&&x+dx<w)v&=dil[(y+dy)*w+x+dx];mask[y*w+x]=v;}

 // Ignore an added white picture frame only when the next strip contains
 // substantial photographic color/tones. Do not trim ordinary PDF margins.
 const nonWhite=(x,y)=>{const i=(y*w+x)*4;return Math.min(px[i],px[i+1],px[i+2])<244;};
 const rowDark=y=>{let n=0;for(let x=0;x<w;x++)if(nonWhite(x,y))n++;return n/w;};
 const colDark=x=>{let n=0;for(let y=0;y<h;y++)if(nonWhite(x,y))n++;return n/h;};
 let top=0,bottom=h-1,left=0,right=w-1;
 while(top<h*.12&&rowDark(top)<.02)top++;
 while(bottom>h*.88&&rowDark(bottom)<.02)bottom--;
 while(left<w*.12&&colDark(left)<.02)left++;
 while(right>w*.88&&colDark(right)<.02)right--;
 if(!top||top>=h*.12||rowDark(top)<.5)top=0;
 if(bottom===h-1||bottom<=h*.88||rowDark(bottom)<.5)bottom=h-1;
 if(!left||left>=w*.12||colDark(left)<.5)left=0;
 if(right===w-1||right<=w*.88||colDark(right)<.5)right=w-1;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(y<top||y>bottom||x<left||x>right)mask[y*w+x]=0;
 const queue=new Int32Array(w*h);let largest=[];
 for(let start=0;start<mask.length;start++){if(mask[start]!==1)continue;let head=0,tail=1;queue[0]=start;mask[start]=2;
  while(head<tail){const i=queue[head++],x=i%w;for(const q of [x>0?i-1:-1,x<w-1?i+1:-1,i>=w?i-w:-1,i<w*(h-1)?i+w:-1])if(q>=0&&mask[q]===1){mask[q]=2;queue[tail++]=q;}}
  if(tail>largest.length)largest=Array.from(queue.subarray(0,tail));
 }
 if(largest.length<w*h*.15||largest.length>w*h*.94)return null;
 let touch=0;if(largest.some(p=>p%w<=1))touch++;if(largest.some(p=>p%w>=w-2))touch++;if(largest.some(p=>Math.floor(p/w)<=1))touch++;if(largest.some(p=>Math.floor(p/w)>=h-2))touch++;
 if(touch>=3)return null;
 return {width:w,height:h,fraction:largest.length/(w*h),points:largest.filter((_,i)=>i%3===0).map(p=>({x:p%w,y:Math.floor(p/w)})),touch};
}

function findRuledContent(image) {
 const W=image.naturalWidth||image.width,H=image.naturalHeight||image.height,c=document.createElement('canvas'),scale=Math.min(1,300/Math.max(W,H));c.width=Math.round(W*scale);c.height=Math.round(H*scale);const w=c.width,h=c.height,ctx=c.getContext('2d');ctx.drawImage(image,0,0,w,h);const px=ctx.getImageData(0,0,w,h).data,rows=[];
 const lum=(x,y)=>{const i=(y*w+x)*4;return .299*px[i]+.587*px[i+1]+.114*px[i+2];};
 // Regular carpet texture can resemble ruled rows. Only apply this content
 // safeguard when at least one image corner has a smooth paper-like surface.
 const patchW=Math.max(4,Math.round(w*.12)),patchH=Math.max(4,Math.round(h*.12)),textures=[];
 for(const [x0,y0]of [[1,1],[w-patchW-1,1],[1,h-patchH-1],[w-patchW-1,h-patchH-1]]){let total=0,n=0;for(let y=Math.max(1,y0);y<Math.min(h-1,y0+patchH);y++)for(let x=Math.max(1,x0);x<Math.min(w-1,x0+patchW);x++){total+=Math.abs(lum(x,y)-(lum(x-1,y)+lum(x+1,y)+lum(x,y-1)+lum(x,y+1))/4);n++;}textures.push(total/Math.max(1,n));}
 if(textures.every(v=>v>4.5))return null;

 for(let y=2;y<h-2;y++){const points=[];for(let x=2;x<w-2;x++){const a=((y-2)*w+x)*4,b=((y+2)*w+x)*4;const rr=(px[a]+px[b])/2,gg=(px[a+1]+px[b+1])/2,bb=(px[a+2]+px[b+2])/2,hi=Math.max(rr,gg,bb),lo=Math.min(rr,gg,bb);if(lo<55||(hi-lo)>hi*.32)continue;const bg=(lum(x,y-2)+lum(x,y+2))/2;if(bg-lum(x,y)>4)points.push({x,y});}
  if(points.length>w*.30&&points.at(-1).x-points[0].x>w*.45){if(rows.length&&y-rows.at(-1).y<=2){if(points.length>rows.at(-1).points.length)rows[rows.length-1]={y,points};}else rows.push({y,points});}
 }
 if(rows.length<5)return null;const gaps=rows.slice(1).map((r,i)=>r.y-rows[i].y).sort((a,b)=>a-b),median=gaps[Math.floor(gaps.length/2)];if(median<3||gaps.filter(g=>Math.abs(g-median)<median*.5).length<gaps.length*.55)return null;
 return {width:w,height:h,textures,rows:rows.map(r=>({y:r.y,points:r.points.filter((_,i)=>i%3===0)}))};
}
window.rankBoundaryCandidates=function(image,row){
 const W=image.naturalWidth||image.width,H=image.naturalHeight||image.height,keys=['tl','tr','br','bl'],area=q=>Math.abs(keys.reduce((s,k,i)=>{const a=q[k],b=q[keys[(i+1)%4]];return s+a.x*b.y-a.y*b.x},0))/2;
 const region=findPaperRegion(image),rulings=findRuledContent(image),candidates=row.proposal.candidates.map(c=>({name:c.name,corners:c.corners,quality:c.quality}));
 const baseline=candidates.find(c=>c.name==='baseline');
 function valid(q){if(!q||!keys.every(k=>q[k]&&Number.isFinite(q[k].x)&&Number.isFinite(q[k].y)))return false;const p=keys.map(k=>q[k]);return p.every((a,i)=>{const b=p[(i+1)%4],d=p[(i+2)%4];return(b.x-a.x)*(d.y-b.y)-(b.y-a.y)*(d.x-b.x)>0;});}
 function aspect(q){const p=keys.map(k=>q[k]),e=p.map((a,i)=>Math.hypot(a.x-p[(i+1)%4].x,a.y-p[(i+1)%4].y));return Math.min(Math.max(e[0],e[2]),Math.max(e[1],e[3]))/Math.max(...e);}
 function coverage(q){if(!region)return 1;const p=keys.map(k=>({x:q[k].x/W*region.width,y:q[k].y/H*region.height}));let inside=0;for(const x of region.points)if(p.every((a,i)=>{const b=p[(i+1)%4],dx=b.x-a.x,dy=b.y-a.y;return dx*(x.y-a.y)-dy*(x.x-a.x)>=-1.5*Math.hypot(dx,dy);}))inside++;return inside/region.points.length;}

 function missingLines(q){if(!rulings)return 0;const p=keys.map(k=>({x:q[k].x/W*rulings.width,y:q[k].y/H*rulings.height}));return rulings.rows.filter(row=>row.points.filter(x=>p.every((a,i)=>{const b=p[(i+1)%4],dx=b.x-a.x,dy=b.y-a.y;return dx*(x.y-a.y)-dy*(x.x-a.x)>=-1.5*Math.hypot(dx,dy);})).length<row.points.length*.50).length;}
 const models=candidates.filter(c=>c.name==='ml'||/^ml-rotated-\d+$/.test(c.name)||/^ml-photo(?:-rotated-\d+)?$/.test(c.name)).filter(c=>valid(c.corners)&&aspect(c.corners)>=.45);
 function modelSupport(q){return models.filter(c=>keys.reduce((n,k)=>n+Math.hypot(c.corners[k].x-q[k].x,c.corners[k].y-q[k].y),0)/4<Math.hypot(W,H)*.035).length;}
 // A sheet whose four sides all show a clear paper/scene edge is the page itself.
 // Text lines and printed rows can also exist in the background (maps, signs,
 // a second page), so they must not veto an outline that is this well supported.
 // A larger, comparably supported outline is still allowed to win later.
 function strongVisibleSheet(c){if(!c.quality||c.area>.9)return false;if(c.area>=.2)return c.quality.score>=.88&&c.quality.support.every(v=>v>=.78);
  // A small card/receipt needs near-perfect evidence on all four sides.
  return c.area>=.04&&c.quality.score>=.95&&c.quality.support.every(v=>v>=.9);}
 for(const c of candidates){if(!valid(c.corners)){c.reject='invalid';continue;}c.aspect=aspect(c.corners);c.coverage=coverage(c.corners);c.area=area(c.corners)/(W*H);c.modelSupport=modelSupport(c.corners);c.missingLines=missingLines(c.corners);c.score=c.quality.score+.06*Math.min(2,c.modelSupport);
  // A connected pale region can leak into similarly lit cloth. Override its
  // coverage veto only when rotations agree and an independent contour has
  // strong visible support on every side of the same outer outline.
  const confirmedOutline=c.modelSupport>=3&&c.area>=.10&&c.area<=.85&&c.quality.score>=.85&&c.quality.support.every(v=>v>=.70)&&candidates.some(other=>other.name.startsWith('contour-')&&other.quality.score>=.85&&other.quality.support.every(v=>v>=.70)&&valid(other.corners)&&keys.reduce((n,k)=>n+Math.hypot(other.corners[k].x-c.corners[k].x,other.corners[k].y-c.corners[k].y),0)/4<Math.hypot(W,H)*.025);
  if(c.aspect<.45)c.reject='thin-inner-region';else if(region&&c.coverage<.95&&!confirmedOutline)c.reject='cuts-paper-region';else if(c.area<.10&&area(row.old)/(W*H)>.45)c.reject='tiny-inner-object';else if(rulings&&c.missingLines>=2&&c.missingLines>rulings.rows.length*.12&&!strongVisibleSheet(c))c.reject='cuts-ruled-content';
 }
 let selected=baseline;const baseScore=baseline.quality.score,baseArea=valid(baseline.corners)?area(baseline.corners):0;
 for(const c of candidates){if(c.reject||c===baseline)continue;
  if(baseScore>=.7&&baseline.quality.support.every(x=>x>=.55)&&baseArea&&area(c.corners)<baseArea*.75){c.reject='strong-outer-boundary';continue;}
  if(!region&&baseArea&&area(c.corners)<baseArea*.70&&c.modelSupport<2&&!strongVisibleSheet(c)){c.reject='unconfirmed-small-region';continue;}
  const strong=c.quality.support.filter(v=>v>=.45).length;
  const modelAgreement=c.modelSupport>=2&&c.area>=.10&&c.quality.score>=.25&&c.quality.support.filter(v=>v>=.20).length>=3;if((c.quality.score<.40||strong<3)&&!modelAgreement)continue;
  const refinedSameOutline=c.name===selected.name+'-refined'&&c.score>selected.score+.025&&keys.reduce((n,k)=>n+Math.hypot(c.corners[k].x-selected.corners[k].x,c.corners[k].y-selected.corners[k].y),0)/4<Math.hypot(W,H)*.025;
  if(selected.reject||c.score>selected.score+.10||refinedSameOutline||(c.area>selected.area*1.12&&c.score>=selected.score-.06&&c.coverage>=selected.coverage))selected=c;
 }

 if(selected.reject==='cuts-ruled-content'){
  // Do not emit a crop known to remove multiple ruled rows. If a PDF scan
  // has a clear photographic rectangle and empty white padding, retain that
  // entire rectangle; otherwise retain the source for explicit review.
  const c=document.createElement('canvas');c.width=200;c.height=Math.max(1,Math.round(200*H/W));const ctx=c.getContext('2d');ctx.drawImage(image,0,0,c.width,c.height);const px=ctx.getImageData(0,0,c.width,c.height).data,w=c.width,h=c.height;
  const dark=(x,y)=>{const i=(y*w+x)*4;return Math.min(px[i],px[i+1],px[i+2])<244;};const row=y=>{let n=0;for(let x=0;x<w;x++)if(dark(x,y))n++;return n/w;};const col=x=>{let n=0;for(let y=0;y<h;y++)if(dark(x,y))n++;return n/h;};
  let top=0,bottom=h-1,left=0,right=w-1;while(top<h-1&&row(top)<.02)top++;while(bottom>top&&row(bottom)<.02)bottom--;while(left<w-1&&col(left)<.02)left++;while(right>left&&col(right)<.02)right--;
  if(row(top)<.5)top=0;if(row(bottom)<.5)bottom=h-1;if(col(left)<.5)left=0;if(col(right)<.5)right=w-1;
  if(bottom-top<h*.15||right-left<w*.15){top=0;bottom=h-1;left=0;right=w-1;}
  const q={tl:{x:left/w*W,y:top/h*H},tr:{x:(right+1)/w*W,y:top/h*H},br:{x:(right+1)/w*W,y:(bottom+1)/h*H},bl:{x:left/w*W,y:(bottom+1)/h*H}};
  selected={name:'preserve-ruled-content',corners:q,quality:{score:.35,support:[0,0,0,0]}};
 }
 return {selected_name:selected.name,corners:selected.corners,uncertain:selected.quality.score<.5,ruled_rows:rulings?.rows.length||0,paper_region:region?{fraction:region.fraction,touch:region.touch}:null,candidates};
};
})();


window.collectContourCandidates = function(image) {
  const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height,scale=Math.min(1,800/Math.max(width,height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  const mats=[],take=x=>(mats.push(x),x),results=[],total=canvas.width*canvas.height;
  function collect(mask,name){
    const contours=new cv.MatVector(),hierarchy=new cv.Mat();
    try {cv.findContours(mask,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
      for(let i=0;i<contours.size();i++) {const contour=contours.get(i);let hull,approx;
        try {const a=cv.contourArea(contour);if(a<total*.025||a>total*.985)continue;
          hull=new cv.Mat();cv.convexHull(contour,hull,false,true);const perimeter=cv.arcLength(hull,true);
          for(const epsilon of [.012,.025,.045]) {approx=new cv.Mat();cv.approxPolyDP(hull,approx,perimeter*epsilon,true);
            if(approx.rows===4){const points=[];for(let j=0;j<4;j++)points.push({x:approx.data32S[j*2]/scale,y:approx.data32S[j*2+1]/scale});const q=_sortCorners(points);
              if(new Set(['tl','tr','br','bl'].map(k=>q[k].x+','+q[k].y)).size===4&&_scoreQuad(q,width*height)>0){
                const duplicate=results.some(r=>['tl','tr','br','bl'].reduce((s,k)=>s+Math.hypot(q[k].x-r.corners[k].x,q[k].y-r.corners[k].y),0)/4<Math.max(width,height)*.009);
                if(!duplicate)results.push({name:'contour-'+name,corners:q});
              }
              approx.delete();approx=null;break;
            }approx.delete();approx=null;
          }
        }finally{approx?.delete();hull?.delete();contour.delete();}
      }
    }finally{contours.delete();hierarchy.delete();}
  }
  try {
    // Blue/cyan cloth can have almost the same brightness as a pale card.
    // Use its colour only when independent corner patches agree that this
    // colour belongs to the surrounding surface, then score the actual edges.
    const rgba=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    const blue=i=>rgba[i+2]-rgba[i]>Math.max(10,rgba[i+2]*.06)&&rgba[i+1]-rgba[i]>4;
    const patchW=Math.max(5,Math.round(canvas.width*.09)),patchH=Math.max(5,Math.round(canvas.height*.07));
    let blueCorners=0;
    for(const [left,top]of [[0,0],[canvas.width-patchW,0],[0,canvas.height-patchH],[canvas.width-patchW,canvas.height-patchH]]){let hits=0;for(let y=top;y<top+patchH;y++)for(let x=left;x<left+patchW;x++)if(blue((y*canvas.width+x)*4))hits++;if(hits/(patchW*patchH)>.65)blueCorners++;}
    if(blueCorners>=3){
      const mask=take(new cv.Mat(canvas.height,canvas.width,cv.CV_8UC1)),closed=take(new cv.Mat()),kernel=take(cv.Mat.ones(5,5,cv.CV_8U));
      for(let i=0;i<total;i++)mask.data[i]=blue(i*4)?0:255;
      cv.morphologyEx(mask,closed,cv.MORPH_CLOSE,kernel);collect(closed,'blue-surface');
    }
    const source=take(cv.imread(canvas)),gray=take(new cv.Mat()),equalized=take(new cv.Mat());cv.cvtColor(source,gray,cv.COLOR_RGBA2GRAY);cv.equalizeHist(gray,equalized);
    for(const [name,input,blur,lo,hi]of [['raw',gray,5,35,110],['equalized',equalized,5,45,140],['soft',gray,9,15,50]]){
      const smooth=take(new cv.Mat()),edges=take(new cv.Mat()),closed=take(new cv.Mat()),kernel=take(cv.Mat.ones(5,5,cv.CV_8U));cv.GaussianBlur(input,smooth,new cv.Size(blur,blur),0);cv.Canny(smooth,edges,lo,hi);cv.morphologyEx(edges,closed,cv.MORPH_CLOSE,kernel);collect(closed,name);
    }
    for(const blur of [9,21]){
      const smooth=take(new cv.Mat());cv.GaussianBlur(gray,smooth,new cv.Size(blur,blur),0);
      for(const inverse of [false,true]){
        const threshold=take(new cv.Mat()),closed=take(new cv.Mat()),kernel=take(cv.Mat.ones(9,9,cv.CV_8U));cv.threshold(smooth,threshold,0,255,(inverse?cv.THRESH_BINARY_INV:cv.THRESH_BINARY)+cv.THRESH_OTSU);cv.morphologyEx(threshold,closed,cv.MORPH_CLOSE,kernel);collect(closed,'otsu-'+blur+'-'+inverse);
      }
    }
    return results.slice(0,70);
  }finally{mats.forEach(m=>m.delete());}
};
window.rotatedModelCandidates=async function(image,detect){
 const W=image.naturalWidth||image.width,H=image.naturalHeight||image.height,results=[];
 for(const angle of [90,180,270]){
  // DocAligner consumes a 256px square. Rotating a full 16MP photo first
  // allocates large temporary images without giving the model more detail.
  const side=256,c=document.createElement('canvas');c.width=c.height=side;const ctx=c.getContext('2d');ctx.translate(side/2,side/2);ctx.rotate(angle*Math.PI/180);ctx.drawImage(image,-side/2,-side/2,side,side);
  const q=await detect(c);c.width=c.height=1;if(!q)continue;const back=p=>angle===90?{x:p.y/side*W,y:(1-p.x/side)*H}:angle===180?{x:(1-p.x/side)*W,y:(1-p.y/side)*H}:{x:(1-p.y/side)*W,y:p.x/side*H};const points=['tl','tr','br','bl'].map(k=>back(q[k]));results.push({name:'ml-rotated-'+angle,corners:_sortCorners(points)});
 }
 return results;
};



/* A tight inner panel (printed table, ID photo box, model rectangle) must not
   discard header, margin or signature text that continues on the same sheet.
   Each side moves outward only while connected text-like ink keeps appearing
   on paper-coloured surroundings. Capped, never shrinks, never leaves the frame. */
window.recoverClippedContent=function(image,corners){
 const keys=['tl','tr','br','bl'],W=image.naturalWidth||image.width,H=image.naturalHeight||image.height;
 if(!corners||!keys.every(k=>corners[k]&&Number.isFinite(corners[k].x)&&Number.isFinite(corners[k].y)))return {corners,changed:false};
 const scale=Math.min(1,520/Math.max(W,H)),w=Math.max(1,Math.round(W*scale)),h=Math.max(1,Math.round(H*scale)),c=document.createElement('canvas');c.width=w;c.height=h;
 const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,w,h);const px=ctx.getImageData(0,0,w,h).data;
 const lum=new Float32Array(w*h);for(let i=0;i<lum.length;i++)lum[i]=.299*px[i*4]+.587*px[i*4+1]+.114*px[i*4+2];
 const P=keys.map(k=>({x:corners[k].x*scale,y:corners[k].y*scale}));
 const cx=P.reduce((s,p)=>s+p.x,0)/4,cy=P.reduce((s,p)=>s+p.y,0)/4;
 // Paper brightness from the interior of the current selection.
 const inside=[];for(let u=.1;u<=.9;u+=.04)for(let v=.1;v<=.9;v+=.04){const top={x:P[0].x+(P[1].x-P[0].x)*u,y:P[0].y+(P[1].y-P[0].y)*u},bot={x:P[3].x+(P[2].x-P[3].x)*u,y:P[3].y+(P[2].y-P[3].y)*u},x=Math.round(top.x+(bot.x-top.x)*v),y=Math.round(top.y+(bot.y-top.y)*v);if(x>=0&&y>=0&&x<w&&y<h)inside.push(lum[y*w+x]);}
 if(inside.length<30)return {corners,changed:false};inside.sort((a,b)=>a-b);const paper=inside[Math.floor(inside.length*.75)];
 if(paper<120)return {corners,changed:false};// dark or photographic interior: no reliable paper tone
 const dark=paper*.62,bright=paper*.82;
 const at=(x,y)=>{x=Math.round(x);y=Math.round(y);return x<1||y<1||x>=w-1||y>=h-1?null:lum[y*w+x];};
 // Text-like: dark stroke with bright paper on both sides, in a mostly paper-toned neighbourhood.
 function ink(x,y,nx,ny){const v=at(x,y);if(v===null||v>dark)return false;const a=at(x+nx*4,y+ny*4),b=at(x-nx*4,y-ny*4),l=at(x-ny*4,y+nx*4),r=at(x+ny*4,y-nx*4);
  const near=[a,b,l,r].filter(t=>t!==null&&t>=bright).length;if(near<2)return false;
  let paperLike=0,n=0;for(let dy=-6;dy<=6;dy+=3)for(let dx=-6;dx<=6;dx+=3){const t=at(x+dx,y+dy);if(t===null)continue;n++;if(t>=bright)paperLike++;}return n>0&&paperLike/n>=.55;}
 const dims=P.map((a,i)=>Math.hypot(P[(i+1)%4].x-a.x,P[(i+1)%4].y-a.y)),shifts=[0,0,0,0],limit=[.14,.14,.14,.14];
 for(let side=0;side<4;side++){
  const a=P[side],b=P[(side+1)%4],len=dims[side];if(len<20)continue;const tx=(b.x-a.x)/len,ty=(b.y-a.y)/len;let nx=ty,ny=-tx;
  const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;if((mx+nx*5-cx)*(mx-cx)+(my+ny*5-cy)*(my-cy)<0){nx=-nx;ny=-ny;}
  const perp=Math.min(dims[(side+1)%4],dims[(side+3)%4]),maxD=Math.max(6,perp*limit[side]),gapMax=Math.max(4,perp*.03),reach=[];let hits=0,samples=0;
  for(let j=0;j<40;j++){const t=.04+.92*j/39,sx=a.x+(b.x-a.x)*t,sy=a.y+(b.y-a.y)*t;samples++;let last=0,gap=0;
   for(let d=2;d<=maxD;d+=1){let found=false;for(let k=-1;k<=1&&!found;k++)found=ink(sx+nx*d+tx*k*2,sy+ny*d+ty*k*2,nx,ny);
    if(found){last=d;gap=0;}else if(++gap>gapMax)break;}
   if(last>0){hits++;reach.push(last);}}
  if(hits<samples*.2||hits<6)continue;reach.sort((p,q)=>p-q);shifts[side]=reach[Math.floor(reach.length*.9)]+Math.max(2,perp*.012);
 }
 if(shifts.every(v=>v<=0))return {corners,changed:false};
 const lines=P.map((a,i)=>{const b=P[(i+1)%4],len=dims[i],tx=(b.x-a.x)/len,ty=(b.y-a.y)/len;let nx=ty,ny=-tx;const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;if((mx+nx*5-cx)*(mx-cx)+(my+ny*5-cy)*(my-cy)<0){nx=-nx;ny=-ny;}return {x:a.x+nx*shifts[i],y:a.y+ny*shifts[i],dx:tx,dy:ty};});
 const meet=(p,q)=>{const det=p.dx*q.dy-p.dy*q.dx;if(Math.abs(det)<1e-6)return null;const t=((q.x-p.x)*q.dy-(q.y-p.y)*q.dx)/det;return {x:p.x+p.dx*t,y:p.y+p.dy*t};};
 const out={};for(let i=0;i<4;i++){const q=meet(lines[(i+3)%4],lines[i]);if(!q)return {corners,changed:false};out[keys[i]]={x:Math.max(0,Math.min(W,q.x/scale)),y:Math.max(0,Math.min(H,q.y/scale))};}
 return {corners:out,changed:true,shifts:shifts.map(v=>v/scale)};
};
window.extendClippedNeutralHeader=function(image,corners){
 const W=image.naturalWidth||image.width,H=image.naturalHeight||image.height,keys=['tl','tr','br','bl'];if(!corners||!keys.every(k=>corners[k]))return {corners,changed:false};
 const width=Math.max(Math.hypot(corners.tr.x-corners.tl.x,corners.tr.y-corners.tl.y),Math.hypot(corners.br.x-corners.bl.x,corners.br.y-corners.bl.y)),height=Math.min(Math.hypot(corners.bl.x-corners.tl.x,corners.bl.y-corners.tl.y),Math.hypot(corners.br.x-corners.tr.x,corners.br.y-corners.tr.y));
 if(height<width*1.15)return {corners,changed:false};const scale=Math.min(1,800/Math.max(W,H)),c=document.createElement('canvas');c.width=Math.round(W*scale);c.height=Math.round(H*scale);const ctx=c.getContext('2d');ctx.drawImage(image,0,0,c.width,c.height);const px=ctx.getImageData(0,0,c.width,c.height).data;
 const a={x:corners.tl.x*scale,y:corners.tl.y*scale},b={x:corners.tr.x*scale,y:corners.tr.y*scale},len=Math.hypot(b.x-a.x,b.y-a.y),nx=(b.y-a.y)/len,ny=-(b.x-a.x)/len,max=Math.min(100,height*scale*.12),ends=[];
 function color(x,y){x=Math.round(x);y=Math.round(y);if(x<3||y<3||x>=c.width-3||y>=c.height-3)return null;const rgb=[0,0,0];for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const i=((y+dy)*c.width+x+dx)*4;rgb[0]+=px[i];rgb[1]+=px[i+1];rgb[2]+=px[i+2];}const hi=Math.max(...rgb),lo=Math.min(...rgb);return {saturation:(hi-lo)/Math.max(1,hi),rgb:rgb.map(v=>v/25)};}
 for(const t of [.15,.5,.85]){const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,first=color(x+nx*3,y+ny*3);if(!first||first.saturation>.24)return {corners,changed:false};let end=null;
  for(let d=5;d<=max;d+=2){const p=color(x+nx*d,y+ny*d),q=color(x+nx*(d+2),y+ny*(d+2));if(!p||!q)break;if(p.saturation>.38&&q.saturation>.38){end=d;break;}}
  if(end===null||end<height*scale*.008)return {corners,changed:false};ends.push(end);
 }
 if(Math.max(...ends)-Math.min(...ends)>height*scale*.06)return {corners,changed:false};const distance=(Math.max(...ends)+2)/scale,out=JSON.parse(JSON.stringify(corners));for(const k of ['tl','tr']){out[k].x+=nx*distance;out[k].y+=ny*distance;if(out[k].x<0||out[k].y<0||out[k].x>W||out[k].y>H)return {corners,changed:false};}
 return {corners:out,changed:true,distancePx:distance};
};


window.guardUnsupportedFrame=function(image,result){
 const W=image.naturalWidth||image.width,H=image.naturalHeight||image.height,q=result.corners,keys=['tl','tr','br','bl'];const selected=result.candidates?.find(c=>c.corners===q)||result.candidates?.find(c=>c.name===result.selected_name&&JSON.stringify(c.corners)===JSON.stringify(q));
 const score=selected?.quality?.score??.35;const touches=keys.filter(k=>q[k].x<W*.01||q[k].y<H*.01||q[k].x>W*.99||q[k].y>H*.99).length;
 const unconfirmed=score<.40&&(selected?.modelSupport||0)<2;
 if((score<.20&&touches>=3)||(result.uncertain&&unconfirmed)||(selected?.reject&&!result.selected_name.endsWith('-verified-card'))){
  let corners={tl:{x:0,y:0},tr:{x:W,y:0},br:{x:W,y:H},bl:{x:0,y:H}};
  const frame=window.getScanPhotoFrame(image);
  if(frame){corners={tl:{x:frame.x,y:0},tr:{x:frame.x+frame.width,y:0},br:{x:frame.x+frame.width,y:H},bl:{x:frame.x,y:H}};frame.canvas.width=frame.canvas.height=1;}
  return {...result,selected_name:'unsupported-frame-preserved',corners,uncertain:true};
 }
 return result;
};

/* A patterned surface can look like ruled paper. Only override that rejection
   for a card-sized outline independently confirmed by models and contours. */
window.recoverVerifiedCard=function(image,result){
 const W=image.naturalWidth||image.width,H=image.naturalHeight||image.height,keys=['tl','tr','br','bl'];
 if(result.paper_region||result.selected_name!=='baseline')return result;
 const baseline=result.candidates?.find(c=>c.name==='baseline');
 if(!baseline||baseline.area<.6)return result;
 const touches=keys.filter(k=>baseline.corners[k].x<W*.01||baseline.corners[k].y<H*.01||baseline.corners[k].x>W*.99||baseline.corners[k].y>H*.99).length;
 if(touches<2)return result;
 const eligible=result.candidates.filter(c=>c.reject==='cuts-ruled-content'&&c.area>=.10&&c.area<=.5&&c.aspect>=.52&&c.aspect<=.72&&c.modelSupport>=3&&c.quality.score>=.85&&c.quality.support.every(v=>v>=.6));
 for(const c of eligible.sort((a,b)=>b.score-a.score)){
  const contour=result.candidates.some(other=>other.name.startsWith('contour-')&&other.quality.score>=.75&&keys.reduce((s,k)=>s+Math.hypot(other.corners[k].x-c.corners[k].x,other.corners[k].y-c.corners[k].y),0)/4<Math.hypot(W,H)*.025);
  if(contour)return {...result,corners:c.corners,selected_name:c.name+'-verified-card',uncertain:false};
 }
 return result;
};

(function(){
 const choose=(image,baseline,cvResult,ml,extras=[])=>{
  const proposal=window.evaluateBoundaryCandidates(image,baseline,cvResult,ml,extras);
  const selected=window.guardUnsupportedFrame(image,window.recoverVerifiedCard(image,window.rankBoundaryCandidates(image,{old:baseline,proposal})));
  const header=window.extendClippedNeutralHeader(image,selected.corners);
  if(header.changed){selected.corners=header.corners;selected.selected_name+='-header-expanded';}
  const keys=['tl','tr','br','bl'],width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
  const measured=selected.candidates?.find(candidate=>candidate.corners===selected.corners)?.quality?.score||0;
  const noPrediction=!ml&&!(cvResult?.score>0)&&!extras.some(candidate=>candidate.name.startsWith('ml'))&&measured<.4;
  if(noPrediction||!keys.every(key=>selected.corners?.[key]&&Number.isFinite(selected.corners[key].x)&&Number.isFinite(selected.corners[key].y))){
    return {...selected,selected_name:'no-reliable-boundary',corners:{tl:{x:0,y:0},tr:{x:width,y:0},br:{x:width,y:height},bl:{x:0,y:height}},uncertain:true};
  }
  const refined=window.refineSelectedBoundary(image,selected,header.changed);
  // Only a weakly supported tight panel can be hiding clipped text; a clear,
  // well-supported sheet or card outline is left exactly as measured.
  const q=refined&&refined.candidates?.find(c=>c.corners===selected.corners)?.quality;
  const weak=!q||q.score<.80||Math.min(...q.support)<.55;
  if(weak&&!refined.uncertain||weak&&refined.uncertain){
   try{const grown=window.recoverClippedContent(image,refined.corners);if(grown.changed){refined.corners=grown.corners;refined.selected_name+='-content-recovered';refined.contentShifts=grown.shifts;}}catch(error){console.warn('Clipped-content recovery unavailable:',error);}
  }
  return refined;
 };
 // Keep the synchronous entry point for clients with an older crop script.
 window.selectDocumentBoundary=(image,baseline,cvResult,ml)=>choose(image,baseline,cvResult,ml);
 window.improveDocumentBoundary=async(image,baseline,cvResult,ml,detectModel)=>{
  const extras=[];
  const frame=window.getScanPhotoFrame(image);
  if(frame){
    try{
      const map=q=>Object.fromEntries(['tl','tr','br','bl'].map(k=>[k,{x:q[k].x+frame.x,y:q[k].y+frame.y}]));
      const q=window.detectNeutralPaperBoundary(frame.canvas);if(q)extras.push({name:'padded-paper',corners:map(q)});
      if(detectModel){try{
        const photo=await detectModel(frame.canvas);if(photo)extras.push({name:'ml-photo',corners:map(photo)});
        for(const candidate of await window.rotatedModelCandidates(frame.canvas,detectModel))extras.push({name:candidate.name.replace('ml-','ml-photo-'),corners:map(candidate.corners)});
      }catch(error){console.warn('Photo-only model candidates unavailable:',error);}}
    }
    finally{frame.canvas.width=frame.canvas.height=1;}
  }
  if(window.cvReady&&typeof cv!=='undefined'&&cv.Mat){try{extras.push(...window.collectContourCandidates(image));}catch(error){console.warn('Additional border candidates unavailable:',error);}}
  if(detectModel){try{extras.push(...await window.rotatedModelCandidates(image,detectModel));}catch(error){console.warn('Rotated model candidates unavailable:',error);}}
  return {...choose(image,baseline,cvResult,ml,extras),hasPhotoPadding:!!frame};
 };
})();
