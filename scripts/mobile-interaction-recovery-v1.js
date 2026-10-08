/* Recover from orphaned full-screen overlays after mobile navigation.
   Never dismiss a real modal, image viewer, or active meeting. */
(()=>{
  'use strict';
  let pending=false;
  const isMobile=()=>matchMedia('(pointer: coarse)').matches||innerWidth<=768;
  const visible=el=>!!(el&&el.isConnected&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden');
  function check(){
    pending=false;
    if(!isMobile())return;
    const body=document.body;
    // Image viewer is removed asynchronously on some navigation paths.
    const hasGallery=Array.from(document.querySelectorAll('.image-lightbox,.post-image-gallery-lightbox')).some(visible);
    if(body.classList.contains('image-lightbox-open')&&!hasGallery){
      body.classList.remove('image-lightbox-open');
    }
    const root=document.getElementById('modalRoot');
    const layer=root?.querySelector('.modal-layer');
    const dialog=root?.querySelector('.modal');
    if(layer&&!visible(dialog)&&!body.classList.contains('meeting-open')){
      // A backdrop without a dialog can cover the entire screen and swallow touches.
      layer.remove();
    }
    // Only reset leftover scroll locks when no overlay owns scrolling.
    const modalOpen=!!root?.querySelector('.modal-layer .modal');
    if(!modalOpen&&!hasGallery&&!body.classList.contains('meeting-open')){
      if(body.style.overflow==='hidden')body.style.removeProperty('overflow');
      if(document.documentElement.style.overflow==='hidden')document.documentElement.style.removeProperty('overflow');
    }
  }
  function schedule(){
    if(pending)return;
    pending=true;
    requestAnimationFrame(check);
  }
  addEventListener('hashchange',schedule,{passive:true});
  addEventListener('pageshow',schedule,{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule()},{passive:true});
  // Do not scan overlays on every tap: this is hot-path work on Android.
  const root=document.getElementById('modalRoot');
  if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:false});
  schedule();
})();