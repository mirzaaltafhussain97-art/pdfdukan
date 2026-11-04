const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const scope={window:{},console};vm.runInNewContext(fs.readFileSync('public/js/filters.js','utf8'),scope);
function process(input,w,h,filter){let data=new Uint8ClampedArray(input);const ctx={getImageData:()=>({data}),putImageData:p=>{data=p.data;}};scope.window.applyFilterToContext(ctx,w,h,filter);return data;}
const w=256,h=320,pixels=new Uint8ClampedArray(w*h*4);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
 let value=135+x*85/(w-1);if(x>=40&&x<216&&y>=100&&y<104)value*=.9;if(x>=40&&x<216&&y>=200&&y<204)value*=.2;
 const i=(y*w+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=value;pixels[i+3]=255;
}
const magic=process(pixels,w,h,'magicpro');
for(const x of [60,128,196]){
 const paper=magic[(92*w+x)*4],faint=magic[(101*w+x)*4],dark=magic[(201*w+x)*4];
 assert.ok(paper-faint>=18,'Magic Color erased faint ink at x='+x+': '+paper+' / '+faint);
 assert.ok(dark<40,'Dark text must remain dark');
}
const small=new Uint8ClampedArray([20,60,120,255,100,150,200,91]);
assert.deepEqual(process(process(small,2,1,'invert'),2,1,'invert'),small,'Double inversion must restore every color and alpha value');
const gray=process(small,2,1,'grayscale');for(let i=0;i<gray.length;i+=4){assert.equal(gray[i],gray[i+1]);assert.equal(gray[i],gray[i+2]);assert.equal(gray[i+3],small[i+3]);}
console.log('PASS: faint ink survives Magic Color across uneven light; dark text retained; inversion reversible; grayscale/alpha correct.');
