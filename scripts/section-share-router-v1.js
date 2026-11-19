/* Section-specific share links: adapt /#/section without changing existing navigation. */
(function(){
  'use strict';
  const sections=new Set(['articles','study','circles','opportunities','gallery','timetable','games']);
  let lastApplied='';
  function route(){
    const match=/^#\/([a-z-]+)\/?$/.exec(window.location.hash);
    return match&&sections.has(match[1])?match[1]:null;
  }
  function apply(){
    const section=route();
    if(!section||lastApplied===section)return;
    // Only open a private section after the user has completed authentication.
    if(!document.body.classList.contains('app-ready'))return;
    if(typeof nav!=='function'||typeof state==='undefined')return;
    lastApplied=section;
    try{
      if(state.view!==section)nav(section);
    }catch(error){
      lastApplied='';
      console.warn('[NEIS Share links] Section not ready',error?.message||error);
    }
  }
  addEventListener('hashchange',()=>{lastApplied='';apply()});
  addEventListener('pageshow',apply);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
  const observer=new MutationObserver(()=>apply());
  observer.observe(document.body,{attributes:true,attributeFilter:['class']});
  // Handle slow authentication and module initialization without background polling.
})();
