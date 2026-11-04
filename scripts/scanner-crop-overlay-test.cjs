const fs=require('node:fs'),assert=require('node:assert/strict');const{createCanvas}=require(process.env.PDFDUKAN_CANVAS);
const window={},document={getElementById:()=>null,createElement:()=>createCanvas(1,1)};
new Function('window','document','setTimeout',fs.readFileSync('public/js/crop.js','utf8'))(window,document,()=>{});
const source=createCanvas(200,200),ctx=source.getContext('2d');ctx.fillStyle='#c0b0a0';ctx.fillRect(0,0,200,200);ctx.fillStyle='#202020';ctx.fillRect(95,95,10,10);
const editor=new window.CropEditor('test');editor.img=source;editor.canvas=createCanvas(200,200);editor.ctx=editor.canvas.getContext('2d');editor.corners={tl:{x:50,y:50},tr:{x:150,y:50},br:{x:150,y:150},bl:{x:50,y:150}};editor.draw();
const pixel=(c,x,y)=>Array.from(c.getContext('2d').getImageData(x,y,1,1).data);
assert.deepEqual(pixel(editor.canvas,116,116),pixel(source,100,100),'The text in the selected document must remain visible and opaque');
assert.deepEqual(pixel(editor.canvas,116,96),pixel(source,100,80),'The selected paper must not be tinted, painted or cleared');
assert.ok(pixel(editor.canvas,36,36)[0]<pixel(source,20,20)[0],'Only the excluded scene should be darkened');
assert.equal(pixel(editor.canvas,36,36)[3],255);
editor.fitFull();const corners=editor._scaledCorners(editor.scale);for(const p of Object.values(corners)){assert.ok(p.x>=16&&p.y>=16,'Handle centers must have space beyond the photo edge');assert.ok(p.x<=editor.canvas.width-15&&p.y<=editor.canvas.height-15,'Bottom/right handles must remain inside the canvas');}
console.log('PASS: crop overlay preserves exact paper/text pixels inside the selection; only the excluded scene is shaded.');
