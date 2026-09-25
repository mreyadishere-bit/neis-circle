/* NEIS Circle v26 — persistent account-access guard loaded after every UI extension. */
(function(){
  'use strict';
  const restricted=()=>!!(authUser&&['blocked','deactivated'].includes(String(state.accountAccess?.status||'').toLowerCase()));
  const showRestriction=()=>{
    const status=String(state.accountAccess?.status||'blocked').toLowerCase();
    if(typeof window.neisAccountStateScreen==='function')window.neisAccountStateScreen(status,state.accountAccess?.reason||'');
  };

  const previousRender=render;
  render=function(){
    if(restricted()){showRestriction();return}
    return previousRender();
  };

  const previousLoad=loadLiveData;
  loadLiveData=async function(){
    await previousLoad();
    if(restricted())showRestriction();
  };

  const previousRequireAccount=requireAccount;
  requireAccount=function(){
    if(restricted()){showRestriction();return false}
    return previousRequireAccount();
  };

  window.addEventListener('hashchange',function(){if(restricted())showRestriction()},true);
})();
