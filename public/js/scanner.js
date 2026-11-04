/* CamMaster: local document workspace. All source pixels stay in the browser. */
const ScannerApp = (() => {
  const state = {screen:'upload',pages:[],editingIndex:-1,currentFilter:'magicpro',adjustments:{brightness:0,contrast:0,sharpness:0,saturation:0},applyToAll:true};
  const $ = id => document.getElementById(id);
  const copy = value => JSON.parse(JSON.stringify(value));
  let cropEditor, autoCropEditor, autoTask=null, busy=false, importing=false, previewRevision=0, zoom=1, focusBeforeEditor;
  let sortable, pageDragging=false;
  const thumbnailJobs=new Map();
  let thumbnailTask=null;
  const MAX_IMAGE_PX=16_000_000;
  const filterIcons = {
    original:'▤', enhance:'<svg viewBox="0 0 40 40" fill="none"><path d="M5 32 18 7q2-3 4 0l13 25q1 3-3 3H8q-4 0-3-3" fill="currentColor"/><path d="m27 8 9 18q2 3 0 6h-5L22 14" fill="currentColor" opacity=".4"/></svg>',
    magicpro:'<span style="font-style:italic;font-weight:800">A<span style="font-size:24px">✦</span></span>',lighten:'<span style="color:#ffb800">☀</span>',
    noshadow:'<span style="color:#999">▧<small style="color:#fa7758">⊘</small></span>',bw:'<span style="color:black;letter-spacing:-14px;padding-right:14px">●<span style="color:white">●</span></span>',eco:'<span style="color:#333;letter-spacing:-14px;padding-right:14px">◯<span style="color:white">●</span></span>',handwriting:'<span style="color:#0785ff">〰<small style="color:#fa7758">⊘</small></span>'
  };
  function init(){
    cropEditor=new CropEditor('cropCanvas');
    autoCropEditor=new CropEditor('scanBackgroundCanvas');
    autoCropEditor.silent=true;
    _bindUploadZone(); _bindWorkspace(); _bindExportControls();
    showScreen('upload');
    if(typeof consumePendingFiles==='function'){const pending=consumePendingFiles();if(pending?.length)handleFiles(pending);}
    window.addEventListener('resize',_fitCrop);
    if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{if(state.screen==='crop')requestAnimationFrame(_fitCrop);}).observe($('screen-crop'));
    if(window.ScanProcessor?.available)ScanProcessor.warmup().then(()=>{const status=$('cvStatus');if(status){status.textContent='✓ Background scanner ready';status.className='cv-badge ready';}}).catch(error=>console.warn('Document worker warmup:',error));
    else if(window.loadScriptOnce)window.loadScriptOnce('/vendor/opencv/opencv.js').then(onOpenCvReady).catch(error=>console.warn('Scanner fallback:',error));
    window.ScanRenderer?.warmup().catch(error=>console.warn('Filter worker warmup:',error));
  }
  function _openEditor(){
    if($('scanEditor').hidden){focusBeforeEditor=document.activeElement;$('scanEditor').hidden=false;$('scanBackdrop').hidden=false;document.body.classList.add('scan-editor-open');$('scanClose').focus();}
  }
  function _closeEditor(){
    if(busy){toast('Please wait for the current page to finish.','warning');return;}
    _saveCurrent();$('scanEditor').hidden=true;$('scanBackdrop').hidden=true;document.body.classList.remove('scan-editor-open');
    $('resumeEditor').hidden=!state.pages.length;focusBeforeEditor?.focus();
  }
  function showScreen(name){
    if(name==='pages'){if(state.pages.length)_editPage(Math.max(0,state.editingIndex));else showScreen('upload');return;}
    state.screen=name;
    if(name==='upload'){$('screen-upload').classList.add('active');return;}
    _openEditor();$('scanEditor').dataset.mode=name;
    $('scanTools').inert=name==='crop';
    for(const s of ['crop','filter','export'])$('screen-'+s)?.classList.toggle('active',s===name);
    $('scanCropOptions').hidden=name!=='crop';$('scanCropToggle').setAttribute('aria-pressed',String(name==='crop'));
    const actions=name==='crop'?$('scanCropOptions'):$('scanEditorFooter');
    actions.append($('scanCancelCrop'),$('scanConfirm'));
    $('scanConfirm').textContent=name==='crop'?'Apply':name==='export'?'Back to Editor':'Confirm';
    $('scanCancelCrop').hidden=name!=='crop';$('scanOriginalImages').hidden=name==='crop'||name==='export';
    $('scanPreviewStatus').hidden=name!=='filter';$('scanZoom').hidden=name!=='filter';
    $('scanEditorTitle').textContent=name==='export'?'Export Documents':name==='crop'?'Adjust Crop':'Import Images';
    if(name==='crop')requestAnimationFrame(_fitCrop);
  }
  function _bindUploadZone(){
    const zone=$('uploadZone'),input=$('fileInputScanner'),pdf=$('fileInputPdfScan');
    for(const ev of ['dragenter','dragover'])zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.add('drag-over');});
    for(const ev of ['dragleave','drop'])zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.remove('drag-over');});
    zone.addEventListener('drop',e=>handleFiles([...e.dataTransfer.files]));
    zone.addEventListener('click',()=>input.click());zone.addEventListener('keydown',e=>{if(e.target===zone&&(e.key==='Enter'||e.key===' ')){e.preventDefault();input.click();}});
    for(const picker of [input,pdf])picker.addEventListener('change',e=>{handleFiles([...e.target.files]);picker.value='';});
    $('resumeEditor').onclick=()=>_editPage(Math.max(0,state.editingIndex));
  }
  async function _loadFile(file){
    const url=URL.createObjectURL(file);
    try{return await new Promise((resolve,reject)=>{const img=new Image();img.decoding='async';img.onload=()=>{const decoded=typeof img.decode==='function'?img.decode():Promise.resolve();decoded.then(()=>resolve(img),reject);};img.onerror=()=>reject(new Error('Image could not be read'));img.src=url;});}
    finally{URL.revokeObjectURL(url);}
  }
  async function _imageFromBlob(blob){return _loadFile(blob);}
  function _limitImage(img){
    const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;if(w*h<=MAX_IMAGE_PX)return img;
    const s=Math.sqrt(MAX_IMAGE_PX/(w*h)),c=document.createElement('canvas');c.width=Math.round(w*s);c.height=Math.round(h*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c;
  }
  async function handleFiles(files){
    if(importing){toast('Please let these images finish loading, then add more.','warning');return;}
    if(busy||!files.length)return;
    _saveCurrent();_openEditor();showScreen('filter');importing=true;const start=state.pages.length,failures=[];
    const settings={filter:state.currentFilter,adjustments:{...state.adjustments}};
    $('scanImportStatus').textContent='Reading images…';
    _updateAutoStatus();
    try{
      for(let i=0;i<files.length;i++){
        const f=files[i];$('scanImportStatus').textContent=`Reading ${i+1} / ${files.length}`;
        try{
          if(f.type==='application/pdf'||/\.pdf$/i.test(f.name)){
            if(typeof pdfjsLib==='undefined')throw new Error('PDF engine is still loading');
            const owner=await ScanPdf.open(f);
            try{for(let n=1;n<=owner.document.numPages;n++){
              $('scanImportStatus').textContent=`Reading PDF page ${n} / ${owner.document.numPages}`;
              const preview=await ScanPdf.preview(owner,n);owner.refs++;
              await _importImage(preview.image,settings,`${f.name} — page ${n}`,{pdfSource:{owner,number:n},sourceOperations:[],autoStatus:preview.flat?'ready':'pending'});
            }}finally{if(owner.refs)await owner.document.cleanup();else await owner.document.destroy();}
          }else if(f.type.startsWith('image/')||/\.(jpe?g|png|webp|bmp)$/i.test(f.name)){
            await _importImage(_limitImage(await _loadFile(f)),settings,f.name);_renderPages();
          }else throw new Error('Unsupported file type');
        }catch(error){console.error('Import failed',f.name,error);failures.push(f.name);}
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }finally{importing=false;_updateAutoStatus();_queueAutoCrops();}
    if(state.editingIndex<0&&state.pages.length>start)_editPage(start);else if(!state.pages.length){_closeEditor();showScreen('upload');}
    if(failures.length)toast(`${failures.length} file(s) could not be imported. Other pages are ready.`,'error');
  }
  async function _importImage(img,settings,sourceName='',metadata={}){
    const corners=_fullCorners(img);
    state.pages.push({id:Date.now()+Math.random(),sourceName,sourceImg:img,croppedImg:img,cropCorners:copy(corners),previousCorners:copy(corners),needsCropReview:false,autoStatus:'pending',editVersion:0,filter:state.applyToAll?state.currentFilter:settings.filter,adjustments:{...(state.applyToAll?state.adjustments:settings.adjustments)},...metadata});
    _renderPages();
    if(state.editingIndex<0)_editPage(state.pages.length-1);
    // Let the first picture and new thumbnails paint before further decoding.
    await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  }
  function _updateAutoStatus(){
    const pending=state.pages.filter(p=>p.autoStatus==='pending'||p.autoStatus==='processing').length;
    if(!importing)$('scanImportStatus').textContent=pending?`Auto-crop ${state.pages.length-pending} / ${state.pages.length}`:'';
    $('scanAddImages').disabled=busy||importing;
    if(state.screen!=='crop')$('scanConfirm').disabled=busy||importing||pending>0;
  }
  function _invalidateAuto(page){page.editVersion=(page.editVersion||0)+1;page.autoStatus='manual';_updateAutoStatus();}
  function _queueAutoCrops(){
    if(autoTask||importing||state.screen==='crop')return;
    autoTask=(async()=>{
      while(true){
        if(importing||state.screen==='crop')break;
        const selected=state.pages[state.editingIndex];
        const page=selected?.autoStatus==='pending'?selected:state.pages.find(p=>p.autoStatus==='pending');
        if(!page)break;
        const source=page.sourceImg,version=page.editVersion;page.autoStatus='processing';_updateAutoStatus();
        await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
        try{
          let cropped,corners,previousCorners,needsCropReview,autoProfile=false,previewOnly=false;
          if(window.ScanProcessor?.available){
            const result=await ScanProcessor.detect(source,{preview:true},()=>state.pages.includes(page)&&page.editVersion===version);
            if(!result)continue;
            cropped=result.blob?await _imageFromBlob(result.blob):source;corners=result.corners;previousCorners=result.previousCorners;needsCropReview=result.needsReview;autoProfile=result.hasPhotoPadding&&!!result.blob;previewOnly=!!result.previewOnly;
          }else{
            await autoCropEditor.setImageAsync(source);
            const warped=window.cvReady?await autoCropEditor.applyCrop():await autoCropEditor.perspectiveCrop();
            cropped=autoCropEditor.hasPhotoPadding&&window.rectifyScanPaperBands?window.rectifyScanPaperBands(warped):warped;corners=autoCropEditor.corners;previousCorners=autoCropEditor.legacyCorners;needsCropReview=autoCropEditor.detectionNeedsReview;
          }
          // The job owns a page object and source revision, never a page index.
          // Manual edits, rotations, deletions and reordering cannot redirect it.
          if(!state.pages.includes(page)||page.editVersion!==version||page.sourceImg!==source)continue;
          Object.assign(page,{croppedImg:cropped,cropCorners:copy(corners),previousCorners:copy(previousCorners||corners),needsCropReview:!!needsCropReview,autoProfile,previewOnly,autoStatus:'ready'});
        }catch(error){
          console.warn('Automatic crop unavailable; keeping this original:',error);
          if(!state.pages.includes(page)||page.editVersion!==version)continue;
          page.autoStatus='ready';page.needsCropReview=true;
        }
        if(state.pages[state.editingIndex]===page&&state.screen==='filter'&&!$('scanEditor').hidden)await _editPage(state.editingIndex);
        else _renderPages();
        _updateAutoStatus();
      }
    })().finally(()=>{autoTask=null;_updateAutoStatus();if(state.screen!=='crop'&&state.pages.some(p=>p.autoStatus==='pending'))_queueAutoCrops();});
  }
  function _fullCorners(img){const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;return{tl:{x:0,y:0},tr:{x:w,y:0},br:{x:w,y:h},bl:{x:0,y:h}};}
  function _saveCurrent(){
    const p=state.pages[state.editingIndex];if(!p)return;
    p.filter=state.currentFilter;p.adjustments={...state.adjustments};
  }
  function _editPage(index){
    if(busy||!state.pages[index])return;
    _saveCurrent();state.editingIndex=index;
    const page=state.pages[index];state.currentFilter=page.filter;state.adjustments={...page.adjustments};state._currentCropped=page.croppedImg;
    $('scanSourceName').textContent=page.sourceName||`Page ${index+1}`;
    cropEditor.img=page.sourceImg;cropEditor.rotation=0;cropEditor.pendingTransform=null;cropEditor.corners=copy(page.cropCorners);cropEditor.legacyCorners=copy(page.previousCorners||page.cropCorners);cropEditor.detectionNeedsReview=page.needsCropReview;
    zoom=1;showScreen('filter');_syncControls();_renderPages();_paintImmediate(page.croppedImg);const rendering=_reprocess();_updateAutoStatus();return rendering;
  }
  function _syncControls(){
    for(const key of ['brightness','contrast','sharpness','saturation']){$('sl_'+key).value=state.adjustments[key]||0;$('sv_'+key).textContent=state.adjustments[key]||0;}
    $('applyToAll').checked=state.applyToAll;
    _buildFilters();
    $('scanFooterInfo').textContent=state.pages.length?`${state.editingIndex+1} / ${state.pages.length}`:'';
  }
  function _buildFilters(){
    const grid=$('filterStrip');
    if(grid.children.length===8){
      for(const b of grid.children){b.classList.toggle('active',b.dataset.filter===state.currentFilter);b.setAttribute('aria-pressed',String(b.dataset.filter===state.currentFilter));}
      for(const b of $('scanExtraFilters').children)b.setAttribute('aria-pressed',String(b.dataset.filter===state.currentFilter));
      return;
    }
    grid.replaceChildren();
    for(const id of ['original','enhance','magicpro','lighten','noshadow','bw','eco','handwriting']){
      const label=id==='handwriting'?'Remove Handwriting':id==='magicpro'?'Magic Pro':FILTERS.find(f=>f.id===id).name;
      const b=document.createElement('button');b.type='button';b.className='filter-card'+(id===state.currentFilter?' active':'');b.dataset.filter=id;b.setAttribute('aria-pressed',String(id===state.currentFilter));
      const icon=document.createElement('span');icon.className='scan-filter-icon';icon.setAttribute('aria-hidden','true');icon.innerHTML=filterIcons[id];
      const text=document.createElement('span');text.className='fc-label';text.textContent=label;b.append(icon,text);
      if(id==='handwriting'){b.disabled=true;b.title='Not ready: tested models also changed printed text and graphics.';b.setAttribute('aria-describedby','scanHandwritingNote');const availability=document.createElement('span');availability.className='fc-availability';availability.textContent='Unavailable';b.append(availability);}
      else b.onclick=()=>_selectFilter(id);
      grid.append(b);
    }
    $('scanExtraFilters').replaceChildren();
    for(const id of ['bwsoft','grayscale','invert']){const b=document.createElement('button');b.dataset.filter=id;b.textContent=FILTERS.find(f=>f.id===id).name;b.setAttribute('aria-pressed',String(id===state.currentFilter));b.onclick=()=>_selectFilter(id);$('scanExtraFilters').append(b);}
  }
  function _selectFilter(id){
    if(busy)return;if(state.screen==='crop'){toast('Apply or cancel your crop first.','warning');return;}
    state.currentFilter=id;_applySettings();_buildFilters();_reprocess();
  }
  function _applySettings(){
    _saveCurrent();if(state.applyToAll)for(const p of state.pages){p.filter=state.currentFilter;p.adjustments={...state.adjustments};}
    _renderPages();
  }
  async function _renderFiltered(image,filter,adjustments,isCurrent=()=>true){
    if(window.ScanRenderer)return ScanRenderer.render(image,filter,adjustments,isCurrent);
    if(!isCurrent())return null;const c=document.createElement('canvas');c.width=image.naturalWidth||image.width;c.height=image.naturalHeight||image.height;c.getContext('2d').drawImage(image,0,0);applyFilterToContext(c.getContext('2d'),c.width,c.height,filter,adjustments);return c;
  }
  async function _reprocess(){
    const img=state._currentCropped;if(!img)return;
    const rev=++previewRevision,current=()=>rev===previewRevision&&state._currentCropped===img;
    $('previewCanvas').setAttribute('aria-busy','true');
    const page=state.pages[state.editingIndex];
    const findingEdges=page&&(page.autoStatus==='pending'||page.autoStatus==='processing');
    $('scanPreviewStatus').textContent=findingEdges?'Updating filter · finding document edges…':'Processing preview…';
    try{const rendered=window.ScanRenderer?await ScanRenderer.preview(img,state.currentFilter,{...state.adjustments},current):await _renderFiltered(img,state.currentFilter,{...state.adjustments},current);if(!rendered||!current())return;
      const target=$('previewCanvas'),scale=Math.min(1800/rendered.width,1800/rendered.height,1);target.width=Math.max(1,Math.round(rendered.width*scale));target.height=Math.max(1,Math.round(rendered.height*scale));target.getContext('2d').drawImage(rendered,0,0,target.width,target.height);_applyZoom();
      const active=state.pages[state.editingIndex];
      if(active&&active.croppedImg===img){_cacheThumbnail(active,rendered,_thumbnailKey(active));_renderPages();}
      $('scanPreviewStatus').textContent=active&&(active.autoStatus==='pending'||active.autoStatus==='processing')?'Finding document edges…':'';
      $('previewCanvas').setAttribute('aria-busy','false');
    }catch(error){if(current()){$('scanPreviewStatus').textContent='Preview failed. Please try another filter.';$('previewCanvas').setAttribute('aria-busy','false');}console.error(error);}
  }
  function _paintImmediate(image){
    const target=$('previewCanvas'),w=image.naturalWidth||image.width,h=image.naturalHeight||image.height,s=Math.min(1400/w,1400/h,1);
    target.width=Math.max(1,Math.round(w*s));target.height=Math.max(1,Math.round(h*s));target.getContext('2d').drawImage(image,0,0,target.width,target.height);_applyZoom();
  }
  function _thumbnailKey(page){const a=page.adjustments||{};return JSON.stringify([!!window.cvReady,page.filter,a.brightness||0,a.contrast||0,a.sharpness||0,a.saturation||0]);}
  function _smallThumbnail(image){
    const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height,s=Math.min(96/w,100/h,1),c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(w*s));c.height=Math.max(1,Math.round(h*s));c.getContext('2d').drawImage(image,0,0,c.width,c.height);return c;
  }
  function _cacheThumbnail(page,image,key){page._thumbnail={source:page.croppedImg,key,canvas:_smallThumbnail(image)};}
  function _baseThumbnail(page){
    if(page._baseThumbnail?.source!==page.croppedImg)page._baseThumbnail={source:page.croppedImg,canvas:_smallThumbnail(page.croppedImg)};
    return page._baseThumbnail.canvas;
  }
  function _thumbnailCurrent(job){return state.pages.includes(job.page)&&job.page.croppedImg===job.image&&_thumbnailKey(job.page)===job.key;}
  function _queueThumbnails(){
    if(thumbnailTask)return;
    thumbnailTask=(async()=>{
      while(thumbnailJobs.size){
        await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
        const [id,job]=thumbnailJobs.entries().next().value;thumbnailJobs.delete(id);
        if(!_thumbnailCurrent(job))continue;
        if(job.page._thumbnail?.source===job.image&&job.page._thumbnail.key===job.key)continue;
        try{
          const small=_baseThumbnail(job.page);
          const canvas=window.ScanRenderer?await ScanRenderer.render(small,job.filter,job.adjustments,()=>_thumbnailCurrent(job)):small;
          if(!window.ScanRenderer)applyFilterToContext(canvas.getContext('2d'),canvas.width,canvas.height,job.filter,job.adjustments);
          if(!canvas)continue;
          if(!_thumbnailCurrent(job))continue;
          job.page._thumbnail={source:job.image,key:job.key,canvas};
          _renderPages();
        }catch(error){console.warn('Thumbnail treatment unavailable:',error);}
      }
    })().finally(()=>{thumbnailTask=null;if(thumbnailJobs.size)_queueThumbnails();});
  }
  function _pageCropLabel(page){
    if(page.autoStatus==='pending'||page.autoStatus==='processing')return 'Finding edges';
    if(page.needsCropReview)return 'Check crop';
    const full=_fullCorners(page.sourceImg),q=page.cropCorners;
    return q&&['tl','tr','br','bl'].some(k=>Math.hypot(q[k].x-full[k].x,q[k].y-full[k].y)>3)?'Cropped':'Full image';
  }
  function _renderPages(){
    if(pageDragging)return;
    const list=$('scanPageList'),existing=new Map([...list.children].map(b=>[b.dataset.id,b])),ids=new Set(state.pages.map(p=>String(p.id)));
    state.pages.forEach((p,index)=>{
      let b=existing.get(String(p.id));
      if(!b){
        b=document.createElement('button');b.type='button';b.dataset.id=p.id;
        const wrap=document.createElement('span');wrap.className='scan-page-picture';wrap.append(document.createElement('canvas'));
        const num=document.createElement('span');num.className='scan-page-number';
        const meta=document.createElement('span');meta.className='scan-page-meta';b.append(wrap,num,meta);
        b.onclick=()=>{if(state.screen==='crop'){toast('Apply or cancel your crop before changing pages.','warning');return;}const at=state.pages.findIndex(page=>String(page.id)===b.dataset.id);if(at>=0)_editPage(at);};
      }
      b.className='scan-page'+(index===state.editingIndex?' active':'');b.setAttribute('aria-label',`Page ${index+1}${p.needsCropReview?', check corners':''}`);b.setAttribute('aria-current',String(index===state.editingIndex));
      b.title=p.sourceName||`Page ${index+1}`;
      b.dataset.autoStatus=p.autoStatus||'ready';
      const key=_thumbnailKey(p),cached=p._thumbnail?.source===p.croppedImg&&p._thumbnail.key===key;
      // Keep batch-wide filter changes independent of hundreds of full photos.
      // The existing small preview stays visible while its new treatment queues.
      const neutral=p.filter==='original'&&!Object.values(p.adjustments||{}).some(Boolean);
      const thumb=cached?p._thumbnail.canvas:neutral?_baseThumbnail(p):p._thumbnail?.source===p.croppedImg?p._thumbnail.canvas:_baseThumbnail(p);
      if(b._scanImage!==thumb){const c=b.querySelector('canvas'),small=_smallThumbnail(thumb);c.width=small.width;c.height=small.height;c.getContext('2d').drawImage(small,0,0);b._scanImage=thumb;}
      if(!cached&&p.autoStatus!=='pending'&&p.autoStatus!=='processing'){thumbnailJobs.set(p.id,{page:p,image:p.croppedImg,key,filter:p.filter,adjustments:{...p.adjustments}});_queueThumbnails();}
      b.querySelector('.scan-page-picture').setAttribute('aria-busy',String(!cached&&p.autoStatus!=='pending'&&p.autoStatus!=='processing'));
      b.querySelector('.scan-page-number').textContent=index+1;
      b.querySelector('.scan-page-meta').textContent=`${FILTERS.find(f=>f.id===p.filter)?.name||p.filter} · ${_pageCropLabel(p)}`;
      const warning=b.querySelector('.scan-page-warning');
      if(p.needsCropReview&&!warning){const mark=document.createElement('span');mark.className='scan-page-warning';mark.textContent='!';mark.title='Check suggested corners';b.append(mark);}else if(!p.needsCropReview&&warning)warning.remove();
      if(list.children[index]!==b)list.insertBefore(b,list.children[index]||null);
    });
    for(const [id,b] of existing)if(!ids.has(id))b.remove();
    if(typeof Sortable!=='undefined'&&!sortable)sortable=Sortable.create(list,{animation:120,ghostClass:'sortable-ghost',onStart:()=>{pageDragging=true;},onMove:()=>!busy&&state.screen!=='crop',onEnd:e=>{
      pageDragging=false;_saveCurrent();const selected=state.pages[state.editingIndex]?.id;const [p]=state.pages.splice(e.oldIndex,1);state.pages.splice(e.newIndex,0,p);state.editingIndex=state.pages.findIndex(p=>p.id===selected);_renderPages();_syncControls();
    }});
    $('scanFooterInfo').textContent=state.pages.length?`${Math.max(0,state.editingIndex)+1} / ${state.pages.length}`:'';
  }
  function _fitCrop(){
    if(state.screen!=='crop')return;const viewport=$('screen-crop');cropEditor._maxW=Math.max(80,viewport.clientWidth-8);cropEditor._maxH=Math.max(80,viewport.clientHeight-8);cropEditor.draw();
  }
  function _applyZoom(){
    const canvas=$('previewCanvas'),stage=$('scanWorkstage');$('scanZoomValue').textContent=Math.round(zoom*100)+'%';stage.dataset.zoomed=String(zoom>1);
    if(zoom===1){canvas.style.width='';canvas.style.height='';canvas.style.maxWidth='100%';canvas.style.maxHeight='100%';return;}
    const fit=Math.min((stage.clientWidth-32)/canvas.width,(stage.clientHeight-32)/canvas.height,1);canvas.style.width=Math.round(canvas.width*fit*zoom)+'px';canvas.style.height=Math.round(canvas.height*fit*zoom)+'px';canvas.style.maxWidth='none';canvas.style.maxHeight='none';
  }
  function _enterCrop(){if(busy||!state.pages.length)return;_saveCurrent();showScreen('crop');_showDetectionBadge(cropEditor.detectionNeedsReview?.25:.8);}
  function _cancelCrop(){const p=state.pages[state.editingIndex];if(!p)return;cropEditor.img=p.sourceImg;cropEditor.rotation=0;cropEditor.corners=copy(p.cropCorners);cropEditor.legacyCorners=copy(p.previousCorners||p.cropCorners);state._currentCropped=p.croppedImg;showScreen('filter');_paintImmediate(p.croppedImg);_reprocess();_updateAutoStatus();_queueAutoCrops();}
  async function _commitCrop(){
    if(busy)return;showProcessing('Applying crop…');
    _invalidateAuto(state.pages[state.editingIndex]);
    try{
      let result,image;
      if(window.ScanProcessor?.available){result=await ScanProcessor.warp(cropEditor._getRotatedImg(),copy(cropEditor.corners),{preview:true});image=await _imageFromBlob(result.blob);}
      else image=window.cvReady?await cropEditor.applyCrop():await cropEditor.perspectiveCrop();
      const p=state.pages[state.editingIndex];p.previewOnly=!!result?.previewOnly;
      p.sourceImg=cropEditor._getRotatedImg();p.cropCorners=copy(cropEditor.corners);p.previousCorners=copy(cropEditor.legacyCorners||cropEditor.corners);p.croppedImg=image;p.needsCropReview=false;p.autoProfile=false;
      if(cropEditor.pendingTransform){(p.sourceOperations||=[]).push(cropEditor.pendingTransform);cropEditor.pendingTransform=null;}
      cropEditor.img=p.sourceImg;cropEditor.rotation=0;state._currentCropped=image;zoom=1;showScreen('filter');_renderPages();_reprocess();
    }catch(error){console.error(error);if(cropEditor.pendingTransform){cropEditor.pendingTransform=null;const p=state.pages[state.editingIndex];cropEditor.img=p.sourceImg;cropEditor.rotation=0;cropEditor.corners=copy(p.cropCorners);cropEditor.legacyCorners=copy(p.previousCorners||p.cropCorners);}toast('Could not apply crop. Adjust the corners and try again.','error');}
    finally{hideProcessing();_queueAutoCrops();}
  }
  async function _transform(kind){
    if(busy||!state.pages.length)return;
    cropEditor.pendingTransform=kind;
    if(kind==='left'||kind==='right'){cropEditor.rotate(kind==='left'?-90:90);}
    else{
      const img=cropEditor._getRotatedImg(),w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.translate(kind==='horizontal'?w:0,kind==='vertical'?h:0);ctx.scale(kind==='horizontal'?-1:1,kind==='vertical'?-1:1);ctx.drawImage(img,0,0);
      const flip=q=>{const points=['tl','tr','br','bl'].map(k=>({x:kind==='horizontal'?w-q[k].x:q[k].x,y:kind==='vertical'?h-q[k].y:q[k].y}));return _sortCorners(points);};
      cropEditor.corners=flip(cropEditor.corners);cropEditor.legacyCorners=flip(cropEditor.legacyCorners||cropEditor.corners);cropEditor.img=c;cropEditor.rotation=0;cropEditor.draw();
    }
    if(state.screen==='crop')_fitCrop();else await _commitCrop();
  }
  function _bindWorkspace(){
    $('scanWorkstage').append($('scanCropOptions'));
    $('scanClose').onclick=_closeEditor;$('scanAddImages').onclick=()=>{if(!busy&&state.screen!=='crop')$('fileInputScanner').click();};
    $('scanCropToggle').onclick=()=>state.screen==='crop'?_cancelCrop():_enterCrop();$('scanCancelCrop').onclick=_cancelCrop;
    $('scanConfirm').onclick=()=>{if(busy)return;if(state.screen==='crop')_commitCrop();else if(state.screen==='export')_editPage(state.editingIndex);else{_saveCurrent();showScreen('export');_renderExportPreview();}};
    $('scanOriginalImages').onclick=()=>{if(busy)return;for(const p of state.applyToAll?state.pages:[state.pages[state.editingIndex]]){_invalidateAuto(p);p.croppedImg=p.sourceImg;p.cropCorners=_fullCorners(p.sourceImg);p.filter='original';p.adjustments={brightness:0,contrast:0,sharpness:0,saturation:0};p.needsCropReview=false;}state.currentFilter='original';state.adjustments={brightness:0,contrast:0,sharpness:0,saturation:0};_editPage(state.editingIndex);};
    $('btnResetCrop').onclick=async()=>{if(busy)return;_invalidateAuto(state.pages[state.editingIndex]);showProcessing('Detecting document edges…');try{if(window.ScanProcessor?.available){const source=cropEditor._getRotatedImg(),result=await ScanProcessor.detect(source,{crop:false});cropEditor.img=source;cropEditor.rotation=0;cropEditor.corners=copy(result.corners);cropEditor.legacyCorners=copy(result.previousCorners||result.corners);cropEditor.detectionNeedsReview=result.needsReview;}else await cropEditor.resetCorners();_fitCrop();}catch(error){toast('Detection failed. Please adjust corners manually.','error');}finally{hideProcessing();}};
    $('btnFitCrop').onclick=()=>{cropEditor.fitFull();_fitCrop();};$('btnPreviousDetection').onclick=()=>{cropEditor.useOriginalDetection();_fitCrop();};
    for(const kind of ['left','right','horizontal','vertical'])$('scanTransform-'+kind).onclick=()=>_transform(kind);
    $('scanDeletePage').onclick=()=>{if(busy)return;const removed=state.pages.splice(state.editingIndex,1)[0];if(removed?.pdfSource)ScanPdf.release(removed);state.editingIndex=-1;if(state.pages.length)_editPage(0);else{_renderPages();_closeEditor();}};
    $('applyToAll').onchange=e=>{state.applyToAll=e.target.checked;if(state.applyToAll)_applySettings();};
    for(const key of ['brightness','contrast','sharpness','saturation'])$('sl_'+key).oninput=e=>{if(busy)return;state.adjustments[key]=Number(e.target.value);$('sv_'+key).textContent=e.target.value;_applySettings();_reprocess();};
    $('scanZoomIn').onclick=()=>{zoom=Math.min(3,zoom+.25);_applyZoom();};$('scanZoomOut').onclick=()=>{zoom=Math.max(1,zoom-.25);_applyZoom();};
    $('scanEditor').addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();if(state.screen==='crop')_cancelCrop();else _closeEditor();}
      if(e.key==='Tab'){const elements=[...$('scanEditor').querySelectorAll('button:not(:disabled),input,select,summary,[tabindex="0"]')].filter(el=>el.getClientRects().length);const first=elements[0],last=elements.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    });
    _buildFilters();
  }

  /* ── EXPORT SCREEN ────────────────────────────────────────── */
  function _renderExportPreview() {
    const count = document.getElementById('exportPageCount');
    if (count) count.textContent = `${state.pages.length} page${state.pages.length !== 1 ? 's' : ''}`;
  }

  function _bindExportControls() {
    const btnDownloadPDF = document.getElementById('btnDownloadPDF');
    const btnDownloadJPG = document.getElementById('btnDownloadJPG');
    const btnDownloadZIP = document.getElementById('btnDownloadZIP');
    const btnBackPages   = document.getElementById('btnBackToPages');

    if (btnDownloadPDF) btnDownloadPDF.onclick = exportAsPDF;
    if (btnDownloadJPG) btnDownloadJPG.onclick = () => exportAsImages('jpeg');
    if (btnDownloadZIP) btnDownloadZIP.onclick = exportAsZIP;
    if (btnBackPages)   btnBackPages.onclick   = () => { showScreen('pages'); _renderPages(); };
  }

  async function exportAsPDF() {
    if (!state.pages.length) { toast('No pages to export', 'error'); return; }
    showProcessing('Creating PDF…');

    const { jsPDF } = window.jspdf;
    const pageSize = document.getElementById('pdfPageSize')?.value || 'a4';
    const orientation = document.getElementById('pdfOrientation')?.value || 'portrait';
    const quality = +(document.getElementById('pdfQuality')?.value || 0.98);
    let writer;
    try {
      if(typeof Worker!=='undefined'){
        const worker=new Worker(new URL('js/scan-pdf-worker.js?v=20261104_autocrop',document.baseURI));let id=0;
        const request=(method,fields={},transfer=[])=>new Promise((resolve,reject)=>{const own=++id,timer=setTimeout(()=>reject(new Error('PDF processing timed out')),120000);worker.onmessage=({data})=>{if(data.id!==own)return;clearTimeout(timer);data.error?reject(new Error(data.error)):resolve(data);};worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message));};worker.postMessage({id:own,method,...fields},transfer);});
        writer={request,dispose:()=>worker.terminate()};await request('start',{orientation,pageSize});
      }else{
        const doc=new jsPDF({orientation,unit:'mm',format:pageSize});let index=0;
        writer={async request(method,data){if(method==='page'){if(index++)doc.addPage();const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),s=Math.min(W/data.width,H/data.height),w=data.width*s,h=data.height*s;doc.addImage(new Uint8Array(data.bytes),'JPEG',(W-w)/2,(H-h)/2,w,h);}if(method==='finish')return {bytes:doc.output('arraybuffer')};},dispose(){}};
      }
      for (let i = 0; i < state.pages.length; i++) {
        const page = state.pages[i];
        $('scanBusyText').textContent=`Creating PDF · page ${i+1} / ${state.pages.length}`;
        const c = await _renderExportPage(page);
        const blob=await new Promise(resolve=>c.toBlob(resolve,'image/jpeg',quality));if(!blob)throw new Error('Page encoding failed');const bytes=await blob.arrayBuffer();
        await writer.request('page',{bytes,width:c.width,height:c.height},[bytes]);
        await new Promise(resolve=>requestAnimationFrame(resolve));
      }
      const result=await writer.request('finish');saveAs(new Blob([result.bytes],{type:'application/pdf'}),`PDFdukan.com_${Date.now()}.pdf`);
      hideProcessing();
      toast('PDF downloaded! ✓', 'success');
    } catch (e) {
      hideProcessing();
      console.error('PDF export error:', e);
      toast('PDF export failed: ' + e.message, 'error');
    }finally{writer?.dispose();}
  }

  // Render one page (cropped + filtered) to an image blob.
  async function _renderExportPage(page){
    const source=page.pdfSource?await ScanPdf.exportSource(page):page.previewOnly?await _imageFromBlob((await ScanProcessor.warp(page.sourceImg,page.cropCorners,{rectify:!!page.autoProfile})).blob):page.croppedImg;
    try{return await _renderFiltered(source,page.filter,page.adjustments);}finally{if(page.pdfSource&&source instanceof HTMLCanvasElement)source.width=source.height=1;}
  }
  async function _pageToBlob(page, format) {
    const c = await _renderExportPage(page);
    return await new Promise(r => c.toBlob(r, 'image/' + format, format === 'jpeg' ? 0.92 : 1.0));
  }

  // Strip illegal filename characters and any extension the user typed.
  function _sanitizeBaseName(name, fallback) {
    const cleaned = (name || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\.(jpe?g|png|zip)$/i, '');
    return cleaned || fallback;
  }

  // Export pages as images. Browsers block multiple automatic downloads, so a
  // single page downloads directly while multiple pages are bundled into ONE ZIP
  // (named "<base>.zip") with files auto-numbered "<base>_01.jpg", "<base>_02.jpg"…
  // — this is the only reliable way to get every page in a single download.
  async function exportAsImages(format) {
    if (!state.pages.length) { toast('No pages to export', 'error'); return; }
    const ext = format === 'jpeg' ? 'jpg' : format;
    const multi = state.pages.length > 1;
    const fallback = 'PDFdukan.com_' + new Date().toISOString().slice(0, 10);

    // Ask for a file name; the rest are auto-numbered in the same pattern.
    const promptMsg = multi
      ? `Enter a file name for your ${state.pages.length} images.\n\n` +
        `They will be saved together in one ZIP as:\n` +
        `"<name>_01.${ext}", "<name>_02.${ext}", …`
      : `Enter a file name for your image:`;
    const input = prompt(promptMsg, fallback);
    if (input === null) return; // user cancelled
    const base = _sanitizeBaseName(input, fallback);

    showProcessing(multi ? `Packaging ${state.pages.length} ${ext.toUpperCase()} images…` : 'Preparing download…');
    try {
      if (!multi) {
        const blob = await _pageToBlob(state.pages[0], format);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${base}.${ext}`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        hideProcessing();
        toast('Image downloaded! ✓', 'success');
        return;
      }

      // Multiple pages → one ZIP so they all download together, every page named
      // in the same pattern. padStart width grows with page count (01.. / 001..).
      const zip = new JSZip();
      const pad = Math.max(2, String(state.pages.length).length);
      for (let i = 0; i < state.pages.length; i++) {
        const blob = await _pageToBlob(state.pages[i], format);
        zip.file(`${base}_${String(i + 1).padStart(pad, '0')}.${ext}`, blob);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `${base}.zip`);
      hideProcessing();
      toast(`${state.pages.length} ${ext.toUpperCase()} images downloaded as ${base}.zip ✓`, 'success');
    } catch (e) {
      hideProcessing();
      console.error('Image export error:', e);
      toast('Image export failed', 'error');
    }
  }

  async function exportAsZIP(format = 'jpeg') {
    if (!state.pages.length) { toast('No pages to export', 'error'); return; }
    showProcessing('Creating ZIP…');

    try {
      const zip = new JSZip();
      const folder = zip.folder('CamMaster');

      for (let i = 0; i < state.pages.length; i++) {
        const page = state.pages[i];
        const c = await _renderExportPage(page);

        const blob = await new Promise(r => c.toBlob(r, 'image/' + format, format === 'jpeg' ? 0.92 : 1.0));
        const ext = format === 'jpeg' ? 'jpg' : format;
        folder.file(`page_${String(i + 1).padStart(3, '0')}.${ext}`, blob);
      }

      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `PDFdukan.com_${Date.now()}.zip`);
      hideProcessing();
      toast('ZIP downloaded! ✓', 'success');
    } catch (e) {
      hideProcessing();
      console.error('ZIP export error:', e);
      toast('ZIP export failed', 'error');
    }
  }


  function showProcessing(message){
    busy=true;$('scanStageBusy').hidden=false;$('scanBusyText').textContent=message||'Processing…';
    $('scanTools').inert=true;$('scanPageList').inert=true;$('scanConfirm').disabled=true;$('scanOriginalImages').disabled=true;$('scanCancelCrop').disabled=true;
  }
  function hideProcessing(){
    busy=false;$('scanStageBusy').hidden=true;$('scanTools').inert=state.screen==='crop';$('scanPageList').inert=false;$('scanConfirm').disabled=false;$('scanOriginalImages').disabled=false;$('scanCancelCrop').disabled=false;_updateAutoStatus();
  }
  return {init,handleFiles,showScreen,showProcessing,hideProcessing,exportAsPDF,exportAsZIP};
})();
window.ScannerApp=ScannerApp;
document.addEventListener('DOMContentLoaded',()=>ScannerApp.init());
