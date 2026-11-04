/* Worker-only canvas adapter. OpenCV sees native RGBA pixels without a DOM. */
self.window=self;
self.document={createElement:()=>new OffscreenCanvas(1,1),getElementById:()=>null};
self.loadScriptOnce=async url=>importScripts(url);
self.scanCvReady=(async()=>{
 try{
  importScripts('../vendor/opencv/opencv.js');
  const started=Date.now();
  while(!self.cv?.Mat){if(Date.now()-started>30000)throw new Error('OpenCV initialization timed out');await new Promise(resolve=>setTimeout(resolve,20));}
  cv.imread=canvas=>cv.matFromImageData(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height));
  cv.imshow=(canvas,source)=>{let rgba=source,temporary;
   try{if(source.channels()!==4){temporary=new cv.Mat();cv.cvtColor(source,temporary,source.channels()===1?cv.COLOR_GRAY2RGBA:cv.COLOR_RGB2RGBA);rgba=temporary;}
    canvas.width=rgba.cols;canvas.height=rgba.rows;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.data),rgba.cols,rgba.rows),0,0);
   }finally{temporary?.delete();}
  };
  self.cvReady=true;return true;
 }catch(error){console.warn('Worker OpenCV unavailable:',error);self.cvReady=false;return false;}
})();
