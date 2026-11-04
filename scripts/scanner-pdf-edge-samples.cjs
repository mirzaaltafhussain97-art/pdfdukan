const fs=require('node:fs'),path=require('node:path');const{createCanvas,loadImage}=require(process.env.PDFDUKAN_CANVAS),window={};
new Function('window',fs.readFileSync('public/js/filters.js','utf8'))(window);
(async()=>{const root='output/scanner-pdf-edges-20261103',files=fs.readdirSync(root).filter(n=>n.endsWith('-source.jpg'));let n=0,sheet,ctx;
for(const file of files){const image=await loadImage(path.join(root,file)),s=Math.min(1,700/Math.max(image.width,image.height)),c=createCanvas(Math.round(image.width*s),Math.round(image.height*s));c.getContext('2d').drawImage(image,0,0,c.width,c.height);
if(n%3===0){sheet=createCanvas(1080,1620);ctx=sheet.getContext('2d');ctx.fillStyle='#eee';ctx.fillRect(0,0,1080,1620);}
const y=(n%3)*540;ctx.fillStyle='#222';ctx.font='16px sans-serif';ctx.fillText(file+' · original',10,y+20);ctx.fillText('Current Magic Pro',550,y+20);
function draw(x){const z=Math.min(520/c.width,500/c.height);ctx.drawImage(c,x+(520-c.width*z)/2,y+30,c.width*z,c.height*z);}
draw(0);window.applyFilterToContext(c.getContext('2d'),c.width,c.height,'magicpro');draw(540);fs.writeFileSync(path.join(root,file.replace('-source.jpg','-magic.jpg')),c.toBuffer('image/jpeg'));n++;
if(n%3===0||n===files.length)fs.writeFileSync(path.join(root,'compare-'+Math.ceil(n/3)+'.jpg'),sheet.toBuffer('image/jpeg'));
}console.log('Local original/Magic Pro comparisons ready.');})().catch(e=>{console.error(e);process.exitCode=1;});
