/* Offline pixel review. Model/contour predictions are retained browser evidence;
   selection and paper detection run against the current source. This is not a
   substitute for a fresh browser import. No originals are modified. */
const fs=require('node:fs'),path=require('node:path');
const {createCanvas,loadImage}=require(process.env.PDFDUKAN_CANVAS);
const mixed=process.argv.includes('--mixed');
const root=path.resolve(mixed?'output/scanner-mixed-review-20261103':'output/scanner-notebook-review-20261103');
const prior=path.resolve('output/scanner-corner-repair-20261102');
fs.mkdirSync(root,{recursive:true});
const document={createElement:()=>createCanvas(1,1),getElementById:()=>null},window={};
new Function('window','document','setTimeout',fs.readFileSync('public/js/crop.js','utf8')+'\nwindow.warpForReview=_perspectiveWarpCanvas;window.reviewSort=_sortCorners;')(window,document,()=>{});
new Function('window','document','cv','_sortCorners',fs.readFileSync('public/js/document-boundary.js','utf8'))(window,document,{Mat:true},window.reviewSort);
const keys=['tl','tr','br','bl'],entries=JSON.parse(fs.readFileSync(prior+'/cases.json')).cases;
const requested=process.argv.slice(2).filter(a=>!a.startsWith('--'));
const ids=requested.length?requested:mixed?['f0074','f0076','f0014','f0158','f0171','f0262','f0281','f0184','f0001','f0043','f0087','f0110','f0140','f0180','f0342']:['f0018','f0019','f0020','f0021','f0022','f0023','f0024','f0025'];
const results=[];
let rpc,detectModel;
if(process.argv.includes('--fresh-photo')){
 const {spawn}=require('node:child_process'),readline=require('node:readline');let next=0;const pending=new Map();
 rpc=spawn('C:/Users/ANM/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['scripts/scanner-model-rpc.py'],{stdio:['pipe','pipe','inherit'],windowsHide:true,env:{...process.env,HF_HUB_OFFLINE:'1'}});
 readline.createInterface({input:rpc.stdout}).on('line',line=>{try{const row=JSON.parse(line),job=pending.get(row.id);if(job){pending.delete(row.id);row.error?job.reject(new Error(row.error)):job.resolve(row.points);}}catch(error){console.error(error);}});
 detectModel=async image=>{const c=createCanvas(256,256);c.getContext('2d').drawImage(image,0,0,256,256);const rgba=Buffer.from(c.getContext('2d').getImageData(0,0,256,256).data).toString('base64'),id=++next;const pts=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});rpc.stdin.write(JSON.stringify({id,rgba})+'\n');});return pts?window.reviewSort([0,1,2,3].map(i=>({x:pts[i*2]*image.width,y:pts[i*2+1]*image.height}))):null;};
}
function outline(ctx,q,s,color){ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();keys.forEach((k,i)=>ctx[i?'lineTo':'moveTo'](q[k].x*s,q[k].y*s));ctx.closePath();ctx.stroke();}
(async()=>{
 for(const id of ids){
  const entry=entries.find(e=>e.id===id),old=JSON.parse(fs.readFileSync(prior+'/runs-v1/'+id+'.json'));
  const raw=await loadImage(entry.path),size=old.workSize||[raw.width,raw.height],image=createCanvas(...size);image.getContext('2d').drawImage(raw,0,0,...size);
  const extras=(old.proposal?.candidates||[]).filter(c=>c.corners&&!['baseline','cv','ml','paper','neutral-paper'].includes(c.name)&&!c.name.endsWith('-refined')).map(c=>({name:c.name,corners:c.corners}));
  window.cvReady=true;window.collectContourCandidates=()=>extras;
  // Fresh model results supplement retained CV contours in this source test.
  const result=await window.improveDocumentBoundary(image,old.old,old.cv,old.ml,detectModel);
  const s=Math.min(1,720/Math.max(...size)),small=createCanvas(Math.round(size[0]*s),Math.round(size[1]*s));small.getContext('2d').drawImage(image,0,0,small.width,small.height);
  const q=Object.fromEntries(keys.map(k=>[k,{x:result.corners[k].x*s,y:result.corners[k].y*s}]));
  const width=Math.round(Math.max(Math.hypot(q.tl.x-q.tr.x,q.tl.y-q.tr.y),Math.hypot(q.bl.x-q.br.x,q.bl.y-q.br.y))),height=Math.round(Math.max(Math.hypot(q.tl.x-q.bl.x,q.tl.y-q.bl.y),Math.hypot(q.tr.x-q.br.x,q.tr.y-q.br.y)));
  const cropped=window.warpForReview(small,q,width,height);fs.writeFileSync(root+'/'+id+'-crop.jpg',cropped.toBuffer('image/jpeg'));
  const context=small.getContext('2d');outline(context,old.old,s,'#ff5e3a');outline(context,result.corners,s,'#00d1ad');fs.writeFileSync(root+'/'+id+'-outline.jpg',small.toBuffer('image/jpeg'));
  const row={id,path:entry.path,size,evidence:{retainedCV:true,retainedPrimaryModel:true,freshRotatedModel:!!detectModel,canvasRuntime:'native'},selected:result.selected_name,uncertain:result.uncertain,corners:result.corners,candidates:result.candidates?.map(c=>({name:c.name,corners:c.corners,quality:c.quality,score:c.score,reject:c.reject,missingLines:c.missingLines,coverage:c.coverage,area:c.area,modelSupport:c.modelSupport}))};
  fs.writeFileSync(root+'/'+id+'.json',JSON.stringify(row,null,2));results.push(row);console.log(JSON.stringify({id,selected:row.selected,uncertain:row.uncertain,padded:row.candidates.filter(c=>c.name.startsWith('padded-paper'))}));
 }
 rpc?.stdin.end();fs.writeFileSync(root+'/results.json',JSON.stringify(results,null,2));
 const sheet=createCanvas(960,Math.ceil(ids.length/2)*520),ctx=sheet.getContext('2d');ctx.fillStyle='#e5e7eb';ctx.fillRect(0,0,sheet.width,sheet.height);
 for(let i=0;i<ids.length;i++){const im=await loadImage(root+'/'+ids[i]+'-outline.jpg'),x=(i%2)*480,y=Math.floor(i/2)*520,s=Math.min(460/im.width,475/im.height);ctx.drawImage(im,x+(480-im.width*s)/2,y+32,im.width*s,im.height*s);ctx.fillStyle='#111';ctx.font='16px sans-serif';ctx.fillText(ids[i]+' '+results[i].selected,x+10,y+22);}
 fs.writeFileSync(root+'/review.jpg',sheet.toBuffer('image/jpeg'));
})().catch(e=>{rpc?.kill();console.error(e);process.exitCode=1;});
