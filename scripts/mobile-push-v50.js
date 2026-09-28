/* NEIS Circle v50 — Android native bridge: push registration, deep links, OAuth handoff. */
(function(){
  'use strict';

  const nativeBridge=window.NeisAndroid;
  const TOKEN_KEY='neis-native-push-token-v1';
  const APP_VERSION='1.0.0';
  let signOutHookInstalled=false;

  function nativeAvailable(){
    return !!nativeBridge&&typeof nativeBridge.isNative==='function'&&nativeBridge.isNative();
  }

  function safeRoute(value){
    const route=String(value||'').trim().replace(/^#?\/?/,'');
    return /^[A-Za-z0-9_\-/?=&.%]+$/.test(route)?route:'';
  }

  function installSignOutHook(){
    if(signOutHookInstalled||!sb?.auth?.signOut)return;
    signOutHookInstalled=true;
    const original=sb.auth.signOut.bind(sb.auth);
    sb.auth.signOut=async function(){
      const token=localStorage.getItem(TOKEN_KEY)||'';
      if(token.length>=20&&authUser){
        try{await sb.rpc('disable_push_device',{token_input:token})}catch(_){}
      }
      return original.apply(this,arguments);
    };
  }

  async function registerStoredToken(){
    if(!nativeAvailable()||!sb||!authUser)return;
    installSignOutHook();
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
      const query=parsed.searchParams;
      const hash=new URLSearchParams((parsed.hash||'').replace(/^#/,''));
      const callbackError=query.get('error_description')||hash.get('error_description')||query.get('error')||hash.get('error');
      if(callbackError)throw new Error(callbackError);

      const code=query.get('code');
      if(code){
        const {error}=await sb.auth.exchangeCodeForSession(code);
        if(error)throw error;
      }else{
        const accessToken=hash.get('access_token')||query.get('access_token');
        const refreshToken=hash.get('refresh_token')||query.get('refresh_token');
        if(!accessToken||!refreshToken)throw new Error('missing_auth_session');
        const {error}=await sb.auth.setSession({access_token:accessToken,refresh_token:refreshToken});
        if(error)throw error;
      }

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

  const lang=(en,arText)=>state.lang==='ar'?arText:en;

  async function openMobileNotificationSettings(){
    if(!nativeAvailable()||!authUser||!sb)return;
    const {data,error}=await sb.from('push_preferences').select('*').eq('user_id',authUser.id).maybeSingle();
    if(error){
      if(typeof toast==='function')toast(lang('Could not load notification settings.','تعذر تحميل إعدادات الإشعارات.'));
      return;
    }
    const prefs=data||{
      messages:true,replies:true,circles:true,social:true,announcements:true,reactions:false,sound:true
    };
    const row=(key,en,arText)=>`<label class="account-row" style="cursor:pointer"><span><b>${lang(en,arText)}</b></span><input type="checkbox" data-mobile-push-pref="${key}" ${prefs[key]!==false?'checked':''}></label>`;
    openModal(`
      <div class="modal-head">
        <div>
          <h2>${lang('Mobile notifications','إشعارات الموبايل')}</h2>
          <p>${lang('Choose which native Android notifications you want to receive.','اختر إشعارات أندرويد التي تريد استلامها.')}</p>
        </div>
        <button class="close" data-close>×</button>
      </div>
      <div class="account-menu">
        ${row('messages','Messages','الرسائل')}
        ${row('replies','Replies','الردود')}
        ${row('circles','Circles','المجتمعات')}
        ${row('social','Followers & social','المتابعون والتفاعل الاجتماعي')}
        ${row('announcements','Announcements','الإعلانات')}
        ${row('reactions','Likes & reactions','الإعجابات والتفاعلات')}
        ${row('sound','Notification sound','صوت الإشعارات')}
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary" data-mobile-system-settings>${lang('Android notification settings','إعدادات إشعارات أندرويد')}</button>
        <button type="button" class="primary" data-save-mobile-push>${lang('Save','حفظ')}</button>
      </div>
    `);

    const systemButton=document.querySelector('[data-mobile-system-settings]');
    if(systemButton)systemButton.onclick=()=>{try{nativeBridge.openNotificationSettings?.()}catch(_){}};

    const saveButton=document.querySelector('[data-save-mobile-push]');
    if(saveButton)saveButton.onclick=async()=>{
      const values={user_id:authUser.id};
      document.querySelectorAll('[data-mobile-push-pref]').forEach(input=>{
        values[input.dataset.mobilePushPref]=!!input.checked;
      });
      saveButton.disabled=true;
      const {error:saveError}=await sb.from('push_preferences').upsert(values,{onConflict:'user_id'});
      if(saveError){
        saveButton.disabled=false;
        if(typeof toast==='function')toast(lang('Could not save notification settings.','تعذر حفظ إعدادات الإشعارات.'));
        return;
      }
      closeModal();
      if(typeof toast==='function')toast(lang('Mobile notification settings saved.','تم حفظ إعدادات إشعارات الموبايل.'));
    };
  }

  function addMobileNotificationsToSettings(){
    if(!nativeAvailable()||!authUser)return;
    const menu=document.querySelector('#modalRoot .account-menu');
    if(!menu||menu.querySelector('[data-mobile-notification-settings]'))return;
    const button=document.createElement('button');
    button.type='button';
    button.className='account-row';
    button.dataset.mobileNotificationSettings='';
    button.innerHTML=`<span>${lang('Mobile notifications','إشعارات الموبايل')}</span><b>${lang('Sound & alerts →','الصوت والتنبيهات ←')}</b>`;
    menu.appendChild(button);
    button.onclick=openMobileNotificationSettings;
  }

  const previousSettings=typeof settings==='function'?settings:null;
  if(previousSettings){
    settings=function(){
      const result=previousSettings.apply(this,arguments);
      addMobileNotificationsToSettings();
      return result;
    };
  }

  window.NEISMobile={
    receivePushToken,
    openRoute:openNativeRoute,
    handleAuthCallback,
    registerPushToken:registerStoredToken,
    openNotificationSettings:openMobileNotificationSettings
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