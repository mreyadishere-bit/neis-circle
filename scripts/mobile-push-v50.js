/* NEIS Circle v50 — Android native bridge: push registration, deep links, OAuth handoff. */
(function(){
  'use strict';

  const nativeBridge=window.NeisAndroid;
  const TOKEN_KEY='neis-native-push-token-v1';
  const APP_VERSION='1.0.0';

  function nativeAvailable(){
    return !!nativeBridge&&typeof nativeBridge.isNative==='function'&&nativeBridge.isNative();
  }

  function safeRoute(value){
    const route=String(value||'').trim().replace(/^#?\/?/,'');
    return /^[A-Za-z0-9_\-/?=&.%]+$/.test(route)?route:'';
  }

  async function registerStoredToken(){
    if(!nativeAvailable()||!sb||!authUser)return;
    const token=localStorage.getItem(TOKEN_KEY)||'';
    if(token.length<20)return;
    const {error}=await sb.rpc('register_push_device',{
      token_input:token,
      platform_input:'android',
      app_version_input:APP_VERSION
    });
    if(error){
      console.error('[NEIS mobile push registration]',error);
      return;
    }
    try{nativeBridge.pushRegistrationComplete?.()}catch(_){}
  }

  function receivePushToken(token){
    const clean=String(token||'').trim();
    if(clean.length<20)return;
    localStorage.setItem(TOKEN_KEY,clean);
    registerStoredToken();
  }

  function openNativeRoute(route){
    const clean=safeRoute(route);
    if(!clean)return;
    location.hash='#/'+clean;
  }

  async function handleAuthCallback(url){
    if(!sb)return;
    try{
      const parsed=new URL(String(url||''));
      const code=parsed.searchParams.get('code');
      if(!code)return;
      const {error}=await sb.auth.exchangeCodeForSession(code);
      if(error)throw error;
      if(typeof loadLiveData==='function')await loadLiveData();
      if(typeof render==='function')render();
    }catch(error){
      console.error('[NEIS native auth callback]',error);
      if(typeof toast==='function')toast('Sign-in could not be completed. Please try again.');
    }
  }

  async function startNativeGoogleSignIn(){
    if(!sb||!nativeAvailable())return false;
    const {data,error}=await sb.auth.signInWithOAuth({
      provider:'google',
      options:{
        redirectTo:'neiscircle://auth',
        skipBrowserRedirect:true
      }
    });
    if(error){
      if(typeof toast==='function')toast(error.message);
      return true;
    }
    if(data?.url){
      nativeBridge.openExternal(String(data.url));
      return true;
    }
    return false;
  }

  document.addEventListener('click',async(event)=>{
    const button=event.target?.closest?.('[data-auth-google]');
    if(!button||!nativeAvailable())return;
    event.preventDefault();
    event.stopImmediatePropagation();
    await startNativeGoogleSignIn();
  },true);

  window.addEventListener('neis:push-token',(event)=>receivePushToken(event.detail?.token));
  window.addEventListener('neis:notification-opened',(event)=>openNativeRoute(event.detail?.route));
  window.addEventListener('neis:auth-callback',(event)=>handleAuthCallback(event.detail?.url));

  window.NEISMobile={
    receivePushToken,
    openRoute:openNativeRoute,
    handleAuthCallback,
    registerPushToken:registerStoredToken
  };

  if(nativeAvailable()){
    document.documentElement.classList.add('neis-native-app');
    const previousLoad=loadLiveData;
    if(typeof previousLoad==='function'){
      loadLiveData=async function(){
        const result=await previousLoad.apply(this,arguments);
        await registerStoredToken();
        if(authUser){
          try{nativeBridge.requestPushToken?.()}catch(_){}
        }
        return result;
      };
    }
    if(authUser){
      setTimeout(()=>{
        try{nativeBridge.requestPushToken?.()}catch(_){}
        registerStoredToken();
      },250);
    }
  }
})();