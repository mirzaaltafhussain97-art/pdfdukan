// Caller-supplied photos and generated outputs stay in tmp, never public/.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PDFDUKAN_PLAYWRIGHT||'playwright');
const out=path.resolve('tmp/scanner-card-review',process.argv[3]||'current');
fs.mkdirSync(out,{recursive:true});
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
const page=await browser.newPage();const logs=[];
page.on('console',m=>{if(/detec|model|fail|error/i.test(m.text()))logs.push(m.text());});
await page.goto('http://localhost:3001/scanner.html',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>typeof CropEditor!=='undefined');
const result=await page.evaluate(async data=>{
const img=new Image();img.src='data:image/jpeg;base64,'+data;await img.decode();
const editor=new CropEditor('cropCanvas'),start=performance.now();await editor.setImageAsync(img);
const detectionMs=performance.now()-start,corners=editor.corners,cropped=await editor.perspectiveCrop();
const overlay=document.createElement('canvas');overlay.width=img.width;overlay.height=img.height;
const ctx=overlay.getContext('2d');ctx.drawImage(img,0,0);ctx.strokeStyle='#ff3b30';ctx.lineWidth=4;ctx.beginPath();
[corners.tl,corners.tr,corners.br,corners.bl].forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();
const outputs={corners:overlay.toDataURL()};
for(const f of ['original','enhance','magicpro','noshadow']){const c=await ScanRenderer.render(cropped,f);outputs[f]=c.toDataURL();}
return {corners,detectionMs,size:[cropped.width,cropped.height],badge:document.getElementById('detectionBadge')?.textContent,outputs};
},fs.readFileSync(process.argv[2]).toString('base64'));
for(const [name,url]of Object.entries(result.outputs))fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(url.split(',')[1],'base64'));
delete result.outputs;result.logs=logs;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
