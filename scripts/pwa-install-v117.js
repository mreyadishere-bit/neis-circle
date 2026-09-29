/* NEIS Circle PWA — install flow, web push, and browser/system theme sync. */
(function(){
  'use strict';

  const VAPID_PUBLIC_KEY='BKPTZrkpcjMsJHXVOCnZHW-ht94oEPCIvZ8HMu65tQEnfjhoi5-HdBODDt1iNVBFIgsZoyMwXQxQJLJ62ZQoWYw';
  let deferredInstallPrompt=null;
  let serviceWorkerRegistration=null;
  let signOutHookInstalled=false;

  const lang=(en,arText)=>{
    try{return typeof state!=='undefined'&&state.lang==='ar'?arText:en}catch(_){return en}
  };

  function isStandalone(){
    return window.matchMedia?.('(display-mode: standalone)')?.matches===true ||
      window.navigator.standalone===true;
  }

  function base64UrlToUint8Array(value){
    const padding='='.repeat((4-value.length%4)%4);
    const base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/');
    const raw=atob(base64);
    return Uint8Array.from([...raw].map(ch=>ch.charCodeAt(0)));
  }

  function syncThemeChrome(){
    try{
      const root=document.documentElement;
      const style=getComputedStyle(root);
      const theme=(root.dataset.theme||localStorage.getItem('neis-theme')||'light').toLowerCase();
      const background=(style.getPropertyValue('--paper')||'').trim() || (theme==='dark'?'#0d1512':'#f3f6f2');
      let meta=document.querySelector('meta[name="theme-color"]');
      if(!meta){
        meta=document.createElement('meta');
        meta.name='theme-color';
        document.head.appendChild(meta);
      }
      meta.content=background;

      let scheme=document.querySelector('meta[name="color-scheme"]');
      if(!scheme){
        scheme=document.createElement('meta');
        scheme.name='color-scheme';
        document.head.appendChild(scheme);
      }
      scheme.content=theme==='dark'?'dark':'light';
      root.style.colorScheme=theme==='dark'?'dark':'light';
      document.body?.style.setProperty('background-color',background);
    }catch(_){}
  }

  async function registerServiceWorker(){
    if(!('serviceWorker' in navigator))return null;
    try{
      const migrationKey='neis-pwa-sw-migrated-v6';
      if(localStorage.getItem(migrationKey)!=='1'){
        const registrations=await navigator.serviceWorker.getRegistrations();
        for(const reg of registrations){
          try{await reg.unregister()}catch(_){}
        }
        localStorage.setItem(migrationKey,'1');
      }
      serviceWorkerRegistration=await navigator.serviceWorker.register('/neis-pwa-sw.js?v=6',{scope:'/'});
      serviceWorkerRegistration.update().catch(()=>{});
      navigator.serviceWorker.ready.then(reg=>{
        serviceWorkerRegistration=reg;
        reg.update().catch(()=>{});
        if(('Notification' in window)&&Notification.permission==='granted'){
          setTimeout(()=>{ensureWebPush(false).catch(()=>{})},300);
        }
      }).catch(()=>{});
      return serviceWorkerRegistration;
    }catch(error){
      console.error('[NEIS PWA service worker]',error);
      return null;
    }
  }

  function updateInstallUI(){
    const installed=isStandalone();
    document.querySelectorAll('[data-pwa-install-card]').forEach(card=>{
      card.classList.toggle('hidden',installed);
    });
    document.querySelectorAll('[data-pwa-install]').forEach(button=>{
      if(installed){
        button.disabled=true;
        button.textContent=lang('Installed','مثبّت');
      }else if(deferredInstallPrompt){
        button.disabled=false;
        button.textContent=lang('Install app','تثبيت التطبيق');
      }else{
        button.disabled=false;
        button.textContent=lang('Add to Home Screen','إضافة للشاشة الرئيسية');
      }
    });
  }

  async function installPwa(){
    if(isStandalone()){
      if(typeof toast==='function')toast(lang('NEIS Circle is already installed.','NEIS Circle مثبت بالفعل.'));
      return;
    }
    if(deferredInstallPrompt){
      const prompt=deferredInstallPrompt;
      deferredInstallPrompt=null;
      await prompt.prompt();
      const result=await prompt.userChoice.catch(()=>null);
      updateInstallUI();
      if(result?.outcome==='accepted'&&typeof toast==='function'){
        toast(lang('NEIS Circle installed.','تم تثبيت NEIS Circle.'));
      }
      return;
    }
    if(typeof toast==='function'){
      toast(lang('Open your browser menu and choose “Install app” or “Add to Home screen”.','افتح قائمة المتصفح واختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».'));
    }
  }

  async function currentSubscription(){
    const registration=serviceWorkerRegistration||await registerServiceWorker();
    if(!registration?.pushManager)return null;
    return registration.pushManager.getSubscription();
  }

  async function registerSubscriptionWithServer(subscription){
    if(!subscription||!(typeof sb!=='undefined'?sb:null)||!(typeof authUser!=='undefined'?authUser:null))return false;
    const json=subscription.toJSON();
    const {error}=await sb.rpc('register_web_push_subscription',{
      endpoint_input:subscription.endpoint,
      p256dh_input:json.keys?.p256dh||'',
      auth_input:json.keys?.auth||'',
      user_agent_input:navigator.userAgent||''
    });
    if(error){
      console.error('[NEIS web push registration]',error);
      return false;
    }
    return true;
  }

  async function ensureWebPush(requestPermission){
    if(!('Notification' in window)||!('PushManager' in window)||!('serviceWorker' in navigator)){
      if(requestPermission&&typeof toast==='function')toast(lang('Notifications are not supported in this browser.','المتصفح الحالي لا يدعم الإشعارات.'));
      return false;
    }
    if(!(typeof authUser!=='undefined'?authUser:null)||!(typeof sb!=='undefined'?sb:null)){
      if(requestPermission&&typeof toast==='function')toast(lang('Sign in first to enable notifications.','سجّل الدخول أولًا لتفعيل الإشعارات.'));
      return false;
    }

    let permission=Notification.permission;
    if(permission==='default'&&requestPermission){
      permission=await Notification.requestPermission();
    }
    if(permission!=='granted'){
      if(requestPermission&&typeof toast==='function'){
        toast(permission==='denied'
          ?lang('Notifications are blocked. Enable them from your browser/site settings.','الإشعارات محظورة. فعّلها من إعدادات الموقع في المتصفح.')
          :lang('Allow notifications to receive alerts when NEIS Circle is closed.','اسمح بالإشعارات لاستقبال التنبيهات حتى عند إغلاق NEIS Circle.'));
      }
      return false;
    }

    const registration=serviceWorkerRegistration||await registerServiceWorker();
    if(!registration?.pushManager)return false;

    let subscription=await registration.pushManager.getSubscription();
    if(!subscription){
      try{
        subscription=await registration.pushManager.subscribe({
          userVisibleOnly:true,
          applicationServerKey:base64UrlToUint8Array(VAPID_PUBLIC_KEY)
        });
      }catch(error){
        console.error('[NEIS web push subscribe]',error);
        if(requestPermission&&typeof toast==='function')toast(lang('Could not enable notifications. Please try again.','تعذر تفعيل الإشعارات. حاول مرة أخرى.'));
        return false;
      }
    }

    const registered=await registerSubscriptionWithServer(subscription);
    if(registered&&requestPermission&&typeof toast==='function'){
      toast(lang('Notifications enabled.','تم تفعيل الإشعارات.'));
    }
    return registered;
  }

  async function disableWebPush(){
    try{
      const subscription=await currentSubscription();
      if(!subscription)return true;
      if((typeof sb!=='undefined'?sb:null)&&(typeof authUser!=='undefined'?authUser:null)){
        await sb.rpc('disable_web_push_subscription',{endpoint_input:subscription.endpoint});
      }
      await subscription.unsubscribe().catch(()=>{});
      return true;
    }catch(error){
      console.error('[NEIS web push disable]',error);
      return false;
    }
  }

  async function openPwaNotificationSettings(){
    if(!(typeof authUser!=='undefined'?authUser:null)||!(typeof sb!=='undefined'?sb:null)){
      if(typeof toast==='function')toast(lang('Sign in first.','سجّل الدخول أولًا.'));
      return;
    }
    const {data,error}=await sb.from('push_preferences').select('*').eq('user_id',authUser.id).maybeSingle();
    if(error){
      if(typeof toast==='function')toast(lang('Could not load notification settings.','تعذر تحميل إعدادات الإشعارات.'));
      return;
    }
    const prefs=data||{messages:true,replies:true,circles:true,social:true,announcements:true,reactions:true,sound:true};
    const notificationPermission=('Notification' in window)?Notification.permission:'unsupported';
    const row=(key,en,arText)=>`<label class="account-row" style="cursor:pointer"><span><b>${lang(en,arText)}</b></span><input type="checkbox" data-pwa-push-pref="${key}" ${prefs[key]!==false?'checked':''}></label>`;

    openModal(`
      <div class="modal-head">
        <div>
          <h2>${lang('Notifications','الإشعارات')}</h2>
          <p>${lang('Choose what NEIS Circle may notify you about on this device.','اختر أنواع الإشعارات التي تريد استقبالها على هذا الجهاز.')}</p>
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
      <div class="account-menu" style="margin-top:12px">
        <button type="button" class="account-row" data-pwa-show-prompt-again>
          <span><b>${lang('Automatic notification prompt','طلب تفعيل الإشعارات تلقائيًا')}</b><small>${localStorage.getItem(NOTIFICATION_PROMPT_DISABLED_KEY)==='1'?lang('Hidden on this device','مخفي على هذا الجهاز'):lang('Allowed to appear on this device','مسموح له بالظهور على هذا الجهاز')}</small></span>
          <b>→</b>
        </button>
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary" data-pwa-notification-permission>${notificationPermission==='granted'?lang('Notifications enabled','الإشعارات مفعلة'):lang('Enable notifications','تفعيل الإشعارات')}</button>
        <button type="button" class="primary" data-save-pwa-push>${lang('Save','حفظ')}</button>
      </div>
    `);

    const permissionButton=document.querySelector('[data-pwa-notification-permission]');
    if(permissionButton)permissionButton.onclick=async()=>{
      permissionButton.disabled=true;
      await ensureWebPush(true);
      permissionButton.disabled=false;
      permissionButton.textContent=('Notification' in window&&Notification.permission==='granted')?lang('Notifications enabled','الإشعارات مفعلة'):lang('Enable notifications','تفعيل الإشعارات');
    };

    const showAgain=document.querySelector('[data-pwa-show-prompt-again]');
    if(showAgain)showAgain.onclick=()=>{
      localStorage.removeItem(NOTIFICATION_PROMPT_DISABLED_KEY);
      notificationOnboardingShown=false;
      if(typeof toast==='function')toast(lang('Automatic notification prompt enabled on this device.','تم تفعيل طلب الإشعارات التلقائي على هذا الجهاز.'));
      openPwaNotificationSettings();
    };

    const saveButton=document.querySelector('[data-save-pwa-push]');
    if(saveButton)saveButton.onclick=async()=>{
      const values={user_id:authUser.id};
      document.querySelectorAll('[data-pwa-push-pref]').forEach(input=>{values[input.dataset.pwaPushPref]=!!input.checked});
      saveButton.disabled=true;
      const {error:saveError}=await sb.from('push_preferences').upsert(values,{onConflict:'user_id'});
      if(saveError){
        saveButton.disabled=false;
        if(typeof toast==='function')toast(lang('Could not save notification settings.','تعذر حفظ إعدادات الإشعارات.'));
        return;
      }
      if('Notification' in window&&Notification.permission==='granted')await ensureWebPush(false);
      closeModal();
      if(typeof toast==='function')toast(lang('Notification settings saved.','تم حفظ إعدادات الإشعارات.'));
    };
  }

  function addPwaSettingsEntry(){
    const modal=document.querySelector('#modalRoot .modal');
    if(!modal||modal.querySelector('[data-pwa-notification-settings]'))return;
    if(!modal.querySelector('[data-setting="theme"],[data-setting=theme]'))return;
    const button=document.createElement('button');
    button.type='button';
    button.className='module-card';
    button.style.cssText='width:100%;margin-top:12px;text-align:start';
    button.dataset.pwaNotificationSettings='';
    const permission=('Notification' in window)?Notification.permission:'unsupported';
    button.innerHTML=`<b>${lang('Notifications','الإشعارات')}</b><p>${permission==='granted'?lang('Enabled on this device','مفعلة على هذا الجهاز'):lang('Push alerts and preferences','التنبيهات وإعداداتها')}</p>`;
    const action=modal.querySelector('[data-action="setup"]')||modal.querySelector('[data-action=setup]');
    if(action)action.before(button); else modal.appendChild(button);
    button.onclick=openPwaNotificationSettings;
  }

  function installSettingsHook(){
    if(typeof settings==='function'&&!settings.__neisPwaWrapped){
      const previous=settings;
      const wrapped=function(){
        const result=previous.apply(this,arguments);
        addPwaSettingsEntry();
        return result;
      };
      wrapped.__neisPwaWrapped=true;
      settings=wrapped;
    }
  }

  function installSignOutHook(){
    if(signOutHookInstalled||!(typeof sb!=='undefined'?sb:null)?.auth?.signOut)return;
    signOutHookInstalled=true;
    const original=sb.auth.signOut.bind(sb.auth);
    sb.auth.signOut=async function(){
      await disableWebPush();
      return original.apply(this,arguments);
    };
  }

  let notificationOnboardingTimer=null;
  let notificationOnboardingShown=false;
  let notificationHiddenAt=0;
  const NOTIFICATION_PROMPT_DISABLED_KEY='neis-pwa-notification-prompt-disabled';

  function notificationOnboardingMarkup(){
    const permission=('Notification' in window)?Notification.permission:'unsupported';
    if(permission==='unsupported'){
      return {
        title:lang('Notifications unavailable','الإشعارات غير متاحة'),
        body:lang('This browser does not support web push notifications.','هذا المتصفح لا يدعم إشعارات الويب.'),
        action:''
      };
    }
    if(permission==='denied'){
      return {
        title:lang('Notifications are blocked','الإشعارات محظورة'),
        body:lang('Open this site’s settings in your browser and change Notifications to Allow, then reopen NEIS Circle.','افتح إعدادات هذا الموقع في المتصفح وغيّر الإشعارات إلى سماح، ثم افتح NEIS Circle مرة أخرى.'),
        action:''
      };
    }
    return {
      title:lang('Enable notifications','فعّل الإشعارات'),
      body:lang('Allow NEIS Circle to notify you about messages, replies, circles, announcements, likes and reactions even when the app is closed.','اسمح لـ NEIS Circle بإرسال إشعارات الرسائل والردود والمجتمعات والإعلانات والإعجابات والتفاعلات حتى عند إغلاق التطبيق.'),
      action:`<button type="button" class="primary" data-pwa-onboarding-enable>${lang('Enable notifications','تفعيل الإشعارات')}</button>`
    };
  }

  function showNotificationOnboarding(){
    if(!(typeof authUser!=='undefined'?authUser:null))return;
    if(!('Notification' in window))return;
    if(Notification.permission==='granted'){
      Promise.resolve().then(()=>ensureWebPush(false)).catch(()=>{});
      return;
    }
    if(localStorage.getItem(NOTIFICATION_PROMPT_DISABLED_KEY)==='1')return;
    if(notificationOnboardingShown)return;
    notificationOnboardingShown=true;

    const copy=notificationOnboardingMarkup();
    if(typeof openModal!=='function')return;
    openModal(`
      <div class="modal-head">
        <div>
          <h2>${copy.title}</h2>
          <p>${copy.body}</p>
        </div>
        <button class="close" data-close>×</button>
      </div>
      <label class="pwa-notification-suppress">
        <input type="checkbox" data-pwa-dont-show-again>
        <span>${lang("Don't show again on this device",'عدم الإظهار مرة أخرى على هذا الجهاز')}</span>
      </label>
      <div class="modal-actions">
        <button type="button" class="secondary" data-pwa-not-now>${lang('Not now','ليس الآن')}</button>
        ${copy.action}
      </div>
    `);

    const suppress=document.querySelector('[data-pwa-dont-show-again]');
    const rememberSuppression=()=>{
      if(suppress?.checked)localStorage.setItem(NOTIFICATION_PROMPT_DISABLED_KEY,'1');
    };

    const notNow=document.querySelector('[data-pwa-not-now]');
    if(notNow)notNow.onclick=()=>{
      rememberSuppression();
      try{closeModal()}catch(_){}
    };

    const enable=document.querySelector('[data-pwa-onboarding-enable]');
    if(enable)enable.onclick=async()=>{
      rememberSuppression();
      enable.disabled=true;
      const ok=await ensureWebPush(true);
      enable.disabled=false;
      if(ok){
        localStorage.removeItem(NOTIFICATION_PROMPT_DISABLED_KEY);
        try{closeModal()}catch(_){}
      }
    };
  }

  function scheduleNotificationOnboarding(){
    clearTimeout(notificationOnboardingTimer);
    notificationOnboardingTimer=setTimeout(showNotificationOnboarding,700);
  }

  function hookLiveData(){
    if(typeof loadLiveData!=='function'||loadLiveData.__neisPwaWrapped)return;
    const previous=loadLiveData;
    const wrapped=async function(){
      const result=await previous.apply(this,arguments);
      installSignOutHook();
      if((typeof authUser!=='undefined'?authUser:null)&&('Notification' in window)&&Notification.permission==='granted'){
        Promise.resolve().then(()=>ensureWebPush(false)).catch(()=>{});
      }
      scheduleNotificationOnboarding();
      return result;
    };
    wrapped.__neisPwaWrapped=true;
    loadLiveData=wrapped;
  }

  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    deferredInstallPrompt=event;
    updateInstallUI();
  });
  window.addEventListener('appinstalled',()=>{
    deferredInstallPrompt=null;
    updateInstallUI();
    if(typeof toast==='function')toast(lang('NEIS Circle installed.','تم تثبيت NEIS Circle.'));
  });

  document.addEventListener('click',event=>{
    if(event.target?.closest?.('[data-pwa-install]')){
      event.preventDefault();
      installPwa();
    }
    if(event.target?.closest?.('[data-pwa-enable-notifications]')){
      event.preventDefault();
      ensureWebPush(true);
    }
  });

  const themeObserver=new MutationObserver(()=>{
    syncThemeChrome();
  });
  themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-style-theme']});

  const view=document.querySelector('#view');
  if(view){
    const viewObserver=new MutationObserver(()=>{
      updateInstallUI();
    });
    viewObserver.observe(view,{childList:true,subtree:false});
  }

  registerServiceWorker().then(()=>{
    hookLiveData();
    installSettingsHook();
    installSignOutHook();
    if((typeof authUser!=='undefined'?authUser:null)&&('Notification' in window)&&Notification.permission==='granted'){
      Promise.resolve().then(()=>ensureWebPush(false)).catch(()=>{});
    }
    scheduleNotificationOnboarding();
  });

  syncThemeChrome();
  updateInstallUI();
  hookLiveData();
  installSettingsHook();

  [900,2200,4500].forEach(delay=>{
    setTimeout(()=>{
      if((typeof authUser!=='undefined'?authUser:null))scheduleNotificationOnboarding();
    },delay);
  });

  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){
      notificationHiddenAt=Date.now();
      return;
    }
    if(('Notification' in window)&&Notification.permission!=='granted'&&
       notificationHiddenAt&&Date.now()-notificationHiddenAt>4000){
      notificationOnboardingShown=false;
      scheduleNotificationOnboarding();
    }else if(('Notification' in window)&&Notification.permission==='granted'){
      Promise.resolve().then(()=>ensureWebPush(false)).catch(()=>{});
    }
  });

  window.NEISPWA={
    install:installPwa,
    enableNotifications:()=>ensureWebPush(true),
    openNotificationSettings:openPwaNotificationSettings,
    syncTheme:syncThemeChrome
  };
})();