/* NEIS Circle: desktop sidebar RTL/Arabic label corrections.
   Keeps the original v1 hover/pin behavior and native navigation intact. */
(()=>{
  'use strict';
  let ready=false;
  const labels={
    home:['Home','الرئيسية'],
    discover:['Discover','اكتشف'],
    circles:['Circles','المجتمعات'],
    messages:['Messages','الرسائل'],
    connections:['Connections','العلاقات'],
    library:['Saved','المحفوظات'],
    opportunities:['Opportunities','الفرص'],
    gallery:['Gallery','المعرض'],
    articles:['Articles','المقالات'],
    study:['Study','الدراسة'],
    timetable:['Timetable','الجدول'],
    admin:['Admin','الإدارة'],
    settings:['Settings','الإعدادات']
  };
  function arabic(){
    return document.body.classList.contains('rtl') ||
      document.documentElement.dir==='rtl' ||
      (typeof state!=='undefined' && state?.lang==='ar');
  }
  function sync(){
    const nav=document.querySelector('.rail.neis-hover-rail .rail-nav');
    if(!nav)return;
    const ar=arabic();
    for(const button of nav.querySelectorAll('button.nav-btn')){
      const key=button.dataset.nav||button.dataset.action;
      const name=labels[key]?.[ar?1:0];
      const label=button.querySelector('.neis-rail-label');
      // The original rail prioritizes stale title attributes. Use the
      // application's fixed route IDs for known labels, regardless of title.
      if(name&&label&&label.textContent!==name)label.textContent=name;
    }
    const subtitle=document.querySelector('.rail.neis-hover-rail .neis-rail-brand-name small');
    if(subtitle)subtitle.textContent=ar?'شبكة الطلاب':'student network';
    const pin=document.querySelector('.rail.neis-hover-rail .neis-rail-pin');
    const pinLabel=pin?.querySelector('.neis-rail-pin-label');
    if(pinLabel&&pin){
      const pressed=pin.getAttribute('aria-pressed')==='true';
      const label=pressed?(ar?'إلغاء التثبيت':'Unpin sidebar'):
          (ar?'تثبيت القائمة':'Pin sidebar');
      if(pinLabel.textContent!==label)pinLabel.textContent=label;
      if(pin.getAttribute('aria-label')!==label)pin.setAttribute('aria-label',label);
    }
  }
  function init(){
    if(ready)return;
    const nav=document.querySelector('.rail.neis-hover-rail .rail-nav');
    if(!nav)return;
    ready=true;
    sync();
    // The original app can change nav titles and active states without
    // replacing the rail. Watch only relevant mutations; no polling.
    const navObserver=new MutationObserver(()=>sync());
    navObserver.observe(nav,{
      subtree:true,
      attributes:true,
      attributeFilter:['title','aria-label','data-nav','data-action']
    });
    const localeObserver=new MutationObserver(()=>sync());
    localeObserver.observe(document.body,{
      attributes:true,attributeFilter:['class','dir']
    });
    localeObserver.observe(document.documentElement,{
      attributes:true,attributeFilter:['dir','lang']
    });
    const pin=document.querySelector('.rail.neis-hover-rail .neis-rail-pin');
    if(pin)pin.addEventListener('click',()=>queueMicrotask(sync));
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',init,{once:true});
  }else init();
})();
