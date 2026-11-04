/* Heavy detector/warp work owns an isolated worker. Jobs use IDs, never indexes. */
window.ScanProcessor=(()=>{
 const url=new URL('scan-crop-worker.js?v=20261104_autocrop',document.currentScript.src),available=typeof Worker!=='undefined'&&typeof createImageBitmap==='function'&&typeof OffscreenCanvas!=='undefined';
 let worker,sequence=0,running=false;const jobs=[];
 function start(){if(worker)return;worker=new Worker(url);}
 async function drain(){
  if(running||!jobs.length)return;running=true;const job=jobs.shift();
  try{
   if(!job.current()){job.resolve(null);return;}
   start();const bitmap=job.image?await createImageBitmap(job.image):null;
   const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Document processing timed out')),120000);
    worker.onmessage=({data})=>{if(data.id!==job.id)return;clearTimeout(timer);data.error?reject(new Error(data.error)):resolve(data);};
    worker.onerror=event=>{clearTimeout(timer);reject(new Error(event.message||'Document worker failed'));};
    worker.postMessage({id:job.id,method:job.method,bitmap,options:job.options},bitmap?[bitmap]:[]);
   });job.resolve(result);
  }catch(error){worker?.terminate();worker=null;job.reject(error);}
  finally{running=false;drain();}
 }
 function run(method,image,options={},current=()=>true){return new Promise((resolve,reject)=>{const job={id:++sequence,method,image,options,current,resolve,reject};if(method==='warp')jobs.unshift(job);else jobs.push(job);drain();});}
 return {available,detect:(image,options,current)=>run('detect',image,options,current),warp:(image,corners,options={})=>run('warp',image,{...options,corners}),warmup:()=>available?run('warmup',null):Promise.resolve()};
})();
