importScripts('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
let doc,index=0;
self.onmessage=({data})=>{try{
 if(data.method==='start'){doc=new jspdf.jsPDF({orientation:data.orientation,unit:'mm',format:data.pageSize,compress:true});index=0;self.postMessage({id:data.id});}
 else if(data.method==='page'){if(index++)doc.addPage();const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),r=data.width/data.height;let w=W,h=W/r;if(h>H){h=H;w=H*r;}doc.addImage(new Uint8Array(data.bytes),data.format||'JPEG',(W-w)/2,(H-h)/2,w,h,undefined,'FAST');self.postMessage({id:data.id,page:index});}
 else if(data.method==='finish'){const bytes=doc.output('arraybuffer');self.postMessage({id:data.id,bytes},[bytes]);doc=null;}
 }catch(error){self.postMessage({id:data.id,error:error.message});}};
