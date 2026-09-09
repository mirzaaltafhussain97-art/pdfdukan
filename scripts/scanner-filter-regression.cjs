const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createCanvas,loadImage}=require(process.env.PDFDUKAN_CANVAS);
const scope={window:{}};
vm.runInNewContext(fs.readFileSync('public/js/filters.js','utf8'),scope);
(async()=>{
 const card=await loadImage('tmp/scanner-card-review/after/original.png');
 fs.mkdirSync('tmp/filter-review',{recursive:true});
 for(const id of scope.window.FILTERS.map(f=>f.id)){
  const c=createCanvas(card.width,card.height),ctx=c.getContext('2d');ctx.drawImage(card,0,0);
  const start=performance.now();scope.window.applyFilterToContext(ctx,c.width,c.height,id);
  assert.equal(c.width,card.width);assert.equal(c.height,card.height);
  const data=ctx.getImageData(0,0,c.width,c.height).data;
  for(let i=3;i<data.length;i+=4)assert.equal(data[i],255);
  const previousPath='tmp/filter-review/card-'+id+'.png';
  if(process.argv.includes('--compare') && fs.existsSync(previousPath)){
    const previous=await loadImage(previousPath),old=createCanvas(c.width,c.height),oldCtx=old.getContext('2d');
    oldCtx.drawImage(previous,0,0);
    assert.deepEqual(data,oldCtx.getImageData(0,0,c.width,c.height).data,id+': optimization must preserve every pixel');
  }
  fs.writeFileSync('tmp/filter-review/card-'+id+'.png',c.toBuffer('image/png'));
  console.log(id+': '+Math.round(performance.now()-start)+'ms (offline, includes assertions and PNG encoding)');
 }
 const c=createCanvas(240,320),ctx=c.getContext('2d');ctx.fillStyle='#bebebe';ctx.fillRect(0,0,240,320);
 ctx.fillStyle='#8c8c8c';ctx.fillRect(100,80,2,140);
 scope.window.applyFilterToContext(ctx,240,320,'bw');
 assert.equal(ctx.getImageData(100,150,1,1).data[0],0,'Thin gray ink must survive');
 assert.equal(ctx.getImageData(40,150,1,1).data[0],255,'Paper must become white');
 console.log('PASS all 9 presets preserve dimensions/alpha; B&W retains thin ink on gray paper.');
})();
