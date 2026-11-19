/* Deep-link OPENING only. Keep original NEIS Circle UI, routes and navigation. */
(function(){
  'use strict';
  const VIEWS=Object.freeze({
    home:'home',feed:'home',discover:'discover',study:'study',
    articles:'articles',circles:'circles',messages:'messages',
    connections:'connections',saved:'library',library:'library',
    opportunities:'opportunities',gallery:'gallery',timetable:'timetable'
  });
  const ACTIONS=Object.freeze({
    notifications:'[data-action="notifications"]',
    settings:'.rail [data-action="settings"]',
    games:'[data-neis-connect-open]'
  });
  const REMEMBER='neis-clean-share-pending';
  let lastApplied='';
  function section(){
    const match=/^#\/([a-z-]+)\/?$/.exec(location.hash);
    return match&&(VIEWS[match[1]]||ACTIONS[match[1]]||match[1]==='analytics')?match[1]:'';
  }
  function remember(slug){
    try{sessionStorage.setItem(REMEMBER,JSON.stringify({slug,at:Date.now()}))}catch(_){}
  }
  function getRemembered(){
    try{
      const p=JSON.parse(sessionStorage.getItem(REMEMBER)||'null');
      return p&&Date.now()-p.at<10*60*1000&&(VIEWS[p.slug]||ACTIONS[p.slug]||p.slug==='analytics')?p.slug:'';
    }catch(_){return ''}
  }
  function clearRemembered(){try{sessionStorage.removeItem(REMEMBER)}catch(_){}}
  function apply(){
    const slug=section()||getRemembered();
    if(!slug||slug===lastApplied)return;
    if(!document.body.classList.contains('app-ready'))return;
    try{
      if(VIEWS[slug]){
        if(typeof nav!=='function'||typeof state==='undefined')return;
        if(state.view!==VIEWS[slug])nav(VIEWS[slug]);
      }else if(slug==='analytics'){
        // Admin is still protected by the app's existing access checks.
        if(typeof nav!=='function'||typeof state==='undefined')return;
        if(!state.isAdmin)return;
        nav('admin');
      }else{
        const button=document.querySelector(ACTIONS[slug]);
        if(!button)return;
        button.click();
      }
      lastApplied=slug;
      clearRemembered();
    }catch(e){
      console.warn('[NEIS deep links] Could not open section',e?.message||e);
    }
  }
  const initial=section();
  if(initial)remember(initial);
  addEventListener('hashchange',()=>{
    lastApplied='';
    const next=section();
    if(next)remember(next);
    apply();
  });
  addEventListener('pageshow',apply);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
  if(document.body){
    new MutationObserver(apply).observe(document.body,{attributes:true,attributeFilter:['class']});
  }
})();
