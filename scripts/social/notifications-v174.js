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
  const DEFAULT_TAB_TITLE='NEIS Circle';

  function updateTabBadge(){
    if(typeof document==='undefined')return;
    const unread=(state.notifications||[]).filter(n=>!n.read_at).length;
    const label=unread>99?'99+':String(unread);
    document.title=unread?'('+label+') '+DEFAULT_TAB_TITLE:DEFAULT_TAB_TITLE;
  }

  const same=(a,b)=>String(a)===String(b);
  const renderNotificationsIfVisible=()=>{
    updateBadges();
    if(state.view==='notifications')render();
  };

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

  async function playSound(){
    try{
      if(!await unlockSound())return;
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
    }catch{}
  }

  function applyRows(rows,{soundForNew=false}={}){
    const previousIds=new Set((state.notifications||[]).map(n=>String(n.id)));
    const next=Array.isArray(rows)?rows:[];
    const fresh=next.filter(n=>!previousIds.has(String(n.id)));
    state.notifications=next;
    renderNotificationsIfVisible();
    if(soundForNew&&fresh.some(n=>!n.read_at))playSound();
  }

  function applyRealtime(payload){
    const event=payload?.eventType,row=payload?.new||{},oldRow=payload?.old||{};
    if(event==='INSERT'&&row?.id){
      if(!(state.notifications||[]).some(n=>same(n.id,row.id))){
        state.notifications=[row,...(state.notifications||[])].slice(0,100);
      }
      renderNotificationsIfVisible();
      if(!row.read_at){
        playSound();
        showSystemNotification(row);
      }
      return;
    }
    if(event==='UPDATE'&&row?.id){
      const index=(state.notifications||[]).findIndex(n=>same(n.id,row.id));
      if(index>=0)state.notifications[index]={...state.notifications[index],...row};
      else state.notifications=[row,...(state.notifications||[])].slice(0,100);
      renderNotificationsIfVisible();
      return;
    }
    if(event==='DELETE'&&oldRow?.id){
      state.notifications=(state.notifications||[]).filter(n=>!same(n.id,oldRow.id));
      renderNotificationsIfVisible();
    }
  }

  async function refresh(soundForNew=false,{force=false}={}){
    if(!sb||!authUser)return;
    const now=Date.now();
    if(!force&&lastFullSyncAt&&now-lastFullSyncAt<3000)return;
    if(refreshPromise)return refreshPromise;
    refreshPromise=(async()=>{
      const {data,error}=await sb.from('notifications').select('*').order('created_at',{ascending:false}).limit(100);
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
      if(!(state.notifications||[]).length)await refresh(false);
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
    realtimeStatus='CONNECTING';
    channel=sb.channel(`neis-notifications-${uid}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${uid}`},applyRealtime)
      .subscribe(status=>{
        realtimeStatus=status;
        if(status==='SUBSCRIBED'){
          if(!(state.notifications||[]).length||Date.now()-lastFullSyncAt>60000)refresh(false);
          startFallback();
        }else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){
          startFallback();
        }
      });
  }

  async function reset(){
    clearInterval(pollTimer);
    pollTimer=null;
    refreshPromise=null;
    lastFullSyncAt=0;
    channelUid='';
    realtimeStatus='CLOSED';
    if(channel&&sb){
      try{await sb.removeChannel(channel)}catch(_){}
    }
    channel=null;
    audioContext=null;
    soundUnlocked=false;
    updateTabBadge();
  }

  function snapshot(){
    return {
      version:'174.2',
      channelUid,
      realtimeStatus,
      lastFullSyncAt,
      refreshing:!!refreshPromise,
      soundUnlocked
    };
  }

  const primeNotificationSound=()=>{
    unlockSound().catch(()=>{});
  };
  document.addEventListener('pointerdown',primeNotificationSound,{capture:true,once:true});
  document.addEventListener('keydown',primeNotificationSound,{capture:true,once:true});

  window.NEISNotificationRuntime={
    version:'174.0',
    unlockSound,
    playSound,
    applyRows,
    applyRealtime,
    refresh,
    setup,
    reset,
    snapshot,
    updateTabBadge
  };
})();
