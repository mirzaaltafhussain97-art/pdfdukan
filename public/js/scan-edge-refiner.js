/* Refine an approximate document quadrilateral against nearby image edges.
   Keep the original prediction when the boundary is weak or inconsistent. */
window.refineDocumentEdges = function (image, corners) {
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
    // Ignore rounded corners: fit the straight middle of each edge.
    for(let k=0;k<40;k++) {
      const t=.14+.72*k/39, x=a.x+(b.x-a.x)*t, y=a.y+(b.y-a.y)*t;
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
      if(best&&best.score>=12)samples.push(best);
    }
    if(samples.length<22)return corners;
    const sign=Math.sign(median(samples.map(p=>p.signed)));
    let inliers=samples.filter(p=>Math.sign(p.signed)===sign);
    if(inliers.length<22)return corners;
    // Median pairwise slopes avoids a few text/shadow edges pulling the fit.
    const slopes=[];
    for(let i=0;i<inliers.length;i++)for(let j=i+1;j<inliers.length;j++) {
      if(inliers[j].t-inliers[i].t>.2)slopes.push((inliers[j].d-inliers[i].d)/(inliers[j].t-inliers[i].t));
    }
    if(!slopes.length)return corners;
    const slope=median(slopes), intercept=median(inliers.map(p=>p.d-slope*p.t));
    inliers=inliers.filter(p=>Math.abs(p.d-intercept-slope*p.t)<3);
    if(inliers.length<22)return corners;
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
