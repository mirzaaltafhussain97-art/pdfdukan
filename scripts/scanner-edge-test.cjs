const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const w=640,h=800;
const keys=['tl','tr','br','bl'];
function check(name,truth,initial,blank=false) {
  const pixels=new Uint8ClampedArray(w*h*4);
  const poly=keys.map(k=>truth[k]);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const inside=poly.every((p,i)=>{const q=poly[(i+1)%4];return (q.x-p.x)*(y-p.y)-(q.y-p.y)*(x-p.x)>=0;});
    const value=blank?180:(inside?220:65)+((x*19+y*31)%13)-6;
    const i=(y*w+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=value;pixels[i+3]=255;
  }
  const context={window:{},document:{createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:pixels})})})}};
  vm.runInNewContext(fs.readFileSync('public/js/scan-edge-refiner.js','utf8'),context);
  const result=context.window.refineDocumentEdges({width:w,height:h},initial);
  if(blank)assert.equal(result,initial,'Blank image must retain the existing corners');
  else {
    const error=keys.reduce((sum,k)=>sum+Math.hypot(result[k].x-truth[k].x,result[k].y-truth[k].y),0)/4;
    assert.ok(error<3,name+': corner error '+error);
    console.log(name+': mean corner error '+error.toFixed(2)+'px');
  }
}
check('Straight card',{tl:{x:85,y:100},tr:{x:530,y:100},br:{x:530,y:705},bl:{x:85,y:705}},
  {tl:{x:90,y:105},tr:{x:525,y:96},br:{x:535,y:700},bl:{x:80,y:710}});
check('Perspective card',{tl:{x:95,y:90},tr:{x:520,y:115},br:{x:550,y:705},bl:{x:60,y:735}},
  {tl:{x:100,y:97},tr:{x:514,y:109},br:{x:556,y:700},bl:{x:65,y:730}});
const bounds={tl:{x:80,y:100},tr:{x:530,y:100},br:{x:530,y:700},bl:{x:80,y:700}};
check('Blank image',bounds,bounds,true);
console.log('Edge-refinement tests passed; weak boundaries retain the prediction.');
