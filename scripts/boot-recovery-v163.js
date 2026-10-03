/* NEIS Circle v164 — auth-safe startup recovery.
   Runs after all feature layers and never treats a still-processing OAuth callback as signed out. */
(function(){
  'use strict';
  let running=false,done=false,attempts=0;

  async function recover(){
    if(running||done)return;
    running=true;
    attempts++;
    try{
      if(!window.supabase?.createClient&&typeof loadSupabaseLibrary==='function')await loadSupabaseLibrary();
      if(!sb&&typeof initSupabase==='function')await initSupabase();
      if(!sb)return;

      let session=null;
      try{
        const result=await sb.auth.getSession();
        if(result.error)console.warn('[NEIS startup recovery] session read failed',result.error);
        session=result.data?.session||null;
      }catch(error){
        console.warn('[NEIS startup recovery] session read failed',error);
      }

      if(!session&&window.NEISAuthCallbackPending?.()){
        session=await window.NEISWaitForSession?.(7000)||null;
      }

      if(session){
        const sameUser=authUser&&String(authUser.id)===String(session.user?.id||'');
        authUser=session.user||authUser;
        window.NEISCleanAuthCallbackUrl?.();
        if(!(sameUser&&document.body.classList.contains('app-ready'))){
          try{await loadLiveData()}catch(error){console.error('[NEIS startup recovery] live-data load failed',error)}
          if(typeof render==='function')render();
        }
        if(typeof setupBanner==='function')setupBanner=()=>'';
        done=true;
        return;
      }

      if(window.NEISAuthCallbackPending?.()){
        return;
      }

      authUser=null;
      if(typeof render==='function')render();
      done=true;
    }catch(error){
      console.error('[NEIS startup recovery]',error);
    }finally{
      running=false;
      if(!done&&attempts<4)setTimeout(recover,Math.min(1200,250*attempts));
    }
  }

  setTimeout(recover,0);
  setTimeout(()=>{if(!done)recover()},900);
  document.addEventListener('visibilitychange',()=>{if(!done&&document.visibilityState==='visible')recover()});
})();