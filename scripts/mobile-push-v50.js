/* NEIS Circle v50 — Android native bridge: push registration, deep links, OAuth handoff. */
(function(){
  'use strict';
  function syncNativeSystemBars(){
    try{
      const theme=localStorage.getItem('neis-theme')||document.documentElement.dataset.theme||'light';
      window.NeisAndroid?.setSystemTheme?.(theme);
    }catch(_){}
  }


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
    button.classList.add('settings-row');button.innerHTML=`<span class="settings-row-label">${lang('Mobile notifications','إشعارات الموبايل')}</span><span class="settings-row-end"><b class="settings-row-value">${lang('Sound & alerts','الصوت والتنبيهات')}</b><i class="settings-chevron" aria-hidden="true"></i></span>`;
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

  function installNativeMessageActions(){
    if(!nativeAvailable()||document.documentElement.dataset.neisMessageActions==='1')return;
    document.documentElement.dataset.neisMessageActions='1';

    let timer=null,startX=0,startY=0,target=null,lastTouchAt=0;
    const clear=()=>{if(timer){clearTimeout(timer);timer=null}target=null};

    const rowAtY=(eventTarget,y)=>{
      const flow=eventTarget?.closest?.('.chat-flow')||document.elementFromPoint(Math.max(1,Math.min(window.innerWidth-1,startX||1)),Math.max(1,Math.min(window.innerHeight-1,y)))?.closest?.('.chat-flow');
      if(!flow)return null;
      const rows=[...flow.querySelectorAll(':scope > .chat-message')];
      if(!rows.length)return null;
      for(let index=0;index<rows.length;index++){
        const row=rows[index],rect=row.getBoundingClientRect();
        const prev=index?rows[index-1].getBoundingClientRect():null;
        const next=index<rows.length-1?rows[index+1].getBoundingClientRect():null;
        const top=prev?(prev.bottom+rect.top)/2:rect.top-5;
        const bottom=next?(rect.bottom+next.top)/2:rect.bottom+5;
        if(y>=top&&y<=bottom)return row;
      }
      return null;
    };

    const resolveTarget=(eventTarget,x,y)=>{
      const directRow=eventTarget?.closest?.('.chat-message');
      const row=directRow||rowAtY(eventTarget,y);
      const bubble=row?.querySelector?.('.bubble');
      return row&&bubble?{row,bubble}:null;
    };

    const openActions=(row,bubble)=>{
      if(!row||!bubble)return;
      const messageText=bubble.querySelector('.message-text')?.textContent||'';
      const messageId=row.dataset?.messageId||'';
      const targetMessage=state.liveMessages?.find?.(m=>same(m.id,messageId));
      const canDelete=!!targetMessage&&(same(targetMessage.sender_id,authUser.id)||state.isAdmin);

      openModal(`<div class="modal-head native-message-action-head"><div><h2>${lang('Message actions','خيارات الرسالة')}</h2></div><button class="close" data-close>×</button></div><div class="native-message-action-list"><button type="button" class="account-row" data-native-reply-message><span>${lang('Reply','رد')}</span><b>↩</b></button><button type="button" class="account-row" data-native-copy-message><span>${lang('Copy message','نسخ الرسالة')}</span><b>⧉</b></button>${canDelete?`<button type="button" class="account-row danger" data-native-delete-message><span>${lang('Delete message','حذف الرسالة')}</span><b>⌫</b></button>`:''}</div>`);
      document.querySelector('#modalRoot .modal')?.classList.add('message-actions-modal');

      const reply=document.querySelector('[data-native-reply-message]');
      if(reply)reply.onclick=()=>{closeModal();setTimeout(()=>window.startDmReply?.(messageId),0)};

      const copy=document.querySelector('[data-native-copy-message]');
      if(copy)copy.onclick=async()=>{
        try{
          await navigator.clipboard.writeText(messageText);
          closeModal();
          toast(lang('Message copied.','تم نسخ الرسالة.'));
        }catch(_){
          toast(lang('Could not copy this message.','تعذر نسخ الرسالة.'));
        }
      };

      const del=document.querySelector('[data-native-delete-message]');
      if(del)del.onclick=()=>{closeModal();setTimeout(()=>window.neisDeleteDirectMessage?.(messageId),0)};
    };
    const begin=(eventTarget,x,y)=>{
      clear();
      const current=resolveTarget(eventTarget,x,y);
      if(!current)return;
      target=current;
      startX=x;startY=y;
      timer=setTimeout(()=>{
        const selected=target;
        timer=null;
        if(!selected?.row||!selected?.bubble)return;
        if(navigator.vibrate)navigator.vibrate(22);
        openActions(selected.row,selected.bubble);
        target=null;
      },500);
    };

    document.addEventListener('pointerdown',event=>{
      if(Date.now()-lastTouchAt<700)return;
      if(!event.target?.closest?.('.chat-flow'))return;
      begin(event.target,event.clientX,event.clientY);
    },{passive:true});

    document.addEventListener('pointermove',event=>{
      if(!timer)return;
      if(Math.abs(event.clientX-startX)>12||Math.abs(event.clientY-startY)>12)clear();
    },{passive:true});
    document.addEventListener('pointerup',clear,{passive:true});
    document.addEventListener('pointercancel',clear,{passive:true});

    document.addEventListener('touchstart',event=>{
      const touch=event.touches?.[0];
      if(!touch||!event.target?.closest?.('.chat-flow'))return;
      lastTouchAt=Date.now();
      begin(event.target,touch.clientX,touch.clientY);
    },{passive:true});

    document.addEventListener('touchmove',event=>{
      if(!timer)return;
      const touch=event.touches?.[0];
      if(!touch){clear();return}
      if(Math.abs(touch.clientX-startX)>12||Math.abs(touch.clientY-startY)>12)clear();
    },{passive:true});
    let swipeRow=null,swipeStartX=0,swipeStartY=0,swipeTriggered=false;
    document.addEventListener('touchstart',event=>{
      const touch=event.touches?.[0];
      const row=event.target?.closest?.('#chatFlow > .chat-message');
      if(!touch||!row)return;
      swipeRow=row;swipeStartX=touch.clientX;swipeStartY=touch.clientY;swipeTriggered=false;
    },{passive:true});

    document.addEventListener('touchmove',event=>{
      if(!swipeRow||swipeTriggered)return;
      const touch=event.touches?.[0];if(!touch)return;
      const dx=touch.clientX-swipeStartX,dy=touch.clientY-swipeStartY;
      if(Math.abs(dy)>40&&Math.abs(dy)>Math.abs(dx)){swipeRow=null;return}
      if(Math.abs(dx)>14&&timer){clearTimeout(timer);timer=null}
      if(Math.abs(dx)>=60&&Math.abs(dy)<34){
        swipeTriggered=true;
        const id=swipeRow.dataset.messageId;
        if(navigator.vibrate)navigator.vibrate(12);
        if(id)setTimeout(()=>window.startDmReply?.(id),0);
        swipeRow=null;
      }
    },{passive:true});

    const clearSwipe=()=>{swipeRow=null;swipeTriggered=false};
    document.addEventListener('touchend',event=>{clear();clearSwipe()},{passive:true});
    document.addEventListener('touchcancel',event=>{clear();clearSwipe()},{passive:true});
    /* v91 native swipe reply */

    document.addEventListener('contextmenu',event=>{
      if(!event.target?.closest?.('.chat-flow'))return;
      const row=resolveTarget(event.target,event.clientX,event.clientY);
      if(!row)return;
      event.preventDefault();
    });
  }

  function findMessageRowAtPoint(x,y){
    const px=Number(x)||0,py=Number(y)||0;
    const direct=document.elementFromPoint(px,py)?.closest?.('.chat-message');
    if(direct)return direct;
    const rows=[...document.querySelectorAll('#chatFlow > .chat-message')];
    if(!rows.length)return null;
    let best=null,bestDistance=Infinity;
    for(const row of rows){
      const rect=row.getBoundingClientRect();
      if(py>=rect.top-10&&py<=rect.bottom+10){
        const center=(rect.top+rect.bottom)/2,distance=Math.abs(py-center);
        if(distance<bestDistance){best=row;bestDistance=distance}
      }
    }
    return best;
  }

  function openMessageActionsForRow(row){
    const bubble=row?.querySelector?.('.bubble');
    if(!row||!bubble)return false;
    const messageText=bubble.querySelector('.message-text')?.textContent||'';
    const messageId=row.dataset?.messageId||'';
    const targetMessage=state.liveMessages?.find?.(m=>same(m.id,messageId));
    const canDelete=!!targetMessage&&(same(targetMessage.sender_id,authUser.id)||state.isAdmin);
    openModal(`<div class="modal-head native-message-action-head"><div><h2>${lang('Message actions','خيارات الرسالة')}</h2></div><button class="close" data-close>×</button></div><div class="native-message-action-list"><button type="button" class="account-row" data-native-reply-message><span>${lang('Reply','رد')}</span><b>↩</b></button><button type="button" class="account-row" data-native-copy-message><span>${lang('Copy message','نسخ الرسالة')}</span><b>⧉</b></button>${canDelete?`<button type="button" class="account-row danger" data-native-delete-message><span>${lang('Delete message','حذف الرسالة')}</span><b>⌫</b></button>`:''}</div>`);
    document.querySelector('#modalRoot .modal')?.classList.add('message-actions-modal');
    const reply=document.querySelector('[data-native-reply-message]');
    if(reply)reply.onclick=()=>{closeModal();setTimeout(()=>window.startDmReply?.(messageId),0)};
    const copy=document.querySelector('[data-native-copy-message]');
    if(copy)copy.onclick=async()=>{
      try{await navigator.clipboard.writeText(messageText);closeModal();toast(lang('Message copied.','تم نسخ الرسالة.'))}
      catch(_){toast(lang('Could not copy this message.','تعذر نسخ الرسالة.'))}
    };
    const del=document.querySelector('[data-native-delete-message]');
    if(del)del.onclick=()=>{closeModal();setTimeout(()=>window.neisDeleteDirectMessage?.(messageId),0)};
    return true;
  }

  function openMessageActionsAt(x,y){
    return openMessageActionsForRow(findMessageRowAtPoint(x,y));
  }

  function openMessageActionsAtDevicePixels(rawX,rawY){
    const dpr=Math.max(1,Number(window.devicePixelRatio)||1);
    const vv=window.visualViewport;
    const candidates=[
      [Number(rawX)/dpr,Number(rawY)/dpr],
      [Number(rawX)/dpr,(Number(rawY)/dpr)+(vv?.offsetTop||0)],
      [Number(rawX),Number(rawY)]
    ];
    for(const [x,y] of candidates){
      const row=findMessageRowAtPoint(x,y);
      if(row)return openMessageActionsForRow(row);
    }
    return false;
  }

  function handleNativeBack(){
    const modal=document.querySelector('#modalRoot .modal');
    if(modal){try{closeModal()}catch(_){};return true}
    if(typeof state!=='undefined'&&state.view==='messages'&&state.activeConversationId){
      state.activeConversationId='';
      try{routeTo('messages',true)}catch(_){render()}
      return true;
    }
    return false;
  }

  window.NEISMobile={
    receivePushToken,
    openRoute:openNativeRoute,
    handleAuthCallback,
    registerPushToken:registerStoredToken,
    openNotificationSettings:openMobileNotificationSettings,
    openMessageActionsAt,
    openMessageActionsAtDevicePixels,
    handleNativeBack
  };

  if(nativeAvailable()){
    document.documentElement.classList.add('neis-native-app');
    installNativeMessageActions();
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
  syncNativeSystemBars();
  new MutationObserver(syncNativeSystemBars).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  window.addEventListener('storage',event=>{if(event.key==='neis-theme')syncNativeSystemBars()});

})();