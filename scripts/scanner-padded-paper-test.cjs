const fs=require('node:fs'),assert=require('node:assert/strict');
const {createCanvas}=require(process.env.PDFDUKAN_CANVAS);
const window={},document={createElement:()=>createCanvas(1,1)};
new Function('window','document',fs.readFileSync('public/js/document-boundary.js','utf8'))(window,document);
const c=createCanvas(640,800),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,640,800);ctx.fillStyle='#244a31';ctx.fillRect(60,0,520,800);
ctx.fillStyle='#c4bdb7';ctx.beginPath();ctx.moveTo(60,50);ctx.quadraticCurveTo(320,-50,580,50);ctx.lineTo(580,700);ctx.quadraticCurveTo(320,750,60,700);ctx.closePath();ctx.fill();
ctx.strokeStyle='#333';ctx.lineWidth=2;for(let y=85;y<685;y+=16){ctx.beginPath();ctx.moveTo(60,y);ctx.lineTo(580,y);ctx.stroke();}for(let x=75;x<580;x+=16){ctx.beginPath();ctx.moveTo(x,80);ctx.lineTo(x,700);ctx.stroke();}
const frame=window.getScanPhotoFrame(c);assert.ok(frame,'Detect actual photograph between external white bands');
assert.ok(Math.abs(frame.x-60)<=3);const q=window.detectNeutralPaperBoundary(frame.canvas);assert.ok(q,'Ruled grid must not split the page into tiny components');
assert.ok(Math.min(q.tl.y,q.tr.y)<4,'Curved top reaching the photo edge must be preserved');assert.ok(Math.max(q.bl.y,q.br.y)<780,'Remove the visible dark surface below the paper');assert.ok(Math.min(q.bl.y,q.br.y)>695,'Do not cut off bottom page content');
const scan=createCanvas(640,800),sc=scan.getContext('2d');sc.fillStyle='white';sc.fillRect(0,0,640,800);sc.fillStyle='#222';for(let y=90;y<700;y+=22)sc.fillRect(100,y,440,2);assert.equal(window.getScanPhotoFrame(scan),null,'Ordinary white scanned-page margins are not photographic letterboxing');
const inner={tl:{x:100,y:200},tr:{x:540,y:200},br:{x:540,y:500},bl:{x:100,y:500}},candidate={name:'baseline',corners:inner,quality:{score:.2},modelSupport:0};
const guarded=window.guardUnsupportedFrame(scan,{selected_name:'baseline',corners:inner,uncertain:true,candidates:[candidate]});
assert.equal(guarded.corners.tl.y,0,'A weak inner panel must not cut off the document header');assert.equal(guarded.corners.br.y,800,'A weak inner panel must not cut off lower document content');
const card={...candidate,quality:{score:.95},modelSupport:3,reject:'cuts-ruled-content'},verified={selected_name:'ml-verified-card',corners:inner,uncertain:false,candidates:[card]};
assert.equal(window.guardUnsupportedFrame(scan,verified),verified,'Independent verified-card evidence must retain its recovered physical crop');
console.log('PASS: padded photograph isolated; ruled paper stays connected; curved header preserved; bottom scene removed; white scan margins retained.');
