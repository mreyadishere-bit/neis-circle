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
  const BASE_FAVICON='/assets/email-logo.png';
  let faviconImagePromise=null;
  let faviconRenderToken=0;

  function faviconLink(){
    let link=document.querySelector('link[rel~="icon"]');
    if(!link){
      link=document.createElement('link');
      link.rel='icon';
      link.type='image/png';
      document.head.appendChild(link);
    }
    return link;
  }

  function loadFaviconImage(){
    if(faviconImagePromise)return faviconImagePromise;
    faviconImagePromise=new Promise((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>resolve(image);
      image.onerror=reject;
      image.src=BASE_FAVICON;
    });
    return faviconImagePromise;
  }

  async function updateTabBadge(){
    if(typeof document==='undefined')return;
    const unread=(state.notifications||[]).filter(n=>!n.read_at).length;
    const link=faviconLink();
    const token=++faviconRenderToken;
    if(!unread){
      link.href=BASE_FAVICON;
      return;
    }
    try{
      const image=await loadFaviconImage();
      if(token!==faviconRenderToken)return;
      const size=64,canvas=document.createElement('canvas');
      canvas.width=size;canvas.height=size;
      const ctx=canvas.getContext('2d');
      if(!ctx)return;
      ctx.clearRect(0,0,size,size);
      ctx.drawImage(image,0,0,size,size);
      const x=49,y=15,r=15;
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle='#e5484d';ctx.fill();
      ctx.lineWidth=3;ctx.strokeStyle='#ffffff';ctx.stroke();
      const label=unread>9?'9+':String(unread);
      ctx.fillStyle='#ffffff';ctx.font=unread>9?'700 16px Arial':'700 20px Arial';
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,x,y+1);
      link.href=canvas.toDataURL('image/png');
    }catch{
      link.href=BASE_FAVICON;
    }
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
      if(!row.read_at)playSound();
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
      version:'174.1',
      channelUid,
      realtimeStatus,
      lastFullSyncAt,
      refreshing:!!refreshPromise,
      soundUnlocked
    };
  }

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
