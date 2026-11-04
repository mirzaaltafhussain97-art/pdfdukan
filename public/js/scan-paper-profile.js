/* Remove small curved scene slivers after a verified paper crop. A column
   mapping follows the observed page edge, preserving the curved page content
   instead of cutting a straight strip through a heading. Only the automatic
   detector enables this for photos with verified external export padding. */
window.rectifyScanPaperBands=function(image){
  const W=image.naturalWidth||image.width,H=image.naturalHeight||image.height;
  const s=Math.min(1,640/Math.max(W,H)),c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(W*s));c.height=Math.max(1,Math.round(H*s));
  const ctx=c.getContext('2d');ctx.drawImage(image,0,0,c.width,c.height);
  const w=c.width,h=c.height,px=ctx.getImageData(0,0,w,h).data;
  if(w<80||h<100)return image;
  const paper=(x,y)=>{const i=(y*w+x)*4,r=px[i],g=px[i+1],b=px[i+2],hi=Math.max(r,g,b),lo=Math.min(r,g,b);return lo>70&&hi-lo<hi*.20;};
  let pale=0,n=0;for(let y=Math.round(h*.18);y<h*.82;y+=3)for(let x=Math.round(w*.08);x<w*.92;x+=3){n++;if(paper(x,y))pale++;}
  if(pale/n<.76)return image;
  const limit=Math.max(3,Math.floor(h*.075)),windowSize=5,top=new Float32Array(w),bottom=new Float32Array(w).fill(h-1);
  function edge(x,lower){
    for(let k=0;k<limit;k++){
      let count=0;
      for(let dy=0;dy<windowSize;dy++)for(let dx=-1;dx<=1;dx++){const y=lower?h-1-k-dy:k+dy;if(y>=0&&y<h&&paper(Math.max(0,Math.min(w-1,x+dx)),y))count++;}
      if(count>=windowSize*3*.8)return lower?h-1-k:k;
    }
    return lower?h-1:0;
  }
  for(let x=0;x<w;x++){top[x]=edge(x,false);bottom[x]=edge(x,true);}
  const smooth=values=>Float32Array.from(values,(_,x)=>{const list=[];for(let dx=-3;dx<=3;dx++)list.push(values[Math.max(0,Math.min(w-1,x+dx))]);list.sort((a,b)=>a-b);return list[3];});
  const t=smooth(top),b=smooth(bottom);
  // A narrow stamp/signature at the page edge cannot trigger a page-wide warp.
  const changedTop=Array.from(t).filter(y=>y>=2).length/w>=.3,changedBottom=Array.from(b).filter(y=>h-1-y>=2).length/w>=.3;
  if(!changedTop&&!changedBottom)return image;
  if(!changedTop)t.fill(0);if(!changedBottom)b.fill(h-1);
  function fitCurve(values,lower){
    // Fit a continuous edge, rather than following pixel-sized changes in
    // ruling/ink. Discontinuous column offsets would kink otherwise smooth text.
    const a=Array.from({length:3},()=>[0,0,0,0]);
    for(let x=0;x<w;x++){const u=2*x/(w-1)-1,v=[1,u,u*u];for(let i=0;i<3;i++){for(let j=0;j<3;j++)a[i][j]+=v[i]*v[j];a[i][3]+=v[i]*values[x];}}
    for(let i=0;i<3;i++){const p=a[i][i];if(Math.abs(p)<1e-8)return values;for(let j=i;j<4;j++)a[i][j]/=p;for(let k=0;k<3;k++)if(k!==i){const f=a[k][i];for(let j=i;j<4;j++)a[k][j]-=f*a[i][j];}}
    const predict=x=>{const u=2*x/(w-1)-1;return a[0][3]+a[1][3]*u+a[2][3]*u*u;};
    const errors=Array.from(values,(y,x)=>y-predict(x)).sort((a,b)=>a-b),offset=errors[Math.floor((w-1)*(lower?.97:.03))]+(lower?1:-1);
    return Float32Array.from(values,(_,x)=>Math.max(lower?h-1-limit:0,Math.min(lower?h-1:limit,predict(x)+offset)));
  }
  const upper=changedTop?fitCurve(t,false):t,lower=changedBottom?fitCurve(b,true):b;
  const heights=Array.from(lower,(y,x)=>y-upper[x]+1).sort((a,b)=>a-b),out=document.createElement('canvas');
  out.width=W;out.height=Math.max(100,Math.round(heights[Math.floor(w/2)]/h*H));
  const starts=new Float32Array(W),spans=new Float32Array(W);
  for(let x=0;x<W;x++){const at=Math.max(0,Math.min(w-1,(x+.5)/W*w-.5)),lo=Math.floor(at),hi=Math.min(w-1,lo+1),f=at-lo;starts[x]=(upper[lo]*(1-f)+upper[hi]*f)/h*H;spans[x]=(lower[lo]*(1-f)+lower[hi]*f+1)/h*H-starts[x];}
  // Sample continuously between source rows. Independent drawImage strips can
  // round each column differently and produce visible steps in printed rules.
  c.width=W;c.height=H;ctx.drawImage(image,0,0,W,H);const source=ctx.getImageData(0,0,W,H).data,target=out.getContext('2d'),result=target.createImageData(W,out.height),dst=result.data;
  for(let y=0;y<out.height;y++){const v=(y+.5)/out.height;for(let x=0;x<W;x++){const sy=Math.max(0,Math.min(H-1,starts[x]+spans[x]*v-.5)),a=Math.floor(sy),b=Math.min(H-1,a+1),f=sy-a,i=(a*W+x)*4,j=(b*W+x)*4,k=(y*W+x)*4;for(let ch=0;ch<4;ch++)dst[k+ch]=source[i+ch]*(1-f)+source[j+ch]*f;}}
  target.putImageData(result,0,0);c.width=c.height=1;
  return out;
};
