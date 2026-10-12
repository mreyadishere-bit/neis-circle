/* NEIS Circle · full-week desktop-layout PNG export (no cloud upload / no account data changes).
   Always renders the user's existing timetable in an isolated 1560px+ desktop-sized
   document before rasterizing the exact board element, regardless of device viewport. */
(()=>{
'use strict';
const ROOT_ID='ttExportPng';
const FRAME_CLASS='tt-png-private-renderer';
const BUTTON_LABEL={en:'Export as PNG',ar:'تصدير كصورة PNG'};
let working=false;
let activeFrame=null;
let observer=null;
let scheduled=false;

function arabic(){return (typeof state!=='undefined'&&state?.lang==='ar')||
    document.documentElement.lang==='ar'||document.body.classList.contains('rtl')}
function translate(en,ar){return arabic()?ar:en}
function notify(en,ar){
  const message=translate(en,ar);
  if(typeof toast==='function')toast(message);
  else if(window.console)console.info('[Timetable PNG]',message);
}
function actualBoard(){
  return document.querySelector('#view .tt-desktop-only .tt-board');
}
function safeToExport(){
  return actualBoard() && typeof authUser!=='undefined'&&!!authUser?.id &&
    typeof state!=='undefined'&&state?.view==='timetable' &&
    state?.onboardingComplete===true && state?.timetable?.ready===true &&
    !state?.timetable?.loading;
}
function ensureButton(){
  const actions=document.querySelector('#view .tt-head-actions');
  if(!actions||!actualBoard()||document.getElementById(ROOT_ID))return;
  const button=document.createElement('button');
  button.type='button';
  button.id=ROOT_ID;
  button.className='secondary tt-export-png-button';
  button.dataset.ttExportPng='true';
  button.textContent=translate(BUTTON_LABEL.en,BUTTON_LABEL.ar);
  button.title=translate('Download your complete week in high resolution',
    'تنزيل جدول الأسبوع كاملًا بجودة عالية');
  button.addEventListener('click',()=>{void exportPNG(button)});
  actions.insertBefore(button,actions.firstChild);
}
function syncButton(){
  const button=document.getElementById(ROOT_ID);
  if(button){
    button.textContent=working
      ?translate('Creating PNG…','جارٍ تجهيز الصورة…')
      :translate(BUTTON_LABEL.en,BUTTON_LABEL.ar);
    button.disabled=working;
    button.setAttribute('aria-busy',String(working));
  }
}
function schedule(){
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(()=>{
    scheduled=false;
    ensureButton();
    syncButton();
  });
}
function awaitEvent(target,type,ms=9000){
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{cleanup();reject(new Error('Render preparation timed out'))},ms);
    function done(){cleanup();resolve()}
    function cleanup(){clearTimeout(timeout);target.removeEventListener(type,done)}
    target.addEventListener(type,done,{once:true});
  });
}
async function createFrame(original,columns){
  const width=Math.max(1560,columns*304+40);
  // A same-origin srcdoc viewport ensures all @media rules resolve as on desktop
  // even when exporting on a narrow Android/iOS phone.
  const frame=document.createElement('iframe');
  frame.className=FRAME_CLASS;
  frame.setAttribute('aria-hidden','true');
  frame.tabIndex=-1;
  frame.style.cssText='position:fixed!important;left:-30000px!important;top:0!important;'+
    'width:'+width+'px!important;height:900px!important;border:0!important;'+
    'pointer-events:none!important;opacity:1!important;z-index:-1!important;';
  const styles=[...document.querySelectorAll('link[rel="stylesheet"],style')]
    .filter(element=>!element.closest('#modalRoot') && !element.closest('iframe'))
    .map(element=>{
      if(element.tagName==='LINK'){
        const url=element.href;
        if(!url||!/^https?:/.test(url)||new URL(url,location.href).origin!==location.origin)return '';
        return '<link rel="stylesheet" href="'+url.replaceAll('&','&amp;').replaceAll('"','&quot;')+'">';
      }
      return '<style>'+element.textContent.replace(/<\/style/gi,'<\\/style')+'</style>';
    }).join('\n');
  const base='<base href="'+document.baseURI.replaceAll('&','&amp;').replaceAll('"','&quot;')+'">';
  const config='<style>:root{--ink:#13211d;--muted:#66736f;--paper:#f3f6f2;'+
    '--card:#fff;--soft:#e9efeb;--line:#dce5df;--accent:#006f5b;--accent2:#e6f5ef;'+
    'color-scheme:light!important}'+
    'html,body{margin:0!important;width:100%!important;overflow:visible!important;'+
    'background:#fff!important;color:#13211d!important;font-family:"DM Sans","IBM Plex Sans Arabic",system-ui,sans-serif!important}'+
    'body>.tt-png-stage{width:100%;padding:16px;box-sizing:border-box;'+
    'background:#f7f9fb;display:block;overflow:visible}'+
    '.tt-png-stage .tt-board{display:grid!important;width:100%!important;'+
    'grid-template-columns:repeat('+columns+',minmax(0,1fr))!important;'+
    'gap:12px!important;overflow:visible!important;'+
    'padding:0 0 12px!important;align-items:stretch!important;box-sizing:border-box}'+
    '.tt-png-stage .tt-day{min-width:0!important}'+
    '.tt-png-stage .tt-day-body{min-height:560px!important}'+
    '.tt-png-stage .tt-event,.tt-png-stage .tt-event:hover{transform:none!important;'+
    'transition:none!important;animation:none!important}'+
    '.tt-png-stage *{animation:none!important;transition:none!important;caret-color:transparent!important}'+
    '</style>';
  frame.srcdoc='<!doctype html><html lang="'+(arabic()?'ar':'en')+
    '"><head><meta charset="utf-8">'+base+styles+config+
    '</head><body><div class="tt-png-stage"></div></body></html>';
  const loaded=awaitEvent(frame,'load',12000);
  document.body.appendChild(frame);
  activeFrame=frame;
  await loaded;
  const doc=frame.contentDocument,win=frame.contentWindow;
  if(!doc||!win)throw new Error('Export frame is unavailable');
  const clone=original.cloneNode(true);
  clone.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
  // Board HTML is already sanitized by the timetable renderer; don't expose
  // any controls to the snapshot context.
  const stage=doc.querySelector('.tt-png-stage');
  stage.appendChild(doc.importNode(clone,true));
  if(arabic()){doc.body.classList.add('rtl');stage.dir='rtl'}
  await Promise.race([doc.fonts?.ready||Promise.resolve(),new Promise(r=>setTimeout(r,2500))]);
  await new Promise(resolve=>win.requestAnimationFrame(()=>win.requestAnimationFrame(resolve)));
  const board=stage.querySelector('.tt-board');
  // Size the renderer to all rows, including any tall schedule and extra days.
  const height=Math.ceil(Math.max(stage.scrollHeight,stage.getBoundingClientRect().height));
  frame.style.height=(height+2)+'px';
  await new Promise(resolve=>win.requestAnimationFrame(resolve));
  return {stage,frame,win,doc,width,height};
}
function pseudoStyle(source,name){
  const css=source.ownerDocument.defaultView.getComputedStyle(source,name);
  if(!css||css.content==='none'||css.content==='normal')return null;
  return css;
}
function inlineComputedStyles(original){
  const duplicate=original.cloneNode(true);
  const originalNodes=[original,...original.querySelectorAll('*')];
  const copyNodes=[duplicate,...duplicate.querySelectorAll('*')];
  if(originalNodes.length!==copyNodes.length)throw new Error('Snapshot DOM mismatch');
  const win=original.ownerDocument.defaultView;
  for(let i=0;i<originalNodes.length;i++){
    const from=originalNodes[i],to=copyNodes[i];
    const computed=win.getComputedStyle(from);
    const style=[];
    for(let j=0;j<computed.length;j++){
      const key=computed[j],value=computed.getPropertyValue(key);
      if(!value)continue;
      // Every layout/color property comes from the real desktop-sized board.
      // Do not resolve any outside URLs when the SVG is rendered as an image.
      if(/url\(\s*(['"]?)https?:/i.test(value))continue;
      style.push(key+':'+value);
    }
    style.push('animation:none','transition:none','caret-color:transparent');
    to.setAttribute('style',style.join(';'));
    // The original colored cards use an ::before gradient overlay. Recreate
    // that pseudo element as a real snapshot node to preserve the original look.
    if(from.classList?.contains('tt-event')){
      const pseudo=pseudoStyle(from,'::before');
      if(pseudo){
        const overlay=from.ownerDocument.createElement('span');
        const props=['position','inset','background','background-image',
          'opacity','border-radius','z-index','pointer-events'];
        for(const key of props){
          const val=pseudo.getPropertyValue(key);
          if(val)overlay.style.setProperty(key,val);
        }
        overlay.style.pointerEvents='none';
        to.insertBefore(overlay,to.firstChild);
      }
    }
  }
  duplicate.setAttribute('xmlns','http://www.w3.org/1999/xhtml');
  return duplicate;
}
async function renderBlob(stage,width,height){
  if(width>5000||height>8500||width*height>18000000)
    throw new Error('Timetable is too large for a single PNG');
  const pixelRatio=Math.min(2.5,Math.sqrt(15000000/(width*height)));
  const targetW=Math.round(width*pixelRatio),targetH=Math.round(height*pixelRatio);
  const clone=inlineComputedStyles(stage);
  const xml=new XMLSerializer().serializeToString(clone);
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+
    '" viewBox="0 0 '+width+' '+height+'">'+
    '<foreignObject x="0" y="0" width="100%" height="100%">'+xml+
    '</foreignObject></svg>';
  // SVG must be a self-contained data URL: rendering a blob-backed foreignObject
  // can taint Canvas in Chromium even when the timetable contains no remote images.
  const url='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  {
    const image=new Image();
    image.decoding='async';
    image.src=url;
    if(image.decode){await image.decode()}
    else await Promise.race([awaitEvent(image,'load',9000),awaitEvent(image,'error',9000)
      .then(()=>{throw new Error('Image rendering failed')})]);
    const canvas=document.createElement('canvas');
    canvas.width=targetW;canvas.height=targetH;
    const context=canvas.getContext('2d',{alpha:false});
    if(!context)throw new Error('Canvas is unavailable');
    context.fillStyle='#f7f9fb';context.fillRect(0,0,targetW,targetH);
    context.drawImage(image,0,0,targetW,targetH);
    // Detect an unsupported foreignObject instead of offering a blank PNG.
    const check=context.getImageData(Math.round(targetW/2),Math.round(24*pixelRatio),1,1).data;
    if(check[3]===0)throw new Error('The browser could not render the PNG');
    const png=await new Promise((resolve,reject)=>canvas.toBlob(b=>{
      if(b&&b.size>3000)resolve(b);else reject(new Error('PNG encoding failed'));
    },'image/png'));
    if(png.type!=='image/png')throw new Error('PNG encoding unavailable');
    return png;
  }
}
async function save(blob){
  const url=URL.createObjectURL(blob);
  const file='NEIS-Circle-Timetable-'+new Date().toISOString().slice(0,10)+'.png';
  try{
    // On browsers supporting file sharing, keep an ordinary download as default
    // so desktop and Android save files consistently.
    const a=document.createElement('a');
    a.href=url;a.download=file;a.style.display='none';
    document.body.appendChild(a);a.click();a.remove();
    await new Promise(r=>setTimeout(r,650));
  }finally{
    // Let slower mobile download implementations finish consuming the blob URL.
    setTimeout(()=>URL.revokeObjectURL(url),45000);
  }
}
async function exportPNG(button){
  if(working)return;
  if(!safeToExport()){
    notify('Wait for the timetable to finish loading.','انتظر حتى يكتمل تحميل الجدول.');
    return;
  }
  working=true;syncButton();
  let current=null;
  try{
    const board=actualBoard();
    const dayCount=board.querySelectorAll(':scope > .tt-day').length;
    if(dayCount<1||dayCount>7)throw new Error('Invalid number of timetable days');
    current=await createFrame(board,dayCount);
    if(!safeToExport())throw new Error('Timetable changed while preparing export');
    const png=await renderBlob(current.stage,current.width,current.height);
    await save(png);
    notify('Timetable PNG downloaded successfully.','تم تنزيل صورة الجدول بنجاح.');
  }catch(error){
    console.error('[NEIS Timetable PNG]',error);
    notify('Could not export PNG. Please try again.','تعذر تصدير الصورة. حاول مرة أخرى.');
  }finally{
    activeFrame?.remove();
    activeFrame=null;working=false;syncButton();
  }
}
document.addEventListener('DOMContentLoaded',()=>{
  const root=document.getElementById('view');
  if(!root)return;
  observer=new MutationObserver(schedule);
  observer.observe(root,{childList:true,subtree:false});
  schedule();
});
if(document.readyState!=='loading'){
  const root=document.getElementById('view');
  if(root){observer=new MutationObserver(schedule);observer.observe(root,{childList:true,subtree:false});schedule()}
}
})();
