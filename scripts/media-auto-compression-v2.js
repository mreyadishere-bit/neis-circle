/* NEIS Circle · Automatic compression for post / poll / circle gallery uploads.
 * Bridge the existing 8MB global uploadMedia limit to the already-tested
 * browser image optimizer used by article covers.
 * Does not change any server limits or file permissions.
 */
(()=>{
  'use strict';
  const LIMIT=8*1024*1024;
  if(window.__neisMediaAutoCompressV2)return;
  const original=window.uploadMedia;
  if(typeof original!=='function'){
    console.error('[NEIS Image Compression] Upload handler not available');
    return;
  }
  if(typeof window.NEISImageOptimizer?.prepare!=='function'){
    console.error('[NEIS Image Compression] Image optimizer not available');
    return;
  }
  const translate=(en,ar)=>(
    (typeof state!=='undefined'&&state?.lang==='ar')||
    document.documentElement.getAttribute('lang')==='ar'||
    document.body?.classList.contains('rtl'))?ar:en;
  const notify=(en,ar)=>{
    if(typeof toast==='function')toast(translate(en,ar));
  };
  let saved=original;
  async function optimizedUploadMedia(file,folder){
    // Preserve existing permission and missing-file behavior.
    if(!file || !Number.isFinite(file.size) || file.size<=LIMIT)
      return saved.call(this,file,folder);
    try{
      notify('Optimizing large image before upload…','جارٍ ضغط الصورة الكبيرة قبل الرفع…');
      const result=await window.NEISImageOptimizer.prepare(file);
      if(!result?.file || result.file.size>LIMIT)
        throw new Error(translate('Image could not be compressed below 8 MB.',
          'تعذر تقليل حجم الصورة إلى أقل من 8 ميجابايت.'));
      if(result.changed){
        notify('Image optimized: '+(file.size/1048576).toFixed(1)+' → '+
          (result.file.size/1048576).toFixed(1)+' MB',
          'تم ضغط الصورة: '+(file.size/1048576).toFixed(1)+' ← '+
          (result.file.size/1048576).toFixed(1)+' ميجابايت');
      }
      // Use the original storage policy and path generator, but pass the
      // actual optimized file whose MIME type and .webp extension match.
      return await saved.call(this,result.file,folder);
    }catch(error){
      console.error('[NEIS Image Compression] Upload not attempted',error);
      if(typeof toast==='function')toast(
        error?.message||translate('Image optimization failed. Please try another image.',
          'تعذر ضغط الصورة. جرّب صورة أخرى.'));
      return '';
    }
  }
  window.uploadMedia=optimizedUploadMedia;
  window.__neisMediaAutoCompressV2=true;
  window.NEISMediaUploadBridge=Object.freeze({limitBytes:LIMIT});
})();