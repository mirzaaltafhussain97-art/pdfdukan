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
    // Fetch the corner-detection models as soon as the visitor shows intent to
    // scan (the file picker is open for a few seconds), not for every reader.
    const preload=()=>window.ScanProcessor?.preloadModels?.();
    for(const ev of ['pointerdown','dragenter','focusin','touchstart'])zone.addEventListener(ev,preload,{once:true,passive:true});
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
    if(lastRemoved){_finalizeRemoval();$('toast')?.querySelector('.toast-undo')&&$('toast').classList.remove('show');}
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
    // Start finding edges while the remaining files are still being read.
    _queueAutoCrops();
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
    if(autoTask||state.screen==='crop')return;
    autoTask=(async()=>{
      while(true){
        if(state.screen==='crop')break;
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
      else{
        // A swipe across the filter row (phones) or a drag must not pick a filter.
        let sx=0,sy=0,moved=false;
        b.addEventListener('pointerdown',e=>{sx=e.clientX;sy=e.clientY;moved=false;});
        b.addEventListener('pointermove',e=>{if(Math.hypot(e.clientX-sx,e.clientY-sy)>8)moved=true;});
        b.onclick=e=>{if(moved){moved=false;e.preventDefault();return;}_selectFilter(id);b.blur();};
      }
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
    const list=$('scanPageList'),existing=new Map([...list.children].map(item=>[item.dataset.id,item])),ids=new Set(state.pages.map(p=>String(p.id)));
    state.pages.forEach((p,index)=>{
      let item=existing.get(String(p.id)),b=item?.querySelector('.scan-page');
      if(!item){
        // Each rail entry = page button + its own remove button (never nested).
        item=document.createElement('div');item.className='scan-page-item';item.dataset.id=p.id;
        b=document.createElement('button');b.type='button';b.dataset.id=p.id;
        const wrap=document.createElement('span');wrap.className='scan-page-picture';wrap.append(document.createElement('canvas'));
        const num=document.createElement('span');num.className='scan-page-number';
        const meta=document.createElement('span');meta.className='scan-page-meta';b.append(wrap,num,meta);
        b.onclick=()=>{if(state.screen==='crop'){toast('Apply or cancel your crop before changing pages.','warning');return;}const at=state.pages.findIndex(page=>String(page.id)===item.dataset.id);if(at>=0)_editPage(at);};
        const remove=document.createElement('button');remove.type='button';remove.className='scan-page-remove';remove.textContent='×';
        remove.onclick=e=>{e.stopPropagation();_removePage(item.dataset.id);};
        item.append(b,remove);
      }
      item.querySelector('.scan-page-remove').setAttribute('aria-label',`Remove page ${index+1}`);item.querySelector('.scan-page-remove').title=`Remove page ${index+1}`;
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
      if(list.children[index]!==item)list.insertBefore(item,list.children[index]||null);
    });
    for(const [id,b] of existing)if(!ids.has(id))b.remove();
    if(typeof Sortable!=='undefined'&&!sortable)sortable=Sortable.create(list,{animation:120,ghostClass:'sortable-ghost',filter:'.scan-page-remove',preventOnFilter:false,delayOnTouchOnly:true,delay:150,onStart:()=>{pageDragging=true;},onMove:()=>!busy&&state.screen!=='crop',onEnd:e=>{
      pageDragging=false;_saveCurrent();const selected=state.pages[state.editingIndex]?.id;const [p]=state.pages.splice(e.oldIndex,1);state.pages.splice(e.newIndex,0,p);state.editingIndex=state.pages.findIndex(p=>p.id===selected);_renderPages();_syncControls();
    }});
    $('scanFooterInfo').textContent=state.pages.length?`${Math.max(0,state.editingIndex)+1} / ${state.pages.length}`:'';
  }
  // Remove one page from anywhere in the rail. Running auto-crop/thumbnail
  // jobs own their page object, so they simply drop the removed page.
  function _removePage(id){
    if(busy||importing){toast('Please wait for the current images to finish.','warning');return;}
    if(state.screen==='crop'){toast('Apply or cancel your crop before removing pages.','warning');return;}
    const at=state.pages.findIndex(p=>String(p.id)===String(id));if(at<0)return;
    _saveCurrent();
    const selectedId=state.pages[state.editingIndex]?.id;
    const [removed]=state.pages.splice(at,1);thumbnailJobs.delete(removed.id);
    _finalizeRemoval();lastRemoved={items:[{page:removed,at}],timer:setTimeout(_finalizeRemoval,7000)};
    if(!state.pages.length){state.editingIndex=-1;state._currentCropped=null;_renderPages();_updateAutoStatus();_closeEditor();showScreen('upload');}
    else if(removed.id===selectedId){state.editingIndex=-1;_editPage(Math.min(at,state.pages.length-1));}
    else{state.editingIndex=state.pages.findIndex(p=>p.id===selectedId);_renderPages();_syncControls();if(state.screen==='export')_renderExportPreview();}
    _updateAutoStatus();
    _undoToast(state.pages.length?`Page ${at+1} removed.`:'All pages removed.');
  }
  // A removed page can be restored for a few seconds (a mis-tap on a phone
  // should never cost a scan). PDF sources are released only after that.
  let lastRemoved=null;
  function _finalizeRemoval(){if(!lastRemoved)return;clearTimeout(lastRemoved.timer);for(const {page} of lastRemoved.items)if(page.pdfSource)ScanPdf.release(page);lastRemoved=null;}
  function _undoRemove(){
    if(!lastRemoved||busy||importing||state.screen==='crop')return;
    clearTimeout(lastRemoved.timer);const items=lastRemoved.items.slice().sort((a,b)=>a.at-b.at);lastRemoved=null;
    for(const {page,at} of items){
      // A crop job that was running when the page left must run again.
      if(page.autoStatus==='processing')page.autoStatus='pending';
      state.pages.splice(Math.min(at,state.pages.length),0,page);
    }
    state.editingIndex=-1;_editPage(state.pages.indexOf(items[0].page));_queueAutoCrops();_updateAutoStatus();
    if(state.screen==='export')_renderExportPreview();
    toast(items.length>1?`${items.length} pages restored ✓`:'Page restored ✓','success');
  }
  // The editor's × closes the scan and discards every imported page, so the
  // next upload always starts clean. Undo is offered for a few seconds.
  function _discardAll(){
    if(busy){toast('Please wait for the current step to finish.','warning');return;}
    if(importing){toast('Please let these images finish loading first.','warning');return;}
    const count=state.pages.length;
    if(count){
      _saveCurrent();_finalizeRemoval();
      lastRemoved={items:state.pages.map((page,at)=>({page,at})),timer:setTimeout(_finalizeRemoval,7000)};
      state.pages=[];thumbnailJobs.clear();
    }
    state.editingIndex=-1;state._currentCropped=null;previewRevision++;
    _renderPages();_updateAutoStatus();
    $('scanEditor').hidden=true;$('scanBackdrop').hidden=true;document.body.classList.remove('scan-editor-open');$('resumeEditor').hidden=true;
    showScreen('upload');focusBeforeEditor?.focus();
    if(count)_undoToast(count>1?`Scan closed. ${count} pages discarded.`:'Scan closed. Page discarded.');
  }
  function _undoToast(message){
    if(typeof toast!=='function')return;toast(message,'info',6500);
    const el=$('toast');if(!el)return;const undo=document.createElement('button');undo.type='button';undo.className='toast-undo';undo.textContent='Undo';
    undo.onclick=()=>{el.classList.remove('show');_undoRemove();};el.append(' ',undo);
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
    $('scanClose').onclick=_discardAll;$('scanAddImages').onclick=()=>{if(!busy&&state.screen!=='crop')$('fileInputScanner').click();};
    $('scanCropToggle').onclick=()=>state.screen==='crop'?_cancelCrop():_enterCrop();$('scanCancelCrop').onclick=_cancelCrop;
    $('scanConfirm').onclick=()=>{if(busy)return;if(state.screen==='crop')_commitCrop();else if(state.screen==='export')_editPage(state.editingIndex);else{_saveCurrent();_openDownloadDialog();}};
    $('scanOriginalImages').onclick=()=>{if(busy)return;for(const p of state.applyToAll?state.pages:[state.pages[state.editingIndex]]){_invalidateAuto(p);p.croppedImg=p.sourceImg;p.cropCorners=_fullCorners(p.sourceImg);p.filter='original';p.adjustments={brightness:0,contrast:0,sharpness:0,saturation:0};p.needsCropReview=false;}state.currentFilter='original';state.adjustments={brightness:0,contrast:0,sharpness:0,saturation:0};_editPage(state.editingIndex);};
    $('btnResetCrop').onclick=async()=>{if(busy)return;_invalidateAuto(state.pages[state.editingIndex]);showProcessing('Detecting document edges…');try{if(window.ScanProcessor?.available){const source=cropEditor._getRotatedImg(),result=await ScanProcessor.detect(source,{crop:false});cropEditor.img=source;cropEditor.rotation=0;cropEditor.corners=copy(result.corners);cropEditor.legacyCorners=copy(result.previousCorners||result.corners);cropEditor.detectionNeedsReview=result.needsReview;}else await cropEditor.resetCorners();_fitCrop();}catch(error){toast('Detection failed. Please adjust corners manually.','error');}finally{hideProcessing();}};
    $('btnFitCrop').onclick=()=>{cropEditor.fitFull();_fitCrop();};$('btnPreviousDetection').onclick=()=>{cropEditor.useOriginalDetection();_fitCrop();};
    for(const kind of ['left','right','horizontal','vertical'])$('scanTransform-'+kind).onclick=()=>_transform(kind);
    $('scanDeletePage').onclick=()=>{const p=state.pages[state.editingIndex];if(p)_removePage(p.id);};
    $('applyToAll').onchange=e=>{state.applyToAll=e.target.checked;if(state.applyToAll)_applySettings();};
    for(const key of ['brightness','contrast','sharpness','saturation'])$('sl_'+key).oninput=e=>{if(busy)return;state.adjustments[key]=Number(e.target.value);$('sv_'+key).textContent=e.target.value;_applySettings();_reprocess();};
    $('scanZoomIn').onclick=()=>{zoom=Math.min(3,zoom+.25);_applyZoom();};$('scanZoomOut').onclick=()=>{zoom=Math.max(1,zoom-.25);_applyZoom();};
    /* Mouse wheel / trackpad over the page moves through the pages (one page
       per notch), and the page list follows. When the page is zoomed in the
       wheel scrolls the zoomed page as usual. PageUp/PageDown and the arrow
       keys do the same from the keyboard. */
    let wheelAcc=0,wheelAt=0,wheelSeen=0;
    const stepPage=dir=>{if(busy||state.screen!=='filter')return false;const next=state.editingIndex+dir;if(next<0||next>=state.pages.length)return false;_editPage(next);
      requestAnimationFrame(()=>$('scanPageList').querySelector('[aria-current="true"],.active')?.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'}));return true;};
    $('scanWorkstage').addEventListener('wheel',e=>{
      if(state.screen!=='filter'||e.ctrlKey||zoom>1||state.pages.length<2)return;
      e.preventDefault();const now=performance.now();if(now-wheelSeen>300)wheelAcc=0;wheelSeen=now;
      if(now-wheelAt<320){wheelAcc=0;return;}            // one page per notch / per swipe burst
      wheelAcc+=e.deltaMode===1?e.deltaY*40:e.deltaY;
      if(Math.abs(wheelAcc)<60)return;
      const dir=wheelAcc>0?1:-1;wheelAcc=0;wheelAt=now;stepPage(dir);
    },{passive:false});
    /* Phones: swipe the photo left/right to move between pages. */
    let tx=0,ty=0,tt=0,multi=false;
    $('scanWorkstage').addEventListener('touchstart',e=>{multi=e.touches.length>1;const t=e.touches[0];tx=t.clientX;ty=t.clientY;tt=performance.now();},{passive:true});
    $('scanWorkstage').addEventListener('touchend',e=>{
      if(multi||state.screen!=='filter'||zoom>1||state.pages.length<2)return;const t=e.changedTouches[0],dx=t.clientX-tx,dy=t.clientY-ty;
      if(performance.now()-tt<700&&Math.abs(dx)>50&&Math.abs(dx)>1.5*Math.abs(dy))stepPage(dx<0?1:-1);
    },{passive:true});
    $('scanEditor').addEventListener('keydown',e=>{
      if(state.screen!=='filter'||/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;
      if(e.key==='PageDown'||e.key==='ArrowDown'){if(stepPage(1))e.preventDefault();}
      else if(e.key==='PageUp'||e.key==='ArrowUp'){if(stepPage(-1))e.preventDefault();}
    });
    $('scanEditor').addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();if(state.screen==='crop')_cancelCrop();else _discardAll();}
      if(e.key==='Tab'){const elements=[...$('scanEditor').querySelectorAll('button:not(:disabled),input,select,summary,[tabindex="0"]')].filter(el=>el.getClientRects().length);const first=elements[0],last=elements.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    });
    _buildFilters();
  }

  /* ── DOWNLOAD DIALOG ─────────────────────────────────────────
     After the filter step a small window in the middle of the screen asks
     for the format (PDF or Image), like phone scanner apps. The PDF options
     are the same controls the export screen used, moved into the window. */
  let _dlFormat='pdf';
  function _openDownloadDialog(){
    if(!state.pages.length){toast('No pages to export','error');return;}
    let m=document.getElementById('scanDlDialog');
    if(!m){
      m=document.createElement('div');m.id='scanDlDialog';m.className='sdl-backdrop';m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');m.setAttribute('aria-labelledby','sdlTitle');
      m.innerHTML='<div class="sdl-panel">'+
        '<div class="sdl-head"><h2 id="sdlTitle">Select Download Format</h2><button type="button" class="sdl-x" aria-label="Close" data-sdl="close">&#10005;</button></div>'+
        '<div class="sdl-formats" role="radiogroup" aria-label="Format">'+
          '<button type="button" class="sdl-fmt" role="radio" data-fmt="pdf"><svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true"><path d="M10 4h20l10 10v30H10z" fill="#ef4423"/><path d="M30 4v10h10z" fill="#ffb4a3"/><text x="25" y="35" text-anchor="middle" font-size="11" font-weight="800" fill="#fff" font-family="Arial,sans-serif">PDF</text></svg><span>PDF</span></button>'+
          '<button type="button" class="sdl-fmt" role="radio" data-fmt="image"><svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true"><rect x="5" y="9" width="38" height="30" rx="4" fill="#2f8cff"/><circle cx="16" cy="19" r="4" fill="#fff"/><path d="M5 35l12-12 9 9 6-6 11 11v2a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="#7cc0ff"/></svg><span>Image</span></button>'+
        '</div>'+
        '<div class="sdl-opts" id="sdlPdfOpts"></div>'+
        '<p class="sdl-note" id="sdlImgNote"></p>'+
        '<div class="sdl-foot"><span class="sdl-count" id="sdlCount"></span><button type="button" class="sdl-dl" data-sdl="go">Download</button></div>'+
      '</div>';
      const st=document.createElement('style');st.textContent=
        '.sdl-backdrop{position:fixed;inset:0;z-index:10100;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;padding:16px}'+
        '.sdl-backdrop.show{display:flex}'+
        '.sdl-panel{background:var(--bg-card,#fff);color:var(--text,#111);border:1px solid var(--border,#ddd);border-radius:16px;width:440px;max-width:100%;max-height:calc(100vh - 32px);overflow:auto;padding:20px 22px;box-shadow:0 18px 50px rgba(0,0,0,.35)}'+
        '.sdl-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.sdl-head h2{font-size:17px;font-weight:800;margin:0}'+
        '.sdl-x{background:none;border:0;color:var(--text-3,#888);font-size:18px;cursor:pointer;padding:4px 8px;border-radius:8px}.sdl-x:hover{background:var(--border,#eee)}'+
        '.sdl-formats{display:flex;gap:12px;margin-bottom:14px}'+
        '.sdl-fmt{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px;border:1.5px solid var(--border,#ddd);border-radius:12px;background:transparent;color:inherit;font-weight:700;font-size:14px;cursor:pointer}'+
        '.sdl-fmt[aria-checked="true"]{border-color:var(--primary,#ff6333);background:rgba(255,99,51,.08)}'+
        '.sdl-opts .pdf-options{margin:0}.sdl-opts .po-row{justify-content:space-between}'+
        '.sdl-note{font-size:13px;color:var(--text-3,#777);margin:2px 0 6px}'+
        '.sdl-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}.sdl-count{font-size:13px;color:var(--text-3,#777)}'+
        '.sdl-dl{background:var(--primary,#ff6333);color:#fff;border:0;border-radius:10px;padding:11px 26px;font-weight:800;font-size:15px;cursor:pointer}.sdl-dl:hover{filter:brightness(1.08)}';
      document.head.appendChild(st);document.body.appendChild(m);
      // Reuse the existing PDF option controls (same ids the export code reads).
      const opts=document.querySelector('#screen-export .pdf-options');if(opts)m.querySelector('#sdlPdfOpts').appendChild(opts);
      m.addEventListener('click',e=>{
        const f=e.target.closest('[data-fmt]');if(f){_dlFormat=f.dataset.fmt;_syncDl();return;}
        const a=e.target.closest('[data-sdl]');
        if(e.target===m||(a&&a.dataset.sdl==='close')){_closeDownloadDialog();return;}
        if(a&&a.dataset.sdl==='go'){_closeDownloadDialog();if(_dlFormat==='pdf')exportAsPDF();else exportAsImages('jpeg');}
      });
      document.addEventListener('keydown',e=>{if(e.key==='Escape'&&m.classList.contains('show'))_closeDownloadDialog();});
    }
    _syncDl();m.classList.add('show');setTimeout(()=>m.querySelector('.sdl-dl')?.focus(),30);
  }
  function _syncDl(){
    const m=document.getElementById('scanDlDialog');if(!m)return;const n=state.pages.length;
    m.querySelectorAll('.sdl-fmt').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.fmt===_dlFormat)));
    m.querySelector('#sdlPdfOpts').hidden=_dlFormat!=='pdf';
    const note=m.querySelector('#sdlImgNote');note.hidden=_dlFormat!=='image';note.textContent=n>1?`${n} pages → ${n} JPG images in one ZIP file.`:'1 page → one JPG image.';
    m.querySelector('#sdlCount').textContent=`${n} page${n!==1?'s':''}`;
  }
  function _closeDownloadDialog(){document.getElementById('scanDlDialog')?.classList.remove('show');}

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
    if (btnDownloadZIP) btnDownloadZIP.onclick = () => exportAsZIP();
    if (btnBackPages)   btnBackPages.onclick   = () => { showScreen('pages'); _renderPages(); };
  }

  async function exportAsPDF() {
    if (busy) return;
    if (!state.pages.length) { toast('No pages to export', 'error'); return; }
    const base = await _askFileName(_defaultBaseName(), 'pdf');
    if (base === null) return;
    showProcessing('Creating PDF…');

    const { jsPDF } = window.jspdf;
    const pageSize = document.getElementById('pdfPageSize')?.value || 'a4';
    const orientation = document.getElementById('pdfOrientation')?.value || 'portrait';
    const quality = +(document.getElementById('pdfQuality')?.value || 0.98);
    let writer;
    try {
      if(typeof Worker!=='undefined'){
        const worker=new Worker(new URL('js/scan-pdf-worker.js?v=20261113',document.baseURI));let id=0;
        const request=(method,fields={},transfer=[])=>new Promise((resolve,reject)=>{const own=++id,timer=setTimeout(()=>reject(new Error('PDF processing timed out')),120000);worker.onmessage=({data})=>{if(data.id!==own)return;clearTimeout(timer);data.error?reject(new Error(data.error)):resolve(data);};worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message));};worker.postMessage({id:own,method,...fields},transfer);});
        writer={request,dispose:()=>worker.terminate()};await request('start',{orientation,pageSize});
      }else{
        const doc=new jsPDF({orientation,unit:'mm',format:pageSize});let index=0;
        writer={async request(method,data){if(method==='page'){if(index++)doc.addPage();const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),s=Math.min(W/data.width,H/data.height),w=data.width*s,h=data.height*s;doc.addImage(new Uint8Array(data.bytes),data.format||'JPEG',(W-w)/2,(H-h)/2,w,h);}if(method==='finish')return {bytes:doc.output('arraybuffer')};},dispose(){}};
      }
      const idLayout=(document.getElementById('pdfLayout')?.value||'one')==='id2';
      const total=idLayout?Math.ceil(state.pages.length/2):state.pages.length;
      for (let i = 0; i < total; i++) {
        $('scanBusyText').textContent=`Creating PDF · page ${i+1} / ${total}`;
        const c = idLayout ? await _renderIdSheet(state.pages.slice(i*2,i*2+2),pageSize,orientation) : await _renderExportPage(state.pages[i]);
        // Pure black-and-white pages compress far better as PNG than as JPEG.
        const bilevel=!idLayout&&state.pages[i].filter==='bw'&&_isBilevel(c), format=bilevel?'PNG':'JPEG';
        const blob=await new Promise(resolve=>bilevel?c.toBlob(resolve,'image/png'):c.toBlob(resolve,'image/jpeg',quality));if(!blob)throw new Error('Page encoding failed');const bytes=await blob.arrayBuffer();
        await writer.request('page',{bytes,width:c.width,height:c.height,format},[bytes]);
        await new Promise(resolve=>requestAnimationFrame(resolve));
      }
      const result=await writer.request('finish');_downloadBlob(new Blob([result.bytes],{type:'application/pdf'}),`${base}.pdf`);
      hideProcessing();
      toast('PDF downloaded! ✓', 'success');
    } catch (e) {
      hideProcessing();
      console.error('PDF export error:', e);
      toast('PDF export failed: ' + e.message, 'error');
    }finally{writer?.dispose();}
  }

  // ID card layout: two scans (front + back) on one sheet. A card-shaped scan
  // is drawn at the standard ID-1 card size (85.6 x 53.98 mm) so a printout
  // matches the real card; any other shape is fitted into its half of the sheet.
  async function _renderIdSheet(pages,pageSize,orientation){
    const mm={a4:[210,297],letter:[215.9,279.4],a3:[297,420]}[pageSize]||[210,297];
    let [Wm,Hm]=mm; if(orientation==='landscape')[Wm,Hm]=[Hm,Wm];
    const pxmm=300/25.4, W=Math.round(Wm*pxmm), H=Math.round(Hm*pxmm);
    const sheet=document.createElement('canvas'); sheet.width=W; sheet.height=H;
    const g=sheet.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,W,H);
    const side=W>H, margin=20*pxmm, gap=12*pxmm;
    const boxW=side?(W-2*margin-gap)/2:W-2*margin, boxH=side?H-2*margin:(H-2*margin-gap)/2;
    const items=[];
    for(const pg of pages){
      const c=await _renderExportPage(pg), ar=c.width/c.height;
      let w,h;
      if(ar>1.45&&ar<1.75){w=85.6*pxmm;h=53.98*pxmm;}            // landscape card
      else if(ar>1/1.75&&ar<1/1.45){w=53.98*pxmm;h=85.6*pxmm;}   // portrait card
      else{const f=Math.min(boxW/c.width,boxH/c.height);w=c.width*f;h=c.height*f;}
      const s=Math.min(1,boxW/w,boxH/h); items.push({c,w:w*s,h:h*s});
    }
    // Keep the two sides close together near the top, like a photocopy.
    if(side){
      const total=items.reduce((a,t)=>a+t.w,0)+gap*(items.length-1); let x=(W-total)/2;
      items.forEach(t=>{g.drawImage(t.c,x,margin,t.w,t.h);x+=t.w+gap;});
    }else{
      let y=margin; items.forEach(t=>{g.drawImage(t.c,(W-t.w)/2,y,t.w,t.h);y+=t.h+gap;});
    }
    return sheet;
  }

  // True when a sample of the page holds only black or white pixels.
  function _isBilevel(c){
    try{const g=c.getContext('2d'),w=c.width,h=c.height,step=Math.max(1,Math.floor(Math.sqrt(w*h/40000)));
      const d=g.getImageData(0,0,w,h).data;
      for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){const k=(y*w+x)*4,v=d[k];if((v>8&&v<247)||Math.abs(d[k+1]-v)>8||Math.abs(d[k+2]-v)>8)return false;}
      return true;}catch(e){return false;}
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

  // Ask for a file name with the site's own Save As dialog (it sits above the
  // editor). Returns a clean base name without extension, or null if cancelled.
  async function _askFileName(fallback, ext) {
    let chosen;
    if (window.CMFilename) chosen = await CMFilename.prompt(`${fallback}.${ext}`);
    else chosen = window.prompt('File name:', fallback);
    if (chosen === null || chosen === undefined) return null;
    return _sanitizeBaseName(String(chosen).replace(new RegExp('\\.' + ext + '$', 'i'), ''), fallback);
  }
  function _defaultBaseName() { return 'PDFdukan.com_' + new Date().toISOString().slice(0, 10); }
  function _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    // data-cmf: the name was already chosen, so the global Save As hook skips it.
    a.href = url; a.download = filename; a.dataset.cmf = '1'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // Images: one page downloads as a single image; several pages go into ONE
  // ZIP ("<name>_01.jpg", "<name>_02.jpg"…), because browsers block a burst of
  // separate automatic downloads.
  async function exportAsImages(format = 'jpeg', forceZip = false) {
    if (busy) return;
    if (!state.pages.length) { toast('No pages to export', 'error'); return; }
    const ext = format === 'jpeg' ? 'jpg' : format;
    const zipped = forceZip || state.pages.length > 1;
    const base = await _askFileName(_defaultBaseName(), zipped ? 'zip' : ext);
    if (base === null) return;
    showProcessing(zipped ? `Packaging ${state.pages.length} ${ext.toUpperCase()} image${state.pages.length > 1 ? 's' : ''}…` : 'Preparing download…');
    try {
      if (!zipped) {
        _downloadBlob(await _pageToBlob(state.pages[0], format), `${base}.${ext}`);
        hideProcessing(); toast('Image downloaded ✓', 'success'); return;
      }
      const zip = new JSZip(), pad = Math.max(2, String(state.pages.length).length);
      for (let i = 0; i < state.pages.length; i++) {
        $('scanBusyText').textContent = `Preparing image ${i + 1} / ${state.pages.length}`;
        zip.file(`${base}_${String(i + 1).padStart(pad, '0')}.${ext}`, await _pageToBlob(state.pages[i], format));
      }
      _downloadBlob(await zip.generateAsync({ type: 'blob' }), `${base}.zip`);
      hideProcessing(); toast(`${state.pages.length} image${state.pages.length > 1 ? 's' : ''} downloaded as ${base}.zip ✓`, 'success');
    } catch (e) {
      hideProcessing(); console.error('Image export error:', e); toast('Image export failed. Please try again.', 'error');
    }
  }
  function exportAsZIP() { return exportAsImages('jpeg', true); }


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
