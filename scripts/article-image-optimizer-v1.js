/* NEIS Circle: private, in-browser image optimization for article covers.
   Never uploads or saves original bytes; preserve orientation, aspect, transparency.
   Small images pass through untouched. */
(()=>{
  'use strict';
  const MIB=1024*1024;
  const MAX_UPLOAD=Math.floor(7.5*MIB); // Leave headroom below community-media 8 MiB limit.
  const MAX_SOURCE=100*MIB;
  const formats=new Set(['image/jpeg','image/png','image/webp','image/avif','image/heic','image/heif']);
  const mimeOf=file=>String(file?.type||'').toLowerCase();
  const message=(en,ar)=>new Error(
    (typeof state!=='undefined'&&state?.lang==='ar')?ar:en);
  const valid=(file)=>{
    if(!file||!Number.isFinite(file.size)||file.size===0)
      throw message('Please choose a valid image.','اختر صورة صالحة.');
    if(mimeOf(file)==='image/gif')
      throw message('Animated GIF files cannot be safely reduced without losing animation. Use JPG, PNG, or WebP.',
        'لا يمكن ضغط صور GIF المتحركة بأمان دون فقدان الحركة. استخدم JPG أو PNG أو WebP.');
    if(!formats.has(mimeOf(file)))
      throw message('Choose a JPG, PNG, WebP, AVIF, or browser-supported HEIC image.',
        'اختر صورة JPG أو PNG أو WebP أو AVIF أو HEIC المدعومة في المتصفح.');
    if(file.size>MAX_SOURCE)
      throw message('This image is too large to safely process on this device (maximum 100 MB).',
        'الصورة كبيرة جدًا للمعالجة الآمنة على هذا الجهاز (الحد الأقصى 100 ميجابايت).');
  };
  async function decode(file){
    const url=URL.createObjectURL(file);
    try{
      const image=new Image();
      image.decoding='async';
      image.src=url;
      await new Promise((resolve,reject)=>{
        if(image.complete&&image.naturalWidth){resolve();return}
        image.onload=()=>resolve();
        image.onerror=()=>reject(message('Could not open this image on your device.',
            'تعذر فتح الصورة على جهازك.'));
      });
      if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>180000000)
        throw message('Image dimensions exceed the safe processing limit.',
          'أبعاد الصورة تتجاوز حد المعالجة الآمن.');
      return image;
    }finally{URL.revokeObjectURL(url)}
  }
  function encode(canvas,type,quality){
    return new Promise((resolve,reject)=>{
      try{canvas.toBlob(blob=>blob?resolve(blob):
        reject(message('Image compression is unavailable.','تعذر ضغط الصورة.')),type,quality)}
      catch(_){reject(message('Unable to compress this image in this browser.',
        'يتعذر ضغط هذه الصورة في المتصفح.'))}
    });
  }
  function fileFrom(blob,source){
    const type=blob.type.toLowerCase();
    const ext=type==='image/webp'?'webp':type==='image/jpeg'?'jpg':'png';
    const basename=String(source.name||'image').replace(/\.[^.]*$/,'')
      .replace(/[^a-zA-Z0-9_\-\u0600-\u06FF ]/g,'').trim().slice(0,70)||'image';
    return new File([blob],basename+'-optimized.'+ext,
      {type,lastModified:Date.now()});
  }
  async function prepare(file,options={}){
    valid(file);
    const maxBytes=Math.min(MAX_UPLOAD,options.maxBytes||MAX_UPLOAD);
    if(file.size<=maxBytes)return {file,changed:false,before:file.size,after:file.size};
    const image=await decode(file);
    const width=image.naturalWidth,height=image.naturalHeight;
    const sizes=[3400,3000,2600,2200,1800,1500,1200];
    // WebP keeps transparent PNG pixels and normally compresses high-quality photos
    // much better than PNG/JPG, without introducing white backgrounds.
    const preferred='image/webp';
    let best=null;
    for(const limit of sizes){
      const scale=Math.min(1,limit/Math.max(width,height));
      const outWidth=Math.max(1,Math.round(width*scale));
      const outHeight=Math.max(1,Math.round(height*scale));
      const canvas=document.createElement('canvas');
      canvas.width=outWidth;canvas.height=outHeight;
      const ctx=canvas.getContext('2d',{alpha:true});
      if(!ctx)throw message('This device cannot prepare the image.',
        'يتعذر تجهيز الصورة على هذا الجهاز.');
      ctx.imageSmoothingEnabled=true;
      ctx.imageSmoothingQuality='high';
      ctx.drawImage(image,0,0,outWidth,outHeight);
      for(const quality of [.92,.86,.8,.72]){
        let blob=await encode(canvas,preferred,quality);
        // Some browsers silently fall back to PNG if WebP encoding is unsupported.
        if(blob.type!=='image/webp'){
          if(mimeOf(file)!=='image/png'){
            blob=await encode(canvas,'image/jpeg',quality);
            if(blob.type!=='image/jpeg')break;
          }else{
            // Preserve alpha. Never turn a transparent cover into a solid background.
            blob=await encode(canvas,'image/png');
            if(blob.type!=='image/png')break;
          }
        }
        if(!best||blob.size<best.size)best=blob;
        if(blob.size<=maxBytes){
          const output=fileFrom(blob,file);
          return {file:output,changed:true,before:file.size,after:output.size,
            width:outWidth,height:outHeight};
        }
        if(blob.type==='image/png')break; // Quality level has no effect on PNG.
      }
      canvas.width=1;canvas.height=1;
    }
    throw message('This image could not be reduced enough. Try a different JPG, PNG, or WebP image.',
      'تعذر تقليل حجم الصورة بما يكفي. جرّب صورة JPG أو PNG أو WebP أخرى.');
  }
  window.NEISImageOptimizer=Object.freeze({prepare,maxBytes:MAX_UPLOAD});
})();