/* NEIS Circle notification runtime — isolated realtime, fallback sync, and sound handling. */
(function(){
  let channel=null;
  let channelUid='';
  let pollTimer=null;
  let realtimeStatus='CLOSED';
  let refreshPromise=null;
  let lastFullSyncAt=0;
  let audioContext=null;
  let soundUnlocked=false;
  let baselineLoaded=false;
  const chimedIds=new Set();
  const inflightChimes=new Set();
  // The unread-tab counter is the final common output of every notification
  // code path. Reconcile its actual IDs here, not only in selected handlers.
  let badgeKnownIds=null;
  let pendingChime=null;
  let lastChimeResult='none';
  let lastChimeAt=0;
  let incomingAttemptCount=0;
  let lastIncomingMessageSignalAt=0;
  const DEFAULT_TAB_TITLE='NEIS Circle';
  const NOTIFICATION_FIELDS='id,type,title,body,entity_type,entity_id,route,read_at,created_at';
  const CACHE_PREFIX='neis-notifications-v174:';
  const CACHE_MAX_AGE=12*60*60*1000;

  const cacheKey=uid=>CACHE_PREFIX+String(uid||'guest');
  function readCache(uid){
    if(typeof sessionStorage==='undefined'||!uid)return [];
    try{
      const parsed=JSON.parse(sessionStorage.getItem(cacheKey(uid))||'null');
      if(!parsed||!Array.isArray(parsed.rows)||!Number(parsed.savedAt))return [];
      if(Date.now()-Number(parsed.savedAt)>CACHE_MAX_AGE)return [];
      return parsed.rows.slice(0,100);
    }catch{return []}
  }
  function writeCache(){
    if(typeof sessionStorage==='undefined'||!channelUid)return;
    try{
      sessionStorage.setItem(cacheKey(channelUid),JSON.stringify({
        savedAt:Date.now(),
        rows:(state.notifications||[]).slice(0,100)
      }));
    }catch{}
  }
  function hydrateCache(uid){
    if((state.notifications||[]).length)return false;
    const rows=readCache(uid);
    if(!rows.length)return false;
    state.notifications=rows;
    // A cached set of notification IDs is a real baseline. Compare the first
    // server result against it rather than silently discarding missed events.
    baselineLoaded=true;
    renderNotificationsIfVisible();
    return true;
  }

  function updateTabBadge(){
    if(typeof document==='undefined')return;
    const rows=state.notifications||[];
    const newRows=badgeKnownIds===null?[]:rows.filter(n=>
      !n.read_at && n.silent!==true &&
      !badgeKnownIds.has(String(n.id)) &&
      n.id != null
    );
    // Initial render is only a baseline; cached rows are also a baseline.
    // Subsequent new IDs must ring even if a different module updated state
    // and only called updateBadges()/updateTabBadge().
    badgeKnownIds=new Set(rows.filter(n=>n.id!=null).map(n=>String(n.id)));
    if(baselineLoaded&&newRows.length){
      const latest=newRows[0];
      chimeOnce(latest).catch(()=>{});
    }
    const unread=rows.filter(n=>!n.read_at).length;
    const label=unread>99?'99+':String(unread);
    document.title=unread?'('+label+') '+DEFAULT_TAB_TITLE:DEFAULT_TAB_TITLE;
  }

  const same=(a,b)=>String(a)===String(b);
  const renderNotificationsIfVisible=()=>{
    updateTabBadge();
    updateBadges();
    if(state.view==='notifications')render();
  };

  function soundEnabledOnThisDevice(){
    try{
      const uid=String((typeof authUser!=='undefined'&&authUser?.id)||'guest');
      // In-app sound is device-local; background Push API synchronisation must
      // never silently overwrite an explicitly chosen local sound preference.
      const localSound=localStorage.getItem('neis-local-notification-sound-v1:'+uid);
      if(localSound==='on')return true;
      if(localSound==='off')return false;
      const value=JSON.parse(localStorage.getItem('neis-device-push-prefs-v1:'+uid)||'{}');
      return value?.sound!==false;
    }catch{return true}
  }
  function setDeviceSoundEnabled(enabled){
    const uid=String((typeof authUser!=='undefined'&&authUser?.id)||'guest');
    try{localStorage.setItem('neis-local-notification-sound-v1:'+uid,enabled?'on':'off')}catch{}
    return soundEnabledOnThisDevice();
  }
  function noteChime(result){
    lastChimeResult=result;
    lastChimeAt=Date.now();
  }

  async function unlockSound(){
    try{
      const AudioCtx=window.AudioContext||window.webkitAudioContext;
      if(!AudioCtx)return false;
      audioContext=audioContext||new AudioCtx();
      if(audioContext.state!=='running')await audioContext.resume();
      soundUnlocked=audioContext.state==='running';
      return soundUnlocked;
    }catch{
      return false;
    }
  }

  async function showSystemNotification(row){
    try{
      if(typeof document==='undefined'||!document.hidden)return;
      if(!('Notification' in window)||Notification.permission!=='granted')return;
      const registration=await navigator.serviceWorker?.ready;
      if(!registration?.showNotification)return;
      const title=row?.title||'NEIS Circle';
      await registration.showNotification(title,{
        body:row?.body||'You have a new notification.',
        icon:'/assets/email-logo.png',
        badge:'/assets/notification-badge.png?v=2',
        data:{route:row?.route||''},
        tag:row?.id?'neis-'+row.id:undefined,
        renotify:false,
        silent:false
      });
    }catch(error){
      console.warn('[NEIS notification fallback]',error);
    }
  }

  async function playSound(test=false){
    try{
      if(!test&&!soundEnabledOnThisDevice())return false;
      if(!await unlockSound())return false;
      const ctx=audioContext,now=ctx.currentTime,master=ctx.createGain();
      master.gain.setValueAtTime(.0001,now);
      master.gain.exponentialRampToValueAtTime(.34,now+.012);
      master.gain.exponentialRampToValueAtTime(.0001,now+.62);
      master.connect(ctx.destination);
      [[1046.5,0,.19,'sine'],[1568,.11,.25,'triangle'],[2093,.24,.31,'sine']].forEach(([freq,delay,duration,type])=>{
        const osc=ctx.createOscillator(),gain=ctx.createGain();
        osc.type=type;
        osc.frequency.setValueAtTime(freq,now+delay);
        gain.gain.setValueAtTime(.0001,now+delay);
        gain.gain.exponentialRampToValueAtTime(.9,now+delay+.008);
        gain.gain.exponentialRampToValueAtTime(.0001,now+delay+duration);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now+delay);
        osc.stop(now+delay+duration+.04);
      });
      return true;
    }catch{return false}
  }

  async function chimeOnce(row){
    if(!row)return false;
    if(row.read_at){noteChime('already-read');return false}
    if(row.silent===true){noteChime('silent-by-event');return false}
    if(!soundEnabledOnThisDevice()){noteChime('device-sound-disabled');return false}
    const id=String(row.id||'');
    if(id&&(chimedIds.has(id)||inflightChimes.has(id)))return false;
    if(id)inflightChimes.add(id);
    incomingAttemptCount++;
    try{
      const played=await playSound();
      if(played){
        noteChime('played');
        if(id){
          chimedIds.add(id);
          if(chimedIds.size>150)chimedIds.delete(chimedIds.values().next().value);
        }
        if(pendingChime?.id===id)pendingChime=null;
        return true;
      }
      // The browser may block Web Audio until the next trusted user gesture.
      // Do not mark the notification as played when nothing was audible.
      noteChime('browser-audio-blocked');
      pendingChime={id,row,expires:Date.now()+60000};
      return false;
    }finally{
      if(id)inflightChimes.delete(id);
    }
  }

  async function signalIncomingMessage({id,senderId,scope='direct'}={}){
    // Call this from the real incoming chat event, not from a reloaded
    // notification record. A DM can arrive before the related notification
    // INSERT, or while the notification channel is reconnecting.
    if(!id||!authUser?.id||!senderId||same(senderId,authUser.id))return false;
    const key=scope==='circle'?'circle_messages':'direct_messages';
    try{
      const uid=String(authUser.id);
      const prefs=JSON.parse(localStorage.getItem('neis-device-push-prefs-v1:'+uid)||'{}');
      if(prefs?.[key]===false){noteChime('message-category-disabled');return false}
    }catch{}
    lastIncomingMessageSignalAt=Date.now();
    const row={id:'incoming-'+scope+'-'+String(id),read_at:null,silent:false};
    // If the database notification event just chimed, suppress the second
    // chime for the same incoming activity, while preserving the message ID.
    if(lastChimeResult==='played'&&Date.now()-lastChimeAt<1250){
      chimedIds.add(String(row.id));
      return false;
    }
    return chimeOnce(row);
  }

  function applyRows(rows,{soundForNew=false}={}){
    const previousIds=new Set((state.notifications||[]).map(n=>String(n.id)));
    const next=Array.isArray(rows)?rows:[];
    const fresh=next.filter(n=>!previousIds.has(String(n.id)));
    state.notifications=next;
    writeCache();
    renderNotificationsIfVisible();
    // The first uncached hydration is intentionally quiet. After that, a new
    // unread ID must chime whether it came from Realtime, focus, or a background
    // refresh. Older callers pass soundForNew=false during routine sync: that
    // flag must not suppress *new* messages while still changing the tab count.
    if(baselineLoaded){
      const latestUnread=fresh.find(n=>!n.read_at&&n.silent!==true);
      if(latestUnread)chimeOnce(latestUnread).catch(()=>{});
    }
    baselineLoaded=true;
  }

  function ingestPush(payload){
    const row=payload&&typeof payload==='object'?payload:null;
    if(!row?.id)return;
    if(!(state.notifications||[]).some(n=>same(n.id,row.id))){
      state.notifications=[{
        id:row.id,
        type:row.type||'',
        title:row.title||'NEIS Circle',
        body:row.body||'',
        route:row.route||'',
        created_at:row.created_at||new Date().toISOString(),
        read_at:null
      },...(state.notifications||[])].slice(0,100);
      writeCache();
      updateTabBadge();
      renderNotificationsIfVisible();
    }else{
      updateTabBadge();
    }
    chimeOnce(row);
  }

  function applyRealtime(payload){
    const event=payload?.eventType,row=payload?.new||{},oldRow=payload?.old||{};
    if(event==='INSERT'&&row?.id){
      if(!(state.notifications||[]).some(n=>same(n.id,row.id))){
        state.notifications=[row,...(state.notifications||[])].slice(0,100);
      }
      writeCache();
      renderNotificationsIfVisible();
      if(!row.read_at){
        chimeOnce(row);
        showSystemNotification(row);
      }
      return;
    }
    if(event==='UPDATE'&&row?.id){
      const index=(state.notifications||[]).findIndex(n=>same(n.id,row.id));
      if(index>=0)state.notifications[index]={...state.notifications[index],...row};
      else state.notifications=[row,...(state.notifications||[])].slice(0,100);
      writeCache();
      renderNotificationsIfVisible();
      return;
    }
    if(event==='DELETE'&&oldRow?.id){
      state.notifications=(state.notifications||[]).filter(n=>!same(n.id,oldRow.id));
      writeCache();
      renderNotificationsIfVisible();
    }
  }

  async function refresh(soundForNew=false,{force=false}={}){
    if(!sb||!authUser)return;
    const now=Date.now();
    if(!force&&lastFullSyncAt&&now-lastFullSyncAt<3000)return;
    if(refreshPromise)return refreshPromise;
    refreshPromise=(async()=>{
      const {data,error}=await sb.from('notifications')
        .select(NOTIFICATION_FIELDS)
        .eq('user_id',authUser.id)
        .order('created_at',{ascending:false})
        .limit(100);
      if(error){
        console.error('[NEIS notifications refresh]',error);
        return;
      }
      lastFullSyncAt=Date.now();
      applyRows(data||[],{soundForNew});
    })().finally(()=>{refreshPromise=null});
    return refreshPromise;
  }

  function startFallback(){
    clearInterval(pollTimer);
    const healthy=realtimeStatus==='SUBSCRIBED';
    const interval=healthy?120000:10000;
    pollTimer=setInterval(()=>refresh(true),interval);
  }

  async function setup(uid){
    if(channel&&same(channelUid,uid)&&['CONNECTING','SUBSCRIBED'].includes(realtimeStatus)){
      if(!(state.notifications||[]).length)hydrateCache(uid);
      // Global data refreshes must not refetch the same notification page while
      // the existing Realtime channel is healthy. The fallback timer and
      // tab-focus sync still reconcile missed events.
      if(!lastFullSyncAt||Date.now()-lastFullSyncAt>=120000)refresh(false).catch(()=>{});
      return;
    }
    if(channel){
      try{await sb.removeChannel(channel)}catch(_){}
      channel=null;
    }
    if(channelUid&&!same(channelUid,uid)){
      state.notifications=[];
      lastFullSyncAt=0;
      updateBadges();
    }
    channelUid=uid;
    baselineLoaded=false;
    badgeKnownIds=null;
    chimedIds.clear();
    inflightChimes.clear();
    pendingChime=null;
    hydrateCache(uid);
    realtimeStatus='CONNECTING';
    channel=sb.channel(`neis-notifications-${uid}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${uid}`},applyRealtime)
      .subscribe(status=>{
        realtimeStatus=status;
        if(status==='SUBSCRIBED'){
          setTimeout(()=>refresh(false,{force:true}).catch(()=>{}),120);
          startFallback();
        }else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){
          startFallback();
        }
      });
    refresh(false,{force:true}).catch(()=>{});
  }

  async function reset(){
    clearInterval(pollTimer);
    pollTimer=null;
    refreshPromise=null;
    lastFullSyncAt=0;
    channelUid='';
    realtimeStatus='CLOSED';
    baselineLoaded=false;
    badgeKnownIds=null;
    chimedIds.clear();
    inflightChimes.clear();
    pendingChime=null;
    if(channel&&sb){
      try{await sb.removeChannel(channel)}catch(_){}
    }
    channel=null;
    updateTabBadge();
  }

  function snapshot(){
    return {
      version:'174.12',
      lastChimeResult,
      lastChimeAt,
      incomingAttemptCount,
      lastIncomingMessageSignalAt,
      channelUid,
      realtimeStatus,
      lastFullSyncAt,
      refreshing:!!refreshPromise,
      soundUnlocked,
      soundEnabled:soundEnabledOnThisDevice(),
      baselineLoaded,
      badgeKnownCount:badgeKnownIds?.size||0,
      audioState:audioContext?.state||'not-created',
      pendingSound:!!pendingChime
    };
  }

  function primeNotificationSound(){
    // Resume AudioContext inside a user gesture even if the first attempt failed.
    unlockSound().then(ok=>{
      if(!ok||!pendingChime)return;
      const pending=pendingChime;
      pendingChime=null;
      if(pending.expires>Date.now()&&soundEnabledOnThisDevice()){
        chimeOnce(pending.row).catch(()=>{});
      }
    }).catch(()=>{});
  }
  if(typeof document!=='undefined'){
    document.addEventListener('pointerdown',primeNotificationSound,{capture:true});
    document.addEventListener('keydown',primeNotificationSound,{capture:true});
  }

  async function testIncomingAlert(){
    // Same sound path as a real notification, but never writes notifications,
    // sends a message, changes the unread badge, or calls a backend service.
    const row={id:'local-test-'+Date.now()+'-'+Math.floor(Math.random()*100000),
      read_at:null,silent:false};
    return chimeOnce(row);
  }

  window.NEISNotificationRuntime={
    version:'174.12',
    unlockSound,
    playSound,
    applyRows,
    applyRealtime,
    refresh,
    setup,
    reset,
    snapshot,
    updateTabBadge,
    ingestPush,
    soundEnabledOnThisDevice,
    setDeviceSoundEnabled,
    testIncomingAlert,
    signalIncomingMessage
  };
})();
