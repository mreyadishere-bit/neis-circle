/* NEIS Circle 2026-10-13: safely downsample extreme-resolution user images
 * before upload. Overrides v1 optimizer without modifying any upload handler.
 * Both posts and article covers call NEISImageOptimizer.prepare() at runtime.
 */
(()=>{
 'use strict';
 const MIB=1048576;
 const TARGET=Math.floor(7.5*MIB);
 const MAX_SOURCE=100*MIB;
 const TYPES=new Set(['image/jpeg','image/png','image/webp','image/avif','image/heic','image/heif']);
 const t=(en,ar)=>new Error(
   ((typeof state!=='undefined'&&state?.lang==='ar')||
    document.documentElement.lang==='ar'||document.body?.classList.contains('rtl'))?ar:en);
 function validate(file){
   if(!file||!Number.isFinite(file.size)||file.size<=0)
     throw t('Choose a valid image.','اختر صورة صالحة.');
   if(file.type==='image/gif')
     throw t('Animated GIF cannot be compressed without losing animation. Use JPG, PNG or WebP.',
       'لا يمكن ضغط GIF المتحرك دون فقدان الحركة. استخدم JPG أو PNG أو WebP.');
   if(!TYPES.has(file.type.toLowerCase()))
     throw t('Use a supported JPG, PNG, WebP, AVIF or HEIC image.',
       'استخدم صورة JPG أو PNG أو WebP أو AVIF أو HEIC مدعومة.');
   if(file.size>MAX_SOURCE)
     throw t('This file exceeds the 100 MB device safety limit.',
       'هذا الملف يتجاوز حد الأمان البالغ 100 ميجابايت.');
 }
 async function readDimensions(file){
   // Loading metadata does not require constructing a full-size canvas.
   const url=URL.createObjectURL(file);
   const image=new Image();
   image.decoding='async';
   image.src=url;
   try{
     await new Promise((ok,fail)=>{
       if(image.complete&&image.naturalWidth){ok();return}
       image.onload=ok;
       image.onerror=()=>fail(t('The image cannot be opened on this device.',
         'تعذر فتح الصورة على هذا الجهاز.'));
     });
     const width=image.naturalWidth,height=image.naturalHeight;
     if(!width||!height)
       throw t('The image has invalid dimensions.','أبعاد الصورة غير صالحة.');
     return {image,width,height,release:()=>URL.revokeObjectURL(url)};
   }catch(err){URL.revokeObjectURL(url);throw err}
 }
 function blobFromCanvas(canvas,type,quality){
   return new Promise((ok,fail)=>{
     try{
       canvas.toBlob(blob=>blob?ok(blob):fail(
         t('The browser could not encode this image.','تعذر تحويل الصورة في المتصفح.')
       ),type,quality);
     }catch(_){fail(t('The browser could not compress this image.',
       'تعذر ضغط الصورة في المتصفح.'))}
   });
 }
 function asFile(blob,original){
   const type=String(blob.type).toLowerCase();
   const ext=type==='image/webp'?'webp':type==='image/jpeg'?'jpg':'png';
   const name=(original.name||'image').replace(/\.[^.]*$/,'')
       .replace(/[^a-zA-Z0-9_\-\u0600-\u06FF ]/g,'').trim().slice(0,70)||'image';
   return new File([blob],name+'-optimized.'+ext,{type,lastModified:Date.now()});
 }
 async function downsample(file,metadata,maxEdge){
   const w=metadata.width,h=metadata.height;
   const scale=Math.min(1,maxEdge/Math.max(w,h));
   const rw=Math.max(1,Math.round(w*scale));
   const rh=Math.max(1,Math.round(h*scale));
   if(typeof createImageBitmap==='function'){
     // Decode at target resolution rather than constructing a 200+ megapixel
     // bitmap/canvas. Chrome, Firefox and modern Safari support resize options.
     try{
       const bitmap=await createImageBitmap(file,{
         imageOrientation:'from-image',
         resizeWidth:rw,
         resizeHeight:rh,
         resizeQuality:'high'
       });
       if(bitmap && bitmap.width>0 && bitmap.height>0){
         return {source:bitmap,width:bitmap.width,height:bitmap.height,
           release:()=>bitmap.close()};
       }
       bitmap?.close();
     }catch(error){
       // Some codecs/devices do not support resized ImageBitmap.
       // Fall back to drawing the decoded image into a bounded canvas,
       // never into a canvas matching its original giant dimensions.
       console.warn('[NEIS image optimizer] Resized bitmap unavailable; using bounded canvas',error);
     }
   }
   return {source:metadata.image,width:w,height:h,release:()=>{}};
 }
 async function prepare(file,options={}){
   validate(file);
   const maxBytes=Math.max(1,Math.min(TARGET,options.maxBytes||TARGET));
   if(file.size<=maxBytes)
     return {file,changed:false,before:file.size,after:file.size};
   const metadata=await readDimensions(file);
   let resized=null;
   try{
     // Old version rejected any image >180 million pixels even when the
     // selected image was only 25 MB. This code *always* renders to at most
     // 3400px on the longest side and tries to downsample at decode time.
     resized=await downsample(file,metadata,3400);
     let lastError=null;
     for(const edge of [3400,3000,2600,2200,1800,1500,1200]){
       const ratio=Math.min(1,edge/Math.max(resized.width,resized.height));
       const width=Math.max(1,Math.round(resized.width*ratio));
       const height=Math.max(1,Math.round(resized.height*ratio));
       const canvas=document.createElement('canvas');
       canvas.width=width;canvas.height=height;
       try{
         const ctx=canvas.getContext('2d',{alpha:true});
         if(!ctx)throw t('This browser cannot process the image.',
           'لا يستطيع هذا المتصفح معالجة الصورة.');
         ctx.imageSmoothingEnabled=true;
         ctx.imageSmoothingQuality='high';
         ctx.drawImage(resized.source,0,0,width,height);
         // High-quality WebP preserves transparency even for large PNG files.
         // JPEG fallback is used only for non-transparent input types.
         for(const quality of [.92,.86,.80,.72]){
           let blob=await blobFromCanvas(canvas,'image/webp',quality);
           if(blob.type!=='image/webp'){
             if(file.type==='image/png'){
               blob=await blobFromCanvas(canvas,'image/png');
             }else{
               blob=await blobFromCanvas(canvas,'image/jpeg',quality);
             }
           }
           if(!['image/webp','image/png','image/jpeg'].includes(blob.type)){
             throw t('Image format conversion is unavailable on this device.',
               'تحويل صيغة الصور غير مدعوم على هذا الجهاز.');
           }
           if(blob.size<=maxBytes){
             const output=asFile(blob,file);
             return {file:output,changed:true,before:file.size,after:output.size,
               width,height};
           }
           if(blob.type==='image/png')break;
         }
       }catch(error){
         lastError=error;
         if(error?.name==='SecurityError')throw error;
       }finally{
         canvas.width=1;canvas.height=1;
       }
     }
     throw lastError||t('Could not compress this image below the upload limit.',
       'تعذر ضغط الصورة إلى أقل من حد الرفع.');
   }catch(error){
     if(error?.name==='SecurityError'||error?.name==='RangeError'){
       throw t('This device could not resize the image safely. Please try another browser or image.',
         'تعذر تصغير الصورة بأمان على هذا الجهاز. جرّب متصفحًا أو صورة أخرى.');
     }
     throw error;
   }finally{
     resized?.release();
     metadata.release();
   }
 }
 window.NEISImageOptimizer=Object.freeze({prepare,maxBytes:TARGET,version:2});
})();