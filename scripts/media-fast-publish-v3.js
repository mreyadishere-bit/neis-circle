/* NEIS Circle — fast, observable image publishing v3.
   Offload large-file encoding from Publish by optimizing on selection;
   decode oversized JPEGs directly to a bounded bitmap and avoid 28 re-encodes.
   No server requests except the existing authenticated uploadMedia() call. */
(()=>{
  'use strict';
  if(window.__NEISFastImagesV3)return;
  const previousUpload=window.uploadMedia;
  if(typeof previousUpload!=='function'||!window.NEISImageOptimizer?.prepare)return;
  const MAX=7.5*1048576|0,MAX_FILE=100*1048576;
  const files=new WeakMap(), formForFile=new WeakMap();
  let queue=Promise.resolve();
  const ar=()=>((typeof state!=='undefined'&&state?.lang==='ar')||
      document.documentElement.lang==='ar'||document.body?.classList.contains('rtl'));
  const tr=(en,arabic)=>ar()?arabic:en;
  const error=(en,arabic)=>new Error(tr(en,arabic));
  const supported=new Set(['image/jpeg','image/png','image/webp','image/avif','image/heic','image/heif']);
  function findForm(file){
    const matched=formForFile.get(file);
    if(matched?.isConnected)return matched;
    return document.querySelector('#modalRoot form')||
      document.querySelector('.modal:not(.hidden) form')||
      document.querySelector('#postFormPlus')||
      document.querySelector('#ppForm');
  }
  function progress(file,kind,detail){
    const form=findForm(file);
    if(!form)return;
    const actions=form.querySelector('.modal-actions')||form.querySelector('[type=submit]')?.parentElement;
    if(!actions)return;
    let line=form.querySelector('.neis-image-processing-status');
    if(!line){
      line=document.createElement('div');
      line.className='neis-image-processing-status';
      line.setAttribute('role','status');
      line.setAttribute('aria-live','polite');
      actions.parentNode.insertBefore(line,actions);
    }
    line.dataset.phase=kind;
    line.textContent=tr(detail.en,detail.ar);
  }
  function validation(file){
    if(!file||file.size<=0)throw error('Choose a valid image.','اختر صورة صالحة.');
    if(file.size>MAX_FILE)throw error('Images must be under 100 MB.','الصور يجب أن تكون أقل من 100 ميجابايت.');
    if(file.type==='image/gif')throw error(
      'Animated GIF cannot be optimized safely; use JPG, PNG or WebP.',
      'لا يمكن ضغط GIF المتحرك بأمان. استخدم JPG أو PNG أو WebP.');
    if(!supported.has((file.type||'').toLowerCase()))throw error(
      'Use a JPG, PNG, WebP or another supported image.',
      'استخدم صورة JPG أو PNG أو WebP أو صورة أخرى مدعومة.');
  }
  // Read JPEG width/height directly from a small header slice. This avoids
  // decoding a 200MP image just to discover its size.
  async function jpegDimensions(file){
    if(file.type!=='image/jpeg')return null;
    const bytes=new Uint8Array(await file.slice(0,Math.min(file.size,1048576)).arrayBuffer());
    if(bytes[0]!==0xff||bytes[1]!==0xd8)return null;
    let i=2;
    while(i<bytes.length-12){
      if(bytes[i++]!==0xff)continue;
      while(bytes[i]===0xff)i++;
      const marker=bytes[i++];
      if(marker===0xd9||marker===0xda)break;
      if(marker===0xd8||marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
      if(i+2>bytes.length)break;
      const length=(bytes[i]<<8)|bytes[i+1];
      if(length<2||i+length>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
        const height=(bytes[i+3]<<8)|bytes[i+4];
        const width=(bytes[i+5]<<8)|bytes[i+6];
        if(width>0&&height>0)return {width,height};
        break;
      }
      i+=length;
    }
    return null;
  }
  async function imageMetadata(file){
    const parsed=await jpegDimensions(file);
    if(parsed)return parsed;
    const url=URL.createObjectURL(file);
    try{
      const image=new Image();
      image.src=url;
      await new Promise((ok,fail)=>{
        image.onload=ok;
        image.onerror=()=>fail(error('Could not decode this image.','تعذر قراءة هذه الصورة.'));
      });
      if(!image.naturalWidth||!image.naturalHeight)
        throw error('Invalid image dimensions.','أبعاد الصورة غير صالحة.');
      return {width:image.naturalWidth,height:image.naturalHeight};
    }finally{URL.revokeObjectURL(url)}
  }
  async function boundedBitmap(file,width,height){
    if(typeof createImageBitmap==='function'){
      try{
        const bm=await createImageBitmap(file,{
          resizeWidth:width,resizeHeight:height,resizeQuality:'high',
          imageOrientation:'from-image'
        });
        if(bm?.width&&bm?.height)return {image:bm,close:()=>bm.close()};
        bm?.close();
      }catch(e){console.warn('[NEIS fast image] Resized decode unavailable',e)}
    }
    const url=URL.createObjectURL(file);
    try{
      const im=new Image();im.src=url;
      await new Promise((ok,fail)=>{
        im.onload=ok;im.onerror=()=>fail(error('Image decoding failed.','فشل تحميل الصورة.'));
      });
      return {image:im,close:()=>URL.revokeObjectURL(url)};
    }catch(e){URL.revokeObjectURL(url);throw e}
  }
  function blobFrom(canvas,type,quality){
    return new Promise((ok,fail)=>canvas.toBlob(blob=>blob?ok(blob):
      fail(error('Could not encode this image.','تعذر تحويل الصورة.')),type,quality));
  }
  function outFile(blob,file){
    const ext=blob.type==='image/webp'?'webp':blob.type==='image/jpeg'?'jpg':'png';
    const name=(file.name||'image').replace(/\.[^/.]*$/,'')
      .replace(/[^a-zA-Z0-9_\-\u0600-\u06FF ]/g,'').trim().slice(0,65)||'image';
    return new File([blob],name+'-optimized.'+ext,
      {type:blob.type,lastModified:Date.now()});
  }
  async function compress(file){
    validation(file);
    if(file.size<=MAX)return {file,changed:false,before:file.size,after:file.size};
    const {width:originalW,height:originalH}=await imageMetadata(file);
    const longEdge=Math.max(originalW,originalH);
    if(!Number.isFinite(longEdge)||!longEdge)throw error('Invalid image dimensions.','أبعاد الصورة غير صالحة.');
    const edge=Math.min(2600,longEdge);
    const scale=edge/longEdge;
    const w=Math.max(1,Math.round(originalW*scale)),h=Math.max(1,Math.round(originalH*scale));
    const bm=await boundedBitmap(file,w,h);
    try{
      // Three total high-quality attempts vs 28 in the previous encoder.
      const attempts=[[w,h,.9],[w,h,.8],
        [Math.max(1,Math.round(w*.78)),Math.max(1,Math.round(h*.78)),.82]];
      for(let index=0;index<attempts.length;index++){
        const [cw,ch,quality]=attempts[index];
        const canvas=document.createElement('canvas');
        canvas.width=cw;canvas.height=ch;
        try{
          const ctx=canvas.getContext('2d',{alpha:true});
          if(!ctx)throw error('This device cannot compress the image.','لا يستطيع الجهاز ضغط الصورة.');
          ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
          ctx.drawImage(bm.image,0,0,cw,ch);
          let blob=await blobFrom(canvas,'image/webp',quality);
          if(blob.type!=='image/webp'){
            blob=await blobFrom(canvas,file.type==='image/png'?'image/png':'image/jpeg',quality);
          }
          if(!['image/webp','image/png','image/jpeg'].includes(blob.type))
            throw error('No supported image encoder on this device.','لا توجد أداة ضغط مدعومة على هذا الجهاز.');
          if(blob.size<=MAX){
            const output=outFile(blob,file);
            return {file:output,changed:true,before:file.size,after:output.size,width:cw,height:ch};
          }
          if(blob.type==='image/png')break;
        }finally{canvas.width=1;canvas.height=1}
      }
      throw error('This photo cannot be reduced below 8 MB automatically.',
        'تعذر ضغط هذه الصورة إلى أقل من 8 ميجابايت تلقائيًا.');
    }finally{bm.close()}
  }
  function prepare(file,options={}){
    validation(file);
    if(file.size<=MAX)return Promise.resolve({file,changed:false,before:file.size,after:file.size});
    if(!files.has(file)){
      const job=queue.catch(()=>{}).then(()=>compress(file));
      queue=job.then(()=>{},()=>{});
      files.set(file,job);
      job.catch(()=>{files.delete(file)});
    }
    return files.get(file);
  }
  // Keep the original article-editor and post-upload call signatures.
  window.NEISImageOptimizer=Object.freeze({prepare,maxBytes:MAX,version:3});
  async function publish(file,folder){
    if(!file||file.size<=8*1048576)return previousUpload.call(this,file,folder);
    progress(file,'optimizing',{
      en:'Optimizing image… Please keep this window open.',
      ar:'جارٍ تحسين الصورة… يُرجى إبقاء النافذة مفتوحة.'
    });
    try{
      const result=await prepare(file);
      progress(file,'uploading',{
        en:'Image ready ('+(result.after/1048576).toFixed(1)+' MB). Uploading…',
        ar:'الصورة جاهزة ('+(result.after/1048576).toFixed(1)+' ميجابايت). جارٍ الرفع…'
      });
      // The earlier v2 upload bridge forwards files already under 8 MiB
      // directly to the existing authenticated storage handler.
      const url=await previousUpload.call(this,result.file,folder);
      if(!url){
        progress(file,'error',{
          en:'Upload failed. Check your connection and try again.',
          ar:'فشل الرفع. تحقق من اتصالك وحاول مجددًا.'
        });
      }else{
        progress(file,'done',{
          en:'Image uploaded. Publishing your post…',
          ar:'تم رفع الصورة. جارٍ نشر المنشور…'
        });
      }
      return url;
    }catch(e){
      console.error('[NEIS fast image] Upload preparation failed',e);
      progress(file,'error',{en:e.message,ar:e.message});
      if(typeof toast==='function')toast(e.message);
      return '';
    }
  }
  window.uploadMedia=publish;
  // Start optimizing images as soon as the user selects them. Processing is
  // serialized to avoid exhausting mobile RAM for an eight-image post.
  document.addEventListener('change',event=>{
    const input=event.target;
    if(!(input instanceof HTMLInputElement)||input.type!=='file'||!input.files?.length)return;
    if(!/image/i.test(input.accept||'')&&
       !/image|photo|cover|media/i.test(input.id||''))return;
    for(const file of Array.from(input.files).slice(0,8)){
      formForFile.set(file,input.closest('form'));
      if(file.size<=8*1048576)continue;
      progress(file,'optimizing',{
        en:'Preparing large image in the background…',
        ar:'جارٍ تجهيز الصورة الكبيرة في الخلفية…'
      });
      prepare(file).then(result=>{
        // Only update the selection's current form, not a subsequently opened post.
        const form=formForFile.get(file);
        if(!form?.isConnected)return;
        progress(file,'ready',{
          en:'Image ready: '+(file.size/1048576).toFixed(1)+' → '+
            (result.after/1048576).toFixed(1)+' MB. You can publish.',
          ar:'الصورة جاهزة: '+(file.size/1048576).toFixed(1)+' ← '+
            (result.after/1048576).toFixed(1)+' ميجابايت. يمكنك النشر.'
        });
      }).catch(e=>{
        if(!formForFile.get(file)?.isConnected)return;
        progress(file,'error',{en:e.message,ar:e.message});
      });
    }
  },false);
  window.__NEISFastImagesV3=true;
})();