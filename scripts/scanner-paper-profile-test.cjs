const fs=require('node:fs'),assert=require('node:assert/strict');
const {createCanvas,loadImage}=require(process.env.PDFDUKAN_CANVAS),window={},document={createElement:()=>createCanvas(1,1)};
new Function('window','document',fs.readFileSync('public/js/scan-paper-profile.js','utf8'))(window,document);
const source=createCanvas(500,700),ctx=source.getContext('2d');ctx.fillStyle='#25452c';ctx.fillRect(0,0,500,700);
ctx.fillStyle='#e8e6e3';ctx.beginPath();ctx.moveTo(0,34);ctx.quadraticCurveTo(250,-10,500,34);ctx.lineTo(500,666);ctx.quadraticCurveTo(250,700,0,666);ctx.closePath();ctx.fill();
ctx.fillStyle='#202020';ctx.fillRect(225,22,50,5);ctx.fillStyle='#f01818';ctx.fillRect(225,650,50,5);
const fixed=window.rectifyScanPaperBands(source);assert.notEqual(fixed,source,'Observed curved paper borders need correction');
const data=fixed.getContext('2d').getImageData(0,0,fixed.width,fixed.height).data;let dark=0,red=0;
for(let y=0;y<fixed.height;y++)for(let x=200;x<300;x++){const i=(y*fixed.width+x)*4;if(data[i]<65&&data[i+1]<65&&data[i+2]<65)dark++;if(data[i]>180&&data[i+1]<80&&data[i+2]<80)red++;}
for(let i=0;i<data.length;i+=4){assert.equal(data[i+3],255,'No empty holes may be introduced inside an opaque page');assert.ok(Math.max(data[i],data[i+1],data[i+2])<=240,'Crop must sample source pixels, not paint white over document areas');}
assert.ok(dark>170,'Curved top heading must survive');assert.ok(red>170,'Bottom signature/mark must survive');
const scan=createCanvas(500,700),sc=scan.getContext('2d');sc.fillStyle='#fff';sc.fillRect(0,0,500,700);sc.fillStyle='#222';sc.fillRect(225,2,50,8);assert.equal(window.rectifyScanPaperBands(scan),scan,'A narrow mark at the edge is not a page boundary');
console.log('PASS: curved scene slivers removed without cutting the top heading or bottom mark; flat scan and edge stamp remain unchanged.');
(async()=>{for(const id of ['f0018','f0019','f0020','f0021','f0022','f0023','f0024','f0025']){const input=await loadImage('output/scanner-notebook-review-20261103/'+id+'-crop.jpg'),out=window.rectifyScanPaperBands(input),saved=createCanvas(out.width,out.height);saved.getContext('2d').drawImage(out,0,0);fs.writeFileSync('output/scanner-notebook-review-20261103/'+id+'-profile.jpg',saved.toBuffer('image/jpeg'));console.log(id+': '+(input===out?'unchanged':'edge profile corrected'));}})().catch(e=>{console.error(e);process.exitCode=1;});
