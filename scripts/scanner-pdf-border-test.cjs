const fs=require('node:fs'),assert=require('node:assert/strict');const{createCanvas,loadImage}=require(process.env.PDFDUKAN_CANVAS),source=fs.readFileSync('public/js/filters.js','utf8');
function engine(disable){const window={};new Function('window',source+(disable?'\n_scanPhotoFrame=()=>null;':''))(window);return window;}
const before=engine(true),after=engine(false);
(async()=>{
 const root='output/scanner-pdf-edges-20261103',image=await loadImage(root+'/padded-page-13-source.png'),sheet=createCanvas(1080,820),ctx=sheet.getContext('2d');ctx.fillStyle='#eee';ctx.fillRect(0,0,1080,820);ctx.font='17px sans-serif';ctx.fillStyle='#222';ctx.fillText('Previous: white PDF frame enters the lighting estimate',14,24);ctx.fillText('Updated: photo lighting estimated separately',554,24);
 for(const[e,i]of [[before,0],[after,1]]){const c=createCanvas(image.width,image.height);c.getContext('2d').drawImage(image,0,0);e.applyFilterToContext(c.getContext('2d'),c.width,c.height,'magicpro');const s=Math.min(520/c.width,780/c.height);ctx.drawImage(c,i*540+(540-c.width*s)/2,35,c.width*s,c.height*s);fs.writeFileSync(root+(i?'/padded-after.png':'/padded-before.png'),c.toBuffer('image/png'));}
 fs.writeFileSync(root+'/padded-comparison.jpg',sheet.toBuffer('image/jpeg'));
 const c=createCanvas(600,800),x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,600,800);x.fillStyle='#aaa';x.fillRect(40,50,520,700);x.fillStyle='#222';x.fillRect(180,190,150,4);x.fillStyle='#9b9b9b';x.fillRect(180,260,150,3);x.fillStyle='#c22';x.fillRect(350,500,30,10);x.fillStyle='#333';x.fillRect(530,775,20,4);
 const original=x.getImageData(0,0,600,800).data;after.applyFilterToContext(x,600,800,'magicpro');const p=x.getImageData(0,0,600,800).data;
 for(const[a,b]of [[0,0],[535,776],[200,20],[20,200]]){const i=(b*600+a)*4;assert.deepEqual([...p.subarray(i,i+4)],[...original.subarray(i,i+4)],'Outer PDF margins and footer must remain pixel-identical');}
 const at=(a,b)=>[...p.subarray((b*600+a)*4,(b*600+a)*4+4)];assert.ok(at(220,191)[0]<80,'Dark writing retained');assert.ok(at(220,261)[0]<at(220,280)[0]-10,'Faint writing retained');assert.ok(at(360,505)[0]>at(360,505)[1]+30,'Red signature/stamp retained');
 console.log('PASS: photo/frame illumination separation; exact outer margins/footer; dark and faint text and colored stamp retained.');
})().catch(e=>{console.error(e);process.exitCode=1;});
