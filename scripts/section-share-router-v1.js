/* Route public share landing-page links into existing authenticated app sections. */
(function(){
  'use strict';
  const sections=new Set(['articles','study','circles','opportunities','gallery','timetable']);
  const pendingKey='neis-share-route-pending';
  const pendingMaxAge=15*60*1000;
  let applied='';
  function fromHash(){
    const match=/^#\/([a-z-]+)\/?$/.exec(location.hash);
    return match&&sections.has(match[1])?match[1]:'';
  }
  function savePending(section){
    if(!section)return;
    try{sessionStorage.setItem(pendingKey,JSON.stringify({section,at:Date.now()}))}catch(_){}
  }
  function readPending(){
    try{
      const parsed=JSON.parse(sessionStorage.getItem(pendingKey)||'null');
      return parsed&&sections.has(parsed.section)&&Date.now()-parsed.at<pendingMaxAge?parsed.section:'';
    }catch(_){return ''}
  }
  function clearPending(){
    try{sessionStorage.removeItem(pendingKey)}catch(_){}
  }
  function activate(){
    const section=fromHash()||readPending();
    if(!section||applied===section)return;
    if(!document.body.classList.contains('app-ready'))return;
    if(typeof state==='undefined'||typeof nav!=='function')return;
    try{
      if(state.view!==section)nav(section);
      applied=section;
      clearPending();
    }catch(error){
      console.warn('[NEIS Share links] Could not open section',error?.message||error);
    }
  }
  const initial=fromHash();
  if(initial)savePending(initial);
  addEventListener('hashchange',()=>{
    const next=fromHash();
    applied='';
    if(next)savePending(next);
    activate();
  });
  addEventListener('pageshow',activate);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',activate,{once:true});
  else activate();
  const observer=new MutationObserver(activate);
  observer.observe(document.body,{attributes:true,attributeFilter:['class']});
})();
