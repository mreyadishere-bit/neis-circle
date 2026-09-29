/* NEIS Circle v6 — database-first conversations, replies, connections, search, circles and notifications. */
(function(){
const t=(en,arabic)=>state.lang==='ar'?arabic:en;
const same=(a,b)=>String(a)===String(b);
const byId=(arr,id)=>arr.find(x=>same(x.id,id));
const normalize=value=>String(value||'').toLocaleLowerCase(state.lang==='ar'?'ar':'en').normalize('NFKD').replace(/[\u0640\u064b-\u065f\u0670]/g,'').trim();
const articleTextDirection=(...values)=>{const text=values.join(' ').replace(/<[^>]*>/g,' '),arabic=(text.match(/[\u0600-\u06ff]/g)||[]).length,latin=(text.match(/[A-Za-z]/g)||[]).length;return arabic>latin?'rtl':'ltr'};
const match=(query,...values)=>!query||normalize(values.flat().join(' ')).includes(query);
const blank=(title,copy)=>`<div class="empty"><b>${title}</b><span>${copy}</span></div>`;
const normalizeSearch=normalize,matchesSearch=match,emptyState=blank;
const when=value=>new Intl.DateTimeFormat(state.lang==='ar'?'ar-EG':'en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value||Date.now()));
const relative=value=>{const sec=Math.max(0,(Date.now()-new Date(value).getTime())/1000);if(sec<60)return t('now','الآن');if(sec<3600)return `${Math.floor(sec/60)}${t('m','د')}`;if(sec<86400)return `${Math.floor(sec/3600)}${t('h','س')}`;return new Intl.DateTimeFormat(state.lang==='ar'?'ar-EG':'en-GB',{day:'numeric',month:'short'}).format(new Date(value))};
const safeError=(error,fallback)=>{console.error('[NEIS]',error);return window.neisFriendlyError?.(error,fallback)||t('Something went wrong. Please try again.','حدث خطأ. حاول مرة أخرى.')};
Object.assign(state,{follows:[],conversations:[],conversationMembers:[],liveMessages:[],circleRows:[],circleMembers:[],circleMessages:[],circleMeetings:[],notifications:[],reports:[],allComments:[],profileBadges:[],connectionTab:'following',searchTab:'all',searchResults:[],searchLoading:false,activeProfileId:'',activeConversationId:'',activeCircleId:'',circleTab:'home',meetingInviteId:'',circleFilter:'all',circleQuery:'',connectionsQuery:'',conversationQuery:'',discoverGrade:'all',discoverBranch:'all',dataErrors:{},dmDrafts:{},dmReplyTo:null,circleDrafts:{},circleReplyTo:null});
let v6Channel=null,notificationChannel=null,notificationPollTimer=null,notificationRealtimeStatus='CLOSED',searchTimer=null,circleSearchTimer=null,searchIndex=-1,searchRequestId=0;
let notificationAudioContext=null,notificationSoundUnlocked=false,notificationVisibilityBound=false;
let activeMeetingRuntime=null,liveKitModulePromise=null;
let authorLikeEmailSetting=null,authorLikeEmailSettingLoading=false;
let adminDmEmailSetting=null,adminDmEmailSettingLoading=false;
let adminPostEmailSetting=null,adminPostEmailSettingLoading=false;
const AUTHOR_LIKE_EMAIL_ADMIN='mreyadishere@gmail.com';
const expandedPostIds=new Set();

function profileData(id){return state.members.find(x=>same(x.id,id))||{id,full_name:t('NEIS Student','طالب NEIS'),username:'student',grade:'',branch:'',bio:'',interests:[]}}
function profileAvatar(p,large=false){return avatar({name:p.full_name||p.name,initials:initials(p.full_name||p.name),color:'#006f5b'},large)}
function hasCommunityBuilder(id){return state.profileBadges.some(b=>same(b.user_id,id)&&b.badge_key==='community_builder')}
function isFollowing(id){return state.follows.some(f=>same(f.follower_id,authUser?.id)&&same(f.following_id,id)&&f.status==='accepted')}
function followsMe(id){return state.follows.some(f=>same(f.follower_id,id)&&same(f.following_id,authUser?.id)&&f.status==='accepted')}
function membership(circleId,userId=authUser?.id){return state.circleMembers.find(m=>same(m.circle_id,circleId)&&same(m.user_id,userId))}
function canManageCircle(circleId){const m=membership(circleId);return !!(state.isAdmin||(m&&m.status==='active'&&['owner','admin'].includes(m.role)))}
function canModerateCircle(circleId){const m=membership(circleId);return !!(state.isAdmin||(m&&m.status==='active'&&['owner','admin','moderator'].includes(m.role)))}
function unreadMessages(){return state.conversations.reduce((sum,c)=>sum+conversationUnread(c.id),0)}
function conversationUnread(id){const member=state.conversationMembers.find(m=>same(m.conversation_id,id)&&same(m.user_id,authUser?.id)),read=member?.last_read_at||'1970-01-01';return state.liveMessages.filter(m=>same(m.conversation_id,id)&&!same(m.sender_id,authUser?.id)&&new Date(m.created_at)>new Date(read)).length}
async function unlockNotificationSound(){try{const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return false;notificationAudioContext=notificationAudioContext||new AudioCtx();if(notificationAudioContext.state!=='running')await notificationAudioContext.resume();notificationSoundUnlocked=notificationAudioContext.state==='running';return notificationSoundUnlocked}catch{return false}}
async function playNotificationSound(){try{if(!await unlockNotificationSound())return;const ctx=notificationAudioContext,now=ctx.currentTime,master=ctx.createGain();master.gain.setValueAtTime(.0001,now);master.gain.exponentialRampToValueAtTime(.34,now+.012);master.gain.exponentialRampToValueAtTime(.0001,now+.62);master.connect(ctx.destination);[[1046.5,0,.19,'sine'],[1568,.11,.25,'triangle'],[2093,.24,.31,'sine']].forEach(([freq,delay,duration,type])=>{const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,now+delay);gain.gain.setValueAtTime(.0001,now+delay);gain.gain.exponentialRampToValueAtTime(.9,now+delay+.008);gain.gain.exponentialRampToValueAtTime(.0001,now+delay+duration);osc.connect(gain);gain.connect(master);osc.start(now+delay);osc.stop(now+delay+duration+.04)})}catch{}}
function applyNotificationRows(rows,{soundForNew=false}={}){const previousIds=new Set(state.notifications.map(n=>String(n.id))),fresh=(rows||[]).filter(n=>!previousIds.has(String(n.id)));state.notifications=rows||[];updateBadges();if(state.view==='notifications')render();if(soundForNew&&fresh.some(n=>!n.read_at))playNotificationSound()}
function applyRealtimeNotification(payload){const event=payload?.eventType,row=payload?.new||{},oldRow=payload?.old||{};if(event==='INSERT'&&row?.id){if(!state.notifications.some(n=>same(n.id,row.id)))state.notifications=[row,...state.notifications].slice(0,100);updateBadges();if(state.view==='notifications')render();if(!row.read_at)playNotificationSound();return}if(event==='UPDATE'&&row?.id){const index=state.notifications.findIndex(n=>same(n.id,row.id));if(index>=0)state.notifications[index]={...state.notifications[index],...row};else state.notifications=[row,...state.notifications].slice(0,100);updateBadges();if(state.view==='notifications')render();return}if(event==='DELETE'&&oldRow?.id){state.notifications=state.notifications.filter(n=>!same(n.id,oldRow.id));updateBadges();if(state.view==='notifications')render()}}
async function refreshNotificationsOnly(soundForNew=false){if(!sb||!authUser)return;const {data,error}=await sb.from('notifications').select('*').order('created_at',{ascending:false}).limit(100);if(error){console.error('[NEIS notifications refresh]',error);return}applyNotificationRows(data||[],{soundForNew})}
function startNotificationFallback(){clearInterval(notificationPollTimer);notificationPollTimer=setInterval(()=>refreshNotificationsOnly(true),notificationRealtimeStatus==='SUBSCRIBED'?20000:6000)}
async function setupNotificationRealtime(uid){if(notificationChannel)await sb.removeChannel(notificationChannel);notificationRealtimeStatus='CONNECTING';notificationChannel=sb.channel(`neis-notifications-${uid}`).on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${uid}`},applyRealtimeNotification).subscribe(status=>{notificationRealtimeStatus=status;if(status==='SUBSCRIBED')refreshNotificationsOnly(false);if(['SUBSCRIBED','CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))startNotificationFallback()})}
function routeTo(path,replace=false){const hash='#/'+String(path||'home').replace(/^\/+/, '');if(location.hash===hash){applyRoute();return}(replace?history.replaceState(null,'',hash):history.pushState(null,'',hash));applyRoute()}

function applyRoute(){
  if(!authUser)return;
  const raw=location.hash.replace(/^#\/?/,'')||'home',[pathPart,queryPart='']=raw.split('?'),parts=pathPart.split('/').map(decodeURIComponent),head=parts[0];
  if(head!=='search'){state.query='';const globalInput=$('#globalSearch');if(globalInput)globalInput.value='';$('[data-global-search-clear]')?.classList.add('hidden');$('#searchSuggestions')?.classList.add('hidden')}
  if(head==='profile'&&parts[1]){state.view='profile-detail';state.activeProfileId=parts[1]}
  else if(head==='messages'){state.view='messages';state.activeConversationId=parts[1]||''}
  else if(head==='circles'&&parts[1]){state.view='circle-detail';state.activeCircleId=parts[1];state.circleTab=parts[2]||'home';state.meetingInviteId=state.circleTab==='meetings'?(new URLSearchParams(queryPart).get('meeting')||''):''}
  else if(head==='connections'){state.view='connections';state.connectionTab=parts[1]||'following'}
  else if(head==='search'){state.view='search';const q=(new URLSearchParams(queryPart).get('q')||state.query||'').trim();state.query=q;const input=$('#globalSearch');if(input)input.value=q;performSearch(q,false)}
  else if(head==='post'&&parts[1]){state.view='home';setTimeout(()=>comments(parts[1]),80)}
  else if(head==='admin'&&!state.isAdmin){history.replaceState(null,'','#/home');state.view='home';toast(t('The admin workspace is private.','مساحة الإدارة خاصة.'))}
  else{state.view=['home','discover','circles','messages','library','opportunities','gallery','articles','study','admin','notifications'].includes(head)?head:'home'}
  render();
}
const priorNav=nav;
nav=function(view){if(view!=='search'){searchRequestId++;state.query='';state.searchResults=[];state.searchLoading=false;state.dataErrors.search=null}routeTo(view)};

const coreLoad=loadLiveData;
loadLiveData=async function(){
  if(!sb||!authUser)return;
  await coreLoad();
  if(realtimeChannel){await sb.removeChannel(realtimeChannel);realtimeChannel=null}
  const uid=authUser.id;
  const [followRes,myMembershipRes,circleRes,circleMemberRes,meetingRes,notificationRes,commentRes,reportRes,badgeRes]=await Promise.all([
    sb.from('follows').select('*').or(`follower_id.eq.${uid},following_id.eq.${uid}`).order('created_at',{ascending:false}),
    sb.from('conversation_members').select('*').eq('user_id',uid),
    sb.from('circles').select('*').order('created_at',{ascending:false}),
    sb.from('circle_members').select('*,profile:profiles(id,full_name,username,grade,branch,avatar_url)').order('joined_at'),
    sb.from('circle_meetings').select('*,creator:profiles(id,full_name,username,avatar_url)').order('starts_at'),
    sb.from('notifications').select('*').order('created_at',{ascending:false}).limit(100),
    sb.from('comments').select('id,post_id,parent_id,author_id,body,created_at,updated_at,deleted_at,profile:profiles(id,full_name,username,grade,branch,avatar_url)').is('deleted_at',null).order('created_at'),
    state.isAdmin?sb.rpc('admin_report_details'):Promise.resolve({data:[],error:null}),
    sb.from('profile_badges').select('user_id,badge_key,awarded_at')
  ]);
  if(!followRes.error)state.follows=followRes.data||[];else state.dataErrors.connections=followRes.error;
  const ownConversationMemberships=myMembershipRes.data||[];
  let conversationIds=ownConversationMemberships.filter(x=>!x.hidden_at).map(x=>x.conversation_id);
  let conversationRes={data:[]},memberRes={data:[]},messageRes={data:[]};
  if(conversationIds.length){[conversationRes,memberRes,messageRes]=await Promise.all([
    sb.from('conversations').select('*').in('id',conversationIds).order('updated_at',{ascending:false}),
    sb.from('conversation_members').select('*,profile:profiles(id,full_name,username,grade,branch,avatar_url)').in('conversation_id',conversationIds),
    sb.from('messages').select('*').in('conversation_id',conversationIds).order('created_at').limit(500)
  ])}
  if(!conversationRes.error)state.conversations=conversationRes.data||[];
  if(!memberRes.error)state.conversationMembers=memberRes.data||ownConversationMemberships;
  if(!messageRes.error){const clearedByConversation=new Map(ownConversationMemberships.filter(x=>x.cleared_at).map(x=>[String(x.conversation_id),new Date(x.cleared_at).getTime()]));state.liveMessages=(messageRes.data||[]).filter(m=>{const cleared=clearedByConversation.get(String(m.conversation_id));return !cleared||new Date(m.created_at).getTime()>cleared})}
  if(!circleRes.error)state.circleRows=circleRes.data||[];else state.dataErrors.circles=circleRes.error;
  if(!circleMemberRes.error)state.circleMembers=circleMemberRes.data||[];
  if(!meetingRes.error){state.circleMeetings=meetingRes.data||[];state.dataErrors.meetings=null}else{state.dataErrors.meetings=meetingRes.error;console.error('[NEIS meetings load]',meetingRes.error)}
  if(!notificationRes.error)state.notifications=notificationRes.data||[];
  if(!commentRes.error){state.allComments=commentRes.data||[];state.posts.forEach(p=>p.comments=state.allComments.filter(c=>same(c.post_id,p.id)).length)}
  if(!reportRes.error)state.reports=reportRes.data||[];
  if(!badgeRes.error)state.profileBadges=badgeRes.data||[];
  const joinedCircleIds=state.isAdmin?state.circleRows.map(c=>c.id):state.circleMembers.filter(m=>same(m.user_id,uid)&&['active','muted'].includes(m.status)).map(m=>m.circle_id);
  state.circleMessages=[];
  if(joinedCircleIds.length){const cm=await sb.from('circle_messages').select('*,profile:profiles(id,full_name,username,avatar_url)').in('circle_id',joinedCircleIds).order('created_at').limit(500);if(!cm.error)state.circleMessages=cm.data||[]}
  if(v6Channel)await sb.removeChannel(v6Channel);
  v6Channel=sb.channel(`neis-v7-${uid}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'posts'},refreshV6)
    .on('postgres_changes',{event:'*',schema:'public',table:'comments'},refreshV6)
    .on('postgres_changes',{event:'*',schema:'public',table:'reactions'},refreshV6)
    .on('postgres_changes',{event:'*',schema:'public',table:'comment_likes'},refreshV6)
    .on('postgres_changes',{event:'*',schema:'public',table:'comment_creator_hearts'},refreshV6)
    .on('postgres_changes',{event:'*',schema:'public',table:'messages'},refreshMessagesV6)
    .on('postgres_changes',{event:'*',schema:'public',table:'conversations'},refreshMessagesV6)
    .on('postgres_changes',{event:'*',schema:'public',table:'conversation_members'},refreshMessagesV6)
    .on('postgres_changes',{event:'*',schema:'public',table:'circle_messages'},refreshCircleMessagesV96)
    .on('postgres_changes',{event:'*',schema:'public',table:'circle_meetings'},refreshV6)
    .on('postgres_changes',{event:'*',schema:'public',table:'follows'},refreshV6)
    .on('postgres_changes',{event:'*',schema:'public',table:'circle_members'},refreshV6)
    .on('postgres_changes',{event:'*',schema:'public',table:'reports'},refreshV6)
    .subscribe();
  await setupNotificationRealtime(uid);
  if(!notificationVisibilityBound){notificationVisibilityBound=true;document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshNotificationsOnly(true)});window.addEventListener('focus',()=>refreshNotificationsOnly(true));document.addEventListener('pointerdown',unlockNotificationSound,{capture:true});document.addEventListener('keydown',unlockNotificationSound,{capture:true})}
};

let messageRefreshTimer=null,messageRefreshBusy=false,messageRefreshQueued=false;
async function refreshMessagesV6(){
  if(!sb||!authUser)return;
  if(messageRefreshBusy){messageRefreshQueued=true;return}
  clearTimeout(messageRefreshTimer);
  messageRefreshTimer=setTimeout(async()=>{
    messageRefreshBusy=true;
    try{
      do{
        messageRefreshQueued=false;
        const memberships=state.conversationMembers.filter(m=>same(m.user_id,authUser.id)&&!m.hidden_at);
        const ids=memberships.map(m=>m.conversation_id);
        if(!ids.length){state.liveMessages=[];return}
        const [conversationRes,memberRes,messageRes]=await Promise.all([
          sb.from('conversations').select('*').in('id',ids).order('updated_at',{ascending:false}),
          sb.from('conversation_members').select('*,profile:profiles(id,full_name,username,grade,branch,avatar_url)').in('conversation_id',ids),
          sb.from('messages').select('*').in('conversation_id',ids).order('created_at').limit(500)
        ]);
        if(!conversationRes.error)state.conversations=conversationRes.data||[];
        if(!memberRes.error)state.conversationMembers=memberRes.data||state.conversationMembers;
        if(!messageRes.error){
          const mineRows=state.conversationMembers.filter(m=>same(m.user_id,authUser.id));
          const clearedByConversation=new Map(mineRows.filter(x=>x.cleared_at).map(x=>[String(x.conversation_id),new Date(x.cleared_at).getTime()]));
          state.liveMessages=(messageRes.data||[]).filter(m=>{const cleared=clearedByConversation.get(String(m.conversation_id));return !cleared||new Date(m.created_at).getTime()>cleared});
        }
        if(state.view==='messages'&&state.activeConversationId){
          const flow=$('#chatFlow'),input=$('#liveChatInput'),wasNearBottom=flow?flow.scrollHeight-flow.scrollTop-flow.clientHeight<80:true;
          const inputWasFocused=!!input&&document.activeElement===input;
          const inputValue=input?.value??'';
          const selection=inputWasFocused?[input.selectionStart,input.selectionEnd]:null;
          const activeMessages=state.liveMessages.filter(m=>same(m.conversation_id,state.activeConversationId)&&!m.deleted_at);
          if(flow){
            flow.innerHTML=activeMessages.length?activeMessages.map((m,i)=>messageBubble(m,activeMessages[i-1])).join(''):emptyState(t('No messages yet','لا توجد رسائل بعد'),t('Send the first message.','أرسل أول رسالة.'));
            bindV6(flow);
          }
          if(input){
            if(inputWasFocused){
              input.value=inputValue;
              setDmDraft(state.activeConversationId,inputValue);
            }else{
              input.value=getDmDraft(state.activeConversationId);
            }
          }
          requestAnimationFrame(()=>{
            const liveInput=$('#liveChatInput');
            if(inputWasFocused&&liveInput){
              liveInput.focus({preventScroll:true});
              if(selection&&Number.isInteger(selection[0])&&Number.isInteger(selection[1])){
                try{liveInput.setSelectionRange(selection[0],selection[1])}catch(_){}
              }
            }
            if(flow&&wasNearBottom)flow.scrollTop=flow.scrollHeight;
          });
          updateBadges();
        }else{
          updateBadges();
        }
      }while(messageRefreshQueued)
    }finally{messageRefreshBusy=false}
  },70);
}


let circleMessageRefreshTimer=null,circleMessageRefreshBusy=false,circleMessageRefreshQueued=false;
async function refreshCircleMessagesV96(){
  if(!sb||!authUser)return;
  if(circleMessageRefreshBusy){circleMessageRefreshQueued=true;return}
  clearTimeout(circleMessageRefreshTimer);
  circleMessageRefreshTimer=setTimeout(async()=>{
    circleMessageRefreshBusy=true;
    try{
      do{
        circleMessageRefreshQueued=false;
        const joinedCircleIds=state.isAdmin?state.circleRows.map(c=>c.id):state.circleMembers.filter(m=>same(m.user_id,authUser.id)&&['active','muted'].includes(m.status)).map(m=>m.circle_id);
        if(!joinedCircleIds.length){state.circleMessages=[];return}
        const res=await sb.from('circle_messages').select('*,profile:profiles(id,full_name,username,avatar_url)').in('circle_id',joinedCircleIds).order('created_at').limit(500);
        if(!res.error)state.circleMessages=res.data||[];
        if(state.view==='circle-detail'&&state.circleTab==='chat'&&state.activeCircleId){
          const flow=$('#circleChatFlow'),input=$('#circleChatInput'),wasNearBottom=flow?flow.scrollHeight-flow.scrollTop-flow.clientHeight<80:true;
          const inputWasFocused=!!input&&document.activeElement===input,inputValue=input?.value??'',selection=inputWasFocused?[input.selectionStart,input.selectionEnd]:null;
          const activeMessages=state.circleMessages.filter(m=>same(m.circle_id,state.activeCircleId)&&!m.deleted_at);
          if(flow){flow.innerHTML=activeMessages.length?activeMessages.map((m,i)=>circleMessageBubble(m,activeMessages[i-1])).join(''):emptyState(t('No messages yet','لا توجد رسائل بعد'),t('Send the first message.','أرسل أول رسالة.'));bindV6(flow)}
          if(input){if(inputWasFocused){input.value=inputValue;setCircleDraft(state.activeCircleId,inputValue)}else input.value=getCircleDraft(state.activeCircleId)}
          requestAnimationFrame(()=>{const next=$('#circleChatInput');if(inputWasFocused&&next){next.focus({preventScroll:true});if(selection)try{next.setSelectionRange(selection[0],selection[1])}catch(_){}}if(flow&&wasNearBottom)flow.scrollTop=flow.scrollHeight});
        }
      }while(circleMessageRefreshQueued)
    }finally{circleMessageRefreshBusy=false}
  },70);
}

let refreshBusy=false,refreshQueued=false;
async function refreshV6(){
  if(refreshBusy){refreshQueued=true;return}
  refreshBusy=true;
  try{
    do{
      refreshQueued=false;
      const active=document.activeElement;
      const liveInput=$('#liveChatInput'),circleInput=$('#circleChatInput');
      const liveDraft=liveInput?.value??null,circleDraft=circleInput?.value??null;
      const liveSel=liveInput?[liveInput.selectionStart,liveInput.selectionEnd]:null;
      const circleSel=circleInput?[circleInput.selectionStart,circleInput.selectionEnd]:null;
      const keepLiveFocus=active===liveInput,keepCircleFocus=active===circleInput;
      const flow=$('#chatFlow'),circleFlow=$('#circleChatFlow');
      const flowBottom=flow?flow.scrollHeight-flow.scrollTop-flow.clientHeight:null;
      const circleBottom=circleFlow?circleFlow.scrollHeight-circleFlow.scrollTop-circleFlow.clientHeight:null;
      await loadLiveData();
      render();
      requestAnimationFrame(()=>{
        const nextLive=$('#liveChatInput'),nextCircle=$('#circleChatInput');
        if(nextLive&&liveDraft!==null){nextLive.value=liveDraft;if(keepLiveFocus){nextLive.focus({preventScroll:true});if(liveSel)nextLive.setSelectionRange(liveSel[0],liveSel[1])}}
        if(nextCircle&&circleDraft!==null){nextCircle.value=circleDraft;if(keepCircleFocus){nextCircle.focus({preventScroll:true});if(circleSel)nextCircle.setSelectionRange(circleSel[0],circleSel[1])}}
        const nextFlow=$('#chatFlow'),nextCircleFlow=$('#circleChatFlow');
        if(nextFlow&&flowBottom!==null)nextFlow.scrollTop=Math.max(0,nextFlow.scrollHeight-nextFlow.clientHeight-flowBottom);
        if(nextCircleFlow&&circleBottom!==null)nextCircleFlow.scrollTop=Math.max(0,nextCircleFlow.scrollHeight-nextCircleFlow.clientHeight-circleBottom);
      });
    }while(refreshQueued)
  }finally{refreshBusy=false}
}

const originalPostCard=postCard;
postCard=function(p){
  const liked=state.liked.map(String).includes(String(p.id)),saved=state.saved.map(String).includes(String(p.id));
  const deletable=p.is_live&&(same(p.author_id,authUser.id)||state.isAdmin||(p.circle_id&&canModerateCircle(p.circle_id)));
  const titleDirection=articleTextDirection(p.title||''),bodyDirection=articleTextDirection(p.body||'');
  const longBody=String(p.body||'').length>420||String(p.body||'').split(/\n/).length>6,expanded=expandedPostIds.has(String(p.id));
  return `<article class="post" id="post-${esc(p.id)}" data-post="${esc(p.id)}"><div class="post-top"><button class="author-link post-author" data-open-profile="${esc(p.author_id||'')}">${avatar(p)}<span class="post-person"><b>${esc(p.user)}</b><small>${esc(p.meta)} · ${esc(p.time)}</small></span></button><div class="post-meta-actions"><span class="post-kind">${esc(p.kind)}</span><div class="post-menu">${deletable?`<button class="danger" data-delete-post="${esc(p.id)}" aria-label="${t('Delete post','حذف المنشور')}">×</button>`:`<button data-report-target="post" data-report-id="${esc(p.id)}" aria-label="${t('Report post','الإبلاغ عن المنشور')}">•••</button>`}</div></div></div><h3 dir="${titleDirection}">${esc(p.title)}</h3><p class="post-body ${longBody&&!expanded?'collapsed':''}" dir="${bodyDirection}">${esc(p.body)}</p>${longBody?`<button type="button" class="post-read-more" data-post-read-more="${esc(p.id)}" aria-expanded="${expanded}">${expanded?t('Show less','عرض أقل'):t('Read more','اقرأ المزيد')}</button>`:''}${p.image_url?`<button type="button" class="post-image-open" data-full-image="${esc(p.image_url)}" aria-label="Open image full size"><img class="upload-preview" style="margin-top:15px" src="${esc(p.image_url)}" alt="${esc(p.title)}" onerror="this.closest('.post-image-open')?.remove()"></button>`:''}<div class="tag-row">${(p.tags||[]).map(tag=>`<button class="chip" data-topic="${esc(tag)}">#${esc(tag)}</button>`).join('')}</div><div class="post-actions"><button class="action ${liked?'active':''}" data-action="like" data-id="${esc(p.id)}">${icon('heart')}<span>${t('Helpful','مفيد')}</span><b>${p.likes}</b></button><button class="action" data-action="comments" data-id="${esc(p.id)}">${icon('chat')}<span>${t('Replies','الردود')}</span><b>${p.comments||0}</b></button><button class="action save ${saved?'active':''}" data-action="save" data-id="${esc(p.id)}">${icon('save')}<span>${saved?t('Saved','محفوظ'):t('Save','حفظ')}</span></button><button class="action" data-action="share" data-id="${esc(p.id)}">${icon('share')}<span>${t('Share','مشاركة')}</span></button></div></article>`
};

discover=function(){
  let people=state.members.filter(p=>!same(p.id,authUser.id)),q=normalize(state.query);
  if(q)people=people.filter(p=>match(q,p.full_name,p.username,p.grade,p.branch,p.interests,p.bio));
  if(state.discoverGrade!=='all')people=people.filter(p=>p.grade===state.discoverGrade);
  if(state.discoverBranch!=='all')people=people.filter(p=>p.branch===state.discoverBranch);
  if(state.discoverFilter==='Same branch')people=people.filter(p=>p.branch===state.profile.branch);
  if(state.discoverFilter==='Programming')people=people.filter(p=>normalize(p.interests).includes('programming'));
  const grades=['Grade 10','Grade 11','Grade 12'],branches=window.NEIS_BRANCHES||[...new Set(state.members.map(p=>p.branch).filter(Boolean))];
  const gradeOptions=grades.map(grade=>`<option value="${esc(grade)}" ${state.discoverGrade===grade?'selected':''}>${esc(grade)}</option>`).join('');
  const branchOptions=branches.map(branch=>`<option value="${esc(branch)}" ${state.discoverBranch===branch?'selected':''}>${esc(branch)}</option>`).join('');
  return `${pageTitle(t('Discover people','اكتشف الطلاب'),t('Find students by grade, branch, interests, or name.','ابحث عن الطلاب حسب الصف أو الفرع أو الاهتمامات أو الاسم.'))}<section class="discover-filter-panel" aria-label="${t('Student filters','فلاتر الطلاب')}"><label class="field"><span>${t('Grade','الصف')}</span><select id="discoverGradeFilter"><option value="all">${t('All grades','كل الصفوف')}</option>${gradeOptions}</select></label><label class="field"><span>${t('Branch','الفرع')}</span><select id="discoverBranchFilter"><option value="all">${t('All branches','كل الفروع')}</option>${branchOptions}</select></label><button class="secondary discover-filter-reset" data-reset-discover type="button">${t('Reset filters','إعادة الضبط')}</button></section><div class="tabs discover-shortcuts">${[['Recommended','الكل'],['Same branch','نفس فرعي'],['Programming','البرمجة']].map(([v,a])=>`<button class="${state.discoverFilter===v?'active':''}" data-discover-filter="${v}">${t(v,a)}</button>`).join('')}</div><p class="discover-result-count">${people.length} ${t(people.length===1?'student':'students','طالب')}</p><div class="grid-3 people-grid">${people.length?people.map(personCard).join(''):blank(t('No students found','لا يوجد طلاب'),t('Try another grade, branch, or search term.','جرّب صفًا أو فرعًا أو عبارة بحث أخرى.'))}</div>`
};
function personCard(p){return `<article class="module-card profile-card student-card" data-open-profile="${p.id}" tabindex="0"><div class="person-card-head">${profileAvatar(p,true)}<div><h3>${esc(p.full_name||'Student')}</h3><p class="person-handle">@${esc(p.username||'student')}</p></div></div><div class="person-tags"><span class="post-kind ${String(p.grade||'').toLowerCase()==='graduate'?'graduate-badge':''}">${esc(p.grade||'Student')}</span><span class="branch-tag">${esc(p.branch||'NEIS')}</span></div><p class="person-interests">${esc((p.interests||[]).join(' · ')||p.bio||t('Learning and community','التعلم والمجتمع'))}</p><div class="profile-actions"><button class="secondary" data-v6-follow="${p.id}">${isFollowing(p.id)?t('Following ✓','تتم المتابعة ✓'):t('Follow','متابعة')}</button><button class="primary" data-message-user="${p.id}">${t('Message','مراسلة')}</button></div></article>`}

function profileView(){
  const p=profileData(state.activeProfileId),own=same(p.id,authUser.id),followers=state.follows.filter(f=>same(f.following_id,p.id)&&f.status==='accepted').length,following=state.follows.filter(f=>same(f.follower_id,p.id)&&f.status==='accepted').length,posts=state.posts.filter(x=>same(x.author_id,p.id)&&!x.circle_id),interests=Array.isArray(p.interests)?p.interests:String(p.interests||'').split(/[·,]/).map(x=>x.trim()).filter(Boolean);
  return `<section class="profile-hero">${profileAvatar(p,true).replace('large','large xl')}<div><div class="identity-line"><h1>${esc(p.full_name||'Student')}</h1>${p.role==='admin'?'<span class="badge-admin">Admin</span>':''}${hasCommunityBuilder(p.id)?`<span class="badge-community" title="${t('Awarded after 2 successful referrals','تُمنح بعد دعوتين ناجحتين')}">🌟 ${t('Community Builder','باني المجتمع')}</span>`:''}</div><p>@${esc(p.username||'student')} · ${esc(p.grade||'')} ${p.branch?`· ${esc(p.branch)}`:''}</p><p>${esc(p.bio||t('No bio yet.','لا توجد نبذة بعد.'))}</p>${interests.length?`<div class="profile-interest-block"><small>${t('Interests','الاهتمامات')}</small><div class="tag-row">${interests.map(item=>`<span>${esc(item)}</span>`).join('')}</div></div>`:''}<div class="profile-stats"><span><b>${followers}</b> ${t('followers','متابع')}</span><span><b>${following}</b> ${t('following','يتابع')}</span><span><b>${posts.length}</b> ${t('posts','منشور')}</span></div></div><div class="profile-hero-actions">${own?`<button class="primary" data-action="profile">${t('Edit profile','تعديل الملف')}</button>`:`<button class="secondary" data-v6-follow="${p.id}">${isFollowing(p.id)?t('Unfollow','إلغاء المتابعة'):t('Follow','متابعة')}</button><button class="primary" data-message-user="${p.id}">${t('Message','مراسلة')}</button><button class="secondary" data-report-target="profile" data-report-id="${p.id}">${t('Report','إبلاغ')}</button>`}</div></section><div class="page-title" style="margin-top:24px"><div><h2>${t('Posts','المنشورات')}</h2><p>${t('Public activity from this student.','النشاط العام لهذا الطالب.')}</p></div></div><div class="feed">${posts.length?posts.map(postCard).join(''):blank(t('No posts yet','لا توجد منشورات بعد'),t('Published posts will appear here.','ستظهر المنشورات هنا.'))}</div>`
}

function connectionsView(){
  const uid=authUser.id,tabs=[['following',t('Following','أتابعهم')],['followers',t('Followers','المتابعون')],['mutuals',t('Mutuals','متبادلون')],['requests',t('Requests','الطلبات')],['suggested',t('Suggested','مقترحون')]];
  const followingIds=state.follows.filter(f=>same(f.follower_id,uid)&&f.status==='accepted').map(f=>f.following_id),followerIds=state.follows.filter(f=>same(f.following_id,uid)&&f.status==='accepted').map(f=>f.follower_id),pendingIds=state.follows.filter(f=>same(f.following_id,uid)&&f.status==='pending').map(f=>f.follower_id);
  let ids=state.connectionTab==='following'?followingIds:state.connectionTab==='followers'?followerIds:state.connectionTab==='mutuals'?followingIds.filter(id=>followerIds.some(x=>same(x,id))):state.connectionTab==='requests'?pendingIds:state.members.filter(p=>!same(p.id,uid)&&!followingIds.some(id=>same(id,p.id))).map(p=>p.id);
  let people=ids.map(profileData);const q=normalize(state.connectionsQuery);if(q)people=people.filter(p=>match(q,p.full_name,p.username,p.grade,p.branch,p.interests));
  return `${pageTitle(t('Connections','العلاقات'),t('Everyone you follow, everyone following you, and useful suggestions.','كل من تتابعهم ومن يتابعونك واقتراحات مفيدة.'))}<label class="field" style="max-width:420px"><input id="connectionSearch" placeholder="${t('Search connections…','ابحث في العلاقات…')}" value="${esc(state.connectionsQuery)}"></label><div class="tabs connections-tabs">${tabs.map(([v,l])=>`<button class="${state.connectionTab===v?'active':''}" data-connection-tab="${v}">${l} <b>${v==='following'?followingIds.length:v==='followers'?followerIds.length:v==='requests'?pendingIds.length:''}</b></button>`).join('')}</div><div class="grid-3" style="margin-top:18px">${people.length?people.map(p=>state.connectionTab==='requests'?requestCard(p):personCard(p)).join(''):emptyState(t('Nobody here yet','لا يوجد أحد هنا بعد'),state.connectionTab==='following'?t('Discover students and follow the people you want to keep up with.','اكتشف الطلاب وتابع من تريد رؤية نشاطهم.'):t('This list will update automatically.','ستتحدث هذه القائمة تلقائيًا.'))}</div>`
}
function requestCard(p){return `<article class="module-card profile-card" data-open-profile="${p.id}" tabindex="0"><div class="identity-line">${profileAvatar(p,true)}<div><h3>${esc(p.full_name||'Student')}</h3><p>@${esc(p.username||'student')}</p></div></div><p>${esc(p.grade||'')} · ${esc(p.branch||'')}</p><div class="profile-actions"><button class="primary" data-follow-request="accept" data-user="${p.id}">${t('Accept','قبول')}</button><button class="secondary danger" data-follow-request="reject" data-user="${p.id}">${t('Reject','رفض')}</button></div></article>`}



let dmKeyboardViewportBound=false,dmKeyboardLastHeight=0;
function scrollActiveDmToBottom(options={}){
  const flow=document.querySelector('#chatFlow');
  if(!flow)return;
  const run=()=>{flow.scrollTop=flow.scrollHeight};
  if(options.immediate)run();
  requestAnimationFrame(()=>{run();setTimeout(run,70);setTimeout(run,180)});
}
function bindDmKeyboardBottom(){
  if(dmKeyboardViewportBound)return;
  dmKeyboardViewportBound=true;
  const vv=window.visualViewport;
  if(vv){
    dmKeyboardLastHeight=vv.height;
    vv.addEventListener('resize',()=>{
      const input=document.querySelector('#liveChatInput'),circleInput=document.querySelector('#circleChatInput');
      const dmFocused=document.activeElement===input,circleFocused=document.activeElement===circleInput;
      if(!dmFocused&&!circleFocused){dmKeyboardLastHeight=vv.height;return}
      const opening=vv.height<dmKeyboardLastHeight-20;
      dmKeyboardLastHeight=vv.height;
      if(dmFocused&&(opening||document.querySelector('.messages.mobile-thread-open')))scrollActiveDmToBottom();
      if(circleFocused&&(opening||document.querySelector('.dm-like-circle-chat')))scrollActiveCircleChatToBottom();
    },{passive:true});
    vv.addEventListener('scroll',()=>{
      const input=document.querySelector('#liveChatInput'),circleInput=document.querySelector('#circleChatInput');
      if(document.activeElement===input)scrollActiveDmToBottom();
      if(document.activeElement===circleInput)scrollActiveCircleChatToBottom();
    },{passive:true});
  }else{
    window.addEventListener('resize',()=>{
      const input=document.querySelector('#liveChatInput'),circleInput=document.querySelector('#circleChatInput');
      if(document.activeElement===input)scrollActiveDmToBottom();
      if(document.activeElement===circleInput)scrollActiveCircleChatToBottom();
    },{passive:true});
  }
}


function activeDmReply(){
  const reply=state.dmReplyTo;
  if(!reply||!same(reply.conversationId,state.activeConversationId))return null;
  return state.liveMessages.find(m=>same(m.id,reply.messageId))||null;
}
function setDmReplyTarget(messageId){
  const message=state.liveMessages.find(m=>same(m.id,messageId));
  if(!message)return;
  state.dmReplyTo={conversationId:message.conversation_id,messageId:message.id};
  const existing=document.querySelector('[data-dm-reply-preview]');
  const markup=dmReplyComposer(message.conversation_id);
  if(existing)existing.outerHTML=markup;
  else document.querySelector('#liveChatForm')?.insertAdjacentHTML('beforebegin',markup);
  const cancel=document.querySelector('[data-cancel-dm-reply]');
  if(cancel)cancel.onclick=event=>{event?.preventDefault?.();event?.stopPropagation?.();clearDmReplyTarget()};
  scrollActiveDmToBottom();
}
function clearDmReplyTarget(){
  state.dmReplyTo=null;
  document.querySelector('[data-dm-reply-preview]')?.remove();
}
window.cancelDmReply=clearDmReplyTarget;
function dmReplyComposer(conversationId){
  const reply=state.dmReplyTo&&same(state.dmReplyTo.conversationId,conversationId)
    ?state.liveMessages.find(m=>same(m.id,state.dmReplyTo.messageId)):null;
  if(!reply)return '';
  const sender=profileData(reply.sender_id);
  return `<div class="dm-reply-preview" data-dm-reply-preview><div><b>${esc(sender?.full_name||t('Student','طالب'))}</b><span dir="auto">${esc(reply.body||t('Message','رسالة'))}</span></div><button type="button" data-cancel-dm-reply aria-label="${t('Cancel reply','إلغاء الرد')}" onpointerdown="event.preventDefault();event.stopPropagation();window.cancelDmReply?.();return false" onclick="event.preventDefault();event.stopPropagation();window.cancelDmReply?.();return false">×</button></div>`;
}
window.startDmReply=setDmReplyTarget;

function installDmSwipeReply(){
  if(window.__neisDmSwipeReplyV85)return;
  window.__neisDmSwipeReplyV85=true;
  let active=null,startX=0,startY=0,triggered=false,pointerId=null;
  const mobile=()=>window.matchMedia('(max-width:760px)').matches;
  const reset=()=>{
    if(active)active.classList.remove('swipe-reply-active','swipe-reply-ready');
    active=null;triggered=false;pointerId=null;
  };
  document.addEventListener('pointerdown',event=>{
    if(!mobile()||event.pointerType==='mouse')return;
    const row=event.target?.closest?.('#chatFlow > .chat-message, #circleChatFlow > .chat-message');
    if(!row)return;
    active=row;startX=event.clientX;startY=event.clientY;triggered=false;pointerId=event.pointerId;
    row.classList.add('swipe-reply-active');
  },{passive:true});
  document.addEventListener('pointermove',event=>{
    if(!active||pointerId!==event.pointerId||triggered)return;
    const dx=event.clientX-startX,dy=event.clientY-startY;
    if(Math.abs(dy)>36&&Math.abs(dy)>Math.abs(dx)){reset();return}
    const clamped=Math.max(0,Math.min(72,dx));
    active.style.setProperty('--swipe-reply-x',clamped+'px');
    active.classList.toggle('swipe-reply-ready',dx>=52&&Math.abs(dy)<34);
    if(dx>=64&&Math.abs(dy)<34){
      triggered=true;
      const id=active.dataset.messageId;
      active.classList.add('swipe-reply-ready');
      if(navigator.vibrate)navigator.vibrate(12);
      setTimeout(()=>{
        if(id){if(active?.closest?.('#circleChatFlow'))window.startCircleReply?.(id);else window.startDmReply?.(id)}
        if(active)active.style.removeProperty('--swipe-reply-x');
        reset();
      },70);
    }
  },{passive:true});
  const finish=event=>{
    if(!active)return;
    if(!triggered){
      active.style.removeProperty('--swipe-reply-x');
      reset();
    }
  };
  document.addEventListener('pointerup',finish,{passive:true});
  document.addEventListener('pointercancel',finish,{passive:true});
}
installDmSwipeReply();


const DM_DRAFTS_KEY='neis-dm-drafts-v1';
function loadDmDrafts(){
  try{return JSON.parse(sessionStorage.getItem(DM_DRAFTS_KEY)||'{}')||{}}catch(_){return {}}
}
function saveDmDrafts(){
  try{sessionStorage.setItem(DM_DRAFTS_KEY,JSON.stringify(state.dmDrafts||{}))}catch(_){}
}
function getDmDraft(id){
  if(!state.dmDrafts||typeof state.dmDrafts!=='object')state.dmDrafts=loadDmDrafts();
  return String(state.dmDrafts?.[String(id)]||'');
}
function setDmDraft(id,value){
  if(!id)return;
  if(!state.dmDrafts||typeof state.dmDrafts!=='object')state.dmDrafts={};
  const key=String(id),text=String(value||'');
  if(text)state.dmDrafts[key]=text;else delete state.dmDrafts[key];
  saveDmDrafts();
}
if(!state.dmDrafts||!Object.keys(state.dmDrafts).length)state.dmDrafts=loadDmDrafts();

const CIRCLE_DRAFTS_KEY='neis-circle-chat-drafts-v1';
function loadCircleDrafts(){
  try{return JSON.parse(sessionStorage.getItem(CIRCLE_DRAFTS_KEY)||'{}')||{}}catch(_){return {}}
}
function saveCircleDrafts(){
  try{sessionStorage.setItem(CIRCLE_DRAFTS_KEY,JSON.stringify(state.circleDrafts||{}))}catch(_){}
}
function getCircleDraft(id){
  if(!state.circleDrafts||typeof state.circleDrafts!=='object')state.circleDrafts=loadCircleDrafts();
  return String(state.circleDrafts?.[String(id)]||'');
}
function setCircleDraft(id,value){
  if(!id)return;
  if(!state.circleDrafts||typeof state.circleDrafts!=='object')state.circleDrafts={};
  const key=String(id),text=String(value||'');
  if(text)state.circleDrafts[key]=text;else delete state.circleDrafts[key];
  saveCircleDrafts();
}
if(!state.circleDrafts||!Object.keys(state.circleDrafts).length)state.circleDrafts=loadCircleDrafts();

function scrollActiveCircleChatToBottom(options={}){
  const flow=document.querySelector('#circleChatFlow');
  if(!flow)return;
  const run=()=>{flow.scrollTop=flow.scrollHeight};
  if(options.immediate)run();
  requestAnimationFrame(()=>{run();setTimeout(run,70);setTimeout(run,180)});
}
function activeCircleReply(){
  const reply=state.circleReplyTo;
  if(!reply||!same(reply.circleId,state.activeCircleId))return null;
  return state.circleMessages.find(m=>same(m.id,reply.messageId))||null;
}
function circleReplyComposer(circleId){
  const reply=state.circleReplyTo&&same(state.circleReplyTo.circleId,circleId)
    ?state.circleMessages.find(m=>same(m.id,state.circleReplyTo.messageId)):null;
  if(!reply)return '';
  const sender=reply.profile||profileData(reply.sender_id);
  return `<div class="dm-reply-preview circle-reply-preview" data-circle-reply-preview><div><b>${esc(sender?.full_name||t('Student','طالب'))}</b><span dir="auto">${esc(reply.deleted_at?t('Message deleted','تم حذف الرسالة'):reply.body||t('Message','رسالة'))}</span></div><button type="button" data-cancel-circle-reply aria-label="${t('Cancel reply','إلغاء الرد')}" onpointerdown="event.preventDefault();event.stopPropagation();window.cancelCircleReply?.();return false" onclick="event.preventDefault();event.stopPropagation();window.cancelCircleReply?.();return false">×</button></div>`;
}
function setCircleReplyTarget(messageId){
  const message=state.circleMessages.find(m=>same(m.id,messageId));
  if(!message||message.deleted_at)return;
  state.circleReplyTo={circleId:message.circle_id,messageId:message.id};
  const existing=document.querySelector('[data-circle-reply-preview]');
  const markup=circleReplyComposer(message.circle_id);
  if(existing)existing.outerHTML=markup;
  else document.querySelector('#circleChatForm')?.insertAdjacentHTML('beforebegin',markup);
  const cancel=document.querySelector('[data-cancel-circle-reply]');
  if(cancel)cancel.onclick=event=>{event?.preventDefault?.();event?.stopPropagation?.();clearCircleReplyTarget()};
  scrollActiveCircleChatToBottom();
}
function clearCircleReplyTarget(){
  state.circleReplyTo=null;
  document.querySelector('[data-circle-reply-preview]')?.remove();
}
window.cancelCircleReply=clearCircleReplyTarget;
window.startCircleReply=setCircleReplyTarget;


function conversationName(id){const other=state.conversationMembers.find(m=>same(m.conversation_id,id)&&!same(m.user_id,authUser.id));return other?.profile||profileData(other?.user_id)}
function conversationLast(id){return state.liveMessages.filter(m=>same(m.conversation_id,id)&&!m.deleted_at).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]}
messages=function(){
  let threads=[...state.conversations].sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));const q=normalize(state.conversationQuery);if(q)threads=threads.filter(c=>match(q,conversationName(c.id)?.full_name,conversationName(c.id)?.username,conversationLast(c.id)?.body));const compact=window.matchMedia('(max-width:760px)').matches,active=byId(state.conversations,state.activeConversationId)||(!compact?threads[0]:null);if(active&&!state.activeConversationId&&!compact)state.activeConversationId=active.id;
  const activePerson=active?conversationName(active.id):null,msgs=active?state.liveMessages.filter(m=>same(m.conversation_id,active.id)&&!m.deleted_at):[];
  return `<section class="messages ${active?'mobile-thread-open':''}"><aside class="thread-list"><div class="thread-head"><h2>${t('Messages','الرسائل')}</h2><button class="round-btn" data-new-chat aria-label="${t('New conversation','محادثة جديدة')}">+</button></div><input id="conversationSearch" class="thread-search" placeholder="${t('Search conversations…','ابحث في المحادثات…')}" value="${esc(state.conversationQuery)}"><div class="thread-list-scroll">${threads.length?threads.map(c=>{const p=conversationName(c.id),last=conversationLast(c.id),unread=conversationUnread(c.id);return `<button class="thread ${active&&same(c.id,active.id)?'active':''}" data-open-conversation="${c.id}">${profileAvatar(p)}<div><b>${esc(p?.full_name||'Student')}</b><small>${esc(last?.deleted_at?t('Message deleted','تم حذف الرسالة'):last?.body||t('Start the conversation','ابدأ المحادثة'))}</small></div>${unread?`<i class="count-badge unread">${unread}</i>`:`<time>${last?relative(last.created_at):''}</time>`}</button>`}).join(''):emptyState(t('No conversations yet','لا توجد محادثات بعد'),t('Start a conversation with any student.','ابدأ محادثة مع أي طالب.'))}</div></aside><div class="chat">${active?`<div class="chat-head"><button class="round-btn" data-mobile-threads aria-label="${t('Back to conversations','العودة للمحادثات')}">←</button>${profileAvatar(activePerson)}<button class="author-link" data-open-profile="${activePerson?.id}"><span><b>${esc(activePerson?.full_name||'Student')}</b><small>@${esc(activePerson?.username||'student')}</small></span></button><button class="round-btn chat-delete" data-delete-chat="${active.id}" title="${t('Remove chat','إزالة المحادثة')}" aria-label="${t('Remove chat','إزالة المحادثة')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"/></svg></button></div><div class="chat-flow" id="chatFlow">${msgs.length?msgs.map((m,i)=>messageBubble(m,msgs[i-1])).join(''):emptyState(t('No messages yet','لا توجد رسائل بعد'),t('Send the first message.','أرسل أول رسالة.'))}</div>${dmReplyComposer(active.id)}<form class="chat-form" id="liveChatForm"><input id="liveChatInput" maxlength="4000" required placeholder="${t('Write a message…','اكتب رسالة…')}" autocomplete="off" dir="auto" value="${esc(getDmDraft(active.id))}"><button aria-label="${t('Send','إرسال')}">→</button></form>`:`<div class="chat-empty">${emptyState(t('Choose a conversation','اختر محادثة'),t('Select a conversation or start a new one.','اختر محادثة أو ابدأ واحدة جديدة.'))}</div>`}</div></section>`
};
function messageBubble(m,previous){
  const mine=same(m.sender_id,authUser.id),grouped=previous&&same(previous.sender_id,m.sender_id)&&(new Date(m.created_at)-new Date(previous.created_at)<300000);
  const quoted=m.reply_to_id?state.liveMessages.find(x=>same(x.id,m.reply_to_id)):null;
  const quote=quoted?(()=>{const sender=profileData(quoted.sender_id);return `<div class="message-reply-quote"><b>${esc(sender?.full_name||t('Student','طالب'))}</b><span dir="auto">${esc(quoted.body||t('Message','رسالة'))}</span></div>`})():'';
  return `<div class="chat-message ${mine?'mine':''} ${grouped?'grouped':''}" data-message-id="${esc(m.id)}" data-message-deletable="${mine||state.isAdmin?'1':'0'}">${profileAvatar(profileData(m.sender_id))}<span class="bubble ${mine?'mine':''}">${quote}<span class="message-text" dir="auto">${esc(m.body)}</span><time>${when(m.created_at)}${m.edited_at?` · ${t('edited','معدلة')}`:''}</time><button type="button" class="message-actions-trigger" data-message-actions-trigger aria-label="${t('Message actions','خيارات الرسالة')}">•••</button></span></div>`
}

window.openNewConversation=function(){
  const people=state.members.filter(p=>!same(p.id,authUser.id));openModal(`<div class="modal-head"><div><h2>${t('New conversation','محادثة جديدة')}</h2><p>${t('Search and message a student directly. Following is not required.','ابحث عن طالب وراسله مباشرة دون اشتراط المتابعة.')}</p></div><button class="close" data-close>×</button></div><label class="field"><input id="newChatSearch" placeholder="${t('Search students…','ابحث عن الطلاب…')}"></label><div id="newChatPeople" class="result-list">${people.slice(0,20).map(newChatRow).join('')}</div>`);const input=$('#newChatSearch');input.oninput=()=>{const q=normalize(input.value);$('#newChatPeople').innerHTML=people.filter(p=>match(q,p.full_name,p.username,p.grade,p.branch)).slice(0,30).map(newChatRow).join('')||blank(t('No students found','لا يوجد طلاب'),t('Try another name.','جرّب اسمًا آخر.'));bindV6($('#modalRoot'))};bindV6($('#modalRoot'))
};
function newChatRow(p){return `<button class="result-row" data-message-user="${p.id}">${profileAvatar(p)}<div><h3>${esc(p.full_name||'Student')}</h3><p>@${esc(p.username||'student')} · ${esc(p.grade||'')} · ${esc(p.branch||'')}</p></div><span>→</span></button>`}
async function startConversation(userId){const existing=state.conversations.find(c=>state.conversationMembers.some(m=>same(m.conversation_id,c.id)&&same(m.user_id,userId)));let id=existing?.id;if(!id){const {data,error}=await sb.rpc('start_direct_conversation',{target_user:userId});if(error){toast(safeError(error,'start this conversation'));return}id=data}await sb.rpc('restore_own_conversation',{conversation_id_input:id});closeModal();await loadLiveData();state.activeConversationId=id;routeTo(`messages/${id}`);await markConversationRead(id)}
async function markConversationRead(id){await sb.from('conversation_members').update({last_read_at:new Date().toISOString()}).match({conversation_id:id,user_id:authUser.id});const mine=state.conversationMembers.find(m=>same(m.conversation_id,id)&&same(m.user_id,authUser.id));if(mine)mine.last_read_at=new Date().toISOString();updateBadges()}

circles=function(){
  let items=[...state.circleRows],q=normalize(state.query);if(q)items=items.filter(c=>match(q,c.name,c.description,c.category));
  if(state.circleFilter==='joined')items=items.filter(c=>membership(c.id)?.status==='active');
  if(state.circleFilter==='created')items=items.filter(c=>same(c.owner_id,authUser.id));
  return `${pageTitle(t('Circles','المجتمعات'),t('Real student communities with posts, chat, meetings and shared purpose.','مجتمعات طلابية حقيقية بها منشورات ودردشة واجتماعات وهدف مشترك.'),`<button class="primary circle-create-button" data-new-circle aria-label="${t('New circle','مجتمع جديد')}">${t('+ New circle','+ مجتمع جديد')}</button>`)}<div class="tabs"><button class="${state.circleFilter==='all'?'active':''}" data-circle-filter="all">${t('Explore','استكشف')}</button><button class="${state.circleFilter==='joined'?'active':''}" data-circle-filter="joined">${t('Joined','منضم إليها')}</button><button class="${state.circleFilter==='created'?'active':''}" data-circle-filter="created">${t('Created','أنشأتها')}</button></div><div class="grid-3" style="margin-top:18px">${items.length?items.map(circleCard).join(''):emptyState(t('No circles here yet','لا توجد مجتمعات هنا بعد'),state.circleFilter==='all'?t('Create the first Circle and it will open immediately.','أنشئ أول مجتمع وسيفتح فورًا.'):t('Change the filter or create a Circle.','غيّر الفلتر أو أنشئ مجتمعًا.'))}</div>`
};
function circleCard(c){const members=state.circleMembers.filter(m=>same(m.circle_id,c.id)&&m.status==='active').length,mine=membership(c.id);return `<article class="module-card profile-card" data-open-circle="${c.id}" role="link" tabindex="0" aria-label="${t('Open','فتح')} ${esc(c.name)}"><span class="module-icon" style="--tone:var(--accent2)">${esc((c.name||'NC').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase())}</span><h3>${esc(c.name)}</h3><p>${esc(c.description||t('A student community.','مجتمع طلابي.'))}</p><div class="module-meta"><span>${esc(c.category)} · ${c.privacy==='private'?t('Private','خاص'):t('Public','عام')}</span><span>${members} ${t('members','أعضاء')}</span></div><button class="primary" data-open-circle="${c.id}">${mine?.status==='active'?t('Open circle','فتح المجتمع'):t('View circle','عرض المجتمع')}</button></article>`}
function circleView(){
  const c=byId(state.circleRows,state.activeCircleId);if(!c)return blank(t('Circle not found','المجتمع غير موجود'),t('It may have been removed or is private.','ربما تمت إزالته أو أصبح خاصًا.'));const mine=membership(c.id),members=state.circleMembers.filter(m=>same(m.circle_id,c.id)&&m.status==='active'),role=mine?.role||'visitor',roleLabel={owner:t('Owner','المالك'),admin:t('Admin','مشرف'),moderator:t('Moderator','منسق'),member:t('Member','عضو'),visitor:t('Visitor','زائر')}[role]||role,memberWord=members.length===1?t('member','عضو'):t('members','أعضاء');
  const tabs=[['home',t('Home','الرئيسية')],['posts',t('Posts','المنشورات')],['chat',t('Chat','الدردشة')],['meetings',t('Meetings','الاجتماعات')],['members',t('Members','الأعضاء')],['about',t('About','حول')]];
  return `<section class="circle-hero"><span class="module-icon circle-logo">${esc(c.name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase())}</span><div class="circle-hero-copy"><div class="identity-line"><h1>${esc(c.name)}</h1><span class="role-pill ${role}">${esc(roleLabel)}</span></div><p>${esc(c.description)}</p><div class="profile-stats"><span><b>${members.length}</b>${memberWord}</span><span>${esc(c.category)}</span><span>${c.privacy==='private'?t('Private','خاص'):t('Public','عام')}</span></div></div><div class="profile-hero-actions">${mine?.status==='active'?(role==='owner'?`<button class="primary" data-circle-tab="members">${t('Manage Circle','إدارة المجتمع')}</button>`:`<button class="secondary" data-v6-circle-leave="${c.id}">${t('Leave','مغادرة')}</button>`):`<button class="primary" data-v6-circle-join="${c.id}">${c.privacy==='private'?t('Join with key','الانضمام بالمفتاح'):t('Join','انضمام')}</button>`}<button class="secondary" data-share-circle="${c.id}">${t('Share','مشاركة')}</button><button class="secondary" data-report-target="circle" data-report-id="${c.id}" aria-label="${t('More options','خيارات إضافية')}">•••</button></div></section><div class="tabs circle-tabs">${tabs.map(([v,l])=>`<button class="${state.circleTab===v?'active':''}" data-circle-tab="${v}">${l}</button>`).join('')}</div>${circleTabContent(c,mine,members)}`
}
function circleTabContent(c,mine,members){
  const query=normalize(state.circleQuery),allPosts=state.posts.filter(p=>same(p.circle_id,c.id)),posts=allPosts.filter(p=>match(query,p.title,p.body,p.tags,p.user)),filteredMembers=members.filter(m=>match(query,m.profile?.full_name,m.profile?.username,m.profile?.grade,m.profile?.branch,m.role));
  const search=`<div class="circle-toolbar"><label class="field"><input id="circleSearch" value="${esc(state.circleQuery)}" placeholder="${t('Search this Circle…','ابحث داخل المجتمع…')}"></label>${state.circleQuery?`<button class="secondary" data-clear-circle-search>${t('Clear','مسح')}</button>`:''}</div>`;
  if(state.circleTab==='home')return `${search}<div class="circle-layout"><div><div class="composer-bar">${profileAvatar(profileData(authUser.id))}<button ${mine?.status==='active'?'data-circle-compose':''}>${mine?.status==='active'?t('Start a discussion in this Circle…','ابدأ نقاشًا في هذا المجتمع…'):t('Join to participate','انضم للمشاركة')}</button></div><div class="feed" style="margin-top:16px">${posts.length?posts.slice(0,10).map(postCard).join(''):emptyState(t('No Circle posts yet','لا توجد منشورات بعد'),query?t('No posts match your search.','لا توجد منشورات مطابقة للبحث.'):mine?.status==='active'?t('Start the first discussion.','ابدأ أول نقاش.'):t('Join to follow the conversation.','انضم لمتابعة النقاش.'))}</div></div><aside class="circle-panel"><h3>${t('About this Circle','عن المجتمع')}</h3><p>${esc(c.description)}</p><p><b>${t('Category','التصنيف')}:</b> ${esc(c.category)}</p><p><b>${t('Created','تاريخ الإنشاء')}:</b> ${formatDate(c.created_at)}</p></aside></div>`;
  if(state.circleTab==='posts')return `${search}<div class="page-title"><div><h2>${t('Circle posts','منشورات المجتمع')}</h2><p>${posts.length} ${t('results','نتيجة')}</p></div>${mine?.status==='active'?`<button class="primary" data-circle-compose>${t('+ New post','+ منشور جديد')}</button>`:''}</div><div class="feed">${posts.length?posts.map(postCard).join(''):emptyState(t('No posts found','لا توجد منشورات'),query?t('Try a different search.','جرّب بحثًا مختلفًا.'):t('Start the first discussion.','ابدأ أول نقاش.'))}</div>`;
  if(state.circleTab==='chat'){const msgs=state.circleMessages.filter(m=>same(m.circle_id,c.id)&&match(query,m.body,m.profile?.full_name));return `<section class="circle-panel circle-chat dm-like-circle-chat"><div class="chat-head circle-chat-head"><button class="round-btn circle-chat-back" data-circle-tab="home" aria-label="${t('Back to Circle','العودة للمجتمع')}">←</button><div class="circle-chat-mark">${esc(initials(c.name)||'C')}</div><div class="circle-chat-title"><b>${esc(c.name)}</b><small>${t('Circle chat','دردشة المجتمع')} · ${members.length} ${t('members','أعضاء')}</small></div></div><div class="chat-flow" id="circleChatFlow">${msgs.length?msgs.map((m,i)=>circleMessageBubble(m,msgs[i-1])).join(''):emptyState(t('No messages yet','لا توجد رسائل بعد'),t('Send the first message.','أرسل أول رسالة.'))}</div>${circleReplyComposer(c.id)}${mine?.status==='active'&&mine.status!=='muted'?`<form class="chat-form" id="circleChatForm"><input id="circleChatInput" required maxlength="4000" autocomplete="off" placeholder="${t('Write a message…','اكتب رسالة…')}" dir="auto" value="${esc(getCircleDraft(c.id))}"><button aria-label="${t('Send','إرسال')}">→</button></form>`:`<div class="empty"><b>${t('Members only','للأعضاء فقط')}</b><span>${t('Join the Circle to chat.','انضم للمجتمع للمشاركة في الدردشة.')}</span></div>`}</section>`}
  if(state.circleTab==='meetings'){const meetings=state.circleMeetings.filter(m=>same(m.circle_id,c.id)&&!m.cancelled_at&&match(query,m.title,m.description,m.creator?.full_name));return `${search}<div class="page-title"><div><h2>${t('Online meetings','الاجتماعات الأونلاين')}</h2><p>${t('Secure in-browser video rooms powered by LiveKit.','غرف فيديو آمنة داخل المنصة عبر LiveKit.')}</p></div>${canModerateCircle(c.id)?`<button class="primary" data-new-meeting>${t('+ Schedule meeting','+ جدولة اجتماع')}</button>`:''}</div>${state.dataErrors.meetings?`<div class="error-state"><b>${t('Meetings could not refresh.','تعذر تحديث الاجتماعات.')}</b><span>${t('Your last loaded meetings are still shown. Try again.','تظل آخر اجتماعات تم تحميلها ظاهرة. حاول مرة أخرى.')}</span><button class="secondary" data-retry-meetings>${t('Try again','إعادة المحاولة')}</button></div>`:''}<div class="meeting-grid">${meetings.length?meetings.map(meetingCard).join(''):!state.dataErrors.meetings?emptyState(t('No meetings yet','لا توجد اجتماعات بعد'),query?t('Try another search.','جرّب بحثًا آخر.'):canModerateCircle(c.id)?t('Schedule the first meeting.','جدول أول اجتماع.'):t('Circle moderators schedule meetings here.','يقوم مشرفو المجتمع بجدولة الاجتماعات هنا.')):''}</div>`}
  if(state.circleTab==='members')return `${search}<div class="page-title"><div><h2>${t('Members','الأعضاء')}</h2><p>${filteredMembers.length} ${t('active members','عضو نشط')}</p></div></div><div class="result-list">${filteredMembers.length?filteredMembers.map(m=>`<div class="result-row">${profileAvatar(m.profile||profileData(m.user_id))}<div><h3><button class="author-link" data-open-profile="${m.user_id}">${esc(m.profile?.full_name||'Student')}</button></h3><p>@${esc(m.profile?.username||'student')} · ${esc(m.profile?.grade||'')} · ${esc(m.profile?.branch||'')}</p></div><div class="identity-line"><span class="role-pill ${m.role}">${esc(m.role)}</span>${canManageCircle(c.id)&&!same(m.user_id,authUser.id)&&m.role!=='owner'?`<select data-member-role="${m.user_id}"><option value="member" ${m.role==='member'?'selected':''}>Member</option><option value="moderator" ${m.role==='moderator'?'selected':''}>Moderator</option><option value="admin" ${m.role==='admin'?'selected':''}>Admin</option></select><button class="secondary danger" data-remove-member="${m.user_id}">${t('Remove','إزالة')}</button>`:''}</div></div>`).join(''):emptyState(t('No members found','لا يوجد أعضاء'),t('Try another search.','جرّب بحثًا آخر.'))}</div>`;
  return `<section class="circle-panel circle-about"><header class="circle-about-head"><h2>${t('About this Circle','حول هذا المجتمع')}</h2><p>${esc(c.description||t('A student community for learning and collaboration.','مجتمع طلابي للتعلم والتعاون.'))}</p></header><dl class="circle-facts"><div class="circle-fact"><dt>${t('Category','التصنيف')}</dt><dd>${esc(c.category)}</dd></div><div class="circle-fact"><dt>${t('Privacy','الخصوصية')}</dt><dd>${c.privacy==='private'?t('Private','خاص'):t('Public','عام')}</dd></div><div class="circle-fact"><dt>${t('Owner','المالك')}</dt><dd>${esc(profileData(c.owner_id).full_name||'Student')}</dd></div></dl>${canManageCircle(c.id)?`<div class="circle-management"><div><h3>${t('Circle management','إدارة المجتمع')}</h3><p>${t('Manage roles from Members, or permanently delete this Circle and its community data.','أدر الأدوار من تبويب الأعضاء، أو احذف هذا المجتمع وبياناته نهائيًا.')}</p></div><button class="secondary danger" data-delete-circle="${c.id}">${t('Delete Circle','حذف المجتمع')}</button></div>`:''}</section>`
}

function meetingInviteLink(m){return `${location.origin}${location.pathname}#/circles/${encodeURIComponent(m.circle_id)}/meetings?meeting=${encodeURIComponent(m.id)}`}
async function copyMeetingInvite(m){if(!m)return;const link=meetingInviteLink(m);try{await navigator.clipboard.writeText(link);toast(t('Meeting invitation link copied.','تم نسخ رابط دعوة الاجتماع.'))}catch{window.prompt(t('Copy meeting invitation link','انسخ رابط دعوة الاجتماع'),link)}}

function meetingCard(m){const d=new Date(m.starts_at),day=new Intl.DateTimeFormat(state.lang==='ar'?'ar-EG':'en-GB',{day:'2-digit'}).format(d),month=new Intl.DateTimeFormat(state.lang==='ar'?'ar-EG':'en-GB',{month:'short'}).format(d),manageable=same(m.creator_id,authUser.id)||canModerateCircle(m.circle_id),canJoin=membership(m.circle_id)?.status==='active'||state.isAdmin,ended=!!m.ended_at,endAt=d.getTime()+Number(m.duration_minutes||60)*60000,live=!ended&&Date.now()>=d.getTime()&&Date.now()<endAt,status=ended?t('Ended','انتهى'):live?t('Live','مباشر'):t('Upcoming','قادم');return `<article class="meeting-card ${ended?'ended':''}" data-meeting-card="${esc(m.id)}"><time class="meeting-date" datetime="${esc(m.starts_at)}"><b>${day}</b><span>${month}</span></time><div><div class="meeting-card-title"><h3>${esc(m.title)}</h3><span class="status-pill ${live?'live':''}">${status}</span></div><p>${esc(m.description||t('Circle video meeting','اجتماع فيديو للمجتمع'))}</p><p>${when(m.starts_at)} · ${m.duration_minutes} ${t('min','دقيقة')} · ${t('by','بواسطة')} ${esc(m.creator?.full_name||profileData(m.creator_id).full_name)}</p><div class="meeting-actions">${canJoin&&!ended?`<button class="primary" data-join-meeting="${m.id}">${t('Join meeting','دخول الاجتماع')}</button>`:!canJoin&&!ended?`<button class="secondary" data-v6-circle-join="${m.circle_id}">${t('Join Circle to attend','انضم للمجتمع للحضور')}</button>`:''}<button class="secondary" data-copy-meeting-invite="${m.id}">${t('Invite link','رابط الدعوة')}</button>${manageable&&!ended&&live?`<button class="secondary danger" data-end-meeting="${m.id}">${t('End meeting','إنهاء الاجتماع')}</button>`:''}${manageable&&!live?`<button class="secondary danger" data-delete-meeting="${m.id}">${t('Delete','حذف')}</button>`:''}</div></div></article>`}
function circleMessageBubble(m,previous){const mine=same(m.sender_id,authUser.id),manageable=mine||canModerateCircle(m.circle_id),grouped=previous&&same(previous.sender_id,m.sender_id)&&(new Date(m.created_at)-new Date(previous.created_at)<300000),quoted=m.reply_to_id?state.circleMessages.find(x=>same(x.id,m.reply_to_id)):null,sender=m.profile||profileData(m.sender_id),quote=quoted?(()=>{const qp=quoted.profile||profileData(quoted.sender_id);return `<div class="message-reply-quote"><b>${esc(qp?.full_name||t('Student','طالب'))}</b><span dir="auto">${esc(quoted.deleted_at?t('Message deleted','تم حذف الرسالة'):quoted.body||t('Message','رسالة'))}</span></div>`})():'';return `<div class="chat-message circle-message ${mine?'mine':''} ${grouped?'grouped':''} ${m.deleted_at?'deleted':''}" data-message-id="${esc(m.id)}" data-circle-message-id="${esc(m.id)}" data-message-deletable="${manageable?'1':'0'}">${profileAvatar(sender)}<div class="circle-message-stack">${!mine&&!grouped?`<button class="circle-message-author author-link" data-open-profile="${m.sender_id}">${esc(sender?.full_name||t('Student','طالب'))}</button>`:''}<span class="bubble ${mine?'mine':''}">${quote}<span class="message-text" dir="auto">${m.deleted_at?t('Message deleted','تم حذف الرسالة'):esc(m.body)}</span><time>${when(m.created_at)}${m.edited_at?` · ${t('edited','معدلة')}`:''}</time>${!m.deleted_at?`<button type="button" class="message-actions-trigger" data-message-actions-trigger aria-label="${t('Message actions','خيارات الرسالة')}">•••</button>`:''}</span></div></div>`}
function confirmAction(title,copy){return new Promise(resolve=>{openModal(`<div class="modal-head"><div><h2>${esc(title)}</h2><p>${esc(copy)}</p></div><button class="close" data-confirm-no>×</button></div><p class="confirm-copy">${t('This action is saved to the database and cannot be undone.','سيُحفظ هذا الإجراء في قاعدة البيانات ولا يمكن التراجع عنه.')}</p><div class="modal-actions"><button class="secondary" data-confirm-no>${t('Cancel','إلغاء')}</button><button class="primary danger" data-confirm-yes>${t('Delete','حذف')}</button></div>`);$$('[data-confirm-no]').forEach(b=>b.onclick=()=>{closeModal();resolve(false)});$('[data-confirm-yes]').onclick=()=>{closeModal();resolve(true)}})}
async function removeMediaUrl(url){if(!url)return;const marker='/storage/v1/object/public/community-media/',i=url.indexOf(marker);if(i<0)return;const path=decodeURIComponent(url.slice(i+marker.length));if(path)await sb.storage.from('community-media').remove([path])}
async function deletePost(id){const p=byId(state.posts,id);if(!p||!await confirmAction(t('Delete post?','حذف المنشور؟'),p.title))return;const {error}=await sb.from('posts').delete().eq('id',id);if(error){toast(safeError(error,'delete this post'));return}await removeMediaUrl(p.image_url);await loadLiveData();render();toast(t('Post deleted.','تم حذف المنشور.'))}
async function deleteGalleryItem(id){const g=byId(state.gallery,id);if(!g||!await confirmAction(t('Delete gallery item?','حذف عنصر المعرض؟'),(g.caption_en||g.caption_ar||t('This image','هذه الصورة'))))return;const {error}=await sb.from('gallery_items').delete().eq('id',id);if(error){toast(safeError(error,'delete this gallery item'));return}await removeMediaUrl(g.image_url);await loadLiveData();render();toast(t('Gallery item deleted.','تم حذف عنصر المعرض.'))}
async function deleteArticle(id){const a=byId(state.articles,id);if(!a||!await confirmAction(t('Delete article?','حذف المقال؟'),a.title_en||a.title_ar))return;const {error}=await sb.from('articles').delete().eq('id',id);if(error){toast(safeError(error,'delete this article'));return}await removeMediaUrl(a.cover_url);await loadLiveData();render();toast(t('Article deleted.','تم حذف المقال.'))}
async function deleteCircleMessage(id){const m=byId(state.circleMessages,id);if(!m||!await confirmAction(t('Delete message?','حذف الرسالة؟'),t('It will remain as a deleted-message marker.','ستبقى علامة توضح أن الرسالة حُذفت.')))return;const {error}=await sb.from('circle_messages').update({body:'',deleted_at:new Date().toISOString()}).eq('id',id);if(error){toast(safeError(error,'delete this message'));return}await loadLiveData();render()}
async function deleteDirectMessage(id){const m=byId(state.liveMessages,id);if(!m||(!same(m.sender_id,authUser.id)&&!state.isAdmin)||!await confirmAction(t('Permanently delete message?','حذف الرسالة نهائيًا؟'),t('The message will disappear for everyone and cannot be restored.','ستختفي الرسالة لدى الجميع ولا يمكن استعادتها.')))return;const messageId=String(id||'').trim();if(!messageId){toast(t('This message could not be identified.','تعذر تحديد هذه الرسالة.'));return}const {data,error}=await sb.rpc('delete_direct_message',{message_id_input:messageId});if(error||!data){toast(error?safeError(error,'delete this message'):t('This message could not be deleted.','تعذر حذف هذه الرسالة.'));return}state.liveMessages=state.liveMessages.filter(item=>!same(item.id,messageId));render();toast(t('Message permanently deleted.','تم حذف الرسالة نهائيًا.'))}
async function deleteConversation(id){if(!id||!await confirmAction(t('Permanently delete this chat?','حذف هذه المحادثة نهائيًا؟'),t('The complete conversation and all of its messages will be removed for both people. This cannot be undone.','ستُحذف المحادثة كاملةً بكل رسائلها لدى الطرفين، ولا يمكن التراجع عن ذلك.')))return;const {data,error}=await sb.rpc('delete_direct_conversation',{conversation_id_input:id});if(error||!data){toast(error?safeError(error,'delete this chat'):t('This chat could not be deleted.','تعذر حذف هذه المحادثة.'));return}state.activeConversationId='';state.conversations=state.conversations.filter(item=>!same(item.id,id));state.conversationMembers=state.conversationMembers.filter(item=>!same(item.conversation_id,id));state.liveMessages=state.liveMessages.filter(item=>!same(item.conversation_id,id));routeTo('messages',true);toast(t('Chat permanently deleted.','تم حذف المحادثة نهائيًا.'))}
async function deleteMeeting(id){const m=byId(state.circleMeetings,id);if(!m||!await confirmAction(t('Delete meeting?','حذف الاجتماع؟'),t('The scheduled meeting will be removed permanently.','سيتم حذف الاجتماع المجدول نهائيًا.')))return;const {error}=await sb.from('circle_meetings').delete().eq('id',id);if(error){toast(safeError(error,'delete this meeting'));return}await loadLiveData();render();toast(t('Meeting deleted.','تم حذف الاجتماع.'))}
async function endMeeting(id){const m=byId(state.circleMeetings,id);if(!m||!await confirmAction(t('End meeting for everyone?','إنهاء الاجتماع للجميع؟'),t('Participants will be disconnected and nobody can rejoin.','سيتم فصل المشاركين ولن يتمكن أحد من الدخول مرة أخرى.')))return;const {data,error}=await sb.rpc('end_circle_meeting',{meeting_id_input:id});if(error||!data){toast(error?safeError(error,'end this meeting'):t('Meeting could not be ended.','تعذر إنهاء الاجتماع.'));return}await loadLiveData();render();toast(t('Meeting ended.','تم إنهاء الاجتماع.'))}
async function deleteCircle(id){const c=byId(state.circleRows,id);if(!c||!canManageCircle(id)||!await confirmAction(t('Delete Circle?','حذف المجتمع؟'),t('Its chat, memberships and meetings will be removed. Circle posts will remain in the main community.','ستُحذف الدردشة والعضويات والاجتماعات، وستبقى منشورات المجتمع في المنصة الرئيسية.')))return;const button=document.querySelector(`[data-delete-circle="${CSS.escape(String(id))}"]`);if(button)button.disabled=true;let {data,error}=await sb.rpc('delete_circle',{target_circle:id});if(error&&String(error.message||'').includes('Could not find the function')){const direct=await sb.from('circles').delete().eq('id',id).select('id');error=direct.error;data=direct.data?.length>0}if(error||data!==true){if(button)button.disabled=false;toast(safeError(error||new Error('circle_delete_failed'),'delete this Circle'));return}state.circleRows=state.circleRows.filter(x=>!same(x.id,id));state.circleMembers=state.circleMembers.filter(x=>!same(x.circle_id,id));state.circleMessages=state.circleMessages.filter(x=>!same(x.circle_id,id));state.circleMeetings=state.circleMeetings.filter(x=>!same(x.circle_id,id));state.posts=state.posts.map(p=>same(p.circle_id,id)?{...p,circle_id:null}:p);state.activeCircleId=null;routeTo('circles');await loadLiveData();toast(t('Circle deleted.','تم حذف المجتمع.'))}
function scheduleMeeting(){const c=byId(state.circleRows,state.activeCircleId);if(!c||!canModerateCircle(c.id)){toast(t('Only Circle moderators can schedule meetings.','يمكن لمشرفي المجتمع فقط جدولة الاجتماعات.'));return}openModal(`<div class="modal-head"><div><h2>${t('Schedule a meeting','جدولة اجتماع')}</h2><p>${esc(c.name)} · LiveKit Cloud</p></div><button class="close" data-close>×</button></div><form id="meetingForm"><label class="field">${t('Title','العنوان')}<input id="meetingTitle" required minlength="3" maxlength="120"></label><label class="field">${t('Description','الوصف')}<textarea id="meetingDescription" rows="3" maxlength="1000"></textarea></label><div class="row"><label class="field">${t('Date and time','التاريخ والوقت')}<input id="meetingStart" type="datetime-local" required></label><label class="field">${t('Duration','المدة')}<select id="meetingDuration"><option value="30">30 ${t('minutes','دقيقة')}</option><option value="60" selected>60 ${t('minutes','دقيقة')}</option><option value="90">90 ${t('minutes','دقيقة')}</option><option value="120">120 ${t('minutes','دقيقة')}</option></select></label></div><div class="modal-actions"><button type="button" class="secondary" data-close>${t('Cancel','إلغاء')}</button><button class="primary">${t('Create meeting','إنشاء الاجتماع')}</button></div></form>`);const input=$('#meetingStart'),minimum=new Date(Date.now()+5*60000);minimum.setMinutes(minimum.getMinutes()-minimum.getTimezoneOffset());input.min=minimum.toISOString().slice(0,16);input.value=minimum.toISOString().slice(0,16);$('#meetingForm').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;const starts=new Date(input.value);if(starts.getTime()<Date.now()){toast(t('Choose a future time.','اختر وقتًا في المستقبل.'));button.disabled=false;return}const {data,error}=await sb.rpc('create_circle_meeting',{circle_id_input:c.id,title_input:$('#meetingTitle').value.trim(),description_input:$('#meetingDescription').value.trim(),starts_at_input:starts.toISOString(),duration_minutes_input:Number($('#meetingDuration').value)});if(error||!data){toast(error?safeError(error,'create this meeting'):t('Meeting could not be created.','تعذر إنشاء الاجتماع.'));button.disabled=false;return}const {data:created,error:verifyError}=await sb.from('circle_meetings').select('*,creator:profiles(id,full_name,username,avatar_url)').eq('id',data).maybeSingle();if(verifyError||!created){console.error('[NEIS meeting create verification]',verifyError||new Error('meeting_row_missing'));closeModal();await loadLiveData();render();toast(t('The meeting was created but could not be verified. Refresh before trying again.','تم إنشاء الاجتماع لكن تعذر التحقق منه. حدّث الصفحة قبل المحاولة مرة أخرى.'));return}state.circleMeetings=[created,...state.circleMeetings.filter(m=>!same(m.id,created.id))];state.dataErrors.meetings=null;closeModal();render();toast(t('Meeting scheduled.','تمت جدولة الاجتماع.'));await loadLiveData();render()}}

function loadLiveKit(){if(!liveKitModulePromise)liveKitModulePromise=import('https://cdn.jsdelivr.net/npm/livekit-client@2.21.0/+esm');return liveKitModulePromise}
function previewStream(runtime){if(!runtime.previewStream)runtime.previewStream=new MediaStream();return runtime.previewStream}
function stopPreviewKind(runtime,kind,invalidate=true){if(!runtime)return;if(invalidate){const requestKey=`${kind}RequestId`;runtime[requestKey]=(runtime[requestKey]||0)+1}if(!runtime.previewStream)return;const tracks=kind==='video'?runtime.previewStream.getVideoTracks():runtime.previewStream.getAudioTracks();tracks.forEach(track=>{runtime.previewStream.removeTrack(track);track.stop()});setPrejoinState(runtime)}
function stopPreview(runtime){if(!runtime)return;runtime.previewStream?.getTracks().forEach(track=>track.stop());runtime.previewStream=null;const video=$('#meetingPreview');if(video)video.srcObject=null}
function detachMeetingMedia(runtime){if(!runtime?.room)return;const participants=[runtime.room.localParticipant,...runtime.room.remoteParticipants.values()];participants.forEach(participant=>participant.trackPublications.forEach(publication=>publication.track?.detach().forEach(element=>element.remove())))}
function removeFloatingMeeting(runtime){if(!runtime)return;if(runtime.floatingTrack&&runtime.floatingVideo){try{runtime.floatingTrack.detach(runtime.floatingVideo)}catch{}}runtime.floatingTrack=null;runtime.floatingVideo=null;runtime.floatingElement?.remove();runtime.floatingElement=null;document.body.classList.remove('meeting-minimized')}
async function cleanupLiveKitMeeting(runtime=activeMeetingRuntime){if(!runtime)return;if(activeMeetingRuntime===runtime)activeMeetingRuntime=null;window.removeEventListener('hashchange',runtime.navigationHandler);if(runtime.pageHideHandler)window.removeEventListener('pagehide',runtime.pageHideHandler);window.removeEventListener('resize',runtime.resizeHandler);stopPreview(runtime);removeFloatingMeeting(runtime);detachMeetingMedia(runtime);runtime.audioElementHost?.remove();runtime.audioElementHost=null;if(runtime.channel){await sb.removeChannel(runtime.channel).catch(()=>{});runtime.channel=null}if(runtime.room){try{runtime.room.localParticipant.trackPublications.forEach(publication=>publication.track?.stop());runtime.room.removeAllListeners();await runtime.room.disconnect()}catch(error){console.warn('[NEIS meeting cleanup]',error)}runtime.room=null}document.body.classList.remove('meeting-open')}
const baseCloseModal=closeModal;
closeModal=function(){if(activeMeetingRuntime&&document.querySelector('#modalRoot .livekit-meeting-modal'))return;baseCloseModal()};

function lockMeetingModal(){const modal=document.querySelector('#modalRoot .modal'),backdrop=document.querySelector('#modalRoot .backdrop');modal?.classList.add('livekit-meeting-modal');if(backdrop){backdrop.removeAttribute('data-close');backdrop.onclick=event=>{event.preventDefault();event.stopPropagation()}}}
async function cancelPrejoin(runtime){if(runtime!==activeMeetingRuntime||runtime.room)return;await cleanupLiveKitMeeting(runtime);baseCloseModal()}
async function leaveLiveKitMeeting(runtime=activeMeetingRuntime){if(!runtime)return;await cleanupLiveKitMeeting(runtime);baseCloseModal()}

function prejoinMarkup(m){const studentName=state.profile?.name||authUser?.user_metadata?.full_name||t('Student','طالب'),studentInitials=initials(studentName)||'NC';return `<section class="livekit-shell"><header class="livekit-head"><div><h2>${esc(m.title)}</h2><p>${when(m.starts_at)} · ${m.duration_minutes} ${t('minutes','دقيقة')}</p></div><button class="close" data-meeting-close aria-label="${t('Close meeting','إغلاق الاجتماع')}">×</button></header><div class="livekit-prejoin"><div class="livekit-preview"><video id="meetingPreview" autoplay muted playsinline></video><div class="livekit-preview-copy"><div class="livekit-preview-avatar">${esc(studentInitials)}</div><strong>${esc(studentName)}</strong><span>${t('Camera off','الكاميرا متوقفة')}</span></div></div><div class="livekit-prejoin-panel"><h3>${t('Ready to join?','هل أنت مستعد للدخول؟')}</h3><p id="meetingDeviceNote">${t('Choose your camera and microphone before entering.','اختر الكاميرا والميكروفون قبل الدخول.')}</p><div class="livekit-device-row"><button type="button" class="livekit-device-toggle" data-preview-mic aria-pressed="true">${t('Microphone on','الميكروفون يعمل')}</button><button type="button" class="livekit-device-toggle" data-preview-camera aria-pressed="true">${t('Camera on','الكاميرا تعمل')}</button></div><label class="livekit-select">${t('Microphone','الميكروفون')}<select id="meetingMicSelect"></select></label><label class="livekit-select">${t('Camera','الكاميرا')}<select id="meetingCameraSelect"></select></label><div class="livekit-prejoin-actions"><button type="button" class="secondary" data-meeting-close>${t('Cancel','إلغاء')}</button><button type="button" class="primary" data-enter-meeting>${t('Join meeting','دخول الاجتماع')}</button></div></div></div></section>`}

function setPrejoinState(runtime){const video=$('#meetingPreview'),preview=$('.livekit-preview'),mic=$('[data-preview-mic]'),camera=$('[data-preview-camera]'),videoTrack=runtime.previewStream?.getVideoTracks()[0],audioTrack=runtime.previewStream?.getAudioTracks()[0];if(video){if(videoTrack){if(video.srcObject!==runtime.previewStream)video.srcObject=runtime.previewStream||null;video.play?.().catch(()=>{})}else{video.pause?.();video.srcObject=null;video.removeAttribute('src');video.load?.()}}preview?.classList.toggle('has-video',!!videoTrack);if(mic){mic.setAttribute('aria-pressed',String(!!audioTrack));mic.textContent=audioTrack?t('Microphone on','الميكروفون يعمل'):t('Microphone off','الميكروفون متوقف')}if(camera){camera.setAttribute('aria-pressed',String(!!videoTrack));camera.textContent=videoTrack?t('Camera on','الكاميرا تعمل'):t('Camera off','الكاميرا متوقفة')}}
async function refreshPreviewDevices(runtime){const devices=await navigator.mediaDevices?.enumerateDevices().catch(()=>[])||[],mic=$('#meetingMicSelect'),camera=$('#meetingCameraSelect'),audioId=runtime.previewStream?.getAudioTracks()[0]?.getSettings().deviceId||runtime.selectedMicId||'',videoId=runtime.previewStream?.getVideoTracks()[0]?.getSettings().deviceId||runtime.selectedCameraId||'';runtime.selectedMicId=audioId;runtime.selectedCameraId=videoId;if(mic){mic.innerHTML=devices.filter(device=>device.kind==='audioinput').map((device,index)=>`<option value="${esc(device.deviceId)}">${esc(device.label||`${t('Microphone','ميكروفون')} ${index+1}`)}</option>`).join('')||`<option value="">${t('No microphone','لا يوجد ميكروفون')}</option>`;if([...mic.options].some(option=>option.value===audioId))mic.value=audioId}if(camera){camera.innerHTML=devices.filter(device=>device.kind==='videoinput').map((device,index)=>`<option value="${esc(device.deviceId)}">${esc(device.label||`${t('Camera','كاميرا')} ${index+1}`)}</option>`).join('')||`<option value="">${t('No camera','لا توجد كاميرا')}</option>`;if([...camera.options].some(option=>option.value===videoId))camera.value=videoId}}
const nativeMeetingPermissionWaiters=new Map();
window.neisMeetingNativePermissionResult=function(kind,granted,canAskAgain){
  const key=kind==='camera'?'camera':'microphone',waiter=nativeMeetingPermissionWaiters.get(key);
  if(!waiter)return;
  nativeMeetingPermissionWaiters.delete(key);
  waiter({granted:!!granted,canAskAgain:!!canAskAgain});
};
async function requestNativeMeetingPermission(kind){
  const bridge=window.NeisAndroid,key=kind==='video'||kind==='camera'?'camera':'microphone';
  if(!bridge?.requestMediaPermission||!bridge?.hasMediaPermission)return null;
  try{
    if(bridge.hasMediaPermission(key))return {granted:true,canAskAgain:true};
  }catch(_){return null}
  return await new Promise(resolve=>{
    const timer=setTimeout(()=>{nativeMeetingPermissionWaiters.delete(key);resolve({granted:false,canAskAgain:true,timeout:true})},20000);
    nativeMeetingPermissionWaiters.set(key,result=>{clearTimeout(timer);resolve(result)});
    try{bridge.requestMediaPermission(key)}catch(_){clearTimeout(timer);nativeMeetingPermissionWaiters.delete(key);resolve(null)}
  });
}
function meetingPermissionDenied(kind,result){
  const microphone=kind==='audio'||kind==='microphone';
  if(result&&!result.canAskAgain){
    $('#meetingDeviceNote')&&( $('#meetingDeviceNote').textContent=microphone
      ?t('Microphone permission is blocked. Enable Microphone for NEIS Circle in Android App settings.','إذن الميكروفون محظور. فعّل إذن الميكروفون لتطبيق NEIS Circle من إعدادات التطبيق في أندرويد.')
      :t('Camera permission is blocked. Enable Camera for NEIS Circle in Android App settings.','إذن الكاميرا محظور. فعّل إذن الكاميرا لتطبيق NEIS Circle من إعدادات التطبيق في أندرويد.') );
    toast(microphone?t('Microphone permission is blocked in Android settings.','إذن الميكروفون محظور في إعدادات أندرويد.'):t('Camera permission is blocked in Android settings.','إذن الكاميرا محظور في إعدادات أندرويد.'));
  }else{
    toast(microphone?t('Allow microphone access to turn it on.','اسمح بالوصول إلى الميكروفون لتشغيله.'):t('Allow camera access to turn it on.','اسمح بالوصول إلى الكاميرا لتشغيلها.'));
  }
}

async function acquirePreviewKind(runtime,kind,deviceId=''){if(runtime!==activeMeetingRuntime||!navigator.mediaDevices?.getUserMedia)return false;const isVideo=kind==='video',requestKey=`${kind}RequestId`,requestId=(runtime[requestKey]||0)+1;runtime[requestKey]=requestId;const getStream=async id=>{const constraint=id?{deviceId:{exact:id}}:isVideo?{width:{ideal:1280},height:{ideal:720},facingMode:{ideal:'user'}}:true;return navigator.mediaDevices.getUserMedia(isVideo?{video:constraint,audio:false}:{audio:constraint,video:false})};try{let stream;try{stream=await getStream(deviceId)}catch(firstError){if(!deviceId)throw firstError;console.warn('[NEIS meeting device fallback]',firstError);stream=await getStream('')}if(runtime!==activeMeetingRuntime||runtime[requestKey]!==requestId){stream.getTracks().forEach(track=>track.stop());return false}const track=isVideo?stream.getVideoTracks()[0]:stream.getAudioTracks()[0];if(!track)throw new Error('track_unavailable');stopPreviewKind(runtime,kind,false);previewStream(runtime).addTrack(track);if(isVideo)runtime.selectedCameraId=track.getSettings().deviceId||deviceId;else runtime.selectedMicId=track.getSettings().deviceId||deviceId;setPrejoinState(runtime);await refreshPreviewDevices(runtime);return true}catch(error){if(runtime!==activeMeetingRuntime||runtime[requestKey]!==requestId)return false;if(isVideo)runtime.cameraEnabled=false;else runtime.micEnabled=false;setPrejoinState(runtime);console.warn('[NEIS meeting device]',error);return false}}
async function togglePreviewKind(runtime,kind){const isVideo=kind==='video',button=$(isVideo?'[data-preview-camera]':'[data-preview-mic]'),enabled=isVideo?runtime.cameraEnabled:runtime.micEnabled;if(button)button.disabled=true;try{if(enabled){if(isVideo)runtime.cameraEnabled=false;else runtime.micEnabled=false;stopPreviewKind(runtime,kind);return}const nativePermission=await requestNativeMeetingPermission(kind);if(nativePermission&&!nativePermission.granted){meetingPermissionDenied(kind,nativePermission);return}if(isVideo)runtime.cameraEnabled=true;else runtime.micEnabled=true;const selectedId=nativePermission?.granted?'':(isVideo?runtime.selectedCameraId:runtime.selectedMicId);const ok=await acquirePreviewKind(runtime,kind,selectedId);if(!ok&&runtime===activeMeetingRuntime)toast(t('That device is unavailable or permission was not granted.','الجهاز غير متاح أو لم يتم منح الإذن.'))}finally{if(button?.isConnected)button.disabled=false}}
async function replacePreviewDevice(runtime,kind,deviceId){const isVideo=kind==='videoinput',select=$(isVideo?'#meetingCameraSelect':'#meetingMicSelect');if(isVideo)runtime.selectedCameraId=deviceId;else runtime.selectedMicId=deviceId;if((isVideo&&runtime.cameraEnabled)||(!isVideo&&runtime.micEnabled)){if(select)select.disabled=true;const ok=await acquirePreviewKind(runtime,isVideo?'video':'audio',deviceId);if(!ok&&runtime===activeMeetingRuntime)toast(t('That device is unavailable.','هذا الجهاز غير متاح.'));if(select?.isConnected)select.disabled=false}}
async function preparePreview(runtime){runtime.micEnabled=false;runtime.cameraEnabled=false;runtime.previewStream=new MediaStream();setPrejoinState(runtime);if(!navigator.mediaDevices?.getUserMedia){$('#meetingDeviceNote').textContent=t('This browser does not provide camera or microphone access. You may still join to listen.','هذا المتصفح لا يتيح الكاميرا أو الميكروفون، ويمكنك الدخول للاستماع.');return}await refreshPreviewDevices(runtime);const mic=$('#meetingMicSelect'),camera=$('#meetingCameraSelect');if(mic)mic.onchange=()=>replacePreviewDevice(runtime,'audioinput',mic.value);if(camera)camera.onchange=()=>replacePreviewDevice(runtime,'videoinput',camera.value)}

function updateMeetingStatus(text,kind=''){const el=$('#livekitStatus');if(el){el.textContent=text;el.className=`livekit-status ${kind}`}}
function meetingParticipants(runtime){return runtime?.room?[runtime.room.localParticipant,...runtime.room.remoteParticipants.values()]:[]}
function participantMediaState(participant){const mic=[...participant.audioTrackPublications.values()].some(pub=>pub.track&&!pub.isMuted),camera=[...participant.videoTrackPublications.values()].some(pub=>pub.track&&!pub.isMuted&&pub.source!=='screen_share');return {mic,camera}}
function renderMeetingParticipantList(runtime){const list=$('#livekitParticipantsList');if(!list||!runtime.room)return;const participants=meetingParticipants(runtime);list.innerHTML=participants.map(participant=>{const media=participantMediaState(participant),mine=participant===runtime.room.localParticipant,name=participant.name||participant.identity||t('Participant','مشارك');return `<div class="livekit-person"><div class="livekit-person-avatar">${esc(initials(name)||'NC')}</div><div><b>${esc(name)}${mine?` · ${t('You','أنت')}`:''}</b><small>${media.mic?t('Mic on','الميكروفون يعمل'):t('Mic off','الميكروفون متوقف')} · ${media.camera?t('Camera on','الكاميرا تعمل'):t('Camera off','الكاميرا متوقفة')}</small></div></div>`}).join('')}
function renderMeetingChat(runtime){const flow=$('#livekitChatFlow');if(!flow)return;const rows=runtime.chatMessages||[];flow.innerHTML=rows.length?rows.map(message=>`<div class="livekit-chat-message ${message.mine?'mine':''}"><b>${esc(message.sender||t('Participant','مشارك'))}</b><span dir="auto">${esc(message.text)}</span><small>${new Intl.DateTimeFormat(state.lang==='ar'?'ar-EG':'en-GB',{hour:'2-digit',minute:'2-digit'}).format(new Date(message.at||Date.now()))}</small></div>`).join(''):`<div class="livekit-chat-empty">${t('No messages yet.','لا توجد رسائل بعد.')}</div>`;flow.scrollTop=flow.scrollHeight}
function openMeetingPanel(runtime,panel){const side=$('#livekitSidePanel');if(!side)return;const samePanel=!side.classList.contains('hidden')&&side.dataset.panel===panel;side.classList.toggle('hidden',samePanel);if(samePanel){side.dataset.panel='';return}side.dataset.panel=panel;side.classList.remove('hidden');side.querySelectorAll('[data-meeting-panel-section]').forEach(section=>section.classList.toggle('hidden',section.dataset.meetingPanelSection!==panel));if(panel==='participants')renderMeetingParticipantList(runtime);if(panel==='chat')renderMeetingChat(runtime)}
async function sendMeetingChat(runtime){const input=$('#livekitChatInput'),button=$('#livekitChatForm button');if(!input||!runtime?.room)return;const textValue=input.value.trim();if(!textValue)return;button.disabled=true;try{const sender=runtime.room.localParticipant.name||state.profile?.name||authUser?.user_metadata?.full_name||t('You','أنت'),message={type:'meeting-chat',text:textValue,sender,at:Date.now()};await runtime.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)),{reliable:true,topic:'neis-meeting-chat'});runtime.chatMessages.push({...message,mine:true});input.value='';renderMeetingChat(runtime)}catch(error){console.error('[NEIS meeting chat]',error);toast(t('Message could not be sent.','تعذر إرسال الرسالة.'))}finally{if(button?.isConnected)button.disabled=false}}
function handleMeetingData(runtime,payload,participant,topic){if(topic&&topic!=='neis-meeting-chat')return;try{const message=JSON.parse(new TextDecoder().decode(payload));if(message?.type!=='meeting-chat'||!String(message.text||'').trim())return;runtime.chatMessages.push({type:'meeting-chat',text:String(message.text).slice(0,2000),sender:participant?.name||message.sender||t('Participant','مشارك'),at:Number(message.at)||Date.now(),mine:false});renderMeetingChat(runtime)}catch{}}
function renderMeetingParticipants(runtime){const grid=$('#livekitGrid');if(!grid||!runtime.room)return;grid.innerHTML='';const participants=meetingParticipants(runtime);let focusedStillAvailable=false;participants.forEach(participant=>{const publications=[...participant.videoTrackPublications.values()].filter(pub=>pub.track&&!pub.isMuted),screenPublication=publications.find(pub=>pub.source===runtime.lk.Track.Source.ScreenShare),selected=screenPublication||publications.find(pub=>pub.source===runtime.lk.Track.Source.Camera),isScreen=!!screenPublication,isFocused=isScreen&&runtime.focusedScreenIdentity===participant.identity;if(isFocused)focusedStillAvailable=true;const tile=document.createElement('article');tile.className=`livekit-tile ${participant===runtime.room.localParticipant?'local':''} ${isScreen?'screen':''} ${isFocused?'screen-focused':''} ${runtime.activeSpeakers?.has(participant.identity)?'active-speaker':''}`;tile.innerHTML=`<div class="livekit-tile-placeholder">${esc(initials(participant.name||participant.identity||'NC'))}</div><span class="livekit-participant-label">${esc(participant.name||participant.identity||t('Participant','مشارك'))}${participant===runtime.room.localParticipant?` · ${t('You','أنت')}`:''}</span>${isScreen?`<button class="livekit-screen-expand" type="button" aria-label="${isFocused?t('Exit full view','إنهاء العرض الكامل'):t('View shared screen full size','عرض الشاشة المشاركة بالكامل')}">${isFocused?'×':'⛶'}</button>`:''}`;if(selected?.track){const element=selected.track.attach();element.autoplay=true;element.playsInline=true;tile.prepend(element)}if(isScreen){tile.onclick=event=>{if(event.target.closest('.livekit-participant-label'))return;runtime.focusedScreenIdentity=isFocused?'':participant.identity;renderMeetingParticipants(runtime)}}grid.appendChild(tile)});if(runtime.focusedScreenIdentity&&!focusedStillAvailable)runtime.focusedScreenIdentity='';grid.classList.toggle('has-focused-screen',!!runtime.focusedScreenIdentity);const count=$('#livekitParticipantCount');if(count)count.textContent=`${participants.length} ${t(participants.length===1?'participant':'participants','مشارك')}`;renderMeetingParticipantList(runtime)}
function meetingAudioHolder(runtime){if(!runtime)return null;if(runtime.audioElementHost?.isConnected)return runtime.audioElementHost;const holder=document.createElement('div');holder.className='livekit-audio livekit-persistent-audio';holder.setAttribute('aria-hidden','true');document.body.appendChild(holder);runtime.audioElementHost=holder;return holder}
function renderMeetingAudio(runtime){const holder=meetingAudioHolder(runtime);if(!holder||!runtime.room)return;runtime.room.remoteParticipants.forEach(participant=>participant.audioTrackPublications.forEach(publication=>publication.track?.detach().forEach(element=>element.remove())));holder.innerHTML='';runtime.room.remoteParticipants.forEach(participant=>participant.audioTrackPublications.forEach(publication=>{if(publication.track&&!publication.isMuted){const audio=publication.track.attach();audio.autoplay=true;audio.playsInline=true;holder.appendChild(audio);audio.play?.().catch(()=>{})}}))}
function syncRoomMediaButtons(runtime){const mic=$('[data-room-mic]'),camera=$('[data-room-camera]');runtime.micEnabled=runtime.room.localParticipant.isMicrophoneEnabled;runtime.cameraEnabled=runtime.room.localParticipant.isCameraEnabled;if(mic){mic.setAttribute('aria-pressed',String(runtime.micEnabled));mic.querySelector('span').textContent=runtime.micEnabled?t('Mute','كتم'):t('Unmute','تشغيل الصوت')}if(camera){camera.setAttribute('aria-pressed',String(runtime.cameraEnabled));camera.querySelector('span').textContent=runtime.cameraEnabled?t('Camera off','إيقاف الكاميرا'):t('Camera on','تشغيل الكاميرا')}renderMeetingParticipantList(runtime)}
function bindRoomControls(runtime){$('[data-room-mic]').onclick=async event=>{const button=event.currentTarget,next=!runtime.room.localParticipant.isMicrophoneEnabled;button.disabled=true;try{if(next){const nativePermission=await requestNativeMeetingPermission('audio');if(nativePermission&&!nativePermission.granted){meetingPermissionDenied('audio',nativePermission);return}}await runtime.room.localParticipant.setMicrophoneEnabled(next);syncRoomMediaButtons(runtime);updateFloatingMeeting(runtime)}catch(error){toast(t('Microphone could not be changed. Check microphone permission.','تعذر تغيير حالة الميكروفون. تحقق من إذن الميكروفون.'))}finally{if(button.isConnected)button.disabled=false}};$('[data-room-camera]').onclick=async event=>{const button=event.currentTarget,next=!runtime.room.localParticipant.isCameraEnabled;button.disabled=true;try{await runtime.room.localParticipant.setCameraEnabled(next);syncRoomMediaButtons(runtime);renderMeetingParticipants(runtime);updateFloatingMeeting(runtime)}catch(error){toast(t('Camera could not be changed.','تعذر تغيير حالة الكاميرا.'))}finally{if(button.isConnected)button.disabled=false}};$('[data-room-screen]').onclick=async event=>{const button=event.currentTarget,next=!runtime.room.localParticipant.isScreenShareEnabled;button.disabled=true;try{await runtime.room.localParticipant.setScreenShareEnabled(next);button.setAttribute('aria-pressed',String(next));button.querySelector('span').textContent=next?t('Stop sharing','إيقاف المشاركة'):t('Share screen','مشاركة الشاشة')}catch(error){toast(t('Screen sharing is unavailable.','مشاركة الشاشة غير متاحة.'))}finally{if(button.isConnected)button.disabled=false}};$$('[data-room-panel]').forEach(button=>button.onclick=()=>openMeetingPanel(runtime,button.dataset.roomPanel));$('[data-room-invite]')?.addEventListener('click',()=>copyMeetingInvite(runtime.meeting));const chatForm=$('#livekitChatForm');if(chatForm)chatForm.onsubmit=event=>{event.preventDefault();sendMeetingChat(runtime)};$$('[data-room-minimize]').forEach(button=>button.onclick=()=>minimizeLiveKitMeeting(runtime));$('[data-room-leave]').onclick=()=>leaveLiveKitMeeting(runtime);const end=$('[data-room-end]');if(end)end.onclick=async()=>{if(!confirm(t('End this meeting for everyone?','إنهاء الاجتماع للجميع؟')))return;end.disabled=true;const {data,error}=await sb.rpc('end_circle_meeting',{meeting_id_input:runtime.meeting.id});if(error||!data){toast(error?safeError(error,'end this meeting'):t('Meeting could not be ended.','تعذر إنهاء الاجتماع.'));end.disabled=false;return}toast(t('Meeting ended.','تم إنهاء الاجتماع.'));await leaveLiveKitMeeting(runtime)}}
function roomMarkup(runtime){const micEnabled=runtime.room?.localParticipant.isMicrophoneEnabled??runtime.micEnabled,cameraEnabled=runtime.room?.localParticipant.isCameraEnabled??runtime.cameraEnabled;return `<section class="livekit-shell"><header class="livekit-head"><div><h2>${esc(runtime.meeting.title)}</h2><p><span id="livekitParticipantCount">1 ${t('participant','مشارك')}</span> · <span id="livekitStatus" class="livekit-status">${t('Connected','متصل')}</span></p></div><button class="livekit-minimize" data-room-minimize aria-label="${t('Minimize meeting','تصغير الاجتماع')}">—</button></header><div class="livekit-room"><div id="livekitGrid" class="livekit-grid"></div><div id="livekitAudio" class="livekit-audio"></div><aside id="livekitSidePanel" class="livekit-sidepanel hidden"><section data-meeting-panel-section="participants"><h3>${t('Participants','المشاركون')}</h3><div id="livekitParticipantsList" class="livekit-participants-list"></div></section><section class="hidden" data-meeting-panel-section="chat"><h3>${t('Meeting chat','دردشة الاجتماع')}</h3><div id="livekitChatFlow" class="livekit-chat-flow"></div><form id="livekitChatForm" class="livekit-chat-form"><input id="livekitChatInput" maxlength="2000" dir="auto" placeholder="${t('Message everyone…','اكتب للجميع…')}" required><button class="primary" aria-label="${t('Send','إرسال')}">→</button></form></section></aside><div class="livekit-controls"><button class="livekit-control" data-room-mic aria-pressed="${micEnabled}"><span>${micEnabled?t('Mute','كتم'):t('Unmute','تشغيل الصوت')}</span></button><button class="livekit-control" data-room-camera aria-pressed="${cameraEnabled}"><span>${cameraEnabled?t('Camera off','إيقاف الكاميرا'):t('Camera on','تشغيل الكاميرا')}</span></button><button class="livekit-control" data-room-screen aria-pressed="${runtime.room?.localParticipant.isScreenShareEnabled||false}"><span>${runtime.room?.localParticipant.isScreenShareEnabled?t('Stop sharing','إيقاف المشاركة'):t('Share screen','مشاركة الشاشة')}</span></button><button class="livekit-control" data-room-panel="participants"><span>${t('Participants','المشاركون')}</span></button><button class="livekit-control" data-room-panel="chat"><span>${t('Chat','الدردشة')}</span></button><button class="livekit-control" data-room-invite><span>${t('Invite','دعوة')}</span></button><button class="livekit-control" data-room-minimize><span>${t('Minimize','تصغير')}</span></button>${runtime.isModerator?`<button class="livekit-control danger" data-room-end><span>${t('End for all','إنهاء للجميع')}</span></button>`:''}<button class="livekit-control danger" data-room-leave><span>${t('Leave','مغادرة')}</span></button></div></div></section>`}

function floatingMeetingMarkup(runtime){return `<aside class="livekit-floating" role="dialog" aria-label="${t('Minimized meeting','اجتماع مصغر')}"><div class="livekit-floating-handle" data-meeting-drag><span></span><b>${esc(runtime.meeting.title)}</b></div><div class="livekit-floating-preview"><div class="livekit-floating-placeholder">${esc(initials(authUser?.user_metadata?.full_name||state.profile?.name||'NC'))}</div></div><div class="livekit-floating-state"><span data-floating-mic></span><span data-floating-camera></span></div><div class="livekit-floating-actions"><button class="primary" data-restore-meeting>${t('Return','العودة')}</button><button class="secondary danger" data-floating-leave>${t('Leave','مغادرة')}</button></div></aside>`}
function updateFloatingMeeting(runtime){const floating=runtime?.floatingElement;if(!floating||!runtime.room)return;const mic=runtime.room.localParticipant.isMicrophoneEnabled,camera=runtime.room.localParticipant.isCameraEnabled;floating.querySelector('[data-floating-mic]').textContent=mic?t('Mic on','الميكروفون يعمل'):t('Mic off','الميكروفون متوقف');floating.querySelector('[data-floating-camera]').textContent=camera?t('Camera on','الكاميرا تعمل'):t('Camera off','الكاميرا متوقفة');if(runtime.floatingTrack&&runtime.floatingVideo){try{runtime.floatingTrack.detach(runtime.floatingVideo)}catch{}}runtime.floatingTrack=null;runtime.floatingVideo=null;floating.querySelector('video')?.remove();const publication=[...runtime.room.localParticipant.videoTrackPublications.values()].find(item=>item.track&&!item.isMuted&&item.source===runtime.lk.Track.Source.Camera);if(publication?.track){const video=publication.track.attach();video.autoplay=true;video.muted=true;video.playsInline=true;floating.querySelector('.livekit-floating-preview').prepend(video);runtime.floatingTrack=publication.track;runtime.floatingVideo=video}}
function enableFloatingDrag(runtime){const floating=runtime.floatingElement,handle=floating?.querySelector('[data-meeting-drag]');if(!floating||!handle)return;handle.onpointerdown=event=>{if(event.button!==undefined&&event.button!==0)return;event.preventDefault();handle.setPointerCapture?.(event.pointerId);const rect=floating.getBoundingClientRect(),startX=event.clientX,startY=event.clientY,startLeft=rect.left,startTop=rect.top;const move=moveEvent=>{const maxLeft=Math.max(8,window.innerWidth-floating.offsetWidth-8),maxTop=Math.max(8,window.innerHeight-floating.offsetHeight-8),left=Math.min(maxLeft,Math.max(8,startLeft+moveEvent.clientX-startX)),top=Math.min(maxTop,Math.max(8,startTop+moveEvent.clientY-startY));floating.style.left=`${left}px`;floating.style.top=`${top}px`;floating.style.right='auto';floating.style.bottom='auto';runtime.floatPosition={left,top}};const end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end)};handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end)}}
function clampFloatingMeeting(runtime){const floating=runtime?.floatingElement;if(!floating)return;const rect=floating.getBoundingClientRect(),left=Math.min(Math.max(8,rect.left),Math.max(8,window.innerWidth-rect.width-8)),top=Math.min(Math.max(8,rect.top),Math.max(8,window.innerHeight-rect.height-8));if(rect.left!==left||rect.top!==top){floating.style.left=`${left}px`;floating.style.top=`${top}px`;floating.style.right='auto';floating.style.bottom='auto';runtime.floatPosition={left,top}}}
function minimizeLiveKitMeeting(runtime){if(runtime!==activeMeetingRuntime||!runtime.room||runtime.floatingElement)return;meetingParticipants(runtime).forEach(participant=>participant.videoTrackPublications.forEach(publication=>publication.track?.detach().forEach(element=>element.remove())));baseCloseModal();document.body.classList.remove('meeting-open');document.body.classList.add('meeting-minimized');document.body.insertAdjacentHTML('beforeend',floatingMeetingMarkup(runtime));runtime.floatingElement=document.querySelector('.livekit-floating');if(runtime.floatPosition){runtime.floatingElement.style.left=`${runtime.floatPosition.left}px`;runtime.floatingElement.style.top=`${runtime.floatPosition.top}px`;runtime.floatingElement.style.right='auto';runtime.floatingElement.style.bottom='auto'}runtime.floatingElement.querySelector('[data-restore-meeting]').onclick=()=>restoreLiveKitMeeting(runtime);runtime.floatingElement.querySelector('.livekit-floating-preview').onclick=()=>restoreLiveKitMeeting(runtime);runtime.floatingElement.querySelector('[data-floating-leave]').onclick=()=>leaveLiveKitMeeting(runtime);enableFloatingDrag(runtime);updateFloatingMeeting(runtime);renderMeetingAudio(runtime);clampFloatingMeeting(runtime)}
function restoreLiveKitMeeting(runtime){if(runtime!==activeMeetingRuntime||!runtime.room)return;removeFloatingMeeting(runtime);openModal(roomMarkup(runtime),true);lockMeetingModal();document.body.classList.add('meeting-open');bindRoomControls(runtime);renderMeetingParticipants(runtime);renderMeetingAudio(runtime);updateMeetingStatus(t('Connected','متصل'),'connected')}

async function enterLiveKitMeeting(runtime){const button=$('[data-enter-meeting]'),micId=runtime.selectedMicId||$('#meetingMicSelect')?.value||'',cameraId=runtime.selectedCameraId||$('#meetingCameraSelect')?.value||'';if(button){button.disabled=true;button.textContent=t('Connecting…','جارٍ الاتصال…')}try{const lkPromise=loadLiveKit();let {data:sessionData,error:sessionError}=await sb.auth.getSession();if(sessionError)throw sessionError;let session=sessionData?.session||null;const expiresSoon=!session?.access_token||!session?.expires_at||session.expires_at*1000-Date.now()<60000;if(expiresSoon){const refreshed=await sb.auth.refreshSession();if(refreshed.error||!refreshed.data?.session)throw new Error('session_refresh_failed');session=refreshed.data.session;authUser=session.user}const lk=await lkPromise;const result=await sb.functions.invoke('study-livekit-token',{body:{meeting_id:runtime.meeting.id},headers:{Authorization:`Bearer ${session.access_token}`}});if(result.error){let detail='';try{detail=(await result.error.context?.clone().json())?.error||''}catch{}throw new Error(detail||result.error.message||'token_failed')}const payload=result.data;if(!payload?.participant_token||!payload?.server_url)throw new Error(payload?.error||'token_unavailable');runtime.lk=lk;runtime.isModerator=!!payload.is_moderator;stopPreview(runtime);const shell=document.querySelector('#modalRoot .livekit-shell');if(!shell)throw new Error('meeting_closed');const room=new lk.Room({adaptiveStream:true,dynacast:true,disconnectOnPageLeave:false});runtime.room=room;runtime.activeSpeakers=new Set();shell.outerHTML=roomMarkup(runtime);const refresh=()=>{renderMeetingParticipants(runtime);updateFloatingMeeting(runtime)};room.on(lk.RoomEvent.ParticipantConnected,()=>{renderMeetingAudio(runtime);refresh()}).on(lk.RoomEvent.ParticipantDisconnected,()=>{renderMeetingAudio(runtime);refresh()}).on(lk.RoomEvent.TrackSubscribed,(track)=>{if(track.kind==='audio')renderMeetingAudio(runtime);refresh()}).on(lk.RoomEvent.TrackUnsubscribed,(track)=>{track.detach().forEach(element=>element.remove());if(track.kind==='audio')renderMeetingAudio(runtime);refresh()}).on(lk.RoomEvent.LocalTrackPublished,refresh).on(lk.RoomEvent.LocalTrackUnpublished,refresh).on(lk.RoomEvent.TrackMuted,refresh).on(lk.RoomEvent.TrackUnmuted,refresh).on(lk.RoomEvent.DataReceived,(payload,participant,kind,topic)=>handleMeetingData(runtime,payload,participant,topic)).on(lk.RoomEvent.ActiveSpeakersChanged,speakers=>{runtime.activeSpeakers=new Set(speakers.map(participant=>participant.identity));refresh()}).on(lk.RoomEvent.Reconnecting,()=>updateMeetingStatus(t('Reconnecting…','إعادة الاتصال…'))).on(lk.RoomEvent.Reconnected,()=>updateMeetingStatus(t('Connected','متصل'),'connected')).on(lk.RoomEvent.ConnectionStateChanged,stateValue=>updateMeetingStatus(String(stateValue),stateValue==='connected'?'connected':'')).on(lk.RoomEvent.Disconnected,()=>updateMeetingStatus(t('Disconnected','انقطع الاتصال'),'error'));if(lk.RoomEvent.MediaDevicesChanged)room.on(lk.RoomEvent.MediaDevicesChanged,()=>toast(t('Available media devices changed.','تم تغيير أجهزة الوسائط المتاحة.')));bindRoomControls(runtime);await room.connect(payload.server_url,payload.participant_token,{autoSubscribe:true});if(micId)await room.switchActiveDevice('audioinput',micId).catch(()=>{});if(cameraId)await room.switchActiveDevice('videoinput',cameraId).catch(()=>{});if(runtime.micEnabled)await room.localParticipant.setMicrophoneEnabled(true).catch(()=>{runtime.micEnabled=false});if(runtime.cameraEnabled)await room.localParticipant.setCameraEnabled(true).catch(()=>{runtime.cameraEnabled=false});syncRoomMediaButtons(runtime);updateMeetingStatus(t('Connected','متصل'),'connected');renderMeetingParticipants(runtime);renderMeetingAudio(runtime);runtime.channel=sb.channel(`livekit-meeting-${runtime.meeting.id}-${authUser.id}`).on('postgres_changes',{event:'*',schema:'public',table:'circle_meetings',filter:`id=eq.${runtime.meeting.id}`},payload=>{if(payload.eventType==='DELETE'||payload.new?.ended_at||payload.new?.cancelled_at){toast(t('This meeting has ended.','انتهى هذا الاجتماع.'));leaveLiveKitMeeting(runtime)}}).subscribe()}catch(error){console.error('[NEIS LiveKit]',error);const message=String(error?.message||''),grid=$('#livekitGrid');toast(message==='session_refresh_failed'?t('Your session could not be refreshed. Please sign in again.','تعذر تحديث جلستك. سجّل الدخول مرة أخرى.'):message&&message!=='token_failed'?message:t('Could not join the meeting. Please try again.','تعذر دخول الاجتماع. حاول مرة أخرى.'));if(grid){updateMeetingStatus(t('Connection failed','فشل الاتصال'),'error');grid.innerHTML=`<div class="empty"><b>${t('Could not connect','تعذر الاتصال')}</b><span>${t('Check your connection, then close and try again.','تحقق من الاتصال ثم أغلق النافذة وحاول مرة أخرى.')}</span><button class="secondary" data-room-leave>${t('Close','إغلاق')}</button></div>`;grid.querySelector('[data-room-leave]').onclick=()=>leaveLiveKitMeeting(runtime)}else if(button){button.disabled=false;button.textContent=t('Join meeting','دخول الاجتماع')}}}

async function joinMeeting(id){const cached=byId(state.circleMeetings,id);if(!cached||cached.ended_at)return;const {data:fresh,error}=await sb.from('circle_meetings').select('*,creator:profiles(id,full_name,username,avatar_url)').eq('id',id).maybeSingle();if(error){state.dataErrors.meetings=error;console.error('[NEIS meeting join verification]',error);toast(t('Meeting could not be verified. Check your connection and try again.','تعذر التحقق من الاجتماع. تحقق من الاتصال وحاول مرة أخرى.'));return}if(!fresh||fresh.cancelled_at||fresh.ended_at){state.circleMeetings=state.circleMeetings.filter(m=>!same(m.id,id));state.dataErrors.meetings=null;render();toast(t('This meeting is no longer available.','هذا الاجتماع لم يعد متاحًا.'));return}state.circleMeetings=state.circleMeetings.map(m=>same(m.id,id)?fresh:m);state.dataErrors.meetings=null;const m=fresh;await cleanupLiveKitMeeting();baseCloseModal();openModal(prejoinMarkup(m),true);lockMeetingModal();document.body.classList.add('meeting-open');const runtime={meeting:m,previewStream:null,micEnabled:false,cameraEnabled:false,selectedMicId:'',selectedCameraId:'',room:null,channel:null,lk:null,isModerator:false,chatMessages:[],focusedScreenIdentity:'',floatingElement:null,floatingTrack:null,floatingVideo:null,floatPosition:null,audioElementHost:null,pageHideHandler:null};runtime.navigationHandler=()=>{if(runtime!==activeMeetingRuntime)return;if(runtime.room)minimizeLiveKitMeeting(runtime);else cancelPrejoin(runtime)};runtime.resizeHandler=()=>clampFloatingMeeting(runtime);activeMeetingRuntime=runtime;window.addEventListener('hashchange',runtime.navigationHandler);window.addEventListener('resize',runtime.resizeHandler);$$('[data-meeting-close]').forEach(button=>button.onclick=()=>cancelPrejoin(runtime));$('[data-preview-mic]').onclick=()=>togglePreviewKind(runtime,'audio');$('[data-preview-camera]').onclick=()=>togglePreviewKind(runtime,'video');$('[data-enter-meeting]').onclick=()=>enterLiveKitMeeting(runtime);await preparePreview(runtime)}

galleryCard=function(g){const cap=(state.lang==='ar'?g.caption_ar:g.caption_en)||g.caption_en||g.caption_ar||t('Community moment','لحظة من المجتمع'),deletable=same(g.author_id,authUser.id)||state.isAdmin;return `<article class="gallery-card"><img src="${esc(g.image_url)}" alt="${esc(cap)}" loading="lazy" onerror="this.closest('article').classList.add('media-error');this.remove()"><div class="gallery-tools">${g.featured?`<span class="status-pill live">${t('Featured','مميز')}</span>`:''}${state.isAdmin&&!g.approved?`<button data-approve-gallery="${g.id}">${t('Approve','موافقة')}</button>`:''}${state.isAdmin?`<button data-feature-gallery="${g.id}">${g.featured?t('Unfeature','إلغاء التمييز'):t('Feature','تمييز')}</button>`:''}${deletable?`<button class="danger" data-delete-gallery="${g.id}">${t('Delete','حذف')}</button>`:''}</div><div class="gallery-copy"><div class="tag-row">${(g.tags||[]).slice(0,3).map(tag=>`<span>#${esc(tag)}</span>`).join('')}</div><h3>${esc(cap)}</h3><p>${esc(authorName(g.author))} · ${esc(authorMeta(g.author))}</p></div></article>`};
articleCard=function(a){const arabic=state.articleLanguage==='ar',title=(arabic?a.title_ar:a.title_en)||a.title_en||a.title_ar||t('Untitled','بدون عنوان'),excerpt=(arabic?a.excerpt_ar:a.excerpt_en)||a.excerpt_en||a.excerpt_ar||'',direction=articleTextDirection(title,excerpt),editable=same(a.author_id,authUser.id)||state.isAdmin;return `<article class="article-card"><div class="article-cover" style="background-image:${a.cover_url?`url('${esc(a.cover_url)}')`:mediaCardPlaceholder(title)}"></div><div class="article-copy"><div class="article-meta"><span class="post-kind">${a.status==='published'?t('Article','مقال'):t('Draft','مسودة')}</span><span>${formatDate(a.published_at||a.created_at)}</span></div><h3 dir="${direction}">${esc(title)}</h3><p dir="${direction}">${esc(excerpt)}</p><button class="author-link" data-author="${a.author_id}">${avatar({name:authorName(a.author),initials:initials(authorName(a.author)),color:'#006f5b'})}<span class="author-copy"><b>${esc(authorName(a.author))}</b><small>${esc(authorMeta(a.author))}</small></span></button><div class="article-actions"><button class="primary" data-read-article="${a.id}">${t('Read article','قراءة المقال')}</button>${editable?`<button class="secondary" data-edit-article="${a.id}">${t('Edit','تعديل')}</button><button class="secondary danger" data-delete-article="${a.id}">${t('Delete','حذف')}</button>`:''}</div></div></article>`};

newCircle=function(){if(!requireAccount())return;openModal(`<div class="modal-head"><div><h2>${t('Create a Circle','إنشاء مجتمع')}</h2><p>${t('Your Circle opens immediately and you become its owner.','يفتح المجتمع فورًا وتصبح أنت المالك.')}</p></div><button class="close" data-close>×</button></div><form id="createCircleForm"><label class="field">${t('Name','الاسم')}<input id="circleName" required minlength="3" maxlength="80"></label><label class="field">${t('Description','الوصف')}<textarea id="circleDescription" required rows="5" maxlength="1000"></textarea></label><div class="row"><label class="field">${t('Category','التصنيف')}<input id="circleCategory" value="General"></label><label class="field">${t('Privacy','الخصوصية')}<select id="circlePrivacy"><option value="public">${t('Public — anyone can view and join','عام — يمكن للجميع المشاهدة والانضمام')}</option><option value="private">${t('Private — membership requests','خاص — طلبات انضمام')}</option></select></label></div><div class="modal-actions"><button class="secondary" type="button" data-close>${t('Cancel','إلغاء')}</button><button id="createCircleSubmit" class="primary">${t('Create & open','إنشاء وفتح')}</button></div></form>`);$('#createCircleForm').onsubmit=async e=>{e.preventDefault();const button=$('#createCircleSubmit');button.disabled=true;button.textContent=t('Creating…','جارٍ الإنشاء…');const {data,error}=await sb.rpc('create_circle',{circle_name:$('#circleName').value.trim(),circle_description:$('#circleDescription').value.trim(),circle_category:$('#circleCategory').value.trim()||'General',circle_privacy:$('#circlePrivacy').value});if(error){toast(safeError(error,'create this Circle'));button.disabled=false;button.textContent=t('Create & open','إنشاء وفتح');return}const {data:created,error:readError}=await sb.from('circles').select('*').eq('id',data).single();if(readError||!created){toast(safeError(readError||new Error('circle_not_readable'),'open the new Circle'));button.disabled=false;button.textContent=t('Create & open','إنشاء وفتح');return}closeModal();await loadLiveData();if(!byId(state.circleRows,data))state.circleRows.unshift(created);routeTo(`circles/${data}/home`);toast(t('Circle created. You are the owner.','تم إنشاء المجتمع وأنت المالك.'))}}

function localSearchFallback(query){
  const q=normalize(query),score=(primary,...rest)=>{const first=normalize(primary);if(first===q)return 120;if(first.startsWith(q))return 100;if(first.includes(q))return 85;return rest.some(value=>normalize(value).includes(q))?55:0};
  const rows=[];
  state.members.forEach(p=>{const relevance=score(p.full_name,p.username,p.grade,p.branch,p.bio,p.interests);if(relevance)rows.push({type:'profile',id:String(p.id),title:p.full_name||t('NEIS Student','طالب NEIS'),subtitle:[p.username?`@${p.username}`:'',p.grade,p.branch].filter(Boolean).join(' · '),preview:p.bio||(p.interests||[]).join(' · '),created_at:null,relevance})});
  state.posts.forEach(p=>{const relevance=score(p.title,p.body,p.tags,p.kind,p.user);if(relevance)rows.push({type:'post',id:String(p.id),title:p.title||t('Post','منشور'),subtitle:[p.kind,p.user].filter(Boolean).join(' · '),preview:p.body||'',created_at:p.created_at||null,relevance})});
  state.circleRows.forEach(c=>{const relevance=score(c.name,c.description,c.category);if(relevance)rows.push({type:'circle',id:String(c.id),title:c.name,subtitle:[c.category,c.privacy==='private'?t('Private Circle','مجتمع خاص'):t('Public Circle','مجتمع عام')].filter(Boolean).join(' · '),preview:c.description||'',created_at:c.created_at||null,relevance})});
  return rows.sort((a,b)=>b.relevance-a.relevance||(new Date(b.created_at||0)-new Date(a.created_at||0))).slice(0,30);
}
async function performSearch(query,renderAfter=true){
  query=String(query||'').trim();const requestId=++searchRequestId;
  if(query.length<2){state.searchResults=[];state.searchLoading=false;state.dataErrors.search=null;if(state.view==='search')render();renderSuggestions();return}
  state.searchLoading=true;state.dataErrors.search=null;state.searchResults=[];
  if(renderAfter&&state.view==='search')render();else renderSuggestions();
  try{
    const request=sb?.rpc('global_search',{search_query:query,result_limit:30});
    if(!request)throw new Error('search_connection_unavailable');
    const {data,error}=await Promise.race([request,new Promise((_,reject)=>setTimeout(()=>reject(new Error('search_timeout')),10000))]);
    if(error)throw error;
    if(requestId!==searchRequestId)return;
    state.searchResults=Array.isArray(data)?data:[];state.dataErrors.search=null;
  }catch(error){
    if(requestId!==searchRequestId)return;
    const fallback=localSearchFallback(query);state.searchResults=fallback;
    state.dataErrors.search=state.platformReady?null:error;
    if(!state.platformReady)toast(safeError(error,'search'));
  }finally{
    if(requestId!==searchRequestId)return;
    state.searchLoading=false;
    if(state.view==='search'&&normalize(state.query)===normalize(query))render();
    renderSuggestions();
  }
}
function searchView(){let items=state.searchResults;if(state.searchTab!=='all')items=items.filter(x=>x.type===state.searchTab);const tabs=[['all',t('All','الكل')],['profile',t('People','الأشخاص')],['post',t('Posts','المنشورات')],['circle',t('Circles','المجتمعات')]];return `${pageTitle(`${t('Search','بحث')}: “${esc(state.query)}”`,t('Results from people, posts and Circles are queried securely from the database.','نتائج الطلاب والمنشورات والمجتمعات تأتي مباشرة من قاعدة البيانات.'))}<div class="search-page-tools"><div class="tabs">${tabs.map(([v,l])=>{const count=v==='all'?state.searchResults.length:state.searchResults.filter(x=>x.type===v).length;return `<button class="${state.searchTab===v?'active':''}" data-search-tab="${v}">${l}${!state.searchLoading?` <b>${count}</b>`:''}</button>`}).join('')}</div>${state.query?`<button class="secondary" data-clear-global-search>${t('Clear search','مسح البحث')}</button>`:''}</div><div class="result-list search-results-list">${state.searchLoading?'<div class="loading-card"></div><div class="loading-card"></div>':state.dataErrors.search?`<div class="error-state"><b>${t('Search could not load.','تعذر تحميل البحث.')}</b><span>${t('Check your connection, then try again.','تحقق من الاتصال ثم حاول مرة أخرى.')}</span><button class="secondary" data-retry-search>${t('Try again','إعادة المحاولة')}</button></div>`:items.length?items.map(searchRow).join(''):emptyState(t('No results','لا توجد نتائج'),t('Try a different phrase or spelling.','جرّب عبارة أو كتابة مختلفة.'))}</div>`}
function highlight(value){const q=state.query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return q?esc(value).replace(new RegExp(`(${q})`,'ig'),'<mark>$1</mark>'):esc(value)}
function searchRow(x){return `<button class="result-row" data-search-open="${x.type}" data-search-id="${esc(x.id)}"><span class="entity-icon">${x.type==='profile'?'P':x.type==='post'?'POST':'C'}</span><div><h3>${highlight(x.title||'')}</h3><p>${esc(x.subtitle||'')} · ${highlight(x.preview||'')}</p></div>${x.created_at?`<time>${relative(x.created_at)}</time>`:'<span>→</span>'}</button>`}
function renderSuggestions(){const box=$('#searchSuggestions');if(!box)return;const q=$('#globalSearch')?.value.trim()||'';if(q.length<2||state.view==='search'){box.classList.add('hidden');if(typeof syncSearchChrome==='function')syncSearchChrome();return}const items=state.searchResults.slice(0,7);box.innerHTML=state.searchLoading?'<div class="search-suggest-loading"><i></i><span>'+t('Searching…','جارٍ البحث…')+'</span></div>':items.length?items.map((x,i)=>`<button class="suggest-item ${i===searchIndex?'active':''}" role="option" data-search-open="${x.type}" data-search-id="${esc(x.id)}"><span class="entity-icon">${x.type==='profile'?'P':x.type==='post'?'POST':'C'}</span><span><b>${highlight(x.title||'')}</b><small>${esc(x.preview||x.subtitle||'')}</small></span></button>`).join(''):`<div class="empty search-suggest-empty"><span>${t('No suggestions','لا توجد اقتراحات')}</span></div>`;box.classList.remove('hidden');if(typeof syncSearchChrome==='function')syncSearchChrome();bindV6(box)}

function notificationsView(){const unread=state.notifications.filter(n=>!n.read_at).length;return `${pageTitle(t('Notifications','الإشعارات'),t('Replies, messages, follows and Circle activity.','الردود والرسائل والمتابعات ونشاط المجتمعات.'),unread?`<button class="secondary" data-mark-all-read>${t('Mark all read','تحديد الكل كمقروء')}</button>`:'')}<div class="result-list">${state.notifications.length?state.notifications.map(n=>`<button class="notification-row ${n.read_at?'':'unread'}" data-open-notification="${n.id}" data-route="${esc(n.route||'notifications')}"><span class="entity-icon">${n.type==='message'?'M':n.type==='reply'?'R':'N'}</span><div><b>${esc(n.title)}</b><p>${esc(n.body)}</p></div><time>${relative(n.created_at)}</time></button>`).join(''):emptyState(t('No notifications','لا توجد إشعارات'),t('Your notifications will appear here.','ستظهر إشعاراتك هنا.'))}</div>`}

const originalAdmin=admin;
const normalizedReportStatus=value=>String(value||'').trim().toLowerCase();
const canControlAuthorLikeEmails=()=>state.isAdmin&&String(authUser?.email||'').trim().toLowerCase()===AUTHOR_LIKE_EMAIL_ADMIN;
async function loadAuthorLikeEmailSetting(){
  if(!canControlAuthorLikeEmails()||authorLikeEmailSettingLoading)return;
  authorLikeEmailSettingLoading=true;
  const {data,error}=await sb.rpc('get_author_like_email_setting');
  authorLikeEmailSettingLoading=false;
  if(error){console.error('[NEIS author like email setting]',error);toast(t('Could not load the email notification setting.','تعذر تحميل إعداد إشعارات البريد الإلكتروني.'));return}
  authorLikeEmailSetting=!!data;
  if(state.view==='admin')render();
}
function syncAdminSwitch(el,on){
  if(!el)return;
  el.classList.toggle('is-on',!!on);
  el.setAttribute('aria-checked',on?'true':'false');
  const label=el.querySelector('b');if(label)label.textContent=on?t('On','مفعّل'):t('Off','متوقف');
}
async function persistAdminSetting(button,stateName,next,rpcName,datasetKey,errorAction){
  const previous=stateName.get();
  stateName.set(next);
  if(button){
    button.disabled=true;
    button.dataset[datasetKey]=next?'false':'true';
    syncAdminSwitch(button,next);
  }
  const {data,error}=await sb.rpc(rpcName,{desired_enabled:next});
  if(error){
    stateName.set(previous);
    if(button?.isConnected){
      button.disabled=false;
      button.dataset[datasetKey]=previous?'false':'true';
      syncAdminSwitch(button,previous);
    }
    toast(safeError(error,errorAction));
    return;
  }
  const saved=!!data;
  stateName.set(saved);
  if(button?.isConnected){
    button.disabled=false;
    button.dataset[datasetKey]=saved?'false':'true';
    syncAdminSwitch(button,saved);
  }
}
async function changeAuthorLikeEmailSetting(enabled){
  if(!canControlAuthorLikeEmails())return;
  return persistAdminSetting(
    document.querySelector('[data-author-like-email-toggle]'),
    {get:()=>authorLikeEmailSetting===true,set:value=>{authorLikeEmailSetting=!!value}},
    !!enabled,'set_author_like_email_setting','authorLikeEmailToggle','change the author like email setting'
  );
}
async function changeAdminDmEmailSetting(enabled){
  if(!canControlAuthorLikeEmails())return;
  return persistAdminSetting(
    document.querySelector('[data-admin-dm-email-toggle]'),
    {get:()=>adminDmEmailSetting===true,set:value=>{adminDmEmailSetting=!!value}},
    !!enabled,'set_admin_dm_email_setting','adminDmEmailToggle','change the admin DM email setting'
  );
}
async function changeAdminPostEmailSetting(enabled){
  if(!canControlAuthorLikeEmails())return;
  return persistAdminSetting(
    document.querySelector('[data-admin-post-email-toggle]'),
    {get:()=>adminPostEmailSetting===true,set:value=>{adminPostEmailSetting=!!value}},
    !!enabled,'set_admin_post_email_setting','adminPostEmailToggle','change the admin post email setting'
  );
}
function adminToggleRow(label,enabled,attrs='',loading=false){
  const on=!!enabled;
  return `<div class="admin-toggle-row" ${attrs.includes('data-author-like-email-toggle')?'data-author-like-email-setting':''}${attrs.includes('data-admin-dm-email-toggle')?' data-admin-dm-email-setting':''}${attrs.includes('data-admin-post-email-toggle')?' data-admin-post-email-setting':''}>
    <span>${label}</span>
    <button type="button" class="admin-switch ${on?'is-on':''}" role="switch" aria-checked="${on?'true':'false'}" ${attrs} ${loading?'disabled':''}>
      <i aria-hidden="true"></i><b>${loading?'…':on?t('On','مفعّل'):t('Off','متوقف')}</b>
    </button>
  </div>`;
}
const ADMIN_CONTENT_MODERATION_HIDDEN_KEY='neis-admin-content-moderation-hidden-v1';
const ADMIN_MEMBERS_BRANCHES_HIDDEN_KEY='neis-admin-members-branches-hidden-v1';
const adminContentModerationHidden=()=>localStorage.getItem(ADMIN_CONTENT_MODERATION_HIDDEN_KEY)==='1';
const adminMembersBranchesHidden=()=>localStorage.getItem(ADMIN_MEMBERS_BRANCHES_HIDDEN_KEY)==='1';

function adminControlsPanel(){
  if(!state.isAdmin)return '';
  const rows=[];
  if(canControlAuthorLikeEmails()){
    const authorLoading=authorLikeEmailSetting===null,authorEnabled=authorLikeEmailSetting===true;
    const dmLoading=adminDmEmailSetting===null,dmEnabled=adminDmEmailSetting===true;
    const postLoading=adminPostEmailSetting===null,postEnabled=adminPostEmailSetting===true;
    rows.push(adminToggleRow(t('Author like emails','إشعارات إعجاب الكتّاب'),authorEnabled,`data-author-like-email-toggle="${authorEnabled?'false':'true'}"`,authorLoading));
    rows.push(adminToggleRow(t('Admin DM email alerts','تنبيهات رسائل الأدمن بالبريد'),dmEnabled,`data-admin-dm-email-toggle="${dmEnabled?'false':'true'}"`,dmLoading));
    rows.push(adminToggleRow(t('Admin post email notifications','إشعارات منشورات الأدمن بالبريد'),postEnabled,`data-admin-post-email-toggle="${postEnabled?'false':'true'}"`,postLoading));
  }
  const moderationVisible=!adminContentModerationHidden();
  const membersVisible=!adminMembersBranchesHidden();
  rows.push(adminToggleRow(t('Content moderation','إدارة المحتوى'),moderationVisible,`data-toggle-content-moderation-visibility="${moderationVisible?'false':'true'}"`));
  rows.push(adminToggleRow(t('Members & branches','الأعضاء والفروع'),membersVisible,`data-toggle-members-branches-visibility="${membersVisible?'false':'true'}"`));
  return `<section class="module-card admin-controls-card" style="margin-top:18px"><h2>${t('Admin controls','إعدادات الأدمن')}</h2><div class="admin-toggle-list">${rows.join('')}</div></section>`;
}
function setAdminContentModerationVisibility(visible){
  if(!state.isAdmin)return;
  const show=visible===true||visible==='true';
  localStorage.setItem(ADMIN_CONTENT_MODERATION_HIDDEN_KEY,show?'0':'1');
  document.querySelector('[data-admin-content-moderation]')?.classList.toggle('hidden',!show);
  const toggle=document.querySelector('[data-toggle-content-moderation-visibility]');
  if(toggle){toggle.dataset.toggleContentModerationVisibility=show?'false':'true';syncAdminSwitch(toggle,show)}
}
function setAdminMembersBranchesVisibility(visible){
  if(!state.isAdmin)return;
  const show=visible===true||visible==='true';
  localStorage.setItem(ADMIN_MEMBERS_BRANCHES_HIDDEN_KEY,show?'0':'1');
  document.querySelector('[data-admin-members-branches]')?.classList.toggle('hidden',!show);
  const toggle=document.querySelector('[data-toggle-members-branches-visibility]');
  if(toggle){toggle.dataset.toggleMembersBranchesVisibility=show?'false':'true';syncAdminSwitch(toggle,show)}
}

admin=function(){const base=originalAdmin();if(!state.isAdmin)return base;const content=[...state.posts.map(x=>({type:'post',id:x.id,title:x.title,meta:x.user,action:`data-delete-post="${x.id}"`})),...state.allComments.filter(x=>!x.deleted_at).map(x=>({type:'reply',id:x.id,title:x.body,meta:x.profile?.full_name||'Student',action:`data-delete-reply="${x.id}"`})),...state.circleRows.map(x=>({type:'circle',id:x.id,title:x.name,meta:profileData(x.owner_id).full_name,action:`data-delete-circle="${x.id}"`})),...state.circleMeetings.map(x=>({type:'meeting',id:x.id,title:x.title,meta:x.creator?.full_name||'Student',action:`data-delete-meeting="${x.id}"`})),...state.circleMessages.filter(x=>!x.deleted_at).map(x=>({type:'circle message',id:x.id,title:x.body,meta:x.profile?.full_name||'Student',action:`data-delete-circle-message="${x.id}"`})),...state.gallery.map(x=>({type:'gallery',id:x.id,title:x.caption_en||x.caption_ar||'Gallery item',meta:authorName(x.author),action:`data-delete-gallery="${x.id}"`})),...state.articles.map(x=>({type:'article',id:x.id,title:x.title_en||x.title_ar||'Article',meta:authorName(x.author),action:`data-delete-article="${x.id}"`}))];return `${base}${adminControlsPanel()}<section class="module-card" style="margin-top:18px"><div class="page-title"><div><h2>${t('Reports','البلاغات')}</h2><p>${t('Identity data is private and visible only to authorized administrators.','بيانات الهوية خاصة ولا تظهر إلا للمسؤولين المصرح لهم.')}</p></div></div>${state.reports.length?`<div class="admin-report-list">${state.reports.map(r=>`<article class="admin-report-card"><div class="admin-report-head"><span class="entity-icon">${esc(r.target_type)}</span><div><h3>${esc(r.reason)}</h3><p>${esc(r.target_type)} · ${esc(r.target_id)} · ${when(r.created_at)}</p></div><div class="report-head-actions"><select aria-label="${t('Report status','حالة البلاغ')}" data-report-status="${r.id}">${['open','reviewed','resolved','dismissed'].map(s=>`<option value="${s}" ${normalizedReportStatus(r.status)===s?'selected':''}>${s}</option>`).join('')}</select>${normalizedReportStatus(r.status)==='resolved'?`<button class="secondary danger report-delete" data-delete-report="${esc(r.id)}">${t('Delete report','حذف البلاغ')}</button>`:''}</div></div><div class="admin-identity-grid"><div><small>${t('Reported account','الحساب المُبلّغ عنه')}</small><b>${esc(r.reported_display_name||t('Account no longer exists','الحساب لم يعد موجودًا'))}</b><span>${r.reported_username?`@${esc(r.reported_username)} · `:''}${esc(r.reported_user_id||t('Identity unavailable','الهوية غير متاحة'))}</span></div><div><small>${t('Private identity','الهوية الخاصة')}</small><b>${esc(r.reported_email||t('No verified email','لا يوجد بريد موثق'))} · ${r.reported_email_verified?t('Email verified','البريد موثّق'):t('Email unavailable','البريد غير متاح')}</b><span>${esc(r.reported_phone||t('No registered phone','لا يوجد هاتف مسجّل'))} · ${r.reported_phone_validated?t('Phone registered / validated','الهاتف مسجّل / تم التحقق من صيغته'):t('Phone unavailable','الهاتف غير متاح')}</span></div></div><div class="admin-report-content"><small>${t('Reported content','المحتوى المُبلّغ عنه')}</small><p>${esc(r.reported_content||t('Content unavailable','المحتوى غير متاح'))}</p></div><p class="admin-report-details">${esc(r.details||'')}</p><footer>${t('Reporter','المُبلّغ')}: ${esc(r.reporter_display_name||'Student')} · @${esc(r.reporter_username||'student')}</footer></article>`).join('')}</div>`:emptyState(t('No reports','لا توجد بلاغات'),t('The moderation queue is clear.','قائمة المراجعة فارغة.'))}</section><section class="module-card ${adminContentModerationHidden()?'hidden':''}" data-admin-content-moderation style="margin-top:18px"><div class="page-title"><div><h2>${t('Content moderation','إدارة المحتوى')}</h2><p>${t('Real database content only. Deletions require confirmation.','محتوى قاعدة البيانات الحقيقي فقط، والحذف يتطلب تأكيدًا.')}</p></div></div><div class="admin-content-list">${content.length?content.slice(0,100).map(x=>`<div class="admin-content-row"><div><b>${esc(x.title)}</b><p>${esc(x.type)} · ${esc(x.meta||'')}</p></div><button class="secondary danger" ${x.action}>${t('Delete','حذف')}</button></div>`).join(''):emptyState(t('No content','لا يوجد محتوى'),t('The production database is clean.','قاعدة بيانات الإنتاج نظيفة.'))}</div></section>`}

async function deleteResolvedReport(id){
  const report=state.reports.find(item=>same(item.id,id));
  if(!report||normalizedReportStatus(report.status)!=='resolved')return;
  if(!await confirmAction(t('Delete resolved report?','حذف البلاغ المحسوم؟'),t('This permanently removes the resolved report record.','سيتم حذف سجل البلاغ المحسوم نهائيًا.')))return;
  let {data,error}=await sb.rpc('admin_delete_resolved_report',{report_id_input:id});
  if(error||!data){
    const direct=await sb.from('reports').delete().eq('id',id).eq('status','resolved').select('id');
    if(direct.error||!direct.data?.length){toast(safeError(error||direct.error||new Error('resolved_report_delete_failed'),'delete this report'));return}
  }
  state.reports=state.reports.filter(item=>!same(item.id,id));
  render();
  await loadLiveData();render();toast(t('Resolved report deleted.','تم حذف البلاغ المحسوم.'));
}

comments=async function(postId){
  const p=state.posts.find(x=>same(x.id,postId));if(!p)return;openModal(`<div class="modal-head"><div><h2>${t('Discussion','النقاش')}</h2><p>${esc(p.title)}</p></div><button class="close" data-close>×</button></div><div id="replyContent"><div class="loading-card"></div></div>`,true);
  const {data,error}=await sb.from('comments').select('id,post_id,parent_id,author_id,body,created_at,updated_at,deleted_at').eq('post_id',postId).is('deleted_at',null).order('created_at');
  if(error){console.error('Discussion comments load failed',error);$('#replyContent').innerHTML=`<div class="error-state">${t('Replies could not load. Try again.','تعذر تحميل الردود. حاول مرة أخرى.')}</div>`;return}
  const authorIds=[...new Set((data||[]).map(r=>r.author_id).filter(Boolean))];
  let discussionProfiles={};
  if(authorIds.length){
    const {data:authors,error:authorsError}=await sb.from('profiles').select('id,full_name,username,grade,branch,avatar_url').in('id',authorIds);
    if(authorsError)console.warn('Discussion profiles load failed',authorsError);
    else discussionProfiles=Object.fromEntries((authors||[]).map(profile=>[String(profile.id),profile]));
  }
  const replies=(data||[]).map(r=>({...r,profile:discussionProfiles[String(r.author_id)]||profileData(r.author_id)}));
  const {data:commentLikes,error:commentLikesError}=replies.length?await sb.from('comment_likes').select('comment_id,user_id').in('comment_id',replies.map(r=>r.id)):{data:[],error:null};
  const {data:creatorHearts,error:creatorHeartsError}=replies.length?await sb.from('comment_creator_hearts').select('comment_id,creator_id').in('comment_id',replies.map(r=>r.id)):{data:[],error:null};
  if(commentLikesError)console.warn('Discussion likes load failed',commentLikesError);
  if(creatorHeartsError)console.warn('Discussion creator hearts load failed',creatorHeartsError);
  const likesByComment=new Map();(commentLikes||[]).forEach(x=>{const key=String(x.comment_id),row=likesByComment.get(key)||{count:0,mine:false};row.count++;if(same(x.user_id,authUser.id))row.mine=true;likesByComment.set(key,row)});
  const heartsByComment=new Map((creatorHearts||[]).map(x=>[String(x.comment_id),x]));
  const renderNode=(r,isReply=false)=>{
    const own=same(r.author_id,authUser.id),deletable=own||state.isAdmin||(p.circle_id&&canModerateCircle(p.circle_id)),like=likesByComment.get(String(r.id))||{count:0,mine:false},profile=r.profile||profileData(r.author_id);
    return `<article class="reply-card ${isReply?'is-reply':''}" id="reply-${r.id}" data-comment-id="${r.id}">
      <div class="reply-head">${profileAvatar(profile)}
        <div class="reply-identity">
          <button class="author-link" data-open-profile="${r.author_id}"><b>${esc(profile?.full_name||'Student')}</b></button>
          <small>@${esc(profile?.username||'student')} · ${when(r.created_at)}${r.updated_at&&r.updated_at!==r.created_at?` · ${t('edited','معدل')}`:''}</small>
        </div>
      </div>
      <p class="reply-body" dir="auto">${r.deleted_at?`<i>${t('This reply was deleted.','تم حذف هذا الرد.')}</i>`:esc(r.body)}</p>
      ${!r.deleted_at?`<div class="reply-actions">
        <button class="reply-action ${like.mine?'active':''}" data-comment-like="${r.id}" aria-pressed="${like.mine?'true':'false'}"><span class="like-heart">♡</span><span>${t('Like','إعجاب')}</span><b>${like.count||0}</b></button>
        ${same(p.author_id,authUser.id)&&!same(r.author_id,authUser.id)
          ?`<button class="reply-action creator-heart-toggle ${heartsByComment.has(String(r.id))?'active':''}" data-creator-heart="${r.id}" aria-label="${t('Creator heart','قلب الناشر')}">♥</button>`
          :heartsByComment.has(String(r.id))?`<span class="creator-heart" title="${t('Hearted by creator','أعجب به الناشر')}">♥</span>`:''}
        <button class="reply-action" data-reply-to="${r.id}">${t('Reply','رد')}</button>
        ${profile?.username?`<button class="reply-action native-mention-action" data-native-mention data-comment-mention="${r.id}">@ ${t('Mention','منشن')}</button>`:''}
        ${own?`<button class="reply-action" data-edit-reply="${r.id}">${t('Edit','تعديل')}</button>`:''}
        ${deletable?`<button class="reply-action danger-text" data-delete-reply="${r.id}">${t('Delete','حذف')}</button>`:`<button class="reply-action" data-report-target="comment" data-report-id="${r.id}">${t('Report','إبلاغ')}</button>`}
      </div>`:''}
    </article>`;
  };

  const childrenByParent=new Map();
  replies.forEach(row=>{
    const key=row.parent_id?String(row.parent_id):'__root__';
    const list=childrenByParent.get(key)||[];
    list.push(row);
    childrenByParent.set(key,list);
  });
  const roots=childrenByParent.get('__root__')||[];
  const descendantsOf=root=>{
    const out=[];
    const walk=rows=>rows.forEach(row=>{out.push(row);walk(childrenByParent.get(String(row.id))||[])});
    walk(childrenByParent.get(String(root.id))||[]);
    return out;
  };
  const renderThread=root=>{
    const children=descendantsOf(root);
    return `<section class="reply-thread" data-thread-root="${root.id}">
      ${renderNode(root,false)}
      ${children.length?`<button type="button" class="reply-thread-toggle" data-toggle-replies="${root.id}" aria-expanded="false"><span class="reply-thread-line" aria-hidden="true"></span><span class="reply-thread-label">${t('View replies','عرض الردود')} (${children.length})</span></button>
      <div class="reply-children hidden" data-reply-children="${root.id}">${children.map(child=>renderNode(child,true)).join('')}</div>`:''}
    </section>`;
  };

  const bindDiscussionManagement=()=>{
    const scope=$('#replyContent');if(!scope)return;
    scope.onclick=async event=>{
      const editButton=event.target.closest('[data-edit-reply]');
      if(editButton&&scope.contains(editButton)){
        event.preventDefault();event.stopPropagation();
        const item=replies.find(row=>same(row.id,editButton.dataset.editReply)),card=editButton.closest('.reply-card');
        if(!item||!card||card.querySelector('.reply-inline-edit'))return;
        const bodyEl=card.querySelector('.reply-body'),actions=card.querySelector('.reply-actions');
        bodyEl?.classList.add('hidden');actions?.classList.add('hidden');
        card.insertAdjacentHTML('beforeend',`<form class="reply-inline-edit"><textarea maxlength="4000" dir="auto">${esc(item.body||'')}</textarea><div class="reply-edit-actions"><button type="button" data-cancel-reply-edit>${t('Cancel','إلغاء')}</button><button class="primary" type="submit">${t('Save changes','حفظ التعديل')}</button></div></form>`);
        const form=card.querySelector('.reply-inline-edit'),textarea=form.querySelector('textarea'),save=form.querySelector('[type=submit]');
        textarea.focus();textarea.setSelectionRange(textarea.value.length,textarea.value.length);
        form.querySelector('[data-cancel-reply-edit]').onclick=()=>{form.remove();bodyEl?.classList.remove('hidden');actions?.classList.remove('hidden')};
        form.onsubmit=async submitEvent=>{
          submitEvent.preventDefault();
          const body=textarea.value.trim();
          if(!body){toast(t('Comment cannot be empty.','لا يمكن أن يكون التعليق فارغًا.'));return}
          save.disabled=true;
          const {data:updated,error:updateError}=await sb.from('comments').update({body,updated_at:new Date().toISOString()}).eq('id',item.id).eq('author_id',authUser.id).select('id');
          if(updateError||!updated?.length){toast(updateError?safeError(updateError,'edit your reply'):t('This reply could not be updated.','تعذر تعديل هذا الرد.'));save.disabled=false;return}
          await loadLiveData();await comments(postId);toast(t('Reply updated.','تم تعديل الرد.'));
        };
        return;
      }

      const deleteButton=event.target.closest('[data-delete-reply]');
      if(deleteButton&&scope.contains(deleteButton)){
        event.preventDefault();event.stopPropagation();
        const item=replies.find(row=>same(row.id,deleteButton.dataset.deleteReply));
        if(!item||deleteButton.disabled)return;
        if(deleteButton.dataset.confirmDelete!=='1'){
          deleteButton.dataset.confirmDelete='1';
          deleteButton.dataset.originalText=deleteButton.textContent;
          deleteButton.textContent=t('Confirm delete','تأكيد الحذف');
          deleteButton.classList.add('danger');
          setTimeout(()=>{if(deleteButton.isConnected&&deleteButton.dataset.confirmDelete==='1'){deleteButton.dataset.confirmDelete='';deleteButton.textContent=deleteButton.dataset.originalText||t('Delete','حذف')}},5000);
          return;
        }
        deleteButton.disabled=true;
        const {data:deleted,error:deleteError}=await sb.from('comments').delete().eq('id',item.id).select('id');
        if(deleteError||!deleted?.length){toast(deleteError?safeError(deleteError,'delete this reply'):t('This reply could not be deleted.','تعذر حذف هذا الرد.'));deleteButton.disabled=false;deleteButton.dataset.confirmDelete='';deleteButton.textContent=deleteButton.dataset.originalText||t('Delete','حذف');return}
        await loadLiveData();await comments(postId);toast(t('Reply deleted.','تم حذف الرد.'));
      }
    };
  };

  $('#replyContent').innerHTML=`<div class="reply-tree">${roots.length?roots.map(renderThread).join(''):emptyState(t('No replies yet','لا توجد ردود بعد'),t('Start a useful discussion.','ابدأ نقاشًا مفيدًا.'))}</div><form id="replyForm" class="chat-form reply-composer"><input type="hidden" id="replyParent"><input id="replyInput" required maxlength="4000" placeholder="${t('Add a thoughtful comment…','أضف تعليقًا مفيدًا…')}" dir="auto"><button aria-label="${t('Send reply','إرسال الرد')}">→</button></form>`;
  bindDiscussionManagement();
  bindV6($('#modalRoot'));

  $('#replyContent').querySelectorAll('[data-toggle-replies]').forEach(button=>button.onclick=()=>{
    const children=$('[data-reply-children="'+button.dataset.toggleReplies+'"]');if(!children)return;
    const opening=children.classList.contains('hidden');
    children.classList.toggle('hidden',!opening);
    button.setAttribute('aria-expanded',opening?'true':'false');
    const count=children.querySelectorAll('.reply-card').length;
    const label=button.querySelector('.reply-thread-label');
    if(label)label.textContent=opening?`${t('Hide replies','إخفاء الردود')} (${count})`:`${t('View replies','عرض الردود')} (${count})`;
  });

  $('#replyContent').querySelectorAll('[data-reply-to]').forEach(button=>button.onclick=()=>{
    const reply=replies.find(row=>same(row.id,button.dataset.replyTo)),input=$('#replyInput'),parent=$('#replyParent');if(!reply||!input||!parent)return;
    parent.value=reply.id;
    const username=reply.profile?.username||'';
    const mention=username?`@${username} `:'';
    if(mention&&!input.value.includes(mention))input.value=(input.value.trim()?input.value.replace(/\s*$/,' '):'')+mention;
    input.placeholder=`${t('Reply to','رد على')} ${reply.profile?.full_name||t('Student','طالب')}…`;
    input.focus();
    try{input.setSelectionRange(input.value.length,input.value.length)}catch(_){}
    input.scrollIntoView({block:'nearest',behavior:'smooth'});
  });
  $('#replyContent').querySelectorAll('[data-comment-mention]').forEach(button=>button.onclick=()=>{
    const reply=replies.find(row=>same(row.id,button.dataset.commentMention)),input=$('#replyInput');if(!reply||!input)return;
    const username=reply.profile?.username||'',mention=username?`@${username}`:'';
    if(mention&&!input.value.includes(mention))input.value=input.value.trim()?input.value.replace(/\s*$/,' ') + mention + ' ':mention+' ';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.focus();
    try{input.setSelectionRange(input.value.length,input.value.length)}catch(_){}
    input.scrollIntoView({block:'nearest',behavior:'smooth'});
  });
  $('#replyContent').querySelectorAll('[data-creator-heart]').forEach(button=>button.onclick=async()=>{if(button.disabled)return;button.disabled=true;const commentId=button.dataset.creatorHeart,hearted=heartsByComment.has(String(commentId));const {error}=hearted?await sb.from('comment_creator_hearts').delete().eq('comment_id',commentId):await sb.from('comment_creator_hearts').insert({comment_id:commentId,creator_id:authUser.id});if(error){toast(safeError(error,hearted?'remove creator heart':'heart this comment'));button.disabled=false;return}await comments(postId)});
  $('#replyContent').querySelectorAll('[data-comment-like]').forEach(button=>button.onclick=async()=>{if(button.disabled)return;button.disabled=true;const commentId=button.dataset.commentLike,mine=button.getAttribute('aria-pressed')==='true';const {error}=mine?await sb.from('comment_likes').delete().match({comment_id:commentId,user_id:authUser.id}):await sb.from('comment_likes').insert({comment_id:commentId,user_id:authUser.id});if(error){toast(safeError(error,mine?'unlike this comment':'like this comment'));button.disabled=false;return}await comments(postId)});
  $('#replyForm').onsubmit=async e=>{e.preventDefault();const input=$('#replyInput'),button=$('#replyForm button'),body=input.value.trim();if(!body)return;button.disabled=true;const payload={post_id:postId,author_id:authUser.id,body,parent_id:$('#replyParent').value||null},{error}=await sb.from('comments').insert(payload);if(error){toast(safeError(error,'add your reply'));button.disabled=false;return}await loadLiveData();comments(postId);toast(t('Reply added.','تمت إضافة الرد.'))}
};

function openReport(type,id){openModal(`<div class="modal-head"><div><h2>${t('Report content','الإبلاغ عن محتوى')}</h2><p>${t('Reports go to the private admin queue.','تصل البلاغات إلى قائمة الأدمن الخاصة.')}</p></div><button class="close" data-close>×</button></div><form id="reportForm"><label class="field">${t('Reason','السبب')}<select id="reportReason"><option>${t('Spam','محتوى مزعج')}</option><option>${t('Harassment','إساءة أو مضايقة')}</option><option>${t('Unsafe content','محتوى غير آمن')}</option><option>${t('Other','سبب آخر')}</option></select></label><label class="field">${t('Details','التفاصيل')}<textarea id="reportDetails" rows="4" maxlength="1000"></textarea></label><div class="modal-actions"><button type="button" class="secondary" data-close>${t('Cancel','إلغاء')}</button><button class="primary">${t('Submit report','إرسال البلاغ')}</button></div></form>`);$('#reportForm').onsubmit=async e=>{e.preventDefault();const {error}=await sb.from('reports').insert({reporter_id:authUser.id,target_type:type,target_id:String(id),reason:$('#reportReason').value,details:$('#reportDetails').value.trim()});if(error){toast(safeError(error,'submit this report'));return}closeModal();toast(t('Report sent to the administrator.','تم إرسال البلاغ إلى الأدمن.'))}}

function openCirclePost(){const c=byId(state.circleRows,state.activeCircleId);openModal(`<div class="modal-head"><div><h2>${t('Post in','منشور في')} ${esc(c.name)}</h2></div><button class="close" data-close>×</button></div><form id="circlePostForm"><label class="field">${t('Type','النوع')}<select id="cpKind"><option>Discussion</option><option>Question</option><option>Resource</option><option>Announcement</option></select></label><label class="field">${t('Title','العنوان')}<input id="cpTitle" required maxlength="140"></label><label class="field">${t('Details','التفاصيل')}<textarea id="cpBody" required rows="6" maxlength="6000"></textarea></label><div class="row"><label class="field">${t('Tags','الوسوم')}<input id="cpTags"></label><label class="field">${t('Optional image','صورة اختيارية')}<input id="cpImage" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label></div><img id="cpImagePreview" class="upload-preview hidden" alt=""><div class="modal-actions"><button type="button" class="secondary" data-close>${t('Cancel','إلغاء')}</button><button class="primary">${t('Publish','نشر')}</button></div></form>`);$('#cpImage').onchange=e=>{const f=e.target.files[0];if(f){$('#cpImagePreview').src=URL.createObjectURL(f);$('#cpImagePreview').classList.remove('hidden')}};$('#circlePostForm').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true,file=$('#cpImage').files[0];let image_url='';if(file){image_url=await uploadMedia(file,`circles/${c.id}`);if(!image_url){button.disabled=false;return}}const {error}=await sb.from('posts').insert({author_id:authUser.id,circle_id:c.id,kind:$('#cpKind').value,title:$('#cpTitle').value.trim(),body:$('#cpBody').value.trim(),tags:$('#cpTags').value.split(',').map(x=>x.trim()).filter(Boolean).slice(0,8),image_url});if(error){if(image_url)await removeMediaUrl(image_url);toast(safeError(error,'publish this post'));button.disabled=false;return}closeModal();await loadLiveData();render();toast(t('Published in the Circle.','تم النشر في المجتمع.'))}}

function suggestedPersonItem(p){
  const meta=[`@${p.username||'student'}`,p.grade,p.branch].map(value=>String(value||'').trim()).filter(Boolean).join(' · ');
  return `<div class="suggested-person"><button class="suggested-person-profile" data-open-profile="${p.id}">${profileAvatar(p)}<span class="suggested-person-copy"><b>${esc(p.full_name||'Student')}</b>${meta?`<small>${esc(meta)}</small>`:''}</span></button><button class="suggested-person-follow" data-v6-follow="${p.id}" aria-label="${t('Follow','متابعة')} ${esc(p.full_name||'Student')}">+</button></div>`;
}

home=function(){let posts=state.posts.filter(p=>!p.circle_id&&(!state.query||match(normalize(state.query),p.title,p.body,p.tags,p.user)));if(state.filter==='Questions')posts=posts.filter(p=>p.kind==='Question');if(state.filter==='Resources')posts=posts.filter(p=>p.kind==='Resource');if(state.filter==='Latest')posts=[...posts].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));if(state.filter==='For you'){const following=state.follows.filter(f=>same(f.follower_id,authUser.id)&&f.status==='accepted').map(f=>f.following_id),joined=state.circleMembers.filter(m=>same(m.user_id,authUser.id)&&m.status==='active').map(m=>m.circle_id);posts=[...posts].sort((a,b)=>Number(same(b.author_id,authUser.id)||following.some(id=>same(id,b.author_id))||joined.some(id=>same(id,b.circle_id)))-Number(same(a.author_id,authUser.id)||following.some(id=>same(id,a.author_id))||joined.some(id=>same(id,a.circle_id)))||new Date(b.created_at)-new Date(a.created_at))}const latest=state.articles.filter(a=>a.status==='published').slice(0,2),suggested=state.members.filter(p=>!same(p.id,authUser.id)&&!isFollowing(p.id)).slice(0,3);return `<section class="hero"><div class="hero-main"><p class="kicker"><i></i>${t('Welcome back','مرحبًا بعودتك')}، ${esc(state.profile.name)}</p><h1>${t('Learn together. Build what matters.','نتعلم معًا ونبني ما يستحق.')}</h1><p>${t('Your feed is connected to people you follow and Circles you joined.','تغذيتك مرتبطة بمن تتابعهم والمجتمعات التي انضممت إليها.')}</p><div style="display:flex;gap:8px;margin-top:20px"><button class="primary" data-nav="circles">${t('Explore Circles','استكشف المجتمعات')}</button><button class="secondary" data-nav="connections">${t('Your connections','علاقاتك')}</button></div></div><div class="hero-side"><div class="pulse"><div><strong>${state.members.length}</strong><small>${t('real profiles','ملفات حقيقية')}</small></div><span class="pulse-orb"></span></div><div class="profile-meter"><div class="meter-row"><b>${t('Your identity','هويتك')}</b><strong>${esc(state.profile.grade||t('Student','طالب'))}</strong></div><small>${esc(state.profile.branch||t('Add your branch','أضف فرعك'))}</small><div class="bar"><i style="width:${state.profile.branch?'100':'55'}%"></i></div></div></div></section><section class="pwa-install-card" data-pwa-install-card><div><p class="kicker"><i></i>${t('Mobile app','تطبيق الموبايل')}</p><h2>${t('Install NEIS Circle','ثبّت NEIS Circle')}</h2><p>${t('Install the secure web app directly from your browser. No APK, no unknown-source permission, and updates arrive automatically.','ثبّت تطبيق الويب الآمن مباشرة من المتصفح. بدون APK أو صلاحية مصادر خارجية، والتحديثات تصل تلقائيًا.')}</p></div><div class="pwa-install-actions"><button class="primary" type="button" data-pwa-install>${t('Install app','تثبيت التطبيق')}</button><button class="secondary" type="button" data-pwa-enable-notifications>${t('Enable notifications','تفعيل الإشعارات')}</button></div></section>${latest.length?`<section style="margin-bottom:22px"><div class="page-title" style="margin-bottom:14px"><div><p class="kicker"><i></i>${t('Editorial','المقالات')}</p><h2>${t('Latest articles','أحدث المقالات')}</h2></div><button class="secondary" data-nav="articles">${t('View all','عرض الكل')}</button></div><div class="article-grid">${latest.map(articleCard).join('')}</div></section>`:''}<div class="dashboard"><div class="main-column"><div class="composer-bar">${profileAvatar(profileData(authUser.id))}<button data-action="compose">${t('Share something useful…','شارك شيئًا مفيدًا…')}</button><button class="compose" data-action="compose">+</button></div><div class="tabs">${[['For you',t('For you','لك')],['Latest',t('Latest','الأحدث')],['Questions',t('Questions','أسئلة')],['Resources',t('Resources','مصادر')]].map(([v,l])=>`<button class="${state.filter===v?'active':''}" data-filter="${v}">${l}</button>`).join('')}</div><div class="feed">${posts.length?posts.map(postCard).join(''):emptyState(t('No posts yet','لا توجد منشورات بعد'),t('Create the first meaningful post.','أنشئ أول منشور مفيد.'))}</div></div><aside class="side-column"><section class="side-card"><h3>${t('Suggested people','أشخاص مقترحون')}</h3>${suggested.length?suggested.map(suggestedPersonItem).join(''):blank(t('No suggestions','لا توجد اقتراحات'),t('Your network is up to date.','شبكتك محدثة.'))}</section><section class="side-card"><h3>${t('Your spaces','مساحاتك')}</h3><div class="account-menu"><button class="account-row" data-nav="gallery"><span>${t('Community gallery','معرض المجتمع')}</span><b>→</b></button><button class="account-row" data-nav="articles"><span>${t('Student journal','مجلة الطلاب')}</span><b>→</b></button></div></section></aside></div>`};
opportunities=function(){return `${pageTitle(t('Opportunities','الفرص'),t('Verified opportunities will appear here when publishing is enabled.','ستظهر الفرص الموثقة هنا عند تفعيل النشر.'))}${emptyState(t('No verified opportunities yet','لا توجد فرص موثقة بعد'),t('This page no longer displays demo events.','لم تعد هذه الصفحة تعرض فعاليات تجريبية.'))}`};

const baseRender=render;
render=function(){
  if(!authUser||state.onboardingComplete!==true){baseRender();return}
  const custom={connections:connectionsView,search:searchView,notifications:notificationsView,'profile-detail':profileView,'circle-detail':circleView};
  if(custom[state.view]){document.body.classList.add('app-ready');$('#view').innerHTML=custom[state.view]();$$('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===state.view));bindV6()}
  else{baseRender();bindV6()}
  updateBadges();requestAnimationFrame(()=>{fitMobileConversationList();const chat=$('#chatFlow')||$('#circleChatFlow');if(chat)chat.scrollTop=chat.scrollHeight});
};

function openFullImage(src){if(!src)return;const layer=document.createElement('div');layer.className='image-lightbox';layer.innerHTML='<button type="button" class="image-lightbox-close" aria-label="Close">×</button><img src="'+esc(src)+'" alt="">';document.body.appendChild(layer);document.body.classList.add('image-lightbox-open');const close=()=>{layer.remove();document.body.classList.remove('image-lightbox-open');document.removeEventListener('keydown',onKey)};const onKey=e=>{if(e.key==='Escape')close()};layer.addEventListener('click',e=>{if(e.target===layer||e.target.closest('.image-lightbox-close'))close()});document.addEventListener('keydown',onKey);}

function bindV6(root=document){
  if(canControlAuthorLikeEmails()&&!window.__neisAdminSettingsLoading&&(authorLikeEmailSetting===null||adminDmEmailSetting===null||adminPostEmailSetting===null)){
    window.__neisAdminSettingsLoading=true;
    Promise.allSettled([
      sb.rpc('get_author_like_email_setting'),
      sb.rpc('get_admin_dm_email_setting'),
      sb.rpc('get_admin_post_email_setting')
    ]).then(results=>{
      const valueAt=index=>results[index].status==='fulfilled'&&!results[index].value?.error?!!results[index].value.data:false;
      authorLikeEmailSetting=valueAt(0);
      adminDmEmailSetting=valueAt(1);
      adminPostEmailSetting=valueAt(2);
      window.__neisAdminSettingsLoading=false;
      if(state.view==='admin')render();
    });
  }
  root.querySelectorAll('[data-author-like-email-toggle]').forEach(el=>el.onclick=()=>changeAuthorLikeEmailSetting(el.dataset.authorLikeEmailToggle==='true'));
  root.querySelectorAll('[data-admin-dm-email-toggle]').forEach(el=>el.onclick=()=>changeAdminDmEmailSetting(el.dataset.adminDmEmailToggle==='true'));
  root.querySelectorAll('[data-admin-post-email-toggle]').forEach(el=>el.onclick=()=>changeAdminPostEmailSetting(el.dataset.adminPostEmailToggle==='true'));
  root.querySelectorAll('[data-toggle-content-moderation-visibility]').forEach(el=>el.onclick=()=>setAdminContentModerationVisibility(el.dataset.toggleContentModerationVisibility));
  root.querySelectorAll('[data-toggle-members-branches-visibility]').forEach(el=>el.onclick=()=>setAdminMembersBranchesVisibility(el.dataset.toggleMembersBranchesVisibility));
  root.querySelectorAll('[data-full-image]').forEach(el=>el.onclick=e=>{e.preventDefault();openFullImage(el.dataset.fullImage)});
  const discoverGrade=root.querySelector('#discoverGradeFilter');if(discoverGrade)discoverGrade.onchange=()=>{state.discoverGrade=discoverGrade.value;render()};
  const discoverBranch=root.querySelector('#discoverBranchFilter');if(discoverBranch)discoverBranch.onchange=()=>{state.discoverBranch=discoverBranch.value;render()};
  root.querySelectorAll('[data-reset-discover]').forEach(el=>el.onclick=()=>{state.discoverGrade='all';state.discoverBranch='all';state.discoverFilter='Recommended';render()});
  root.querySelectorAll('[data-open-profile]').forEach(el=>{el.onclick=e=>{e.stopPropagation();const id=el.dataset.openProfile;if(id)routeTo(`profile/${id}`)}});
  root.querySelectorAll('[role="link"][tabindex="0"]').forEach(el=>el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click()}});
  root.querySelectorAll('[data-v6-follow]').forEach(el=>el.onclick=async e=>{e.stopPropagation();const id=el.dataset.v6Follow,on=isFollowing(id);el.disabled=true;const q=on?sb.from('follows').delete().match({follower_id:authUser.id,following_id:id}):sb.from('follows').upsert({follower_id:authUser.id,following_id:id,status:'accepted'});const {error}=await q;if(error){toast(safeError(error,on?'unfollow':'follow'));el.disabled=false;return}await loadLiveData();render();toast(on?t('Unfollowed.','تم إلغاء المتابعة.'):t('Following.','تتم المتابعة.'))});
  root.querySelectorAll('[data-message-user]').forEach(el=>el.onclick=e=>{e.stopPropagation();startConversation(el.dataset.messageUser)});
  root.querySelectorAll('[data-open-conversation]').forEach(el=>el.onclick=()=>{state.activeConversationId=el.dataset.openConversation;routeTo(`messages/${state.activeConversationId}`);markConversationRead(state.activeConversationId);requestAnimationFrame(()=>scrollActiveDmToBottom({immediate:true}))});
  root.querySelectorAll('[data-new-chat]').forEach(el=>el.onclick=openNewConversation);
  root.querySelectorAll('[data-mobile-threads]').forEach(el=>el.onclick=()=>{state.activeConversationId='';routeTo('messages',true);requestAnimationFrame(()=>{const shell=document.querySelector('.messages');if(shell)shell.classList.remove('mobile-thread-open')})});
  root.querySelectorAll('[data-connection-tab]').forEach(el=>el.onclick=()=>routeTo(`connections/${el.dataset.connectionTab}`));
  root.querySelectorAll('[data-follow-request]').forEach(el=>el.onclick=async e=>{e.stopPropagation();const accepted=el.dataset.followRequest==='accept',q=accepted?sb.from('follows').update({status:'accepted'}).match({follower_id:el.dataset.user,following_id:authUser.id}):sb.from('follows').delete().match({follower_id:el.dataset.user,following_id:authUser.id}),{error}=await q;if(error){toast(safeError(error,accepted?'accept this request':'reject this request'));return}await loadLiveData();render();toast(accepted?t('Request accepted.','تم قبول الطلب.'):t('Request rejected.','تم رفض الطلب.'))});
  root.querySelectorAll('[data-open-circle]').forEach(el=>el.onclick=e=>{e.stopPropagation();routeTo(`circles/${el.dataset.openCircle}/home`)});
  root.querySelectorAll('[data-new-circle]').forEach(el=>el.onclick=newCircle);
  root.querySelectorAll('[data-circle-filter]').forEach(el=>el.onclick=()=>{state.circleFilter=el.dataset.circleFilter;render()});
  root.querySelectorAll('[data-circle-tab]').forEach(el=>el.onclick=()=>routeTo(`circles/${state.activeCircleId}/${el.dataset.circleTab}`));
  root.querySelectorAll('[data-circle-compose]').forEach(el=>el.onclick=openCirclePost);
  root.querySelectorAll('[data-new-meeting]').forEach(el=>el.onclick=scheduleMeeting);
  root.querySelectorAll('[data-join-meeting]').forEach(el=>el.onclick=()=>joinMeeting(el.dataset.joinMeeting));
  root.querySelectorAll('[data-copy-meeting-invite]').forEach(el=>el.onclick=()=>copyMeetingInvite(byId(state.circleMeetings,el.dataset.copyMeetingInvite)));
  root.querySelectorAll('[data-end-meeting]').forEach(el=>el.onclick=()=>endMeeting(el.dataset.endMeeting));
  root.querySelectorAll('[data-delete-meeting]').forEach(el=>el.onclick=()=>deleteMeeting(el.dataset.deleteMeeting));
  root.querySelectorAll('[data-delete-post]').forEach(el=>el.onclick=()=>deletePost(el.dataset.deletePost));
  root.querySelectorAll('[data-delete-gallery]').forEach(el=>el.onclick=()=>deleteGalleryItem(el.dataset.deleteGallery));
  root.querySelectorAll('[data-delete-article]').forEach(el=>el.onclick=()=>deleteArticle(el.dataset.deleteArticle));
  root.querySelectorAll('[data-delete-circle]').forEach(el=>el.onclick=()=>deleteCircle(el.dataset.deleteCircle));
  root.querySelectorAll('[data-delete-message]').forEach(el=>el.onclick=()=>deleteDirectMessage(el.dataset.deleteMessage));
  root.querySelectorAll('[data-delete-chat]').forEach(el=>el.onclick=()=>deleteConversation(el.dataset.deleteChat));
  root.querySelectorAll('[data-delete-circle-message]').forEach(el=>el.onclick=()=>deleteCircleMessage(el.dataset.deleteCircleMessage));
  root.querySelectorAll('[data-v6-circle-join]').forEach(el=>el.onclick=async()=>{const c=byId(state.circleRows,el.dataset.v6CircleJoin);if(!c)return;if(c.privacy==='private'){if(typeof window.openPrivateCircleJoin==='function'){window.openPrivateCircleJoin(c.name);return}toast(t('Use the Circle name and key to join this private Circle.','استخدم اسم المجتمع والمفتاح للانضمام إلى هذا المجتمع الخاص.'));return}const {error}=await sb.from('circle_members').insert({circle_id:c.id,user_id:authUser.id,role:'member',status:'active'});if(error){toast(safeError(error,'join this Circle'));return}await loadLiveData();render();toast(t('Joined the Circle.','تم الانضمام للمجتمع.'))});
  root.querySelectorAll('[data-v6-circle-leave]').forEach(el=>el.onclick=async()=>{const m=membership(el.dataset.v6CircleLeave);if(m?.role==='owner'){toast(t('Transfer ownership before leaving.','انقل الملكية قبل المغادرة.'));return}if(!await confirmAction(t('Leave this Circle?','مغادرة المجتمع؟'),t('You can join again later if it is public.','يمكنك الانضمام مرة أخرى لاحقًا إذا كان عامًا.')))return;const {error}=await sb.from('circle_members').delete().match({circle_id:el.dataset.v6CircleLeave,user_id:authUser.id});if(error){toast(safeError(error,'leave this Circle'));return}await loadLiveData();render();toast(t('Left the Circle.','تمت مغادرة المجتمع.'))});
  root.querySelectorAll('[data-share-circle]').forEach(el=>el.onclick=async()=>{await navigator.clipboard.writeText(`${location.origin}${location.pathname}#/circles/${el.dataset.shareCircle}/home`);toast(t('Circle link copied.','تم نسخ رابط المجتمع.'))});
  root.querySelectorAll('[data-search-tab]').forEach(el=>el.onclick=()=>{state.searchTab=el.dataset.searchTab;render()});
  root.querySelectorAll('[data-search-open]').forEach(el=>el.onclick=()=>{const type=el.dataset.searchOpen,id=el.dataset.searchId;$('#searchSuggestions')?.classList.add('hidden');routeTo(type==='profile'?`profile/${id}`:type==='circle'?`circles/${id}/home`:`post/${id}`)});
  root.querySelectorAll('[data-retry-search]').forEach(el=>el.onclick=()=>performSearch(state.query,true));
  root.querySelectorAll('[data-retry-meetings]').forEach(el=>el.onclick=async()=>{el.disabled=true;await loadLiveData();render()});
  if(state.view==='circle-detail'&&state.circleTab==='meetings'&&state.meetingInviteId){const card=root.querySelector(`[data-meeting-card="${CSS.escape(String(state.meetingInviteId))}"]`);if(card){card.classList.add('meeting-invite-target');setTimeout(()=>card.scrollIntoView({block:'center',behavior:'smooth'}),50)}}
  root.querySelectorAll('[data-clear-global-search]').forEach(el=>el.onclick=()=>{state.query='';state.searchResults=[];state.searchLoading=false;state.dataErrors.search=null;const input=$('#globalSearch');if(input){input.value='';input.focus()}routeTo('discover')});
  root.querySelectorAll('[data-open-notification]').forEach(el=>el.onclick=async()=>{const readAt=new Date().toISOString(),item=state.notifications.find(n=>same(n.id,el.dataset.openNotification));if(item)item.read_at=readAt;updateBadges();const {error}=await sb.from('notifications').update({read_at:readAt}).eq('id',el.dataset.openNotification);if(error){console.error('[NEIS notification read]',error);refreshNotificationsOnly()}routeTo(el.dataset.route||'notifications')});
  root.querySelectorAll('[data-mark-all-read]').forEach(el=>el.onclick=async()=>{const readAt=new Date().toISOString();state.notifications.forEach(n=>{if(!n.read_at)n.read_at=readAt});updateBadges();render();const {error}=await sb.from('notifications').update({read_at:readAt}).is('read_at',null);if(error){console.error('[NEIS notifications mark all]',error);refreshNotificationsOnly()}});
  root.querySelectorAll('[data-report-target]').forEach(el=>el.onclick=e=>{e.stopPropagation();openReport(el.dataset.reportTarget,el.dataset.reportId)});
  root.querySelectorAll('[data-report-status]').forEach(el=>el.onchange=async()=>{const report=state.reports.find(r=>same(r.id,el.dataset.reportStatus)),previous=report?.status||'open',next=normalizedReportStatus(el.value);el.disabled=true;const {data,error}=await sb.rpc('admin_update_report_status',{report_id_input:el.dataset.reportStatus,status_input:next});if(error||!data){el.value=previous;el.disabled=false;toast(error?safeError(error,'update this report'):t('This report could not be updated.','تعذر تحديث هذا البلاغ.'));return}if(report)report.status=next;render();await loadLiveData();render();toast(t('Report status updated.','تم تحديث حالة البلاغ.'))});
  root.querySelectorAll('[data-delete-report]').forEach(el=>el.onclick=()=>deleteResolvedReport(el.dataset.deleteReport));
  root.querySelectorAll('[data-reply-to]').forEach(el=>el.onclick=()=>{const r=byId(state.allComments,el.dataset.replyTo),input=$('#replyInput');$('#replyParent').value=el.dataset.replyTo;input.placeholder=`${t('Reply to','رد على')} ${r?.profile?.full_name||'Student'}…`;input.focus()});
  root.querySelectorAll('[data-delete-reply]').forEach(el=>{if(el.closest('#replyContent'))return;el.onclick=async()=>{const r=byId(state.allComments,el.dataset.deleteReply);if(!r||el.disabled)return;if(el.dataset.confirmDelete!=='1'){el.dataset.confirmDelete='1';el.dataset.originalText=el.textContent;el.textContent=t('Confirm delete','تأكيد الحذف');setTimeout(()=>{if(el.isConnected&&el.dataset.confirmDelete==='1'){el.dataset.confirmDelete='';el.textContent=el.dataset.originalText||t('Delete','حذف')}},5000);return}el.disabled=true;const {data,error}=await sb.from('comments').delete().eq('id',r.id).select('id');if(error||!data?.length){toast(error?safeError(error,'delete this reply'):t('This reply could not be deleted.','تعذر حذف هذا الرد.'));el.disabled=false;el.dataset.confirmDelete='';el.textContent=el.dataset.originalText||t('Delete','حذف');return}await loadLiveData();render();toast(t('Reply deleted.','تم حذف الرد.'))}});
  root.querySelectorAll('[data-member-role]').forEach(el=>el.onchange=async()=>{const {error}=await sb.from('circle_members').update({role:el.value}).match({circle_id:state.activeCircleId,user_id:el.dataset.memberRole});if(error)toast(safeError(error,'change this role'));else{await loadLiveData();render()}});
  root.querySelectorAll('[data-remove-member]').forEach(el=>el.onclick=async()=>{const p=profileData(el.dataset.removeMember);if(!await confirmAction(t('Remove member?','إزالة العضو؟'),p.full_name||'Student'))return;const {error}=await sb.from('circle_members').delete().match({circle_id:state.activeCircleId,user_id:el.dataset.removeMember});if(error)toast(safeError(error,'remove this member'));else{await loadLiveData();render()}});
  root.querySelectorAll('[data-post-read-more]').forEach(el=>el.onclick=()=>{const id=String(el.dataset.postReadMore);if(expandedPostIds.has(id))expandedPostIds.delete(id);else expandedPostIds.add(id);render()});
  root.querySelectorAll('[data-topic]').forEach(el=>el.onclick=()=>{$('#globalSearch').value=el.dataset.topic;state.query=el.dataset.topic;routeTo(`search?q=${encodeURIComponent(state.query)}`)});
  const rerenderSearchInput=(input,key)=>{const value=input.value,caret=input.selectionStart;state[key]=value;render();requestAnimationFrame(()=>{const next=$(`#${input.id}`);if(next){next.focus({preventScroll:true});next.setSelectionRange(caret,caret)}})};
  const cs=root.querySelector('#connectionSearch');if(cs)cs.oninput=()=>rerenderSearchInput(cs,'connectionsQuery');
  const circleSearch=root.querySelector('#circleSearch');if(circleSearch)circleSearch.oninput=()=>{state.circleQuery=circleSearch.value;clearTimeout(circleSearchTimer);circleSearchTimer=setTimeout(()=>{render();requestAnimationFrame(()=>{const next=$('#circleSearch');if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length)}})},180)};
  root.querySelectorAll('[data-clear-circle-search]').forEach(el=>el.onclick=()=>{state.circleQuery='';render()});
  const ts=root.querySelector('#conversationSearch');if(ts)ts.oninput=()=>rerenderSearchInput(ts,'conversationQuery');
  root.querySelectorAll('[data-cancel-dm-reply]').forEach(el=>el.onclick=event=>{event.preventDefault();event.stopPropagation();clearDmReplyTarget()});
  const liveDraftInput=root.querySelector('#liveChatInput');
  if(liveDraftInput){
    bindDmKeyboardBottom();
    liveDraftInput.oninput=()=>setDmDraft(state.activeConversationId,liveDraftInput.value);
    liveDraftInput.addEventListener('focus',()=>scrollActiveDmToBottom(),{passive:true});
    liveDraftInput.addEventListener('click',()=>scrollActiveDmToBottom(),{passive:true});
  }
  if(root.querySelector('#liveChatForm'))requestAnimationFrame(()=>scrollActiveDmToBottom({immediate:true}));
  const chat=root.querySelector('#liveChatForm');if(chat){const sendButton=chat.querySelector('button');if(sendButton)sendButton.addEventListener('pointerdown',event=>{if(window.matchMedia('(max-width:760px)').matches||document.documentElement.classList.contains('neis-native-app')){event.preventDefault();$('#liveChatInput')?.focus({preventScroll:true})}},{passive:false});chat.onsubmit=async e=>{
    e.preventDefault();
    const input=$('#liveChatInput'),button=chat.querySelector('button'),conversationId=state.activeConversationId,body=input.value.trim();
    if(!body)return;
    button.disabled=true;
    setDmDraft(conversationId,input.value);
    const replyTo=activeDmReply();const {data,error}=await sb.from('messages').insert({conversation_id:conversationId,sender_id:authUser.id,body,reply_to_id:replyTo?.id||null}).select('*').single();
    if(error){toast(safeError(error,'send this message'));button.disabled=false;return}
    setDmDraft(conversationId,'');
    input.value='';
    clearDmReplyTarget();
    if(data&&!state.liveMessages.some(m=>same(m.id,data.id)))state.liveMessages.push(data);
    const flow=$('#chatFlow');
    if(flow&&data){
      const previous=state.liveMessages.filter(m=>same(m.conversation_id,conversationId)&&!m.deleted_at&& !same(m.id,data.id)).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).at(-1);
      flow.insertAdjacentHTML('beforeend',messageBubble(data,previous));
      flow.scrollTop=flow.scrollHeight;
      bindV6(flow);
    }
    await markConversationRead(conversationId);
    button.disabled=false;
    input.focus({preventScroll:true});
    scrollActiveDmToBottom();
  };}
  const circleInput=root.querySelector('#circleChatInput');if(circleInput){bindDmKeyboardBottom();circleInput.oninput=()=>setCircleDraft(state.activeCircleId,circleInput.value);circleInput.addEventListener('focus',()=>scrollActiveCircleChatToBottom(),{passive:true});circleInput.addEventListener('click',()=>scrollActiveCircleChatToBottom(),{passive:true})}
  root.querySelectorAll('[data-cancel-circle-reply]').forEach(el=>el.onclick=event=>{event.preventDefault();event.stopPropagation();clearCircleReplyTarget()});
  const circleChat=root.querySelector('#circleChatForm');if(circleChat){const circleSendButton=circleChat.querySelector('button');if(circleSendButton)circleSendButton.addEventListener('pointerdown',event=>{if(window.matchMedia('(max-width:760px)').matches||document.documentElement.classList.contains('neis-native-app')){event.preventDefault();$('#circleChatInput')?.focus({preventScroll:true})}},{passive:false});circleChat.onsubmit=async e=>{e.preventDefault();const input=$('#circleChatInput'),button=circleChat.querySelector('button'),circleId=state.activeCircleId,body=input.value.trim();if(!body)return;button.disabled=true;setCircleDraft(circleId,input.value);const replyTo=activeCircleReply();const {data,error}=await sb.from('circle_messages').insert({circle_id:circleId,sender_id:authUser.id,body,reply_to_id:replyTo?.id||null}).select('*').single();if(error){toast(safeError(error,'send this message'));button.disabled=false;return}setCircleDraft(circleId,'');input.value='';clearCircleReplyTarget();if(data){data.profile=profileData(authUser.id);if(!state.circleMessages.some(m=>same(m.id,data.id)))state.circleMessages.push(data);const flow=$('#circleChatFlow');if(flow){const previous=state.circleMessages.filter(m=>same(m.circle_id,circleId)&&!m.deleted_at&&!same(m.id,data.id)).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).at(-1);flow.insertAdjacentHTML('beforeend',circleMessageBubble(data,previous));flow.scrollTop=flow.scrollHeight;bindV6(flow)}}button.disabled=false;input.focus({preventScroll:true});scrollActiveCircleChatToBottom()};}
}

function fitMobileConversationList(){
  if(!window.matchMedia('(max-width:760px)').matches)return;
  const messages=document.querySelector('.messages:not(.mobile-thread-open)');
  if(!messages)return;
  const nav=document.querySelector('.bottom-nav');
  const viewportBottom=window.visualViewport?window.visualViewport.height:window.innerHeight;
  const rect=messages.getBoundingClientRect();
  const navTop=nav?.getBoundingClientRect?.().top;
  const bottom=Number.isFinite(navTop)&&navTop>0?Math.min(navTop,viewportBottom):viewportBottom;
  const available=Math.floor(bottom-rect.top-8);
  if(available>180)messages.style.height=available+'px';
}

function updateBadges(){const msg=unreadMessages(),not=state.notifications.filter(n=>!n.read_at).length;$$('[data-nav="messages"] i').forEach(i=>{i.className=msg?'count-badge':'';i.textContent=msg||''});const bell=$('[data-action="notifications"]');if(bell){let badge=bell.querySelector('.count-badge');if(not&&!badge){badge=document.createElement('i');badge.className='count-badge';bell.append(badge)}if(badge){badge.textContent=not||'';badge.classList.toggle('hidden',!not)}}}

const searchForm=$('#globalSearchForm'),searchInput6=$('#globalSearch');
const globalSearchClear=$('[data-global-search-clear]');
const syncSearchChrome=()=>{const hasQuery=!!searchInput6?.value.trim();globalSearchClear?.classList.toggle('hidden',!hasQuery);searchInput6?.setAttribute('aria-expanded',String(hasQuery&&!$('#searchSuggestions')?.classList.contains('hidden')))};
if(searchForm)searchForm.onsubmit=e=>{e.preventDefault();const q=searchInput6.value.trim();if(q.length<2){toast(t('Type at least two characters.','اكتب حرفين على الأقل.'));return}state.query=q;routeTo(`search?q=${encodeURIComponent(q)}`)};
if(searchInput6){searchInput6.addEventListener('input',()=>{state.query=searchInput6.value;searchIndex=-1;syncSearchChrome();clearTimeout(searchTimer);searchTimer=setTimeout(()=>performSearch(searchInput6.value,false),260)});searchInput6.addEventListener('keydown',e=>{const items=$$('#searchSuggestions .suggest-item');if(e.key==='ArrowDown'){e.preventDefault();searchIndex=Math.min(items.length-1,searchIndex+1);renderSuggestions()}else if(e.key==='ArrowUp'){e.preventDefault();searchIndex=Math.max(0,searchIndex-1);renderSuggestions()}else if(e.key==='Enter'&&searchIndex>=0&&items[searchIndex]){e.preventDefault();items[searchIndex].click()}else if(e.key==='Escape'){$('#searchSuggestions').classList.add('hidden');syncSearchChrome()}})}
if(globalSearchClear)globalSearchClear.onclick=()=>{clearTimeout(searchTimer);searchRequestId++;searchInput6.value='';state.query='';state.searchResults=[];state.searchLoading=false;state.dataErrors.search=null;$('#searchSuggestions')?.classList.add('hidden');syncSearchChrome();searchInput6.focus();if(state.view==='search')routeTo('discover')};
syncSearchChrome();
window.addEventListener('resize',fitMobileConversationList,{passive:true});window.visualViewport?.addEventListener('resize',fitMobileConversationList,{passive:true});
window.addEventListener('hashchange',applyRoute);
document.addEventListener('click',e=>{if(!e.target.closest('#globalSearchForm')){$('#searchSuggestions')?.classList.add('hidden');syncSearchChrome()}});

window.NEISChatActionBridge={
  getMessageMeta(scope,id){
    const key=String(id||'');
    if(scope==='circle'){
      const message=state.circleMessages.find(item=>same(item.id,key));
      if(!message)return {canDelete:false};
      return {
        canDelete:!message.deleted_at&&(same(message.sender_id,authUser?.id)||canModerateCircle(message.circle_id))
      };
    }
    const message=state.liveMessages.find(item=>same(item.id,key));
    if(!message)return {canDelete:false};
    return {
      canDelete:same(message.sender_id,authUser?.id)||state.isAdmin
    };
  },
  rowCanDelete(row){
    return row?.dataset?.messageDeletable==='1'||row?.classList?.contains('mine')||false;
  },
  deleteMessage(scope,id){
    if(scope==='circle')return deleteCircleMessage(id);
    return deleteDirectMessage(id);
  }
};
setTimeout(async()=>{if(authUser){await loadLiveData();if(!location.hash)history.replaceState(null,'','#/home');applyRoute()}},250);
})();


/* v131 — scope-safe message actions for mobile + desktop */
(function installMessageActionsV131(){
  if(window.__neisMessageActionsV131)return;
  window.__neisMessageActionsV131=true;

  const mobile=()=>window.matchMedia('(max-width:760px)').matches;
  const tr=(en,ar)=>((typeof state!=='undefined'&&state?.lang==='ar')?ar:en);
  let timer=null,target=null,armed=null,startX=0,startY=0;

  const clearTimer=()=>{
    if(timer){clearTimeout(timer);timer=null}
    target=null;
  };

  const resolve=eventTarget=>{
    const row=eventTarget?.closest?.('#chatFlow > .chat-message, #circleChatFlow > .chat-message');
    const bubble=row?.querySelector?.('.bubble');
    return row&&bubble?{row,bubble}:null;
  };

  const ensureDialog=()=>{
    let dialog=document.querySelector('#neisMessageActionsDialog');
    if(dialog)return dialog;
    dialog=document.createElement('dialog');
    dialog.id='neisMessageActionsDialog';
    dialog.className='neis-message-actions-dialog';
    document.body.appendChild(dialog);
    dialog.addEventListener('click',event=>{
      if(event.target===dialog){try{dialog.close()}catch(_){}}
    });
    return dialog;
  };

  const openActions=(row,bubble)=>{
    const messageId=String(row?.dataset?.messageId||'').trim();
    if(!messageId)return;

    const isCircle=!!row.closest('#circleChatFlow');
    const scope=isCircle?'circle':'dm';
    const meta=window.NEISChatActionBridge?.getMessageMeta?.(scope,messageId);
    const canDelete=row.dataset?.messageDeletable==='1'||row.classList?.contains('mine')||meta?.canDelete===true;
    const text=bubble?.querySelector?.('.message-text')?.textContent||'';

    const dialog=ensureDialog();
    dialog.innerHTML=`
      <div class="neis-message-dialog-card">
        <div class="neis-message-dialog-head">
          <b>${tr('Message actions','خيارات الرسالة')}</b>
          <button type="button" data-message-dialog-close aria-label="${tr('Close','إغلاق')}">×</button>
        </div>
        <button type="button" class="neis-message-dialog-action" data-message-dialog-reply>
          <span>${tr('Reply','رد')}</span><b>↩</b>
        </button>
        <button type="button" class="neis-message-dialog-action" data-message-dialog-copy>
          <span>${tr('Copy message','نسخ الرسالة')}</span><b>⧉</b>
        </button>
        ${canDelete?`<button type="button" class="neis-message-dialog-action danger" data-message-dialog-delete><span>${tr('Delete message','حذف الرسالة')}</span><b>⌫</b></button>`:''}
      </div>
    `;

    const close=()=>{try{dialog.close()}catch(_){dialog.removeAttribute('open')}};

    dialog.querySelector('[data-message-dialog-close]')?.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();close();
    });

    dialog.querySelector('[data-message-dialog-reply]')?.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();close();
      setTimeout(()=>{
        if(isCircle)window.startCircleReply?.(messageId);
        else window.startDmReply?.(messageId);
      },0);
    });

    dialog.querySelector('[data-message-dialog-copy]')?.addEventListener('click',async event=>{
      event.preventDefault();event.stopPropagation();
      try{
        await navigator.clipboard.writeText(text);
        if(typeof toast==='function')toast(tr('Message copied.','تم نسخ الرسالة.'));
        close();
      }catch(_){
        if(typeof toast==='function')toast(tr('Could not copy this message.','تعذر نسخ الرسالة.'));
      }
    });

    dialog.querySelector('[data-message-dialog-delete]')?.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();close();
      window.NEISChatActionBridge?.deleteMessage?.(scope,messageId);
    });

    try{
      if(dialog.open)dialog.close();
      dialog.showModal();
    }catch(error){
      console.error('[NEIS message actions]',error);
      dialog.setAttribute('open','');
    }
  };

  window.NEISMessageActions={
    openByRow(row){
      const bubble=row?.querySelector?.('.bubble');
      if(row&&bubble)openActions(row,bubble);
    }
  };

  // Both desktop and mobile: three-dot trigger opens the same action dialog.
  document.addEventListener('click',event=>{
    const trigger=event.target?.closest?.('[data-message-actions-trigger]');
    if(!trigger)return;
    event.preventDefault();
    event.stopPropagation();
    const row=trigger.closest('.chat-message');
    if(row)window.NEISMessageActions.openByRow(row);
  },true);

  // Mobile long press remains as an optional shortcut.
  document.addEventListener('touchstart',event=>{
    if(!mobile())return;
    const current=resolve(event.target);
    if(!current)return;
    const touch=event.touches?.[0];
    if(!touch)return;
    clearTimer();armed=null;target=current;
    startX=touch.clientX;startY=touch.clientY;
    timer=setTimeout(()=>{
      if(!target)return;
      armed=target;timer=null;
      try{window.getSelection()?.removeAllRanges()}catch(_){}
      if(navigator.vibrate)navigator.vibrate(24);
    },480);
  },{capture:true,passive:true});

  document.addEventListener('touchmove',event=>{
    if(!timer&&!armed)return;
    const touch=event.touches?.[0];
    if(!touch){clearTimer();armed=null;return}
    if(Math.abs(touch.clientX-startX)>38||Math.abs(touch.clientY-startY)>38){
      clearTimer();armed=null;
    }
  },{capture:true,passive:true});

  document.addEventListener('touchend',event=>{
    const selected=armed;
    clearTimer();armed=null;
    if(!selected)return;
    event.preventDefault();event.stopPropagation();
    setTimeout(()=>openActions(selected.row,selected.bubble),50);
  },{capture:true,passive:false});

  document.addEventListener('touchcancel',()=>{clearTimer();armed=null},{capture:true,passive:true});

  // Reply cancel stays capture-first so it never focuses the composer.
  document.addEventListener('pointerdown',event=>{
    const dm=event.target?.closest?.('[data-cancel-dm-reply]');
    const circle=event.target?.closest?.('[data-cancel-circle-reply]');
    if(!dm&&!circle)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if(dm)window.cancelDmReply?.();
    if(circle)window.cancelCircleReply?.();
  },true);
})();

/* v83 — expose DM delete action for mobile action sheets */
window.neisDeleteDirectMessage=id=>{try{return typeof deleteDirectMessage==='function'?deleteDirectMessage(id):window.deleteDirectMessage?.(id)}catch(_){return window.deleteDirectMessage?.(id)}};

/* v86 — robust delegated cancel for dynamic DM reply previews */
if(!window.__neisDmReplyCancelDelegated){
  window.__neisDmReplyCancelDelegated=true;
  document.addEventListener('click',event=>{
    const cancel=event.target?.closest?.('[data-cancel-dm-reply]');
    if(!cancel)return;
    event.preventDefault();
    event.stopPropagation();
    clearDmReplyTarget();
  },true);
}

/* v125 — cancel reply without reopening the mobile keyboard */
if(!window.__neisCircleReplyCancelDelegated){
  window.__neisCircleReplyCancelDelegated=true;
  document.addEventListener('click',event=>{
    const cancel=event.target?.closest?.('[data-cancel-circle-reply]');
    if(!cancel)return;
    event.preventDefault();
    event.stopPropagation();
    clearCircleReplyTarget();
  },true);
}

/* v95 — keep the DM composer focused while realtime messages arrive. */
if(!window.__neisDmKeyboardFocusGuardV95){
  window.__neisDmKeyboardFocusGuardV95=true;
  document.addEventListener('focusin',event=>{
    if(event.target?.id==='liveChatInput'){
      window.__neisDmComposerFocused=true;
    }
  });
  document.addEventListener('focusout',event=>{
    if(event.target?.id==='liveChatInput'){
      setTimeout(()=>{
        const input=document.querySelector('#liveChatInput');
        if(document.activeElement!==input)window.__neisDmComposerFocused=false;
      },0);
    }
  });
}

/* v101 — execute message deletion directly from the action sheet tap */
window.neisDeleteMessageNow=async(scope,id,button)=>{
  const messageId=String(id||'').trim();
  if(!messageId)return;
  const btn=button||null;
  const original=btn?.innerHTML||'';
  if(btn){btn.disabled=true;btn.innerHTML='<span>'+t('Deleting…','جارٍ الحذف…')+'</span><b>…</b>'}
  try{
    if(scope==='circle'){
      const target=state.circleMessages.find(m=>same(m.id,messageId));
      if(!target){toast(t('This message could not be identified.','تعذر تحديد هذه الرسالة.'));if(btn){btn.disabled=false;btn.innerHTML=original}return}
      const {error}=await sb.from('circle_messages').update({body:'',deleted_at:new Date().toISOString()}).eq('id',messageId);
      if(error){toast(safeError(error,'delete this message'));if(btn){btn.disabled=false;btn.innerHTML=original}return}
      const local=state.circleMessages.find(m=>same(m.id,messageId));
      if(local){local.body='';local.deleted_at=new Date().toISOString()}
      closeModal();
      if(state.view==='circle-detail'&&state.circleTab==='chat'){
        const flow=document.querySelector('#circleChatFlow');
        const msgs=state.circleMessages.filter(m=>same(m.circle_id,state.activeCircleId)&&!m.deleted_at);
        if(flow){flow.innerHTML=msgs.length?msgs.map((m,i)=>circleMessageBubble(m,msgs[i-1])).join(''):emptyState(t('No messages yet','لا توجد رسائل بعد'),t('Send the first message.','أرسل أول رسالة.'));bindV6(flow)}
      }
      toast(t('Message deleted.','تم حذف الرسالة.'));
      return;
    }
    const {data,error}=await sb.rpc('delete_direct_message',{message_id_input:messageId});
    if(error||!data){toast(error?safeError(error,'delete this message'):t('This message could not be deleted.','تعذر حذف هذه الرسالة.'));if(btn){btn.disabled=false;btn.innerHTML=original}return}
    state.liveMessages=state.liveMessages.filter(item=>!same(item.id,messageId));
    closeModal();
    if(state.view==='messages'&&state.activeConversationId){
      const flow=document.querySelector('#chatFlow');
      const msgs=state.liveMessages.filter(m=>same(m.conversation_id,state.activeConversationId)&&!m.deleted_at);
      if(flow){flow.innerHTML=msgs.length?msgs.map((m,i)=>messageBubble(m,msgs[i-1])).join(''):emptyState(t('No messages yet','لا توجد رسائل بعد'),t('Send the first message.','أرسل أول رسالة.'));bindV6(flow)}
    }
    toast(t('Message permanently deleted.','تم حذف الرسالة نهائيًا.'));
  }catch(error){
    console.error('[NEIS direct delete v101]',error);
    toast(t('Could not delete this message.','تعذر حذف هذه الرسالة.'));
    if(btn){btn.disabled=false;btn.innerHTML=original}
  }
};

/* v102 — inline delete bridge for Android WebView action-sheet taps */
window.neisDeleteFromActionElement=(element,event)=>{
  try{
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if(!element||element.dataset.deleteBusy==='1')return false;
    element.dataset.deleteBusy='1';
    const id=element.dataset.messageActionId||'';
    const scope=element.dataset.messageActionScope||'dm';
    window.neisDeleteMessageNow?.(scope,id,element);
  }catch(error){
    console.error('[NEIS inline delete action]',error);
    try{if(element)element.dataset.deleteBusy='0'}catch(_){}
  }
  return false;
};
