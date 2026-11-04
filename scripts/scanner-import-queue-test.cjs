const fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync('public/js/scanner.js','utf8');
const functions=source.slice(source.indexOf('  async function _importImage('),source.indexOf('  function _saveCurrent('));
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function pending(h){for(let i=0;i<100&&!h.requests.length;i++)await tick();assert.ok(h.requests.length,'Background detector started');return h.requests.shift();}
function harness(){
 const state={pages:[],editingIndex:-1,screen:'filter',applyToAll:false,currentFilter:'magicpro',adjustments:{}},requests=[],fields={};
 const detector={async setImageAsync(image){this.img=image;this.corners={tl:{x:1,y:1},tr:{x:9,y:1},br:{x:9,y:19},bl:{x:1,y:19}};this.legacyCorners=this.corners;await new Promise(resolve=>requests.push({image,resolve}));},async perspectiveCrop(){return {source:this.img.name,width:8,height:18};}};
 const edit=index=>{state.editingIndex=index;state.current=state.pages[index].id;};
 const api=new Function('state','autoCropEditor','$','_editPage','_renderPages','requestAnimationFrame',`let autoTask=null,importing=false,busy=false;const copy=x=>JSON.parse(JSON.stringify(x));const window={cvReady:false};${functions};return {add:_importImage,start:_queueAutoCrops,invalidate:_invalidateAuto,task:()=>autoTask};`)(state,detector,id=>fields[id]||(fields[id]={}),edit,()=>{},cb=>setTimeout(cb,0));
 return {...api,state,requests,edit};
}
async function add(h,name){const image={name,width:10,height:20};await h.add(image,{filter:'magicpro',adjustments:{}},name);return h.state.pages.at(-1);}
(async()=>{
 const h=harness(),a=await add(h,'A.jpg'),b=await add(h,'B.jpg');
 assert.equal(h.state.pages.length,2);assert.equal(h.requests.length,0,'Import must expose original pages without waiting for detection');assert.equal(a.croppedImg,a.sourceImg);
 h.start();const task=h.task(),first=await pending(h);assert.equal(first.image.name,'A.jpg');
 h.state.pages.reverse();h.edit(0);first.resolve();const second=await pending(h);
 assert.equal(a.croppedImg.source,'A.jpg','Completed detection belongs to its original page object after reorder');assert.equal(h.state.current,b.id,'Background A must not change selected B');
 const manual={source:'manual B'};h.invalidate(b);b.croppedImg=manual;second.resolve();await task;assert.equal(b.croppedImg,manual,'In-flight auto-crop must not overwrite a manual/original-image edit');
 const d=harness(),removed=await add(d,'delete.jpg'),kept=await add(d,'keep.jpg');d.start();const dt=d.task(),job=await pending(d);d.state.pages.splice(0,1);d.edit(0);job.resolve();const next=await pending(d);next.resolve();await dt;assert.equal(d.state.pages.length,1);assert.equal(d.state.pages[0],kept);assert.ok(!d.state.pages.includes(removed),'Deleted page must not be reintroduced by its delayed result');
 console.log('PASS: originals appear before detection; reordered/deleted pages and manual edits keep their own results.');
})().catch(error=>{console.error(error);process.exitCode=1;});
