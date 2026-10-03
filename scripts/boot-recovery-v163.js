/* NEIS Circle v163 — final startup recovery.
   Runs after all feature layers so a transient OAuth/Supabase race cannot leave the app in the old empty shell. */
(function(){
  'use strict';
  let running=false,done=false;

  async function recover(){
    if(running||done)return;
    running=true;
    try{
      if(!window.supabase?.createClient&&typeof loadSupabaseLibrary==='function')await loadSupabaseLibrary();
      if(!sb&&typeof initSupabase==='function')await initSupabase();
      if(!sb)return;

      const result=await sb.auth.getSession();
      if(result.error)throw result.error;
      const session=result.data?.session||null;
      authUser=session?.user||null;

      if(!authUser){
        if(typeof render==='function')render();
        done=true;
        return;
      }

      if(typeof loadLiveData==='function')await loadLiveData();
      if(typeof setupBanner==='function')setupBanner=()=>'';
      if(typeof render==='function')render();
      done=true;
    }catch(error){
      console.error('[NEIS startup recovery]',error);
    }finally{
      running=false;
    }
  }

  // Defer until every normal defer script has completed and OAuth storage has settled.
  setTimeout(recover,0);
  setTimeout(()=>{if(!done)recover()},900);
  document.addEventListener('visibilitychange',()=>{if(!done&&document.visibilityState==='visible')recover()});
})();